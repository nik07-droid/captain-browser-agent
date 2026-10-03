import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { cdp, debugJson, extensionPath, findSession } from './reload-in-place.mjs';

const report = { started: new Date().toISOString(), steps: [] };
const pending = new Map();
let ws, sequence = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function evaluate(expression, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Controller evaluation timed out; the action was not repeated.'));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true, userGesture: true } }));
    } catch (error) {
      clearTimeout(timer); pending.delete(id); reject(error);
    }
  });
}

// Keep reads in the controller: about:blank has no injectable content script.
const readSession = `async function readSession() {
  if (chrome.runtime.getManifest().name !== 'CAPTAIN — Private Browser Agent') throw new Error('Selected extension is not CAPTAIN.');
  const address = new URL(location.href), expected = new URL(chrome.runtime.getURL('popup.html'));
  if (address.origin !== expected.origin || address.pathname !== expected.pathname) throw new Error('Not a dedicated CAPTAIN controller.');
  const originId = Number(address.searchParams.get('target')) || null;
  const controller = await chrome.tabs.getCurrent();
  if (!controller?.incognito) throw new Error('Controller must be in the dedicated Incognito window.');
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  if (!state.session || state.session.windowId !== controller.windowId) throw new Error('Window-bound session status is missing or belongs to another window. Reload CAPTAIN.');
  const key = 'captainWindow:' + controller.windowId;
  const binding = (await chrome.storage.session.get(key))[key] || null;
  let tab = null;
  if (state.session.connected && state.session.tabId) {
    try { tab = await chrome.tabs.get(state.session.tabId); } catch { throw new Error('The working tab closed during the audit. Retry after opening a website in CAPTAIN.'); }
    if (!tab.incognito || controller.windowId !== tab.windowId) throw new Error('Controller and target must share the dedicated Incognito window.');
    if (binding && (binding.windowId !== tab.windowId || binding.tabId !== tab.id)) throw new Error('Stored window binding and current session disagree.');
    if (controller.id === tab.id || tab.url?.startsWith(chrome.runtime.getURL(''))) throw new Error('Task target is an extension page, not a website tab.');
  }
  const tabs = await chrome.tabs.query({ windowId: controller.windowId });
  if (tabs.some(item => !item.incognito)) throw new Error('Target window contains a non-Incognito tab.');
  return { originId, controllerId: controller.id, bindingKey: key, binding, connected: !!tab, id: tab?.id || null, windowId: controller.windowId, url: tab?.url || null, pendingUrl: tab?.pendingUrl || null, tabStatus: tab?.status || null, incognito: tab?.incognito || false, tabs: tabs.map(item => item.id).sort((a, b) => a - b), state, voiceMode: window.captainVoiceMode, microphoneActive: typeof listening !== 'undefined' && listening || typeof micStarting !== 'undefined' && micStarting };
}`;

const snapshot = (timeoutMs = 12000) => evaluate(`(async () => { ${readSession}; return readSession(); })()`, timeoutMs);

function assertSameSession(current, expected) {
  assert.equal(current.id, expected.id, 'Command switched the task target unexpectedly');
  assert.equal(current.windowId, expected.windowId, 'Command switched the Incognito window');
  assert.equal(current.controllerId, expected.controllerId, 'Command switched controllers');
  assert.equal(current.originId, expected.originId, 'Controller origin target changed');
  assert.equal(current.incognito, true, 'Target is no longer Incognito');
  assert.deepEqual(current.tabs, expected.tabs, 'An unexpected tab was added or removed');
}

function assertYoutubeHome(current) {
  const url = new URL(current.url);
  assert.equal(url.hostname, 'www.youtube.com', 'YouTube was not opened');
  assert.equal(url.pathname, '/', 'YouTube home was not opened');
}

async function submit(input, expectedTask, expectedSession, { clarification = false, newTab = false } = {}) {
  const since = await evaluate(`(async () => {
    ${readSession};
    await refresh();
    const current = await readSession();
    if (current.state.status === 'running' || current.voiceMode === 'busy') throw new Error('A CAPTAIN task is already running.');
    if (current.microphoneActive) throw new Error('Turn the microphone off before running the typed session audit.');
    if (current.id !== ${expectedSession.id} || current.windowId !== ${expectedSession.windowId} || JSON.stringify(current.tabs) !== ${JSON.stringify(JSON.stringify(expectedSession.tabs))}) throw new Error('The task binding or tab set changed before submission.');
    const field = document.querySelector('#task'), button = document.querySelector('#run');
    if (!field || !button || button.disabled) throw new Error('Controller RUN is unavailable.');
    field.value = ${JSON.stringify(input)};
    field.dispatchEvent(new Event('input', { bubbles: true }));
    const startedAt = Date.now();
    button.click();
    return startedAt;
  })()`);
  const row = { input, expectedTask, submittedAt: since };
  report.steps.push(row);
  const deadline = Date.now() + 120000;
  let current;
  while (Date.now() < deadline) {
    current = await snapshot(Math.min(12000, deadline - Date.now()));
    row.snapshot = current;
    const accepted = current.state.task === expectedTask && current.state.updatedAt >= since;
    if (accepted && ['complete', 'error'].includes(current.state.status)) break;
    if (current.state.status === 'running' && current.state.task !== expectedTask) throw new Error(`A different command started: ${current.state.task}`);
    await delay(Math.min(700, Math.max(0, deadline - Date.now())));
  }
  assert.ok(current?.state.task === expectedTask && current.state.updatedAt >= since, `Controller did not accept "${expectedTask}" within the deadline`);
  assert.equal(current.state.status, 'complete', current.state.message || 'Command did not complete within 120 seconds');
  assert.equal(!!current.state.requiresInput, clarification, clarification ? 'Expected clarification was not returned' : `Unexpected clarification: ${current.state.message}`);
  assert.notEqual(current.state.outcomeVerified, false, 'Planner stopped without a verified outcome');
  if (!newTab) assertSameSession(current, expectedSession);
  console.log(JSON.stringify({ input, task: current.state.task, id: current.id, windowId: current.windowId, tabs: current.tabs, status: current.state.status, phase: current.state.phase, message: current.state.message, url: current.url }));
  return current;
}

try {
  const version = await debugJson('/json/version');
  const installed = await cdp(version.webSocketDebuggerUrl, 'Extensions.getExtensions');
  const extension = installed.extensions.find(item => item.path?.toLowerCase() === extensionPath.toLowerCase());
  if (!extension) throw new Error('CAPTAIN project extension is not installed. Run npm run demo first.');
  const controller = (await findSession(extension.id))?.controller;
  if (!controller?.webSocketDebuggerUrl) throw new Error('No dedicated CAPTAIN controller is open. Launch CAPTAIN first.');
  ws = new WebSocket(controller.webSocketDebuggerUrl);
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(message.id);
    if (message.error || message.result?.exceptionDetails) request.reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
    else request.resolve(message.result?.result?.value);
  });
  ws.addEventListener('close', () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('CAPTAIN controller disconnected.')); }
    pending.clear();
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome connection timed out.')), 5000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Could not connect to the CAPTAIN controller.')); }, { once: true });
  });
  let baseline = await snapshot();
  report.baseline = baseline;
  assert.notEqual(baseline.state.status, 'running', 'A CAPTAIN task is running; finish it before this audit');
  assert.notEqual(baseline.voiceMode, 'busy', 'Controller is busy; finish the active task first');
  assert.equal(baseline.microphoneActive, false, 'Turn the microphone off before running the typed session audit');
  if (!baseline.connected) {
    const disconnected = baseline;
    baseline = await submit('open', 'open', disconnected, { clarification: true, newTab: true });
    assert.equal(baseline.connected, true, 'The first command did not create a working tab');
    assert.equal(baseline.windowId, disconnected.windowId, 'Initial working tab opened in a different window');
    assert.equal(baseline.controllerId, disconnected.controllerId, 'Initial command replaced the controller');
    assert.deepEqual(baseline.tabs.filter(id => !disconnected.tabs.includes(id)), [baseline.id], 'Initial command did not add exactly one working tab');
    assert.ok(disconnected.tabs.every(id => baseline.tabs.includes(id)), 'Initial command removed an existing tab');
    assert.equal(baseline.url, 'about:blank', 'Clarification must not navigate the newly created target');
    report.initialConnection = baseline;
  }

  await evaluate(`(async () => {
    ${readSession};
    const current = await readSession();
    if (current.state.status === 'running' || current.voiceMode === 'busy' || current.microphoneActive) throw new Error('CAPTAIN became busy before blank-page setup.');
    if (current.id !== ${baseline.id} || current.windowId !== ${baseline.windowId} || JSON.stringify(current.tabs) !== ${JSON.stringify(JSON.stringify(baseline.tabs))}) throw new Error('The bound target changed before blank-page setup.');
    await chrome.tabs.update(current.id, { url: 'about:blank' });
    return true;
  })()`);
  const blankDeadline = Date.now() + 15000;
  let blank;
  while (Date.now() < blankDeadline) {
    blank = await snapshot(Math.min(12000, blankDeadline - Date.now()));
    if (blank.url === 'about:blank' && blank.tabStatus === 'complete' && !blank.pendingUrl) break;
    await delay(Math.min(300, Math.max(0, blankDeadline - Date.now())));
  }
  assertSameSession(blank, baseline);
  assert.equal(blank.url, 'about:blank', 'Bound target did not reach about:blank');
  assert.equal(blank.tabStatus, 'complete', 'Blank-page navigation did not complete');
  assert.equal(blank.pendingUrl, null, 'Blank-page navigation remains pending');
  report.blankSetup = blank;

  const clarification = await submit('open', 'open', baseline, { clarification: true });
  assert.equal(clarification.url, 'about:blank', 'Incomplete command navigated the blank target');
  assert.equal(clarification.state.followUpPrefix, 'open ', 'Missing typed follow-up prefix');
  assert.equal(clarification.state.history.length, 1, 'Incomplete command attempted unexpected actions');
  assert.equal(clarification.state.history[0].action.type, 'finish', 'Incomplete command did not finish with clarification');
  assert.equal(clarification.state.history[0].result.ok, true, 'Blank-page clarification failed to execute');

  const opened = await submit('YouTube', 'open YouTube', baseline);
  assertYoutubeHome(opened);

  const created = await submit('open YouTube in a new tab', 'open YouTube in a new tab', baseline, { newTab: true });
  assert.equal(created.windowId, baseline.windowId, 'New target is in another window');
  assert.equal(created.controllerId, baseline.controllerId, 'New-tab command replaced the controller');
  assert.equal(created.originId, baseline.originId, 'New-tab command changed the controller origin');
  assert.equal(created.incognito, true, 'New target is not Incognito');
  assert.notEqual(created.id, baseline.id, 'New-tab command reused the original target');
  const addedTabs = created.tabs.filter(id => !baseline.tabs.includes(id));
  assert.deepEqual(addedTabs, [created.id], 'New-tab command did not add exactly one bound task tab');
  assert.ok(baseline.tabs.every(id => created.tabs.includes(id)), 'New-tab command removed an existing tab');
  assert.deepEqual(created.binding, { tabId: created.id, windowId: baseline.windowId }, 'New target binding was not persisted');
  assert.equal(created.bindingKey, 'captainWindow:' + baseline.windowId, 'New target was not persisted under the window binding');
  assertYoutubeHome(created);
  report.newTarget = { id: created.id, windowId: created.windowId, binding: created.binding, tabs: created.tabs };

  const searched = await submit('search for CAPTAIN browser agent', 'search for CAPTAIN browser agent', created);
  const searchUrl = new URL(searched.url);
  assert.equal(searchUrl.hostname, 'www.youtube.com', 'Search left YouTube');
  assert.equal(searchUrl.pathname, '/results', 'YouTube search results were not opened');
  assert.equal(searchUrl.searchParams.get('search_query'), 'CAPTAIN browser agent', 'Search query was not applied correctly');
  assert.deepEqual(searched.binding, created.binding, 'Search lost the new target binding');

  const home = await submit('open YouTube', 'open YouTube', created);
  assertYoutubeHome(home);
  assert.deepEqual(home.binding, created.binding, 'Final command lost the new target binding');
  report.success = true;
} catch (error) {
  report.success = false; report.error = error.message; process.exitCode = 1;
} finally {
  ws?.close();
  report.finished = new Date().toISOString();
  await mkdir(new URL('../runtime/', import.meta.url), { recursive: true });
  await writeFile(new URL('../runtime/session-audit.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ success: report.success, error: report.error, report: 'runtime/session-audit.json' }));
}
