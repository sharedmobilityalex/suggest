import { strings } from './strings.js?v=4';
import { SHEET_URL } from './config.js?v=4';

const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const GEOCODER = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer';
const CREDITS = {
  street: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · <a href="https://www.openmaptiles.org/">OpenMapTiles</a> · <a href="https://openfreemap.org">OpenFreeMap</a>',
  satellite: '&copy; Esri, Maxar, Earthstar Geographics',
};
const PIN = '<svg viewBox="0 0 30 40"><path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 25 15 25s15-14.5 15-25C30 6.7 23.3 0 15 0z"/><circle cx="15" cy="15" r="6" fill="#fff"/></svg>';
const NEARBY = 100; // metres: a new pin this close to a suggestion of the same type is treated as a repeat

const params = new URLSearchParams(location.search);
const touch = matchMedia('(pointer: coarse)').matches;
const phone = matchMedia('(max-width: 767px)');
const $ = (id) => document.getElementById(id);

const state = {
  lang: pick(params.get('lang') || remember('lang') || navigator.language.slice(0, 2), Object.keys(strings), 'en'),
  type: pick(params.get('type'), ['station', 'corral'], 'station'),
  locked: ['station', 'corral'].includes(params.get('type')),
  source: pick(params.get('src'), ['qr', 'web'], 'direct'),
  satellite: false,
  pin: null,
  voted: new Set(remember('voted') || []),
};
const device = remember('device') || remember('device', crypto.randomUUID());
const suggestions = [];
let map;
let tip;
let context;

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

// localStorage is a convenience, not a requirement: private browsing may refuse it.
function remember(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
  return value ?? null;
}

// The Google Sheet behind the map (see tools/sheet.gs). Without a URL the page runs as a demo.
async function api(body) {
  if (!SHEET_URL) return body ? { id: String(Date.now()), votes: 1 } : [];
  const response = await fetch(SHEET_URL, body && { method: 'POST', body: JSON.stringify({ ...body, device }) });
  const result = await response.json();
  if (result.error) throw new Error(result.error);
  return result;
}

// Text

function t(key, vars = {}) {
  return strings[state.lang][key].replace(/\{(\w+)\}/g, (_, name) => vars[name]);
}

function label(el, text) {
  el.title = text;
  el.setAttribute('aria-label', text);
}

function applyStrings() {
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
  for (const el of document.querySelectorAll('[data-s]')) el[el.matches('input') ? 'placeholder' : 'textContent'] = t(el.dataset.s);
  for (const el of document.querySelectorAll('[data-s-label]')) label(el, t(el.dataset.sLabel));
  if (phone.matches) for (const el of document.querySelectorAll('[data-s-phone]')) el.textContent = t(el.dataset.sPhone);
  for (const el of document.querySelectorAll('[data-lang]')) el.setAttribute('aria-current', el.dataset.lang === state.lang);
  $('tagline').textContent = t(state.type === 'station' ? 'taglineStation' : 'taglineCorral');
  $('hint').textContent = t(touch ? 'hintTouch' : 'hintMouse');
  $('drop').textContent = t(touch ? 'drop' : 'centre');
  $('cta').textContent = t('drop');
  $('ask').textContent = t(context ? 'ask' : 'loading');
  labelBasemap();
  updateNear();
  for (const s of suggestions) s.render();
}

function setLang(code) {
  state.lang = code;
  remember('lang', code);
  $('langs').close();
  applyStrings();
}

let toastTimer;
function toast(message, duration = 5000) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

function sorry(error) {
  toast(t(error.message === 'limit' ? 'limit' : 'failed'), 7000);
}

// Map

function toggleBasemap() {
  if (!map.getLayer('imagery')) return;
  state.satellite = !state.satellite;
  for (const id of ['imagery', 'labels']) map.setLayoutProperty(id, 'visibility', state.satellite ? 'visible' : 'none');
  labelBasemap();
}

function labelBasemap() {
  label($('basemap'), t(state.satellite ? 'mapView' : 'satellite'));
  $('credits').innerHTML = CREDITS[state.satellite ? 'satellite' : 'street'];
}

async function loadContext() {
  const [ctx] = await Promise.all([fetch('data/context.json').then((r) => r.json()), new Promise((done) => map.once('style.load', done))]);
  const raster = (path) => ({ type: 'raster', tiles: [`${ESRI}/${path}/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19 });
  const place = (lng, lat, kind, name) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { kind, name } });
  const places = [
    ...ctx.stations.map(([lng, lat, name]) => place(lng, lat, 'station', name)),
    ...ctx.corrals.map(([lng, lat, number, street]) => place(lng, lat, 'corral', `Corral ${number} · ${street}`)),
  ];

  map.addSource('imagery', raster('World_Imagery'));
  map.addSource('labels', raster('Reference/World_Transportation'));
  map.addSource('city', { type: 'geojson', data: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ctx.boundary] } });
  map.addSource('places', { type: 'geojson', data: { type: 'FeatureCollection', features: places } });
  map.addLayer({ id: 'imagery', type: 'raster', source: 'imagery', layout: { visibility: 'none' } });
  map.addLayer({ id: 'labels', type: 'raster', source: 'labels', layout: { visibility: 'none' } });
  map.addLayer({ id: 'mask', type: 'fill', source: 'city', paint: { 'fill-color': '#1d1d1b', 'fill-opacity': 0.08 } });
  map.addLayer({ id: 'boundary', type: 'line', source: 'city', paint: { 'line-color': '#0b9cd8', 'line-width': 2, 'line-dasharray': [3, 3] } });
  map.addLayer({ id: 'places', type: 'circle', source: 'places', paint: { 'circle-radius': 4, 'circle-color': ['match', ['get', 'kind'], 'corral', '#0d9488', '#6b6a62'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });

  const [w, s, e, n] = ctx.bbox;
  map.fitBounds(ctx.bbox, { padding: 8, animate: false });
  map.setMaxBounds([w - (e - w) / 2, s - (n - s) / 2, e + (e - w) / 2, n + (n - s) / 2]);
  return ctx;
}

function showTip(feature) {
  tip.setLngLat(feature.geometry.coordinates).setText(feature.properties.name).addTo(map);
}

function insideCity(lng, lat) {
  const ring = context.boundary;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// The pin being placed

function placePin(lngLat) {
  if (!insideCity(lngLat.lng, lngLat.lat)) return toast(t('outside'));
  if (!state.pin) {
    const el = document.createElement('div');
    el.className = 'pin';
    el.innerHTML = PIN;
    state.pin = new maplibregl.Marker({ element: el, draggable: true, anchor: 'bottom' }).setLngLat(lngLat).addTo(map);
    state.pin.on('dragend', updateNear);
    setPinned(true);
    if (phone.matches) map.panBy([0, $('panel').offsetHeight / 2]);
  }
  state.pin.setLngLat(lngLat).getElement().classList.toggle('corral', state.type === 'corral');
  updateNear();
}

function setPinned(on) {
  $('main').classList.toggle('pinned', on);
  $('submit').disabled = !on;
}

function clearPin() {
  state.pin?.remove();
  state.pin = null;
  $('note').value = '';
  setPinned(false);
}

// The closest suggestion of the chosen type within NEARBY metres of the pin, if there is one.
function nearby() {
  const { lng, lat } = state.pin.getLngLat();
  const east = 111320 * Math.cos((lat * Math.PI) / 180);
  let closest;
  let reach = NEARBY;
  for (const s of suggestions) {
    const distance = Math.hypot((s.lng - lng) * east, (s.lat - lat) * 110540);
    if (s.type === state.type && distance <= reach) [closest, reach] = [s, distance];
  }
  return closest;
}

function hasVoted(s) {
  return s.voted || state.voted.has(s.id);
}

// Shows where the pin is, and says so when someone has already suggested the same thing next to it.
let nearRequest = 0;
async function updateNear() {
  if (!state.pin) return;
  const { lng, lat } = state.pin.getLngLat();
  const repeat = nearby();
  $('nudge-text').textContent = t(state.type === 'station' ? 'nudgeStation' : 'nudgeCorral');
  $('nudge-vote').hidden = !repeat || hasVoted(repeat);
  $('nudge').hidden = !repeat;
  const request = ++nearRequest;
  $('near').textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const result = await fetch(`${GEOCODER}/reverseGeocode?f=json&featureTypes=StreetAddress&location=${lng},${lat}`).then((r) => r.json()).catch(() => null);
  if (request === nearRequest && result?.address?.Address) $('near').textContent = t('near', { address: result.address.Address });
}

// A pin beside an existing suggestion needs a second, explicit yes. Otherwise the dot goes on the
// map at once and the sheet catches up; a refused save puts the pin back.
async function submit(sure) {
  const { lng, lat } = state.pin.getLngLat();
  if (!insideCity(lng, lat)) return toast(t('outside'));
  const repeat = nearby();
  if (repeat && sure !== true) {
    $('sure-vote').hidden = hasVoted(repeat);
    return $('sure').showModal();
  }
  const s = { type: state.type, lat: +lat.toFixed(6), lng: +lng.toFixed(6), note: $('note').value.trim(), lang: state.lang, source: state.source, votes: 1 };
  s.saving = api({ action: 'add', ...s }).then((saved) => keepVote(s.id = saved.id));
  s.voted = true;
  const dot = addDot(s);
  clearPin();
  toast(t('added'));
  try {
    await s.saving;
  } catch (error) {
    dot.remove();
    suggestions.splice(suggestions.indexOf(s), 1);
    if (!state.pin) {
      placePin({ lng, lat });
      $('note').value = s.note;
    }
    sorry(error);
  }
}

// Gives the pin up and votes for the suggestion beside it instead.
function voteNearby() {
  const repeat = nearby();
  clearPin();
  if (!repeat || hasVoted(repeat)) return;
  vote(repeat);
  toast(t('voteAdded'));
}

// Suggestions already on the map

function describe(s) {
  const key = s.type === 'station' ? 'wantsStation' : 'wantsCorral';
  return s.votes === 1 ? t(`${key}One`) : t(key, { n: s.votes });
}

function addDot(s) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `dot ${s.type}`;
  const popup = new maplibregl.Popup({ closeButton: false, offset: 14 });
  const marker = new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).setPopup(popup).addTo(map);
  const escape = (e) => {
    if (e.key !== 'Escape' || !popup.isOpen()) return;
    popup.remove();
    el.focus();
  };
  s.render = () => {
    el.innerHTML = s.votes > 1 ? `<b>${s.votes}</b>` : '';
    el.setAttribute('aria-label', describe(s));
    if (!popup.isOpen()) return;
    popup.setHTML(`<p>${describe(s)}</p><button type="button" class="btn primary" data-vote${hasVoted(s) ? ' disabled' : ''}>${t(hasVoted(s) ? 'voted' : 'meToo')}</button>`);
    popup.getElement().querySelector('[data-vote]').onclick = () => vote(s);
  };
  popup.on('open', () => {
    s.render();
    popup.getElement().addEventListener('keydown', escape);
    const above = popup.getElement().getBoundingClientRect().top - $('map').getBoundingClientRect().top - 110;
    if (phone.matches && above < 0) map.panBy([0, above]);
  });
  // The map opens the popup on a pointer click. A keyboard press reaches the dot as a click with no detail.
  el.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    marker.togglePopup();
    popup.getElement()?.querySelector('[data-vote]').focus();
  });
  el.addEventListener('keydown', escape);
  s.render();
  suggestions.push(s);
  return marker;
}

// A suggestion counts as its author's vote, so this is also called when one is saved.
function keepVote(id) {
  state.voted.add(id);
  remember('voted', [...state.voted]);
}

// The count changes at once and the sheet catches up; a refused vote is taken back.
async function vote(s) {
  const mark = (voted) => {
    s.votes += voted ? 1 : -1;
    s.voted = voted;
    s.render();
  };
  mark(true);
  try {
    await s.saving;
    await api({ action: 'vote', id: s.id });
    keepVote(s.id);
  } catch (error) {
    mark(false);
    sorry(error);
  }
}

// Address search

let searchTimer;
async function search(text) {
  const url = `${GEOCODER}/findAddressCandidates?f=json&maxLocations=5&countryCode=USA&searchExtent=${context.bbox.join(',')}&singleLine=${encodeURIComponent(text)}`;
  const result = await fetch(url).then((r) => r.json()).catch(() => null);
  showResults((result?.candidates || []).filter((c) => insideCity(c.location.x, c.location.y)));
}

function showResults(candidates) {
  const list = $('results');
  list.replaceChildren(...candidates.map((c) => {
    const li = document.createElement('li');
    const button = li.appendChild(document.createElement('button'));
    button.type = 'button';
    button.textContent = c.address;
    button.addEventListener('click', () => {
      map.flyTo({ center: [c.location.x, c.location.y], zoom: 17 });
      $('search').value = c.address;
      showResults([]);
    });
    return li;
  }));
  list.hidden = candidates.length === 0;
}

// Wiring

function setType(type) {
  state.type = type;
  document.querySelector(`input[value="${type}"]`).checked = true;
  state.pin?.getElement().classList.toggle('corral', type === 'corral');
  applyStrings();
}

$('drop').addEventListener('click', () => placePin(map.getCenter()));
$('cta').addEventListener('click', () => placePin(map.getCenter()));
$('cancel').addEventListener('click', clearPin);
$('submit').addEventListener('click', submit);
$('nudge-vote').addEventListener('click', voteNearby);
$('sure-vote').addEventListener('click', () => { $('sure').close(); voteNearby(); });
$('sure-submit').addEventListener('click', () => { $('sure').close(); submit(true); });
$('locate').addEventListener('click', () => {
  const done = () => $('locate').classList.remove('busy');
  $('locate').classList.add('busy');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => { done(); map.flyTo({ center: [coords.longitude, coords.latitude], zoom: 17 }); },
    () => { done(); toast(t('noLocation')); },
    { timeout: 10000 },
  );
});
$('zoom-in').addEventListener('click', () => map.zoomIn());
$('zoom-out').addEventListener('click', () => map.zoomOut());
$('basemap').addEventListener('click', toggleBasemap);
$('help').addEventListener('click', () => $('help-dialog').showModal());
$('lang').addEventListener('click', () => $('langs').showModal());
$('types').addEventListener('change', (e) => setType(e.target.value));
phone.addEventListener('change', applyStrings);

// Escape closes the welcome screen and a click can land outside it; both bring a reminder instead.
$('welcome').addEventListener('close', () => {
  if (document.querySelector('input[name="type"]:checked')) return;
  $('welcome').showModal();
  $('remind').hidden = false;
});
$('welcome').addEventListener('click', (e) => {
  const choice = e.target.closest('[value]');
  const box = $('welcome').getBoundingClientRect();
  if (choice) {
    setType(choice.value);
    $('welcome').close();
  } else if (e.target === $('welcome') && (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom)) {
    $('remind').hidden = false;
  }
});

$('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const text = e.target.value.trim();
  if (text.length < 3) return showResults([]);
  searchTimer = setTimeout(() => search(text), 300);
});
$('search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('results').querySelector('button')?.click();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search')) showResults([]);
  e.target.closest('[data-close]')?.closest('dialog').close();
  const language = e.target.closest('[data-lang]');
  if (language) setLang(language.dataset.lang);
});

// Start: the welcome screen shows at once; the map loads behind it and then unlocks the choices

for (const list of document.querySelectorAll('.langs')) {
  list.replaceChildren(...Object.keys(strings).map((code) => {
    const button = Object.assign(document.createElement('button'), { type: 'button', className: list.dataset.buttons, lang: code, textContent: strings[code].name });
    button.dataset.lang = code;
    return button;
  }));
}
const choices = document.querySelectorAll('#welcome [value]');
applyStrings();
$('types').hidden = state.locked;
for (const choice of choices) choice.hidden = state.locked && choice.value !== state.type;
$('main').classList.toggle('touch', touch);
$('welcome').showModal();
const saved = api().catch(() => []);

if (!window.maplibregl) await new Promise((done) => $('gl').addEventListener('load', done));
map = new maplibregl.Map({ container: 'map', style: STYLE, center: [-77.09, 38.82], zoom: 12, minZoom: 12, maxZoom: 19, attributionControl: false });
tip = new maplibregl.Popup({ closeButton: false, offset: 8, className: 'tip' });
context = await loadContext();
map.on('mouseenter', 'places', (e) => { map.getCanvas().style.cursor = 'pointer'; showTip(e.features[0]); });
map.on('mouseleave', 'places', () => { map.getCanvas().style.cursor = ''; tip.remove(); });
map.on('click', (e) => {
  if (e.originalEvent.target.closest('.maplibregl-marker')) return;
  const place = map.queryRenderedFeatures(e.point, { layers: ['places'] })[0];
  if (place) showTip(place);
  else if (!touch) placePin(e.lngLat);
});
for (const choice of choices) choice.disabled = false;
$('ask').textContent = t('ask');
if (!SHEET_URL) toast(t('demo'));
for (const s of await saved) addDot(s);
