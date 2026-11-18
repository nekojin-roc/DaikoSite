import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { eventUrl } from './rules.mjs';
import { importEvent, ImportError } from './importer.mjs';

export function createServer(browser, runImport = importEvent) {
  let busy = false;
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => {
      if (!res.writableEnded && !res.destroyed) { res.writeHead(status, {'content-type':'application/json', 'cache-control':'no-store'}); res.end(JSON.stringify(body)); }
    };
    if (req.method === 'GET' && req.url === '/health') return reply(browser.isConnected() ? 200 : 503, {ready:browser.isConnected()});
    if (req.method !== 'POST' || req.url !== '/import') { req.resume(); return reply(404, {error:'Not found'}); }
    if (busy) { req.resume(); return reply(503, {error:'Importer busy'}); }
    busy = true;
    try {
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new ImportError(400, 'Invalid request');
      const chunks = []; let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 4096) throw new ImportError(400, 'Invalid request');
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ImportError(400, 'Invalid request'); }
      const url = input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === 1 ? eventUrl(input.url) : null;
      if (!url) throw new ImportError(400, 'Invalid event URL');
      reply(200, await runImport(browser, url));
    } catch (error) { reply(error instanceof ImportError ? error.status : 502, {error:error instanceof ImportError ? error.message : 'Import failed'}); }
    finally { busy = false; }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The service fails closed if Chromium's sandbox is unavailable. Its only
  // network is Docker's internal-only browser network and outbound proxy.
  const browser = await chromium.launch({
    headless:true, chromiumSandbox:true,
    // Apply the proxy to loopback and link-local destinations as well.
    proxy:{server:'http://browser-proxy:3128', bypass:'<-loopback>'},
    args:['--disable-quic', '--disable-background-networking'],
  });
  const server = createServer(browser);
  let stopping = false;
  browser.on('disconnected', () => {
    if (!stopping) {
      console.error('Chromium disconnected. Restarting the import service.');
      process.exit(1);
    }
  });
  server.listen(3003, '0.0.0.0');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    stopping = true;
    server.close(() => void browser.close());
  });
}
