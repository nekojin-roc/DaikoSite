import { allowedRequest, imageFormat, imageUrl } from './rules.mjs';

export const MAX_IMAGE = 50 * 1024 * 1024;
const TIMEOUT = 45_000;

export class ImportError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Each import receives a fresh, ephemeral browser context with no credentials. */
export async function importEvent(browser, event) {
  const context = await browser.newContext({ locale:'ja-JP', serviceWorkers:'block', acceptDownloads:false });
  let timeout;
  try {
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new ImportError(504, 'LivePocket verification timed out.')), TIMEOUT);
      timeout.unref();
    });
    const operation = (async () => {
      await context.routeWebSocket('**/*', ws => ws.close());
      const page = await context.newPage();
      page.setDefaultTimeout(TIMEOUT);
      let redirected = false;
      page.on('response', response => {
        if (response.request().resourceType() === 'document' && response.status() >= 300 && response.status() < 400) redirected = true;
      });
      await context.route('**/*', async route => {
        try {
          const request = route.request();
          if (request.resourceType() === 'document' && request.frame() !== page.mainFrame()) return await route.abort();
          if (!allowedRequest(request.url(), request.method(), request.resourceType(), event)) return await route.abort();
          // Use Chromium's network stack for the WAF; the independent proxy
          // enforces destination, DNS, tunnel-size and lifetime limits.
          await route.continue();
        } catch { await route.abort().catch(() => {}); }
      });
      await page.goto(event.href, {waitUntil:'domcontentloaded', timeout:TIMEOUT});
      const heading = page.locator('h1.heading01').first();
      await heading.waitFor({state:'attached', timeout:TIMEOUT});
      const finalUrl = new URL(page.url());
      if (redirected || finalUrl.origin !== event.origin || finalUrl.pathname.replace(/\/$/, '') !== event.pathname.replace(/\/$/, '')) throw new ImportError(502, 'LivePocket redirected to an unsupported location.');
      const name = (await heading.textContent() || '').replace(/\s+/gu, ' ').trim();
      if (!name || name.length > 200) throw new ImportError(422, 'The event title could not be found.');
      const { candidates, ...schedule } = await page.evaluate(() => {
        const image = document.querySelector('img[alt="イベントイメージ画像"]');
        const candidates = [image?.getAttribute('src'), image?.getAttribute('data-src'), document.querySelector('meta[property="og:image:secure_url"]')?.getAttribute('content'), document.querySelector('meta[property="og:image"]')?.getAttribute('content')].filter(Boolean);

        for (const details of document.querySelectorAll('.event-detail-info__list')) {
          const dateBlock = details.querySelector('.event-detail-info__date')?.closest('.event-detail-info__block');
          const date = dateBlock?.querySelector(':scope > .event-detail-info__data')?.textContent?.trim();
          const times = details.querySelectorAll('.event-detail-info__data--time .event-detail-info-time');
          const performance = Array.from(times).find(time => {
            const label = time.querySelector('.event-detail-info-time__title')?.textContent?.trim();
            return label === '開演' || label === '開演時間' || label === '開演時刻';
          });
          const startTime = performance?.querySelector('.event-detail-info-time__date')?.textContent?.trim();
          if (date && startTime) return { candidates, date, startTime };
        }
        return { candidates };
      });
      const original = candidates.map(candidate => imageUrl(candidate, event)).find(Boolean);
      if (!original) throw new ImportError(422, "The event's original image could not be found.");
      const image = await page.evaluate(async ({url, limit}) => {
        const response = await fetch(url, {credentials:'same-origin', redirect:'error'});
        if (!response.ok || !response.body) throw new Error('Image unavailable');
        const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
        const reader = response.body.getReader(), chunks = []; let size = 0;
        while (true) {
          const {value, done} = await reader.read();
          if (done) break;
          size += value.length;
          if (size > limit) {await reader.cancel(); throw new Error('Image too large');}
          chunks.push(value);
        }
        const all = new Uint8Array(size); let at = 0;
        for (const chunk of chunks) { all.set(chunk, at); at += chunk.length; }
        let binary = '';
        for (let i = 0; i < all.length; i += 32768) binary += String.fromCharCode(...all.subarray(i, i + 32768));
        return {contentType, image:btoa(binary)};
      }, {url:original.href, limit:MAX_IMAGE});
      const bytes = Buffer.from(image.image, 'base64');
      const format = imageFormat(bytes);
      if (!format || format.contentType !== image.contentType || bytes.length > MAX_IMAGE) throw new ImportError(422, 'The event image format is invalid.');
      return {name, image:image.image, ...format, ...schedule};
    })();
    return await Promise.race([operation, deadline]);
  } catch (error) {
    if (error instanceof ImportError) throw error;
    if (error?.name === 'TimeoutError') throw new ImportError(504, 'LivePocket verification timed out.');
    throw new ImportError(502, 'LivePocket could not be reached or blocked access.');
  } finally {
    clearTimeout(timeout);
    await context.close().catch(() => {});
  }
}
