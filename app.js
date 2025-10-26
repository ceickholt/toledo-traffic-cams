// app.js — Lucas County only, location labels, working size toggle, large-view modal

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

// County, Lat, Lon extraction
function extractCounty(cam){
  return cam.County ?? cam.county ?? cam.CountyName ?? cam.countyName ?? null;
}
function extractLat(cam){
  return cam.Latitude ?? cam.latitude ?? cam.lat ?? cam.LocationLat ?? cam.locationLat ?? null;
}
function extractLon(cam){
  return cam.Longitude ?? cam.longitude ?? cam.lon ?? cam.lng ?? cam.long ?? cam.LocationLon ?? cam.locationLon ?? null;
}
// Lucas County filter
function isLucasCounty(cam){
  const c = (extractCounty(cam) || '').toString().toLowerCase();
  if (c.includes('lucas')) return true;
  // Fallback: Lucas County / Toledo-ish bbox
  const lat = extractLat(cam), lon = extractLon(cam);
  if (typeof lat === 'number' && typeof lon === 'number'){
    // Tight box around Lucas County
    const inBox = (lat <= 41.85 && lat >= 41.30 && lon >= -83.90 && lon <= -83.20);
    return inBox;
  }
  // Last-chance hint via text
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
    { url: base + '&api-key=' + encodeURIComponent(key), opts: {} }, // best for GitHub Pages
    { url: base, opts: { headers: { 'Authorization': 'APIKEY ' + key } } },
    { url: base, opts: { headers: { 'authorization': 'APIKEY ' + key } } },
  ];

  let lastErr = null;
  for (const s of strategies){
    try{
      const data = await fetchJSON(s.url, s.opts);
      const arr = normalize(data);
      if (Array.isArray(arr)){
        // Lucas County only
        cameras = arr.filter(isLucasCounty);
        status(`Loaded ${cameras.length} cameras (Lucas County).`);
        render();
        return;
      }
    }catch(err){
      lastErr = err;
    }
  }
  status('Failed to load cameras: ' + (lastErr ? lastErr.message : 'Unknown error'), true);
}

// ---------- Render ----------
function render(){
  if (!Array.isArray(cameras)) cameras = [];

  const rawQ = (els.search && els.search.value) ? els.search.value : '';
  const q = rawQ.trim().toLowerCase();

  const sizeField = els.imgSize ? els.imgSize.value : 'SmallUrl'; // "SmallUrl" or "LargeUrl"
  els.grid.innerHTML = '';

  let count = 0;

  cameras.forEach((cam, idx) => {
    // Views list
    const views =
      (Array.isArray(cam.CameraViews) && cam.CameraViews) ||
      (Array.isArray(cam.cameraViews) && cam.cameraViews) ||
      (Array.isArray(cam.Views) && cam.Views) ||
      (Array.isArray(cam.views) && cam.views) || [];

    if (!views.length) return;

    // Label = camera location (your request)
    const labelStrict =
      cam.Location || cam.location || cam.Description || cam.Name || cam.Title || cam.Roadway;
    const label = labelStrict ? String(labelStrict) : 'Unknown location';

    views.forEach((v) => {
      const mainRoute =
        v.MainRoute || v.mainRoute || v.Route || v.Road || v.Roadway || cam.MainRoute || '';
      const direction = v.Direction || v.direction || '';
      const meta = [mainRoute, direction].filter(Boolean).join(' • ');

      const hay = (label + ' ' + meta).toLowerCase();
      if (q && !hay.includes(q)) return;

      const small = v.SmallUrl || v.smallUrl || v[sizeField];
      const large = v.LargeUrl || v.largeUrl || v[sizeField];
      // Need at least one image
      const imgBase = (sizeField === 'LargeUrl' ? (large || small) : (small || large));
      if (!imgBase) return;

      const card = document.createElement('article');
      card.className = 'card';
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

      // Apply current size immediately
      const img = card.querySelector('img');
      applySizeToImg(img);

      // Click → open large view modal
      card.addEventListener('click', () => {
        openLightbox({
          title: label,
          meta,
          small,
          large
        });
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
}

// ---------- Size handling ----------
function applySizeToImg(img){
  if (!img) return;
  const wantLarge = (els.imgSize && els.imgSize.value === 'LargeUrl');
  const base = wantLarge ? (img.dataset.large || img.dataset.small) : (img.dataset.small || img.dataset.large);
  if (base){
    img.setAttribute('data-base', base);
    img.src = cacheBust(base);
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
els.imgSize?.addEventListener('change', () => { applySizeToAll(); }); // instant thumbnail switch
els.search?.addEventListener('input', () => render());
els.refreshNow?.addEventListener('click', () => bustAll());

// Lightbox controls
els.lbBackdrop?.addEventListener('click', closeLightbox);
els.lbClose?.addEventListener('click', closeLightbox);
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && !els.lb.hasAttribute('hidden')) closeLightbox(); });

// Init
els.apiKey && (els.apiKey.value = getKey());
if (getKey()) { fetchCameras(); } else { status('Enter your OHGO API key above, then press Save.'); }
