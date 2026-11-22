import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../dist/app.js';

const ORIGIN = 'http://localhost:5174';
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const gif = Buffer.from('GIF89aExample');

function upload(mimeType, bytes) {
  return { mimeType, data: bytes.toString('base64') };
}

test('owners can edit pending requests without moving or unlocking them', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'daiko-request-edit-'));
  const database = path.join(directory, 'test.db');
  const url = `file:${database.replaceAll('\\', '/')}`;
  const imageDirectory = path.join(directory, 'images');
  await writeFile(database, '');
  const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8',
  });
  assert.equal(migration.status, 0, migration.stderr);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const user = { id: 'fan', name: 'Fan', email: 'fan@example.com' };
  const users = {
    fan: user,
    other: { id: 'other', name: 'Other', email: 'other@example.com' },
    admin: { id: 'admin', name: 'Admin', email: 'admin@example.com' },
  };
  let clock = Date.parse('2027-04-15T15:45:00.000Z');
  t.mock.method(Date, 'now', () => clock);
  let beforeTransaction;
  const app = await createApp({
    prisma: new Proxy(prisma, {
      get(target, property) {
        if (property !== '$transaction') return Reflect.get(target, property, target);
        return async operation => {
          const before = beforeTransaction;
          beforeTransaction = undefined;
          if (before) await before();
          return target.$transaction(operation);
        };
      },
    }),
    resolveIdentity: async cookie => users[cookie] ?? null,
    adminEmails: [users.admin.email],
    allowedOrigins: [ORIGIN],
    requestImageDirectory: imageDirectory,
    logger: false,
  });
  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
    await rm(directory, { recursive: true, force: true });
  });
  const call = (method, url, cookie, payload, origin = ORIGIN) => app.inject({
    method, url, headers: { origin, ...(cookie ? { cookie } : {}) },
    ...(payload === undefined ? {} : { payload }),
  });
  const edit = (id, payload, cookie = 'fan', origin = ORIGIN) => call('PATCH', `/api/requests/${id}`, cookie, payload, origin);
  const photo = id => call('GET', `/api/requests/${id}/image`, 'fan');
  const submit = async (event, payload) => {
    const response = await call('POST', `/api/events/${event.id}/requests`, 'fan', payload);
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  };

  const group = await prisma.group.create({
    data: { name: 'Live', members: { create: [{ name: 'A' }, { name: 'B' }] }, offerings: { create: [{ name: 'Cheki' }, { name: 'Photo' }] } },
    include: { members: { orderBy: { name: 'asc' } }, offerings: { orderBy: { name: 'asc' } } },
  });
  const otherGroup = await prisma.group.create({
    data: { name: 'Other Idol', members: { create: { name: 'C' } }, offerings: { create: { name: 'Other ticket' } } },
    include: { members: true, offerings: true },
  });
  const event = await prisma.event.create({
    data: { name: 'Today in Japan', groupId: group.id, groupName: group.name, startsAt: new Date('2027-04-15T15:00:00.000Z') },
  });
  const pastEvent = await prisma.event.create({
    data: { name: 'Yesterday in Japan', groupName: group.name, startsAt: new Date('2027-04-15T14:59:59.999Z') },
  });
  const goods = await submit(event, { type: 'GOODS', message: 'Towel' });
  const past = await submit(pastEvent, { type: 'GOODS', message: 'Previous day' });
  const cheki = await submit(event, { type: 'CHEKI', message: 'Sign please', amount: 1 });
  const custom = await submit(event, {
    memberId: group.members[0].id, offeringId: group.offerings[0].id, amount: 2,
    message: 'Hello', image: upload('image/png', png),
  });

  await t.test('only the owner can edit unfinished cards for the current day', async () => {
    assert.equal((await edit(goods.id, { message: 'Change' }, null)).statusCode, 401);
    assert.equal((await edit(goods.id, { message: 'Change' }, 'fan', 'https://other.example')).statusCode, 403);
    assert.equal((await edit(goods.id, { message: 'Change' }, 'other')).statusCode, 404);
    assert.equal((await edit(goods.id, { message: 'Change' }, 'admin')).statusCode, 404);
    assert.equal((await edit('missing', { message: 'Change' })).statusCode, 404);
    const locked = await edit(past.id, { message: 'Change' });
    assert.equal(locked.statusCode, 409);
    assert.match(locked.json().error, /Past event/);

    const queueUrl = `/api/events/${event.id}/requests`;
    const before = (await call('GET', queueUrl, 'admin')).json().requests;
    const edited = await edit(goods.id, { message: '  Towel and shirt  ' });
    assert.equal(edited.statusCode, 200, edited.body);
    assert.equal(edited.json().message, 'Towel and shirt');
    assert.equal(edited.json().event.id, event.id);
    assert.equal(edited.json().event.groupId, group.id);
    const after = (await call('GET', queueUrl, 'admin')).json().requests;
    assert.deepEqual(after, before.map(item => item.id === goods.id ? { ...item, message: 'Towel and shirt' } : item));

    for (const invalid of [{ amount: 1 }, { type: 'CHEKI' }, { image: null }, { userId: users.other.id }]) {
      assert.equal((await edit(goods.id, { message: 'Change', ...invalid })).statusCode, 400);
    }
    for (const invalid of [undefined, null, 0, 1.5, 1001]) {
      assert.equal((await edit(cheki.id, { message: 'Change', amount: invalid })).statusCode, 400);
    }
    const resized = await edit(cheki.id, { message: 'Updated Cheki', amount: 3 });
    assert.equal(resized.statusCode, 200, resized.body);
    assert.equal(resized.json().amount, 3);
    assert.equal((await call('POST', `/api/requests/${cheki.id}/finish`, 'admin')).statusCode, 204);
    const finished = await edit(cheki.id, { message: 'After completion', amount: 1 });
    assert.equal(finished.statusCode, 409);
    assert.match(finished.json().error, /Finished requests/);
  });

  await t.test('custom edits validate new selections and replace attachments safely', async () => {
    const original = await prisma.request.findUniqueOrThrow({ where: { id: custom.id } });
    await prisma.offering.update({ where: { id: group.offerings[0].id }, data: { archived: true } });
    const updated = await edit(custom.id, { message: 'Keep original choices', amount: null });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().amount, null);
    assert.equal(updated.json().offeringName, 'Cheki');
    assert.equal(updated.json().imageUrl, custom.imageUrl);
    assert.deepEqual((await photo(custom.id)).rawPayload, png);

    for (const invalid of [
      { memberId: otherGroup.members[0].id },
      { offeringId: otherGroup.offerings[0].id },
      { offeringId: group.offerings[0].id },
      { image: upload('image/gif', png) },
    ]) {
      const denied = await edit(custom.id, { message: 'Never saved', ...invalid });
      assert.equal(denied.statusCode, 400, denied.body);
    }
    assert.deepEqual(await readdir(imageDirectory), [original.imageFile]);
    assert.deepEqual((await photo(custom.id)).rawPayload, png);

    const replaced = await edit(custom.id, {
      message: 'Different member and photo', amount: 3,
      memberId: group.members[1].id, offeringId: group.offerings[1].id, image: upload('image/gif', gif),
    });
    assert.equal(replaced.statusCode, 200, replaced.body);
    assert.equal(replaced.json().imageUrl, custom.imageUrl);
    const newPhoto = await call('GET', replaced.json().imageUrl.replace('/daiko-api/', '/api/'), 'fan');
    assert.deepEqual(newPhoto.rawPayload, gif);
    const row = await prisma.request.findUniqueOrThrow({ where: { id: custom.id } });
    assert.deepEqual(row, {
      ...original, message: 'Different member and photo', amount: 3,
      memberName: 'B', offeringName: 'Photo', imageFile: row.imageFile,
    });
    assert.notEqual(row.imageFile, original.imageFile);
    assert.deepEqual(await readdir(imageDirectory), [row.imageFile]);
    const myRequests = (await call('GET', '/api/my-requests', 'fan')).json().requests;
    assert.deepEqual(myRequests.find(item => item.id === custom.id), replaced.json());

    const removed = await edit(custom.id, { message: 'Remove photo', image: null });
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal(removed.json().imageUrl, null);
    assert.equal((await photo(custom.id)).statusCode, 404);
    assert.deepEqual(await readdir(imageDirectory), []);
  });

  await t.test('an edit crossing JST midnight is rejected without leaking a replacement image', async () => {
    const original = await prisma.request.findUniqueOrThrow({ where: { id: custom.id } });
    beforeTransaction = () => { clock = Date.parse('2027-04-16T15:00:00.000Z'); };
    const raced = await edit(custom.id, { message: 'Missed the deadline', image: upload('image/gif', gif) });
    assert.equal(raced.statusCode, 409, raced.body);
    assert.deepEqual(await prisma.request.findUniqueOrThrow({ where: { id: custom.id } }), original);
    assert.deepEqual(await readdir(imageDirectory), []);
  });
});
