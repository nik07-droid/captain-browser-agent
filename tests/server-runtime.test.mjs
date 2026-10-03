import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureServerRuntime, expectedServerRuntime, serverMatches } from '../scripts/server-runtime.mjs';

const expected = { version: 'test-version', fingerprint: 'test-fingerprint' };
const current = { ok: true, service: 'captain', ...expected, activeRequests: 0 };
function harness(health) {
  const calls = [];
  return { calls, options: {
    expected,
    probe: async () => { calls.push('probe'); return typeof health === 'function' ? health(calls) : health; },
    launch: async () => calls.push('launch'),
    restart: async () => calls.push('restart'),
    pause: async () => {},
  } };
}

test('server build requires service identity, version and source fingerprint, not merely HTTP health', () => {
  assert.equal(serverMatches(current, expected), true);
  for (const state of [null, { ok: true }, { ...current, service: 'other' }, { ...current, fingerprint: 'old' }, { ...current, version: 'old' }]) assert.equal(serverMatches(state, expected), false);
});

test('current server is reused without stopping or spawning anything', async () => {
  const { calls, options } = harness(current);
  assert.equal((await ensureServerRuntime('unused', options)).restarted, false);
  assert.deepEqual(calls, ['probe']);
});

test('missing server starts and must advertise the expected loaded build', async () => {
  const { calls, options } = harness(calls => calls.includes('launch') ? current : null);
  assert.equal((await ensureServerRuntime('unused', options)).restarted, false);
  assert.deepEqual(calls, ['probe', 'launch', 'probe']);
});

test('legacy healthy CAPTAIN is restarted only through the verified process helper', async () => {
  const { calls, options } = harness(calls => calls.includes('launch') ? current : { ok: true, service: 'captain' });
  assert.equal((await ensureServerRuntime('unused', options)).restarted, true);
  assert.deepEqual(calls, ['probe', 'restart', 'launch', 'probe']);
});

test('unrecognized service and active CAPTAIN requests are never stopped', async () => {
  for (const health of [{ ok: true, service: 'something-else' }, { unavailable: true, occupied: true }, { ...current, fingerprint: 'old', activeRequests: 1 }]) {
    const { calls, options } = harness(health);
    await assert.rejects(ensureServerRuntime('unused', options), /unrecognized service|still processing/);
    assert.deepEqual(calls, ['probe']);
  }
});

test('failed process identity verification stops startup before launching a replacement', async () => {
  const { calls, options } = harness({ ...current, fingerprint: 'old' });
  options.restart = async () => { calls.push('verify'); throw new Error('wrong command line'); };
  await assert.rejects(ensureServerRuntime('unused', options), /could not be safely verified/);
  assert.deepEqual(calls, ['probe', 'verify']);
});

test('old or missing health after launch cannot be mistaken for success', async () => {
  const { calls, options } = harness(null);
  await assert.rejects(ensureServerRuntime('unused', options), /current CAPTAIN server did not start/);
  assert.equal(calls.filter(x => x === 'probe').length, 41);
  assert.equal(calls.filter(x => x === 'launch').length, 1);
  assert.equal(calls.includes('restart'), false);
});

test('source fingerprint changes for planner, privacy, site registry and package changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'captain-runtime-test-'));
  try {
    await mkdir(join(root, 'server')); await mkdir(join(root, 'scripts'));
    for (const name of ['server/index.mjs', 'server/planner.mjs', 'server/privacy.mjs', 'scripts/server-runtime.mjs']) await writeFile(join(root, name), name);
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: 'test' }));
    let previous = expectedServerRuntime(root);
    assert.deepEqual(expectedServerRuntime(root), previous);
    for (const name of ['server/planner.mjs', 'server/privacy.mjs', 'server/sites.mjs']) {
      await writeFile(join(root, name), `${name}-changed`);
      const next = expectedServerRuntime(root);
      assert.notEqual(next.fingerprint, previous.fingerprint, name);
      assert.equal(next.version, 'test');
      previous = next;
    }
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: 'next' }));
    assert.equal(expectedServerRuntime(root).version, 'next');
    assert.notEqual(expectedServerRuntime(root).fingerprint, previous.fingerprint);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Windows restart helper validates loopback port, exact executable, full entry command and process identity', async () => {
  const source = await readFile(new URL('../scripts/stop-verified-server.ps1', import.meta.url), 'utf8');
  assert.match(source, /Get-NetTCPConnection -LocalPort \$Port -State Listen/);
  assert.match(source, /ExecutablePath -ine \$nodePath/);
  assert.match(source, /CommandLine -inotmatch \$expectedCommand/);
  assert.match(source, /CreationDate -ne \$serverProcess.CreationDate/);
  assert.doesNotMatch(source, /taskkill|Stop-Process -Name/);
});
