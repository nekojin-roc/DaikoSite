import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Executed inside the running API container, with its existing SQLite volume.
// One SQL statement makes concurrent increments atomic. A missing migration or
// seed row is an error: never silently create or reset a production counter.
export const incrementProgram = `
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  await db.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
  const rows = await db.$queryRawUnsafe('UPDATE "BuildCounter" SET "value" = "value" + 1 WHERE "id" = 1 RETURNING "value"');
  if (rows.length !== 1) throw new Error('Build counter row is missing');
  console.log(String(rows[0].value));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
`;

function runGit(args, cwd, message) {
  try {
    return execFileSync('git', args, {
      cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error(message);
  }
}

export function incrementHostCounter({ host, container, sshKey }) {
  // SSH constructs a command for a remote shell. Only allow ordinary host and
  // container identifiers, and pass program text on stdin rather than quoting it.
  if (!host || !/^[A-Za-z0-9][A-Za-z0-9_.@:-]*$/.test(host)) {
    throw new Error('Set DAIKO_RELEASE_HOST to the production SSH destination (for example, user@hostname).');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(container)) {
    throw new Error('DAIKO_RELEASE_CONTAINER must be a valid Docker container name.');
  }
  try {
    const output = execFileSync('ssh', [
      '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', ...(sshKey ? ['-o', 'IdentitiesOnly=yes', '-i', sshKey] : []), host,
      'docker', 'exec', '-i', container, 'node',
    ], { encoding: 'utf8', input: incrementProgram, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (!/^\d+$/.test(output) || !Number.isSafeInteger(Number(output)) || Number(output) < 1) {
      throw new Error('The host did not return a valid build number. Check the host before retrying.');
    }
    return Number(output);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('The host did not return')) throw error;
    throw new Error('Could not increment the host counter. Verify SSH access, the API container, and its database migration. The counter may have advanced if the connection failed; check before retrying.');
  }
}

export function prepareRelease({ cwd = process.cwd(), env = process.env, increment = incrementHostCounter } = {}) {
  const root = runGit(['rev-parse', '--show-toplevel'], cwd, 'Run this command inside the Daiko Git checkout.');
  const branch = runGit(['branch', '--show-current'], root, 'Unable to determine the current Git branch.');
  if (branch !== 'main') throw new Error('Switch to local main before preparing a release.');
  runGit(['fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main'], root,
    'Could not fetch GitHub origin/main. Check your connection and credentials.');
  const remoteHead = runGit(['rev-parse', 'refs/remotes/origin/main'], root, 'Could not read origin/main.');
  const localHead = runGit(['rev-parse', 'HEAD'], root, 'Could not read the current commit.');
  if (localHead !== remoteHead) throw new Error('Local main must match GitHub origin/main before preparing a release.');
  if (runGit(['status', '--porcelain'], root, 'Could not check the working tree.')) {
    throw new Error('Commit, push, or otherwise clear local changes before preparing a release.');
  }
  const build = increment({ host: env.DAIKO_RELEASE_HOST, container: env.DAIKO_RELEASE_CONTAINER || 'daiko-staging-staging-api-1', sshKey: env.DAIKO_RELEASE_SSH_KEY });
  return { build, commit: remoteHead };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { build, commit } = prepareRelease();
    console.log(`Prepared build ${build} on the production host from GitHub commit ${commit}.`);
    console.log('The counter is updated immediately, even if you do not deploy afterwards.');
  } catch (error) {
    console.error(`Release preparation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
