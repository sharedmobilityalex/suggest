import { strings } from './strings.js';
import { SHEET_URL } from './config.js';

const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const GEOCODER = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer';
const CREDITS = {
  street: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · <a href="https://www.openmaptiles.org/">OpenMapTiles</a> · <a href="https://openfreemap.org">OpenFreeMap</a>',
  satellite: '&copy; Esri, Maxar, Earthstar Geographics',
};
const PIN = '<svg viewBox="0 0 30 40"><path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 25 15 25s15-14.5 15-25C30 6.7 23.3 0 15 0z"/><circle cx="15" cy="15" r="6" fill="#fff"/></svg>';

const params = new URLSearchParams(location.search);
const touch = matchMedia('(pointer: coarse)').matches;
const phone = matchMedia('(max-width: 767px)');
const $ = (id) => document.getElementById(id);

const state = {
  lang: pick(params.get('lang') || remember('lang') || navigator.language.slice(0, 2), ['en', 'es'], 'en'),
  type: pick(params.get('type'), ['station', 'corral'], 'station'),
  locked: ['station', 'corral'].includes(params.get('type')),
  source: pick(params.get('src'), ['qr', 'web'], 'direct'),
  satellite: false,
  pin: null,
  voted: new Set(remember('voted') || []),
};
const device = remember('device') || remember('device', crypto.randomUUID());
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
  return response.json();
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
  for (const el of document.querySelectorAll('[data-s]')) el[el.matches('input') ? 'placeholder' : 'textContent'] = t(el.dataset.s);
  for (const el of document.querySelectorAll('[data-s-label]')) label(el, t(el.dataset.sLabel));
  if (phone.matches) for (const el of document.querySelectorAll('[data-s-phone]')) el.textContent = t(el.dataset.sPhone);
  $('tagline').textContent = t(state.type === 'station' ? 'taglineStation' : 'taglineCorral');
  $('hint').textContent = t(touch ? 'hintTouch' : 'hintMouse');
  $('drop').textContent = t(touch ? 'drop' : 'centre');
  $('cta').textContent = t('drop');
  const other = state.lang === 'en' ? 'es' : 'en';
  $('lang').textContent = phone.matches ? other.toUpperCase() : { es: 'Español', en: 'English' }[other];
  $('lang').lang = other;
  labelBasemap();
  updateNear();
}

let toastTimer;
function toast(message, duration = 3000) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// Map

const map = new maplibregl.Map({ container: 'map', style: STYLE, center: [-77.09, 38.82], zoom: 12, minZoom: 12, maxZoom: 19, attributionControl: false });
const tip = new maplibregl.Popup({ closeButton: false, offset: 8, className: 'tip' });

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
  map.addLayer({ id: 'places', type: 'circle', source: 'places', paint: { 'circle-radius': 4, 'circle-color': ['match', ['get', 'kind'], 'corral', '#0d9488', '#8d8c82'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });

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

let nearRequest = 0;
async function updateNear() {
  if (!state.pin) return;
  const { lng, lat } = state.pin.getLngLat();
  const request = ++nearRequest;
  $('near').textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const result = await fetch(`${GEOCODER}/reverseGeocode?f=json&featureTypes=StreetAddress&location=${lng},${lat}`).then((r) => r.json()).catch(() => null);
  if (request === nearRequest && result?.address?.Address) $('near').textContent = t('near', { address: result.address.Address });
}

// The dot goes on the map at once and the sheet catches up; a refused save puts the pin back.
async function submit() {
  const { lng, lat } = state.pin.getLngLat();
  if (!insideCity(lng, lat)) return toast(t('outside'));
  const s = { type: state.type, lat: +lat.toFixed(6), lng: +lng.toFixed(6), note: $('note').value.trim(), lang: state.lang, source: state.source, votes: 1 };
  s.saving = api({ action: 'add', ...s }).then((saved) => { s.id = saved.id; });
  const dot = addDot(s);
  clearPin();
  toast(t('added'));
  try {
    await s.saving;
  } catch {
    dot.remove();
    if (!state.pin) {
      placePin({ lng, lat });
      $('note').value = s.note;
    }
    toast(t('failed'));
  }
}

// Suggestions already on the map

function popupHtml(s) {
  const key = s.type === 'station' ? 'wantsStation' : 'wantsCorral';
  const voted = s.voted || state.voted.has(s.id);
  return `<p>${s.votes === 1 ? t(`${key}One`) : t(key, { n: s.votes })}</p>
    <button type="button" class="btn primary" data-vote${voted ? ' disabled' : ''}>${t(voted ? 'voted' : 'meToo')}</button>`;
}

function addDot(s) {
  const el = document.createElement('div');
  el.className = `dot ${s.type}`;
  const popup = new maplibregl.Popup({ closeButton: false, offset: 12 });
  const render = () => {
    el.innerHTML = s.votes > 1 ? `<b>${s.votes}</b>` : '';
    if (!popup.isOpen()) return;
    popup.setHTML(popupHtml(s));
    popup.getElement().querySelector('[data-vote]').onclick = () => vote(s, render);
  };
  popup.on('open', () => {
    render();
    const above = popup.getElement().getBoundingClientRect().top - $('map').getBoundingClientRect().top - 110;
    if (phone.matches && above < 0) map.panBy([0, above]);
  });
  render();
  return new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).setPopup(popup).addTo(map);
}

// The count changes at once and the sheet catches up; a refused vote is taken back.
async function vote(s, render) {
  const mark = (voted) => {
    s.votes += voted ? 1 : -1;
    s.voted = voted;
    render();
  };
  mark(true);
  try {
    await s.saving;
    await api({ action: 'vote', id: s.id });
    state.voted.add(s.id);
    remember('voted', [...state.voted]);
  } catch {
    mark(false);
    toast(t('failed'));
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
    li.textContent = c.address;
    li.addEventListener('click', () => {
      map.flyTo({ center: [c.location.x, c.location.y], zoom: 17 });
      $('search').value = c.address;
      showResults([]);
    });
    return li;
  }));
  list.hidden = candidates.length === 0;
}

// Wiring

$('drop').addEventListener('click', () => placePin(map.getCenter()));
$('cta').addEventListener('click', () => placePin(map.getCenter()));
$('cancel').addEventListener('click', clearPin);
$('submit').addEventListener('click', submit);
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
$('help-close').addEventListener('click', () => $('help-dialog').close());

$('types').addEventListener('change', (e) => {
  state.type = e.target.value;
  state.pin?.getElement().classList.toggle('corral', state.type === 'corral');
  applyStrings();
});
phone.addEventListener('change', applyStrings);
$('lang').addEventListener('click', () => {
  state.lang = state.lang === 'en' ? 'es' : 'en';
  remember('lang', state.lang);
  applyStrings();
});

$('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const text = e.target.value.trim();
  if (text.length < 3) return showResults([]);
  searchTimer = setTimeout(() => search(text), 300);
});
$('search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('results').querySelector('li')?.click();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search')) showResults([]);
});

// Start

applyStrings();
$('types').hidden = state.locked;
document.querySelector(`input[value="${state.type}"]`).checked = true;
$('main').classList.toggle('touch', touch);

context = await loadContext();
map.on('mouseenter', 'places', (e) => { map.getCanvas().style.cursor = 'pointer'; showTip(e.features[0]); });
map.on('mouseleave', 'places', () => { map.getCanvas().style.cursor = ''; tip.remove(); });
map.on('click', (e) => {
  if (e.originalEvent.target.closest('.maplibregl-marker')) return;
  const place = map.queryRenderedFeatures(e.point, { layers: ['places'] })[0];
  if (place) showTip(place);
  else if (!touch) placePin(e.lngLat);
});
if (!SHEET_URL) toast(t('demo'), 5000);
for (const s of await api().catch(() => [])) addDot(s);
