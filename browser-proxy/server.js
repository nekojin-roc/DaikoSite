import http from 'node:http';
import net from 'node:net';
import { Resolver } from 'node:dns/promises';
import { pathToFileURL } from 'node:url';
import ipaddr from 'ipaddr.js';

const WAF_HOST = /^[a-z0-9]+\.[a-z0-9]+\.[a-z0-9-]+\.token\.awswaf\.com$/;
const MAX_TUNNEL_BYTES = 55 * 1024 * 1024;
const MAX_TUNNELS = 24;
const MAX_TUNNEL_MS = 90_000;
const IDLE_MS = 30_000;
const DNS_TIMEOUT_MS = 5_000;
const MAX_CLIENT_HELLO = 64 * 1024;

async function lookupIpv4(host) {
  // Unlike getaddrinfo, c-ares performs a bounded asynchronous DNS query and
  // cannot leave a blocked system thread behind after the request times out.
  const resolver = new Resolver({ timeout: 4_000, tries: 1 });
  return (await resolver.resolve4(host)).map(address => ({ address, family: 4 }));
}

export function allowedHost(host) {
  return host === 'livepocket.jp' || host === 't.livepocket.jp' || WAF_HOST.test(host);
}

// Only IPv4 is supported. This avoids silently treating an IPv4-mapped,
// transitional or otherwise special IPv6 address as a public destination.
export function publicAddress(address) {
  if (net.isIP(address) !== 4) return false;
  try { return ipaddr.parse(address).range() === 'unicast'; } catch { return false; }
}

// Return undefined while a TLS ClientHello is incomplete, null if malformed
// or without exactly one DNS SNI, and the hostname otherwise. Inspecting SNI
// prevents a CONNECT to an allowlisted CDN address from tunnelling TLS to a
// different virtual host on the same shared IP.
export function clientHelloServerName(input) {
  let offset = 0;
  const fragments = [];
  let size = 0;
  while (offset < input.length) {
    if (input.length - offset < 5) return undefined;
    if (input[offset] !== 0x16) return null;
    const length = input.readUInt16BE(offset + 3);
    if (!length || length > 18_432) return null;
    if (input.length - offset - 5 < length) return undefined;
    fragments.push(input.subarray(offset + 5, offset + 5 + length));
    size += length;
    if (size > MAX_CLIENT_HELLO) return null;
    const data = Buffer.concat(fragments, size);
    if (data.length >= 4) {
      if (data[0] !== 1) return null;
      const helloLength = data.readUIntBE(1, 3);
      if (helloLength + 4 > MAX_CLIENT_HELLO) return null;
      if (data.length >= helloLength + 4) return parseHello(data.subarray(4, helloLength + 4));
    }
    offset += length + 5;
  }
  return undefined;
}

function parseHello(body) {
  try {
    let i = 34; // protocol version and 32-byte random
    if (body.length < i + 1) return null;
    const sessionLength = body[i++];
    i += sessionLength;
    if (i + 2 > body.length) return null;
    const suitesLength = body.readUInt16BE(i); i += 2 + suitesLength;
    if (!suitesLength || suitesLength % 2 || i + 1 > body.length) return null;
    const compressionLength = body[i++]; i += compressionLength;
    if (!compressionLength || i + 2 > body.length) return null;
    const extensionsLength = body.readUInt16BE(i); i += 2;
    if (i + extensionsLength !== body.length) return null;
    let hostname = null;
    while (i < body.length) {
      if (i + 4 > body.length) return null;
      const type = body.readUInt16BE(i);
      const length = body.readUInt16BE(i + 2); i += 4;
      const end = i + length;
      if (end > body.length) return null;
      if (type === 0) {
        if (hostname !== null || length < 5 || body.readUInt16BE(i) !== length - 2) return null;
        i += 2;
        if (body[i++] !== 0 || i + 2 > end) return null;
        const nameLength = body.readUInt16BE(i); i += 2;
        if (!nameLength || i + nameLength !== end) return null;
        const nameBytes = body.subarray(i, end);
        if (nameBytes.some(byte => byte > 0x7f)) return null;
        hostname = nameBytes.toString('ascii').toLowerCase();
        if (!/^[a-z0-9.-]+$/.test(hostname)) return null;
      }
      i = end;
    }
    return hostname;
  } catch { return null; }
}

function reject(socket, status, message) {
  if (!socket.destroyed && socket.writable) {
    socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
}

/** A narrow CONNECT-only proxy. Injectable DNS/connect functions support
 * deterministic tests without connecting to public internet hosts. */
export function createProxy({
  lookup = lookupIpv4,
  connect = address => net.createConnection({ host: address, port: 443, family: 4 }),
  maxTunnels = MAX_TUNNELS,
  maxBytes = MAX_TUNNEL_BYTES,
  maxTunnelMs = MAX_TUNNEL_MS,
  idleMs = IDLE_MS,
  dnsTimeoutMs = DNS_TIMEOUT_MS,
} = {}) {
  let active = 0;
  const server = http.createServer((_req, res) => {
    res.writeHead(405, { Connection: 'close', 'Content-Length': '0' });
    res.end();
  });
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  server.maxHeadersCount = 64;
  // Limit sockets before clients send a complete CONNECT request too.
  server.maxConnections = maxTunnels + 8;
  server.on('clientError', (_error, socket) => reject(socket, 400, 'Bad Request'));
  server.on('upgrade', (_req, socket) => reject(socket, 405, 'Method Not Allowed'));
  server.on('connect', async (request, client, head) => {
    client.on('error', () => {});
    const match = /^([a-z0-9.-]+):443$/i.exec(request.url ?? '');
    const host = match?.[1].toLowerCase();
    if (!host || !allowedHost(host)) return reject(client, 403, 'Forbidden');
    if (active >= maxTunnels) return reject(client, 503, 'Service Unavailable');
    if (head.length > maxBytes) return reject(client, 413, 'Content Too Large');
    active++;
    let remote;
    let finished = false;
    let bytes = head.length;
    const timer = setTimeout(() => { client.destroy(); remote?.destroy(); }, maxTunnelMs);
    timer.unref();
    const finish = () => {
      if (finished) return;
      finished = true;
      active--;
      clearTimeout(timer);
      remote?.destroy();
    };
    client.on('close', finish);
    client.setTimeout(idleMs, () => client.destroy());
    client.pause();
    try {
      let dnsTimer;
      let answers;
      try {
        answers = await Promise.race([
          lookup(host),
          new Promise((_, rejectDns) => { dnsTimer = setTimeout(() => rejectDns(new Error('DNS timeout')), dnsTimeoutMs); dnsTimer.unref(); }),
        ]);
      } finally { clearTimeout(dnsTimer); }
      if (finished || client.destroyed) return;
      // Reject a mixed public/private DNS response rather than choosing around it.
      if (!Array.isArray(answers) || !answers.length || answers.some(item => item.family !== 4 || !publicAddress(item.address))) {
        reject(client, 403, 'Forbidden');
        return;
      }
      // Never pass the hostname to connect(): the DNS result validated above is
      // the exact numeric address used for the outbound socket.
      remote = connect(answers[0].address);
      remote.on('error', () => {
        if (!client.destroyed) client.destroy();
      });
      remote.on('close', () => { if (!client.destroyed) client.destroy(); });
      remote.setTimeout(idleMs, () => remote.destroy());
      remote.once('connect', () => {
        if (finished || client.destroyed) return remote.destroy();
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        const count = chunk => {
          bytes += chunk.length;
          if (bytes > maxBytes) { client.destroy(); remote.destroy(); }
        };
        remote.on('data', count);
        remote.pipe(client);
        const chunks = [];
        let helloBytes = 0;
        const inspect = chunk => {
          helloBytes += chunk.length;
          if (helloBytes > MAX_CLIENT_HELLO || chunks.length >= 256) {
            client.destroy(); remote.destroy(); return;
          }
          chunks.push(chunk);
          const buffered = Buffer.concat(chunks, helloBytes);
          const sni = clientHelloServerName(buffered);
          if (sni === undefined) return;
          if (sni !== host) { client.destroy(); remote.destroy(); return; }
          client.removeListener('data', inspect);
          // head was already counted before DNS; later hello bytes were not.
          bytes += helloBytes - head.length;
          if (bytes > maxBytes) { client.destroy(); remote.destroy(); return; }
          client.on('data', count);
          remote.write(buffered);
          client.pipe(remote);
        };
        client.on('data', inspect);
        if (head.length) inspect(head);
        client.resume();
      });
    } catch {
      reject(client, 502, 'Bad Gateway');
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? '3128');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  createProxy().listen(port, '0.0.0.0');
}
