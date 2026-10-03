import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
await rm(dist, { recursive: true, force: true }); await mkdir(dist, { recursive: true });
await cp(join(root, 'extension'), join(dist, 'captain-chrome'), { recursive: true });
await rm(join(dist, 'captain-chrome', 'offscreen.html'), { force: true });
await rm(join(dist, 'captain-chrome', 'offscreen.js'), { force: true });
// The WASM-only bundle is pinned to the smaller default runtime. Do not ship
// the unused JSEP/WebGPU binaries that were retained in the development tree.
await rm(join(dist, 'captain-chrome', 'vendor', 'ort-wasm-simd-threaded.jsep.mjs'), { force: true });
await rm(join(dist, 'captain-chrome', 'vendor', 'ort-wasm-simd-threaded.jsep.wasm'), { force: true });
execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${join(dist, 'captain-chrome')}\\*' -DestinationPath '${join(dist, 'captain-chrome.zip')}' -Force`]);
await cp(join(dist, 'captain-chrome'), join(dist, 'captain-firefox'), { recursive: true });
const firefoxManifestPath = join(dist, 'captain-firefox', 'manifest.json');
const firefoxManifest = JSON.parse(await readFile(firefoxManifestPath, 'utf8'));
firefoxManifest.background = { scripts: ['service-worker.js'] };
firefoxManifest.permissions = firefoxManifest.permissions.filter(permission => permission !== 'debugger');
firefoxManifest.browser_specific_settings = { gecko: { id: 'captain@local.sih', strict_min_version: '121.0' } };
await writeFile(firefoxManifestPath, `${JSON.stringify(firefoxManifest, null, 2)}\n`);
execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${join(dist, 'captain-firefox')}\\*' -DestinationPath '${join(dist, 'captain-firefox.zip')}' -Force`]);
await writeFile(join(dist, 'README.txt'), 'Load captain-chrome or captain-firefox as an unpacked extension. Firefox uses DOM clicks because its package omits the Chrome debugger coordinate-click fallback. Store-ready signing, review, and live Firefox validation are separate deployment steps.\n');
console.log(`Packaged extension in ${dist}`);
