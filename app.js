// app.js — Toledo OHGO Cameras (robust GitHub Pages / Google Sites build)

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
};

let cameras = [];
let timer = null;

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

// ---------- Data helpers ----------
function normalize(result){
  // Return an array of "site" objects no matter how the API wraps it
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

// Rough bounding box around the Toledo metro
function inToledoBbox(lat, lon){
  // Adjust if you want tighter limits; this covers Lucas County & near suburbs
  return lat <= 41.85 && lat >= 41.30 && lon >= -84.10 && lon <= -83.20;
}

function looksToledoByText(cam){
  const txt = JSON.stringify(cam || {}).toLowerCase();
  return txt.includes('toledo') || txt.includes('lucas') || txt.includes('i-75') || txt.includes('i75') || txt.includes('i-475') || txt.includes('i475');
}

function extractLat(cam){
  return cam.Latitude ?? cam.latitude ?? cam.lat ?? (cam.LocationLat ?? cam.locationLat);
}
function extractLon(cam){
  return cam.Longitude ?? cam.longitude ?? cam.lon ?? cam.lng ?? cam.long ?? (cam.LocationLon ?? cam.locationLon);
}

// ---------- Fetch logic ----------
async function fetchCameras(){
  const key = getKey();
  if (!key){ status('Enter your OHGO API key above, then press Save.'); return; }
  status('Loading cameras…');

  const baseToledo = 'https://publicapi.ohgo.com/api/v1/cameras?region=toledo&page-all=true';
  const baseAll    = 'https://publicapi.ohgo.com/api/v1/cameras?page-all=true';

  const strategies = (base) => ([
    { url: base + '&api-key=' + encodeURIComponent(key), opts: {} },
    { url: base, opts: { headers: { 'Authorization': 'APIKEY ' + key } } },
    { url: base, opts: { headers: { 'authorization': 'APIKEY ' + key } } },
  ]);

  let lastErr = null;

  // 1) Try region=toledo first
  try{
    const arr = await tryStrategies(strategies(baseToledo));
    cameras = arr;
    if (Array.isArray(cameras) && cameras.length){
      status(`Loaded ${cameras.length} camera sites (Toledo region).`);
      render();
      return;
    }
  }catch(err){
    lastErr = err;
    console.warn('Toledo fetch failed:', err);
  }

  // 2) Fallback: statewide fetch, then client-side filter
  status('No region results; loading statewide and filtering to Toledo…');
  try{
    const arr = await tryStrategies(strategies(baseAll));
    // Filter by bbox OR region-like text
    const filtered = arr.filter(cam => {
      const lat = extractLat(cam);
      const lon = extractLon(cam);
      return (typeof lat === 'number' && typeof lon === 'number' && inToledoBbox(lat, lon)) || looksToledoByText(cam);
    });
    cameras = filtered;
    status(`Loaded ${cameras.length} Toledo-area camera sites (filtered).`);
    render();
    return;
  }catch(err){
    lastErr = err;
    console.warn('Statewide fetch failed:', err);
  }

  status('Failed to load cameras: ' + (lastErr ? lastErr.message : 'Unknown error'), true);
}

async function tryStrategies(list){
  let lastErr = null;
  for (const s of list){
    try{
      const data = await fetchJSON(s.url, s.opts);
      const out = normalize(data);
      if (Array.isArray(out)) return out;
    }catch(err){
      lastErr = err;
      // keep trying the next strategy
    }
  }
  throw lastErr || new Error('All fetch strategies failed');
}

// ---------- Render ----------
function render(){
  if (!Array.isArray(cameras)) cameras = [];

  const rawQ = (els.search && els.search.value) ? els.search.value : '';
  const q = rawQ.trim().toLowerCase();

  const sizeField = els.imgSize ? els.imgSize.value : 'SmallUrl';
  els.grid.innerHTML = '';

  // Debug info in console for quick diagnosis
  console.log('[Toledo Cams] sites:', cameras.length, q ? `filter="${q}"` : '(no filter)');
  if (cameras.length && typeof cameras[0] === 'object') {
    console.log('[Toledo Cams] sample site keys:', Object.keys(cameras[0]));
  }

  let count = 0;

  for (const cam of cameras) {
    // Accept multiple shapes: CameraViews / cameraViews / Views / views
    const views =
      (Array.isArray(cam.CameraViews) && cam.CameraViews) ||
      (Array.isArray(cam.cameraViews) && cam.cameraViews) ||
      (Array.isArray(cam.Views) && cam.Views) ||
      (Array.isArray(cam.views) && cam.views) || [];

    // If the site has no views, skip (some records are metadata-only)
    if (!views.length) continue;

    // Site label fallbacks
    const label =
      cam.Location || cam.Description || cam.Name || cam.Title || cam.Roadway || 'Camera';

    for (const v of views) {
      const mainRoute =
        v.MainRoute || v.mainRoute || v.Route || v.Road || v.Roadway || cam.MainRoute || '';
      const direction = v.Direction || v.direction || '';

      const meta = [mainRoute, direction].filter(Boolean).join(' • ');
      const hay = (label + ' ' + meta).toLowerCase();

      if (q && !hay.includes(q)) continue;

      // Image url fallbacks across sizes/keys
      const imgUrl = v[sizeField] || v.SmallUrl || v.smallUrl || v.LargeUrl || v.largeUrl;
      if (!imgUrl) continue;

      const card = document.createElement('article');
      card.className = 'card';
      card.innerHTML = `
        <header>
          <h3>${escapeHTML(label)}</h3>
          <div class="meta">${escapeHTML(meta)}</div>
        </header>
        <div class="figure">
          <img data-base="${imgUrl}" alt="${escapeHTML(label)} — ${escapeHTML(meta)}">
          <div class="badge">Live</div>
        </div>
      `;
      els.grid.appendChild(card);
      count++;
    }
  }

  if (count === 0) {
    els.grid.innerHTML = '<div class="empty">No cameras match your filter.</div>';
  }

  startAutoRefresh();
  bustAll();
}

// ---------- Refresh ----------
function bustAll(){
  const now = Date.now();
  document.querySelectorAll('.figure img').forEach(img => {
    const base = img.getAttribute('data-base');
    if (!base) return;
    const sep = base.includes('?') ? '&' : '?';
    img.src = base + sep + 't=' + now;
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
els.interval?.addEventListener('change', startAutoRefresh);
els.imgSize?.addEventListener('change', render);
els.search?.addEventListener('input', () => render());
els.refreshNow?.addEventListener('click', bustAll);

// Add a one-time Clear button next to the search
(function addClearButtonOnce(){
  if (!els.search || document.getElementById('clearFilterBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'clearFilterBtn';
  btn.textContent = 'Clear';
  btn.style.marginLeft = '6px';
  btn.addEventListener('click', () => { els.search.value = ''; render(); });
  els.search.insertAdjacentElement('afterend', btn);
})();

// Init
els.apiKey && (els.apiKey.value = getKey());
if (getKey()) { fetchCameras(); } else { status('Enter your OHGO API key above, then press Save.'); }
