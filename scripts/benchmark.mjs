import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { debugJson, evaluate, findSession } from './reload-in-place.mjs';

const groundTruth = JSON.parse(await readFile(new URL('../benchmarks/groundTruth.json', import.meta.url), 'utf8'));
const ids = Object.keys(groundTruth.cases);
const pct = (a, b) => b ? Number((a * 100 / b).toFixed(2)) : 100;
const f1 = (p, r) => p + r ? Number((2 * p * r / (p + r)).toFixed(2)) : 0;
const report = { benchmarkVersion: groundTruth.version, generatedAt: new Date().toISOString(), passed: false, cases: [] };
let controller = null, tabId = null;
try {
  const targets = await debugJson('/json/list'); controller = targets.find(target => target.type === 'page' && /chrome-extension:\/\/[^/]+\/popup\.html/.test(target.url || ''));
  assert.ok(controller, 'CAPTAIN controller is not open'); const session = await findSession(new URL(controller.url).hostname); assert.ok(session);
  tabId = await evaluate(controller, `(async()=>{const me=await chrome.tabs.getCurrent();const tab=await chrome.tabs.create({windowId:me.windowId,url:'about:blank',active:true});await chrome.windows.update(me.windowId,{focused:true});return tab.id})()`);
  let elementTp=0, elementFp=0, elementFn=0, piiTp=0, piiFp=0, piiFn=0;
  for (const id of ids) {
    const started = performance.now();
    const item = await evaluate(controller, `(async()=>{const tabId=${tabId},expected='http://127.0.0.1:4317/benchmark.html?case=${id}';await chrome.tabs.update(tabId,{active:true,url:expected});for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,80));const t=await chrome.tabs.get(tabId);if(t.status==='complete'&&!t.pendingUrl&&t.url===expected)break}await new Promise(r=>setTimeout(r,250));let context;for(let i=0;i<3;i++){try{context=await chrome.tabs.sendMessage(tabId,{type:'OBSERVE'});break}catch{await new Promise(r=>setTimeout(r,350))}}const truth=(await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:()=>window.__CAPTAIN_BENCHMARK__}))[0].result;return{truth,context}})()`);
    assert.ok(item.context, `${id}: no observation`); assert.ok(item.truth, `${id}: benchmark labels were unavailable after navigation`); assert.equal(item.truth.id, id);
    const labels = groundTruth.cases[id];
    assert.equal(item.truth.elements, labels.expectedElements, `${id}: fixture element count differs from ground truth`);
    assert.deepEqual(item.truth.kinds, labels.privateRegions, `${id}: fixture private regions differ from ground truth`);
    const expectedElements = labels.expectedElements, detectedElements = item.context.elements.length;
    const eTp = Math.min(expectedElements, detectedElements), eFp = Math.max(0, detectedElements - expectedElements), eFn = Math.max(0, expectedElements - detectedElements);
    const remaining = [...item.context.redactionBoxes.map(box => box.kind)], expectedKinds = [...labels.privateRegions]; let pTp = 0;
    for (const kind of expectedKinds) { const index = remaining.indexOf(kind); if (index >= 0) { remaining.splice(index, 1); pTp++; } }
    const pFp = remaining.length, pFn = expectedKinds.length - pTp;
    elementTp += eTp; elementFp += eFp; elementFn += eFn; piiTp += pTp; piiFp += pFp; piiFn += pFn;
    const leaked = /judge@example\.com|NeverSendThis|483921|ABCDE1234F|123456789012|4111 1111 1111 1111|10 Demo Street|creator@example\.org|mixed@example\.com|sk_test_not_real/i.test(item.context.pageText);
    report.cases.push({ id, passed: eFp === 0 && eFn === 0 && pFp === 0 && pFn === 0 && !leaked && item.context.pageText.includes(item.truth.safe), expectedElements, detectedElements, expectedPrivateRegions: expectedKinds.length, detectedPrivateRegions: item.context.redactionBoxes.length, leaked, observationMs: Math.round(performance.now() - started) });
  }
  await evaluate(controller, `chrome.tabs.remove(${tabId})`); tabId = null;
  const visualPrecision = pct(elementTp, elementTp + elementFp), visualRecall = pct(elementTp, elementTp + elementFn), piiPrecision = pct(piiTp, piiTp + piiFp), piiRecall = pct(piiTp, piiTp + piiFn);
  const times = report.cases.map(item => item.observationMs).sort((a,b)=>a-b);
  let privacyAudit = null, shoppingAudit = null, vlmAudit = null;
  try { privacyAudit = JSON.parse(await readFile(new URL('../runtime/visual-privacy-audit.json', import.meta.url), 'utf8')); } catch {}
  try { shoppingAudit = JSON.parse(await readFile(new URL('../runtime/shopping-audit.json', import.meta.url), 'utf8')); } catch {}
  try { vlmAudit = JSON.parse(await readFile(new URL('../runtime/vlm-audit.json', import.meta.url), 'utf8')); } catch {}
  report.summary = {
    total: report.cases.length, passed: report.cases.filter(item => item.passed).length, failed: report.cases.filter(item => !item.passed).length,
    visual: { truePositives: elementTp, falsePositives: elementFp, falseNegatives: elementFn, precisionPercent: visualPrecision, recallPercent: visualRecall, f1Percent: f1(visualPrecision, visualRecall) },
    pii: { truePositives: piiTp, falsePositives: piiFp, falseNegatives: piiFn, precisionPercent: piiPrecision, recallPercent: piiRecall, f1Percent: f1(piiPrecision, piiRecall) },
    redaction: privacyAudit?.evaluation?.redaction || null,
    taskCompletion: { total: 1, passed: shoppingAudit?.passed ? 1 : 0, ratePercent: shoppingAudit?.passed ? 100 : 0, shoppingActions: shoppingAudit?.actions?.length || 0 },
    vlm: vlmAudit ? { passed: vlmAudit.passed === true, model: vlmAudit.model, sanitizedImageOnly: vlmAudit.sanitizedImageOnly === true, latencyMs: vlmAudit.latencyMs, actionType: vlmAudit.plan?.action?.type || null } : null,
    latency: { averageObservationMs: Math.round(times.reduce((a,b)=>a+b,0)/times.length), p95ObservationMs: times[Math.ceil(times.length*.95)-1], shoppingEndToEndMs: shoppingAudit?.latencyMs || null, localVisionMs: privacyAudit?.localVision?.totalMs || null },
    resources: privacyAudit?.evaluation?.clientResources || null
  };
  report.passed = report.summary.failed === 0 && report.summary.taskCompletion.passed === 1;
  console.log(JSON.stringify(report, null, 2));
} catch (error) { report.error = error.stack || error.message; console.error(report.error); process.exitCode = 1; }
finally {
  if (controller && tabId) { try { await evaluate(controller, `chrome.tabs.remove(${tabId})`); } catch {} }
  await mkdir(new URL('../runtime/', import.meta.url), { recursive: true }); await writeFile(new URL('../runtime/benchmark-results.json', import.meta.url), JSON.stringify(report, null, 2));
}
