import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const code = await readFile(new URL('../extension/service-worker.js', import.meta.url), 'utf8');

function voiceSession(tabs) {
  let listener;
  const updates = [], creates = [], bindings = [], queries = [];
  const sandbox = { URL, chrome: {
    runtime: { getURL: path => `chrome-extension://captain/${path}`, onMessage: { addListener(fn) { listener = fn; } } },
    storage: { session: { set: async value => bindings.push(value) } },
    tabs: {
      query: async query => { queries.push(query); return tabs; },
      update: async (id, update) => updates.push({ id, ...update }),
      create: async options => creates.push(options),
      sendMessage: async () => { throw new Error('Opening voice must not send microphone or task commands'); }
    }
  } };
  vm.runInNewContext(code, sandbox);
  return { updates, creates, bindings, queries, open: tab => new Promise(resolve => listener({ type: 'OPEN_VOICE' }, { tab }, resolve)) };
}

test('voice entry reuses a bare popup in its Incognito window and adds routing without enabling audio', async () => {
  const tab = { id: 7, windowId: 3, incognito: true, url: 'chrome-extension://captain/popup.html' };
  const h = voiceSession([tab]);
  assert.equal((await h.open(tab)).ok, true);
  assert.equal(h.creates.length, 0);
  assert.equal(h.bindings.length, 0, 'The voice controller is not a working website target');
  assert.equal(JSON.stringify(h.updates), JSON.stringify([{ id: 7, active: true, url: 'chrome-extension://captain/popup.html?window=3' }]));
  assert.equal(JSON.stringify(h.queries), JSON.stringify([{ windowId: 3 }]));
});

test('voice entry recognizes initialized controllers without reloading their microphone session', async () => {
  for (const suffix of ['?window=3', '?target=9', '?window=3#voice']) {
    const h = voiceSession([{ id: 7, windowId: 3, incognito: true, url: `chrome-extension://captain/popup.html${suffix}` }]);
    assert.equal((await h.open({ id: 9, windowId: 3, incognito: true, url: 'https://example.com/' })).ok, true);
    assert.equal(h.creates.length, 0);
    assert.equal(JSON.stringify(h.updates), JSON.stringify([{ id: 7, active: true }]));
    assert.equal(JSON.stringify(h.bindings), JSON.stringify([{ 'captainWindow:3': { tabId: 9, windowId: 3 } }]));
  }
});

test('voice entry rejects normal tabs and never reuses another window or a lookalike popup URL', async () => {
  const h = voiceSession([
    { id: 1, windowId: 4, incognito: true, url: 'chrome-extension://captain/popup.html' },
    { id: 2, windowId: 3, incognito: false, url: 'chrome-extension://captain/popup.html' },
    { id: 3, windowId: 3, incognito: true, url: 'chrome-extension://other/popup.html' },
    { id: 4, windowId: 3, incognito: true, url: 'chrome-extension://captain/popup.html.backup?window=3' }
  ]);
  assert.equal((await h.open({ id: 9, windowId: 3, incognito: true, url: 'https://example.com/' })).ok, true);
  assert.equal(h.updates.length, 0);
  assert.equal(JSON.stringify(h.creates), JSON.stringify([{ windowId: 3, url: 'chrome-extension://captain/popup.html?window=3', active: true }]));
  const rejected = voiceSession([]);
  assert.match((await rejected.open({ id: 9, windowId: 3, incognito: false, url: 'https://example.com/' })).error, /Incognito/);
  assert.equal(rejected.creates.length, 0); assert.equal(rejected.updates.length, 0); assert.equal(rejected.queries.length, 0);
});

test('saved Incognito target is restored after worker restart', async () => {
  const sandbox = { chrome: { runtime: { onMessage: { addListener() {} } }, storage: { session: { get: async () => ({ 'captainTarget:7': { tabId: 9, windowId: 3 } }) } }, tabs: { get: async id => ({ id, windowId: 3, incognito: true }) } } };
  vm.runInNewContext(code, sandbox);
  assert.equal((await sandbox.resolveTarget(7)).id, 9);
  sandbox.chrome.tabs.get = async () => ({ id: 9, windowId: 4 });
  await assert.rejects(sandbox.resolveTarget(7), /another window/);
  sandbox.chrome.tabs.get = async () => { throw new Error('Missing'); };
  await assert.rejects(sandbox.resolveTarget(7), /closed/);
});

test('closed target is recreated once in the trusted controller window, with no demo or unrelated tab reuse', async () => {
  const values = { 'captainWindow:3': { tabId: 9, windowId: 3 } }, created = [];
  const sandbox = { chrome: {
    runtime: { getURL: value => `chrome-extension://captain/${value}`, onMessage: { addListener() {} } },
    windows: { get: async id => ({ id, incognito: true }) },
    storage: { session: { get: async key => ({ [key]: values[key] }), set: async items => Object.assign(values, items) } },
    tabs: { get: async id => { if (id !== 11) throw new Error('Closed'); return { id, windowId: 3, incognito: true, url: 'about:blank' }; }, create: async options => { created.push(options); return { ...options, id: 11, incognito: true }; }, query: async () => { throw new Error('Must not silently reuse unrelated tabs'); } }
  } };
  vm.runInNewContext(code, sandbox);
  assert.equal((await sandbox.sessionTarget(3, 7)).connected, false);
  assert.equal(created.length, 0, 'A read-only status check must not open a tab');
  assert.equal((await sandbox.resolveTarget(7, 3)).id, 11);
  assert.equal((await sandbox.resolveTarget(7, 3)).id, 11);
  assert.equal(created.length, 1);
  assert.equal(created[0].url, 'about:blank');
  assert.equal(created[0].windowId, 3);
  assert.equal(values['captainTarget:7'].tabId, 11);
  assert.equal(values['captainWindow:3'].tabId, 11);
});

test('a normal or moved controller target is never recovered into another window', async () => {
  const sandbox = { chrome: { runtime: { getURL: value => `chrome-extension://captain/${value}`, onMessage: { addListener() {} } },
    windows: { get: async () => ({ incognito: false }) }, storage: { session: { get: async () => ({}) } },
    tabs: { get: async id => ({ id, windowId: 4, incognito: true }), create: async () => { throw new Error('Should not create'); } }
  } };
  vm.runInNewContext(code, sandbox);
  await assert.rejects(sandbox.resolveTarget(7, 3), /Incognito/);
  sandbox.chrome.windows.get = async () => ({ incognito: true });
  await assert.rejects(sandbox.resolveTarget(7, 3), /another window/);
});

test('Gmail login and named-site home redirects are accepted only on allowed hosts', async () => {
  for (const [destination, finalUrl, signIn] of [
    ['https://mail.google.com', 'https://accounts.google.com/v3/signin/identifier', true],
    ['https://mail.google.com', 'https://workspace.google.com/intl/en-US/gmail/', true],
    ['https://accounts.google.com/ServiceLogin?service=mail', 'https://accounts.google.com/v3/signin/identifier', true],
    ['https://www.wikipedia.org', 'https://wikipedia.org/', false],
    ['https://www.irctc.co.in', 'https://www.irctc.co.in/nget/train-search', false]
  ]) {
    let navigated = false;
    const sandbox = { URL, Date, chrome: { runtime: { onMessage: { addListener() {} } }, tabs: {
      get: async () => ({ id: 7, incognito: true, status: 'complete', url: navigated ? finalUrl : 'about:blank' }),
      update: async () => { navigated = true; }
    } } };
    vm.runInNewContext(code, sandbox);
    const result = await sandbox.navigateSameTab(7, destination);
    assert.equal(result.ok, true);
    assert.equal(!!result.requiresSignIn, signIn);
  }
});
test('cancel during perception prevents planner request and action', async () => {
  let listener, saved, release; let requests = 0;
  const sandbox = { URL, AbortController, performance, setTimeout, clearTimeout, fetch: async () => { requests++; }, chrome: {
    runtime: { getURL: path => `chrome-extension://captain/${path}`, onMessage: { addListener(fn) { listener = fn; } } },
    windows: { get: async () => ({ state: 'normal' }), update: async () => {} },
    tabs: { get: async () => ({ id: 7, incognito: true, windowId: 3 }), update: async () => {}, sendMessage: () => new Promise(resolve => { release = resolve; }) },
    storage: { session: { get: async () => ({}) }, sync: { get: async () => ({}) }, local: { set: async value => { saved = value.captainState; } } }
  } };
  vm.runInNewContext(code, sandbox);
  listener({ type: 'START_TASK', task: 'open YouTube' }, { tab: { id: 7 } }, () => {});
  await new Promise(resolve => setImmediate(resolve));
  listener({ type: 'CANCEL_TASK' }, {}, () => {});
  release({ vision: {}, piiCounts: {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 0);
  assert.equal(saved.phase, 'Cancelled');
});

test('playback focus restores a minimized window without creating a new one', async () => {
  const events = [];
  const sandbox = { chrome: { runtime: { onMessage: { addListener() {} } }, windows: { get: async () => ({ state: 'minimized' }), update: async (id, value) => events.push([id, value]) }, tabs: { update: async (id, value) => events.push([id, value]) } } };
  vm.runInNewContext(code, sandbox);
  await sandbox.focusTarget({ id: 7, windowId: 3 });
  assert.equal(JSON.stringify(events), JSON.stringify([[3, { state: 'normal' }], [7, { active: true }], [3, { focused: true }]]));
});

test('title-bar-sized restored window is resized to a usable browser viewport', async () => {
  const updates = [];
  const sandbox = { chrome: { runtime: { onMessage: { addListener() {} } }, windows: { get: async () => ({ state: 'normal', height: 95, width: 1053 }), update: async (id, value) => updates.push(value) }, tabs: { update: async () => {} } } };
  vm.runInNewContext(code, sandbox);
  await sandbox.focusTarget({ id: 7, windowId: 3 });
  assert.equal(updates[0].height, 800);
  assert.equal(updates[0].width, 1180);
});

test('Chrome tab-strip busy rejection is retried, unrelated action failures are not', async () => {
  const sandbox = { setTimeout: fn => fn(), chrome: { runtime: { onMessage: { addListener() {} } } } };
  vm.runInNewContext(code, sandbox);
  let calls = 0;
  const value = await sandbox.chromeEdit(async () => { if (++calls < 3) throw new Error('Tabs cannot be edited right now (user may be dragging a tab).'); return 7; });
  assert.equal(value, 7); assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(sandbox.chromeEdit(async () => { calls++; throw new Error('Page changed during action'); }), /Page changed/);
  assert.equal(calls, 1);
});

test('observation reconnects a missing content script once after an extension reload', async () => {
  let calls = 0, injections = 0;
  const sandbox = { Date, setTimeout: (fn, ms) => ms < 8000 ? (fn(), 1) : 2, clearTimeout() {}, chrome: {
    runtime: { onMessage: { addListener() {} } },
    tabs: { get: async () => ({ incognito: true, status: 'complete', pendingUrl: null, url: 'https://www.youtube.com/' }), sendMessage: async () => { if (++calls === 1) throw new Error('Could not establish connection. Receiving end does not exist.'); return { title: 'YouTube' }; } },
    scripting: { executeScript: async options => { injections++; assert.equal(options.target.tabId, 7); assert.equal(options.files[0], 'content-script.js'); } }
  } };
  vm.runInNewContext(code, sandbox);
  assert.equal((await sandbox.send(7, { type: 'OBSERVE' })).title, 'YouTube');
  assert.equal(injections, 1);
  calls = 0;
  await assert.rejects(sandbox.send(7, { type: 'EXECUTE', action: { type: 'click' } }), /Receiving end/);
  assert.equal(injections, 1, 'An uncertain action must not be re-injected/repeated');
});

test('playback verifier waits through an advertisement and returns only verified success', async () => {
  let calls = 0; const waits = [];
  const sandbox = { Date, setTimeout: fn => { fn(); }, clearTimeout() {}, chrome: { runtime: { onMessage: { addListener() {} } } } };
  vm.runInNewContext(code, sandbox);
  sandbox.send = async () => ++calls === 1 ? { ok: false, retryable: true, error: 'Advertisement playing' } : { ok: true, verified: true };
  sandbox.focusTarget = async () => {};
  const result = await sandbox.verifyRequestedPlayback({ id: 7 }, 'Arijit Singh', message => waits.push(message));
  assert.equal(result.verified, true); assert.equal(calls, 2); assert.deepEqual(waits, ['Advertisement playing']);
});

test('wrong-title playback error is not retried', async () => {
  const sandbox = { Date, chrome: { runtime: { onMessage: { addListener() {} } } } };
  vm.runInNewContext(code, sandbox);
  sandbox.send = async () => ({ ok: false, error: 'Wrong requested title' });
  sandbox.focusTarget = async () => {};
  await assert.rejects(sandbox.verifyRequestedPlayback({ id: 7 }, 'Arijit', () => {}), /Wrong requested title/);
});

test('an accepted action is not sufficient playback verification', async () => {
  const sandbox = { Date, chrome: { runtime: { onMessage: { addListener() {} } } } };
  vm.runInNewContext(code, sandbox);
  sandbox.send = async () => ({ ok: true });
  sandbox.focusTarget = async () => {};
  await assert.rejects(sandbox.verifyRequestedPlayback({ id: 7 }, '', () => {}), /verified playback evidence/);
});

test('playback recovers an ad-to-paused transition and still requires advancing verification', async () => {
  const actions = []; const replies = [
    { ok: false, retryable: true, error: 'Advertisement playing' },
    { ok: false, retryable: true, needsResume: true, error: 'Requested player paused' },
    { ok: true, pending: 'Play accepted' },
    { ok: true, verified: true }
  ];
  const sandbox = { Date, setTimeout: fn => fn(), clearTimeout() {}, chrome: { runtime: { onMessage: { addListener() {} } } } };
  vm.runInNewContext(code, sandbox);
  sandbox.focusTarget = async () => {};
  sandbox.send = async (_id, message) => { actions.push(message.action.type); return replies.shift(); };
  const result = await sandbox.verifyRequestedPlayback({ id: 7 }, 'Shreya Ghoshal', () => {});
  assert.equal(result.verified, true);
  assert.deepEqual(actions, ['verifyPlayback', 'verifyPlayback', 'media', 'verifyPlayback']);
});

test('playback recovery is bounded to two resume attempts', async () => {
  let clock = 0, plays = 0;
  const sandbox = { Date: { now: () => clock }, setTimeout: fn => { clock += 30000; fn(); }, clearTimeout() {}, chrome: { runtime: { onMessage: { addListener() {} } } } };
  vm.runInNewContext(code, sandbox);
  sandbox.focusTarget = async () => {};
  sandbox.send = async (_id, message) => message.action.type === 'media' ? (plays++, { ok: true }) : { ok: false, retryable: true, needsResume: true, error: 'Paused' };
  await assert.rejects(sandbox.verifyRequestedPlayback({ id: 7 }, 'Shreya', () => {}), /90 seconds/);
  assert.equal(plays, 2);
});

test('cancelling during debugger attachment prevents a new click and detaches', async () => {
  const calls = [];
  const sandbox = { AbortController, chrome: { runtime: { onMessage: { addListener() {} } }, debugger: {
    attach: async () => { vm.runInNewContext('taskAbort.abort()', sandbox); },
    sendCommand: async () => calls.push('click'), detach: async () => calls.push('detach')
  } } };
  vm.runInNewContext(code, sandbox);
  vm.runInNewContext('taskAbort = new AbortController()', sandbox);
  sandbox.focusTarget = async () => {};
  await assert.rejects(sandbox.trustedPlayClick({ id: 7 }, { x: 10, y: 10 }), /cancelled/);
  assert.deepEqual(calls, ['detach']);
});

test('blank browser tabs bootstrap navigation without waiting for a content script', async () => {
  const sandbox = { chrome: { runtime: { onMessage: { addListener() {} } } } };
  vm.runInNewContext(code, sandbox);
  sandbox.send = async () => { throw new Error('No injection available on blank tabs'); };
  for (const url of ['about:blank', 'chrome://newtab/', 'edge://newtab/']) {
    const context = await sandbox.observe({ id: 7, url }, {});
    assert.equal(context.url, 'about:blank');
    assert.equal(context.elements.length, 0);
  }
});

test('model-only completion is labelled for review, not a verified outcome', () => {
  const sandbox = { chrome: { runtime: { onMessage: { addListener() {} } } } };
  vm.runInNewContext(code, sandbox);
  for (const planner of ['ollama', 'remote-vlm']) {
    const plan = { planner, action: { type: 'finish', message: 'Song is playing' } };
    const unverified = sandbox.completionSummary(plan, {});
    assert.equal(unverified.outcomeVerified, false);
    assert.equal(unverified.phase, 'Review required');
    assert.match(unverified.message, /not been independently verified/);
    assert.equal(sandbox.completionSummary(plan, {}, { verified: true }).phase, 'Complete');
  }
});

test('clarification on a blank tab completes without injecting an action', async () => {
  let saved;
  const sandbox = { AbortController, performance, setTimeout, clearTimeout, fetch: async () => ({ ok: true, json: async () => ({ planner: 'fast-command', action: { type: 'finish', clarification: true, followUpPrefix: 'open ', message: 'Which website?' } }) }), chrome: {
    runtime: { onMessage: { addListener() {} } },
    storage: { session: { get: async () => ({}) }, sync: { get: async () => ({}) }, local: { set: async value => { saved = value.captainState; } } },
    tabs: { get: async () => ({ id: 7, windowId: 3, incognito: true, url: 'about:blank' }), update: async () => {}, sendMessage: async () => { throw new Error('No page receiver'); } },
    windows: { get: async () => ({ state: 'normal' }), update: async () => {} }
  } };
  vm.runInNewContext(code, sandbox);
  await sandbox.run('open', 7);
  assert.equal(saved.status, 'complete');
  assert.equal(saved.requiresInput, true);
  assert.equal(saved.message, 'Which website?');
});
