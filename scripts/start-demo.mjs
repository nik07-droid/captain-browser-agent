import { access, mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cdp, debugJson, ensureController, evaluate, extensionPath, findSession, reconnectPanels, reloadInPlace } from './reload-in-place.mjs';
import { ensureServerRuntime } from './server-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function reconnectExistingPanels(session) {
  // Starting CAPTAIN again repairs stale website widgets without navigating or
  // refreshing their documents. The report includes any restricted/closed tab.
  const panels = await reconnectPanels(session);
  console.log(JSON.stringify({ panels }));
}
let browser;
for (const candidate of chromeCandidates) if (await exists(candidate)) { browser = candidate; break; }
if (!browser) throw new Error('Chrome or Edge was not found.');

try { await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2000) }); }
catch {
  const ollama = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
  ollama.on('error', error => console.error(`Optional Ollama service could not start: ${error.message}`));
  ollama.unref();
}
const serverRuntime = await ensureServerRuntime(root);
console.log(`CAPTAIN server ${serverRuntime.version} ${serverRuntime.fingerprint.slice(0, 12)}${serverRuntime.restarted ? ' updated' : ' ready'}.`);

let version;
try { version = await debugJson('/json/version'); } catch {}
let bootstrapTargetId;
if (!version) {
  const profile = join(root, 'runtime', 'captain-chrome-profile-v3');
  await mkdir(profile, { recursive: true });
  const child = spawn(browser, [
    `--user-data-dir=${profile}`, '--enable-unsafe-extension-debugging',
    '--remote-debugging-port=9223', '--no-first-run', '--no-default-browser-check',
    '--incognito', '--new-window', 'about:blank',
  ], { detached: true, stdio: 'ignore' });
  child.on('error', error => console.error(`CAPTAIN browser could not start: ${error.message}`));
  child.unref();
  for (let attempt = 0; attempt < 50; attempt++) {
    try { version = await debugJson('/json/version'); break; } catch { await pause(150); }
  }
  if (!version?.webSocketDebuggerUrl) throw new Error('The dedicated CAPTAIN Chrome debugging endpoint did not start.');
  const blanks = (await debugJson('/json/list')).filter(target => target.type === 'page' && target.url === 'about:blank');
  if (blanks.length === 1) bootstrapTargetId = blanks[0].id;
}

const browserUrl = version.webSocketDebuggerUrl;
const { extensions = [] } = await cdp(browserUrl, 'Extensions.getExtensions');
const installed = extensions.find(item => item.path?.toLowerCase() === extensionPath.toLowerCase());
const expected = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8')).version;
if (installed) {
  const session = await findSession(installed.id);
  let build;
  if (session) {
    try { build = await evaluate(session.controller, `chrome.runtime.sendMessage({type:'GET_STATE'}).then(state=>state.build||'unknown')`); } catch {}
  }
  if (process.argv.includes('--reload') || (session && build !== expected)) {
    await reloadInPlace();
    console.log('CAPTAIN updated in the existing Incognito window. Re-enable Speak if the microphone was disconnected.');
  } else {
    const ready = await ensureController(browserUrl, installed.id, { previous: session, bootstrapTargetId });
    await reconnectExistingPanels(ready);
    console.log(`CAPTAIN is ready in Incognito window ${ready.windowId}. No demo page was opened. Say “Hey Captain” after enabling Speak.`);
  }
} else {
  const loaded = await cdp(browserUrl, 'Extensions.loadUnpacked', { path: extensionPath, enableInIncognito: true });
  const ready = await ensureController(browserUrl, loaded.id, { bootstrapTargetId });
  await reconnectExistingPanels(ready);
  console.log(`CAPTAIN is ready in Incognito window ${ready.windowId}. Enable Speak, then say “Hey Captain”. Website tabs are created only when you ask.`);
}
