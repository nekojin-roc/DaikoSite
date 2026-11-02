import { load } from "cheerio";

type Provider = "ticketdive" | "livepocket";
type Fetch = typeof globalThis.fetch;

const HTML_LIMIT = 5 * 1024 * 1024;
const IMAGE_LIMIT = 50 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export class EventImportError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = "EventImportError";
  }
}

function secureUrl(url: URL): boolean {
  return url.protocol === "https:" && !url.username && !url.password && !url.port;
}

function eventProvider(url: URL): Provider | undefined {
  if (!secureUrl(url)) return undefined;
  if (["ticketdive.com", "www.ticketdive.com"].includes(url.hostname) && /^\/event\/[a-z\d_-]+\/?$/i.test(url.pathname)) return "ticketdive";
  if (["livepocket.jp", "t.livepocket.jp"].includes(url.hostname) && /^\/e\/[a-z\d_-]+\/?$/i.test(url.pathname)) return "livepocket";
  return undefined;
}

function allowedImage(url: URL, provider: Provider): boolean {
  if (!secureUrl(url)) return false;
  let pathname: string;
  try { pathname = decodeURIComponent(url.pathname); } catch { return false; }
  if (/[\\\u0000-\u001f]/.test(pathname) || pathname.split("/").some(part => part === "." || part === "..")) return false;
  if (/(?:no[_-]?image|noimg|placeholder)/i.test(pathname)) return false;
  if (provider === "ticketdive") {
    return url.hostname === "storage.googleapis.com" && /^\/playyte-ticket-prod_event\/[^/]+$/.test(pathname);
  }
  return ["livepocket.jp", "t.livepocket.jp"].includes(url.hostname) && /^\/public\/event_image\/filename\/\d+\/[^/]+$/.test(pathname);
}

/** Next's image endpoint is a resized/recompressed copy. Fetch its source object. */
function originalImage(candidate: string, pageUrl: URL, provider: Provider): URL | undefined {
  let url: URL;
  try { url = new URL(candidate, pageUrl); } catch { return undefined; }
  if (provider === "ticketdive" && secureUrl(url) && ["ticketdive.com", "www.ticketdive.com"].includes(url.hostname) && url.pathname === "/_next/image") {
    const original = url.searchParams.get("url");
    if (!original) return undefined;
    try { url = new URL(original, pageUrl); } catch { return undefined; }
  }
  url.hash = "";
  return allowedImage(url, provider) ? url : undefined;
}

function metadata(html: string, pageUrl: URL, provider: Provider): { name: string; imageUrl: URL } {
  const $ = load(html);
  const titleSelector = provider === "ticketdive" ? '[class*="EventInfoUnit_name__"]' : "h1.heading01";
  let name = $(titleSelector).first().text().replace(/\s+/gu, " ").trim();
  if (!name) {
    name = $('meta[property="og:title"]').attr("content")?.replace(/\s+/gu, " ").trim() ?? "";
    name = provider === "ticketdive"
      ? name.replace(/\s*[|｜]\s*TicketDive\s*$/i, "")
      : name.replace(/のチケット情報\s*[|｜]\s*LivePocket.*$/iu, "");
    // LivePocket can publish a shortened OG title; never silently import that.
    if (/(?:\.{3}|…)\s*$/u.test(name) || /^(?:TicketDive|LivePocket(?:（ライブポケット）)?)$/i.test(name)) name = "";
  }
  if (!name) throw new EventImportError("The event title could not be found. Enter it manually or check the event URL.", 422);
  if (name.length > 200) throw new EventImportError("The event title is longer than 200 characters. Enter a shorter title manually.", 422);

  const imageSelectors = provider === "ticketdive"
    ? ['img[class*="EventImage_image__"]', 'img[alt="fv画像"]']
    : ['img[alt="イベントイメージ画像"]'];
  const candidates: string[] = [];
  for (const selector of imageSelectors) {
    // Only the first main image belongs to this event; later images may be recommendations.
    const element = $(selector).first();
    const srcset = element.attr("srcset") ?? element.attr("data-srcset") ?? "";
    const sizes = srcset.split(",").map(part => {
      const match = part.trim().match(/^(\S+)(?:\s+(\d+(?:\.\d+)?)(w|x))?$/);
      return match ? { url: match[1], size: Number(match[2] ?? 1) } : undefined;
    }).filter((entry): entry is { url: string; size: number } => Boolean(entry));
    candidates.push(...sizes.sort((a, b) => b.size - a.size).map(entry => entry.url));
    for (const attr of ["src", "data-src"]) {
      const value = element.attr(attr);
      if (value) candidates.push(value);
    }
  }
  for (const selector of ['meta[property="og:image:secure_url"]', 'meta[property="og:image"]']) {
    const value = $(selector).attr("content");
    if (value) candidates.push(value);
  }
  const imageUrl = candidates.map(candidate => originalImage(candidate, pageUrl, provider)).find(Boolean);
  if (!imageUrl) throw new EventImportError("The event's original image could not be found. Add an image manually.", 422);
  return { name, imageUrl };
}

async function cancel(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* Preserve the original fetch/validation error. */ }
}

async function request(
  initialUrl: URL,
  provider: Provider,
  kind: "page" | "image",
  fetcher: Fetch,
  signal: AbortSignal,
): Promise<{ response: Response; url: URL }> {
  let url = initialUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await fetcher(url, {
      redirect: "manual",
      credentials: "omit",
      signal,
      headers: {
        accept: kind === "page" ? "text/html,application/xhtml+xml" : "image/avif,image/webp,image/png,image/jpeg,image/gif",
        "user-agent": "Daiko/0.1 (event importer)",
      },
    });
    if (redirectStatuses.has(response.status)) {
      const location = response.headers.get("location");
      await cancel(response);
      if (!location || redirects === MAX_REDIRECTS) throw new EventImportError("The ticket provider returned too many or invalid redirects.", 502);
      let next: URL;
      try { next = new URL(location, url); } catch { throw new EventImportError("The ticket provider returned an invalid redirect.", 502); }
      const allowed = kind === "page" ? eventProvider(next) === provider : allowedImage(next, provider);
      if (!allowed) throw new EventImportError("The ticket provider redirected outside its supported event or image locations.", 502);
      next.hash = "";
      url = next;
      continue;
    }
    if (!response.ok) {
      await cancel(response);
      if (response.status === 404 || response.status === 410) throw new EventImportError(`The event ${kind === "page" ? "page" : "image"} is no longer available.`, 422);
      throw new EventImportError("The ticket provider could not be reached or blocked automatic access. Try again or enter the event manually.", 502);
    }
    return { response, url };
  }
  throw new EventImportError("The ticket provider returned too many redirects.", 502);
}

async function readBody(response: Response, limit: number, kind: "page" | "image"): Promise<Buffer> {
  const tooLarge = () => new EventImportError(`The event ${kind} exceeds the ${Math.round(limit / 1024 / 1024)} MB import limit.`, 422);
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > limit) {
    await cancel(response);
    throw tooLarge();
  }
  if (!response.body) throw new EventImportError(`The ticket provider returned an empty ${kind}.`, 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        try { await reader.cancel(); } catch { /* Report the size limit, even if cancellation fails. */ }
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

function rasterFormat(bytes: Buffer): { contentType: string; extension: string } | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { contentType: "image/png", extension: ".png" };
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { contentType: "image/jpeg", extension: ".jpg" };
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return { contentType: "image/gif", extension: ".gif" };
  if (bytes.length >= 16 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii", 12, 16))) return { contentType: "image/webp", extension: ".webp" };
  if (bytes.length >= 16 && bytes.toString("ascii", 4, 8) === "ftyp") {
    const boxLength = bytes.readUInt32BE(0);
    if (boxLength >= 16 && boxLength <= bytes.length && boxLength <= 1024) {
      const brands = [bytes.toString("ascii", 8, 12)];
      for (let offset = 16; offset + 4 <= boxLength; offset += 4) brands.push(bytes.toString("ascii", offset, offset + 4));
      if (brands.includes("avif") || brands.includes("avis")) return { contentType: "image/avif", extension: ".avif" };
    }
  }
  return undefined;
}

/** Retrieve metadata and the unmodified original image without browser cookies. */
export async function fetchEventImport(input: string, options: { fetch?: Fetch } = {}): Promise<{ name: string; image: Buffer; contentType: string; extension: string }> {
  let url: URL;
  try {
    if (typeof input !== "string" || input.length > 2048) throw new Error("Invalid URL");
    url = new URL(input.trim());
  } catch { throw new EventImportError("Enter a valid HTTPS TicketDive or LivePocket event URL.", 400); }
  const provider = eventProvider(url);
  if (!provider) throw new EventImportError("Use an HTTPS TicketDive /event/ URL or LivePocket /e/ event URL.", 400);
  url.hash = "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  timer.unref();
  const fetcher = options.fetch ?? globalThis.fetch;
  try {
    const page = await request(url, provider, "page", fetcher, controller.signal);
    const pageType = page.response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (pageType !== "text/html" && pageType !== "application/xhtml+xml") {
      await cancel(page.response);
      throw new EventImportError("The ticket provider did not return an event page.", 502);
    }
    const { name, imageUrl } = metadata((await readBody(page.response, HTML_LIMIT, "page")).toString("utf8"), page.url, provider);
    const { response } = await request(imageUrl, provider, "image", fetcher, controller.signal);
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(contentType ?? "")) {
      await cancel(response);
      throw new EventImportError("The event image must be a JPEG, PNG, WebP, GIF, or AVIF image.", 422);
    }
    const image = await readBody(response, IMAGE_LIMIT, "image");
    const format = rasterFormat(image);
    if (!format || format.contentType !== contentType) throw new EventImportError("The event image content does not match its image format.", 422);
    return { name, image, ...format };
  } catch (error) {
    if (error instanceof EventImportError) throw error;
    if (controller.signal.aborted || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))) {
      throw new EventImportError("The ticket provider took too long to respond. Try again or enter the event manually.", 504);
    }
    throw new EventImportError("The ticket provider could not be reached. Try again or enter the event manually.", 502);
  } finally { clearTimeout(timer); }
}
