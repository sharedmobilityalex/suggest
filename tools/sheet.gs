// Apps Script behind the suggestion map. Lives in a Google Sheet with two tabs,
// "suggestions" and "votes" (run setup() once to create them), and is deployed
// as a web app that executes as the owner and that anyone may call.

const HEADERS = ['id', 'created', 'type', 'lat', 'lng', 'note', 'lang', 'source', 'device', 'votes', 'hidden'];

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  for (const [name, headers] of [['suggestions', HEADERS], ['votes', ['id', 'device', 'created']]]) {
    const s = ss.getSheetByName(name) || ss.insertSheet(name);
    s.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    s.setFrozenRows(1);
  }
}

// Everyone may read the public part of each suggestion: where, what, and how many votes.
function doGet() {
  const rows = sheet('suggestions').getDataRange().getValues().slice(1);
  return json(rows.filter((r) => r[0] && !r[10]).map((r) => ({ id: r[0], type: r[2], lat: r[3], lng: r[4], votes: r[9] })));
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
  const lat = Number(b.lat);
  const lng = Number(b.lng);
  if (!['station', 'corral'].includes(b.type) || !inCity(lat, lng)) throw new Error('invalid suggestion');
  const id = 's' + Utilities.getUuid().slice(0, 8);
  sheet('suggestions').appendRow([id, new Date(), b.type, lat, lng, text(b.note, 200), text(b.lang, 2), text(b.source, 6), text(b.device, 40), 1, false]);
  return { id, votes: 1 };
}

// One vote per device per suggestion.
function vote(b) {
  const id = String(b.id);
  const device = text(b.device, 40);
  const votes = sheet('votes');
  if (votes.getDataRange().getValues().some((r) => r[0] === id && r[1] === device)) throw new Error('already voted');
  const suggestions = sheet('suggestions');
  const row = suggestions.getDataRange().getValues().findIndex((r) => r[0] === id);
  if (row < 1) throw new Error('unknown suggestion');
  const n = suggestions.getRange(row + 1, 10).getValue() + 1;
  suggestions.getRange(row + 1, 10).setValue(n);
  votes.appendRow([id, device, new Date()]);
  return { votes: n };
}

// Text from the public is trimmed, and kept from being read as a spreadsheet formula.
function text(value, max) {
  const s = String(value == null ? '' : value).slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
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
