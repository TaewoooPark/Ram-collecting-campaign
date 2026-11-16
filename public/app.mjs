import { sceneDescriptions } from './scenes.mjs';
import { Donation, holdingLimit, megabyte } from './campaign.mjs';
import { freshExperience, sceneFor, openExperience } from './experience.mjs';

const get = id => document.getElementById(id);
const photo = get('photograph');
const receipt = get('receipt');
const weigh = get('weigh');
const account = new Donation();
const portable = matchMedia('(max-aspect-ratio: 4/5)');
const originals = new Map();
const previewPacks = new Map();
let ledger, history = freshExperience(), scene = 1, resetting = false, resetCommit, pendingGifts = 0;
let view = 0, targetURL = '', retryPhoto, noticeTimer;

function sceneFile(number) {
  return String(number).padStart(2, '0') + (portable.matches ? '-p' : '');
}
function original(url) {
  if (originals.has(url)) return originals.get(url);
  const image = new Image();
  image.alt = '';
  image.src = url;
  const entry = { image, ready: false };
  entry.decoded = image.decode().then(() => entry.ready = true, () => {
    if (originals.get(url) === entry) originals.delete(url);
    return false;
  });
  originals.set(url, entry);
  return entry;
}
function previews(first) {
  const key = sceneFile(first);
  if (!previewPacks.has(key)) {
    const pack = import('./scenes/previews/' + key + '.mjs').then(module => module.default, () => {
      previewPacks.delete(key);
      return null;
    });
    previewPacks.set(key, pack);
  }
  return previewPacks.get(key);
}
function show(number, force = false) {
  scene = number;
  const url = './scenes/' + sceneFile(number) + '.webp';
  if (document.hidden || (!force && targetURL === url)) return;
  targetURL = url;
  clearTimeout(retryPhoto);
  const ticket = ++view;
  const first = number - (number - 1) % 10;
  const pack = previews(first);
  const nextURL = number < sceneDescriptions.length ? './scenes/' + sceneFile(number + 1) + '.webp' : '';
  for (const [cachedURL, entry] of originals) {
    if (cachedURL !== url && cachedURL !== nextURL) {
      if (!entry.ready) entry.image.removeAttribute('src');
      originals.delete(cachedURL);
    }
  }
  function display(image, quality) {
    image.dataset.frame = String(number);
    photo.replaceChildren(image);
    photo.setAttribute('aria-label', sceneDescriptions[number - 1]);
    photo.dataset.frame = String(number);
    photo.dataset.quality = quality;
  }
  function fullReady(image) {
    display(image, 'full');
    if (nextURL) original(nextURL);
  }
  const cached = originals.get(url);
  if (cached?.ready) {
    fullReady(cached.image);
  } else {
    // A tiny copy can paint even if the full-size image is still in transit.
    pack.then(async frames => {
      if (!frames || view !== ticket || document.hidden) return;
      const preview = new Image();
      preview.alt = '';
      preview.src = 'data:image/webp;base64,' + frames[number - first];
      try { await preview.decode(); } catch { return; }
      if (view === ticket && !document.hidden && photo.lastElementChild?.getAttribute('src') !== url) {
        display(preview, 'preview');
      }
    });
    // Synchronous bursts need only the latest original. Paints never queue behind one another.
    requestAnimationFrame(async () => {
      if (view !== ticket || document.hidden) return;
      const entry = original(url);
      const ready = await entry.decoded;
      if (view !== ticket || document.hidden) return;
      if (ready) fullReady(entry.image);
      else retryPhoto = setTimeout(() => show(scene, true), 1500);
    });
  }
  if (number - first >= 5 && first + 10 <= sceneDescriptions.length) previews(first + 10);
}
function announce(text) {
  clearTimeout(noticeTimer);
  get('announcement').textContent = text;
  if (text) noticeTimer = setTimeout(() => { get('announcement').textContent = ''; }, 3800);
}
function applyHistory(next) {
  if (resetting || next.revision < history.revision) return;
  if (next.epoch !== history.epoch) {
    pendingGifts = 0;
    clearCounter();
  }
  history = next;
  const count = history.virtualGifts;
  get('virtual-count').textContent = count ? ' · ' + count.toLocaleString('ko-KR') + '회' : '';
  const savedScene = sceneFor(history);
  show(pendingGifts ? Math.max(scene, savedScene) : savedScene);
}
function clearCounter() {
  account.release();
  if (receipt.open) receipt.close();
  get('form').reset();
  get('error').hidden = true;
  get('returned').hidden = true;
  get('balance').textContent = '';
  get('weigh-label').textContent = '램 달아보기';
  weigh.hidden = false;
  announce('');
}
function record(type, bytes) {
  const epoch = history.epoch;
  pendingGifts++;
  show(Math.min(sceneDescriptions.length, scene + 1));
  ledger.change({type, bytes, epoch})
    .catch(() => announce('이 브라우저에 접수를 기록하지 못했습니다.'))
    .finally(() => {
      if (epoch !== history.epoch) return;
      pendingGifts--;
      if (!pendingGifts && !resetting) applyHistory(history);
    });
}
function release(tell) {
  if (!account.byteLength) return;
  account.release();
  get('returned').hidden = true;
  get('weigh-label').textContent = '다시 달아보기';
  weigh.hidden = false;
  if (receipt.open) updateTerms();
  if (tell) announce('맡긴 램을 모두 돌려드렸습니다.');
}
function updateTerms() {
  const held = account.byteLength / megabyte;
  const selected = Number(new FormData(get('form')).get('amount'));
  const reused = Math.max(0, held + selected - holdingLimit);
  const line = held ? '현재 ' + held + '메가바이트를 맡기셨습니다. ' : '이 창을 보는 동안 선택한 만큼 메모리를 씁니다. ';
  get('terms').textContent = line + (reused
    ? '이번에는 앞서 맡긴 ' + reused + '메가바이트의 공간을 다시 씁니다.'
    : '한 번에 보관하는 램은 ' + holdingLimit + '메가바이트까지입니다.');
}
function openReceipt() {
  if (resetting || receipt.open || document.hidden) return;
  announce('');
  const capacity = navigator.deviceMemory;
  get('device-reading').textContent = Number.isFinite(capacity) && capacity > 0
    ? '장착 램 약 ' + capacity.toLocaleString('ko-KR') + '기가바이트'
    : '이 기기는 램 용량을 알려주지 않습니다.';
  get('error').hidden = true;
  updateTerms();
  receipt.showModal();
  receipt.querySelector('input:checked').focus({preventScroll: true});
}
weigh.addEventListener('click', openReceipt);
get('give-again').addEventListener('click', openReceipt);
get('choices').addEventListener('change', updateTerms);
get('cancel').addEventListener('click', () => receipt.close());
get('form').addEventListener('submit', event => {
  event.preventDefault();
  if (resetting || !receipt.open || document.hidden) return;
  const amount = Number(new FormData(event.currentTarget).get('amount'));
  let bytes;
  try { bytes = account.hold(amount); }
  catch {
    get('error').textContent = '접수할 수 없습니다. 용량을 줄여 다시 골라 주세요.';
    get('error').hidden = false;
    return;
  }
  receipt.close();
  weigh.hidden = true;
  get('balance').textContent = (account.byteLength / megabyte) + '메가바이트';
  get('returned').hidden = false;
  get('give-again').focus({preventScroll: true});
  record('actual', bytes);
  announce(amount + '메가바이트 접수했습니다.');
});
get('virtual').addEventListener('click', () => {
  if (receipt.open || document.hidden) return;
  if (resetCommit) {
    // A click just after the reset belongs to the new visit.
    resetCommit.then(() => record('virtual', 0), () => {});
  } else {
    record('virtual', 0);
  }
});
get('release').addEventListener('click', () => { release(true); weigh.focus({preventScroll: true}); });
get('reset').addEventListener('click', async () => {
  if (resetting || !ledger) return;
  resetting = true;
  clearCounter(); // Release all current-tab buffers before waiting for storage.
  get('virtual-count').textContent = '';
  try {
    sessionStorage.removeItem('ram-bank.progress');
    for (const key of Object.keys(localStorage)) {
      if (key === 'ram-bank.visitor' || key.startsWith('ram-bank.receipt.')) localStorage.removeItem(key);
    }
  } catch { /* Private browsing. */ }
  show(1, true);
  try {
    resetCommit = ledger.change({type: 'reset'});
    const clean = await resetCommit;
    resetting = false;
    applyHistory(clean);
    announce('처음으로 돌아왔습니다.');
  } catch {
    announce('램을 돌려드렸습니다. 기록 초기화를 다시 눌러 주세요.');
  } finally {
    resetting = false;
    resetCommit = null;
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) release(false);
  else { show(scene, true); ledger?.refresh(); }
});
window.addEventListener('pagehide', () => release(false));
window.addEventListener('pageshow', () => ledger?.refresh());
portable.addEventListener('change', () => show(scene, true));
async function start() {
  ledger = await openExperience(applyHistory);
  weigh.hidden = false;
  get('virtual').hidden = false;
  get('reset').hidden = false;
}
start();
