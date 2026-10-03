import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { planStep } from '../server/planner.mjs';

for (const line of (await readFile(new URL('../.env', import.meta.url), 'utf8')).split(/\r?\n/)) {
  const match = line.match(/^\s*([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}
const report = { generatedAt: new Date().toISOString(), passed: false, model: process.env.CAPTAIN_OLLAMA_MODEL, sanitizedImageOnly: true };
try {
  assert.equal(process.env.CAPTAIN_OLLAMA_VISION, 'true');
  const image = (await readFile(new URL('../runtime/sanitized-privacy-audit.jpg', import.meta.url))).toString('base64');
  const context = {
    url: 'http://127.0.0.1:4317/privacy-fixture.html', title: 'CAPTAIN privacy fixture',
    pageText: 'CAPTAIN privacy fixture. Public controls are visible. Private regions are redacted.',
    elements: [{ ref: 'c1', role: 'button', name: 'Continue', bbox: { x: 10, y: 10, width: 100, height: 30 }, confidence: 1, source: 'dom' }],
    screenshot: `data:image/jpeg;base64,${image}`
  };
  const started = performance.now();
  const plan = await planStep('Inspect the sanitized page and tell me when it is safe to continue', context, []);
  report.latencyMs = Math.round(performance.now() - started); report.plan = plan;
  assert.equal(plan.planner, 'ollama'); assert.equal(plan.model, process.env.CAPTAIN_OLLAMA_MODEL);
  if (plan.action.target?.ref) assert.equal(plan.action.target.ref, 'c1');
  assert.ok(['click', 'finish', 'wait'].includes(plan.action.type), `Unexpected VLM action: ${plan.action.type}`);
  report.passed = true; console.log(JSON.stringify(report, null, 2));
} catch (error) { report.error = error.message; console.error(JSON.stringify(report, null, 2)); process.exitCode = 1; }
finally { await mkdir(new URL('../runtime/', import.meta.url), { recursive: true }); await writeFile(new URL('../runtime/vlm-audit.json', import.meta.url), JSON.stringify(report, null, 2)); }
