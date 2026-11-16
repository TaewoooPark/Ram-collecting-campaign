import { sceneDescriptions } from './scenes.mjs';
import { Donation, holdingLimit, megabyte } from './campaign.mjs';
import { freshExperience, sceneFor, openExperience } from './experience.mjs';

const get = id => document.getElementById(id);
const photo = get('photograph');
const receipt = get('receipt');
const weigh = get('weigh');
const account = new Donation();
const portable = matchMedia('(max-aspect-ratio: 4/5)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let ledger, history = freshExperience(), scene = 1, resetting = false;
let renderPass = 0, painting = false, preload = null, fade = null, retryPhoto, noticeTimer;

function sceneURL(number) {
  return './scenes/' + String(number).padStart(2, '0') + (portable.matches ? '-p' : '') + '.webp';
}
function loadPhoto(url) {
  const image = new Image();
  image.alt = '';
  image.decoding = 'async';
  image.src = url;
  return image;
}
function show(number, interrupt = false) {
  if (interrupt || number < scene) {
    renderPass++;
    fade?.cancel();
    fade = null;
    photo.lastElementChild?.previousElementSibling?.remove();
    painting = false;
  }
  scene = number;
  clearTimeout(retryPhoto);
  if (!painting && !document.hidden) paintScenes(renderPass);
}
async function paintScenes(pass) {
  painting = true;
  try {
    while (pass === renderPass && !document.hidden) {
      const old = photo.lastElementChild;
      const current = Number(photo.dataset.frame);
      // Load a saved visit directly. During a visit, show every intermediate gift in sequence.
      const number = old && current < scene ? current + 1 : scene;
      const url = sceneURL(number);
      if (old?.getAttribute('src') === url) break;
      const image = preload?.getAttribute('src') === url ? preload : loadPhoto(url);
      preload = null;
      try { await image.decode(); } catch {
        if (pass === renderPass) {
          if (!old) announce('사진을 불러오고 있습니다.');
          retryPhoto = setTimeout(() => show(scene), 2500);
        }
        break;
      }
      if (pass !== renderPass || document.hidden) break;
      for (const layer of [...photo.children]) if (layer !== old) layer.remove();
      image.dataset.frame = String(number);
      photo.append(image);
      photo.setAttribute('aria-label', sceneDescriptions[number - 1]);
      photo.dataset.frame = String(number);
      if (number < sceneDescriptions.length) preload = loadPhoto(sceneURL(number + 1));
      if (old && number !== 1 && !reducedMotion.matches) {
        const duration = Math.max(240, 720 / (1 + scene - number));
        fade = image.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'ease-in-out' });
        await fade.finished.catch(() => {}); // Reset or rotation can interrupt a dissolve.
        if (pass !== renderPass) break;
        fade = null;
      }
      old?.remove();
    }
  } finally {
    if (pass === renderPass) painting = false;
  }
}
function announce(text) {
  clearTimeout(noticeTimer);
  get('announcement').textContent = text;
  if (text) noticeTimer = setTimeout(() => { get('announcement').textContent = ''; }, 3800);
}
function applyHistory(next) {
  if (resetting || next.revision < history.revision) return;
  if (next.epoch !== history.epoch) clearCounter();
  history = next;
  const count = history.virtualGifts;
  get('virtual-count').textContent = count ? ' · ' + count.toLocaleString('ko-KR') + '회' : '';
  show(sceneFor(history));
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
  ledger.change({type, bytes, epoch: history.epoch}).catch(() => announce('이 브라우저에 접수를 기록하지 못했습니다.'));
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
  if (!resetting && !receipt.open && !document.hidden) record('virtual', 0);
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
    const clean = await ledger.change({type: 'reset'});
    resetting = false;
    applyHistory(clean);
    announce('처음으로 돌아왔습니다.');
  } catch {
    announce('램을 돌려드렸습니다. 기록 초기화를 다시 눌러 주세요.');
  } finally { resetting = false; }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) release(false);
  else { show(scene); ledger?.refresh(); }
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
