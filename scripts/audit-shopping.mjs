import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { debugJson, evaluate, findSession } from './reload-in-place.mjs';

const report = { started: new Date().toISOString(), task: 'Find me the cheapest laptop under ₹50,000' };
try {
  const targets = await debugJson('/json/list');
  const controller = targets.find(target => target.type === 'page' && /chrome-extension:\/\/[^/]+\/popup\.html/.test(target.url || ''));
  assert.ok(controller, 'CAPTAIN controller is not open');
  const extensionId = new URL(controller.url).hostname, session = await findSession(extensionId);
  assert.ok(session, 'CAPTAIN Incognito session is unavailable');
  const prepared = await evaluate(controller, `(async()=>{const me=await chrome.tabs.getCurrent();const key='captainWindow:'+me.windowId;let saved=(await chrome.storage.session.get(key))[key],tab;try{if(saved?.tabId)tab=await chrome.tabs.get(saved.tabId)}catch{}if(!tab||tab.id===me.id||tab.windowId!==me.windowId){tab=await chrome.tabs.create({windowId:me.windowId,url:'about:blank',active:true});await chrome.storage.session.set({[key]:{tabId:tab.id,windowId:tab.windowId}})}await chrome.tabs.update(tab.id,{active:true,url:'http://127.0.0.1:4317/demo.html?seed=sih-final'});await chrome.windows.update(me.windowId,{focused:true});for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,100));tab=await chrome.tabs.get(tab.id);if(tab.status==='complete'&&!tab.pendingUrl)break}return{tabId:tab.id,windowId:tab.windowId,url:tab.url}})()`);
  assert.match(prepared.url, /\/demo\.html\?seed=sih-final/);
  const dispatched = await evaluate(controller, `chrome.runtime.sendMessage({type:'START_TASK',task:${JSON.stringify(report.task)},tabId:${prepared.tabId}})`);
  assert.equal(dispatched?.ok, true, dispatched?.error || 'Task was not accepted');
  const deadline = Date.now() + 60000; let state;
  do {
    await new Promise(resolve => setTimeout(resolve, 250));
    state = await evaluate(controller, `chrome.runtime.sendMessage({type:'GET_STATE'})`);
    if (['complete', 'error'].includes(state?.status)) break;
  } while (Date.now() < deadline);
  assert.equal(state?.status, 'complete', state?.message || 'Shopping task did not complete');
  const page = await evaluate(controller, `chrome.scripting.executeScript({target:{tabId:${prepared.tabId}},func:()=>({hash:location.hash,selected:document.querySelector('[data-product-detail]')?.getAttribute('data-product-detail')||'',text:document.querySelector('#detail')?.innerText||''})}).then(x=>x[0].result)`);
  assert.equal(page.selected, 'atlas-lite');
  assert.match(page.text, /Selected product: Atlas Lite/);
  assert.match(page.text, /₹43,990/);
  const actionTypes = (state.history || []).map(item => item.action?.type).filter(Boolean);
  for (const required of ['type', 'select', 'click', 'finish']) assert.ok(actionTypes.includes(required), `Shopping flow did not execute ${required}`);
  report.passed = true; report.tabId = prepared.tabId; report.windowId = prepared.windowId; report.finalProduct = 'Atlas Lite'; report.finalPrice = 43990; report.actions = actionTypes; report.steps = state.step; report.latencyMs = state.latencyMs; report.message = state.message;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.passed = false; report.error = error.stack || error.message; console.error(report.error); process.exitCode = 1;
} finally {
  report.finished = new Date().toISOString(); await mkdir(new URL('../runtime/', import.meta.url), { recursive: true }); await writeFile(new URL('../runtime/shopping-audit.json', import.meta.url), JSON.stringify(report, null, 2));
}
