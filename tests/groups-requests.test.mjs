import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../dist/app.js';
import { decodeRequestImage, InvalidRequestImage } from '../dist/request-images.js';

const origin = 'http://localhost:5173';
test('groups and custom requests protect images and preserve historical choices', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'daiko-groups-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  await writeFile(path.join(dir, 'test.db'), '');
  const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });
  assert.equal(migration.status, 0, migration.stderr);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const users = { admin: { id: 'a', name: 'Admin', email: 'admin@example.com' }, fan: { id: 'u', name: 'Fan', email: 'fan@example.com' }, other: { id: 'v', name: 'Other', email: 'other@example.com' } };
  const app = await createApp({ prisma, resolveIdentity: async cookie => users[cookie] ?? null, adminEmails: ['admin@example.com'], allowedOrigins: [origin], logger: false, requestImageDirectory: path.join(dir, 'images') });
  const call = (method, url, cookie, payload) => app.inject({ method, url, headers: { ...(cookie ? { cookie } : {}), ...(!['GET', 'HEAD'].includes(method) ? { origin } : {}) }, ...(payload !== undefined ? { payload } : {}) });
  try {
    assert.equal((await call('POST', '/api/groups', 'fan', { name: 'Idol' })).statusCode, 403);
    const group = (await call('POST', '/api/groups', 'admin', { name: 'Idol' })).json();
    assert.equal((await call('POST', '/api/groups', 'admin', { name: 'idol' })).statusCode, 409);
    const member = (await call('POST', `/api/groups/${group.id}/members`, 'admin', { name: 'Alice' })).json();
    assert.equal((await call('POST', `/api/groups/${group.id}/members`, 'admin', { name: 'alice' })).statusCode, 409);
    const offering = (await call('POST', `/api/groups/${group.id}/offerings`, 'admin', { name: 'Cheki' })).json();
    const event = (await call('POST', '/api/events', 'admin', { name: 'Live', groupId: group.id, startsAt: '2027-04-10T10:00:00Z' })).json();
    assert.equal(event.groupId, group.id);
    const route = `/api/events/${event.id}/requests`;
    const payload = { memberId: member.id, offeringId: offering.id, message: 'Hello', image: { mimeType: 'image/png', data: Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64') } };
    assert.equal((await call('POST', route, 'fan', { ...payload, memberId: 'other' })).statusCode, 400);
    assert.equal((await call('POST', route, 'fan', { ...payload, image: { ...payload.image, mimeType: 'image/jpeg' } })).statusCode, 400);
    assert.equal((await call('POST', route, 'fan', { ...payload, image: { ...payload.image, data: '%%%=' } })).statusCode, 400);
    const response = await call('POST', route, 'fan', payload);
    assert.equal(response.statusCode, 201, response.body);
    const result = response.json();
    assert.equal(result.memberName, 'Alice');
    assert.equal(result.offeringName, 'Cheki');
    assert.equal((await call('GET', `/api/requests/${result.id}/image`, 'fan')).statusCode, 200);
    assert.equal((await call('GET', `/api/requests/${result.id}/image`, 'admin')).statusCode, 200);
    assert.equal((await call('GET', `/api/requests/${result.id}/image`, 'other')).statusCode, 404);
    assert.equal((await call('GET', `/api/requests/${result.id}/image`)).statusCode, 401);
    await call('PATCH', `/api/groups/${group.id}/members/${member.id}`, 'admin', { name: 'New name' });
    await call('PATCH', `/api/groups/${group.id}/offerings/${offering.id}`, 'admin', { name: 'New offering' });
    assert.equal((await call('DELETE', `/api/groups/${group.id}/offerings/${offering.id}`, 'admin')).statusCode, 204);
    assert.equal((await call('POST', route, 'fan', payload)).statusCode, 400);
    const saved = (await call('GET', '/api/my-requests', 'fan')).json().requests[0];
    assert.equal(saved.memberName, 'Alice');
    assert.equal(saved.offeringName, 'Cheki');
    assert.equal(saved.imageUrl, result.imageUrl);
    assert.equal((await readdir(path.join(dir, 'images'))).length, 1);
  } finally { await app.close(); await prisma.$disconnect(); await rm(dir, { recursive: true, force: true }); }
});

test('migration links existing group names without losing event or request data', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'daiko-migration-'));
  const db = path.join(dir, 'old.db');
  const { mkdir, copyFile } = await import('node:fs/promises');
  const schema = path.join(dir, 'schema.prisma');
  const migrationDir = path.join(dir, 'migrations');
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${db}` } } });
  const migrate = () => spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', schema], { env: { ...process.env, DATABASE_URL: `file:${db}` }, encoding: 'utf8' });
  try {
    await writeFile(db, '');
    await copyFile('prisma/schema.prisma', schema);
    await mkdir(path.join(migrationDir, '20261102000000_initial'), { recursive: true });
    await copyFile('prisma/migrations/migration_lock.toml', path.join(migrationDir, 'migration_lock.toml'));
    await copyFile('prisma/migrations/20261102000000_initial/migration.sql', path.join(migrationDir, '20261102000000_initial/migration.sql'));
    const initial = migrate();
    assert.equal(initial.status, 0, initial.stderr);
    await prisma.$executeRawUnsafe("INSERT INTO Event (id, name, groupName, startsAt) VALUES ('e1', 'Live', 'Idol', '2027-01-01'), ('e2', 'More', 'idol', '2027-01-02')");
    await prisma.$executeRawUnsafe("INSERT INTO Request (id, eventId, type, message, userId, userName, userEmail) VALUES ('r1', 'e1', 'GOODS', 'Message', 'u', 'Fan', 'fan@example.com')");
    await mkdir(path.join(migrationDir, '20261103000000_groups_and_custom_requests'));
    await copyFile('prisma/migrations/20261103000000_groups_and_custom_requests/migration.sql', path.join(migrationDir, '20261103000000_groups_and_custom_requests/migration.sql'));
    const migration = migrate();
    assert.equal(migration.status, 0, migration.stderr);
    const events = await prisma.$queryRawUnsafe('SELECT id, name, groupName, groupId FROM Event ORDER BY id');
    const groups = await prisma.$queryRawUnsafe('SELECT id, name FROM "Group"');
    const requests = await prisma.$queryRawUnsafe('SELECT id, eventId, type, message FROM Request');
    assert.equal(groups.length, 1);
    assert.deepEqual(events.map(event => [event.id, event.name, event.groupName, event.groupId]), [['e1', 'Live', 'Idol', groups[0].id], ['e2', 'More', 'idol', groups[0].id]]);
    assert.deepEqual(requests, [{ id: 'r1', eventId: 'e1', type: 'GOODS', message: 'Message' }]);
  } finally { await prisma.$disconnect(); await rm(dir, { recursive: true, force: true }); }
});

test('image decoding accepts the 5 MiB limit and rejects oversized or malformed base64', () => {
  const limit = 5 * 1024 * 1024;
  const image = Buffer.alloc(limit);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(image);
  const encoded = image.toString('base64');
  assert.equal(decodeRequestImage({ mimeType: 'image/png', data: encoded }).bytes.length, limit);
  const oversized = Buffer.concat([image, Buffer.from([0])]).toString('base64');
  assert.throws(() => decodeRequestImage({ mimeType: 'image/png', data: oversized }), InvalidRequestImage);
  assert.throws(() => decodeRequestImage({ mimeType: 'image/png', data: encoded.slice(0, -8) + '=AAA' + encoded.slice(-4) }), InvalidRequestImage);
  assert.throws(() => decodeRequestImage({ mimeType: 'image/png', data: encoded.slice(0, -4) + 'AA!A' }), InvalidRequestImage);
  assert.throws(() => decodeRequestImage({ mimeType: 'image/png', data: encoded.slice(0, -4) + 'AA=A' }), InvalidRequestImage);
});
