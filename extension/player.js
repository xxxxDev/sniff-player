import { t } from './lib/i18n.js';
import { displayName, refererHeaders } from './lib/media.js';

// The player tab. What to play comes in its address, from the extension's own list. Pages can't
// open this page or frame it.
const params = new URLSearchParams(location.search);
const src = window === window.top ? params.get('src') || '' : '';
const referer = params.get('ref');
const kind = params.get('kind');

document.documentElement.lang = chrome.i18n.getUILanguage();
const name = params.get('title') || displayName(src);
document.title = name;
const ui = SniffPlayerUI.create({
  root: document.body,
  t,
  title: name,
  src,
  keyTarget: document,
  fullscreenTarget: document.documentElement,
  onRetry: () => location.reload(),
  isTab: true,
});
const { video, showError } = ui;

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
    SniffPlayerUI.offerQualities(ui, hls);
    ui.startPlaying();
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
        showError(...SniffPlayerUI.networkMessage(t, data.response.code));
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
    // A host's answer (an expired link's 410, a 404) is the site's, shown in the player only; it
    // isn't an error of the extension's.
    if (!data.response?.code) console.warn('Sniff Player', data.type, data.details);
    showError(...SniffPlayerUI.hlsErrorMessage(t, data));
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
  ui.startPlaying();
}

// The request rules of this player tab. They match only requests from the extension itself, so
// they stop applying when the tab later moves on to another site.
async function applyRequestRules() {
  const tabId = (await chrome.tabs.getCurrent())?.id;
  if (tabId === undefined) throw new Error('no tab'); // Without rules, don't play.
  const condition = {
    tabIds: [tabId],
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
    removeRuleIds: existing.filter((rule) => rule.condition.tabIds?.includes(tabId)).map((rule) => rule.id),
    addRules,
  });
}

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
    if (kind === 'file') startDirect();
    else if (Hls.isSupported()) startHls();
    else if (video.canPlayType('application/vnd.apple.mpegurl')) startDirect();
    else showError(t('errBrowserTitle'), t('errBrowserDetail'));
  }
}
