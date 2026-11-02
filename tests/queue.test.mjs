import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../dist/app.js';

const origin = 'http://localhost:5173';
test('goods appear first and finishing a request preserves its history', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'daiko-queue-'));
  const db = path.join(dir, 'test.db');
  const url = `file:${db}`;
  await writeFile(db, '');
  const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });
  assert.equal(migration.status, 0, migration.stderr);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const users = { admin: { id: 'a', name: 'Admin', email: 'admin@example.com' }, fan: { id: 'u', name: 'Fan', email: 'fan@example.com' }, other: { id: 'v', name: 'Other', email: 'other@example.com' } };
  const app = await createApp({ prisma, resolveIdentity: async cookie => users[cookie] ?? null, adminEmails: ['admin@example.com'], allowedOrigins: [origin], logger: false });
  const call = (method, url, cookie, payload, requestOrigin = origin) => app.inject({ method, url, headers: { ...(cookie ? { cookie } : {}), ...(!['GET', 'HEAD'].includes(method) ? { origin: requestOrigin } : {}) }, ...(payload === undefined ? {} : { payload }) });
  try {
    const event = (await call('POST', '/api/events', 'admin', { name: 'Event', groupName: 'Group', startsAt: '2027-05-01T12:00:00Z' })).json();
    const url = `/api/events/${event.id}/requests`;
    const cheki = (await call('POST', url, 'fan', { type: 'CHEKI', amount: 2, message: 'Cheki' })).json();
    const goods = (await call('POST', url, 'fan', { type: 'GOODS', message: 'Towel and shirt' })).json();
    const later = (await call('POST', url, 'other', { type: 'GOODS', message: 'Other goods' })).json();
    assert.equal((await call('POST', url, 'fan', { type: 'GOODS', message: '  ' })).statusCode, 400);
    assert.deepEqual((await call('GET', url, 'admin')).json().requests.map(r => r.id), [goods.id, later.id, cheki.id]);
    assert.equal((await call('GET', '/api/events', 'fan')).json().events[0].requestCount, 3);
    const finish = `/api/requests/${goods.id}/finish`;
    assert.equal((await call('POST', finish)).statusCode, 401);
    assert.equal((await call('POST', finish, 'fan')).statusCode, 403);
    assert.equal((await call('POST', finish, 'admin', {}, 'https://evil.example')).statusCode, 403);
    assert.equal((await call('POST', '/api/requests/missing/finish', 'admin')).statusCode, 404);
    assert.equal((await call('POST', finish, 'admin')).statusCode, 204);
    const finishedAt = (await prisma.request.findUnique({ where: { id: goods.id } })).finishedAt;
    assert.ok(finishedAt instanceof Date);
    assert.equal((await call('POST', finish, 'admin')).statusCode, 204);
    assert.equal((await prisma.request.findUnique({ where: { id: goods.id } })).finishedAt.getTime(), finishedAt.getTime());
    assert.deepEqual((await call('GET', url, 'admin')).json().requests.map(r => r.id), [later.id, cheki.id]);
    assert.equal((await call('GET', '/api/events', 'fan')).json().events[0].requestCount, 2);
    const history = (await call('GET', '/api/my-requests', 'fan')).json().requests;
    assert.equal(history.length, 2);
    assert.equal(history.find(r => r.id === goods.id).finishedAt, finishedAt.toISOString());
    assert.equal(history.find(r => r.id === cheki.id).finishedAt, null);
    assert.deepEqual((await call('GET', '/api/my-requests', 'other')).json().requests.map(r => r.id), [later.id]);
  } finally { await app.close(); await prisma.$disconnect(); await rm(dir, { recursive: true, force: true }); }
});
