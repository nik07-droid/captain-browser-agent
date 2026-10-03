import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cdp, debugJson, extensionPath, findSession } from './reload-in-place.mjs';
import { namedSite } from '../server/sites.mjs';

// Public website navigation only. No sign-in, purchases, media playback or account actions.
const report = { started: new Date().toISOString(), steps: [] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let controller, baseline, workingId;
async function evaluate(expression) {
  const result = await cdp(controller.webSocketDebuggerUrl, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, 15000);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function snapshot() {
  return evaluate(`(async()=>{
    const self=await chrome.tabs.getCurrent();const state=await chrome.runtime.sendMessage({type:'GET_STATE'});
    const tabs=await chrome.tabs.query({windowId:self.windowId});
    return {windowId:self.windowId,controllerId:self.id,incognito:self.incognito,micOn:listening,status:state.status,state,tabs:tabs.map(t=>({id:t.id,url:t.url})),windows:(await chrome.windows.getAll({windowTypes:['normal']})).filter(w=>w.incognito).map(w=>w.id)};
  })()`);
}
async function command(task, expectedHost, { path, query, searchFallback = false, discovery = false, searchOpen = false } = {}) {
  const entry = { command: task }; report.steps.push(entry);
  try {
    const since = await evaluate(`(async()=>{await refresh();if(listening||micStarting)throw new Error('Turn off Speak before automated tests.');if(document.querySelector('#run').disabled||window.captainVoiceMode==='busy')throw new Error('Another task is running.');const since=Date.now();document.querySelector('#task').value=${JSON.stringify(task)};document.querySelector('#run').click();return since;})()`);
    let result; const deadline = Date.now() + 95000;
    do {
      result = await snapshot();
      if (result.state.task === task && result.state.updatedAt >= since && ['complete','error'].includes(result.status)) break;
      await pause(400);
    } while (Date.now() < deadline);
    entry.status = result.status; entry.message = result.state.message; entry.state = result.state;
    assert.equal(result.state.task, task); assert.ok(result.state.updatedAt >= since, 'No fresh command response');
    assert.equal(result.status, 'complete', result.state.message || 'Command timeout');
    assert.equal(!!result.state.requiresInput, false, 'Command unexpectedly requested clarification');
    assert.notEqual(result.state.outcomeVerified, false, 'Planner-only completion');
    const tab = result.tabs.find(t => t.id === result.state.session?.tabId); assert.ok(tab, 'Missing working tab');
    workingId ||= tab.id; assert.equal(tab.id, workingId, 'A normal command opened a different tab');
    assert.equal(result.windowId, baseline.windowId); assert.equal(result.controllerId, baseline.controllerId);
    assert.deepEqual(result.windows, baseline.windows, 'Another private window was created');
    assert.equal(result.tabs.length, baseline.tabs.length + (baseline.state.session?.connected ? 0 : 1), 'Unexpected extra tab');
    assert.ok(!result.tabs.some(t => /\/demo\.html/.test(t.url)), 'A demo tab opened');
    const evidence = await evaluate(`(async()=>{const rows=await chrome.scripting.executeScript({target:{tabId:${workingId}},func:()=>({url:location.href,title:document.title,ready:document.readyState,bodyLength:document.body?.innerText?.length||0,panelBuild:document.querySelector('#captain-agent-host')?.dataset.captainBuild})});return rows[0].result;})()`);
    entry.document = evidence; entry.tabId = workingId; entry.windowId = result.windowId;
    const url = new URL(evidence.url); assert.equal(url.hostname, expectedHost);
    assert.ok(evidence.bodyLength > 0 && evidence.title, 'Website document is blank');
    assert.doesNotMatch(evidence.title, /site can.t be reached|privacy error|access denied|just a moment|robot check/i, 'Website displayed a blocking error/challenge');
    if (path) assert.equal(url.pathname, path);
    if (query) for (const [key, value] of Object.entries(query)) assert.equal(url.searchParams.get(key), value);
    if (searchFallback) { assert.match(entry.message, /search results|choose|official website/i); assert.doesNotMatch(entry.message, /^Opened /i); }
    if (discovery) {
      assert.equal(namedSite(task.replace(/^open\s+/i, '')), null, 'Test site must not be in the catalogue');
      const startingUrl = new URL(baseline.tabs.find(t => t.id === workingId)?.url || 'about:blank');
      const alreadyOnResults = startingUrl.hostname === 'www.google.com' && startingUrl.pathname === '/search' && startingUrl.searchParams.get('q') === `${task.replace(/^open\s+/i, '')} official website`;
      assert.ok(alreadyOnResults || result.state.history.some(h => h.action.type === 'navigate' && new URL(h.action.url).hostname === 'www.google.com'), 'Discovery must start from web search');
      assert.ok(result.state.history.some(h => h.intent === 'website-discovery' && h.action.type === 'click' && h.action.expectedHost), 'Discovery must click an observed matching candidate');
    }
    if (searchOpen) assert.ok(result.state.history.some(h => h.intent === 'search-open' && h.action.type === 'click' && h.action.expectedHost === expectedHost), 'Search-and-open must click a freshly observed organic result and bind its destination host');
    entry.passed = true;
  } catch (error) { entry.passed = false; entry.error = error.message; }
  console.log(JSON.stringify({ command: task, passed: entry.passed, status: entry.status, message: entry.message, document: entry.document, error: entry.error }));
  // Continue independent completed failures, but never overlap a still-running task.
  if ((await snapshot()).status === 'running') throw new Error(`Task did not stop: ${task}`);
}
try {
  const version = await debugJson('/json/version');
  const installed = await cdp(version.webSocketDebuggerUrl, 'Extensions.getExtensions');
  const id = installed.extensions.find(e => e.path?.toLowerCase() === extensionPath.toLowerCase())?.id; assert.ok(id, 'Start CAPTAIN first');
  const session = await findSession(id); assert.ok(session); controller = session.controller;
  baseline = await snapshot(); report.baseline = baseline;
  assert.equal(baseline.incognito, true); assert.equal(baseline.micOn, false); assert.notEqual(baseline.status, 'running');
  const expected = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8')).version;
  assert.equal(baseline.state.build, expected, 'Stale extension');
  report.server = await fetch('http://127.0.0.1:4317/health').then(r => r.json());
  assert.equal(report.server.version, expected, 'Stale service');
  if (process.argv.includes('--search-open')) {
    await command('search for Python official website and open the first result', 'www.python.org', { searchOpen: true });
  } else if (process.argv.includes('--discovery')) {
    await command('open Python', 'www.python.org', { discovery: true });
    await command('open Blender', 'www.blender.org', { discovery: true });
    await command('open freecodecamp', 'www.freecodecamp.org', { discovery: true });
    await command('open Spotify', 'open.spotify.com');
  } else {
  await command('open Spotify', 'open.spotify.com');
  await command('open YouTube', 'www.youtube.com');
  await command('search Spotify', 'open.spotify.com');
  await command('open Netflix', 'www.netflix.com');
  await command('open WhatsApp', 'web.whatsapp.com');
  await command('open stack overflow', 'stackoverflow.com');
  await command('search Spotify on YouTube', 'www.youtube.com', { path: '/results', query: { search_query: 'Spotify' } });
  await command('search Spotify on Google', 'www.google.com', { path: '/search', query: { q: 'Spotify' } });
  await command('search the web for Mozilla Foundation', 'www.google.com', { path: '/search', query: { q: 'Mozilla Foundation' }, searchFallback: true });
  await command('open spotify', 'open.spotify.com');
  }
  report.passed = report.steps.every(step => step.passed);
  if (!report.passed) process.exitCode = 1;
} catch (error) { report.passed = false; report.error = error.stack || error.message; console.error(report.error); process.exitCode = 1; }
finally {
  report.finished = new Date().toISOString();
  await mkdir(new URL('../runtime/', import.meta.url), { recursive: true });
  const output = process.argv.includes('--search-open') ? '../runtime/search-open-audit.json' : process.argv.includes('--discovery') ? '../runtime/discovery-audit.json' : '../runtime/website-audit.json';
  await writeFile(new URL(output, import.meta.url), JSON.stringify(report, null, 2));
}
