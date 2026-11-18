import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../dist/app.js';

test('submitting request cards commits every card and attachment together', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'daiko-batch-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  await writeFile(path.join(dir, 'test.db'), '');
  const imageDir = path.join(dir, 'images');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const origin = 'http://localhost:5174';
  const fan = { id: 'fan-id', name: 'Fan', email: 'fan@example.com' };
  const app = await createApp({
    prisma, allowedOrigins: [origin], adminEmails: [], logger: false, requestImageDirectory: imageDir,
    resolveIdentity: async cookie => cookie === 'fan' ? fan : null,
  });
  try {
    const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8',
    });
    assert.equal(migrated.status, 0, migrated.stderr);
    const group = await prisma.group.create({ data: {
      name: 'Live', members: { create: [{ name: 'A' }, { name: 'B' }] }, offerings: { create: { name: 'Cheki' } },
    }, include: { members: { orderBy: { name: 'asc' } }, offerings: true } });
    const event = await prisma.event.create({ data: {
      name: 'Concert', groupId: group.id, groupName: group.name, startsAt: new Date('2027-05-01T12:00:00Z'),
    } });
    const endpoint = `/api/events/${event.id}/requests/batch`;
    const send = (requests, headers = { origin, cookie: 'fan' }) =>
      app.inject({ method: 'POST', url: endpoint, headers, payload: { requests } });
    const png = Buffer.from([137,80,78,71,13,10,26,10,0]);
    const member = {
      memberId: group.members[0].id, offeringId: group.offerings[0].id, amount: 2, message: 'First',
      image: { mimeType: 'image/png', data: png.toString('base64') },
    };
    const goods = { type: 'GOODS', message: 'Towel' };
    const second = { memberId: group.members[1].id, offeringId: group.offerings[0].id, message: 'Last' };

    assert.equal((await send([goods], { origin })).statusCode, 401);
    assert.equal((await send([goods], { origin: 'https://another.example', cookie: 'fan' })).statusCode, 403);
    assert.equal((await send([])).statusCode, 400);
    assert.equal((await send(Array(11).fill(goods))).statusCode, 400);
    const tooLargeTogether = Buffer.alloc(3 * 1024 * 1024 - 1024);
    png.copy(tooLargeTogether);
    const withLargeImage = { ...member, image: { ...member.image, data: tooLargeTogether.toString('base64') } };
    const oversized = await send([withLargeImage, withLargeImage]);
    assert.equal(oversized.statusCode, 400);
    assert.match(oversized.json().error, /5 MiB/);

    // A bad selection in the last card rolls back both earlier rows and the file.
    assert.equal((await send([member, goods, { ...second, offeringId: 'stale' }])).statusCode, 400);
    assert.equal(await prisma.request.count(), 0);
    assert.deepEqual(await readdir(imageDir), []);

    const saved = await send([member, goods, second]);
    assert.equal(saved.statusCode, 201, saved.body);
    const items = saved.json().requests;
    assert.deepEqual(items.map(item => [item.type, item.memberName, item.message]), [
      ['CUSTOM', 'A', 'First'], ['GOODS', null, 'Towel'], ['CUSTOM', 'B', 'Last'],
    ]);
    const rows = await prisma.request.findMany({ orderBy: { sequence: 'asc' } });
    assert.deepEqual(rows.map(row => row.id), items.map(item => item.id));
    assert.ok(rows.every(row => row.eventId === event.id && row.userId === fan.id));
    assert.equal((await readdir(imageDir)).length, 1);
    const photo = await app.inject({ method: 'GET', url: `/api/requests/${items[0].id}/image`, headers: { cookie: 'fan' } });
    assert.deepEqual(photo.rawPayload, png);
  } finally {
    await app.close();
    await prisma.$disconnect();
    await rm(dir, { recursive: true, force: true });
  }
});
