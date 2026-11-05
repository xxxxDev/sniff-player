import {
  MAX_URL_LENGTH, groupEntries, isHlsResponse, parsePlaylist, refererHeaders, trimToBudget,
  videoFileInfo,
} from './lib/media.js';

const SELF_INITIATOR = `chrome-extension://${chrome.runtime.id}`;
const MAX_ENTRIES = 100;
const MAX_PENDING_PER_TAB = 20;
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5000;
// Rule 1 is for reading playlists here. The player tabs pick random rule ids in player.js.
const INSPECT_RULE_ID = 1;

const tabKey = (tabId) => `tab:${tabId}`;

// The list lives in storage.session. The browser can stop this worker at any time, so memory can't
// be trusted, and the list never reaches the disk, so its URLs don't outlive the browser.
// Read-modify-write queues up per tab, or two URLs found at once would overwrite each other.
const tabLocks = new Map();
function updateTab(tabId, change) {
  const run = async () => {
    const key = tabKey(tabId);
    const stored = (await chrome.storage.session.get(key))[key] || [];
    const entries = trimToBudget(change(stored));
    if (entries.length) await chrome.storage.session.set({ [key]: entries });
    else await chrome.storage.session.remove(key);
    await showCount(tabId, entries);
  };
  const next = (tabLocks.get(tabId) || Promise.resolve()).then(run, run);
  tabLocks.set(tabId, next);
  return next.catch((error) => console.warn('Sniff Player', error));
}

async function showCount(tabId, entries) {
  const count = groupEntries(entries).length;
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#161616', tabId });
    await chrome.action.setBadgeText({ text: count ? String(count) : '', tabId });
  } catch {
    // The tab has already closed.
  }
}

// URLs already on a tab's list, and when each was last seen. A page polling a playlist, or looping
// on one on purpose, then costs no storage work and doesn't reorder the list. The time matters
// after a reload: the response can arrive before the navigation event that clears the old page.
const seenByTab = new Map();
const MAX_SEEN_PER_TAB = 500;

async function record(tabId, found, frameId = null) {
  const seen = seenByTab.get(tabId) || new Map();
  seenByTab.set(tabId, seen);
  if (seen.has(found.url)) {
    seen.set(found.url, found.time);
    return;
  }
  if (seen.size < MAX_SEEN_PER_TAB) seen.set(found.url, found.time);
  let added = false;
  await updateTab(tabId, (entries) => {
    if (entries.some((entry) => entry.url === found.url)) return entries;
    added = true;
    return [...entries, found].slice(-MAX_ENTRIES);
  });
  if (added && found.kind !== 'file') inspect(tabId, found);
  if (added && frameId !== null) maybeEmbed(tabId, frameId, found);
}

// A request from a page's service worker has no tab, so match it back by origin. With several
// tabs on that origin, pick the one in view. With none, drop it rather than guess.
async function tabForInitiator(initiator) {
  if (!initiator || !/^https?:/.test(initiator)) return null;
  const tabs = (await chrome.tabs.query({})).filter((tab) => {
    try {
      return new URL(tab.url).origin === initiator;
    } catch {
      return false;
    }
  });
  return (tabs.find((tab) => tab.active) || tabs[0])?.id ?? null;
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.initiator === SELF_INITIATOR || details.url.length > MAX_URL_LENGTH) return;
    const header = (name) => details.responseHeaders?.find(
      (item) => item.name.toLowerCase() === name,
    )?.value;
    const response = {
      url: details.url,
      method: details.method,
      status: details.statusCode,
      contentType: header('content-type'),
    };
    const file = videoFileInfo({
      ...response,
      resourceType: details.type,
      contentRange: header('content-range'),
      contentLength: header('content-length'),
    });
    if (!file && !isHlsResponse(response)) return;

    const hasPage = details.initiator && details.initiator !== 'null';
    const found = {
      url: details.url,
      time: details.timeStamp,
      referer: hasPage ? `${details.initiator}/` : null,
      ...(file && { kind: 'file', ...file }),
    };
    if (details.tabId >= 0) {
      record(details.tabId, found, details.frameId);
    } else {
      tabForInitiator(details.initiator).then((tabId) => {
        if (tabId !== null) record(tabId, found);
      });
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders'],
);

// Reading a playlist shows which URLs are qualities of one video, and how long it runs. One read
// at a time (they share rule 1), with tabs taking turns so that one page can't hold up the others.
const pending = new Map();
let inspecting = false;

function inspect(tabId, entry) {
  const queue = pending.get(tabId) || [];
  if (queue.length >= MAX_PENDING_PER_TAB) return; // It can still be played without this.
  queue.push(entry);
  pending.set(tabId, queue);
  runInspectQueue();
}

async function runInspectQueue() {
  if (inspecting) return;
  inspecting = true;
  while (pending.size) {
    const [tabId, queue] = pending.entries().next().value;
    pending.delete(tabId);
  seenByTab.delete(tabId);
    const entry = queue.shift();
    if (queue.length) pending.set(tabId, queue); // Go to the back, next tab's turn.
    await inspectOne(tabId, entry).catch(() => {});
  }
  inspecting = false;
}

async function readLimited(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text;
    received += value.length;
    if (received > MAX_PLAYLIST_BYTES) {
      await reader.cancel();
      throw new Error('playlist too large');
    }
    text += decoder.decode(value, { stream: true });
  }
}

async function inspectOne(tabId, entry) {
  const key = tabKey(tabId);
  const stored = (await chrome.storage.session.get(key))[key] || [];
  if (!stored.some((item) => item.url === entry.url)) return;
  const known = stored.some((item) => (
    item.referer === entry.referer && item.children?.includes(entry.url)
  ));
  if (known) return;

  // This read happens on its own as soon as a page loads, so it sends no cookies and follows no
  // redirects: a malicious page must not be able to make requests elsewhere under your identity.
  const read = () => fetch(entry.url, {
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const setReadHeaders = (requestHeaders) => chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [INSPECT_RULE_ID],
    addRules: [{
      id: INSPECT_RULE_ID,
      action: { type: 'modifyHeaders', requestHeaders },
      condition: {
        tabIds: [chrome.tabs.TAB_ID_NONE],
        initiatorDomains: [chrome.runtime.id],
        requestDomains: [new URL(entry.url).hostname],
        resourceTypes: ['xmlhttprequest'],
      },
    }],
  });

  let info;
  try {
    // Without this rule the request names the extension's id, which any site could collect.
    await setReadHeaders([{ header: 'Origin', operation: 'remove' }]);
    let response = await read();
    const headers = refererHeaders(entry.referer);
    if ((response.status === 401 || response.status === 403) && headers.length) {
      // Refused: try once more with the page's origin, for this host only.
      await setReadHeaders(headers);
      response = await read();
    }
    if (!response.ok) return;
    info = parsePlaylist(await readLimited(response), response.url);
  } catch {
    return; // Unread, it stays a row of its own and can still be played.
  } finally {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [INSPECT_RULE_ID] });
  }
  await updateTab(tabId, (entries) => entries.map((item) => (
    item.url === entry.url ? { ...item, ...info } : item
  )));
}

// Playing in the page, when the setting is on. A found video takes the place of the site's player
// in the frame that loaded it, built into that page so that it makes the page's own requests. One
// swap per tab at a time. A frame where the person went back to the site's player is left alone
// until it navigates. Kept in storage.session, because this worker can stop at any time.
const SETTING = 'playInPage';
const swapKey = (tabId) => `swap:${tabId}`;
const claimed = new Set(); // Tabs with a swap starting, before storage has caught up.

async function playInPageOn() {
  return (await chrome.storage.local.get(SETTING))[SETTING] === true;
}

async function swapState(tabId) {
  return (await chrome.storage.session.get(swapKey(tabId)))[swapKey(tabId)] || { frameId: null, declined: [] };
}

async function maybeEmbed(tabId, frameId, found) {
  if (claimed.has(tabId) || !(await playInPageOn()) || claimed.has(tabId)) return;
  // Taken before anything else waits, so that the playlists of one video make one swap.
  claimed.add(tabId);
  try {
    const state = await swapState(tabId);
    if (state.frameId !== null || state.declined.includes(frameId)) return;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !/^https?:/.test(tab.url || '')) return;
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: ['vendor/hls.min.js', 'ui.js', 'embed.js'],
    });
    const result = await chrome.tabs.sendMessage(tabId,
      { sniff: true, type: 'embed', url: found.url, kind: found.kind, title: tab.title }, { frameId });
    if (result?.ok) await chrome.storage.session.set({ [swapKey(tabId)]: { ...state, frameId } });
  } catch {
    // The frame is gone, or the browser doesn't let extensions run on it.
  } finally {
    claimed.delete(tabId);
  }
}

// The frames between a frame and the top, which need the script too to fill the window.
async function ancestorsOf(tabId, frameId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }) || [];
  const byId = new Map(frames.map((frame) => [frame.frameId, frame]));
  const ids = [];
  for (let id = byId.get(frameId)?.parentFrameId; id !== undefined && id >= 0; id = byId.get(id)?.parentFrameId) {
    ids.push(id);
  }
  return ids;
}

// Only the extension's own scripts in its tabs' frames can send these: pages can't.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.sniff || !sender.tab || sender.id !== chrome.runtime.id) return false;
  const tabId = sender.tab.id;
  if (message.type === 'restored') {
    swapState(tabId).then((state) => {
      if (state.frameId !== sender.frameId) return;
      chrome.storage.session.set({ [swapKey(tabId)]: { frameId: null, declined: [...state.declined, sender.frameId] } });
    });
  } else if (message.type === 'prepareFill') {
    swapState(tabId).then(async (state) => {
      if (state.frameId !== sender.frameId) return sendResponse(false);
      const ancestors = await ancestorsOf(tabId, sender.frameId).catch(() => []);
      if (ancestors.length) {
        await chrome.scripting.executeScript({ target: { tabId, frameIds: ancestors }, files: ['embed.js'] }).catch(() => {});
      }
      sendResponse(true);
    });
    return true;
  } else if (message.type === 'vouch') {
    // Frames reach each other only through here, where a page can't write.
    chrome.tabs.sendMessage(tabId, { sniff: true, type: 'vouch', token: message.token }).catch(() => {});
  }
  return false;
});

// Only a real navigation empties the list, not a route change in a single-page site. URLs newer
// than the navigation stay, so a late event can't wipe what the new page has already loaded.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.documentLifecycle === 'prerender') return;
  swapState(details.tabId).then((state) => {
    if (details.frameId === 0) return chrome.storage.session.remove(swapKey(details.tabId));
    if (state.frameId !== details.frameId && !state.declined.includes(details.frameId)) return null;
    return chrome.storage.session.set({ [swapKey(details.tabId)]: {
      frameId: state.frameId === details.frameId ? null : state.frameId,
      declined: state.declined.filter((id) => id !== details.frameId),
    } });
  });
  if (details.frameId !== 0) return;
  const seen = seenByTab.get(details.tabId);
  seenByTab.delete(details.tabId);
  updateTab(details.tabId, (entries) => entries.filter((entry) => (
    Math.max(entry.time, seen?.get(entry.url) ?? 0) >= details.timeStamp
  )));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(swapKey(tabId));
  pending.delete(tabId);
  seenByTab.delete(tabId);
  // Through the same queue, so a write in progress can't put the data back after the removal.
  updateTab(tabId, () => []).then(() => tabLocks.delete(tabId));
  chrome.declarativeNetRequest.getSessionRules().then((rules) => (
    chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: rules.filter((rule) => rule.condition.tabIds?.includes(tabId)).map((rule) => rule.id),
    })
  ));
});

// Clear the header rules left over from before an update or a reload.
chrome.runtime.onInstalled.addListener(async () => {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: rules.map((rule) => rule.id),
  });
});
