// Apps Script behind the suggestion map. Lives in a Google Sheet with two tabs,
// "suggestions" and "votes" (run setup() once to create them), and is deployed
// as a web app that executes as the owner and that anyone may call.

const HEADERS = ['id', 'created', 'type', 'lat', 'lng', 'note', 'lang', 'source', 'device', 'votes', 'hidden'];

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  for (const [name, headers] of [['suggestions', HEADERS], ['votes', ['id', 'device', 'created']]]) {
    const s = ss.getSheetByName(name) || ss.insertSheet(name);
    s.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  }
}

// Everyone may read the public part of each suggestion: where, what, and how many votes.
function doGet() {
  const rows = sheet('suggestions').getDataRange().getValues().slice(1);
  return json(rows.filter((r) => !r[10]).map((r) => ({ id: r[0], type: r[2], lat: r[3], lng: r[4], votes: r[9] })));
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return json(body.action === 'vote' ? vote(body) : add(body));
  } finally {
    lock.releaseLock();
  }
}

function add(b) {
  if (!['station', 'corral'].includes(b.type) || !inCity(b.lat, b.lng)) throw new Error('invalid suggestion');
  const id = Utilities.getUuid().slice(0, 8);
  sheet('suggestions').appendRow([id, new Date(), b.type, +b.lat, +b.lng, String(b.note || '').slice(0, 200), b.lang, b.source, b.device, 1, false]);
  return { id, votes: 1 };
}

// One vote per device per suggestion.
function vote(b) {
  const votes = sheet('votes');
  if (votes.getDataRange().getValues().some((r) => r[0] === b.id && r[1] === b.device)) throw new Error('already voted');
  const suggestions = sheet('suggestions');
  const row = suggestions.getDataRange().getValues().findIndex((r) => r[0] === b.id);
  if (row < 1) throw new Error('unknown suggestion');
  const n = suggestions.getRange(row + 1, 10).getValue() + 1;
  suggestions.getRange(row + 1, 10).setValue(n);
  votes.appendRow([b.id, b.device, new Date()]);
  return { votes: n };
}

function inCity(lat, lng) {
  return lat > 38.78 && lat < 38.86 && lng > -77.16 && lng < -77.03;
}

function sheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
