// background.js (service worker - MV3)
// Tracks active tab time and aggregates usage in chrome.storage.local,
// then periodically POSTs aggregated usage to the backend.

const BACKEND_URL = 'http://localhost:3000/api/usage';
const DEFAULT_PRODUCTIVE = ["github.com","stackoverflow.com","gitlab.com","replit.com","stackblitz.com"];
const DEFAULT_UNPRODUCTIVE = ["facebook.com","instagram.com","twitter.com","reddit.com","youtube.com","tiktok.com"];

function storageGet(keys){ return new Promise(resolve => chrome.storage.local.get(keys, resolve)); }
function storageSet(obj){ return new Promise(resolve => chrome.storage.local.set(obj, resolve)); }

function getTodayKey(){
  return new Date().toISOString().slice(0,10);
}

function getDomainFromUrl(url){
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./,'');
  } catch(e){
    return 'unknown';
  }
}

async function ensureDefaults(){
  const data = await storageGet(['userId','usage','productiveList','unproductiveList','current']);
  if(!data.userId){
    const uid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : ('uid-'+Date.now()+'-'+Math.random().toString(36).slice(2,8));
    await storageSet({userId: uid});
  }
  if(!data.productiveList) await storageSet({productiveList: DEFAULT_PRODUCTIVE});
  if(!data.unproductiveList) await storageSet({unproductiveList: DEFAULT_UNPRODUCTIVE});
  if(!data.usage) await storageSet({usage: {}});
  if(!data.current) await storageSet({current: null});
}

// Stop current tracking and record elapsed time (in seconds)
async function stopAndRecord(){
  const data = await storageGet(['current','usage']);
  const current = data.current;
  let usage = data.usage || {};
  if(current && current.domain && current.startTime){
    const now = Date.now();
    const elapsedMs = now - current.startTime;
    const secs = Math.round(elapsedMs/1000);
    const dateKey = getTodayKey();
    usage[dateKey] = usage[dateKey] || {};
    usage[dateKey][current.domain] = (usage[dateKey][current.domain] || 0) + secs;
    await storageSet({usage});
  }
  // clear current
  await storageSet({current: null});
}

async function startTracking(tab){
  if(!tab || !tab.url) return;
  const domain = getDomainFromUrl(tab.url);
  const current = {tabId: tab.id, domain, startTime: Date.now()};
  await storageSet({current});
}

// Helper to get the active tab object (last focused window)
function queryActiveTab(){
  return new Promise(resolve => {
    chrome.tabs.query({active:true, lastFocusedWindow:true}, function(tabs){
      resolve(tabs && tabs[0]);
    });
  });
}

async function handleTabChange(newTab){
  if(!newTab) return;
  const data = await storageGet(['current']);
  const current = data.current;
  const newDomain = getDomainFromUrl(newTab.url || '');
  if(current && current.domain === newDomain && current.tabId === newTab.id){
    // same tab/domain - nothing to do
    return;
  }
  // stop previous
  await stopAndRecord();
  // start new
  await startTracking(newTab);
}

// Periodically flush usage to backend
async function flushToBackend(){
  const data = await storageGet(['usage','userId']);
  const usage = data.usage || {};
  const userId = data.userId;
  if(!userId) return;
  // if there's nothing to send, skip
  const hasData = Object.keys(usage).length > 0;
  if(!hasData) return;
  try {
    const resp = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({userId, usage})
    });
    if(resp.ok){
      // on success, clear usage to avoid duplicate uploads
      await storageSet({usage: {}});
      console.log('Flush to backend successful');
    } else {
      console.warn('Backend flush failed', resp.status);
    }
  } catch(e){
    console.warn('Error flushing to backend', e);
  }
}

// Listeners
chrome.runtime.onInstalled.addListener(async ()=>{
  await ensureDefaults();
  chrome.alarms.create('flush', {periodInMinutes: 5});
  // start tracking current active tab
  const tab = await queryActiveTab();
  if(tab) startTracking(tab);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if(alarm && alarm.name === 'flush') await flushToBackend();
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await new Promise(resolve => chrome.tabs.get(activeInfo.tabId, resolve));
    await handleTabChange(tab);
  } catch(e){
    console.warn('onActivated error', e);
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if(windowId === chrome.windows.WINDOW_ID_NONE){
    // window lost focus (user switched away) - stop recording
    await stopAndRecord();
  } else {
    // gained focus - start tracking active tab
    const tab = await queryActiveTab();
    if(tab) await handleTabChange(tab);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // if the active tab URL changed, treat as domain change
  const active = await queryActiveTab();
  if(active && active.id === tabId && changeInfo.url){
    await handleTabChange(tab);
  }
});

// Expose a message listener for popup to request sync / get state
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if(msg && msg.type === 'SYNC_NOW'){
    flushToBackend().then(()=> sendResponse({status:'ok'}));
    return true; // indicates async response
  }
  if(msg && msg.type === 'GET_STATE'){
    storageGet(['userId','usage','productiveList','unproductiveList','current']).then(data => sendResponse({ok:true, data}));
    return true;
  }
});