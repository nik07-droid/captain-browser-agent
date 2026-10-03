import test from 'node:test';
import assert from 'node:assert/strict';
import { ResultVerifier } from '../server/result-verifier.mjs';

const verifier = new ResultVerifier();

test('generic verifier binds host, identifier, title and numeric constraints', () => {
  const result = verifier.verifyTask({
    expected: { host: 'amazon.in', pathPattern: '/dp/', identifier: 'B0ABCDEFGH', title: 'Atlas Laptop' },
    context: { url: 'https://www.amazon.in/atlas/dp/B0ABCDEFGH', title: 'Atlas Laptop', pageText: 'Atlas Laptop 16GB' },
    constraint: { maxPrice: 50000, minRating: 4 }, observed: { price: 43990, rating: 4.4 }
  });
  assert.deepEqual(result, { verified: true, reason: 'final-state-verified' });
});

test('generic verifier fails closed for wrong destinations, constraints and uncleared challenges', () => {
  assert.equal(verifier.verifyTarget({ host: 'example.com' }, { url: 'https://lookalike.invalid/' }).verified, false);
  assert.equal(verifier.verifyConstraint({ maxPrice: 50000 }, { price: 50001 }).verified, false);
  assert.deepEqual(verifier.verifyFinalState({}, { url: 'https://example.com', challenge: { detected: true } }, {}, {}), { verified: false, reason: 'human-verification-still-present' });
});
