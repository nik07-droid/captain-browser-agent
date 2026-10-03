import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { debugJson, evaluate } from './reload-in-place.mjs';

const runCount = Math.max(1, Number(process.argv[2] || 5));
const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? null;
};
const mean = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;

async function audit() {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['scripts/audit-amazon.mjs'], { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

const results = [];
for (let index = 1; index <= runCount; index++) {
  const processResult = await audit();
  const auditReport = JSON.parse(await readFile(new URL('../runtime/amazon-audit.json', import.meta.url), 'utf8'));
  const targets = await debugJson('/json/list');
  const controller = targets.find(target => target.type === 'page' && /chrome-extension:\/\/[^/]+\/popup\.html/.test(target.url || ''));
  let state = null;
  if (controller) state = await evaluate(controller, `chrome.runtime.sendMessage({type:'GET_STATE'})`);
  const sums = {};
  for (const event of state?.timeline || []) if (Number.isFinite(event.latencyMs)) sums[event.type] = (sums[event.type] || 0) + event.latencyMs;
  const totalMs = auditReport.latencyMs ?? state?.latencyMs ?? null;
  const externalNavigationMs = sums.PAGE_NAVIGATION || 0;
  const result = {
    run: index,
    passed: processResult.code === 0 && auditReport.passed === true,
    totalMs,
    captainOnlyMs: Number.isFinite(totalMs) ? Math.max(0, totalMs - externalNavigationMs) : null,
    externalNavigationMs,
    plannerMs: sums.PLANNER || 0,
    vlmMs: 0,
    privacyLeaks: auditReport.recognizedPayloadLeaks?.length ?? null,
    steps: auditReport.steps ?? state?.step ?? null,
    selectedAsin: auditReport.selected?.asin ?? null,
    selectedPrice: auditReport.selected?.observedPrice ?? null,
    candidatesFound: auditReport.extractionDiagnostic?.candidatesFound ?? null,
    error: auditReport.error || (processResult.code ? processResult.stderr.trim().slice(-1200) : null)
  };
  results.push(result);
  console.log(JSON.stringify(result));
}

const passed = results.filter(result => result.passed);
const totals = passed.map(result => result.totalMs).filter(Number.isFinite);
const captain = passed.map(result => result.captainOnlyMs).filter(Number.isFinite);
const external = passed.map(result => result.externalNavigationMs).filter(Number.isFinite);
const report = {
  generatedAt: new Date().toISOString(),
  task: 'Open Amazon and find the cheapest laptop under ₹50,000',
  realWebsite: true,
  requestedRuns: runCount,
  successfulRuns: passed.length,
  successRatePercent: Math.round((passed.length / runCount) * 10000) / 100,
  privacyLeaks: results.reduce((sum, result) => sum + Number(result.privacyLeaks || 0), 0),
  total: { meanMs: mean(totals), medianMs: quantile(totals, 0.5), p95Ms: quantile(totals, 0.95), minMs: totals.length ? Math.min(...totals) : null, maxMs: totals.length ? Math.max(...totals) : null },
  captainOnly: { meanMs: mean(captain), medianMs: quantile(captain, 0.5), p95Ms: quantile(captain, 0.95) },
  externalNavigation: { meanMs: mean(external), medianMs: quantile(external, 0.5), p95Ms: quantile(external, 0.95) },
  results
};
await writeFile(new URL('../runtime/amazon-latency-benchmark.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (passed.length !== runCount || report.privacyLeaks !== 0) process.exitCode = 1;
