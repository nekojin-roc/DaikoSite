import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { createProxy, allowedHost, publicAddress, clientHelloServerName } from '../server.js';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function connectToProxy(port, authority, suffix = '') {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  await once(socket, 'connect');
  socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
  if (suffix.length) socket.write(suffix);
  return socket;
}

function helloFor(host) {
  const name = Buffer.from(host, 'ascii');
  const entry = Buffer.alloc(3 + name.length);
  entry.writeUInt16BE(name.length, 1); name.copy(entry, 3);
  const extension = Buffer.alloc(6 + entry.length);
  extension.writeUInt16BE(0, 0); extension.writeUInt16BE(2 + entry.length, 2);
  extension.writeUInt16BE(entry.length, 4); entry.copy(extension, 6);
  const prefix = Buffer.concat([Buffer.from([3, 3]), Buffer.alloc(32), Buffer.from([0, 0, 2, 0x13, 1, 1, 0])]);
  const extensionSize = Buffer.alloc(2); extensionSize.writeUInt16BE(extension.length);
  const body = Buffer.concat([prefix, extensionSize, extension]);
  const handshake = Buffer.alloc(4); handshake[0] = 1; handshake.writeUIntBE(body.length, 1, 3);
  const record = Buffer.alloc(5); record[0] = 0x16; record[1] = 3; record[2] = 1; record.writeUInt16BE(handshake.length + body.length, 3);
  return Buffer.concat([record, handshake, body]);
}

async function readThrough(socket, marker) {
  let data = '';
  for await (const chunk of socket) {
    data += chunk.toString('latin1');
    if (data.includes(marker)) return data;
  }
  return data;
}

async function readBytes(socket, length) {
  const chunks = [];
  let received = 0;
  for await (const chunk of socket) {
    chunks.push(chunk); received += chunk.length;
    if (received >= length) return Buffer.concat(chunks);
  }
  return Buffer.concat(chunks);
}

test('only the specified provider and WAF hostnames are allowed', () => {
  for (const host of ['livepocket.jp', 't.livepocket.jp', 'abc123.def456.ap-northeast-1.token.awswaf.com']) assert.equal(allowedHost(host), true, host);
  for (const host of ['livepocket.jp.evil.example', 'other.livepocket.jp', 'livepocket.jp.', 'awswaf.com', 'a.b.c.d.token.awswaf.com', 'a.b.c.token.awswaf.com.evil.example', '127.0.0.1']) assert.equal(allowedHost(host), false, host);
});

test('only public unicast IPv4 addresses are usable', () => {
  for (const address of ['1.1.1.1', '8.8.8.8', '99.84.1.1']) assert.equal(publicAddress(address), true, address);
  for (const address of ['0.0.0.0', '10.2.3.4', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.2', '192.168.1.1', '192.0.0.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.1.1.1', '255.255.255.255', '::1', '::ffff:127.0.0.1', '2606:4700:4700::1111', 'not-an-ip']) assert.equal(publicAddress(address), false, address);
});

test('parses fragmented TLS ClientHello SNI and rejects malformed data', () => {
  const hello = helloFor('livepocket.jp');
  for (let i = 0; i < hello.length; i++) assert.equal(clientHelloServerName(hello.subarray(0, i)), undefined);
  assert.equal(clientHelloServerName(hello), 'livepocket.jp');
  const fragments = [hello.subarray(5, 12), hello.subarray(12)].map(payload => {
    const header = Buffer.from([0x16, 3, 1, 0, 0]); header.writeUInt16BE(payload.length, 3);
    return Buffer.concat([header, payload]);
  });
  assert.equal(clientHelloServerName(Buffer.concat(fragments)), 'livepocket.jp');
  assert.equal(clientHelloServerName(Buffer.from('hello')), null);
  assert.equal(clientHelloServerName(Buffer.from([0x16, 3, 1, 0, 0])), null);
});

test('closes a CONNECT tunnel which remains idle', async t => {
  const upstream = net.createServer();
  const upstreamPort = await listen(upstream);
  const proxy = createProxy({ idleMs: 50, lookup: async () => [{ address: '8.8.8.8', family: 4 }], connect: () => net.createConnection({ host: '127.0.0.1', port: upstreamPort }) });
  const port = await listen(proxy);
  t.after(() => { proxy.close(); upstream.close(); });
  const socket = await connectToProxy(port, 'livepocket.jp:443');
  socket.resume();
  await once(socket, 'close');
});

test('pins the validated DNS address and forwards CONNECT payload in both directions', async t => {
  const echo = net.createServer(socket => socket.pipe(socket));
  const echoPort = await listen(echo);
  const lookups = [];
  const connections = [];
  const proxy = createProxy({
    lookup: async host => { lookups.push(host); return [{ address: '8.8.8.8', family: 4 }]; },
    connect: address => { connections.push(address); return net.createConnection({ host: '127.0.0.1', port: echoPort }); },
  });
  const port = await listen(proxy);
  t.after(() => { proxy.close(); echo.close(); });
  const hello = helloFor('livepocket.jp');
  const socket = await connectToProxy(port, 'livepocket.jp:443', hello);
  const prefix = Buffer.from('HTTP/1.1 200 Connection Established\r\n\r\n');
  const result = await readBytes(socket, prefix.length + hello.length);
  assert.ok(result.subarray(0, prefix.length).equals(prefix));
  assert.ok(result.subarray(prefix.length).equals(hello));
  assert.deepEqual(lookups, ['livepocket.jp']);
  assert.deepEqual(connections, ['8.8.8.8']);
  socket.destroy();
});

test('never forwards TLS with SNI for a different virtual host', async t => {
  let received = 0;
  const echo = net.createServer(socket => { socket.on('data', chunk => { received += chunk.length; }); });
  const echoPort = await listen(echo);
  const proxy = createProxy({ lookup: async () => [{ address: '8.8.8.8', family: 4 }], connect: () => net.createConnection({ host: '127.0.0.1', port: echoPort }) });
  const port = await listen(proxy);
  t.after(() => { proxy.close(); echo.close(); });
  const socket = await connectToProxy(port, 'livepocket.jp:443', helloFor('evil.example'));
  socket.resume();
  await once(socket, 'close');
  assert.equal(received, 0);
});

test('rejects disallowed hosts, non-443 ports and HTTP requests before DNS', async t => {
  let lookups = 0;
  const proxy = createProxy({ lookup: async () => { lookups++; return []; } });
  const port = await listen(proxy);
  t.after(() => proxy.close());
  for (const authority of ['livepocket.jp:80', 'livepocket.jp:444', 'livepocket.jp.evil.example:443', '127.0.0.1:443', 'user@livepocket.jp:443', 'livepocket.jp.:443']) {
    const socket = await connectToProxy(port, authority);
    const response = await readThrough(socket, '\r\n\r\n');
    assert.match(response, /^HTTP\/1\.1 403 /, authority);
    socket.destroy();
  }
  const ordinary = net.createConnection({ host: '127.0.0.1', port });
  await once(ordinary, 'connect');
  ordinary.write('GET http://livepocket.jp/e/3pnkn HTTP/1.1\r\nHost: livepocket.jp\r\n\r\n');
  assert.match(await readThrough(ordinary, '\r\n\r\n'), /^HTTP\/1\.1 405 /);
  ordinary.destroy();
  assert.equal(lookups, 0);
});

test('rejects a private or mixed DNS answer without attempting a connection', async t => {
  for (const answers of [[{ address: '169.254.169.254', family: 4 }], [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }], [{ address: '::1', family: 6 }], []]) {
    let connected = false;
    const proxy = createProxy({ lookup: async () => answers, connect: () => { connected = true; throw new Error('should not connect'); } });
    const port = await listen(proxy);
    const socket = await connectToProxy(port, 'livepocket.jp:443');
    assert.match(await readThrough(socket, '\r\n\r\n'), /^HTTP\/1\.1 403 /);
    assert.equal(connected, false);
    socket.destroy();
    proxy.close();
  }
});

test('bounds DNS resolution time and simultaneous tunnels', async t => {
  const proxy = createProxy({ maxTunnels: 1, dnsTimeoutMs: 50, lookup: async () => new Promise(() => {}) });
  const port = await listen(proxy);
  t.after(() => proxy.close());
  const first = await connectToProxy(port, 'livepocket.jp:443');
  const second = await connectToProxy(port, 't.livepocket.jp:443');
  assert.match(await readThrough(second, '\r\n\r\n'), /^HTTP\/1\.1 503 /);
  assert.match(await readThrough(first, '\r\n\r\n'), /^HTTP\/1\.1 502 /);
  first.destroy(); second.destroy();
});

test('closes a tunnel after its combined byte limit is exceeded', async t => {
  const echo = net.createServer(socket => socket.pipe(socket));
  const echoPort = await listen(echo);
  const hello = helloFor('livepocket.jp');
  const proxy = createProxy({ maxBytes: hello.length + 1, lookup: async () => [{ address: '8.8.8.8', family: 4 }], connect: () => net.createConnection({ host: '127.0.0.1', port: echoPort }) });
  const port = await listen(proxy);
  t.after(() => { proxy.close(); echo.close(); });
  const socket = await connectToProxy(port, 'livepocket.jp:443', hello);
  let result = '';
  socket.on('data', chunk => { result += chunk.toString('latin1'); });
  await once(socket, 'close');
  assert.match(result, /^HTTP\/1\.1 200 /);
  assert.ok(!result.includes('livepocket.jp'));
});
