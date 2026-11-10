import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../scripts/prepare-release.mjs', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
const prepare = cwd => spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
const buildFile = cwd => path.join(cwd, 'client', 'build.json');
const build = cwd => JSON.parse(readFileSync(buildFile(cwd), 'utf8')).build;
const setBuild = (cwd, value) => writeFileSync(buildFile(cwd), `${JSON.stringify({ build: value }, null, 2)}\n`);
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
  mkdirSync(path.join(local, 'client'));
  setBuild(local, 8);
  git(local, 'add', 'client/build.json');
  git(local, 'commit', '-m', 'Release 8');
  git(local, 'remote', 'add', 'origin', remote);
  git(local, 'push', '-u', 'origin', 'main');
  return { dir, remote, local };
}

test('prepares the next GitHub build once without touching unrelated changes', t => {
  const { local } = fixture(t);
  writeFileSync(path.join(local, 'feature.txt'), 'work in progress');
  const first = prepare(local);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Prepared build 9/);
  assert.equal(build(local), 9);
  const repeat = prepare(local);
  assert.notEqual(repeat.status, 0);
  assert.match(repeat.stderr, /uncommitted changes/);
  assert.equal(build(local), 9);
});

test('refuses a dirty build file and keeps its existing number', t => {
  const { local } = fixture(t);
  setBuild(local, 10);
  const result = prepare(local);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /uncommitted changes/);
  assert.equal(build(local), 10);
});

test('fetches GitHub first and refuses to advance an out-of-date branch', t => {
  const { dir, remote, local } = fixture(t);
  const other = path.join(dir, 'other');
  git(dir, 'clone', remote, other);
  identity(other);
  setBuild(other, 9);
  git(other, 'add', 'client/build.json');
  git(other, 'commit', '-m', 'Release 9');
  git(other, 'push', 'origin', 'main');
  const stale = prepare(local);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /must match GitHub origin\/main/);
  assert.equal(build(local), 8);
  git(local, 'pull', '--ff-only', 'origin', 'main');
  const fresh = prepare(local);
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.equal(build(local), 10);
});

test('refuses unpublished local commits and leaves the build unchanged', t => {
  const { local } = fixture(t);
  writeFileSync(path.join(local, 'feature.txt'), 'committed but not pushed');
  git(local, 'add', 'feature.txt');
  git(local, 'commit', '-m', 'Unpublished work');
  const result = prepare(local);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must match GitHub origin\/main/);
  assert.equal(build(local), 8);
});
