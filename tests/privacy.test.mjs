import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { redactText, payloadLeaks, validateSanitizedScreenshot } from '../server/privacy.mjs';
import { deterministicPlan, validatePlan } from '../server/planner.mjs';

test('open website finishes without typing the command into search', () => {
  const result = deterministicPlan('open YouTube', { url: 'https://www.youtube.com/', elements: [{ tag: 'input', name: 'Search', ref: 'c1' }] }, [{ action: { type: 'navigate' } }]);
  assert.equal(result.action.type, 'finish');
});
test('search selects editable input instead of search button', () => {
  const result = deterministicPlan('search for AI news', { elements: [{ tag: 'button', name: 'Search', ref: 'b' }, { tag: 'input', name: 'Search', ref: 'i' }] }, []);
  assert.equal(result.action.target.ref, 'i');
});
test('playback requires observed playing state', () => {
  const history = [{ action: { type: 'click' } }];
  assert.equal(deterministicPlan('play a song', { media: [{ paused: true, readyState: 4 }] }, history).action.type, 'media');
  assert.equal(deterministicPlan('play a song', { media: [{ paused: false, ended: false, readyState: 4 }] }, history).action.type, 'finish');
});
test('normal tabs are blocked before observation or network requests', async () => {
  let listener, saved, observed = false;
  const sandbox = { performance, setTimeout, AbortController, chrome: {
    runtime: { getURL: path => `chrome-extension://captain/${path}`, onMessage: { addListener(fn) { listener = fn; } } },
    storage: { session: { get: async () => ({}) }, sync: { get: async () => ({}) }, local: { set: async value => { saved = value.captainState; } } },
    tabs: { get: async () => ({ id: 1, incognito: false }), sendMessage: async () => { observed = true; } }
  } };
  vm.runInNewContext(await readFile(new URL('../extension/service-worker.js', import.meta.url), 'utf8'), sandbox);
  listener({ type: 'START_TASK', task: 'open YouTube' }, { tab: { id: 1 } }, () => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saved.status, 'error'); assert.match(saved.message, /Incognito/); assert.equal(observed, false);
});

test('redacts common Indian PII locally', () => {
  const out = redactText('Email me at person@example.com or +91 9876543210. PAN ABCDE1234F.');
  assert.equal(out.text.includes('person@example.com'), false);
  assert.deepEqual(out.counts, { email: 1, phone: 1, pan: 1 });
});

test('same-tab navigation waits for actual destination, not pending URL', async () => {
  const updates = []; let reads = 0;
  const sandbox = { URL, Date, setTimeout: fn => { fn(); }, chrome: {
    runtime: { onMessage: { addListener() {} } },
    tabs: {
      update: async (id, value) => updates.push({ id, ...value }),
      get: async () => ({ id: 7, incognito: true, status: ++reads < 3 ? 'loading' : 'complete', url: reads < 3 ? 'about:blank' : 'https://www.youtube.com/results?search_query=singer' })
    }
  } };
  vm.runInNewContext(await readFile(new URL('../extension/service-worker.js', import.meta.url), 'utf8'), sandbox);
  const result = await sandbox.navigateSameTab(7, 'https://www.youtube.com/results?search_query=singer');
  assert.equal(result.navigated, true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, 7);
  assert.ok(reads >= 3);
});

test('same-origin search navigation accepts a canonical URL only after the observed query matches', async () => {
  const updates = []; let reads = 0;
  const sandbox = { URL, Date, setTimeout: (fn, ms) => { if (ms !== 1200) fn(); return 1; }, clearTimeout() {}, chrome: {
    runtime: { onMessage: { addListener() {} } },
    tabs: {
      update: async (id, value) => updates.push({ id, ...value }),
      get: async () => ({ id: 8, incognito: true, status: ++reads < 2 ? 'loading' : 'complete', url: reads < 2 ? 'about:blank' : 'https://shop.example/search?q=laptop' }),
      sendMessage: async () => ({ url: 'https://shop.example/search', searchQuery: 'laptop', elements: [{ ref: 'c1' }] })
    }
  } };
  vm.runInNewContext(await readFile(new URL('../extension/service-worker.js', import.meta.url), 'utf8'), sandbox);
  const result = await sandbox.navigateSameTab(8, 'https://shop.example/find?field-keywords=laptop', { searchValue: 'laptop' });
  assert.equal(result.navigated, true);
  assert.equal(result.canonicalized, true);
  assert.equal(updates.length, 1);
});

test('submitted GET searches construct a same-origin URL without serializing hidden fields', async () => {
  const source = await readFile(new URL('../extension/content-script.js', import.meta.url), 'utf8');
  assert.match(source, /destination\.search = ''/);
  assert.match(source, /destination\.searchParams\.set\(el\.name, action\.value/);
  assert.match(source, /destination\.origin === location\.origin/);
  assert.doesNotMatch(source, /new FormData\(form\)/);
  for (const key of ['search_query', 'q', 'query', 'field-keywords', 'keyword', 'keywords', 'k', 'search']) assert.match(source, new RegExp(`'${key}'`));
});

test('outgoing context and history receive recursive local PII redaction', async () => {
  const sandbox = { chrome: { runtime: { onMessage: { addListener() {} } } } };
  vm.runInNewContext(await readFile(new URL('../extension/service-worker.js', import.meta.url), 'utf8'), sandbox);
  const result = sandbox.sanitizePayload({ task: 'email person@example.com', context: { title: '9876543210', value: 1.1234567890123 }, history: [{ message: 'ABCDE1234F' }] });
  assert.equal(payloadLeaks(result).length, 0);
  assert.equal(result.context.value, 1.123);
  assert.match(result.history[0].message, /REDACTED/);
});

test('privacy boundary refuses unverified screenshot uploads and blocks text PII', () => {
  assert.equal(payloadLeaks({ context: { screenshot: 'data:image/png;base64,abc', dom: 'safe' } })[0].kind, 'unverified_screenshot');
  assert.equal(payloadLeaks({ context: { dom: 'person@example.com' } }).length, 1);
});

test('privacy boundary accepts only a hash-bound JPEG with the exact local redaction proof', () => {
  const bytes = Buffer.alloc(120, 7); bytes[0] = 0xff; bytes[1] = 0xd8; bytes[2] = 0xff; bytes[118] = 0xff; bytes[119] = 0xd9;
  const screenshot = `data:image/jpeg;base64,${bytes.toString('base64')}`;
  const visualPrivacy = {
    schema: 'captain.visual-privacy.v1', sanitized: true, rawScreenshotTransmitted: false, redactionApplied: true,
    domBoxes: 2, faces: 1, inferenceMs: 12, totalMs: 30, outputBytes: bytes.length,
    faceModel: 'ultraface-rfb-320', modelSha256: 'd7c687949526065ab6a192fdf993360045ce27b0fabf7c9fca5c2437b786b495',
    imageSha256: createHash('sha256').update(bytes).digest('hex')
  };
  const context = { screenshot, visualPrivacy };
  assert.equal(validateSanitizedScreenshot(context).ok, true);
  assert.equal(payloadLeaks({ context }).length, 0);
  for (const changed of [
    { ...context, screenshot: screenshot.slice(0, -4) + 'AAAA' },
    { ...context, visualPrivacy: { ...visualPrivacy, sanitized: false } },
    { ...context, visualPrivacy: { ...visualPrivacy, rawScreenshotTransmitted: true } },
    { ...context, visualPrivacy: { ...visualPrivacy, modelSha256: '0'.repeat(64) } }
  ]) assert.equal(payloadLeaks({ context: changed })[0].kind, 'unverified_screenshot');
});

test('recursive sanitizer preserves only proof-bound visual byte and hash fields', async () => {
  const sandbox = { chrome: { runtime: { onMessage: { addListener() {} } } } };
  vm.runInNewContext(await readFile(new URL('../extension/service-worker.js', import.meta.url), 'utf8'), sandbox);
  const screenshot = 'data:image/jpeg;base64,12345678901234567890';
  const result = sandbox.sanitizePayload({ context: { screenshot, visualPrivacy: { imageSha256: '12345678901234567890', modelSha256: '12345678901234567890' }, pageText: 'person@example.com' } });
  assert.equal(result.context.screenshot, screenshot);
  assert.equal(result.context.visualPrivacy.imageSha256, '12345678901234567890');
  assert.match(result.context.pageText, /REDACTED/);
});

test('privacy boundary does not invent email addresses from JSON newline escapes', () => {
  assert.equal(payloadLeaks({ context: { pageText: 'Subscribe\n@channel.example' } }).length, 0);
  assert.equal(payloadLeaks({ context: { pageText: 'Subscribe\ncontact@channel.example' } })[0].kind, 'email');
});

test('validated visual integrity hashes are not misclassified as card numbers', () => {
  const payload = { context: { visualPrivacy: { imageSha256: `abc${'1'.repeat(16)}def`, modelSha256: `def${'2'.repeat(16)}abc`, schema: 'captain.visual-privacy.v1', faceModel: 'ultraface-rfb-320' } } };
  assert.deepEqual(payloadLeaks(payload), []);
});

test('numeric protocol geometry is not treated as a card number', () => {
  assert.deepEqual(payloadLeaks({ context: { elements: [{ bbox: { x: 12.12345678901234, y: 4.1234567890123 } }] } }), []);
});

test('fallback planner types into a search field', () => {
  const plan = deterministicPlan('find laptops under 50000', { elements: [{ ref: 'c1', name: 'Search products' }] }, []);
  assert.equal(plan.action.type, 'type');
  assert.equal(plan.action.target.ref, 'c1');
  assert.equal(validatePlan(plan), plan);
});

test('fallback planner decomposes open YouTube and search', () => {
  const first = deterministicPlan('Open YouTube and search for AI news', { url: 'https://example.com', elements: [] }, []);
  assert.deepEqual(first.action, { type: 'navigate', url: 'https://www.youtube.com' });
  const second = deterministicPlan('Open YouTube and search for AI news', { url: 'https://www.youtube.com/', elements: [{ ref: 'c8', name: 'Search' }] }, [{ action: first.action }]);
  assert.equal(second.action.type, 'type');
  assert.equal(second.action.value, 'AI news');
});

test('fallback planner supports wake phrase and direct controls', () => {
  assert.equal(deterministicPlan('Hey CAPTAIN, go back', { elements: [] }, []).action.type, 'back');
  assert.deepEqual(deterministicPlan('CAPTAIN: scroll down', { elements: [] }, []).action, { type: 'scroll', direction: 'down', amount: 650 });
  const click = deterministicPlan('click Refund', { elements: [{ ref: 'c4', tag: 'button', name: 'Request Refund' }] }, []);
  assert.deepEqual(click.action, { type: 'click', target: { ref: 'c4' } });
});

test('fallback planner turns a song request into YouTube steps', () => {
  const nav = deterministicPlan('Hey CAPTAIN, play Bohemian Rhapsody', { url: 'https://example.com', elements: [] }, []);
  assert.equal(nav.action.url, 'https://www.youtube.com');
  const type = deterministicPlan('Hey CAPTAIN, play Bohemian Rhapsody', { url: 'https://www.youtube.com/', elements: [{ ref: 'c2', name: 'Search' }] }, [{ action: nav.action }]);
  assert.deepEqual(type.action, { type: 'type', target: { ref: 'c2' }, value: 'Bohemian Rhapsody', submit: true });
  const click = deterministicPlan('Hey CAPTAIN, play Bohemian Rhapsody', { url: 'https://www.youtube.com/results', elements: [{ ref: 'c9', tag: 'a', href: 'https://www.youtube.com/watch', name: 'Bohemian Rhapsody' }] }, [{ action: nav.action }, { action: type.action }]);
  assert.deepEqual(click.action, { type: 'click', target: { ref: 'c9' } });
});
