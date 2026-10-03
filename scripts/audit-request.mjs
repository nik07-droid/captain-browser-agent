import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cdp, debugJson, extensionPath, findSession } from './reload-in-place.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const report = { started: new Date().toISOString(), steps: [] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let controller, extensionId;
async function evaluate(expression) {
  const result = await cdp(controller.webSocketDebuggerUrl, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, 15000);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function snapshot() {
  return evaluate(`(async()=>{
    const controller=await chrome.tabs.getCurrent();
    if(!controller?.incognito)throw new Error('Dedicated Incognito controller required');
    const state=await chrome.runtime.sendMessage({type:'GET_STATE'});
    const tabs=await chrome.tabs.query({windowId:controller.windowId});
    const windows=await chrome.windows.getAll({windowTypes:['normal']});
    let target=null;
    if(state.session?.tabId)try{target=await chrome.tabs.get(state.session.tabId);}catch{}
    return {controllerId:controller.id,windowId:controller.windowId,target:target?{id:target.id,windowId:target.windowId,url:target.url,incognito:target.incognito}:null,state,tabs:tabs.map(t=>({id:t.id,url:t.url})),windows:windows.filter(w=>w.incognito).map(w=>w.id),micOn:typeof listening!=='undefined'&&listening};
  })()`);
}
function noDemo(current) {
  assert.ok(!current.tabs.some(tab => /^http:\/\/(?:127\.0\.0\.1|localhost):4317\/demo\.html/.test(tab.url)), 'A demo tab was opened');
}
function sameWindow(current, baseline) {
  assert.equal(current.windowId, baseline.windowId, 'Incognito window changed');
  assert.equal(current.controllerId, baseline.controllerId, 'Controller was replaced');
  assert.deepEqual(current.windows, baseline.windows, 'Another Incognito window was created');
  assert.equal(current.target?.incognito, true);
  assert.equal(current.target?.windowId, baseline.windowId);
  noDemo(current);
}
async function command(text, { clarification = false } = {}) {
  const since = await evaluate(`(async()=>{await refresh();if(listening)throw new Error('Turn off Speak before typed test');if(document.querySelector('#run').disabled||window.captainVoiceMode==='busy')throw new Error('A task is already running');document.querySelector('#task').value=${JSON.stringify(text)};const since=Date.now();document.querySelector('#run').click();return since;})()`);
  const row = { command: text }; report.steps.push(row);
  let result;
  const deadline = Date.now() + 150000;
  do {
    result = await snapshot();
    if (result.state.task === text && result.state.updatedAt >= since && ['complete', 'error'].includes(result.state.status)) break;
    await pause(600);
  } while (Date.now() < deadline);
  row.result = result;
  console.log(JSON.stringify({ command: text, status: result.state.status, message: result.state.message, target: result.target, windowId: result.windowId }));
  assert.ok(result.state.updatedAt >= since, 'No fresh command state');
  assert.equal(result.state.task, text, 'The completed task was not this audit command');
  assert.equal(result.state.status, 'complete', result.state.message || 'Command timeout');
  assert.equal(!!result.state.requiresInput, clarification, result.state.message);
  assert.notEqual(result.state.outcomeVerified, false, 'Unverified planner finish');
  noDemo(result);
  return result;
}
async function playback() {
  return evaluate(`(async()=>{const state=await chrome.runtime.sendMessage({type:'GET_STATE'});const id=state.session?.tabId;if(!id)throw new Error('No target');const result=await chrome.scripting.executeScript({target:{tabId:id},func:()=>{const player=[...document.querySelectorAll('#movie_player video')].find(v=>v.currentSrc);return {title:document.title,ad:!!document.querySelector('.ad-showing'),paused:player?.paused,time:player?.currentTime,ready:player?.readyState};}});return result[0].result;})()`);
}
try {
  const version = await debugJson('/json/version');
  const extensions = await cdp(version.webSocketDebuggerUrl, 'Extensions.getExtensions');
  extensionId = extensions.extensions.find(item => item.path?.toLowerCase() === extensionPath.toLowerCase())?.id;
  if (!extensionId) throw new Error('CAPTAIN project extension is not installed');
  const session = await findSession(extensionId);
  if (!session) throw new Error('Start CAPTAIN first');
  controller = session.controller;
  const baseline = await snapshot(); report.baseline = baseline;
  assert.equal(baseline.micOn, false, 'Turn off Speak before typed testing');
  assert.notEqual(baseline.state.status, 'running', 'Task in progress');
  const expectedBuild = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8')).version;
  assert.equal(baseline.state.build, expectedBuild, 'Stale extension build');
  noDemo(baseline);

  const song = await command('hey open youtube and then play the song ae ajnabee by aditya rikhari');
  sameWindow(song, baseline);
  const before = await playback(); await pause(2300); const after = await playback();
  for (const word of ['ae','ajnabee','aditya','rikhari']) assert.ok(new Set(after.title.toLowerCase().match(/[\p{L}\p{N}]+/gu)).has(word), `Missing requested title/artist word ${word}`);
  assert.equal(after.ad, false); assert.equal(after.paused, false);
  assert.ok(after.time > before.time + 0.5, 'Playback clock did not advance');
  report.playback = { before, after };
  const paused = await command('pause'); sameWindow(paused, baseline);
  assert.equal((await playback()).paused, true);

  for (const [text, hosts] of [['hey open gmail',['mail.google.com','accounts.google.com']], ['open wikipedia',['www.wikipedia.org','wikipedia.org']], ['open example dot com',['example.com']]]) {
    const current = await command(text); sameWindow(current, baseline);
    assert.equal(current.target.id, song.target.id, 'Normal command opened another target');
    assert.ok(hosts.includes(new URL(current.target.url).hostname), 'Requested destination missing');
    if (new URL(current.target.url).hostname === 'accounts.google.com') assert.match(current.state.message, /sign in/i);
  }

  // Close only the extra website tab that this test itself asks CAPTAIN to create.
  const beforeExtra = await snapshot();
  const extra = await command('open example.com in a new tab'); sameWindow(extra, baseline);
  assert.ok(!beforeExtra.tabs.some(t=>t.id===extra.target.id), 'New-tab request did not create a new target');
  assert.equal(extra.tabs.length, beforeExtra.tabs.length + 1);
  await evaluate(`(async()=>{const tab=await chrome.tabs.get(${extra.target.id});if(!tab.incognito||tab.windowId!==${baseline.windowId}||new URL(tab.url).hostname!=='example.com')throw new Error('Test tab changed; it was not closed');await chrome.tabs.remove(tab.id);})()`);
  const closed = await snapshot();
  assert.equal(closed.state.session.connected, false);
  report.closedTestTab = extra.target.id;
  const recovered = await command('hey open youtube'); sameWindow(recovered, baseline);
  assert.notEqual(recovered.target.id, extra.target.id);
  assert.notEqual(recovered.target.id, song.target.id, 'Recovery silently reused an unrelated existing tab');
  assert.equal(recovered.tabs.length, extra.tabs.length, 'Recovery created extra tabs');
  assert.equal(new URL(recovered.target.url).hostname, 'www.youtube.com');

  for (let attempt=0; attempt<2; attempt++) {
    execFileSync(process.execPath, [fileURLToPath(new URL('./start-demo.mjs', import.meta.url))], { cwd: root, timeout: 45000, windowsHide: true, stdio: 'pipe' });
    controller = (await findSession(extensionId)).controller;
    const relaunched = await snapshot(); sameWindow(relaunched, baseline);
    assert.deepEqual(relaunched.tabs.map(t=>t.id), recovered.tabs.map(t=>t.id), 'Relaunch added or removed tabs');
    assert.equal(relaunched.target.id, recovered.target.id);
  }
  report.final = await snapshot(); report.success = true;
} catch (error) { report.success = false; report.error = error.message; process.exitCode = 1; }
finally {
  report.finished = new Date().toISOString();
  await mkdir(new URL('../runtime/', import.meta.url), { recursive: true });
  await writeFile(new URL('../runtime/request-audit.json', import.meta.url), JSON.stringify(report,null,2));
  console.log(JSON.stringify({success:report.success,error:report.error,report:'runtime/request-audit.json'}));
}
