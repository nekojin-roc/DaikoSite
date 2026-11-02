import test from 'node:test';
import assert from 'node:assert/strict';
import { EventImportError, fetchEventImport } from '../dist/event-import.js';

const TICKET_URL = 'https://ticketdive.com/event/kuruidaore15';
const LIVE_URL = 'https://livepocket.jp/e/avsvo';
const TICKET_IMAGE = 'https://storage.googleapis.com/playyte-ticket-prod_event/original.webp';
const LIVE_IMAGE = 'https://livepocket.jp/public/event_image/filename/710713/original.webp';
const WEBP = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAFcAAAAASUVORK5CYII=', 'base64');
const page = html => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
const picture = (body = WEBP, contentType = 'image/webp', headers = {}) => new Response(body, { headers: { 'content-type': contentType, ...headers } });
const liveHtml = (image = LIVE_IMAGE, title = '11/04 DaTuRa-ダチュラ-presents. 「ダチュラ学園」') => `<h1 class="heading01">${title}</h1><img alt="イベントイメージ画像" src="${image}">`;

function mockFetch(responses) {
  const calls = [];
  const fetch = async (input, options) => {
    const url = String(input);
    calls.push({ url, options });
    const response = responses[url];
    assert.ok(response, `Unexpected fetch: ${url}`);
    return typeof response === 'function' ? response(options) : response;
  };
  return { fetch, calls };
}

function errorStatus(status, message) {
  return error => error instanceof EventImportError && error.statusCode === status && (!message || message.test(error.message));
}

test('TicketDive decodes the title and downloads original bytes outside the Next image optimizer', async () => {
  const wrapped = `/_next/image?url=${encodeURIComponent(TICKET_IMAGE)}&amp;w=1120&amp;q=75`;
  const { fetch, calls } = mockFetch({
    [TICKET_URL]: page(`<meta property="og:title" content="Wrong fallback | TicketDive"><meta property="og:image" content="https://storage.googleapis.com/ticketdive/ogp.webp"><span class="Typography_root__new EventInfoUnit_name__changed">MAD&#x27;S iNK presents「狂い倒れvol.15」</span><img alt="fv画像" class="EventImage_image__changed" src="${wrapped}" srcset="${wrapped.replace('1120', '256')} 256w, ${wrapped} 1120w">`),
    [TICKET_IMAGE]: picture(),
  });
  const result = await fetchEventImport(TICKET_URL, { fetch });
  assert.equal(result.name, 'MAD\'S iNK presents「狂い倒れvol.15」');
  assert.deepEqual(result.image, WEBP);
  assert.equal(result.contentType, 'image/webp');
  assert.equal(result.extension, '.webp');
  assert.deepEqual(calls.map(call => call.url), [TICKET_URL, TICKET_IMAGE]);
  for (const { options } of calls) {
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.cookie, undefined);
    assert.equal(options.headers.authorization, undefined);
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test('LivePocket uses the complete h1 title and main image, preserving original image data', async () => {
  const { fetch } = mockFetch({
    [LIVE_URL]: page(`<meta property="og:title" content="11/04 DaTuRa-ダチ...のチケット情報｜LivePocket（ライブポケット）">${liveHtml()}<img alt="イベントイメージ画像" src="https://livepocket.jp/public/event_image/filename/999/recommendation.webp">`),
    [LIVE_IMAGE]: picture(),
  });
  const result = await fetchEventImport(`  ${LIVE_URL}#tickets  `, { fetch });
  assert.equal(result.name, '11/04 DaTuRa-ダチュラ-presents. 「ダチュラ学園」');
  assert.deepEqual(result.image, WEBP);
});

test('chooses the largest srcset candidate when no optimized-image wrapper is present', async () => {
  const original = LIVE_IMAGE.replace('original', 'largest');
  const { fetch, calls } = mockFetch({
    [LIVE_URL]: page(`<h1 class="heading01">Event &amp; Friends</h1><img alt="イベントイメージ画像" src="${LIVE_IMAGE}" srcset="${LIVE_IMAGE} 200w, ${original} 2400w">`),
    [original]: picture(),
  });
  assert.equal((await fetchEventImport(LIVE_URL, { fetch })).name, 'Event & Friends');
  assert.equal(calls[1].url, original);
});

test('falls back to event-specific Open Graph metadata and strips the provider suffix', async () => {
  const { fetch } = mockFetch({
    [TICKET_URL]: page(`<meta property="og:title" content="A &amp; B | TicketDive"><meta property="og:image" content="${TICKET_IMAGE}">`),
    [TICKET_IMAGE]: picture(),
  });
  assert.equal((await fetchEventImport(TICKET_URL, { fetch })).name, 'A & B');
});

test('rejects arbitrary URLs, alternate ports, credentials and non-event provider paths before fetching', async () => {
  for (const url of [
    'http://ticketdive.com/event/abc', 'https://127.0.0.1/event/abc',
    'https://ticketdive.com.evil.example/event/abc', 'https://ticketdive.com:8443/event/abc',
    'https://user:password@ticketdive.com/event/abc', 'https://ticketdive.com/',
    'https://livepocket.jp/news/110', 'file:///etc/passwd', 'not a URL',
  ]) {
    await assert.rejects(fetchEventImport(url, { fetch: async () => assert.fail('Must not fetch invalid URL') }), errorStatus(400));
  }
});

test('supports www TicketDive and safe redirects within each provider', async () => {
  const initial = 'https://www.ticketdive.com/event/kuruidaore15';
  const movedImage = TICKET_IMAGE.replace('original', 'moved');
  const { fetch, calls } = mockFetch({
    [initial]: new Response(null, { status: 301, headers: { location: TICKET_URL } }),
    [TICKET_URL]: page(`<span class="EventInfoUnit_name__x">Live</span><img alt="fv画像" src="${TICKET_IMAGE}">`),
    [TICKET_IMAGE]: new Response(null, { status: 302, headers: { location: movedImage } }),
    [movedImage]: picture(),
  });
  assert.equal((await fetchEventImport(initial, { fetch })).name, 'Live');
  assert.equal(calls.length, 4);
  const legacy = 'https://t.livepocket.jp/e/avsvo';
  const lp = mockFetch({
    [legacy]: new Response(null, { status: 302, headers: { location: LIVE_URL } }),
    [LIVE_URL]: page(liveHtml()), [LIVE_IMAGE]: picture(),
  });
  assert.equal((await fetchEventImport(legacy, { fetch: lp.fetch })).extension, '.webp');
});

test('revalidates every redirect and never contacts private, unrelated, cross-provider or non-event destinations', async () => {
  for (const destination of [
    'http://127.0.0.1/admin', 'https://evil.example/event/abc',
    LIVE_URL, 'https://ticketdive.com/api/proxy?url=http://localhost',
  ]) {
    const { fetch, calls } = mockFetch({
      [TICKET_URL]: new Response(null, { status: 302, headers: { location: destination } }),
    });
    await assert.rejects(fetchEventImport(TICKET_URL, { fetch }), errorStatus(502, /redirect/i));
    assert.equal(calls.length, 1);
  }
  const { fetch, calls } = mockFetch({
    [LIVE_URL]: page(liveHtml()),
    [LIVE_IMAGE]: new Response(null, { status: 307, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }),
  });
  await assert.rejects(fetchEventImport(LIVE_URL, { fetch }), errorStatus(502));
  assert.equal(calls.length, 2);
});

test('limits redirect loops', async () => {
  const { fetch, calls } = mockFetch({
    [LIVE_URL]: () => new Response(null, { status: 302, headers: { location: LIVE_URL } }),
  });
  await assert.rejects(fetchEventImport(LIVE_URL, { fetch }), errorStatus(502, /redirect/i));
  assert.equal(calls.length, 6);
});

test('only downloads images in the explicit provider image locations', async () => {
  for (const image of [
    'https://evil.example/image.webp', 'http://livepocket.jp/public/event_image/filename/1/photo.webp',
    'https://livepocket.jp/public/event_image/filename/1/img_noimage.webp',
    'https://livepocket.jp/api/proxy?url=http://localhost',
    'https://livepocket.jp/public/event_image/filename/1/%2e%2e%2f%2e%2e%2fprivate',
    'https://storage.googleapis.com/another-bucket/event.webp',
    'data:image/png;base64,aGVsbG8=',
  ]) {
    const { fetch, calls } = mockFetch({ [LIVE_URL]: page(liveHtml(image)) });
    await assert.rejects(fetchEventImport(LIVE_URL, { fetch }), errorStatus(422, /image/i));
    assert.equal(calls.length, 1);
  }
  const wrapped = `/_next/image?url=${encodeURIComponent('https://127.0.0.1/private.png')}&w=400`;
  const { fetch, calls } = mockFetch({ [TICKET_URL]: page(`<span class="EventInfoUnit_name__x">Live</span><img alt="fv画像" src="${wrapped}">`) });
  await assert.rejects(fetchEventImport(TICKET_URL, { fetch }), errorStatus(422));
  assert.equal(calls.length, 1);
});

test('missing, generic, shortened and overly long titles fail clearly without downloading an image', async () => {
  for (const html of [
    `<img alt="イベントイメージ画像" src="${LIVE_IMAGE}">`,
    `<meta property="og:title" content="LivePocket（ライブポケット）">`,
    `<meta property="og:title" content="Some title...のチケット情報｜LivePocket（ライブポケット）">`,
    liveHtml(LIVE_IMAGE, 'あ'.repeat(201)),
  ]) {
    const { fetch, calls } = mockFetch({ [LIVE_URL]: page(html) });
    await assert.rejects(fetchEventImport(LIVE_URL, { fetch }), errorStatus(422, /title/i));
    assert.equal(calls.length, 1);
  }
  const { fetch } = mockFetch({ [TICKET_URL]: page('<meta property="og:title" content="Live | TicketDive"><meta property="og:image" content="https://storage.googleapis.com/ticketdive/ogp.webp">') });
  await assert.rejects(fetchEventImport(TICKET_URL, { fetch }), errorStatus(422, /image/i));
});

test('returns actionable errors for missing pages, provider access blocks, network failure and timeout', async () => {
  for (const [status, expected] of [[404, 422], [410, 422], [403, 502], [429, 502], [500, 502]]) {
    await assert.rejects(fetchEventImport(LIVE_URL, { fetch: async () => new Response(null, { status }) }), errorStatus(expected));
  }
  await assert.rejects(fetchEventImport(LIVE_URL, { fetch: async () => { throw new TypeError('fetch failed'); } }), errorStatus(502));
  await assert.rejects(fetchEventImport(LIVE_URL, { fetch: async () => { throw new DOMException('timed out', 'TimeoutError'); } }), errorStatus(504));
  await assert.rejects(fetchEventImport(LIVE_URL, { fetch: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }) }), errorStatus(502, /page/i));
});

test('requires raster MIME and matching magic bytes, rejecting SVG and disguised HTML', async () => {
  for (const response of [
    picture('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'image/svg+xml'),
    picture('<html>challenge page</html>', 'image/webp'),
    picture(png, 'image/webp'),
    picture(WEBP, 'application/octet-stream'),
    picture(Buffer.alloc(0), 'image/png'),
  ]) {
    const { fetch } = mockFetch({ [LIVE_URL]: page(liveHtml()), [LIVE_IMAGE]: response });
    await assert.rejects(fetchEventImport(LIVE_URL, { fetch }), errorStatus(422, /image/i));
  }
  const { fetch } = mockFetch({ [LIVE_URL]: page(liveHtml()), [LIVE_IMAGE]: picture(png, 'image/png') });
  const result = await fetchEventImport(LIVE_URL, { fetch });
  assert.equal(result.extension, '.png');
  assert.deepEqual(result.image, png);
});

test('bounds declared and streamed HTML size and cancels oversized bodies', async () => {
  let cancelled = false;
  const huge = new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
    headers: { 'content-type': 'text/html', 'content-length': String(5 * 1024 * 1024 + 1) },
  });
  await assert.rejects(fetchEventImport(LIVE_URL, { fetch: async () => huge }), errorStatus(422, /5 MB/));
  assert.equal(cancelled, true);
  const stream = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(5 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); controller.close(); },
  }), { headers: { 'content-type': 'text/html' } });
  await assert.rejects(fetchEventImport(LIVE_URL, { fetch: async () => stream }), errorStatus(422, /5 MB/));
});

test('bounds declared and streamed image size even when Content-Length is missing or false', async () => {
  const declared = mockFetch({
    [LIVE_URL]: page(liveHtml()),
    [LIVE_IMAGE]: picture(WEBP, 'image/webp', { 'content-length': String(50 * 1024 * 1024 + 1) }),
  });
  await assert.rejects(fetchEventImport(LIVE_URL, { fetch: declared.fetch }), errorStatus(422, /50 MB/));
  let cancelled = false;
  const chunk = new Uint8Array(1024 * 1024);
  const streamed = mockFetch({
    [LIVE_URL]: page(liveHtml()),
    [LIVE_IMAGE]: new Response(new ReadableStream({
      pull(controller) { controller.enqueue(chunk); },
      cancel() { cancelled = true; },
    }), { headers: { 'content-type': 'image/webp', 'content-length': '10' } }),
  });
  await assert.rejects(fetchEventImport(LIVE_URL, { fetch: streamed.fetch }), errorStatus(422, /50 MB/));
  assert.equal(cancelled, true);
});
