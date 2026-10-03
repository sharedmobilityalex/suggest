import { strings } from './strings.js';
import { createStore } from './store.js';
import { firebaseConfig, cartoKey } from './config.js';

const TILES = 'https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
const GEOCODER = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer';
const WORLD = [[85, -180], [85, 180], [-85, 180], [-85, -180]];

const params = new URLSearchParams(location.search);
const touch = matchMedia('(pointer: coarse)').matches;
const phone = matchMedia('(max-width: 767px)');
const $ = (id) => document.getElementById(id);

const state = {
  lang: pick(params.get('lang') || remember('lang') || navigator.language.slice(0, 2), ['en', 'es'], 'en'),
  type: pick(params.get('type'), ['station', 'corral'], 'station'),
  locked: ['station', 'corral'].includes(params.get('type')),
  source: pick(params.get('src'), ['qr', 'web'], 'direct'),
  pin: null,
  voted: new Set(remember('voted') || []),
};
const dots = new Map();
let context;
let store;

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

// localStorage is a convenience, not a requirement: private browsing may refuse it.
function remember(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
}

// Text

function t(key, vars = {}) {
  return strings[state.lang][key].replace(/\{(\w+)\}/g, (_, name) => vars[name]);
}

function applyStrings() {
  document.documentElement.lang = state.lang;
  for (const el of document.querySelectorAll('[data-s]')) el.textContent = t(el.dataset.s);
  for (const el of document.querySelectorAll('[data-s-ph]')) el.placeholder = t(el.dataset.sPh);
  for (const el of document.querySelectorAll('[data-s-aria]')) el.setAttribute('aria-label', t(el.dataset.sAria));
  $('tagline').textContent = t(state.type === 'station' ? 'taglineStation' : 'taglineCorral');
  $('hint').textContent = t(touch ? 'hintTouch' : 'hintMouse');
  $('drop').textContent = t(touch ? 'drop' : 'centre');
  $('cta').textContent = t('drop');
  const other = state.lang === 'en' ? 'es' : 'en';
  $('lang').textContent = phone.matches ? other.toUpperCase() : { es: 'Español', en: 'English' }[other];
  $('lang').lang = other;
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

const map = L.map('map', { zoomControl: false, attributionControl: false, renderer: L.canvas(), minZoom: 12, maxZoom: 19 });
L.control.attribution({ prefix: false, position: 'bottomleft' }).addTo(map);
L.tileLayer(cartoKey ? `${TILES}?key=${cartoKey}` : TILES, { attribution: ATTRIBUTION, subdomains: 'abcd', maxZoom: 19 }).addTo(map);

async function loadContext() {
  const ctx = await fetch('data/context.json').then((r) => r.json());
  const marker = { radius: 4, color: '#fff', weight: 1, fillOpacity: 1, bubblingMouseEvents: false };

  L.polygon([WORLD, ctx.boundary], { stroke: false, fillColor: '#1d1d1b', fillOpacity: 0.08, interactive: false }).addTo(map);
  L.polygon(ctx.boundary, { fill: false, color: '#0b9cd8', weight: 2, dashArray: '6 6', interactive: false }).addTo(map);
  for (const [lat, lng, name] of ctx.stations) {
    L.circleMarker([lat, lng], { ...marker, fillColor: '#8d8c82' }).bindTooltip(name).addTo(map);
  }
  for (const [lat, lng, label, street] of ctx.corrals) {
    L.circleMarker([lat, lng], { ...marker, fillColor: '#0d9488' }).bindTooltip(`Corral ${label} · ${street}`).addTo(map);
  }

  const bounds = L.latLngBounds(ctx.boundary);
  map.fitBounds(bounds, { padding: [8, 8] });
  map.setMaxBounds(bounds.pad(0.5));
  return ctx;
}

function insideCity(lat, lng) {
  const ring = context.boundary;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// The pin being placed

function pinIcon() {
  return L.divIcon({
    className: `pin ${state.type}`,
    iconSize: [30, 40],
    iconAnchor: [15, 40],
    html: '<svg viewBox="0 0 30 40"><path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 25 15 25s15-14.5 15-25C30 6.7 23.3 0 15 0z"/><circle cx="15" cy="15" r="6" fill="#fff"/></svg>',
  });
}

function placePin(latlng) {
  if (!insideCity(latlng.lat, latlng.lng)) {
    toast(t('outside'));
    return;
  }
  if (state.pin) {
    state.pin.setLatLng(latlng);
  } else {
    state.pin = L.marker(latlng, { icon: pinIcon(), draggable: true, zIndexOffset: 1000 }).addTo(map);
    state.pin.on('dragend', pinMoved);
    $('main').classList.add('pinned');
    $('panel').classList.add('open');
    $('submit').disabled = false;
    if (phone.matches) map.panBy([0, $('panel').offsetHeight / 2]);
  }
  updateNear();
}

function pinMoved() {
  const { lat, lng } = state.pin.getLatLng();
  $('submit').disabled = !insideCity(lat, lng);
  if ($('submit').disabled) toast(t('outside'));
  updateNear();
}

function clearPin() {
  state.pin?.remove();
  state.pin = null;
  $('note').value = '';
  $('submit').disabled = true;
  $('main').classList.remove('pinned');
  $('panel').classList.remove('open');
  updateNear();
}

let nearRequest = 0;
async function updateNear() {
  const near = $('near');
  near.hidden = !state.pin;
  if (!state.pin) return;
  const { lat, lng } = state.pin.getLatLng();
  const request = ++nearRequest;
  near.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const result = await fetch(`${GEOCODER}/reverseGeocode?f=json&featureTypes=StreetAddress&location=${lng},${lat}`)
    .then((r) => r.json())
    .catch(() => null);
  const address = result?.address?.Address;
  if (request === nearRequest && address) near.textContent = t('near', { address });
}

async function submit() {
  const { lat, lng } = state.pin.getLatLng();
  if (!insideCity(lat, lng)) {
    toast(t('outside'));
    return;
  }
  $('submit').disabled = true;
  try {
    const saved = await store.add({
      type: state.type,
      lat: +lat.toFixed(6),
      lng: +lng.toFixed(6),
      note: $('note').value.trim(),
      lang: state.lang,
      source: state.source,
    });
    addDot(saved);
    clearPin();
    toast(t('added'));
  } catch {
    toast(t('failed'));
    $('submit').disabled = false;
  }
}

// Suggestions already on the map

function dotIcon(s) {
  return L.divIcon({
    className: `dot ${s.type}`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html: s.votes > 1 ? `<b>${s.votes}</b>` : '',
  });
}

function popupHtml(s) {
  const key = s.type === 'station' ? 'wantsStation' : 'wantsCorral';
  const voted = state.voted.has(s.id);
  return `<p>${s.votes === 1 ? t(`${key}One`) : t(key, { n: s.votes })}</p>
    <button type="button" class="btn primary" data-vote="${s.id}"${voted ? ' disabled' : ''}>${t(voted ? 'voted' : 'meToo')}</button>`;
}

function addDot(s) {
  const marker = L.marker([s.lat, s.lng], { icon: dotIcon(s), keyboard: false })
    .bindPopup(() => popupHtml(s), {
      closeButton: false,
      autoPanPaddingTopLeft: [0, phone.matches ? 120 : 0],
      autoPanPaddingBottomRight: [0, phone.matches ? 100 : 0],
    })
    .addTo(map);
  dots.set(s.id, { marker, data: s });
}

async function vote(id, popup) {
  const entry = dots.get(id);
  try {
    await store.vote(id);
  } catch {
    toast(t('failed'));
    return;
  }
  entry.data.votes += 1;
  state.voted.add(id);
  remember('voted', [...state.voted]);
  entry.marker.setIcon(dotIcon(entry.data));
  popup.setContent(() => popupHtml(entry.data));
}

// Address search

let searchTimer;
async function search(text) {
  const url = `${GEOCODER}/findAddressCandidates?f=json&maxLocations=5&countryCode=USA&searchExtent=${context.bbox.join(',')}&singleLine=${encodeURIComponent(text)}`;
  const result = await fetch(url).then((r) => r.json()).catch(() => null);
  showResults((result?.candidates || []).filter((c) => insideCity(c.location.y, c.location.x)));
}

function showResults(candidates) {
  const list = $('results');
  list.replaceChildren(...candidates.map((c) => {
    const li = document.createElement('li');
    li.textContent = c.address;
    li.addEventListener('click', () => {
      map.setView([c.location.y, c.location.x], 17);
      $('search').value = c.address;
      showResults([]);
    });
    return li;
  }));
  list.hidden = candidates.length === 0;
}

// Wiring

map.on('click', (e) => { if (!touch) placePin(e.latlng); });
map.on('locationerror', () => toast(t('noLocation')));
map.on('popupopen', (e) => {
  const button = e.popup.getElement().querySelector('[data-vote]');
  button?.addEventListener('click', () => vote(button.dataset.vote, e.popup));
});

$('drop').addEventListener('click', () => placePin(map.getCenter()));
$('cta').addEventListener('click', () => placePin(map.getCenter()));
$('cancel').addEventListener('click', clearPin);
$('submit').addEventListener('click', submit);
$('locate').addEventListener('click', () => map.locate({ setView: true, maxZoom: 17 }));
$('zoom-in').addEventListener('click', () => map.zoomIn());
$('zoom-out').addEventListener('click', () => map.zoomOut());
$('help').addEventListener('click', () => $('help-dialog').showModal());
$('help-close').addEventListener('click', () => $('help-dialog').close());

$('types').addEventListener('change', (e) => {
  state.type = e.target.value;
  state.pin?.setIcon(pinIcon());
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
  if (text.length < 3) {
    showResults([]);
    return;
  }
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

[context, store] = await Promise.all([loadContext(), createStore(firebaseConfig)]);
if (store.demo) toast(t('demo'), 5000);
for (const s of await store.list()) addDot(s);
