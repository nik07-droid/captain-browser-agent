import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const code = await readFile(new URL('../extension/content-script.js', import.meta.url), 'utf8');
function harness(media) {
  let listener;
  const host = { shadowRoot: { querySelector: () => null } };
  const sandbox = { innerWidth: 1000, innerHeight: 800, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }), location: { origin: 'https://www.youtube.com', hostname: 'www.youtube.com' }, document: { visibilityState: 'visible', querySelector: () => host, querySelectorAll: () => media }, chrome: { runtime: { onMessage: { addListener: fn => { listener = fn; } } } }, setTimeout: fn => { fn(); }, clearTimeout() {} };
  vm.runInNewContext(code, sandbox);
  return action => new Promise(resolve => listener({ type: 'EXECUTE', action }, {}, resolve));
}
const video = (extra = {}) => ({ currentSrc: 'blob:main', paused: true, ended: false, readyState: 0, getBoundingClientRect: () => ({ width: 640, height: 360, top: 0, left: 0, right: 640, bottom: 360 }), closest: () => ({}), ...extra });
test('pending play promise is reused instead of starting playback repeatedly', async () => {
  let calls = 0;
  const main = video({ play: () => { calls++; return new Promise(() => {}); } });
  const send = harness([main]);
  assert.equal((await send({ type: 'media', operation: 'play' })).ok, true);
  assert.equal((await send({ type: 'media', operation: 'play' })).ok, true);
  assert.equal(calls, 1);
});
test('unpaused buffering media is observed without another play call', async () => {
  const main = video({ paused: false, play() { throw new Error('Must not call play'); } });
  assert.match((await harness([main])({ type: 'media', operation: 'play' })).pending, /buffering/);
});
test('primary sourced player is chosen over the empty first video', async () => {
  let paused = false;
  const empty = video({ currentSrc: '', getBoundingClientRect: () => ({ width: 0, height: 0 }), pause() { throw new Error('Wrong player'); } });
  const main = video({ pause() { paused = true; } });
  assert.equal((await harness([empty, main])({ type: 'media', operation: 'pause' })).ok, true);
  assert.equal(paused, true);
});
