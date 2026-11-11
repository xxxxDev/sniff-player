// Runs in every frame. With the pointer on a video, three buttons show at its top right corner:
// picture-in-picture, fill the window, and Sniff Player, which plays it right there in Sniff
// Player. F2 fills the window and F3 opens picture-in-picture. Filling goes through the browser's
// top layer, so no style on the page can cover or clip it.
(() => {
  'use strict';
  if (window.__sniffPlayerButtons) return;
  window.__sniffPlayerButtons = true;

  const MIN_WIDTH = 400;
  const MIN_HEIGHT = 221;
  const SAME_SIZE_SLACK = 15;
  const KEY_FILL = 'F2';
  const KEY_PIP = 'F3';
  // Players whose own controls should stay usable, even when they are larger than the video.
  const PLAYER_SELECTOR = '#movie_player, .html5-video-player, .video-js, .jwplayer, .plyr, .dplayer';
  const FRAME_TAG = 'sniff-player-buttons';
  const FONT = '-apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif';

  // Attributes rather than classes, because sites rewrite the class lists of their own players.
  const FILL_STYLES = `
    [data-sniff-window] { overflow: hidden !important; }
    [data-sniff-target] {
      position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
      min-width: 0 !important; min-height: 0 !important; max-width: none !important; max-height: none !important;
      margin: 0 !important; padding: 0 !important; border: 0 !important; border-radius: 0 !important;
      background: #000 !important; transform: none !important; translate: none !important; scale: none !important;
      rotate: none !important; opacity: 1 !important; clip-path: none !important; visibility: visible !important;
      z-index: 2147483646 !important;
    }
    [data-sniff-target]::backdrop { background: #000; }
    [data-sniff-chain], [data-sniff-video] {
      width: 100% !important; height: 100% !important; min-width: 0 !important; min-height: 0 !important;
      max-width: none !important; max-height: none !important; margin: 0 !important; transform: none !important;
    }
    [data-sniff-video] { top: 0 !important; left: 0 !important; object-fit: contain !important; }
  `;
  const fillSheet = new CSSStyleSheet();
  fillSheet.replaceSync(FILL_STYLES);

  const inFrame = window !== window.top;
  // crypto.randomUUID exists only on HTTPS pages; getRandomValues works on plain HTTP too.
  const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const frameId = randomId();
  // After the extension is updated or removed, this copy is cut off and every extension call throws.
  const t = (key) => {
    try {
      return chrome.i18n.getMessage(key);
    } catch {
      return '';
    }
  };

  let pointerVideo = null;
  // Set when another frame of this tab has a video under the pointer, so that frame gets the keys.
  let pointerInFrame = false;
  let filled = null;
  let watchdog = 0;

  // Finding videos

  function parentOf(node) {
    const root = node.getRootNode();
    return node.parentElement || (root instanceof ShadowRoot ? root.host : null);
  }

  // What the person can see of it. A small ad can hold a large video it clips, or hides, to get
  // the buttons into the frame and have them pressed by accident.
  function isLargeEnough(video) {
    const box = video.getBoundingClientRect();
    const width = Math.min(box.right, window.innerWidth) - Math.max(box.left, 0);
    const height = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
    return width >= MIN_WIDTH && height >= MIN_HEIGHT && video.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  }

  function contains(box, x, y) {
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  }

  // A site's video can be in a shadow root, which document.querySelectorAll doesn't enter. The
  // ones on the pointer's path are enough, and much cheaper than walking the whole page. Sniff
  // Player's own video, in a closed shadow root, is never on it.
  function candidateVideos(path) {
    const videos = new Set(document.querySelectorAll('video'));
    for (const node of path) {
      const root = node.shadowRoot || (node instanceof ShadowRoot ? node : null);
      if (root) root.querySelectorAll('video').forEach((video) => videos.add(video));
    }
    return [...videos].filter(isLargeEnough);
  }

  function area(element) {
    const box = element.getBoundingClientRect();
    return box.width * box.height;
  }

  function largest(elements) {
    return elements.reduce((best, element) => (!best || area(element) > area(best) ? element : best), null);
  }

  function videoAt(x, y, path) {
    return largest(candidateVideos(path).filter((video) => contains(video.getBoundingClientRect(), x, y)));
  }

  // A key acts on the video under the pointer, or failing that on one the person can actually see.
  function videoForKey() {
    if (pointerVideo && !pointerVideo.isConnected) pointerVideo = null;
    return pointerVideo || largest(candidateVideos([]));
  }

  // The element that fills the window: a known player, or the outermost ancestor the same size as
  // the video, which is usually where a site keeps its own controls.
  function playerOf(video) {
    const known = video.closest(PLAYER_SELECTOR);
    if (known) return known;
    const box = video.getBoundingClientRect();
    let player = video;
    for (let parent = parentOf(video); parent && parent !== document.body && parent !== document.documentElement; parent = parentOf(parent)) {
      const parentBox = parent.getBoundingClientRect();
      if (Math.abs(parentBox.width - box.width) >= SAME_SIZE_SLACK || Math.abs(parentBox.height - box.height) >= SAME_SIZE_SLACK) break;
      player = parent;
    }
    return player;
  }

  function isInside(target, node) {
    for (let current = node; current; current = parentOf(current)) {
      if (current === target) return true;
    }
    return false;
  }

  // Filling the window

  // Sites sizing their player by script only notice the new size on a resize event, and some
  // only after their own layout has settled.
  function announceResize() {
    window.dispatchEvent(new Event('resize'));
    setTimeout(() => window.dispatchEvent(new Event('resize')), 150);
  }

  function showInTopLayer(target) {
    try {
      target.showPopover();
      return true;
    } catch {
      return false;
    }
  }

  // A player with no controls of its own would leave the person with nothing to press.
  function hasOwnControls(target, video) {
    return target !== video && !!target.querySelector('button, input, [role="button"], [role="slider"]');
  }

  // Sheets reach only their own document or shadow root, and a video can sit in a shadow root.
  function addSheet(root, state) {
    if (state.roots.includes(root)) return;
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, fillSheet];
    state.roots.push(root);
  }

  // Filling can reset scrollers, including ones between the player and the page.
  function scrollPositions(target) {
    const positions = [];
    for (let node = parentOf(target); node; node = parentOf(node)) {
      if (node.scrollTop || node.scrollLeft) positions.push([node, node.scrollLeft, node.scrollTop]);
    }
    return positions;
  }

  function applyFill(target, video) {
    const wasOpen = target.matches(':popover-open');
    const state = {
      target,
      video,
      chain: [],
      roots: [],
      popover: target.getAttribute('popover'),
      wasOpen,
      controls: video ? video.controls : false,
      scroll: [window.scrollX, window.scrollY],
      scrollers: scrollPositions(target),
    };
    addSheet(document, state);
    addSheet(target.getRootNode(), state);
    // A frame that navigates loses its content script, and with it any way to leave from inside.
    state.onFrameLoad = () => leaveEverywhere();
    if (!video) target.addEventListener('load', state.onFrameLoad);
    if (video) {
      video.setAttribute('data-sniff-video', '');
      addSheet(video.getRootNode(), state);
      if (video !== target) {
        for (let node = parentOf(video); node && node !== target; node = parentOf(node)) {
          node.setAttribute('data-sniff-chain', '');
          addSheet(node.getRootNode(), state);
          state.chain.push(node);
        }
      }
      if (!hasOwnControls(target, video)) video.controls = true;
    }
    target.setAttribute('data-sniff-target', '');
    if (wasOpen) target.hidePopover();
    target.setAttribute('popover', 'manual');
    // Without the top layer the fixed position still applies, but a popover that isn't open is hidden.
    if (!showInTopLayer(target)) target.removeAttribute('popover');
    document.documentElement.setAttribute('data-sniff-window', '');
    if (document.body) document.body.setAttribute('data-sniff-window', '');
    filled = state;
    hideButtons();
    announceResize();
    // Removing or moving an element closes its popover without any event, and sites do both.
    watchdog = setInterval(() => {
      if (!target.isConnected || (video && !isInside(target, video))) leaveEverywhere();
      else if (target.hasAttribute('popover') && !target.matches(':popover-open')) showInTopLayer(target);
    }, 500);
  }

  function clearFill() {
    const state = filled;
    filled = null;
    clearInterval(watchdog);
    const { target, video } = state;
    target.removeEventListener('load', state.onFrameLoad);
    if (target.isConnected && target.matches(':popover-open')) target.hidePopover();
    target.removeAttribute('data-sniff-target');
    if (state.popover === null) target.removeAttribute('popover');
    else target.setAttribute('popover', state.popover);
    if (state.wasOpen && target.isConnected) showInTopLayer(target);
    state.chain.forEach((node) => node.removeAttribute('data-sniff-chain'));
    if (video) {
      video.removeAttribute('data-sniff-video');
      video.controls = state.controls;
    }
    document.documentElement.removeAttribute('data-sniff-window');
    if (document.body) document.body.removeAttribute('data-sniff-window');
    state.roots.forEach((root) => {
      root.adoptedStyleSheets = root.adoptedStyleSheets.filter((sheet) => sheet !== fillSheet);
    });
    window.scrollTo({ left: state.scroll[0], top: state.scroll[1], behavior: 'instant' });
    state.scrollers.forEach(([node, left, top]) => node.scrollTo({ left, top, behavior: 'instant' }));
    announceResize();
  }

  // Everything between frames goes through the extension's background worker where it matters,
  // because a page can't write to that channel.
  function tellTab(message) {
    try {
      chrome.runtime.sendMessage({ sniff: true, buttons: true, sender: frameId, ...message }).catch(() => {});
    } catch {
      // The extension was updated or removed under this page, and the other frames can't be told.
      leaveHere();
    }
  }

  function leaveHere() {
    if (filled) clearFill();
  }

  function leaveEverywhere() {
    leaveHere();
    tellTab({ type: 'leave' });
  }

  // A parent has to learn which of its frames is asking. Only the frame's content script can put
  // the same token in both channels: the worker vouches for it, and postMessage shows the frame.
  function askParentToFill() {
    if (!inFrame) return;
    const token = randomId();
    tellTab({ type: 'token', token });
    window.parent.postMessage({ tag: FRAME_TAG, kind: 'fill', token }, '*');
  }

  function fillVideo(video) {
    if (document.fullscreenElement || filled) return;
    applyFill(playerOf(video), video);
    askParentToFill();
  }

  const vouchedTokens = new Set();
  let leaveCount = 0;

  function vouch(token) {
    vouchedTokens.add(token);
    setTimeout(() => vouchedTokens.delete(token), 5000);
  }

  // Only HTML elements can hold a shadow root; the API throws on an SVG one.
  function allFrames(root = document) {
    const frames = [...root.querySelectorAll('iframe')];
    root.querySelectorAll('*').forEach((element) => {
      const shadow = element instanceof HTMLElement && chrome.dom.openOrClosedShadowRoot(element);
      if (shadow) frames.push(...allFrames(shadow));
    });
    return frames;
  }

  function fillFrameAfterVouch(source, token, leavesSeen = leaveCount, tries = 0) {
    // A quick second press has already left, so this request is out of date.
    if (leavesSeen !== leaveCount) return;
    if (!vouchedTokens.has(token)) {
      // The two channels race. A token nobody vouches for soon is a page's own message.
      if (tries < 20) setTimeout(() => fillFrameAfterVouch(source, token, leavesSeen, tries + 1), 50);
      return;
    }
    vouchedTokens.delete(token);
    const frame = allFrames().find((candidate) => candidate.contentWindow === source);
    if (!frame || filled || document.fullscreenElement) return;
    applyFill(frame, null);
    askParentToFill();
  }

  window.addEventListener('message', (event) => {
    const { data, source } = event;
    if (!data || data.tag !== FRAME_TAG || !source || source === window) return;
    if (data.kind === 'fill' && typeof data.token === 'string') fillFrameAfterVouch(source, data.token);
  });

  // Picture-in-picture

  async function togglePictureInPicture(video) {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      showTip(t('pipNeedsClick'));
    }
  }

  // Sniff Player, in the site player's place. The worker picks what this frame loaded and puts
  // the player's script in; the script runs in this same isolated world, so it gets the very
  // video that was pressed.
  async function playInSniffPlayer(video) {
    let answer = null;
    try {
      answer = await chrome.runtime.sendMessage({
        sniff: true, type: 'swapHere', src: /^https?:/.test(video.currentSrc) ? video.currentSrc : '',
      });
    } catch {
      // Cut off from the extension, or the worker didn't answer.
    }
    if (!answer?.ok || !video.isConnected) {
      showTip(answer?.reason === 'blocked' ? t('sniffBlocked') : t('sniffNeedsPlay'));
      return;
    }
    leaveHere();
    globalThis.__sniffPlayerSwapVideo?.(video, answer);
  }

  // The buttons, in a shadow root so a page's styles can't reach them, and with a constructed
  // style sheet so a page's content security policy can't block them.

  let host = null;
  const buttons = {};
  // Which of the three the person wants. Until the setting has been read, none show.
  let wanted = null;
  let tip = null;
  let placed = null;

  function buildButtons() {
    host = document.createElement('div');
    host.setAttribute('data-sniff-buttons', '');
    const root = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      :host { all: initial; position: fixed; z-index: 2147483647; display: none; gap: 1px; }
      button { all: unset; padding: 0 6px; height: 20px; line-height: 20px; cursor: pointer; opacity: .6;
        font: 12px/20px ${FONT}; color: #fff; background: #1a8fd8; white-space: nowrap; }
      button:hover, button:focus-visible { opacity: 1; background: #1668c9; }
    `);
    root.adoptedStyleSheets = [sheet];
    const addButton = (label, action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (event.isTrusted && pointerVideo && pointerVideo.isConnected && buttonsLookRight() && isLargeEnough(pointerVideo)) action(pointerVideo);
      });
      root.append(button);
      return button;
    };
    buttons.buttonPip = addButton(t('pictureInPicture'), togglePictureInPicture);
    buttons.buttonFill = addButton(t('fillPage'), fillVideo);
    buttons.buttonSniff = addButton('Sniff Player', playInSniffPlayer);
    document.documentElement.append(host);
  }

  function placeButtons(video) {
    if (!wanted) return;
    const pipAllowed = document.pictureInPictureEnabled && !video.disablePictureInPicture;
    const showing = { buttonPip: wanted.buttonPip && pipAllowed, buttonFill: wanted.buttonFill, buttonSniff: wanted.buttonSniff };
    if (!Object.values(showing).some(Boolean)) {
      hideButtons();
      return;
    }
    if (!host) buildButtons();
    for (const [name, button] of Object.entries(buttons)) button.style.display = showing[name] ? '' : 'none';
    host.style.display = 'flex';
    const box = video.getBoundingClientRect();
    const size = host.getBoundingClientRect();
    // Above the video when there's room, and inside its corner when it starts at the top of the frame.
    const top = box.top >= size.height ? box.top - size.height : box.top;
    placed = { top: Math.max(0, top), left: Math.max(0, Math.min(box.right, window.innerWidth) - size.width) };
    host.style.top = `${placed.top}px`;
    host.style.left = `${placed.left}px`;
  }

  // A page can reach the buttons' outer element. If it has stretched or hidden them, a press isn't
  // a press on what the person saw.
  function buttonsLookRight() {
    const style = getComputedStyle(host);
    const box = host.getBoundingClientRect();
    // Where it was put, at the video's corner, and not moved over something else.
    const inPlace = placed && Math.abs(box.top - placed.top) < 2 && Math.abs(box.left - placed.left) < 2;
    return inPlace && style.transform === 'none' && style.opacity === '1' && style.visibility === 'visible' && style.position === 'fixed' && box.height <= 24 && box.width <= 400;
  }

  function hideButtons() {
    if (host) host.style.display = 'none';
  }

  function showTip(message) {
    if (!message) return;
    if (!tip) {
      tip = document.createElement('div');
      tip.setAttribute('popover', 'manual');
      Object.assign(tip.style, {
        position: 'fixed', inset: 'auto 24px 96px auto', margin: '0', border: '0', padding: '10px 14px',
        font: `14px ${FONT}`, color: '#fff', background: '#1668c9',
      });
      document.documentElement.append(tip);
    }
    tip.textContent = message;
    if (!tip.matches(':popover-open')) showInTopLayer(tip);
    clearTimeout(tip.timer);
    tip.timer = setTimeout(() => tip.hidePopover(), 3500);
  }

  // The person's choice of buttons, from the popup. F2 and F3 work whichever are shown.
  const BUTTON_SETTINGS = ['buttonPip', 'buttonFill', 'buttonSniff'];
  function applyWanted(stored) {
    wanted = Object.fromEntries(BUTTON_SETTINGS.map((name) => [name, stored[name] !== false]));
    if (pointerVideo && pointerVideo.isConnected && !filled) placeButtons(pointerVideo);
  }
  try {
    chrome.storage.local.get(BUTTON_SETTINGS).then(applyWanted, () => applyWanted({}));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !BUTTON_SETTINGS.some((name) => name in changes)) return;
      chrome.storage.local.get(BUTTON_SETTINGS).then(applyWanted, () => {});
    });
  } catch {
    applyWanted({});
  }

  // Following the pointer

  let pointerCheck = 0;
  let pointerNotice = -Infinity;
  window.addEventListener('mousemove', (event) => {
    if (!event.isTrusted) return;
    // Not in the delayed part: the frame's message can arrive first when the pointer moves quickly.
    pointerInFrame = false;
    if (pointerCheck || filled) return;
    const { clientX: x, clientY: y } = event;
    const path = event.composedPath();
    pointerCheck = requestAnimationFrame(() => {
      pointerCheck = 0;
      if (filled) return;
      if (host && path.includes(host)) return;
      const hadVideo = !!pointerVideo;
      pointerVideo = videoAt(x, y, path);
      if (pointerVideo) placeButtons(pointerVideo);
      else hideButtons();
      if (inFrame && hadVideo && !pointerVideo) tellTab({ type: 'pointer', inFrame: false });
      else if (inFrame && pointerVideo && performance.now() - pointerNotice > 500) {
        pointerNotice = performance.now();
        tellTab({ type: 'pointer', inFrame: true });
      }
    });
  }, { capture: true, passive: true });

  document.addEventListener('mouseleave', () => {
    if (inFrame && pointerVideo) tellTab({ type: 'pointer', inFrame: false });
    pointerVideo = null;
    hideButtons();
  });

  document.addEventListener('scroll', () => {
    if (pointerVideo && !filled && host && host.style.display !== 'none') placeButtons(pointerVideo);
  }, { capture: true, passive: true });

  // Keyboard

  function pressFill() {
    if (filled) {
      leaveEverywhere();
      return true;
    }
    if (pointerInFrame) {
      tellTab({ type: 'key', action: 'fill' });
      return true;
    }
    const video = videoForKey();
    if (video) {
      fillVideo(video);
      return true;
    }
    if (inFrame) tellTab({ type: 'key', action: 'fill' });
    return false;
  }

  function pressPictureInPicture() {
    if (pointerInFrame) {
      tellTab({ type: 'key', action: 'pip' });
      return true;
    }
    const video = videoForKey() || document.pictureInPictureElement;
    if (video) {
      togglePictureInPicture(video);
      return true;
    }
    if (inFrame) tellTab({ type: 'key', action: 'pip' });
    return false;
  }

  function isTyping(event) {
    const element = event.composedPath()[0];
    return element instanceof Element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));
  }

  // On the window and from the very start of the page, so a page's own listener can't get there
  // first and take away the way out.
  window.addEventListener('keydown', (event) => {
    if (!event.isTrusted || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    let handled = false;
    if (event.key === 'Escape') {
      handled = !!filled;
      // A frame that has reloaded inside a filled parent no longer knows, so it always asks.
      if (filled) leaveEverywhere();
      else if (inFrame) tellTab({ type: 'leave' });
    } else if (isTyping(event) && !filled) {
      return;
    } else if (event.key === KEY_FILL) {
      handled = pressFill();
    } else if (event.key === KEY_PIP) {
      handled = pressPictureInPicture();
    }
    if (handled) {
      // F3 is also the browser's find-next, and sites can have their own use for these keys.
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  // Messages from the worker: other frames of this tab

  chrome.runtime.onMessage.addListener((message) => {
    if (!message?.sniff || !message.buttons) return;
    if (message.type === 'token') vouch(message.token);
    if (message.type === 'pointer' && message.sender !== frameId) pointerInFrame = message.inFrame;
    if (message.type === 'leave') {
      leaveCount += 1;
      vouchedTokens.clear();
      pointerInFrame = false;
      leaveHere();
    }
    // Its own key went to the other frames; it has already acted, or found nothing here.
    if (message.type === 'key' && message.sender !== frameId && pointerVideo && pointerVideo.isConnected) {
      if (message.action === 'fill') fillVideo(pointerVideo);
      if (message.action === 'pip') togglePictureInPicture(pointerVideo);
    }
  });
})();
