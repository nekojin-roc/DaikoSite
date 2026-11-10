import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { incrementHostCounter, incrementProgram, prepareRelease } from '../scripts/prepare-release.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
function identity(cwd) {
  git(cwd, 'config', 'user.name', 'Release Test');
  git(cwd, 'config', 'user.email', 'release-test@example.invalid');
}
function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'daiko-release-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const remote = path.join(dir, 'remote.git');
  const local = path.join(dir, 'local');
  git(dir, 'init', '--bare', '--initial-branch=main', remote);
  mkdirSync(local);
  git(local, 'init', '--initial-branch=main');
  identity(local);
  writeFileSync(path.join(local, 'source.txt'), 'release');
  git(local, 'add', 'source.txt');
  git(local, 'commit', '-m', 'Source');
  git(local, 'remote', 'add', 'origin', remote);
  git(local, 'push', '-u', 'origin', 'main');
  return { dir, remote, local };
}
const env = { DAIKO_RELEASE_HOST: 'test@example.invalid', DAIKO_RELEASE_SSH_KEY: 'identity' };

test('reads the GitHub commit and increments the host on every invocation', t => {
  const { local } = fixture(t);
  let value = 8;
  const increment = options => {
    assert.deepEqual(options, { host: env.DAIKO_RELEASE_HOST, container: 'daiko-staging-staging-api-1', sshKey: 'identity' });
    return ++value;
  };
  const first = prepareRelease({ cwd: local, env, increment });
  assert.equal(first.commit, git(local, 'rev-parse', 'HEAD'));
  assert.equal(first.build, 9);
  assert.equal(prepareRelease({ cwd: local, env, increment }).build, 10);
  assert.equal(git(local, 'status', '--porcelain'), '');
});

test('never increments when the checkout is dirty, ahead, or behind GitHub', t => {
  const { dir, remote, local } = fixture(t);
  let calls = 0;
  const options = { cwd: local, env, increment: () => { calls++; return 9; } };
  writeFileSync(path.join(local, 'untracked.txt'), 'change');
  assert.throws(() => prepareRelease(options), /clear local changes/);
  rmSync(path.join(local, 'untracked.txt'));
  const other = path.join(dir, 'other');
  git(dir, 'clone', remote, other);
  identity(other);
  writeFileSync(path.join(other, 'source.txt'), 'new source');
  git(other, 'add', 'source.txt');
  git(other, 'commit', '-m', 'Next source');
  git(other, 'push', 'origin', 'main');
  assert.throws(() => prepareRelease(options), /must match GitHub/);
  git(local, 'pull', '--ff-only', 'origin', 'main');
  writeFileSync(path.join(local, 'source.txt'), 'unpublished');
  git(local, 'add', 'source.txt');
  git(local, 'commit', '-m', 'Ahead');
  assert.throws(() => prepareRelease(options), /must match GitHub/);
  assert.equal(calls, 0);
});

test('rejects unsafe host and container identifiers before SSH', () => {
  assert.throws(() => incrementHostCounter({ host: '-bad', container: 'api' }), /DAIKO_RELEASE_HOST/);
  assert.throws(() => incrementHostCounter({ host: 'admin@host', container: 'api;false' }), /DAIKO_RELEASE_CONTAINER/);
});

test('host SQL assigns unique numbers under concurrent SQLite updates', async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'daiko-counter-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const url = `file:${path.join(dir, 'counter.db').replaceAll('\\', '/')}`;
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    await db.$executeRawUnsafe('CREATE TABLE "BuildCounter" ("id" INTEGER NOT NULL PRIMARY KEY, "value" INTEGER NOT NULL)');
    await db.$executeRawUnsafe('INSERT INTO "BuildCounter" ("id", "value") VALUES (1, 8)');
  } finally { await db.$disconnect(); }
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', incrementProgram], {
      cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, DATABASE_URL: url },
    });
    let out = '', err = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(Number(out.trim())) : reject(new Error(err)));
  });
  assert.deepEqual((await Promise.all([run(), run(), run(), run()])).sort((a,b) => a-b), [9,10,11,12]);
});
