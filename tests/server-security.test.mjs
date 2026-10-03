import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigin, createRateLimiter, isJsonRequest } from '../server/security.mjs';

test('server permits only its loopback UI and valid Chrome extension origins', () => {
  assert.equal(allowedOrigin(), true);
  assert.equal(allowedOrigin('http://127.0.0.1:4317'), true);
  assert.equal(allowedOrigin('http://localhost:4317'), true);
  assert.equal(allowedOrigin(`chrome-extension://${'a'.repeat(32)}`), true);
  for (const origin of ['https://evil.example', 'http://127.0.0.1:9999', 'chrome-extension://short', `chrome-extension://${'z'.repeat(32)}`]) assert.equal(allowedOrigin(origin), false);
});

test('rate limiter enforces its window and resets without retaining request data', () => {
  let clock = 1000;
  const check = createRateLimiter({ limit: 2, windowMs: 100, now: () => clock });
  assert.equal(check('client').allowed, true);
  assert.equal(check('client').allowed, true);
  assert.equal(check('client').allowed, false);
  assert.equal(check('other').allowed, true);
  clock += 101;
  assert.equal(check('client').allowed, true);
});

test('state-changing endpoints require JSON content type', () => {
  assert.equal(isJsonRequest({ 'content-type': 'application/json' }), true);
  assert.equal(isJsonRequest({ 'content-type': 'application/json; charset=utf-8' }), true);
  assert.equal(isJsonRequest({ 'content-type': 'text/plain' }), false);
});
