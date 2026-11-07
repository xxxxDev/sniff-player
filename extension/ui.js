// The player's look and controls, shared by the player tab and the player put into a page. A
// classic script, so that it can also run where a page's player is swapped out.
globalThis.SniffPlayerUI = (() => {
  'use strict';
  if (globalThis.SniffPlayerUI) return globalThis.SniffPlayerUI;

  const AUTO = '-1';
  const SPEEDS = ['0.5', '0.75', '1', '1.25', '1.5', '2'];
  const ICONS = {
    play: 'M8 5v14l11-7z',
    pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
    volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
    muted: 'M3 9v6h4l5 5V4L7 9H3zm18.7 1.3-1.4-1.4L18 11.2l-2.3-2.3-1.4 1.4 2.3 2.3-2.3 2.3 1.4 1.4 2.3-2.3 2.3 2.3 1.4-1.4-2.3-2.3z',
    fill: 'M17 4h3a2 2 0 0 1 2 2v2h-2V6h-3V4zM4 8V6h3V4H4a2 2 0 0 0-2 2v2h2zm16 8v2h-3v2h3a2 2 0 0 0 2-2v-2h-2zM7 18H4v-2H2v2a2 2 0 0 0 2 2h3v-2zM18 8H6v8h12V8z',
    unfill: 'M17 4h3a2 2 0 0 1 2 2v2h-2V6h-3V4zM4 8V6h3V4H4a2 2 0 0 0-2 2v2h2zm16 8v2h-3v2h3a2 2 0 0 0 2-2v-2h-2zM7 18H4v-2H2v2a2 2 0 0 0 2 2h3v-2zM16 10H8v4h8v-4z',
    fullscreen: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
    exitFullscreen: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z',
    copy: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z',
    copied: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z',
    pip: 'M19 11h-8v6h8v-6zm4 8V5a2 2 0 0 0-2-2H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2zm-2 0H3V5h18v14z',
    original: 'M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z',
  };

  // Everything sits inside .sp, absolutely, so the same rules work in a tab and in a box on a page.
  const CSS = `
    .sp, .sp * { box-sizing: border-box; }
    .sp {
      position: absolute; inset: 0; overflow: hidden; background: #000; color: #e6edf2; text-align: left; container-type: size;
      font: 13px/1.45 -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif; letter-spacing: normal;
    }
    .sp.idle { cursor: none; }
    .sp video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
    .sp .bar {
      position: absolute; inset: 0 0 auto; display: flex; align-items: center; gap: 6px; padding: 6px 8px 6px 14px;
      background: linear-gradient(rgba(0, 0, 0, .85), transparent); transition: opacity .2s;
    }
    .sp .title { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 14px; }
    .sp.idle .bar, .sp.idle .controls { opacity: 0; pointer-events: none; }
    .sp button {
      margin: 0; padding: 3px 8px; border: 1px solid #3a4853; border-radius: 5px; background: #151b20;
      color: #e6edf2; font: inherit; cursor: pointer; min-width: 0; min-height: 0; text-transform: none; box-shadow: none;
    }
    .sp button:hover { border-color: #52c9f4; }
    .sp [hidden] { display: none !important; }
    .sp .controls {
      position: absolute; inset: auto 0 0; padding: 18px 12px 6px;
      background: linear-gradient(transparent, rgba(0, 0, 0, .85)); transition: opacity .2s;
    }
    .sp .row { display: flex; align-items: center; gap: 6px; height: 36px; }
    .sp .spacer { flex: 1; }
    .sp .time { font-variant-numeric: tabular-nums; white-space: nowrap; padding-left: 4px; }
    .sp .live { color: #ff5a5a; font-weight: 600; }
    .sp button.icon {
      display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 6px;
      background: transparent; color: #fff;
    }
    .sp button.icon:hover { background: rgba(255, 255, 255, .12); }
    .sp button.icon:focus-visible { outline: 2px solid #52c9f4; }
    .sp button.icon svg { width: 22px; height: 22px; fill: currentColor; }
    .sp .volume-box { display: flex; align-items: center; }
    .sp input[type="range"] { accent-color: #52c9f4; cursor: pointer; margin: 0; padding: 0; background: transparent; }
    .sp .volume { width: 0; opacity: 0; transition: width .15s, opacity .15s; }
    .sp .volume-box:hover .volume, .sp .volume:focus-visible { width: 80px; opacity: 1; }
    .sp .seek { display: block; width: 100%; height: 14px; }
    .sp .seek:disabled { visibility: hidden; }
    .sp .menu {
      position: absolute; bottom: 52px; display: flex; flex-direction: column; min-width: 120px;
      max-height: calc(100cqh - 64px); overflow-y: auto; padding: 4px; background: #151b20; border: 1px solid #3a4853; border-radius: 8px;
    }
    .sp .menu > div, .sp .menu [data-id="options"] { display: flex; flex-direction: column; }
    .sp .menu button {
      display: flex; justify-content: space-between; gap: 16px; border: 0; padding: 8px 10px; background: transparent;
      text-align: left; white-space: nowrap;
    }
    .sp .menu button:hover { background: #222b32; }
    .sp .menu .value { color: #8d9ba6; }
    .sp .menu .heading { padding: 6px 10px; color: #8d9ba6; font-size: 12px; border-bottom: 1px solid #27313a; }
    .sp button.text {
      height: 30px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: #fff;
      font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums;
    }
    .sp button.text:hover { background: rgba(255, 255, 255, .12); }
    @container (max-width: 560px) { .sp .time { display: none; } }
    @container (max-width: 440px) { .sp [data-id="pip"] { display: none; } }
    .sp .menu [aria-checked="true"]::after { content: "✓"; color: #52c9f4; }
    .sp .unmute {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); padding: 10px 18px; border: 0;
      border-radius: 999px; background: rgba(0, 0, 0, .7); color: #fff; font-size: 15px;
    }
    .sp .error {
      position: absolute; top: 50%; left: 50%; width: min(520px, calc(100% - 32px)); transform: translate(-50%, -50%);
      padding: 20px; background: #151b20; border: 1px solid #3a4853; border-radius: 8px;
    }
    .sp .error h2 { margin: 0 0 8px; font-size: 16px; color: #e6edf2; }
    .sp .error p { margin: 0 0 14px; color: #b7c3cc; word-break: break-word; }
    .sp .error button + button { margin-left: 8px; }
  `;

  // Built element by element: a page's Trusted Types policy can forbid setting HTML from strings.
  function el(tag, attrs = {}, ...children) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (value === true) element.setAttribute(name, '');
      else element.setAttribute(name, value);
    }
    element.append(...children);
    return element;
  }
  const iconButton = (id, attrs = {}) => el('button', { class: 'icon', 'data-id': id, type: 'button', ...attrs });
  function markup() {
    return [
      el('video', { id: 'video', playsinline: true }),
      el('header', { class: 'bar' }, el('span', { class: 'title' }), iconButton('copy'), iconButton('original', { hidden: true })),
      el('button', { class: 'unmute', type: 'button', 'data-text': 'tapToUnmute', hidden: true }),
      el('footer', { class: 'controls' },
        el('input', { class: 'seek', type: 'range', min: '0', max: '1000', value: '0', step: '1', 'data-label': 'seek' }),
        el('div', { class: 'row' },
          iconButton('play'),
          el('span', { class: 'time' }, '0:00'),
          el('span', { class: 'spacer' }),
          el('button', { class: 'text', id: 'menu-quality', 'data-id': 'quality', type: 'button', 'aria-haspopup': 'menu', hidden: true },
            el('span', { id: 'quality-value', 'data-id': 'quality-value' })),
          el('button', { class: 'text', 'data-id': 'speed', type: 'button', 'aria-haspopup': 'menu' },
            el('span', { 'data-id': 'speed-value' }, '1x')),
          el('span', { class: 'volume-box' },
            iconButton('mute'),
            el('input', { class: 'volume', type: 'range', min: '0', max: '1', step: '0.05', value: '1', 'data-label': 'volume' })),
          iconButton('pip'),
          iconButton('fill', { hidden: true }),
          iconButton('fullscreen')),
        el('div', { class: 'menu', role: 'menu', hidden: true },
          el('div', { class: 'heading', 'data-id': 'heading' }),
          el('div', { id: 'menu-options', 'data-id': 'options' }))),
      el('section', { id: 'error', class: 'error', role: 'alert', hidden: true },
        el('h2', { id: 'error-title' }), el('p'),
        el('button', { 'data-id': 'retry', type: 'button', 'data-text': 'retry' }),
        el('button', { 'data-id': 'error-original', type: 'button', 'data-text': 'sitePlayer', hidden: true })),
    ];
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rest = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
  }

  /**
   * Builds the player into root (a document body or a shadow root) and wires its controls.
   * keyTarget gets the keyboard; fullscreenTarget goes full screen. onFill(on) and onBack(time)
   * are for a player in a page; without them their buttons stay hidden.
   */
  function create({ root, t, title, src, keyTarget, fullscreenTarget, onFill, onBack, onRetry, unfillOnEnd = false, isTab = false, muted = false }) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    // Where the list of choices sits, above its button. Kept in the sheet rather than inline,
    // which a page's style policy can block.
    sheet.insertRule('.sp .menu { left: 12px; }', sheet.cssRules.length);
    const menuPlace = sheet.cssRules[sheet.cssRules.length - 1].style;
    const sheetHost = root.adoptedStyleSheets ? root : document;
    sheetHost.adoptedStyleSheets = [...sheetHost.adoptedStyleSheets, sheet];

    const box = document.createElement('div');
    box.className = 'sp';
    if (isTab) box.style.position = 'fixed';
    box.append(...markup());
    root.append(box);
    const q = (selector) => box.querySelector(selector);
    const part = (id) => box.querySelector(`[data-id="${id}"]`);
    box.querySelectorAll('[data-text]').forEach((element) => { element.textContent = t(element.dataset.text); });
    box.querySelectorAll('[data-label]').forEach((element) => element.setAttribute('aria-label', t(element.dataset.label)));

    const video = q('video');
    const titleElement = q('.title');
    titleElement.textContent = title;
    titleElement.title = src;

    function setIcon(button, icon, label) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', ICONS[icon]);
      svg.append(path);
      button.replaceChildren(svg);
      button.setAttribute('aria-label', label);
      button.title = label;
    }

    // Playing. The browser may refuse to start with sound, and then it starts muted with a
    // button to turn the sound on.
    const unmute = q('.unmute');
    async function startPlaying() {
      try {
        await video.play();
      } catch (error) {
        if (error?.name !== 'NotAllowedError' || video.muted) return;
        video.muted = true;
        try {
          await video.play();
          unmute.hidden = false;
        } catch {
          video.muted = false;
        }
      }
    }
    unmute.addEventListener('click', () => { video.muted = false; unmute.hidden = true; });
    video.addEventListener('volumechange', () => { if (!video.muted) unmute.hidden = true; });

    const playButton = part('play');
    const togglePlay = () => (video.paused ? video.play().catch(() => {}) : video.pause());
    const showPlayState = () => setIcon(playButton, video.paused ? 'play' : 'pause', video.paused ? t('play') : t('pause'));
    video.addEventListener('play', showPlayState);
    video.addEventListener('pause', showPlayState);
    playButton.addEventListener('click', togglePlay);
    video.addEventListener('click', () => (unmute.hidden ? togglePlay() : unmute.click()));
    showPlayState();

    // A live stream has no end; its seek bar covers what the stream keeps, if anything.
    const seek = q('.seek');
    const timeText = q('.time');
    function seekRange() {
      if (Number.isFinite(video.duration)) return [0, video.duration];
      const { seekable } = video;
      return seekable.length ? [seekable.start(0), seekable.end(seekable.length - 1)] : [0, 0];
    }
    let seeking = false;
    function showTime() {
      const [start, end] = seekRange();
      seek.disabled = end - start < 1;
      if (!seeking && end > start) seek.value = String(Math.round(((video.currentTime - start) / (end - start)) * 1000));
      if (!Number.isFinite(video.duration) && video.duration > 0) {
        const live = document.createElement('span');
        live.className = 'live';
        live.textContent = t('live');
        timeText.replaceChildren(live);
      } else {
        timeText.textContent = Number.isFinite(video.duration) && video.duration > 0
          ? `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`
          : formatTime(video.currentTime);
      }
    }
    ['timeupdate', 'durationchange', 'loadedmetadata', 'progress'].forEach((type) => video.addEventListener(type, showTime));
    seek.addEventListener('input', () => {
      seeking = true;
      const [start, end] = seekRange();
      video.currentTime = start + (Number(seek.value) / 1000) * (end - start);
    });
    seek.addEventListener('change', () => { seeking = false; });
    showTime();

    const muteButton = part('mute');
    const volume = q('.volume');
    function showVolume() {
      const silent = video.muted || video.volume === 0;
      setIcon(muteButton, silent ? 'muted' : 'volume', silent ? t('unmute') : t('mute'));
      volume.value = String(video.muted ? 0 : video.volume);
    }
    video.addEventListener('volumechange', showVolume);
    // Set before the controls first show it: a change on a video that isn't in the page yet can
    // pass without a volumechange event, and the button would show sound on a muted video.
    video.muted = muted;
    muteButton.addEventListener('click', () => {
      if (video.muted || video.volume === 0) {
        video.muted = false;
        if (video.volume === 0) video.volume = 1;
      } else video.muted = true;
    });
    volume.addEventListener('input', () => {
      video.volume = Number(volume.value);
      video.muted = video.volume === 0;
    });
    showVolume();

    // Full screen takes the whole player, so the controls stay.
    const fullscreenButton = part('fullscreen');
    const toggleFullscreen = () => (document.fullscreenElement
      ? document.exitFullscreen()
      : fullscreenTarget.requestFullscreen()).catch(() => {});
    function showFullscreen() {
      const on = document.fullscreenElement === fullscreenTarget;
      setIcon(fullscreenButton, on ? 'exitFullscreen' : 'fullscreen', on ? t('exitFullscreen') : t('fullscreen'));
    }
    document.addEventListener('fullscreenchange', showFullscreen);
    fullscreenButton.addEventListener('click', toggleFullscreen);
    video.addEventListener('dblclick', toggleFullscreen);
    showFullscreen();

    // Filling the page, for a player in a page. A tab of its own already fills the window.
    const fillButton = part('fill');
    let filled = false;
    const showFill = () => setIcon(fillButton, filled ? 'unfill' : 'fill', filled ? t('exitFillPage') : t('fillPage'));
    function setFilled(on) {
      filled = on;
      showFill();
    }
    function toggleFill() {
      if (!onFill) return;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      setFilled(!filled);
      onFill(filled);
    }
    fillButton.hidden = !onFill;
    fillButton.addEventListener('click', toggleFill);
    // When the setting is on, the page comes back once the video ends.
    video.addEventListener('ended', () => { if (filled && unfillOnEnd) toggleFill(); });
    showFill();

    // Speed and quality each open a short list of choices above the controls.
    const menu = q('.menu');
    let menuFor = null;
    function closeMenu() {
      menu.hidden = true;
      menuFor?.setAttribute('aria-expanded', 'false');
      menuFor = null;
    }
    function openChoices(button, heading, choices, current, onPick) {
      if (menuFor === button) return closeMenu();
      closeMenu();
      part('heading').textContent = heading;
      part('options').replaceChildren(...choices.map((choice) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'menuitemradio');
        item.setAttribute('aria-checked', String(choice.value === current));
        item.textContent = choice.label;
        item.addEventListener('click', () => { onPick(choice.value); closeMenu(); });
        return item;
      }));
      menu.hidden = false;
      // Centred over the button, without leaving the player.
      const controls = q('.controls').getBoundingClientRect();
      const anchor = button.getBoundingClientRect();
      const width = menu.offsetWidth;
      const left = anchor.left - controls.left + anchor.width / 2 - width / 2;
      menuPlace.left = `${Math.max(8, Math.min(left, controls.width - width - 8))}px`;
      menuFor = button;
      button.setAttribute('aria-expanded', 'true');
      return undefined;
    }
    box.addEventListener('click', (event) => {
      if (menuFor && !menu.contains(event.target) && !menuFor.contains(event.target)) closeMenu();
    });

    const speedButton = part('speed');
    speedButton.title = t('speed');
    speedButton.setAttribute('aria-label', t('speed'));
    speedButton.addEventListener('click', (event) => {
      event.stopPropagation();
      openChoices(speedButton, t('speed'), SPEEDS.map((value) => ({ value, label: `${value}x` })), String(video.playbackRate), (value) => {
        video.playbackRate = Number(value);
        video.defaultPlaybackRate = video.playbackRate;
        part('speed-value').textContent = `${value}x`;
      });
    });

    // Qualities, filled in once a stream says it has more than one.
    const quality = { choices: [], value: AUTO, autoLabel: t('auto'), pick: null };
    const qualityButton = part('quality');
    qualityButton.title = t('quality');
    qualityButton.setAttribute('aria-label', t('quality'));
    function showQuality() {
      const picked = quality.choices.find((choice) => choice.value === quality.value);
      part('quality-value').textContent = quality.value === AUTO ? quality.autoLabel : picked?.label || '';
    }
    qualityButton.addEventListener('click', (event) => {
      event.stopPropagation();
      openChoices(qualityButton, t('quality'),
        quality.choices.map((choice) => (choice.value === AUTO ? { ...choice, label: quality.autoLabel } : choice)),
        quality.value, (value) => {
          quality.value = value;
          quality.pick?.(Number(value));
          showQuality();
        });
    });

    const copyButton = part('copy');
    setIcon(copyButton, 'copy', t('copyUrl'));
    copyButton.addEventListener('click', async () => {
      await navigator.clipboard.writeText(src).catch(() => {});
      setIcon(copyButton, 'copied', t('copied'));
      setTimeout(() => setIcon(copyButton, 'copy', t('copyUrl')), 1200);
    });

    const pipButton = part('pip');
    setIcon(pipButton, 'pip', t('pictureInPicture'));
    pipButton.hidden = !document.pictureInPictureEnabled;
    pipButton.addEventListener('click', async () => {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await video.requestPictureInPicture();
      } catch {
        // The video has nothing to show yet.
      }
    });

    // Back to the site's own player, at the same point of the video.
    setIcon(part('original'), 'original', t('sitePlayer'));
    for (const button of [part('original'), part('error-original')]) {
      button.hidden = !onBack;
      button.addEventListener('click', () => {
        closeMenu();
        video.pause();
        onBack?.(Number.isFinite(video.duration) ? video.currentTime : null);
      });
    }

    const errorBox = q('.error');
    part('retry').addEventListener('click', () => { errorBox.hidden = true; onRetry(); });
    function showError(heading, detail) {
      errorBox.querySelector('h2').textContent = heading;
      errorBox.querySelector('p').textContent = detail;
      errorBox.hidden = false;
      box.classList.remove('idle');
    }

    // The controls hide while the video plays and the mouse is still, and at once when it leaves.
    let idleTimer;
    function wake() {
      box.classList.remove('idle');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!video.paused && errorBox.hidden && menu.hidden && !box.querySelector('.controls:hover, .bar:hover')) {
          box.classList.add('idle');
        }
      }, 2500);
    }
    box.addEventListener('mousemove', wake);
    box.addEventListener('mouseleave', () => {
      if (video.paused || !errorBox.hidden) return;
      closeMenu();
      clearTimeout(idleTimer);
      box.classList.add('idle');
    });
    video.addEventListener('pause', wake);
    wake();

    keyTarget.addEventListener('keydown', (event) => {
      // Only real key presses: in a page, the page's own scripts can dispatch fake ones.
      if (!event.isTrusted) return;
      wake();
      const target = event.composedPath()[0];
      if (target?.closest?.('select') || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target?.closest?.('button') && (event.key === ' ' || event.key === 'Enter')) return;
      const actions = {
        ' ': togglePlay,
        k: togglePlay,
        ArrowLeft: () => { video.currentTime -= 5; },
        ArrowRight: () => { video.currentTime += 5; },
        ArrowUp: () => { video.volume = Math.min(1, video.volume + 0.1); video.muted = false; },
        ArrowDown: () => { video.volume = Math.max(0, video.volume - 0.1); },
        m: () => { video.muted = !video.muted; },
        f: toggleFullscreen,
        w: toggleFill,
        Escape: () => {
          if (!menu.hidden) closeMenu();
          else if (filled && !document.fullscreenElement) toggleFill();
        },
      };
      const action = actions[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      action();
    });

    return {
      video,
      box,
      startPlaying,
      showError,
      setFilled,
      /** choices: [{ value: String(level index), label }], best first. pick(index) switches. */
      setQualities(choices, pick) {
        if (choices.length < 2) return;
        quality.choices = [{ value: AUTO, label: t('auto') }, ...choices];
        quality.pick = pick;
        part('quality').hidden = false;
        showQuality();
      },
      setAutoQuality(label) {
        quality.autoLabel = label ? t('autoLevel', label) : t('auto');
        showQuality();
      },
    };
  }

  function networkMessage(t, code) {
    if (code === 401 || code === 403) return [t('errRefusedTitle', code), t('errRefusedDetail')];
    if (code === 410) return [t('errExpiredTitle'), t('errExpiredDetail')];
    if (code === 404) return [t('errNotFoundTitle'), t('errNotFoundDetail')];
    if (code) return [t('errServerTitle', code), t('errServerDetail')];
    return [t('errOfflineTitle'), t('errOfflineDetail')];
  }

  function hlsErrorMessage(t, data) {
    if (data.type === Hls.ErrorTypes.KEY_SYSTEM_ERROR || /^key/i.test(data.details)) return [t('errDrmTitle'), t('errDrmDetail')];
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) return networkMessage(t, data.response?.code);
    return [t('errPlayTitle'), data.details || t('errDecodeDetail')];
  }

  /** Puts a stream's qualities into the menu, best first, and keeps Auto's label current. */
  function levelLabel({ height, frameRate, bitrate }) {
    if (!height) return `${Math.round(bitrate / 1000)} kbps`;
    return frameRate >= 48 ? `${height}p${Math.round(frameRate)}` : `${height}p`;
  }

  function offerQualities(ui, hls) {
    const label = (level) => levelLabel({ height: level.height, frameRate: Number(level.attrs?.['FRAME-RATE']), bitrate: level.bitrate });
    const choices = hls.levels
      .map((level, index) => ({ value: String(index), label: label(level), height: level.height || 0, bitrate: level.bitrate }))
      .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
    ui.setQualities(choices, (index) => { hls.currentLevel = index; });
    hls.on(Hls.Events.LEVEL_SWITCHED, (_event, { level }) => {
      const current = hls.levels[level];
      ui.setAutoQuality(current?.height ? label(current) : '');
    });
  }

  return { create, AUTO, networkMessage, hlsErrorMessage, offerQualities };
})();
