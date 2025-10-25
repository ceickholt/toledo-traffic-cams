// Toledo OHGO Cameras — robust parser for API Result wrapper
const els = {
  apiKey: document.getElementById('apiKey'),
  saveKey: document.getElementById('saveKey'),
  interval: document.getElementById('interval'),
  imgSize: document.getElementById('imgSize'),
  search: document.getElementById('search'),
  status: document.getElementById('status'),
  grid: document.getElementById('grid'),
  refreshNow: document.getElementById('refreshNow')
};

let cameras = [];
let timer = null;

function getKey() { return localStorage.getItem('ohgo_api_key') || ''; }
function setKey(k) { localStorage.setItem('ohgo_api_key', k); }

function status(msg, isError=false) {
  els.status.textContent = msg;
  els.status.className = isError ? 'status error' : 'status';
}

// Normalize any OHGO response into an array of Camera records
function normalize(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.Results)) return result.Results;
  if (Array.isArray(result.items)) return result.items;
  if (Array.isArray(result.data)) return result.data;
  if (Array.isArray(result.results)) return result.results;
  return [];
}

async function fetchCameras() {
  const key = getKey();
  if (!key) { status('Enter your OHGO API key above, then press Save.'); return; }
  status('Loading cameras…');
  try {
    const url = 'https://publicapi.ohgo.com/api/v1/cameras?region=toledo&page-all=true';
    const res = await fetch(url, { headers: { 'Authorization': 'APIKEY ' + key } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
    }
    const data = await res.json();
    cameras = normalize(data);
    if (!Array.isArray(cameras)) cameras = [];
    render();
    status(`Loaded ${cameras.length} camera sites.`);
  } catch (err) {
    console.error(err);
    status('Failed to load cameras: ' + err.message, true);
  }
}

function render() {
  const q = (els.search.value || '').toLowerCase().trim();
  const sizeField = els.imgSize.value; // "SmallUrl" or "LargeUrl"
  els.grid.innerHTML = '';

  let count = 0;
  for (const cam of cameras) {
    const views = Array.isArray(cam.CameraViews) ? cam.CameraViews : [];
    for (const v of views) {
      const label = cam.Location || cam.Description || 'Camera';
      const meta = [v.MainRoute, v.Direction].filter(Boolean).join(' • ');
      const hay = (label + ' ' + meta).toLowerCase();
      if (q && !hay.includes(q)) continue;

      const imgUrl = v[sizeField] || v.SmallUrl || v.LargeUrl;
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

function bustAll() {
  const now = Date.now();
  document.querySelectorAll('.figure img').forEach(img => {
    const base = img.getAttribute('data-base');
    if (!base) return;
    const sep = base.includes('?') ? '&' : '?';
    img.src = base + sep + 't=' + now;
  });
}

function startAutoRefresh() {
  stopAutoRefresh();
  const seconds = parseInt(els.interval.value, 10) || 10;
  timer = setInterval(bustAll, seconds * 1000);
}
function stopAutoRefresh() { if (timer) { clearInterval(timer); timer = null; } }

function escapeHTML(s) {
  return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

els.saveKey.addEventListener('click', () => { setKey(els.apiKey.value.trim()); fetchCameras(); });
els.interval.addEventListener('change', startAutoRefresh);
els.imgSize.addEventListener('change', render);
els.search.addEventListener('input', () => render());
els.refreshNow.addEventListener('click', bustAll);

els.apiKey.value = getKey();
if (getKey()) { fetchCameras(); } else { status('Enter your OHGO API key above, then press Save.'); }
