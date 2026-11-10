import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../dist/app.js';
import { parcelHubIdentity } from '../dist/identity.js';

const ORIGIN = 'http://localhost:5173';
test('authorized workflows, validation, ordering and persistence', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'daiko-test-'));
  const url = `file:${path.join(dir, 'test.db').replaceAll('\\', '/')}`;
  await writeFile(path.join(dir, 'test.db'), '');
  const migrate = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });
  assert.equal(migrate.status, 0, migrate.stderr);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const identities = {
    'sid=admin': { id: 'a', name: 'Owner', email: 'owner@example.com' },
    'sid=user': { id: 'u', name: 'Fan', email: 'fan@example.com' },
    'sid=other': { id: 'v', name: 'Other', email: 'other@example.com' },
  };
  const app = await createApp({ prisma, resolveIdentity: async cookie => identities[cookie] ?? null, adminEmails: ['owner@example.com'], allowedOrigins: [ORIGIN], logger: false });
  const call = (method, url, cookie, payload, origin = ORIGIN) => app.inject({ method, url, headers: { ...(cookie ? { cookie } : {}), ...(method === 'POST' ? { origin } : {}) }, ...(payload !== undefined ? { payload } : {}) });
  try {
    assert.deepEqual((await call('GET', '/api/session')).json(), { user: null });
    assert.equal((await call('GET', '/api/build')).statusCode, 401);
    assert.deepEqual((await call('GET', '/api/build', 'sid=user')).json(), { build: 8 });
    assert.deepEqual((await call('GET', '/api/build', 'sid=admin')).json(), { build: 8 });
    await prisma.buildCounter.update({ where: { id: 1 }, data: { value: 9 } });
    assert.deepEqual((await call('GET', '/api/build', 'sid=user')).json(), { build: 9 });
    assert.equal((await call('GET', '/api/events')).statusCode, 401);
    assert.equal((await call('POST', '/api/events', 'sid=user', {})).statusCode, 403);
    const event = { name: 'Live', groupName: 'Idol', startsAt: '2027-04-10T10:00:00.000Z', imageUrl: '' };
    assert.equal((await call('POST', '/api/events', 'sid=admin', event, 'https://evil.example')).statusCode, 403);
    assert.equal((await call('POST', '/api/events', 'sid=admin', { ...event, imageUrl: 'javascript:alert(1)' })).statusCode, 400);
    const first = (await call('POST', '/api/events', 'sid=admin', event)).json();
    await call('POST', '/api/events', 'sid=admin', { ...event, name: 'Earlier', startsAt: '2027-01-01T10:00:00.000Z' });
    assert.deepEqual((await call('GET', '/api/events', 'sid=user')).json().events.map(item => item.name), ['Earlier', 'Live']);
    const route = `/api/events/${first.id}/requests`;
    assert.equal((await call('POST', route, 'sid=user', { type: 'CHEKI', amount: 0, message: 'hi' })).statusCode, 400);
    assert.equal((await call('POST', route, 'sid=user', { type: 'GOODS', message: '  ' })).statusCode, 400);
    assert.equal((await call('POST', route, 'sid=user', { type: 'CHEKI', amount: 1, message: 'hello', userId: 'fake' })).statusCode, 400);
    assert.equal((await call('POST', route, 'sid=user', { type: 'CHEKI', amount: 2, message: 'hello' })).statusCode, 201);
    assert.equal((await call('POST', route, 'sid=other', { type: 'GOODS', message: 'a towel' })).statusCode, 201);
    assert.equal((await call('GET', route, 'sid=user')).statusCode, 403);
    const queue = (await call('GET', route, 'sid=admin')).json().requests;
    assert.deepEqual(queue.map(item => item.message), ['a towel', 'hello']);
    assert.deepEqual(queue.map(item => item.user.email), ['other@example.com', 'fan@example.com']);
    const mine = (await call('GET', '/api/my-requests', 'sid=user')).json().requests;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].event.name, 'Live');
    assert.equal(mine[0].event.requestCount, 2);
    await app.close();
    await prisma.$disconnect();
    const reopened = new PrismaClient({ datasources: { db: { url } } });
    assert.equal(await reopened.request.count(), 2);
    await reopened.$disconnect();
  } finally { await app.close(); await prisma.$disconnect(); await rm(dir, { recursive: true, force: true }); }
});

test('ParcelHub identity requires both a valid session and live account access', async () => {
  let guardStatus = 200;
  let receivedCookie;
  const server = createServer((request, response) => {
    receivedCookie = request.headers.cookie;
    if (request.url === '/api/auth/get-session') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ user: { id: 'u', name: 'Fan', email: 'fan@example.com' } }));
    } else if (request.url === '/api/my/items') {
      response.statusCode = guardStatus;
      response.end('{}');
    } else { response.statusCode = 404; response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const resolver = parcelHubIdentity(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await resolver(undefined), null);
    assert.equal((await resolver('sid=test')).id, 'u');
    assert.equal(receivedCookie, 'sid=test');
    guardStatus = 403;
    assert.equal(await resolver('sid=test'), null);
    guardStatus = 500;
    await assert.rejects(resolver('sid=test'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

