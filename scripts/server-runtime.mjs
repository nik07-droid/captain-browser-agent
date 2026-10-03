import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Capture this once at server startup. Re-reading disk on /health would make an
// old imported planner incorrectly advertise the new code's fingerprint.
export function expectedServerRuntime(root) {
  const hash = createHash('sha256');
  for (const file of ['server/index.mjs', 'server/planner.mjs', 'server/privacy.mjs', 'server/sites.mjs', 'scripts/server-runtime.mjs', 'package.json']) {
    hash.update(`${file}\0`);
    try { hash.update(readFileSync(join(root, file))); }
    catch (error) { if (error.code !== 'ENOENT' || file !== 'server/sites.mjs') throw error; hash.update('absent'); }
    hash.update('\0');
  }
  return { version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, fingerprint: hash.digest('hex') };
}

export async function probeServer(url = 'http://127.0.0.1:4317/health') {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return { unavailable: true, occupied: true };
    try { return await response.json(); }
    catch { return { unavailable: true, occupied: true }; }
  } catch { return null; }
}

export function serverMatches(health, expected) {
  return Boolean(health?.ok && health.service === 'captain' && health.version === expected.version && health.fingerprint === expected.fingerprint);
}

export async function restartVerifiedServer(root, port = 4317) {
  if (process.platform !== 'win32') throw new Error('The running CAPTAIN server is outdated. Stop its server process and run npm run demo again. Automatic verified restart is currently Windows-only.');
  const { stdout } = await promisify(execFile)('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', 'stop-verified-server.ps1'),
    '-ExpectedEntry', resolve(root, 'server', 'index.mjs'), '-ExpectedNode', process.execPath, '-Port', String(port),
  ], { windowsHide: true, timeout: 15000 });
  return JSON.parse(stdout);
}

export function launchServer(root) {
  return new Promise((resolveStart, reject) => {
    const child = spawn(process.execPath, [join(root, 'server', 'index.mjs')], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolveStart(); });
  });
}

export async function ensureServerRuntime(root, options = {}) {
  const expected = options.expected || expectedServerRuntime(root);
  const probe = options.probe || probeServer;
  const restart = options.restart || (() => restartVerifiedServer(root));
  const launch = options.launch || (() => launchServer(root));
  const pause = options.pause || (ms => new Promise(resolvePause => setTimeout(resolvePause, ms)));
  let health = await probe();
  if (serverMatches(health, expected)) return { ...expected, restarted: false };
  if (health) {
    if (health.service !== 'captain' || !health.ok) throw new Error('Port 4317 is occupied by an unrecognized service. CAPTAIN did not stop it. Close that service or choose a free port.');
    if (Number(health.activeRequests) > 0) throw new Error('CAPTAIN is still processing a command. Wait for it to finish, then start CAPTAIN again to apply the server update.');
    try { await restart(); }
    catch (error) { throw new Error(`CAPTAIN server code is outdated, but its process could not be safely verified for restart. Stop the old CAPTAIN server manually, then run npm run demo again. ${error.message}`); }
  }
  const restarted = Boolean(health);
  await launch();
  for (let attempt = 0; attempt < 40; attempt++) {
    await pause(150);
    health = await probe();
    if (serverMatches(health, expected)) return { ...expected, restarted };
  }
  throw new Error('The current CAPTAIN server did not start on port 4317. Another process may be using the port, or server files changed during startup. No browser commands were started.');
}
