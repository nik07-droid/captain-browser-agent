import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { isController, navigateController, prepareController, readSessionExpression } from '../scripts/reload-in-place.mjs';

test('launcher recognizes window, legacy and initial controller URLs, but no website impostors', () => {
  for (const query of ['', '?window=44', '?target=55']) {
    assert.equal(isController({ type: 'page', url: `chrome-extension://captain/popup.html${query}` }, 'captain'), true);
  }
  assert.equal(isController({ type: 'page', url: 'https://example.com/popup.html?window=44' }), false);
  assert.equal(isController({ type: 'page', url: 'chrome-extension://other/popup.html' }, 'captain'), false);
  assert.equal(isController({ type: 'service_worker', url: 'chrome-extension://captain/popup.html' }), false);
});

function readSession({ url = 'chrome-extension://captain/popup.html?target=2', controller = { id: 1, windowId: 44, incognito: true }, storage = {}, target } = {}) {
  return vm.runInNewContext(readSessionExpression, {
    URL,
    location: { href: url },
    chrome: {
      tabs: { getCurrent: async () => controller, get: async id => { if (id !== target?.id) throw new Error('No tab with id'); return target; } },
      runtime: { getURL: path => `chrome-extension://captain/${path}` },
      storage: { session: { get: async () => storage } },
    },
  });
}

test('closed legacy target does not invalidate a live private controller', async () => {
  const session = await readSession();
  assert.equal(session.windowId, 44);
  assert.equal(session.controllerTabId, 1);
  assert.equal(session.target, null);
});

test('launcher recovers binding from the actual window, not an untrusted URL window', async () => {
  const session = await readSession({ url: 'chrome-extension://captain/popup.html?window=999', storage: { 'captainWindow:44': { tabId: 3, windowId: 44 } }, target: { id: 3, windowId: 44, incognito: true, url: 'https://youtube.com/' } });
  assert.equal(session.windowId, 44);
  assert.equal(session.target.tabId, 3);
});

test('launcher cannot bind a target that moved into another window or a normal window', async () => {
  for (const target of [{ id: 2, windowId: 99, incognito: true }, { id: 2, windowId: 44, incognito: false }, { id: 2, windowId: 44, incognito: true, url: 'chrome-extension://captain/options.html' }]) {
    assert.equal((await readSession({ target })).target, null);
  }
  assert.equal(await readSession({ controller: { id: 1, windowId: 44, incognito: false } }), null);
});

test('normal launcher and reload contain no demo navigation or extension uninstall', async () => {
  for (const name of ['start-demo.mjs', 'reload-in-place.mjs']) {
    const source = await readFile(new URL(`../scripts/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /demo\.html|Extensions\.uninstall/);
  }
});

test('controller preparation derives its URL from the live extension, not empty or stale CDP metadata', async () => {
  const controllerUrl = 'chrome-extension://captain/popup.html?window=44';
  for (const url of ['', 'about:blank', 'chrome-extension://outdated/popup.html']) {
    const liveSession = await readSession({ url: controllerUrl });
    const target = { id: 'cdp-controller', url, webSocketDebuggerUrl: 'unused-in-unit-tests' };
    let focusCalls = 0;
    const ready = await prepareController(target, null, {
      evaluateTarget: async (_target, expression) => {
        if (expression === readSessionExpression) return liveSession;
        focusCalls++;
      },
      navigate: async () => { throw new Error('The already-committed controller must not be navigated again.'); },
    });
    assert.equal(ready.controller.url, controllerUrl);
    assert.equal(ready.controller.id, target.id);
    assert.equal(ready.windowId, 44);
    assert.equal(focusCalls, 1);
  }
});

test('first-launch controller migrates its live initial URL even when CDP target URL is empty', async () => {
  const liveSession = await readSession({ url: 'chrome-extension://captain/popup.html' });
  const target = { id: 'cdp-controller', url: '', webSocketDebuggerUrl: 'unused-in-unit-tests' };
  const calls = [];
  const ready = await prepareController(target, null, {
    evaluateTarget: async (_target, expression) => {
      if (expression === readSessionExpression) return liveSession;
      calls.push('focus');
    },
    navigate: async (actualTarget, url) => {
      assert.equal(actualTarget.id, target.id);
      assert.equal(url, 'chrome-extension://captain/popup.html?window=44');
      calls.push('committed');
      return { ...actualTarget, url };
    },
  });
  assert.deepEqual(calls, ['committed', 'focus']);
  assert.equal(ready.documentUrl, 'chrome-extension://captain/popup.html?window=44');
});

test('controller navigation awaits the committed extension document after CDP acknowledges', async () => {
  const target = { id: 'bootstrap', url: 'about:blank', webSocketDebuggerUrl: 'unused-in-unit-tests' };
  const url = 'chrome-extension://captain/popup.html';
  const calls = [];
  let commit;
  const committed = new Promise(resolve => { commit = resolve; });
  let completed = false;
  const pending = navigateController(target, url, {
    send: async (socket, method, params) => {
      assert.equal(socket, target.webSocketDebuggerUrl);
      assert.equal(method, 'Page.navigate');
      assert.deepEqual(params, { url });
      calls.push('acknowledged');
    },
    waitDocument: async (id, expectedUrl, requireExtension) => {
      assert.equal(id, target.id);
      assert.equal(expectedUrl, url);
      assert.equal(requireExtension, true);
      calls.push('waiting for commit');
      await committed;
      return { ...target, url };
    },
  }).then(result => { completed = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false);
  assert.deepEqual(calls, ['acknowledged', 'waiting for commit']);
  commit();
  assert.equal((await pending).url, url);
});
