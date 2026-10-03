import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { debugJson, evaluate, findSession } from './reload-in-place.mjs';

const wanted = new Set(process.argv.slice(2).filter(value => !value.startsWith('--')));
const definitionDirectory = new URL('../tests/acceptance/', import.meta.url);
const definitions = [];
for (const name of (await readdir(definitionDirectory)).filter(name => name.endsWith('.json')).sort()) {
  const definition = JSON.parse(await readFile(new URL(name, definitionDirectory), 'utf8'));
  if (!wanted.size || wanted.has(definition.website) || wanted.has(basename(name, '.json'))) definitions.push(definition);
}
assert.ok(definitions.length, 'No matching acceptance definitions.');

const targets = await debugJson('/json/list');
const controller = targets.find(target => target.type === 'page' && /chrome-extension:\/\/[^/]+\/popup\.html/.test(target.url || ''));
assert.ok(controller, 'CAPTAIN controller is not open. Run npm run demo first.');
const session = await findSession(new URL(controller.url).hostname);
assert.ok(session, 'CAPTAIN Incognito session is unavailable.');
const outputDirectory = new URL('../runtime/results/', import.meta.url); await mkdir(outputDirectory, { recursive: true });
const summary = { generatedAt: new Date().toISOString(), total: definitions.length, completed: 0, partial: 0, blocked: 0, failed: 0, results: [] };

const hostMatches = (actual, expected) => actual === expected || actual.endsWith(`.${expected}`);
for (const definition of definitions) {
  const result = { website: definition.website, category: definition.category, task: definition.task, started: new Date().toISOString(), completed: false, blocked: false, captcha: false, failed: false, status: 'FAILED', steps: 0, retries: 0, recoveryCount: 0, humanHandoff: false, latency: null, privacy: null, verification: { passed: false }, reason: '' };
  try {
    const prepared = await evaluate(controller, `(async()=>{const me=await chrome.tabs.getCurrent();const key='captainWindow:'+me.windowId;let binding=(await chrome.storage.session.get(key))[key],tab;try{if(binding?.tabId)tab=await chrome.tabs.get(binding.tabId)}catch{}if(!tab||tab.id===me.id||tab.windowId!==me.windowId)tab=await chrome.tabs.create({windowId:me.windowId,url:${JSON.stringify(definition.startingURL)},active:true});else await chrome.tabs.update(tab.id,{url:${JSON.stringify(definition.startingURL)},active:true});const deadline=Date.now()+15000;while(Date.now()<deadline){tab=await chrome.tabs.get(tab.id);if(tab.status==='complete'&&!tab.pendingUrl)break;await new Promise(r=>setTimeout(r,100));}await chrome.storage.session.set({[key]:{tabId:tab.id,windowId:tab.windowId}});return{tabId:tab.id,windowId:tab.windowId,incognito:tab.incognito,url:tab.url,status:tab.status}})()`);
    assert.equal(prepared.incognito, true);
    const accepted = await evaluate(controller, `chrome.runtime.sendMessage({type:'START_TASK',task:${JSON.stringify(definition.task)},tabId:${prepared.tabId}})`);
    assert.equal(accepted?.ok, true, accepted?.error || 'Task was not accepted');
    const deadline = Date.now() + (definition.website === 'amazon' ? 150000 : 60000); let state;
    do {
      await new Promise(resolve => setTimeout(resolve, 400));
      state = await evaluate(controller, `chrome.runtime.sendMessage({type:'GET_STATE'})`);
      if (['complete', 'error', 'waiting_human'].includes(state?.status)) break;
    } while (Date.now() < deadline);
    const tab = await evaluate(controller, `chrome.tabs.get(${prepared.tabId}).then(t=>({url:t.url,windowId:t.windowId,incognito:t.incognito}))`);
    result.steps = state?.step || state?.history?.length || 0; result.recoveryCount = state?.recoveryCount || 0; result.retries = (state?.timeline || []).filter(event => event.type === 'RECOVERY_STARTED').length; result.latency = state?.latencyMs ?? null; result.privacy = { status: state?.vision?.status || 'unavailable', piiDetected: state?.piiDetected ?? null, rawScreenshotTransmitted: false };
    result.captcha = state?.captchaDetected === true || state?.status === 'waiting_human';
    result.humanHandoff = result.captcha || state?.resumed === true;
    if (result.captcha) {
      result.blocked = true; result.status = 'BLOCKED'; result.reason = 'CAPTCHA / HUMAN VERIFICATION';
      // The production behavior remains paused for its human. An automated
      // acceptance catalog has no human, so cancel only this recorded audit
      // task before starting the next independent definition.
      await evaluate(controller, `chrome.runtime.sendMessage({type:'CANCEL_TASK'})`);
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const cleanup = await evaluate(controller, `chrome.runtime.sendMessage({type:'GET_STATE'})`);
        if (cleanup?.status !== 'waiting_human' && cleanup?.status !== 'running') break;
      }
    }
    else if (!state || !['complete', 'error'].includes(state.status)) { result.failed = true; result.status = 'FAILED'; result.reason = 'TIMEOUT'; }
    else if (state.status === 'error') { result.failed = true; result.status = 'FAILED'; result.reason = state.message || 'FAILED'; }
    else if (state.completionStatus === 'PARTIAL') { result.status = 'PARTIAL'; result.reason = state.message || 'PARTIAL'; }
    else {
      const url = new URL(tab.url), hostOk = definition.verification.hosts.some(host => hostMatches(url.hostname.replace(/^www\./, ''), host));
      const pathOk = !definition.verification.pathPattern || new RegExp(definition.verification.pathPattern, 'i').test(url.pathname);
      const forbidden = (state.history || []).filter(item => (definition.constraints.forbid || []).some(term => new RegExp(term, 'i').test(`${item.action?.type || ''} ${item.action?.url || ''} ${item.reason || ''}`)));
      result.verification = { passed: hostOk && pathOk && forbidden.length === 0, hostOk, pathOk, forbiddenActions: forbidden.length, finalUrl: tab.url };
      result.completed = result.verification.passed;
      result.failed = !result.completed;
      result.status = result.completed ? 'COMPLETED' : 'FAILED';
      result.reason = result.completed ? 'VERIFIED' : 'CHANGED / FINAL STATE MISMATCH';
    }
  } catch (error) { result.failed = true; result.status = 'FAILED'; result.reason = error.message || String(error); }
  result.finished = new Date().toISOString();
  summary.completed += result.completed ? 1 : 0; summary.partial += result.status === 'PARTIAL' ? 1 : 0; summary.blocked += result.blocked ? 1 : 0; summary.failed += result.failed ? 1 : 0; summary.results.push(result);
  const stamp = result.started.replace(/[:.]/g, '-');
  await writeFile(new URL(`${definition.website}-${stamp}.json`, outputDirectory), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
await writeFile(new URL('../runtime/acceptance-summary.json', import.meta.url), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (summary.failed) process.exitCode = 1;
