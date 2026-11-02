import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../dist/app.js';
import { EventImportError } from '../dist/event-import.js';

const ORIGIN = 'http://localhost:5173';
const EVENT_URL = 'https://ticketdive.com/event/kuruidaore15';
const EVENT_NAME = 'MAD\'S iNK presents「狂い倒れvol.15」';
const ORIGINAL_IMAGE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0y8AAAAASUVORK5CYII=', 'base64');

test('event import authorization, original-image storage, and persistence', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'daiko-event-import-'));
  const databasePath = path.join(directory, 'test.db');
  const databaseUrl = `file:${databasePath.replaceAll('\\', '/')}`;
  const imageDirectory = path.join(directory, 'event-images');
  const apps = [];
  const clients = [];
  t.after(async () => {
    await Promise.all(apps.map(app => app.close()));
    await Promise.all(clients.map(client => client.$disconnect()));
    await rm(directory, { recursive: true, force: true });
  });
  await writeFile(databasePath, '');
  const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8',
  });
  assert.equal(migration.status, 0, migration.stderr);
  const identities = {
    'sid=admin': { id: 'admin', name: 'Owner', email: 'owner@example.com' },
    'sid=user': { id: 'user', name: 'Fan', email: 'fan@example.com' },
  };
  const calls = [];
  let importError;
  async function startApp() {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    clients.push(prisma);
    const app = await createApp({
      prisma,
      resolveIdentity: async cookie => identities[cookie] ?? null,
      adminEmails: ['owner@example.com'],
      allowedOrigins: [ORIGIN],
      eventImageDirectory: imageDirectory,
      logger: false,
      importEvent: async url => {
        calls.push(url);
        if (importError) throw importError;
        return { name: EVENT_NAME, image: ORIGINAL_IMAGE, contentType: 'image/png', extension: '.png' };
      },
    });
    apps.push(app);
    return app;
  }
  let app = await startApp();
  const call = (method, url, payload, cookie = 'sid=admin', origin = ORIGIN) => app.inject({
    method, url,
    headers: { ...(cookie ? { cookie } : {}), ...(method === 'POST' && origin ? { origin } : {}) },
    ...(payload === undefined ? {} : { payload }),
  });
  const importEvent = () => call('POST', '/api/events/import', { url: EVENT_URL });

  await t.test('rejects anonymous, non-admin, and untrusted-origin imports before fetching', async () => {
    for (const [cookie, origin, expected] of [
      [null, ORIGIN, 401],
      ['sid=user', ORIGIN, 403],
      ['sid=admin', 'https://untrusted.example', 403],
      ['sid=admin', null, 403],
    ]) {
      const response = await call('POST', '/api/events/import', { url: EVENT_URL }, cookie, origin);
      assert.equal(response.statusCode, expected);
    }
    assert.equal(calls.length, 0);
  });

  await t.test('rejects invalid import bodies without fetching', async () => {
    for (const payload of [{}, { url: '' }, { url: 42 }, { url: EVENT_URL, extra: true }, { url: 'x'.repeat(2049) }]) {
      assert.equal((await call('POST', '/api/events/import', payload)).statusCode, 400);
    }
    const malformed = await app.inject({
      method: 'POST', url: '/api/events/import',
      headers: { cookie: 'sid=admin', origin: ORIGIN, 'content-type': 'application/json' },
      payload: '{"url":',
    });
    assert.equal(malformed.statusCode, 400);
    assert.equal(calls.length, 0);
  });

  let imageUrl;
  await t.test('preserves the title and original image bytes and deduplicates repeated imports', async () => {
    const response = await importEvent();
    assert.equal(response.statusCode, 200);
    const imported = response.json();
    assert.equal(imported.name, EVENT_NAME);
    assert.match(imported.imageUrl, /^\/daiko-api\/event-images\/[a-f0-9]{64}\.png$/);
    imageUrl = imported.imageUrl;
    assert.deepEqual(calls, [EVENT_URL]);
    assert.deepEqual(await readFile(path.join(imageDirectory, path.basename(imageUrl))), ORIGINAL_IMAGE);
    const repeated = await importEvent();
    assert.equal(repeated.statusCode, 200);
    assert.deepEqual(repeated.json(), imported);
    assert.deepEqual(await readdir(imageDirectory), [path.basename(imageUrl)]);
  });

  await t.test('serves artwork to authenticated users with the original MIME type', async () => {
    const route = imageUrl.replace('/daiko-api/', '/api/');
    assert.equal((await call('GET', route, undefined, null)).statusCode, 401);
    const image = await call('GET', route, undefined, 'sid=user');
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers['content-type'], 'image/png');
    assert.equal(image.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(image.rawPayload, ORIGINAL_IMAGE);
    assert.equal((await call('GET', `/api/event-images/${'0'.repeat(64)}.png`)).statusCode, 404);
    for (const filename of ['test.db', '%2e%2e%2ftest.db', `${'a'.repeat(64)}.svg`]) {
      assert.equal((await call('GET', `/api/event-images/${filename}`)).statusCode, 404);
    }
  });

  const event = { name: EVENT_NAME, groupName: 'MAD\'S iNK', startsAt: '2027-04-10T10:00:00.000Z' };
  let eventId;
  await t.test('creates an event with stored artwork and rejects missing or unsafe local references', async () => {
    const created = await call('POST', '/api/events', { ...event, imageUrl });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().imageUrl, imageUrl);
    eventId = created.json().id;
    for (const invalidUrl of [
      `/daiko-api/event-images/${'0'.repeat(64)}.png`,
      '/daiko-api/event-images/../test.db',
      '/daiko-api/event-images/%2e%2e%2ftest.db',
      '/unrelated/image.png',
    ]) {
      assert.equal((await call('POST', '/api/events', { ...event, imageUrl: invalidUrl })).statusCode, 400);
    }
  });

  await t.test('keeps imported artwork and the event reference after restarting the app', async () => {
    await app.close();
    await clients[0].$disconnect();
    app = await startApp();
    const listed = await call('GET', '/api/events', undefined, 'sid=user');
    assert.equal(listed.statusCode, 200);
    const saved = listed.json().events.find(item => item.id === eventId);
    assert.equal(saved.imageUrl, imageUrl);
    assert.equal(saved.name, EVENT_NAME);
    const image = await call('GET', imageUrl.replace('/daiko-api/', '/api/'), undefined, 'sid=user');
    assert.equal(image.statusCode, 200);
    assert.deepEqual(image.rawPayload, ORIGINAL_IMAGE);
  });

  await t.test('reports actionable import errors and does not create incomplete events or images', async () => {
    importError = new EventImportError('Event image could not be downloaded', 502);
    const response = await importEvent();
    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.json(), { error: 'Event image could not be downloaded' });
    assert.deepEqual(await readdir(imageDirectory), [path.basename(imageUrl)]);
    assert.equal((await call('GET', '/api/events')).json().events.length, 1);
  });
});
