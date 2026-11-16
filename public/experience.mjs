import { sceneDescriptions } from './scenes.mjs';

const databaseName = 'ram-counter-personal-v1';
const syncKey = databaseName + '.change';

export function freshExperience() {
  return { epoch: 0, revision: 0, scene: 1, realGifts: 0, virtualGifts: 0, donatedBytes: 0 };
}

export function sceneFor(state) {
  // The original 30-scene edition recorded gifts made after its final photo.
  // Resume at the photo the visitor actually saw, including for those older ledgers.
  const lastSeen = state.scene ?? Math.min(30, 1 + state.realGifts + state.virtualGifts);
  return Math.min(sceneDescriptions.length, lastSeen);
}

export function updateExperience(previous, action) {
  if (action.type === 'reset') {
    return { ...freshExperience(), epoch: previous.epoch + 1, revision: previous.revision + 1 };
  }
  // A queued click from another tab must not resurrect a gift after a reset.
  if (action.epoch !== previous.epoch) return previous;
  return {
    ...previous,
    revision: previous.revision + 1,
    scene: Math.min(sceneDescriptions.length, sceneFor(previous) + 1),
    realGifts: previous.realGifts + (action.type === 'actual' ? 1 : 0),
    virtualGifts: previous.virtualGifts + (action.type === 'virtual' ? 1 : 0),
    donatedBytes: previous.donatedBytes + (action.bytes || 0)
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('counter');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction(db, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('counter', action ? 'readwrite' : 'readonly');
    const store = tx.objectStore('counter');
    const read = store.get('mine');
    let state;
    read.onsuccess = () => {
      const before = read.result ?? freshExperience();
      state = action ? updateExperience(before, action) : before;
      if (state !== before) store.put(state, 'mine');
    };
    tx.oncomplete = () => resolve(state);
    tx.onabort = () => reject(tx.error ?? new Error('기록을 저장하지 못했습니다.'));
  });
}

// Each browser profile owns its ledger. IndexedDB serializes gifts and resets across tabs.
export async function openExperience(onChange) {
  let db = await openDatabase().catch(() => null);
  let local = freshExperience();
  let channel;
  try { channel = new BroadcastChannel(databaseName); } catch { /* storage events also sync tabs */ }
  async function access(action) {
    if (db) {
      try {
        local = await transaction(db, action);
        return local;
      } catch {
        db.close();
        db = null;
      }
    }
    function fallback() {
      try {
        const saved = JSON.parse(localStorage.getItem(databaseName));
        if (saved && saved.revision >= local.revision) local = saved;
      } catch { /* In-memory experience when storage is unavailable. */ }
      if (action) {
        local = updateExperience(local, action);
        try { localStorage.setItem(databaseName, JSON.stringify(local)); } catch { /* Memory only. */ }
      }
      return local;
    }
    return navigator.locks?.request ? navigator.locks.request(databaseName, fallback).catch(fallback) : fallback();
  }
  async function refresh() { onChange(await access()); }
  if (channel) channel.onmessage = event => {
    if (!db && event.data?.revision > local.revision) local = event.data;
    refresh();
  };
  window.addEventListener('storage', event => { if (event.key === syncKey) refresh(); });
  await refresh();
  return {
    refresh,
    async change(action) {
      const next = await access(action);
      onChange(next);
      try { channel?.postMessage(next); } catch { /* Use storage notification. */ }
      try { localStorage.setItem(syncKey, String(next.revision)); } catch { /* Private storage. */ }
      return next;
    }
  };
}
