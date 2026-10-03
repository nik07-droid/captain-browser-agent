import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceActionPrivacy } from '../extension/action-security.mjs';
import { validatePlan } from '../server/planner.mjs';
import { readFile } from 'node:fs/promises';

const elements = [
  { ref: 'c1', sensitive: true, sensitiveType: 'password' },
  { ref: 'c2', sensitive: false }
];

test('malicious remote value actions cannot target a sensitive field', () => {
  for (const type of ['type', 'select', 'press', 'submit']) {
    assert.throws(() => enforceActionPrivacy({ type, target: { ref: 'c1' }, value: 'NeverLogThis' }, elements), /local secure input/i);
  }
  assert.doesNotThrow(() => enforceActionPrivacy({ type: 'type', target: { ref: 'c2' }, value: 'public query' }, elements));
});

test('local secure input contains no credential value and requires a sensitive target', () => {
  assert.doesNotThrow(() => enforceActionPrivacy({ type: 'request_local_input', target: { ref: 'c1' }, inputType: 'password' }, elements));
  assert.throws(() => enforceActionPrivacy({ type: 'request_local_input', target: { ref: 'c2' }, inputType: 'password' }, elements), /sensitive field/i);
  assert.throws(() => enforceActionPrivacy({ type: 'request_local_input', target: { ref: 'c1' }, inputType: 'password', value: 'secret' }, elements), /must not contain/i);
});

test('planner validates only valueless local-input requests', () => {
  const plan = { action: { type: 'request_local_input', target: { ref: 'c1' }, inputType: 'otp' }, reason: 'Ask on device' };
  assert.equal(validatePlan(plan), plan);
  assert.throws(() => validatePlan({ action: { ...plan.action, value: '123456' } }), /must never contain/i);
});

test('page executor has a local secure UI and a second defensive sensitive-field block', async () => {
  const source = await readFile(new URL('../extension/content-script.js', import.meta.url), 'utf8');
  assert.match(source, /Local secure input/);
  assert.match(source, /Remote control of a sensitive field was blocked/);
  assert.match(source, /finish\(\{ ok: true, localOnly: true \}\)/);
  assert.doesNotMatch(source, /resolve\([^\n]*value/);
});
