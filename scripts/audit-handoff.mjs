import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { debugJson, evaluate, findSession } from './reload-in-place.mjs';

const report = { started: new Date().toISOString(), passed: false };
try {
  const controller = (await debugJson('/json/list')).find(target => target.type === 'page' && /chrome-extension:\/\/[^/]+\/popup\.html/.test(target.url || ''));
  assert.ok(controller, 'CAPTAIN controller is not open');
  assert.ok(await findSession(new URL(controller.url).hostname), 'CAPTAIN Incognito session is unavailable');
  const fixture = 'http://127.0.0.1:4317/challenge-fixture.html';
  const prepared = await evaluate(controller, `(async()=>{const me=await chrome.tabs.getCurrent(),key='captainWindow:'+me.windowId;let binding=(await chrome.storage.session.get(key))[key],tab;try{if(binding?.tabId)tab=await chrome.tabs.get(binding.tabId)}catch{}if(!tab||tab.id===me.id)tab=await chrome.tabs.create({windowId:me.windowId,url:${JSON.stringify(fixture)},active:true});else await chrome.tabs.update(tab.id,{url:${JSON.stringify(fixture)},active:true});await chrome.storage.session.set({[key]:{tabId:tab.id,windowId:tab.windowId}});for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,80));tab=await chrome.tabs.get(tab.id);if(tab.status==='complete'&&!tab.pendingUrl)break}return{tabId:tab.id,windowId:tab.windowId}})()`);
  const start = await evaluate(controller, `chrome.runtime.sendMessage({type:'START_TASK',task:'scroll down',tabId:${prepared.tabId}})`); assert.equal(start.ok, true);
  let state; const waitDeadline = Date.now() + 30000;
  do { await new Promise(resolve => setTimeout(resolve, 200)); state = await evaluate(controller, `chrome.runtime.sendMessage({type:'GET_STATE'})`); } while (state?.status !== 'waiting_human' && Date.now() < waitDeadline);
  assert.equal(state?.status, 'waiting_human'); assert.equal(state.captchaDetected, true); assert.equal(state.handoffState, 'WAITING_FOR_HUMAN');
  const refused = await evaluate(controller, `chrome.runtime.sendMessage({type:'RESUME_TASK'})`); assert.equal(refused.ok, false); assert.match(refused.error, /still visible/i);
  await evaluate(controller, `chrome.scripting.executeScript({target:{tabId:${prepared.tabId}},world:'MAIN',func:()=>document.querySelector('#manual').click()})`);
  const resumed = await evaluate(controller, `chrome.runtime.sendMessage({type:'RESUME_TASK'})`); assert.equal(resumed.ok, true);
  const finishDeadline = Date.now() + 30000;
  do { await new Promise(resolve => setTimeout(resolve, 200)); state = await evaluate(controller, `chrome.runtime.sendMessage({type:'GET_STATE'})`); } while (!['complete','error'].includes(state?.status) && Date.now() < finishDeadline);
  assert.equal(state?.status, 'complete', state?.message || 'Task did not finish after handoff');
  assert.equal(state.resumed, true); assert.equal(state.taskCompletedAfterHandoff, true); assert.ok(state.handoffDuration >= 0);
  Object.assign(report, { passed: true, tabId: prepared.tabId, windowId: prepared.windowId, refusedWhilePresent: true, resumed: state.resumed, taskCompletedAfterHandoff: state.taskCompletedAfterHandoff, handoffDuration: state.handoffDuration, steps: state.step, message: state.message });
  console.log(JSON.stringify(report, null, 2));
} catch (error) { report.error = error.stack || error.message; console.error(report.error); process.exitCode = 1; }
finally { report.finished = new Date().toISOString(); await mkdir(new URL('../runtime/', import.meta.url), { recursive: true }); await writeFile(new URL('../runtime/handoff-audit.json', import.meta.url), JSON.stringify(report, null, 2)); }
