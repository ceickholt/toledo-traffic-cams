// app.js — Lucas County OHGO cameras + Incidents + Map (hardened, production)

// Debug bar
(function(){var b=document.getElementById('dbgbar');if(!b){b=document.createElement('div');b.id='dbgbar';b.style.cssText='position:fixed;bottom:8px;left:8px;background:#11151a;border:1px solid #2a2f36;border-radius:8px;padding:6px 10px;font:12px system-ui;color:#b8c1cc;z-index:9999';b.innerHTML='<span id="dbgmsg">…</span>';document.body.appendChild(b);}})();
function dbg(m){var e=document.getElementById('dbgmsg');if(e)e.textContent=m;}

// DOM
var els={
  apiKey:document.getElementById('apiKey'),
  saveKey:document.getElementById('saveKey'),
  interval:document.getElementById('interval'),
  imgSize:document.getElementById('imgSize'),
  search:document.getElementById('search'),
  status:document.getElementById('status'),
  grid:document.getElementById('grid'),
  refreshNow:document.getElementById('refreshNow'),
  sortBy:document.getElementById('sortBy'),
  clusterToggle:document.getElementById('clusterToggle'),
  wallboardToggle:document.getElementById('wallboardToggle'),
  cycleWrap:document.getElementById('cycleWrap'),
  cycleSeconds:document.getElementById('cycleSeconds'),
  map:document.getElementById('map'),mapWrap:document.getElementById('mapWrap'),
  toggleMap:document.getElementById('toggleMap'),fitMap:document.getElementById('fitMap'),
  lb:document.getElementById('lightbox'),lbBackdrop:document.getElementById('lbBackdrop'),
  lbClose:document.getElementById('lbClose'),lbTitle:document.getElementById('lbTitle'),
  lbImg:document.getElementById('lbImg'),lbMeta:document.getElementById('lbMeta'),
  incidentsWrap:document.getElementById('incidentsWrap'),
  incidentsCount:document.getElementById('incidentsCount'),
  incidentsList:document.getElementById('incidentsList'),
  incidentsRefresh:document.getElementById('incidentsRefresh')
};

// State
var cameras=[],timer=null,map,markerLayer,clusterLayer,markerByCamId=new Map();
var FAV_KEY='ohgo_favorites',favorites=new Set(JSON.parse(localStorage.getItem(FAV_KEY)||'[]'));
var incidents=[],incidentsTimer=null,wallboardTimer=null;

// Helpers
function getKey(){return localStorage.getItem('ohgo_api_key')||'';}
function setKey(k){localStorage.setItem('ohgo_api_key',k);}
function saveFavorites(){localStorage.setItem(FAV_KEY,JSON.stringify(Array.from(favorites)));}
function status(msg,err){if(!els.status)return;els.status.textContent=msg;els.status.className=err?'status error':'status';}
function escapeHTML(s){return String(s||'').replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}
function cacheBust(u){return u+(u.indexOf('?')>-1?'&':'?')+'t='+Date.now();}
function normalize(r){try{if(!r)return[];if(Array.isArray(r))return r;if(Array.isArray(r.Results))return r.Results;if(Array.isArray(r.items))return r.items;if(Array.isArray(r.data))return r.data;if(Array.isArray(r.results))return r.results;}catch(e){}return[];}
function fetchJSON(url,opts){return fetch(url,opts||{}).then(function(res){var ct=res.headers.get('content-type')||'';if(!res.ok)return res.text().then(function(t){throw new Error('HTTP '+res.status+' '+res.statusText+': '+t.slice(0,200));});if(ct.indexOf('application/json')>-1)return res.json();return res.text().then(function(t){throw new Error('Expected JSON but got: '+t.slice(0,200));});});}
function extractCounty(c){return c.County||c.county||c.CountyName||c.countyName||null;}
function extractLat(c){return c.Latitude||c.latitude||c.lat||c.LocationLat||c.locationLat||null;}
function extractLon(c){return c.Longitude||c.longitude||c.lon||c.lng||c.long||c.LocationLon||c.locationLon||null;}
function cameraId(c,i){return c.Id||c.ID||c.CameraId||c.CameraID||('site-'+i);}
function getLocation(c){return c.Location||c.location||c.Description||c.Name||c.Title||c.Roadway||'';}
function getRoute(v,c){return(v&&(v.MainRoute||v.mainRoute||v.Route||v.Roadway))||c.MainRoute||c.Route||c.Roadway||'';}
function getDirection(v){return(v&&(v.Direction||v.direction))||'';}
function viewKey(c,i,v){return cameraId(c,i)+'::'+getRoute(v,c)+'::'+getDirection(v);}
function isLucasCounty(c){var cc=String(extractCounty(c)||'').toLowerCase();if(cc.indexOf('lucas')>-1)return true;var lat=extractLat(c),lon=extractLon(c);if(typeof lat==='number'&&typeof lon==='number'){var inBox=(lat<=41.95&&lat>=41.25&&lon>=-84.20&&lon<=-83.00);if(inBox)return true;}var txt=JSON.stringify(c||{}).toLowerCase();return txt.indexOf('lucas')>-1||txt.indexOf('toledo')>-1;}

// Cameras
function fetchCameras(){var key=getKey();if(!key){status('Enter your OHGO API key above, then press Save.');return;}status('Loading cameras…');var base='https://publicapi.ohgo.com/api/v1/cameras?page-all=true';var tries=[{url:base+'&api-key='+encodeURIComponent(key),opts:{}},{url:base,opts:{headers:{'Authorization':'APIKEY '+key}}},{url:base,opts:{headers:{'authorization':'APIKEY '+key}}}],i=0;(function next(){if(i>=tries.length){status('Failed to load cameras (auth/CORS?)',true);dbg('fetch failed');return;}var t=tries[i++];fetchJSON(t.url,t.opts).then(function(d){var arr=normalize(d)||[];cameras=arr.filter(isLucasCounty);status('Loaded '+cameras.length+' cameras (Lucas County).');dbg('sites:'+cameras.length);render();fetchIncidents();clearInterval(incidentsTimer);incidentsTimer=setInterval(fetchIncidents,60*1000);}).catch(function(e){console.warn('fetch try error',e);next();})();})();}

function sortCards(a,b){var mode=els.sortBy?els.sortBy.value:'route';var af=favorites.has(a.key),bf=favorites.has(b.key);if(mode==='favorites'&&af!==bf)return af?-1:1;function cmp(x,y){return String(x).localeCompare(String(y),undefined,{numeric:true});}
if(mode==='route'){if(a.route!==b.route)return cmp(a.route,b.route);if(a.direction!==b.direction)return cmp(a.direction,b.direction);return cmp(a.location,b.location);}
if(mode==='direction'){if(a.direction!==b.direction)return cmp(a.direction,b.direction);if(a.route!==b.route)return cmp(a.route,b.route);return cmp(a.location,b.location);}
if(mode==='location'){if(a.location!==b.location)return cmp(a.location,b.location);if(a.route!==b.route)return cmp(a.route,b.route);return cmp(a.direction,b.direction);}
if(a.route!==b.route)return cmp(a.route,b.route);if(a.direction!==b.direction)return cmp(a.direction,b.direction);return cmp(a.location,b.location);}

function render(){if(!Array.isArray(cameras))cameras=[];var q=(els.search&&els.search.value?els.search.value:'').trim().toLowerCase();var wantLarge=(els.imgSize&&els.imgSize.value==='LargeUrl');els.grid.innerHTML='';var cards=[];
cameras.forEach(function(cam,idx){var views=(Array.isArray(cam.CameraViews)&&cam.CameraViews)||(Array.isArray(cam.cameraViews)&&cam.cameraViews)||(Array.isArray(cam.Views)&&cam.Views)||(Array.isArray(cam.views)&&cam.views)||[];
if(!views.length&&(cam.SmallUrl||cam.LargeUrl||cam.smallUrl||cam.largeUrl)){views=[{SmallUrl:cam.SmallUrl||cam.smallUrl||null,LargeUrl:cam.LargeUrl||cam.largeUrl||null,MainRoute:cam.MainRoute||cam.Route||cam.Roadway||''}];}
if(!views.length)return;var location=getLocation(cam)||'Unknown location';
views.forEach(function(v){var route=getRoute(v,cam),direction=getDirection(v);var hay=(location+' '+route+' '+direction).toLowerCase();if(q&&hay.indexOf(q)===-1)return;
var small=v.SmallUrl||v.smallUrl||null,large=v.LargeUrl||v.largeUrl||null,chosen=wantLarge?(large||small):(small||large);if(!chosen)return;var key=viewKey(cam,idx,v);
cards.push({key:key,cam:cam,idx:idx,v:v,location:location,route:route,direction:direction,small:small,large:large,chosen:chosen});});});
cards.sort(sortCards);
var count=0;
cards.forEach(function(it){var cam=it.cam,county=extractCounty(cam)||'Lucas County',cid=cameraId(cam,it.idx),isFav=favorites.has(it.key),favClass=isFav?'fav-btn fav-on':'fav-btn';
var card=document.createElement('article');card.className='card';card.dataset.camid=cid;card.dataset.key=it.key;
card.innerHTML='<header><h3>'+escapeHTML(it.location)+'</h3><button class="'+favClass+'" title="Toggle favorite" aria-label="Toggle favorite">★</button><div class="meta">'+escapeHTML([it.route,it.direction].filter(Boolean).join(' • '))+'</div><div class="badges"><span class="badge-chip">'+escapeHTML(county)+'</span></div></header><div class="figure"><img data-small="'+escapeHTML(it.small||'')+'" data-large="'+escapeHTML(it.large||'')+'" alt="'+escapeHTML(it.location)+' — '+escapeHTML([it.route,it.direction].filter(Boolean).join(' • '))+'"><div class="badge">Live</div></div>';
card.querySelector('.fav-btn').addEventListener('click',function(e){e.stopPropagation();if(favorites.has(it.key))favorites.delete(it.key);else favorites.add(it.key);saveFavorites();render();});
applySizeToImg(card.querySelector('img'));
card.addEventListener('click',function(){openLightbox({title:it.location,meta:[it.route,it.direction].filter(Boolean).join(' • '),small:it.small,large:it.large});});
els.grid.appendChild(card);count++;});
if(!count)els.grid.innerHTML='<div class="empty">No cameras match your filter.</div>';
startAutoRefresh();bustAll();updateMap();dbg('sites:'+cameras.length+' | cards:'+count);}

// Map
function ensureMap(){if(!els.map||typeof L==='undefined')return false;if(map)return true;map=L.map(els.map,{zoomControl:true}).setView([41.6528,-83.5379],11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
markerLayer=L.layerGroup().addTo(map);if(typeof L.markerClusterGroup==='function')clusterLayer=L.markerClusterGroup();
if(els.toggleMap)els.toggleMap.addEventListener('click',function(){var hidden=els.mapWrap&&els.mapWrap.style.display==='none';if(els.mapWrap)els.mapWrap.style.display=hidden?'':'none';if(els.toggleMap)els.toggleMap.textContent=hidden?'Hide Map':'Show Map';setTimeout(function(){if(map)map.invalidateSize();},150);});
if(els.fitMap)els.fitMap.addEventListener('click',fitMapToMarkers);if(els.clusterToggle)els.clusterToggle.addEventListener('change',updateMap);return true;}
function updateMap(){if(!ensureMap())return;markerLayer.clearLayers();if(clusterLayer&&clusterLayer.clearLayers)clusterLayer.clearLayers();
var useCluster=!!(els.clusterToggle&&els.clusterToggle.checked&&clusterLayer);var target=useCluster?clusterLayer:markerLayer;
var cards=Array.from(els.grid.querySelectorAll('.card'));var added=0;
cards.forEach(function(card){var cid=card.getAttribute('data-camid');var cam=null,idx=-1;for(var i=0;i<cameras.length;i++){if(cameraId(cameras[i],i)===cid){cam=cameras[i];idx=i;break;}}if(!cam)return;var lat=extractLat(cam),lon=extractLon(cam);if(typeof lat!=='number'||typeof lon!=='number')return;
var m=L.marker([lat,lon]);m.bindPopup('<strong>'+escapeHTML(getLocation(cam)||'Camera')+'</strong>');m.on('click',function(){var key=card.getAttribute('data-key');scrollToCardByKey(key);highlightCardByKey(key);});target.addLayer(m);markerByCamId.set(cid,m);added++;});
if(useCluster&&!map.hasLayer(clusterLayer))clusterLayer.addTo(map);if(!useCluster&&!map.hasLayer(markerLayer))markerLayer.addTo(map);
if(useCluster&&map.hasLayer(markerLayer))map.removeLayer(markerLayer);if(!useCluster&&clusterLayer&&map.hasLayer(clusterLayer))map.removeLayer(clusterLayer);
fitMapToMarkers();dbg((document.getElementById('dbgmsg').textContent||'')+' | pins:'+added);}
function fitMapToMarkers(){if(!map)return;if(els.clusterToggle&&els.clusterToggle.checked&&clusterLayer){var cl=clusterLayer.getLayers();if(cl&&cl.length){var g=L.featureGroup(cl);map.fitBounds(g.getBounds().pad(0.15));return;}}var layers=[];if(markerLayer&&markerLayer._layers){for(var k in markerLayer._layers)layers.push(markerLayer._layers[k]);}
if(!layers.length){map.setView([41.6528,-83.5379],11);return;}var g2=L.featureGroup(layers);map.fitBounds(g2.getBounds().pad(0.15));}
function scrollToCardByKey(key){var card=els.grid.querySelector('.card[data-key="'+CSS.escape(key)+'"]');if(!card)return;card.scrollIntoView({behavior:'smooth',block:'center'});}
function highlightCardByKey(key){var card=els.grid.querySelector('.card[data-key="'+CSS.escape(key)+'"]');if(!card)return;card.style.outline='2px solid #5aa7ff';setTimeout(function(){card.style.outline='';},1200);}

// Size & refresh
function applySizeToImg(img){if(!img)return;var wantLarge=(els.imgSize&&els.imgSize.value==='LargeUrl');var base=wantLarge?(img.dataset.large||img.dataset.small):(img.dataset.small||img.dataset.large);if(base){img.setAttribute('data-base',base);img.src=cacheBust(base);}else{img.removeAttribute('data-base');}}
function applySizeToAll(){Array.prototype.forEach.call(document.querySelectorAll('.figure img'),applySizeToImg);bustAll();}
function bustAll(){Array.prototype.forEach.call(document.querySelectorAll('.figure img'),function(img){var base=img.getAttribute('data-base');if(!base)return;img.src=cacheBust(base);});}
function startAutoRefresh(){stopAutoRefresh();var s=parseInt(els.interval&&els.interval.value,10)||10;timer=setInterval(bustAll,s*1000);}
function stopAutoRefresh(){if(timer){clearInterval(timer);timer=null;}}

// Lightbox
function openLightbox(o){var big=o.large||o.small;if(!big||!els.lb)return;els.lbTitle.textContent=o.title||'';els.lbMeta.textContent=o.meta||'';els.lbImg.src=cacheBust(big);els.lbImg.alt=(o.title?o.title+' — ':'')+(o.meta||'');els.lb.removeAttribute('hidden');}
function closeLightbox(){if(!els.lb)return;els.lb.setAttribute('hidden','');els.lbImg.src='';}

// Incidents
function normalizeIncidents(r){if(!r)return[];if(Array.isArray(r))return r;if(Array.isArray(r.Results))return r.Results;if(Array.isArray(r.items))return r.items;if(Array.isArray(r.data))return r.data;if(Array.isArray(r.results))return r.results;return[];}
function extractIncLat(it){return it.Latitude||it.latitude||it.LocationLat||it.locationLat||it.lat||null;}
function extractIncLon(it){return it.Longitude||it.longitude||it.LocationLon||it.locationLon||it.lon||it.lng||null;}
function incTitle(it){return it.Title||it.title||it.Event||it.event||it.Description||it.description||'Incident';}
function incRoadway(it){return it.MainRoute||it.mainRoute||it.Roadway||it.Road||it.Route||'';}
function incDirection(it){return it.Direction||it.direction||'';}
function incUpdated(it){return it.LastUpdated||it.Updated||it.UpdateTime||it.End||it.lastUpdated||'';}
function distKm(a,b,c,d){function R(x){return x*Math.PI/180}var C=6371;var dLat=R(c-a),dLon=R(d-b);var v=Math.sin(dLat/2)**2+Math.cos(R(a))*Math.cos(R(c))*Math.sin(dLon/2)**2;return 2*C*Math.atan2(Math.sqrt(v),Math.sqrt(1-v));}
function findNearestCamera(lat,lon){var best=null;for(var i=0;i<cameras.length;i++){var cam=cameras[i],clat=extractLat(cam),clon=extractLon(cam);if(typeof clat!=='number'||typeof clon!=='number')continue;var d=distKm(lat,lon,clat,clon);if(!best||d<best.distanceKm)best={cam:cam,idx:i,distanceKm:d};}return best;}
function fetchIncidents(){var key=getKey();if(!key)return;var base='https://publicapi.ohgo.com/api/v1/incidents?region=toledo&page-all=true';var tries=[{url:base+'&api-key='+encodeURIComponent(key),opts:{}},{url:base,opts:{headers:{'Authorization':'APIKEY '+key}}},{url:base,opts:{headers:{'authorization':'APIKEY '+key}}}],i=0;(function next(){if(i>=tries.length){renderIncidents([],'Failed to load incidents');return;}var t=tries[i++];fetchJSON(t.url,t.opts).then(function(d){var arr=normalizeIncidents(d);incidents=arr.filter(function(it){var la=extractIncLat(it),lo=extractIncLon(it);return la!=null&&lo!=null;});renderIncidents(incidents);}).catch(function(){next();})();})();}
function renderIncidents(list,errMsg){if(!els.incidentsList)return;if(errMsg){els.incidentsList.innerHTML='<div class="incidents-empty">'+escapeHTML(errMsg)+'</div>';if(els.incidentsCount)els.incidentsCount.textContent='—';return;}
if(!Array.isArray(list)||!list.length){els.incidentsList.innerHTML='<div class="incidents-empty">No active incidents reported for Toledo region.</div>';if(els.incidentsCount)els.incidentsCount.textContent='(0)';return;}
if(els.incidentsCount)els.incidentsCount.textContent='('+list.length+')';
var frag=document.createDocumentFragment();
list.forEach(function(it,idx){var title=incTitle(it),road=incRoadway(it),dir=incDirection(it),upd=incUpdated(it),lat=extractIncLat(it),lon=extractIncLon(it),near=(typeof lat==='number'&&typeof lon==='number')?findNearestCamera(lat,lon):null;
var el=document.createElement('div');el.className='incident';
el.innerHTML='<h4>'+escapeHTML(title)+'</h4><div class="meta">'+escapeHTML([road,dir].filter(Boolean).join(' • '))+'</div><div class="meta">Updated: '+escapeHTML(upd?new Date(upd).toLocaleString():'—')+'</div><div class="actions">'+(near?'<button class="incident-jump" data-idx="'+idx+'">Nearest camera</button>':'')+(typeof lat==='number'&&typeof lon==='number'?'<button class="incident-map" data-lat="'+lat+'" data-lon="'+lon+'">Show on map</button>':'')+'</div>';
el.addEventListener('click',function(e){if(e.target&&e.target.classList.contains('incident-jump')&&near){var cid=cameraId(near.cam,near.idx);var card=els.grid.querySelector('.card[data-camid="'+CSS.escape(cid)+'"]');if(card){card.scrollIntoView({behavior:'smooth',block:'center'});card.style.outline='2px solid #5aa7ff';setTimeout(function(){card.style.outline='';},1200);}if(map){var m=markerByCamId.get(cid);if(m){map.setView(m.getLatLng(),Math.max(map.getZoom(),13),{animate:true});m.openPopup();}}}
if(e.target&&e.target.classList.contains('incident-map')&&map){var la=parseFloat(e.target.getAttribute('data-lat')),lo=parseFloat(e.target.getAttribute('data-lon'));if(isFinite(la)&&isFinite(lo))map.setView([la,lo],13,{animate:true});}});
frag.appendChild(el);});
els.incidentsList.innerHTML='';els.incidentsList.appendChild(frag);}

// Wallboard
function startWallboard(){document.documentElement.classList.add('wallboard');stopWallboard();var sec=Math.max(5,parseInt(els.cycleSeconds&&els.cycleSeconds.value||'10',10));wallboardTimer=setInterval(function(){var cards=Array.prototype.slice.call(els.grid.querySelectorAll('.card'));if(!cards.length)return;var idx=Math.floor((Date.now()/1000/sec)%cards.length);cards[idx].click();},sec*1000);}
function stopWallboard(){document.documentElement.classList.remove('wallboard');if(wallboardTimer)clearInterval(wallboardTimer);wallboardTimer=null;}

// Wire up
if(els.saveKey)els.saveKey.addEventListener('click',function(){setKey(els.apiKey.value.trim());fetchCameras();});
if(els.interval)els.interval.addEventListener('change',startAutoRefresh);
if(els.imgSize)els.imgSize.addEventListener('change',applySizeToAll);
if(els.search)els.search.addEventListener('input',render);
if(els.refreshNow)els.refreshNow.addEventListener('click',bustAll);
if(els.sortBy)els.sortBy.addEventListener('change',render);
if(els.wallboardToggle)els.wallboardToggle.addEventListener('change',function(){var on=!!els.wallboardToggle.checked;if(els.cycleWrap)els.cycleWrap.style.display=on?'':'none';if(on)startWallboard();else stopWallboard();});
if(els.cycleSeconds)els.cycleSeconds.addEventListener('change',function(){if(els.wallboardToggle&&els.wallboardToggle.checked)startWallboard();});
if(els.lbBackdrop)els.lbBackdrop.addEventListener('click',closeLightbox);
if(els.lbClose)els.lbClose.addEventListener('click',closeLightbox);
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&els.lb&&!els.lb.hasAttribute('hidden'))closeLightbox();});
if(els.incidentsRefresh)els.incidentsRefresh.addEventListener('click',fetchIncidents);

// Init
if(els.apiKey)els.apiKey.value=getKey();
if(getKey())fetchCameras();else status('Enter your OHGO API key above, then press Save.');