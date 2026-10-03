// Where suggestions live. With a Firebase config the page talks to Firestore;
// without one it keeps everything in memory so the page can be tried out.

const SDK = 'https://www.gstatic.com/firebasejs/12.4.0';

export function createStore(config) {
  return config ? firestoreStore(config) : memoryStore();
}

function memoryStore() {
  const rows = [];
  return {
    demo: true,
    async list() {
      return rows.map((row) => ({ ...row }));
    },
    async add(suggestion) {
      const row = { ...suggestion, id: String(rows.length + 1), votes: 1 };
      rows.push(row);
      return { ...row };
    },
    async vote(id) {
      rows.find((r) => r.id === id).votes += 1;
    },
  };
}

async function firestoreStore(config) {
  const [{ initializeApp }, { getAuth, signInAnonymously }, fs] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = initializeApp(config);
  const { user } = await signInAnonymously(getAuth(app));
  const db = fs.getFirestore(app);
  const suggestions = fs.collection(db, 'suggestions');

  return {
    demo: false,
    async list() {
      const snap = await fs.getDocs(fs.query(suggestions, fs.where('hidden', '==', false)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    // The public document and the private note are written together so the
    // rules can require that a note belongs to a suggestion by the same person.
    async add({ type, lat, lng, note, lang, source }) {
      const ref = fs.doc(suggestions);
      const batch = fs.writeBatch(db);
      batch.set(ref, { type, lat, lng, lang, source, uid: user.uid, votes: 1, hidden: false, created: fs.serverTimestamp() });
      if (note) batch.set(fs.doc(db, 'notes', ref.id), { text: note, uid: user.uid, created: fs.serverTimestamp() });
      await batch.commit();
      return { id: ref.id, type, lat, lng, votes: 1 };
    },
    // One vote per person: the vote record's id includes the uid, so a second attempt is refused.
    async vote(id) {
      const batch = fs.writeBatch(db);
      batch.set(fs.doc(db, 'votes', `${id}_${user.uid}`), { suggestion: id, uid: user.uid, created: fs.serverTimestamp() });
      batch.update(fs.doc(suggestions, id), { votes: fs.increment(1) });
      await batch.commit();
    },
  };
}
