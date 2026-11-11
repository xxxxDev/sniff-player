import { localizePage, t } from './lib/i18n.js';
import { displayName, formatDuration, formatSize, groupEntries, playerPath } from './lib/media.js';

localizePage();

const list = document.getElementById('list');
const empty = document.getElementById('empty');

// ?tab= shows the list of a given tab when this page is opened as a tab of its own.
async function targetTab() {
  const requested = Number(new URLSearchParams(location.search).get('tab'));
  if (requested) return chrome.tabs.get(requested);
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

function describe(entry) {
  const parts = [new URL(entry.url).hostname];
  if (entry.kind === 'master') {
    const heights = [...new Set(entry.variants.map((v) => v.height).filter(Boolean))];
    if (heights.length) parts.push(t('qualitiesUpTo', heights.length, Math.max(...heights)));
    else if (entry.variants.length) parts.push(t('qualities', entry.variants.length));
  } else if (entry.kind === 'file') {
    parts.push(entry.size ? t('fileWithSize', entry.format, formatSize(entry.size)) : entry.format);
  } else if (entry.kind === 'media') {
    parts.push(entry.live ? t('live') : formatDuration(entry.durationSec));
  }
  return parts.join(' · ');
}

function play(entry, title) {
  chrome.tabs.create({
    url: playerPath({ url: entry.url, referer: entry.referer, title, kind: entry.kind }),
  });
  window.close();
}

function button(label, className, onClick) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.className = className;
  element.addEventListener('click', onClick);
  return element;
}

function render(entries, tab) {
  const videos = groupEntries(entries);
  empty.hidden = videos.length > 0;
  list.replaceChildren(...videos.map((entry) => {
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = displayName(entry.url);
    name.title = entry.url;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = describe(entry);
    const info = document.createElement('div');
    info.className = 'info';
    info.append(name, meta);

    const copy = button(t('copy'), 'copy', async () => {
      await navigator.clipboard.writeText(entry.url);
      copy.textContent = t('copied');
      setTimeout(() => { copy.textContent = t('copy'); }, 1200);
    });
    const item = document.createElement('li');
    item.append(info, copy, button(t('play'), 'play', () => play(entry, tab.title)));
    return item;
  }));
}

const tab = await targetTab();
const key = `tab:${tab?.id}`;
const load = async () => render((await chrome.storage.session.get(key))[key] || [], tab);
await load();
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes[key]) load();
});

document.getElementById('manual').addEventListener('submit', (event) => {
  event.preventDefault();
  play({ url: document.getElementById('manual-url').value.trim() });
});

// Off unless the person turns it on. It runs a script in a page only once a video is found there.
// The two below it apply only to a player in the page, so they wait until it is on.
const settings = { playInPage: 'play-in-page', fillOnPlay: 'fill-on-play', unfillOnEnd: 'unfill-on-end' };
const stored = await chrome.storage.local.get(Object.keys(settings));
const box = (name) => document.getElementById(settings[name]);
const showEnabled = () => {
  for (const name of ['fillOnPlay', 'unfillOnEnd']) box(name).disabled = !box('playInPage').checked;
};
for (const name of Object.keys(settings)) {
  box(name).checked = stored[name] === true;
  box(name).addEventListener('change', () => {
    chrome.storage.local.set({ [name]: box(name).checked });
    showEnabled();
  });
}
showEnabled();

// The buttons shown on a video under the pointer. All three show unless the person turns one off.
const buttonBoxes = { buttonPip: 'button-pip', buttonFill: 'button-fill', buttonSniff: 'button-sniff' };
const shown = await chrome.storage.local.get(Object.keys(buttonBoxes));
for (const [name, id] of Object.entries(buttonBoxes)) {
  const input = document.getElementById(id);
  input.checked = shown[name] !== false;
  input.addEventListener('change', () => chrome.storage.local.set({ [name]: input.checked }));
}
