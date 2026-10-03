import test from 'node:test';
import assert from 'node:assert/strict';
import { FailureReason, classifyFailure, classifyPageChange, recoveryStrategies } from '../server/recovery-policy.mjs';

const cases = [
  ['Target not found', FailureReason.ELEMENT_NOT_FOUND], ['stale detached node', FailureReason.STALE_ELEMENT],
  ['page still loading', FailureReason.PAGE_LOADING], ['navigation destination changed', FailureReason.NAVIGATION_CHANGED],
  ['network connection failed', FailureReason.NETWORK_ERROR], ['human verification CAPTCHA', FailureReason.CAPTCHA],
  ['429 rate limit', FailureReason.RATE_LIMIT], ['sponsored redirect', FailureReason.SPONSORED_RESULT],
  ['no qualifying product', FailureReason.NO_RESULT], ['malformed structured action', FailureReason.MODEL_INVALID],
  ['password sensitive field', FailureReason.PRIVATE_FIELD]
];
for (const [message, expected] of cases) test(`failure policy classifies ${expected}`, () => assert.equal(classifyFailure(message), expected));
test('CAPTCHA and rate limits never receive an automated bypass strategy', () => {
  assert.deepEqual(recoveryStrategies(FailureReason.CAPTCHA), ['HUMAN_HANDOFF']);
  assert.deepEqual(recoveryStrategies(FailureReason.RATE_LIMIT), ['STOP_AND_REPORT']);
  assert.ok(!recoveryStrategies(FailureReason.SPONSORED_RESULT).some(x => /bypass|click_sponsored/i.test(x)));
});
test('page change classification distinguishes stable, navigation, loading and blocked states', () => {
  const base = { url: 'https://example.com', pageMetadata: { domFingerprint: 'a', visibleTextHash: 'b', meaningfulContent: true } };
  assert.equal(classifyPageChange(base, base), 'NO_CHANGE');
  assert.equal(classifyPageChange(base, { ...base, url: 'https://example.com/next' }), 'NAVIGATION');
  assert.equal(classifyPageChange(base, { ...base, pageMetadata: { domFingerprint: 'c', visibleTextHash: 'd', meaningfulContent: false } }), 'LOADING');
  assert.equal(classifyPageChange(base, { ...base, challenge: { detected: true } }), 'BLOCKED');
});
