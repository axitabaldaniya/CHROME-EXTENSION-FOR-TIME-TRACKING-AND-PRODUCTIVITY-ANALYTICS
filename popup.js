chrome.storage.local.get(['userId'], (result) => {
  let uid = result.userId || "No User ID found";
  document.body.insertAdjacentHTML("afterbegin", `<p style="color:red; font-weight:bold;">User ID: ${uid}</p>`);
});

function storageGet(keys){ return new Promise(resolve => chrome.storage.local.get(keys, resolve)); }
function storageSet(obj){ return new Promise(resolve => chrome.storage.local.set(obj, resolve)); }
function formatSeconds(s){
  s = Math.round(s || 0);
  const h = Math.floor(s/3600); s %= 3600;
  const m = Math.floor(s/60); const sec = s%60;
  if(h>0) return `${h}h ${m}m`;
  if(m>0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

async function syncNow(){
  // ask background to flush
  return new Promise(resolve => {
    chrome.runtime.sendMessage({type:'SYNC_NOW'}, (resp) => {
      resolve(resp);
    });
  });
}

document.addEventListener('DOMContentLoaded', async ()=>{
  const resp = await new Promise(resolve => chrome.runtime.sendMessage({type:'GET_STATE'}, (r)=>resolve(r)));
  if(!resp || !resp.data) return;
  const {userId, usage, productiveList, unproductiveList} = resp.data;
  const uid = userId || 'unknown';
  const todayKey = new Date().toISOString().slice(0,10);
  const todayData = (usage && usage[todayKey]) || {};
  const prod = productiveList || [];
  const unprod = unproductiveList || [];
  let prodSec=0, unprodSec=0, neutralSec=0;
  const items = [];
  for(const [domain, secs] of Object.entries(todayData)){
    const d = domain.replace(/^www\./,'');
    let cat = 'neutral';
    if(prod.includes(d)) { cat='productive'; prodSec+=secs; }
    else if(unprod.includes(d)) { cat='unproductive'; unprodSec+=secs; }
    else neutralSec+=secs;
    items.push({domain: d, secs, cat});
  }
  const total = prodSec + unprodSec + neutralSec;
  document.getElementById('today').textContent = `User: ${uid} — Today: ${formatSeconds(total)} (Productive ${formatSeconds(prodSec)} / Unproductive ${formatSeconds(unprodSec)})`;
  const sitesList = document.getElementById('sitesList');
  items.sort((a,b)=>b.secs - a.secs);
  items.forEach(it => {
    const li = document.createElement('li');
    li.textContent = `${it.domain} — ${formatSeconds(it.secs)} (${it.cat})`;
    sitesList.appendChild(li);
  });
  document.getElementById('productiveInput').value = (prod || []).join(',');
  document.getElementById('unproductiveInput').value = (unprod || []).join(',');
  document.getElementById('saveLists').addEventListener('click', async () => {
    const p = document.getElementById('productiveInput').value.split(',').map(x=>x.trim()).filter(Boolean);
    const u = document.getElementById('unproductiveInput').value.split(',').map(x=>x.trim()).filter(Boolean);
    await storageSet({productiveList: p, unproductiveList: u});
    alert('Saved lists locally. They will be used going forward.');
  });
  document.getElementById('syncBtn').addEventListener('click', async () => {
    await syncNow();
    alert('Sync started. Check backend server logs or the dashboard.');
  });
});