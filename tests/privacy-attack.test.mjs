import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { redactText, payloadLeaks } from '../server/privacy.mjs';
import { validatePlan } from '../server/planner.mjs';
import { enforceActionPrivacy } from '../extension/action-security.mjs';

const attacks = [
  'attacker@example.com', '+91 9876543210', '4111 1111 1111 1111',
  'ABCDE1234F', '1234 5678 9012'
];

test('recognized email, phone, card, PAN and Aadhaar attacks are locally redacted', () => {
  for (const secret of attacks) {
    const sanitized = redactText(`public before ${secret} public after`).text;
    assert.ok(!sanitized.includes(secret));
    assert.deepEqual(payloadLeaks({ context: { pageText: sanitized } }), []);
  }
});

test('unsafe model output cannot type passwords, OTPs, cards or tokens', () => {
  for (const sensitiveType of ['password', 'otp', 'card', 'token']) {
    assert.throws(() => enforceActionPrivacy({ type: 'type', target: { ref: 'c1' }, value: 'exfiltrate-me' }, [{ ref: 'c1', sensitive: true, sensitiveType }]), /blocked/i);
  }
  assert.throws(() => validatePlan({ action: { type: 'request_local_input', target: { ref: 'c1' }, inputType: 'password', value: 'leak' } }), /never contain/i);
});

test('raw or unproved screenshots are rejected at the server privacy boundary', () => {
  assert.ok(payloadLeaks({ context: { screenshot: 'data:image/jpeg;base64,/9j/AA==' } }).some(item => item.kind === 'unverified_screenshot'));
});

test('sensitive local input implementation does not log or return the entered value', async () => {
  const source = await readFile(new URL('../extension/content-script.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*(?:input\.value|value)/);
  assert.match(source, /input\.value = ''/);
  assert.match(source, /localOnly: true/);
});
