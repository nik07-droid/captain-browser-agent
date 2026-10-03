import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(await readFile(join(root, 'kws', 'config.json'), 'utf8'));
const failures = [];
if (config.keyword !== 'hey captain') failures.push('custom keyword must be hey captain');
if (config.labels.includes('alexa') || config.labels.includes('hey_google')) failures.push('generic global keyword label present');
if (config.budgets.totalRamBytes >= 256 * 1024) failures.push('RAM budget must be strictly below 256 KB');
if (config.budgets.idleCpuPercent >= 10) failures.push('idle CPU budget must be strictly below 10%');
let artifact = null;
try {
  const path = join(root, 'kws', 'artifacts', 'captain_kws_int8.tflite');
  artifact = { bytes: (await stat(path)).size };
  if (artifact.bytes > config.budgets.modelBytes) failures.push('model artifact exceeds configured model budget');
} catch { artifact = { status: 'not-trained' }; }
console.log(JSON.stringify({ passed: failures.length === 0, config, artifact, failures }, null, 2));
if (failures.length) process.exitCode = 1;
