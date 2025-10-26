// Lucas County (OH) ODOT/OHGO cameras with map + lightbox + robust parsing

// ---------- DOM ----------
const els = {
  apiKey: document.getElementById('apiKey'),
  saveKey: document.getElementById('saveKey'),
  interval: document.getElementById('interval'),
  imgSize: document.getElementById('imgSize'),
  search: document.getElementById('search'),
  status: document.getElementById('status'),
  grid: document.getElementById('grid'),
  refreshNow: document.getElementById('refreshNow'),
  // Map
  map: document.getElementById('map'),
  mapWrap: document.getElementById('mapWrap'),
  toggleMap: document.getElementById('toggleMap'),
  fitMap: document.getElementById('fitMap'),
  // Lightbox
  lb: document.getElementById('lightbox'),
  lbBackdrop: document.getElementById('lbBackdrop'),
  lbClose: document.getElementById('lbClose'),
  lbTitle: document.getElementById('lbTitle'),
  lbImg: document.getElementById('lbImg'),
  lbMeta: document.getElementById('lbMeta'),
};

let cameras = [];
let timer = null;

// Map state
let map, markerLayer;
const markerByCamId = new Map();

// ---------- Storage ----------
function getKey(){ return localStorage.getItem('ohgo_api_key') || ''; }
function setKey(k){ localStorage.setItem('ohgo_api_key', k); }

// ---------- UI helpers ----------
function status(msg, isError=false){
  els.status.textContent = msg;
  els.status.className = isError ? 'status error' : 'status';
}
function escapeHTML(s){
  return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function cacheBust(url){
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + 't=' + Date.now();
}

// ---------- Data helpers ----------
function normalize(result){
  try{
    if (!result) return [];
    if (Array.isArray(result)) return result;
    if (Array.isArray(result.Results)) return result.Results;
    if (Array.isArray(result.items)) return result.items;
    if (Array.isArray(result.data)) return result.data;
    if (Array.isArray(result.results)) return result.results;
  }catch(e){}
  return [];
}
async function fetchJSON(url, opts={}){
  const res = await fetch(url, opts);
  const ctype = res.headers.get('content-type') || '';
  if (!res.ok){
    const t = await res.text().catch(()=> '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${t.slice(0,200)}`);
  }
  if (ctype.includes('application/json')) return res.json();
  const t = await res.text();
  throw new Error('Expected JSON but got: ' + t.slice(0,200));
}

// Extractors
function extractCounty(cam){
  return cam.County ?? cam.county ?? cam.CountyName ?? cam.countyName ?? null;
}
function extractLat(cam){
  return cam.Latitude ?? cam.latitude ?? cam.lat ?? cam.LocationLat ?? cam.locationLat ?? null;
}
function extractLon(cam){
  return cam.Longitude ?? cam.longitude ?? cam.lon ?? cam.lng ?? cam.long ?? cam.LocationLon ?? cam.locationLon ?? null;
}
function cameraId(cam, idx){
  return cam.Id ?? cam.ID ?? cam.CameraId ?? cam.CameraID ?? `site-${idx}`;
}
// Lucas County check
function isLucasCounty(cam){
  const c = (extractCounty(cam) || '').toString().toLowerCase();
  if (c.includes('lucas')) return true;
  const lat = extractLat(cam), lon = extractLon(cam);
  if (typeof lat === 'number' && typeof lon === 'number'){
    // tighter Lucas County bbox
    const inBox = (lat <= 41.85 && lat >= 41.45 && lon >= -83.90 && lon <= -83.20);
    return inBox;
  }
  const txt = JSON.stringify(cam || {}).toLowerCase();
  return txt.includes('lucas') || txt.includes('toledo');
}

// ---------- Fetch logic ----------
async function fetchCameras(){
  const key = getKey();
  if (!key){ status('Enter your OHGO API key above, then press Save.'); return; }
  status('Loading cameras…');

  const base = 'https://publicapi.ohgo.com/api/v1/cameras?page-all=true';

  const strategies = [
    { url: base + '&api-key=' + encodeURIComponent(key), opts: {} },
    { url: base, opts: { headers: { 'Authorization': 'APIKEY ' + key } } },
    { url: base, opts: { headers: { 'authorization': 'APIKEY ' + key } } },
  ];

  let lastErr = null;
  for (const s of strategies){
    try{
      const data = await fetchJSON(s.url, s.opts);
      const arr = normalize(data);
      if (Array.isArray(arr)){
        cameras = arr.filter(isLucasCounty);
        status(`Loaded ${cameras.length} cameras (Lucas County).`);
        render();
        return;
      }
    }catch(err){
      lastErr = err;
      console.warn('[Fetch strategy failed]', err);
    }
  }
  status('Failed to load cameras: ' + (lastErr ? lastErr.message : 'Unknown error'), true);
}

// ---------- Render (grid + map sync) ----------
function render(){
  if (!Array.isArray(cameras)) cameras = [];

  const rawQ = (els.search && els.search.value) ? els.search.value : '';
  const q = rawQ.trim().toLowerCase();

  const sizeField = els.imgSize ? els.imgSize.value : 'SmallUrl';
  els.grid.innerHTML = '';

  let count = 0;

  cameras.forEach((cam, idx) => {
    // Accept multiple shapes for views; some records might not expose per-view; handle single URL too
    let views =
      (Array.isArray(cam.CameraViews) && cam.CameraViews) ||
      (Array.isArray(cam.cameraViews) && cam.cameraViews) ||
      (Array.isArray(cam.Views) && cam.Views) ||
      (Array.isArray(cam.views) && cam.views) || [];

    // If no explicit views but we have image urls on the camera itself, synthesize one
    if (!views.length && (cam.SmallUrl || cam.LargeUrl || cam.smallUrl || cam.largeUrl)){
      views = [{
        SmallUrl: cam.SmallUrl || cam.smallUrl || null,
        LargeUrl: cam.LargeUrl || cam.largeUrl || null,
        MainRoute: cam.MainRoute || cam.Route || cam.Roadway || ''
      }];
    }

    if (!views.length) return;

    // Label must be the camera location (prefer Location)
    const labelStrict = cam.Location || cam.location || cam.Description || cam.Name || cam.Title || cam.Roadway;
    const label = labelStrict ? String(labelStrict) : 'Unknown location';

    views.forEach((v) => {
      const mainRoute =
        v.MainRoute || v.mainRoute || v.Route || v.Road || v.Roadway || cam.MainRoute || '';
      const direction = v.Direction || v.direction || '';
      const meta = [mainRoute, direction].filter(Boolean).join(' • ');

      const hay = (label + ' ' + meta).toLowerCase();
      if (q && !hay.includes(q)) return;

      const small = v.SmallUrl || v.smallUrl || null;
      const large = v.LargeUrl || v.largeUrl || null;
      const chosen = (sizeField === 'LargeUrl') ? (large || small) : (small || large);
      if (!chosen) return;

      const cid = cameraId(cam, idx);

      const card = document.createElement('article');
      card.className = 'card';
      card.dataset.camid = cid;
      card.innerHTML = `
        <header>
          <h3>${escapeHTML(label)}</h3>
          <div class="meta">${escapeHTML(meta)}</div>
        </header>
        <div class="figure">
          <img data-small="${small || ''}" data-large="${large || ''}" alt="${escapeHTML(label)} — ${escapeHTML(meta)}">
          <div class="badge">Live</div>
        </div>
      `;

      const img = card.querySelector('img');
      applySizeToImg(img); // pick small/large instantly

      // Click -> large view modal
      card.addEventListener('click', () => {
        openLightbox({ title: label, meta, small, large });
      });

      els.grid.appendChild(card);
      count++;
    });
  });

  if (count === 0) {
    els.grid.innerHTML = '<div class="empty">No cameras match your filter.</div>';
  }

  startAutoRefresh();
  bustAll();
  updateMap();
}

// ---------- Map ----------
function ensureMap(){
  if (!els.map || typeof L === 'undefined') return false;
  if (map) return true;

  map = L.map(els.map, { zoomControl: true }).setView([41.6528, -83.5379], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);

  els.toggleMap?.addEventListener('click', () => {
    const hidden = els.mapWrap.style.display === 'none';
    els.mapWrap.style.display = hidden ? '' : 'none';
    els.toggleMap.textContent = hidden ? 'Hide Map' : 'Show Map';
    setTimeout(() => { map && map.invalidateSize(); }, 150);
  });
  els.fitMap?.addEventListener('click', () => fitMapToMarkers());

  return true;
}

function updateMap(){
  if (!ensureMap()) return;
  markerLayer.clearLayers();
  markerByCamId.clear();

  // find visible cards
  const visible = Array.from(els.grid.querySelectorAll('.card'));
  const ids = new Set(visible.map(c => c.dataset.camid));

  cameras.forEach((cam, idx) => {
    const cid = cameraId(cam, idx);
    if (!ids.has(cid)) return;

    const lat = extractLat(cam);
    const lon = extractLon(cam);
    if (typeof lat !== 'number' || typeof lon !== 'number') return;

    const label = cam.Location || cam.location || cam.Description || cam.Name || cam.Title || cam.Roadway || 'Camera';

    const m = L.marker([lat, lon]).addTo(markerLayer);
    m.bindPopup(`<strong>${escapeHTML(label)}</strong>`);
    m.on('click', () => {
      scrollToCard(cid);
      highlightCard(cid);
    });
    markerByCamId.set(cid, m);
  });

  fitMapToMarkers();
}

function fitMapToMarkers(){
  if (!map || !markerLayer) return;
  const layers = Object.values(markerLayer._layers || {});
  if (!layers.length){
    map.setView([41.6528, -83.5379], 11);
    return;
  }
  const group = L.featureGroup(layers);
  map.fitBounds(group.getBounds().pad(0.15));
}

function scrollToCard(cid){
  const card = els.grid.querySelector(`.card[data-camid="${CSS.escape(cid)}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function highlightCard(cid){
  const card = els.grid.querySelector(`.card[data-camid="${CSS.escape(cid)}"]`);
  if (!card) return;
  card.style.outline = '2px solid #5aa7ff';
  setTimeout(() => { card.style.outline = ''; }, 1200);
}

// ---------- Size handling ----------
function applySizeToImg(img){
  if (!img) return;
  const wantLarge = (els.imgSize && els.imgSize.value === 'LargeUrl');
  const base = wantLarge ? (img.dataset.large || img.dataset.small) : (img.dataset.small || img.dataset.large);
  if (base){
    img.setAttribute('data-base', base);
    img.src = cacheBust(base);
  } else {
    img.removeAttribute('data-base');
  }
}
function applySizeToAll(){
  document.querySelectorAll('.figure img').forEach(applySizeToImg);
  bustAll();
}

// ---------- Lightbox ----------
function openLightbox({ title, meta, small, large }){
  const big = large || small;
  if (!big) return;
  els.lbTitle.textContent = title || '';
  els.lbMeta.textContent = meta || '';
  els.lbImg.src = cacheBust(big);
  els.lbImg.alt = (title ? title + ' — ' : '') + (meta || '');
  els.lb.removeAttribute('hidden');
}
function closeLightbox(){
  els.lb.setAttribute('hidden', '');
  els.lbImg.src = '';
}

// ---------- Refresh ----------
function bustAll(){
  document.querySelectorAll('.figure img').forEach(img => {
    const base = img.getAttribute('data-base');
    if (!base) return;
    img.src = cacheBust(base);
  });
}
function startAutoRefresh(){
  stopAutoRefresh();
  const seconds = parseInt(els.interval && els.interval.value, 10) || 10;
  timer = setInterval(bustAll, seconds * 1000);
}
function stopAutoRefresh(){
  if (timer) { clearInterval(timer); timer = null; }
}

// ---------- Wire up ----------
els.saveKey?.addEventListener('click', () => { setKey(els.apiKey.value.trim()); fetchCameras(); });
els.interval?.addEventListener('change', () => { startAutoRefresh(); });
els.imgSize?.addEventListener('change', () => { applySizeToAll(); }); // instant
els.search?.addEventListener('input', () => render());
els.refreshNow?.addEventListener('click', () => bustAll());

// Lightbox controls
els.lbBackdrop?.addEventListener('click', closeLightbox);
els.lbClose?.addEventListener('click', closeLightbox);
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && !els.lb.hasAttribute('hidden')) closeLightbox(); });

// Init
els.apiKey && (els.apiKey.value = getKey());
if (getKey()) { fetchCameras(); } else { status('Enter your OHGO API key above, then press Save.'); }
