import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { cdp, debugJson, evaluate, extensionPath, findIncognitoWorker, findSession } from './reload-in-place.mjs';
import { payloadLeaks } from '../server/privacy.mjs';

const percent = (part, total) => total ? Number((part * 100 / total).toFixed(2)) : 0;
const rectArea = box => Math.max(0, box.width) * Math.max(0, box.height);
const intersectionArea = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
function detectionScore(expected, predicted) {
  const available = new Set(predicted.map((_, index) => index)); let matched = 0;
  for (const truth of expected) {
    let best = -1, bestOverlap = 0;
    for (const index of available) {
      const candidate = predicted[index]; if (candidate.kind !== truth.kind) continue;
      const overlap = intersectionArea(truth, candidate) / Math.max(1, Math.min(rectArea(truth), rectArea(candidate)));
      if (overlap > bestOverlap) { best = index; bestOverlap = overlap; }
    }
    if (best >= 0 && bestOverlap >= 0.5) { available.delete(best); matched++; }
  }
  const precision = percent(matched, predicted.length), recall = percent(matched, expected.length);
  return { expected: expected.length, detected: predicted.length, matched, falsePositives: predicted.length - matched, falseNegatives: expected.length - matched, precisionPercent: precision, recallPercent: recall, f1Percent: precision + recall ? Number((2 * precision * recall / (precision + recall)).toFixed(2)) : 0 };
}
function redactionScore(expected, predicted, width, height) {
  const mask = new Uint8Array(width * height);
  const paint = (boxes, bit) => boxes.forEach(box => {
    const x1 = Math.max(0, Math.floor(box.x)), y1 = Math.max(0, Math.floor(box.y));
    const x2 = Math.min(width, Math.ceil(box.x + box.width)), y2 = Math.min(height, Math.ceil(box.y + box.height));
    for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) mask[y * width + x] |= bit;
  });
  paint(expected, 1); paint(predicted, 2);
  let expectedPixels = 0, redactedPixels = 0, truePositivePixels = 0;
  for (const value of mask) { if (value & 1) expectedPixels++; if (value & 2) redactedPixels++; if (value === 3) truePositivePixels++; }
  const precision = percent(truePositivePixels, redactedPixels), recall = percent(truePositivePixels, expectedPixels);
  return { method: 'CSS-pixel mask overlap', expectedPixels, redactedPixels, truePositivePixels, precisionPercent: precision, recallPercent: recall, f1Percent: precision + recall ? Number((2 * precision * recall / (precision + recall)).toFixed(2)) : 0 };
}
function cpuPercent(before, after, elapsedMs) {
  const start = new Map(before.map(item => [item.id, item.cpuTime]));
  const cpuSeconds = after.reduce((sum, item) => sum + (start.has(item.id) ? Math.max(0, item.cpuTime - start.get(item.id)) : 0), 0);
  return { matchedProcessCpuSeconds: Number(cpuSeconds.toFixed(4)), elapsedMs: Math.round(elapsedMs), aggregatePercentOfOneCore: Number((cpuSeconds * 100000 / elapsedMs).toFixed(2)) };
}
function chromeWorkingSetMiB(processes) {
  const ids = processes.map(item => Number(item.id)).filter(Number.isInteger);
  if (!ids.length || process.platform !== 'win32') return null;
  try {
    const command = `$ids=@(${ids.join(',')});$sum=(Get-Process | Where-Object {$ids -contains $_.Id} | Measure-Object -Property WorkingSet64 -Sum).Sum;if($null -eq $sum){0}else{[math]::Round($sum/1MB,2)}`;
    return Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout: 5000 }).trim());
  } catch { return null; }
}

const report = { started: new Date().toISOString(), fixture: 'synthetic-local', assertions: {} };
try {
  const benchmarkStarted = performance.now();
  const version = await debugJson('/json/version');
  const processStart = (await cdp(version.webSocketDebuggerUrl, 'SystemInfo.getProcessInfo')).processInfo;
  const installed = await cdp(version.webSocketDebuggerUrl, 'Extensions.getExtensions');
  const extension = installed.extensions.find(item => item.path?.toLowerCase() === extensionPath.toLowerCase());
  assert.ok(extension, 'CAPTAIN extension is not installed');
  const session = await findSession(extension.id); assert.ok(session, 'CAPTAIN controller is not open');
  const privateWorker = await findIncognitoWorker(extension.id, session.windowId); assert.ok(privateWorker, 'CAPTAIN Incognito service worker is not available');
  const expectedBuild = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8')).version;
  const result = await evaluate(privateWorker.worker, `(async()=>{
    const controller={id:${session.controllerTabId},windowId:${session.windowId}};
    const key='captainWindow:'+controller.windowId;
    let binding=(await chrome.storage.session.get(key))[key],tab;
    try{if(binding?.tabId)tab=await chrome.tabs.get(binding.tabId)}catch{}
    if(!tab||!tab.incognito||tab.windowId!==controller.windowId||tab.url.startsWith(chrome.runtime.getURL(''))){tab=await chrome.tabs.create({windowId:controller.windowId,url:'about:blank',active:true});await chrome.storage.session.set({[key]:{tabId:tab.id,windowId:tab.windowId}})}
    await chrome.tabs.update(tab.id,{active:true,url:'http://127.0.0.1:4317/privacy-fixture.html'});
    const browserWindow=await chrome.windows.get(controller.windowId);
    await chrome.windows.update(controller.windowId,browserWindow.state==='minimized'?{state:'normal',focused:true}:{focused:true});
    const deadline=Date.now()+20000;
    do{await new Promise(r=>setTimeout(r,200));tab=await chrome.tabs.get(tab.id);if(tab.status==='complete'&&!tab.pendingUrl)break}while(Date.now()<deadline);
    await new Promise(r=>setTimeout(r,800));
    const groundTruth=(await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,kind:node.dataset.captainPrivate||''}};return{sensitive:[...document.querySelectorAll('[data-captain-private]')].map(rect),safeText:[...document.querySelectorAll('[data-captain-safe]')].map(node=>node.textContent.trim()),ui:[...document.querySelectorAll('[data-captain-ui]')].map(node=>node.tagName==='INPUT'?'input:'+(node.type||'text'):node.tagName.toLowerCase()+':'+node.textContent.trim())}}}))[0].result;
    const context=await chrome.tabs.sendMessage(tab.id,{type:'OBSERVE'});
    let raw,lastCaptureError,captureMethod='captureVisibleTab';
    for(let attempt=0;attempt<3;attempt++){try{await chrome.windows.update(controller.windowId,{focused:true});await chrome.tabs.update(tab.id,{active:true});await new Promise(r=>setTimeout(r,400*(attempt+1)));raw=await chrome.tabs.captureVisibleTab(controller.windowId,{format:'jpeg',quality:82});break}catch(error){lastCaptureError=error;if(!/image readback failed/i.test(error.message||''))throw error}}
    if(!raw&&/image readback failed/i.test(lastCaptureError?.message||'')){const debuggee={tabId:tab.id};await chrome.debugger.attach(debuggee,'1.3');try{const shot=await chrome.debugger.sendCommand(debuggee,'Page.captureScreenshot',{format:'jpeg',quality:82,fromSurface:true});raw='data:image/jpeg;base64,'+shot.data;captureMethod='debugger-fallback'}finally{await chrome.debugger.detach(debuggee)}}
    if(!raw)throw lastCaptureError||new Error('Visual capture failed');
    const visual=await chrome.runtime.sendMessage({type:'VISION_REDACT',windowId:controller.windowId,screenshot:raw,viewport:context.viewport,redactionBoxes:context.redactionBoxes});
    globalThis.__captainSanitizedAudit=visual?.screenshot||'';
    const {screenshot,...visualMeta}=visual||{};
    return {build:chrome.runtime.getManifest().version,tabId:tab.id,windowId:tab.windowId,url:tab.url,captureMethod,groundTruth,context,visual:visualMeta,rawLength:raw.length,sanitizedLength:screenshot?.length||0,sanitizedDiffers:screenshot!==raw};
  })()`);
  assert.equal(result.build, expectedBuild, 'Extension build is stale');
  assert.equal(result.url, 'http://127.0.0.1:4317/privacy-fixture.html');
  assert.equal(result.visual.ok, true, result.visual.error || 'Local visual worker failed');
  assert.equal(result.visual.visualPrivacy.sanitized, true);
  assert.equal(result.visual.visualPrivacy.rawScreenshotTransmitted, false);
  assert.equal(result.sanitizedDiffers, true);
  assert.ok(result.visual.visualPrivacy.domBoxes >= 6, `Expected at least 6 DOM/raster redactions, got ${result.visual.visualPrivacy.domBoxes}`);
  assert.ok(result.visual.visualPrivacy.faces >= 1, `Expected at least one locally detected face, got ${result.visual.visualPrivacy.faces} (max confidence ${result.visual.visualPrivacy.faceMaxConfidence})`);
  for (const kind of ['EMAIL', 'PHONE', 'PAN', 'SECRET']) assert.ok(Number(result.context.piiCounts[kind]) >= 1, `Missing ${kind} detection`);
  assert.doesNotMatch(result.context.pageText, /mukul\.sih@example\.com|9876543210|ABCDE1234F|NeverTransmitThis/);
  const expectedPii = result.groundTruth.sensitive.filter(box => box.kind !== 'BACKGROUND_IMAGE');
  const predictedPii = result.context.redactionBoxes.filter(box => box.kind !== 'BACKGROUND_IMAGE');
  const piiDetection = detectionScore(expectedPii, predictedPii);
  const redaction = redactionScore(result.groundTruth.sensitive, result.context.redactionBoxes, Math.round(result.context.viewport.width), Math.round(result.context.viewport.height));
  const observedUi = result.context.elements.map(element => element.tag === 'input' ? `input:${element.type || 'text'}` : `${element.tag}:${element.name}`);
  const expectedUi = [...result.groundTruth.ui], remainingUi = [...observedUi]; let matchedUi = 0;
  for (const expected of expectedUi) { const index = remainingUi.indexOf(expected); if (index >= 0) { remainingUi.splice(index, 1); matchedUi++; } }
  const matchedSafeText = result.groundTruth.safeText.filter(text => result.context.pageText.includes(text)).length;
  const visualTargets = expectedUi.length + result.groundTruth.safeText.length, matchedVisualTargets = matchedUi + matchedSafeText;
  const visualContext = { expectedTargets: visualTargets, matchedTargets: matchedVisualTargets, extraInteractiveTargets: remainingUi.length, accuracyPercent: percent(matchedVisualTargets, visualTargets), interactivePrecisionPercent: percent(matchedUi, observedUi.length), interactiveRecallPercent: percent(matchedUi, expectedUi.length) };
  let sanitizedScreenshot = '';
  for (let offset = 0; offset < result.sanitizedLength; offset += 250000) {
    sanitizedScreenshot += await evaluate(privateWorker.worker, `globalThis.__captainSanitizedAudit.slice(${offset},${offset + 250000})`);
  }
  await evaluate(privateWorker.worker, `delete globalThis.__captainSanitizedAudit`);
  assert.equal(sanitizedScreenshot.length, result.sanitizedLength, 'Sanitized image transfer was truncated');
  const outbound = { ...result.context, screenshot: sanitizedScreenshot, visualPrivacy: result.visual.visualPrivacy };
  delete outbound.redactionBoxes;
  assert.deepEqual(payloadLeaks({ task: 'scroll down', context: outbound, history: [] }), [], 'Sanitized outbound context still matched a server PII pattern');
  const started = performance.now();
  const accepted = await fetch('http://127.0.0.1:4317/api/agent/step', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: 'scroll down', context: outbound, history: [] }) });
  const acceptedBody = await accepted.json();
  report.serverRoundTripMs = Math.round(performance.now() - started);
  assert.equal(accepted.status, 200, JSON.stringify(acceptedBody));
  assert.equal(acceptedBody.action.type, 'scroll');
  const fake = Buffer.alloc(120, 1); fake[0] = 0xff; fake[1] = 0xd8; fake[2] = 0xff; fake[118] = 0xff; fake[119] = 0xd9;
  const refused = await fetch('http://127.0.0.1:4317/api/agent/step', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: 'scroll down', context: { ...outbound, screenshot: `data:image/jpeg;base64,${fake.toString('base64')}` }, history: [] }) });
  assert.equal(refused.status, 422, 'Tampered visual payload was not rejected');
  await evaluate(session.controller, `chrome.scripting.executeScript({target:{tabId:${result.tabId}},func:()=>scrollTo(0,0)})`);
  const productionStarted = performance.now();
  const dispatched = await evaluate(session.controller, `chrome.runtime.sendMessage({type:'START_TASK',task:'scroll down',tabId:${result.tabId}})`);
  assert.equal(dispatched?.ok, true, dispatched?.error || 'The production extension loop did not accept the task');
  let finalState;
  const taskDeadline = Date.now() + 30000;
  do {
    await new Promise(resolve => setTimeout(resolve, 250));
    finalState = await evaluate(session.controller, `chrome.runtime.sendMessage({type:'GET_STATE'})`);
    if (['complete', 'error'].includes(finalState?.status)) break;
  } while (Date.now() < taskDeadline);
  assert.equal(finalState?.status, 'complete', finalState?.message || 'The production extension loop did not complete');
  const productionEndToEndMs = Math.round(performance.now() - productionStarted);
  const scrollY = await evaluate(session.controller, `chrome.scripting.executeScript({target:{tabId:${result.tabId}},func:()=>scrollY}).then(x=>x[0].result)`);
  assert.ok(scrollY > 0, `The returned scroll action was not executed (scrollY ${scrollY})`);
  const metrics = await fetch('http://127.0.0.1:4317/api/metrics').then(response => response.json());
  assert.equal(metrics.lastVisualAudit?.schema, 'captain.visual-privacy.v1');
  assert.equal(metrics.lastVisualAudit?.modelSha256, result.visual.visualPrivacy.modelSha256);
  assert.equal(metrics.lastVisualAudit?.rawScreenshotReceived, false);
  const processEnd = (await cdp(version.webSocketDebuggerUrl, 'SystemInfo.getProcessInfo')).processInfo;
  const activeCpu = cpuPercent(processStart, processEnd, performance.now() - benchmarkStarted);
  await new Promise(resolve => setTimeout(resolve, 2000));
  const idleStartTime = performance.now(), idleStart = (await cdp(version.webSocketDebuggerUrl, 'SystemInfo.getProcessInfo')).processInfo;
  await new Promise(resolve => setTimeout(resolve, 3000));
  const idleEnd = (await cdp(version.webSocketDebuggerUrl, 'SystemInfo.getProcessInfo')).processInfo;
  const idleCpu = cpuPercent(idleStart, idleEnd, performance.now() - idleStartTime);
  const resourceFiles = ['../extension/models/ultraface-rfb-320.onnx', '../extension/vendor/ort.min.js', '../extension/vendor/ort-wasm-simd-threaded.mjs', '../extension/vendor/ort-wasm-simd-threaded.wasm'];
  const footprintBytes = (await Promise.all(resourceFiles.map(path => stat(new URL(path, import.meta.url))))).reduce((sum, item) => sum + item.size, 0);
  const encoded = sanitizedScreenshot.split(',', 2)[1];
  await mkdir(new URL('../runtime/', import.meta.url), { recursive: true });
  await writeFile(new URL('../runtime/sanitized-privacy-audit.jpg', import.meta.url), Buffer.from(encoded, 'base64'));
  report.passed = true;
  report.build = result.build; report.tabId = result.tabId; report.windowId = result.windowId; report.captureMethod = result.captureMethod;
  report.executedScrollY = scrollY;
  report.evaluation = {
    weightsPercent: { visualContextAccuracy: 25, piiDetectionRecallAndPrecision: 20, redactionPrecision: 20, clientResourceUtilization: 20, endToEndLatency: 15 },
    visualContext,
    piiDetection,
    redaction,
    clientResources: { modelAndLoadedRuntimeFootprintBytes: footprintBytes, modelAndLoadedRuntimeFootprintMiB: Number((footprintBytes / 1048576).toFixed(2)), workerJsHeapBytes: result.visual.visualPrivacy.workerJsHeapBytes, aggregateChromeWorkingSetMiBUpperBound: chromeWorkingSetMiB(idleEnd), activeAggregateCpu: activeCpu, idleAggregateCpuThreeSecondSampleAfterCooldown: idleCpu, note: 'CPU and working set are aggregate upper bounds for the dedicated Chrome instance, not extension-only attribution.' },
    latency: { localInferenceMs: result.visual.visualPrivacy.inferenceMs, localSanitizationTotalMs: result.visual.visualPrivacy.totalMs, sanitizedServerRoundTripMs: report.serverRoundTripMs, productionObservePlanExecuteMs: productionEndToEndMs }
  };
  report.localVision = result.visual.visualPrivacy;
  report.piiCounts = result.context.piiCounts;
  report.visionSummary = result.context.vision;
  report.rawScreenshotPersisted = false;
  report.sanitizedArtifact = 'runtime/sanitized-privacy-audit.jpg';
  report.assertions = {
    localModelRan: true, facesDetectedAndPixelated: true, domPiiDetected: true,
    sensitiveAndUninspectableRegionsBlackedOut: true, sanitizedPayloadAccepted: true,
    tamperedPayloadRejected: true, rawScreenshotSentToServer: false,
    productionObservePlanExecuteLoopCompleted: true
  };
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.passed = false; report.error = error.stack || error.message; console.error(report.error); process.exitCode = 1;
} finally {
  report.finished = new Date().toISOString();
  await mkdir(new URL('../runtime/', import.meta.url), { recursive: true });
  await writeFile(new URL('../runtime/visual-privacy-audit.json', import.meta.url), JSON.stringify(report, null, 2));
}
