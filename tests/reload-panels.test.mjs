import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { panelTargetsExpression, reconnectPanelExpression, reconnectPanels } from '../scripts/reload-in-place.mjs';

const controller = { id: 1, windowId: 44, incognito: true };
const session = { windowId: 44, controller: { webSocketDebuggerUrl: 'unused-in-unit-tests' } };
const plain = value => JSON.parse(JSON.stringify(value));

function browser({ tabs = [], current = controller, inject = async () => {} } = {}) {
  const injections = [];
  const chrome = {
    tabs: {
      getCurrent: async () => current,
      query: async ({ windowId }) => {
        assert.equal(windowId, current.windowId);
        // Include wrong-window entries to test the helper's defensive filter.
        return tabs;
      },
      get: async id => {
        const tab = tabs.find(tab => tab.id === id);
        if (!tab) throw new Error('No tab with id');
        return tab;
      },
    },
    scripting: {
      executeScript: async options => {
        injections.push(plain(options));
        await inject(options.target.tabId);
        return [{ frameId: 0 }];
      },
    },
  };
  const evaluateTarget = async (_target, expression, timeoutMs) => {
    assert.equal(timeoutMs, 8000);
    return vm.runInNewContext(expression, { chrome });
  };
  return { chrome, injections, evaluateTarget };
}

test('panel recovery excludes normal-profile, other-window and internal tabs', async () => {
  const b = browser({ tabs: [
    { id: 2, windowId: 44, incognito: true, url: 'https://www.youtube.com/' },
    { id: 3, windowId: 44, incognito: true, url: 'http://example.com/form' },
    { id: 4, windowId: 44, incognito: false, url: 'https://example.com/' },
    { id: 5, windowId: 45, incognito: true, url: 'https://example.com/' },
    { id: 6, windowId: 44, incognito: true, url: 'chrome://newtab/' },
    { id: 7, windowId: 44, incognito: true, url: 'about:blank' },
    { id: 8, windowId: 44, incognito: true, url: 'chrome-extension://captain/popup.html' },
    { id: 9, windowId: 44, incognito: true, url: 'file:///private/file.html' },
  ] });
  const result = await reconnectPanels(session, b);
  assert.equal(result.injected, 2);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(b.injections, [2, 3].map(tabId => ({ target: { tabId, frameIds: [0] }, files: ['content-script.js'] })));
  // No tabs.update/reload/create or Page.navigate API exists in this harness.
});

test('panel recovery refuses a normal-profile controller or a changed controller window', async () => {
  const normal = browser({ current: { ...controller, incognito: false } });
  await assert.rejects(reconnectPanels(session, normal), /Incognito controller/);
  assert.equal(normal.injections.length, 0);
  const moved = browser({ current: { ...controller, windowId: 99 } });
  await assert.rejects(reconnectPanels(session, moved), /window changed/);
  assert.equal(moved.injections.length, 0);
});

test('every target is revalidated immediately before injection', async () => {
  for (const tab of [
    { id: 2, windowId: 44, incognito: false, url: 'https://example.com/' },
    { id: 2, windowId: 99, incognito: true, url: 'https://example.com/' },
    { id: 2, windowId: 44, incognito: true, url: 'chrome://settings/' },
  ]) {
    const b = browser({ tabs: [tab] });
    const result = await b.evaluateTarget(session.controller, reconnectPanelExpression(2, 44), 8000);
    assert.equal(result.status, 'skipped');
    assert.equal(b.injections.length, 0);
  }
  assert.throws(() => reconnectPanelExpression('2', 44), /valid tab and window IDs/);
});

test('injection failures are reported per tab without retrying or blocking other tabs', async () => {
  const b = browser({
    tabs: [2, 3, 4].map(id => ({ id, windowId: 44, incognito: true, url: 'https://example.com/' })),
    inject: async id => { if (id === 3) throw new Error('Cannot access contents of the page'); },
  });
  const result = await reconnectPanels(session, b);
  assert.equal(result.injected, 2);
  assert.deepEqual(result.errors, [{ tabId: 3, error: 'Cannot access contents of the page' }]);
  assert.equal(b.injections.filter(options => options.target.tabId === 3).length, 1);
});

test('panel recovery uses bounded concurrency and retains all per-tab results', async () => {
  let running = 0, peak = 0;
  const b = browser({
    tabs: Array.from({ length: 10 }, (_, i) => ({ id: i + 2, windowId: 44, incognito: true, url: 'https://example.com/' })),
    inject: async () => {
      peak = Math.max(peak, ++running);
      await new Promise(resolve => setTimeout(resolve, 5));
      running--;
    },
  });
  const result = await reconnectPanels(session, b);
  assert.equal(peak, 3);
  assert.equal(result.injected, 10);
  assert.equal(result.tabs.length, 10);
});

test('panel recovery handles an empty window without creating a website tab', async () => {
  const b = browser();
  const result = await reconnectPanels(session, b);
  assert.deepEqual(result, { windowId: 44, injected: 0, skipped: 0, errors: [], tabs: [] });
});

test('tab-list expression never trusts a URL window parameter', async () => {
  const b = browser({ tabs: [{ id: 2, windowId: 44, incognito: true, url: 'https://example.com/' }] });
  const result = await vm.runInNewContext(panelTargetsExpression, { chrome: b.chrome, location: { href: 'chrome-extension://captain/popup.html?window=99' } });
  assert.deepEqual(plain(result), { windowId: 44, tabIds: [2] });
});
