// Decisions that need no browser API, shared by the background worker and the pages.

const HLS_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'application/mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl',
]);
// Types that say nothing about the content. Many CDNs answer playlists with one of these.
const VAGUE_TYPES = new Set(['', 'text/plain', 'application/octet-stream', 'binary/octet-stream']);

function contentTypeOf(value) {
  return (value || '').split(';')[0].trim().toLowerCase();
}

/** Whether a response is an HLS playlist, judged by its URL and its content type together. */
export function isHlsResponse({ url, method = 'GET', status = 200, contentType = '' }) {
  if (method !== 'GET') return false;
  if (!(status >= 200 && status < 300) && status !== 304) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const type = contentTypeOf(contentType);
  if (HLS_TYPES.has(type)) return true;
  if (!VAGUE_TYPES.has(type)) return false;
  return /\.m3u8(\/|$)/i.test(parsed.pathname) || /\.m3u8/i.test(parsed.search);
}

// Video files: formats the browser plays by itself.
const FILE_TYPES = {
  'video/mp4': 'MP4',
  'video/x-m4v': 'M4V',
  'video/webm': 'WebM',
  'video/quicktime': 'MOV',
  'video/ogg': 'OGV',
};
const FILE_EXTENSIONS = { mp4: 'MP4', m4v: 'M4V', webm: 'WebM', mov: 'MOV', ogv: 'OGV' };
/** Anything smaller is usually an ad or an intro, and stays off the list. */
export const MIN_FILE_BYTES = 5 * 1024 * 1024;

function fileExtensionFormat(url) {
  try {
    const match = new URL(url).pathname.match(/\.([a-z0-9]+)$/i);
    return (match && FILE_EXTENSIONS[match[1].toLowerCase()]) || null;
  } catch {
    return null;
  }
}

/** Whether a pasted URL is a video file. Anything else is treated as HLS. */
export function isFileUrl(url) {
  return fileExtensionFormat(url) !== null;
}

function totalBytes(contentRange, contentLength) {
  const total = /\/(\d+|\*)\s*$/.exec(contentRange || '');
  if (total) return total[1] === '*' ? null : Number(total[1]);
  const length = Number(contentLength);
  return Number.isFinite(length) && length > 0 ? length : null;
}

/**
 * Whether a response is a whole video file: returns { format, size }, or null if it isn't.
 * Only media requests count (<video src>). An MP4 a streaming site fetches from script is just a
 * segment, which couldn't be played on its own.
 */
export function videoFileInfo({
  url, resourceType, method = 'GET', status = 200, contentType = '', contentRange, contentLength,
}) {
  if (resourceType !== 'media' || method !== 'GET') return null;
  if (status !== 200 && status !== 206 && status !== 304) return null;
  if (!/^https?:/i.test(url)) return null;
  const type = contentTypeOf(contentType);
  const format = FILE_TYPES[type] || (VAGUE_TYPES.has(type) && type !== 'text/plain' ? fileExtensionFormat(url) : null);
  if (!format) return null;
  const size = totalBytes(contentRange, contentLength);
  if (size !== null && size < MIN_FILE_BYTES) return null;
  return { format, size };
}

export function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function attributes(line) {
  const out = {};
  // Anchored after a separator: unanchored, one huge malicious line makes this match take minutes.
  const pattern = /[:,]([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  for (let match; (match = pattern.exec(line)); ) {
    out[match[1]] = match[2].replace(/^"|"$/g, '');
  }
  return out;
}

function resolve(uri, base) {
  try {
    return new URL(uri, base).href;
  } catch {
    return null;
  }
}

const MAX_CHILDREN = 300;
export const MAX_URL_LENGTH = 4096;
const MAX_TAB_BYTES = 256 * 1024;

/** Parses a playlist. Text that isn't one gives kind: 'unknown'. */
export function parsePlaylist(text, baseUrl) {
  if (!/^﻿?#EXTM3U/.test(text)) return { kind: 'unknown' };
  const variants = [];
  const children = [];
  const addChild = (url) => {
    if (url && url.length <= MAX_URL_LENGTH && children.length < MAX_CHILDREN) children.push(url);
  };
  let pendingVariant = null;
  let durationSec = 0;
  let segments = 0;
  let ended = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      pendingVariant = attributes(line);
    } else if (pendingVariant && !line.startsWith('#')) {
      const url = resolve(line, baseUrl);
      if (url) {
        addChild(url);
        if (variants.length < MAX_CHILDREN) {
          variants.push({ height: Number((pendingVariant.RESOLUTION || '').split('x')[1]) || null });
        }
      }
      pendingVariant = null;
    } else if (line.startsWith('#EXT-X-MEDIA:') || line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) {
      const uri = attributes(line).URI;
      addChild(uri && resolve(uri, baseUrl));
    } else if (line.startsWith('#EXTINF:')) {
      durationSec += parseFloat(line.slice(8)) || 0;
      segments += 1;
    } else if (line === '#EXT-X-ENDLIST') {
      ended = true;
    }
  }

  if (variants.length || children.length) return { kind: 'master', variants, children };
  return {
    kind: 'media',
    segments,
    live: !ended,
    durationSec: ended ? Math.round(durationSec) : null,
  };
}

/**
 * Caps one tab's data, so one page can't fill the storage all tabs share. A master's child list is
 * what grows, so those go first, largest first: the row stays and can still be played. Then the
 * oldest rows go.
 */
export function trimToBudget(entries, maxBytes = MAX_TAB_BYTES) {
  const size = (value) => JSON.stringify(value).length;
  const kept = [...entries];
  while (size(kept) > maxBytes) {
    const masters = kept.filter((entry) => entry.children);
    if (!masters.length) break;
    const largest = masters.reduce((a, b) => (size(a) >= size(b) ? a : b));
    const { children, variants, kind, ...rest } = largest;
    kept[kept.indexOf(largest)] = rest;
  }
  while (kept.length > 1 && size(kept) > maxBytes) kept.shift();
  return kept;
}

function withoutQuery(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return url;
  }
}

/** Folds the playlists under a master into one row per video: masters first, then newest first. */
export function groupEntries(entries) {
  // Only from the same origin: an ad iframe must not hide the real video with a fake master.
  const children = new Set();
  for (const entry of entries) {
    for (const child of entry.children || []) {
      children.add(`${entry.referer}|${child}`);
      children.add(`${entry.referer}|${withoutQuery(child)}`);
    }
  }
  return entries
    .filter((entry) => {
      if (entry.kind === 'master') return true;
      return !children.has(`${entry.referer}|${entry.url}`)
        && !children.has(`${entry.referer}|${withoutQuery(entry.url)}`);
    })
    .sort((a, b) => (b.kind === 'master') - (a.kind === 'master') || b.time - a.time);
}

/** A row's name: the last two path parts, because index.m3u8 alone says nothing. */
export function displayName(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean).map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
    return parts.slice(-2).join('/') || new URL(url).hostname;
  } catch {
    return url;
  }
}

/** A quality's label. High frame rates are shown, or two 720p options would look the same. */
export function levelLabel({ height, frameRate, bitrate }) {
  if (!height) return `${Math.round(bitrate / 1000)} kbps`;
  return frameRate >= 48 ? `${height}p${Math.round(frameRate)}` : `${height}p`;
}

export function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

/** The player page's URL. Encoded exactly once, so the player gets back the original URL unchanged. */
export function playerPath({ url, referer, title, kind }) {
  const params = new URLSearchParams({ src: url });
  if (kind === 'file' || isFileUrl(url)) params.set('kind', 'file');
  if (referer) params.set('ref', referer);
  if (title) params.set('title', title);
  return `player.html?${params}`;
}

/** The headers that present a request as coming from the page. Only for http(s) pages. */
export function refererHeaders(referer) {
  try {
    const parsed = new URL(referer);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return [];
    return [
      { header: 'Referer', operation: 'set', value: parsed.href },
      { header: 'Origin', operation: 'set', value: parsed.origin },
    ];
  } catch {
    return [];
  }
}
