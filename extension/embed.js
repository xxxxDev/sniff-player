// Put into a frame only when "Play in the page" is on and a video was found there. It swaps the
// site's player for Sniff Player in the same place, and fills the window when asked.
//
// The player is built into the page itself, in a closed shadow root. Its requests are the page's
// own, with the cookies and origin the site's player would have sent, so it can't reach anything
// the page couldn't. And the click that started the site's video lets this one play with sound.
(() => {
  'use strict';
  if (window.__sniffPlayerEmbed) return;
  window.__sniffPlayerEmbed = true;

  // Players whose box holds the site's own controls. Hiding the box hides them too.
  const PLAYER_SELECTOR = '.video-js, .jwplayer, .plyr, .dplayer, .html5-video-player, .art-video-player, .xgplayer, .shaka-video-container';
  const SAME_SIZE_SLACK = 15;
  const MIN_WIDTH = 200;
  const MIN_HEIGHT = 112;
  const FIND_TRIES = 12;
  const FIND_INTERVAL_MS = 500;
  const FRAME_TAG = 'sniff-player-frame';
  // After the extension is updated or reloaded, this copy of the script is cut off from it, and
  // every extension call throws. The player then hands the place back to the site.
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const t = (key, ...values) => {
    try {
      return chrome.i18n.getMessage(key, values.map(String));
    } catch {
      setTimeout(() => restore(null, true));
      return '';
    }
  };

  // crypto.randomUUID exists only on HTTPS pages; getRandomValues works on plain HTTP too.
  const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

  // Attributes rather than classes, because sites rewrite the class lists of their own players.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    [data-sniff-hidden] { display: none !important; }
    [data-sniff-page] { overflow: hidden !important; }
    [data-sniff-fill] {
      position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
      max-width: none !important; max-height: none !important; margin: 0 !important; padding: 0 !important;
      border: 0 !important; transform: none !important; translate: none !important; scale: none !important;
      aspect-ratio: auto !important; z-index: 2147483646 !important; background: #000 !important;
    }
    [data-sniff-fill]::backdrop { background: #000; }
  `);
  const sheetRoots = new Set();
  function addSheet(root) {
    if (sheetRoots.has(root)) return;
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    sheetRoots.add(root);
  }

  const inFrame = window !== window.top;
  let current = null; // The swap in this frame.
  let filled = null; // The element filling the window in this frame: ours, or a child frame.

  function tellWorker(message) {
    if (!alive()) return Promise.resolve();
    try {
      return chrome.runtime.sendMessage({ sniff: true, ...message }).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  }

  // Finding the video

  function parentOf(node) {
    const root = node.getRootNode();
    return node.parentElement || (root instanceof ShadowRoot ? root.host : null);
  }

  // Only HTML elements can hold a shadow root; the API throws on an SVG one.
  function shadowRoots(root) {
    const roots = [];
    root.querySelectorAll('*').forEach((element) => {
      const shadow = element instanceof HTMLElement && chrome.dom.openOrClosedShadowRoot(element);
      if (shadow) roots.push(shadow, ...shadowRoots(shadow));
    });
    return roots;
  }

  function allVideos() {
    return [document, ...shadowRoots(document)].flatMap((root) => [...root.querySelectorAll('video')])
      .filter((video) => !current || video !== current.ui.video);
  }

  function area(element) {
    const box = element.getBoundingClientRect();
    return box.width * box.height;
  }

  function bigEnough(video) {
    const box = video.getBoundingClientRect();
    return box.width >= MIN_WIDTH && box.height >= MIN_HEIGHT;
  }

  // The video that loaded this URL. A file plays from its own URL, so that's an exact match. A
  // stream plays through a blob URL, so it's the one the person just started: of the videos
  // playing, or loading, the largest.
  function findVideo(url) {
    const videos = allVideos().filter((video) => video.isConnected);
    const exact = videos.filter((video) => video.currentSrc === url || video.src === url);
    if (exact.length) return exact.find(bigEnough) || null;
    const started = videos.filter((video) => bigEnough(video) && (
      !video.paused || video.networkState === HTMLMediaElement.NETWORK_LOADING
    ));
    const playing = started.filter((video) => !video.paused);
    const pick = (list) => list.reduce((best, video) => (!best || area(video) > area(best) ? video : best), null);
    return pick(playing) || pick(started);
  }

  // The site's player: a known one, or the outermost box the same size as the video.
  function playerOf(video) {
    const known = video.closest(PLAYER_SELECTOR);
    if (known && known !== document.body) return known;
    const box = video.getBoundingClientRect();
    let player = video;
    for (let parent = parentOf(video); parent && parent !== document.body && parent !== document.documentElement; parent = parentOf(parent)) {
      const parentBox = parent.getBoundingClientRect();
      if (Math.abs(parentBox.width - box.width) >= SAME_SIZE_SLACK || Math.abs(parentBox.height - box.height) >= SAME_SIZE_SLACK) break;
      player = parent;
    }
    return player;
  }

  // The heading of the post or section the player is in.
  function headingOf(player) {
    for (let node = parentOf(player); node && node !== document.body; node = parentOf(node)) {
      const heading = node.querySelector('h1, h2, h3');
      if (heading) return heading.textContent.trim().replace(/\s+/g, ' ').slice(0, 200);
    }
    return '';
  }

  // Playing, with the page's own requests

  function play(state) {
    const { ui, url, kind, startAt } = state;
    const { video } = ui;
    state.hls?.destroy();
    state.hls = null;
    if (kind === 'file' || !globalThis.Hls?.isSupported()) {
      video.addEventListener('error', () => ui.showError(t('errPlayTitle'), t('errFileDetail')), { once: true });
      video.src = url;
      if (startAt) video.currentTime = startAt;
      ui.startPlaying();
      return;
    }
    // In a page, the player can't start a worker from the extension, so hls.js runs here.
    const hls = new Hls({ enableWorker: false, startPosition: startAt || -1 });
    state.hls = hls;
    let recoveries = 0;
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      SniffPlayerUI.offerQualities(ui, hls);
      ui.startPlaying();
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recoveries < 2) {
        recoveries += 1;
        hls.recoverMediaError();
        return;
      }
      hls.destroy();
      state.hls = null;
      ui.showError(...SniffPlayerUI.hlsErrorMessage(t, data));
    });
    hls.loadSource(url);
    hls.attachMedia(video);
  }

  // Swapping

  function keepPaused(event) {
    event.target.pause();
  }

  function swap(video, url, kind, pageTitle, options = {}) {
    const { fillOnPlay = false, unfillOnEnd = false } = options;
    video.removeEventListener('play', swapAgain);
    handedBack.delete(video);
    const player = playerOf(video);
    const box = player.getBoundingClientRect();
    const parentBox = player.parentElement?.getBoundingClientRect();
    const startAt = Number.isFinite(video.duration) ? video.currentTime : 0;
    const muted = video.muted;
    video.pause();
    video.addEventListener('play', keepPaused);

    const host = document.createElement('div');
    const id = randomId();
    host.setAttribute('data-sniff-player', id);
    host.tabIndex = -1;
    // In the constructed sheet rather than inline, which a page's style-src policy can block.
    const fullWidth = parentBox && Math.abs(parentBox.width - box.width) < SAME_SIZE_SLACK;
    sheet.insertRule(`[data-sniff-player="${id}"] {
      all: initial; display: block; position: relative; max-width: 100%; background: #000; outline: none;
      width: ${fullWidth ? '100%' : `${Math.round(box.width)}px`};
      aspect-ratio: ${Math.round(box.width)} / ${Math.round(box.height)};
    }`, 0);
    // Closed, so the page's scripts and styles can't reach into the player.
    const root = host.attachShadow({ mode: 'closed' });

    // With one video the page's title names it. With several, its post's heading tells them apart.
    const heading = allVideos().filter(bigEnough).length > 1 ? headingOf(player) : '';
    const state = { video, player, host, url, kind, startAt, pageTitle, options, ui: null, hls: null };
    state.ui = SniffPlayerUI.create({
      root,
      t,
      title: heading || pageTitle || document.title,
      src: url,
      keyTarget: host,
      fullscreenTarget: host,
      onFill: (on) => (on ? fillHere(host) : unfillHere()),
      onBack: (time) => restore(time),
      onRetry: () => play(state),
      unfillOnEnd,
    });
    // The site's video is only paused, not muted; Sniff Player starts with the same sound setting.
    state.ui.video.muted = muted;
    host.addEventListener('pointerdown', () => host.focus({ preventScroll: true }));

    addSheet(document);
    addSheet(player.getRootNode());
    player.before(host);
    player.setAttribute('data-sniff-hidden', '');
    current = state;
    play(state);
    host.focus({ preventScroll: true });
    // Only after a real press on the site's player, so that a video starting by itself, an ad's
    // say, never takes over the window.
    if (fillOnPlay && navigator.userActivation?.isActive) {
      state.ui.setFilled(true);
      fillHere(host);
    }

    // A site that rebuilds its player removes ours with it, or the hidden one.
    state.watchdog = setInterval(() => {
      if (!host.isConnected || !player.isConnected) restore(null, true);
    }, 1000);
  }

  // Videos handed back to the site when another took over, each with how it was swapped.
  const handedBack = new Map();
  function swapAgain(event) {
    const video = event.target;
    const last = handedBack.get(video);
    video.removeEventListener('play', swapAgain);
    handedBack.delete(video);
    if (!last || !alive() || !video.isConnected || current?.video === video) return;
    if (current) restore(null, true, true);
    swap(video, last.url, last.kind, last.pageTitle, last.options);
    tellWorker({ type: 'swapped' });
  }

  // Back to the site's player. When another video takes over (handOver), the old one stays
  // paused at the point reached, and the worker isn't told, since this frame isn't declining.
  function restore(time, silent = false, handOver = false) {
    const state = current;
    if (!state) return;
    current = null;
    clearInterval(state.watchdog);
    if (filled === state.host) unfillHere();
    const reached = state.ui.video.currentTime;
    state.hls?.destroy();
    state.ui.video.pause();
    state.ui.video.removeAttribute('src');
    state.host.remove();
    state.player.removeAttribute('data-sniff-hidden');
    state.video.removeEventListener('play', keepPaused);
    if (handOver) {
      if (Number.isFinite(reached) && reached > 0) state.video.currentTime = reached;
      // Going back to it, the last episode say, swaps it in again.
      handedBack.set(state.video, state);
      state.video.addEventListener('play', swapAgain);
      return;
    }
    // Back to the site's player for good, in this frame: none of them swaps in again.
    for (const video of handedBack.keys()) video.removeEventListener('play', swapAgain);
    handedBack.clear();
    if (!silent) {
      if (Number.isFinite(time) && time > 0) state.video.currentTime = time;
      state.video.play().catch(() => {});
    }
    tellWorker({ type: 'restored' });
  }

  // Filling the window, through the top layer so that nothing on the page covers it

  function fill(element) {
    if (filled) unfill();
    addSheet(document);
    addSheet(element.getRootNode());
    element.setAttribute('data-sniff-fill', '');
    element.setAttribute('popover', 'manual');
    try {
      element.showPopover();
    } catch {
      element.removeAttribute('popover');
    }
    document.documentElement.setAttribute('data-sniff-page', '');
    filled = element;
    window.dispatchEvent(new Event('resize'));
  }

  function unfill() {
    const element = filled;
    if (!element) return;
    filled = null;
    if (element.isConnected && element.matches(':popover-open')) element.hidePopover();
    element.removeAttribute('popover');
    element.removeAttribute('data-sniff-fill');
    document.documentElement.removeAttribute('data-sniff-page');
    window.dispatchEvent(new Event('resize'));
  }

  async function fillHere(host) {
    // Filling the window from a frame takes over the whole top page, so only on a real press.
    if (inFrame && !navigator.userActivation?.isActive) {
      current?.ui.setFilled(false);
      return;
    }
    fill(host);
    if (inFrame) {
      // The frames above need this script too, to fill the frame this one is in.
      await tellWorker({ type: 'prepareFill' });
      askParent('fill');
    }
  }

  function unfillHere() {
    unfill();
    current?.ui.setFilled(false);
    askParent('unfill');
  }

  // A parent has to learn which of its frames is asking. Only this script can put the same token
  // in both channels: the worker vouches for it, and postMessage shows the frame.
  function askParent(kind) {
    if (!inFrame) return;
    const token = randomId();
    tellWorker({ type: 'vouch', token });
    window.parent.postMessage({ tag: FRAME_TAG, kind, token }, '*');
  }

  const vouched = new Set();
  function frameElementFor(source) {
    const frames = [document, ...shadowRoots(document)].flatMap((root) => [...root.querySelectorAll('iframe')]);
    return frames.find((frame) => frame.contentWindow === source) || null;
  }

  function fromChild(source, kind, token, tries = 0) {
    if (!vouched.has(token)) {
      // The two channels race. A token nobody vouches for soon is a page's own message.
      if (tries < 20) setTimeout(() => fromChild(source, kind, token, tries + 1), 50);
      return;
    }
    vouched.delete(token);
    const frame = frameElementFor(source);
    if (!frame) return;
    if (kind === 'fill') fill(frame);
    else if (filled === frame) unfill();
    askParent(kind);
  }

  window.addEventListener('message', (event) => {
    const { data, source } = event;
    if (!data || data.tag !== FRAME_TAG || !source || source === window || typeof data.token !== 'string') return;
    if (data.kind === 'fill' || data.kind === 'unfill') fromChild(source, data.kind, data.token);
  });

  // Esc on the page, outside the player, also leaves a filled window, whichever frame fills it.
  document.addEventListener('keydown', (event) => {
    if (!event.isTrusted || event.key !== 'Escape' || !filled || document.fullscreenElement) return;
    if (current && filled === current.host) unfillHere();
    else unfill();
  }, true);

  async function findAndSwap({ url, kind, title, fillOnPlay, unfillOnEnd }) {
    for (let tries = 0; tries < FIND_TRIES; tries += 1) {
      const video = findVideo(url);
      if (video && current && (video === current.video || url === current.url)) return { ok: false };
      if (video) {
        // Another video on the page started, the next episode say: it takes over from the last.
        if (current) restore(null, true, true);
        swap(video, url, kind, title, { fillOnPlay: fillOnPlay === true, unfillOnEnd: unfillOnEnd === true });
        return { ok: true };
      }
      await new Promise((resolve) => { setTimeout(resolve, FIND_INTERVAL_MS); });
    }
    return { ok: false };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message?.sniff) return false;
    if (message.type === 'embed') {
      findAndSwap(message).then(sendResponse, (error) => sendResponse({ ok: false, error: String(error) }));
      return true;
    }
    if (message.type === 'release') {
      // A video in another frame of this tab takes over.
      restore(null, true, true);
      return false;
    }
    if (message.type === 'vouch') {
      vouched.add(message.token);
      setTimeout(() => vouched.delete(message.token), 5000);
    }
    return false;
  });
})();
