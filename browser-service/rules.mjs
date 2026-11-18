import { Buffer } from 'node:buffer';

const EVENT_PATH = /^\/e\/[a-z\d_-]+\/?$/i;
const IMAGE_PATH = /^\/public\/event_image\/filename\/\d+\/[^/]+$/;
const WAF_HOST = /^[a-z\d]+\.[a-z\d]+\.[a-z\d-]+\.token\.awswaf\.com$/i;
const secure = url => url.protocol === 'https:' && !url.username && !url.password && !url.port;

export function eventUrl(input) {
  if (typeof input !== 'string' || input.length > 2048) return null;
  try {
    const url = new URL(input);
    if (!secure(url) || !['livepocket.jp', 't.livepocket.jp'].includes(url.hostname) || !EVENT_PATH.test(url.pathname)) return null;
    // The legacy host redirects to a blocked page; the canonical event is the
    // same on the current LivePocket host.
    url.hostname = 'livepocket.jp';
    url.search = '';
    url.hash = '';
    return url;
  } catch { return null; }
}

export function imageUrl(input, base) {
  try {
    const url = new URL(input, base);
    const pathname = decodeURIComponent(url.pathname);
    if (!secure(url) || url.hostname !== 'livepocket.jp' || !IMAGE_PATH.test(pathname) || /[\\\u0000-\u001f]/.test(pathname) || pathname.split('/').some(part => part === '.' || part === '..') || /(?:no[_-]?image|noimg|placeholder)/i.test(pathname)) return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

export function allowedRequest(input, method, type, expectedEvent) {
  let url;
  try { url = new URL(input); } catch { return false; }
  if (!secure(url)) return false;
  if (type === 'document' && method === 'GET') return url.origin === expectedEvent.origin && url.pathname.replace(/\/$/, '') === expectedEvent.pathname.replace(/\/$/, '');
  if (type === 'fetch' && method === 'GET' && imageUrl(url.href)) return true;
  return WAF_HOST.test(url.hostname) && ['script', 'xhr', 'fetch'].includes(type) && ['GET', 'POST'].includes(method);
}

export function imageFormat(bytes) {
  if (!Buffer.isBuffer(bytes)) return null;
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { contentType: 'image/png', extension: '.png' };
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { contentType: 'image/jpeg', extension: '.jpg' };
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return { contentType: 'image/gif', extension: '.gif' };
  if (bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))) return { contentType: 'image/webp', extension: '.webp' };
  if (bytes.length >= 16 && bytes.toString('ascii', 4, 8) === 'ftyp') {
    const size = bytes.readUInt32BE(0);
    if (size >= 16 && size <= bytes.length && size <= 1024) {
      const brands = [bytes.toString('ascii', 8, 12)];
      for (let i = 16; i + 4 <= size; i += 4) brands.push(bytes.toString('ascii', i, i + 4));
      if (brands.includes('avif') || brands.includes('avis')) return { contentType: 'image/avif', extension: '.avif' };
    }
  }
  return null;
}
