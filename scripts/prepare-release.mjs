import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function git(args, message) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error(message);
  }
}

try {
  const root = git(['rev-parse', '--show-toplevel'], 'Run this command inside the Daiko Git checkout.');
  process.chdir(root);
  const branch = git(['branch', '--show-current'], 'Unable to determine the current Git branch.');
  if (branch !== 'main') throw new Error('Switch to the local main branch before preparing a release.');

  git(['fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main'],
    'Could not fetch origin/main. Check your GitHub connection and credentials.');
  const remoteHead = git(['rev-parse', 'refs/remotes/origin/main'], 'Could not read origin/main.');
  const localHead = git(['rev-parse', 'HEAD'], 'Could not read the current commit.');
  if (localHead !== remoteHead) {
    throw new Error('Local main must match GitHub origin/main. Publish or update your branch before preparing a release.');
  }
  if (git(['status', '--porcelain', '--', 'client/build.json'], 'Could not check client/build.json.')) {
    throw new Error('client/build.json has uncommitted changes. Commit or restore them before preparing a release.');
  }

  const remoteText = git(['show', 'refs/remotes/origin/main:client/build.json'], 'GitHub origin/main has no client/build.json.');
  const remote = JSON.parse(remoteText);
  if (!Number.isSafeInteger(remote.build) || remote.build < 0 || remote.build >= Number.MAX_SAFE_INTEGER) {
    throw new Error('GitHub client/build.json must contain a non-negative safe integer build number.');
  }
  const file = path.join(root, 'client', 'build.json');
  const local = JSON.parse(readFileSync(file, 'utf8'));
  if (local.build !== remote.build) throw new Error('Local build number does not match GitHub origin/main.');

  remote.build += 1;
  writeFileSync(file, `${JSON.stringify(remote, null, 2)}\n`, 'utf8');
  console.log(`Prepared build ${remote.build} from GitHub origin/main. Commit and push this change with your release.`);
} catch (error) {
  console.error(`Release preparation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
