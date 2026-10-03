import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cdp, debugJson, evaluate, extensionPath, findSession, reconnectPanels, reloadInPlace } from './reload-in-place.mjs';

// Development test: only public pages in CAPTAIN's dedicated private window.
// This tests actual Chrome pointer events and extension messages, not acoustics.
const report = { started: new Date().toISOString(), checks: [] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let controller, page, extensionId, workingId;
const record = (name, evidence) => { report.checks.push({ name, evidence }); console.log(JSON.stringify({ check: name, evidence })); };
async function snapshot() {
  return evaluate(controller, `(async()=>{const self=await chrome.tabs.getCurrent();const state=await chrome.runtime.sendMessage({type:'GET_STATE'});return {controllerId:self.id,windowId:self.windowId,incognito:self.incognito,state,micOn:listening,tabs:(await chrome.tabs.query({windowId:self.windowId})).map(t=>({id:t.id,url:t.url,active:t.active})),windows:(await chrome.windows.getAll({windowTypes:['normal']})).filter(w=>w.incognito).map(w=>w.id)};})()`);
}
async function waitCommand(command, since) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const current = await snapshot();
    if (current.state.task === command && current.state.updatedAt >= since && ['complete','error'].includes(current.state.status)) {
      assert.equal(current.state.status, 'complete', current.state.message);
      assert.notEqual(current.state.outcomeVerified, false, 'Unverified planner result');
      return current;
    }
    await pause(300);
  }
  throw new Error(`No completed result for ${command}`);
}
async function currentPage() {
  const id = await evaluate(controller, `(async()=>{const target=(await chrome.debugger.getTargets()).find(t=>t.tabId===${workingId});return target?.id;})()`);
  assert.ok(id, 'Missing working page debugger target');
  page = (await debugJson('/json/list')).find(t => t.id === id);
  assert.ok(page, 'Missing working page');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if (await evaluate(page, `!!document.querySelector('#captain-agent-host')?.shadowRoot?.querySelector('.head')`)) return; } catch {}
    await pause(150);
  }
  throw new Error('Floating panel did not mount');
}
const rectExpression = `(()=>{const h=document.querySelector('#captain-agent-host'),r=h.getBoundingClientRect(),s=h.shadowRoot;return {x:r.x,y:r.y,width:r.width,height:r.height,viewport:{width:innerWidth,height:innerHeight},build:h.dataset.captainBuild,phase:s.querySelector('.phase').textContent,disabled:s.querySelector('.go').disabled,collapsed:s.querySelector('.card').classList.contains('collapsed')};})()`;
async function panel() { return evaluate(page, rectExpression); }
async function mouse(type, x, y, down = false) {
  await cdp(page.webSocketDebuggerUrl, 'Input.dispatchMouseEvent', { type, x, y, button: down || type === 'mouseReleased' ? 'left' : 'none', buttons: down ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
}
async function dragTo(x, y) {
  const r = await panel();
  await mouse('mouseMoved', r.x + 90, r.y + 25);
  await mouse('mousePressed', r.x + 90, r.y + 25, true);
  await mouse('mouseMoved', x + 90, y + 25, true);
  await mouse('mouseReleased', x + 90, y + 25);
  await pause(200);
}
async function click(selector) {
  const r = await evaluate(page, `(()=>{const b=document.querySelector('#captain-agent-host').shadowRoot.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};})()`);
  await mouse('mouseMoved', r.x, r.y);
  await mouse('mousePressed', r.x, r.y, true);
  await mouse('mouseReleased', r.x, r.y);
}
async function panelCommand(command, enter = false) {
  await currentPage();
  // The worker can complete before the panel's next status tick. Wait for the
  // real button to enable, just as a user must, instead of clicking it disabled.
  const readyDeadline = Date.now() + 5000;
  while ((await panel()).disabled && Date.now() < readyDeadline) await pause(100);
  assert.equal((await panel()).disabled, false, 'Panel did not enable its Run button');
  await evaluate(controller, `chrome.tabs.update(${workingId},{active:true})`);
  const since = Date.now();
  await evaluate(page, `(()=>{const input=document.querySelector('#captain-agent-host').shadowRoot.querySelector('.task');input.value=${JSON.stringify(command)};input.focus();})()`);
  if (enter) await cdp(page.webSocketDebuggerUrl, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  else await click('.go');
  const result = await waitCommand(command, since);
  assert.equal(result.state.session.tabId, workingId, 'Panel command changed the working tab');
  return result;
}
try {
  const version = await debugJson('/json/version');
  const installed = await cdp(version.webSocketDebuggerUrl, 'Extensions.getExtensions');
  extensionId = installed.extensions.find(e => e.path?.toLowerCase() === extensionPath.toLowerCase())?.id;
  assert.ok(extensionId, 'Start CAPTAIN first');
  const session = await findSession(extensionId); assert.ok(session, 'Missing private controller'); controller = session.controller;
  const baseline = await snapshot(); report.baseline = baseline;
  assert.equal(baseline.incognito, true); assert.equal(baseline.micOn, false, 'Turn off Speak before this test');
  assert.notEqual(baseline.state.status, 'running', 'A browser task is running');
  const build = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8')).version;
  assert.equal(baseline.state.build, build, 'Reload the extension before testing');
  const since = Date.now();
  await evaluate(controller, `(()=>{document.querySelector('#task').value='open example dot com';document.querySelector('#run').click();})()`);
  const opened = await waitCommand('open example dot com', since); workingId = opened.state.session.tabId;
  await currentPage(); const initial = await panel(); assert.equal(initial.build, build);
  if (initial.collapsed) await click('.collapse');
  await dragTo(95, 80);
  const moved = await panel(); assert.ok(Math.abs(moved.x - 95) < 2 && Math.abs(moved.y - 80) < 2);
  record('actual pointer drag moves panel', moved);
  // Keep the synthetic pointer inside the browser surface. Its header offset
  // still requests a negative panel position, which must clamp to the edge.
  await dragTo(-85, -20);
  const clamped = await panel(); assert.equal(clamped.x, 8); assert.equal(clamped.y, 8);
  record('drag stays inside viewport', clamped);
  await click('.collapse'); assert.equal((await panel()).collapsed, true);
  await click('.collapse'); assert.equal((await panel()).collapsed, false);
  await click('.reset'); const reset = await panel();
  assert.ok(Math.abs(reset.x + reset.width + 8 - reset.viewport.width) < 2);
  record('minimize, expand and reset buttons', reset);
  await dragTo(95, 80);
  // The marker and draft are synthetic, never sourced from a user's forms.
  await evaluate(page, `(()=>{window.__captainPanelAudit={origin:performance.timeOrigin,host:document.querySelector('#captain-agent-host')};const input=document.createElement('input');input.id='captain-panel-audit-draft';input.type='hidden';input.value='unsent local test';document.body.append(input);})()`);
  const beforeReload = await panel();
  const reload = await reloadInPlace(); controller = reload.controller;
  assert.deepEqual(reload.panels.errors, [], 'Panel injection failed after reload');
  await currentPage();
  const preserved = await evaluate(page, `({document:window.__captainPanelAudit?.origin===performance.timeOrigin,replaced:window.__captainPanelAudit?.host!==document.querySelector('#captain-agent-host'),draft:document.querySelector('#captain-panel-audit-draft')?.value,count:document.querySelectorAll('#captain-agent-host').length})`);
  assert.deepEqual(preserved, { document: true, replaced: true, draft: 'unsent local test', count: 1 });
  const afterReload = await panel();
  assert.ok(Math.abs(beforeReload.x - afterReload.x) < 2 && Math.abs(beforeReload.y - afterReload.y) < 2);
  record('reload reconnects in-place and preserves document, draft and panel position', { preserved, panel: afterReload, recovery: reload.panels });
  await reconnectPanels(reload); const duplicate = await evaluate(page, `document.querySelectorAll('#captain-agent-host').length`); assert.equal(duplicate, 1);
  const youtube = await panelCommand('open youtube', true); await currentPage();
  assert.ok(youtube.tabs.find(t => t.id === workingId)?.url.startsWith('https://www.youtube.com/'));
  const onYoutube = await panel();
  assert.ok(Math.abs(onYoutube.x - beforeReload.x) < 2 && Math.abs(onYoutube.y - beforeReload.y) < 2);
  record('Enter executes Open YouTube in the same tab; position survives navigation', { target: workingId, panel: onYoutube });
  const example = await panelCommand('open example dot com'); await currentPage();
  assert.ok(example.tabs.find(t => t.id === workingId)?.url.startsWith('https://example.com/'));
  record('RUN executes a second navigation in the same tab', { target: workingId, message: example.state.message });
  await click('.mic'); await pause(400); const voice = await snapshot();
  assert.equal(voice.micOn, false, 'Panel must not activate the microphone without Speak consent');
  assert.equal(voice.tabs.find(t => t.active)?.id, baseline.controllerId, 'Microphone shortcut did not open the existing controller');
  assert.equal(voice.tabs.filter(t => t.url.startsWith(`chrome-extension://${extensionId}/popup.html`)).length, 1);
  assert.equal(voice.tabs.length, opened.tabs.length, 'Unexpected new tab');
  assert.deepEqual(voice.windows, baseline.windows, 'Unexpected new Incognito window');
  assert.ok(!voice.tabs.some(t => /\/demo\.html/.test(t.url)), 'Unexpected demo tab');
  record('voice shortcut uses one existing controller and requires explicit Speak', voice);
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.stack || error.message; console.error(report.error); process.exitCode = 1;
} finally {
  if (page) try { await evaluate(page, `document.querySelector('#captain-panel-audit-draft')?.remove();delete window.__captainPanelAudit;`); } catch {}
  report.finished = new Date().toISOString();
  await mkdir(new URL('../runtime/', import.meta.url), { recursive: true });
  await writeFile(new URL('../runtime/panel-audit.json', import.meta.url), JSON.stringify(report, null, 2));
}
