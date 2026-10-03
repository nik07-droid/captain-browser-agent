import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { debugJson, evaluate } from './reload-in-place.mjs';

const targets = await debugJson('/json/list');
const controller = targets.find(target => target.type === 'page' && /chrome-extension:\/\/[^/]+\/popup\.html/.test(target.url || ''));
assert.ok(controller, 'CAPTAIN controller is not open.');
const state = await evaluate(controller, `chrome.runtime.sendMessage({type:'GET_STATE'})`);
assert.ok(state?.timeline?.length, 'No latency timeline is available.');
const sums = {};
for (const event of state.timeline) if (Number.isFinite(event.latencyMs)) sums[event.type] = (sums[event.type] || 0) + event.latencyMs;
const totalMs = state.latencyMs ?? state.timeline.at(-1)?.atMs ?? 0;
const nonOverlapping = {
  domObservationMs: sums.PERCEPTION_TOTAL || 0,
  screenCaptureMs: sums.SCREEN_CAPTURE || 0,
  localVisionAndRedactionMs: sums.LOCAL_VISION_REDACTION || 0,
  payloadSanitizationMs: sums.SANITIZATION_PAYLOAD || 0,
  networkAndServerMs: sums.NETWORK_AND_SERVER || 0,
  actionExecutionIncludingNavigationMs: sums.ACTION_COMPLETED || 0,
  fixedPageStableWaitMs: sums.PAGE_STABLE_WAIT || 0,
};
const accountedMs = Object.values(nonOverlapping).reduce((sum, value) => sum + value, 0);
const report = {
  generatedAt: new Date().toISOString(), phase: process.argv[2] || 'baseline', passed: state.status === 'complete' && state.completionStatus === 'COMPLETED',
  totalMs, captainOnlyEstimateMs: Math.max(0, totalMs - (sums.PAGE_NAVIGATION || 0)), externalNavigationMs: sums.PAGE_NAVIGATION || 0,
  vlmMs: 0, plannerMs: sums.PLANNER || 0, componentTotals: { ...nonOverlapping, pageReadinessMs: sums.PAGE_READY || 0, amazonExtractionMs: sums.AMAZON_EXTRACTION || 0, privacyDomScanMs: sums.PRIVACY_SCAN || 0, serverPrivacyBoundaryMs: sums.SERVER_PRIVACY_BOUNDARY || 0, pageNavigationMs: sums.PAGE_NAVIGATION || 0, otherUnaccountedMs: Math.max(0, totalMs - accountedMs) },
  steps: state.step, events: state.timeline
};
const output = new URL(process.argv[2] === 'optimized' ? '../runtime/amazon-latency-optimized.json' : '../runtime/amazon-latency-baseline.json', import.meta.url);
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output: output.pathname, ...report, events: undefined }, null, 2));
