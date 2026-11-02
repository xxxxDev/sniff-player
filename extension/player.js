import { localizePage, t } from './lib/i18n.js';
import { displayName, levelLabel, refererHeaders } from './lib/media.js';

localizePage();

const params = new URLSearchParams(location.search);
const src = params.get('src') || '';
const referer = params.get('ref');
const pageTitle = params.get('title');

const video = document.getElementById('video');
const qualityBox = document.getElementById('quality-box');
const quality = document.getElementById('quality');
const AUTO = '-1';

const name = pageTitle || displayName(src);
document.title = name;
const titleElement = document.getElementById('title');
titleElement.textContent = name;
titleElement.title = src;

function showError(title, detail) {
  document.getElementById('error-title').textContent = title;
  document.getElementById('error-detail').textContent = detail;
  document.getElementById('error').hidden = false;
  document.body.classList.remove('idle');
}

function networkMessage(code) {
  if (code === 401 || code === 403) return [t('errRefusedTitle', code), t('errRefusedDetail')];
  if (code === 410) return [t('errExpiredTitle'), t('errExpiredDetail')];
  if (code === 404) return [t('errNotFoundTitle'), t('errNotFoundDetail')];
  if (code) return [t('errServerTitle', code), t('errServerDetail')];
  return [t('errOfflineTitle'), t('errOfflineDetail')];
}

function setupQuality(hls) {
  if (hls.levels.length < 2) return;
  const options = hls.levels
    .map((level, index) => ({
      index,
      label: levelLabel({ height: level.height, frameRate: Number(level.attrs?.['FRAME-RATE']), bitrate: level.bitrate }),
      height: level.height || 0,
      bitrate: level.bitrate,
    }))
    .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate)
    .map(({ index, label }) => new Option(label, index));
  quality.replaceChildren(new Option(t('auto'), AUTO), ...options);
  qualityBox.hidden = false;
  quality.addEventListener('change', () => {
    hls.currentLevel = Number(quality.value);
  });
  hls.on(Hls.Events.LEVEL_SWITCHED, (_event, { level }) => {
    const current = hls.levels[level];
    quality.options[0].textContent = current?.height
      ? t('autoLevel', levelLabel({ height: current.height, frameRate: Number(current.attrs?.['FRAME-RATE']), bitrate: current.bitrate }))
      : t('auto');
  });
}

const MAX_REFERER_HOSTS = 10;
const refererHosts = new Set();

// When a host answers 401 or 403, send the page's origin to that host and restart from the current
// position, once per host. It can't be sent to everyone from the start: some CDNs refuse requests
// that carry another site's origin.
function hostToRetry(data) {
  if (!referer || ![401, 403].includes(data.response?.code)) return null;
  let host;
  try {
    host = new URL(data.url || data.context?.url || data.frag?.url).hostname;
  } catch {
    return null;
  }
  return refererHosts.has(host) || refererHosts.size >= MAX_REFERER_HOSTS ? null : host;
}

function startHls(startPosition = -1) {
  const hls = new Hls({ workerPath: 'vendor/hls.worker.js', startPosition });
  let mediaRecoveries = 0;
  let restarting = false;
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    setupQuality(hls);
    video.play().catch(() => {});
  });
  hls.on(Hls.Events.ERROR, async (_event, data) => {
    if (restarting) return;
    const host = hostToRetry(data);
    if (host) {
      restarting = true;
      refererHosts.add(host);
      const position = video.currentTime > 0 ? video.currentTime : startPosition;
      hls.destroy();
      try {
        await applyRequestRules();
        startHls(position);
      } catch (error) {
        console.warn('Sniff Player: could not set the request rules', error);
        showError(...networkMessage(data.response.code));
      }
      return;
    }
    if (!data.fatal) return;
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
      mediaRecoveries += 1;
      hls.recoverMediaError();
      return;
    }
    hls.destroy();
    console.warn('Sniff Player', data.type, data.details);
    if (data.type === Hls.ErrorTypes.KEY_SYSTEM_ERROR || /^key/i.test(data.details)) {
      showError(t('errDrmTitle'), t('errDrmDetail'));
    } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      showError(...networkMessage(data.response?.code));
    } else {
      showError(t('errPlayTitle'), data.details || t('errDecodeDetail'));
    }
  });
  hls.loadSource(src);
  hls.attachMedia(video);
}

// Video files, and HLS in browsers that play it natively, go straight to the video element. The
// browser doesn't report the HTTP status, so the first failure retries with the page's origin.
function startDirect() {
  let retried = false;
  video.addEventListener('error', async () => {
    if (!retried && refererHeaders(referer).length) {
      retried = true;
      refererHosts.add(new URL(src).hostname);
      const position = video.currentTime;
      try {
        await applyRequestRules();
        video.src = src;
        video.currentTime = position;
        video.play().catch(() => {});
        return;
      } catch (error) {
        console.warn('Sniff Player: could not set the request rules', error);
      }
    }
    showError(t('errPlayTitle'), t('errFileDetail'));
  });
  video.src = src;
  video.play().catch(() => {});
}

// The request rules of this player tab. They match only requests from the extension itself, so
// they stop applying when the tab later moves on to another site.
async function applyRequestRules() {
  const tab = await chrome.tabs.getCurrent();
  if (!tab) return;
  const condition = {
    tabIds: [tab.id],
    initiatorDomains: [chrome.runtime.id],
    resourceTypes: ['xmlhttprequest', 'media'],
  };
  // Rule 1 belongs to the background worker. Random ids keep several player tabs from colliding.
  const newRuleId = () => 2 + Math.floor(Math.random() * 2_000_000_000);
  const addRules = [{
    // Requests from an extension carry cookies by default. Keep them for the video's host and its
    // subdomains only, so that a playlist can't send your cookies anywhere it likes, or have
    // another site set cookies on you.
    id: newRuleId(),
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'Cookie', operation: 'remove' }],
      responseHeaders: [{ header: 'Set-Cookie', operation: 'remove' }],
    },
    condition: { ...condition, excludedRequestDomains: [new URL(src).hostname] },
  }, {
    // Without this rule each request names the extension's id, which any site could collect.
    id: newRuleId(),
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Origin', operation: 'remove' }] },
    condition,
  }];
  const headers = refererHeaders(referer);
  if (headers.length && refererHosts.size) {
    // Send the page's origin only to the hosts that refused a request without it.
    addRules.push({
      id: newRuleId(),
      priority: 2, // Wins over removing Origin above.
      action: { type: 'modifyHeaders', requestHeaders: headers },
      condition: { ...condition, requestDomains: [...refererHosts] },
    });
  }
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: existing.filter((rule) => rule.condition.tabIds?.includes(tab.id)).map((rule) => rule.id),
    addRules,
  });
}

document.getElementById('speed').addEventListener('change', (event) => {
  video.playbackRate = Number(event.target.value);
  video.defaultPlaybackRate = video.playbackRate;
});
document.getElementById('retry').addEventListener('click', () => location.reload());
const copyButton = document.getElementById('copy');
copyButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(src);
  copyButton.textContent = t('copied');
  setTimeout(() => { copyButton.textContent = t('copyUrl'); }, 1200);
});

// Hide the toolbar while the video plays and the mouse is still.
let idleTimer;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!video.paused && document.getElementById('error').hidden) {
      document.body.classList.add('idle');
    }
  }, 2500);
}
document.addEventListener('mousemove', wake);
video.addEventListener('pause', wake);
wake();

document.addEventListener('keydown', (event) => {
  if (event.target.closest('select, button') || event.metaKey || event.ctrlKey || event.altKey) return;
  const actions = {
    ' ': () => (video.paused ? video.play().catch(() => {}) : video.pause()),
    k: () => (video.paused ? video.play().catch(() => {}) : video.pause()),
    ArrowLeft: () => { video.currentTime -= 5; },
    ArrowRight: () => { video.currentTime += 5; },
    m: () => { video.muted = !video.muted; },
    f: () => (document.fullscreenElement ? document.exitFullscreen() : video.requestFullscreen()),
  };
  const action = actions[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  if (!action) return;
  event.preventDefault();
  action();
});

let valid = false;
try {
  valid = ['http:', 'https:'].includes(new URL(src).protocol);
} catch {
  // Reported just below.
}
if (!valid) {
  showError(t('errUrlTitle'), t('errUrlDetail'));
} else {
  let protectedRequests = true;
  try {
    await applyRequestRules();
  } catch (error) {
    // Without the rules a playlist could send your cookies anywhere, so don't play.
    protectedRequests = false;
    console.warn('Sniff Player: could not set the request rules', error);
    showError(t('errPlayTitle'), t('errRulesDetail'));
  }
  if (protectedRequests) {
    if (params.get('kind') === 'file') startDirect();
    else if (Hls.isSupported()) startHls();
    else if (video.canPlayType('application/vnd.apple.mpegurl')) startDirect();
    else showError(t('errBrowserTitle'), t('errBrowserDetail'));
  }
}
