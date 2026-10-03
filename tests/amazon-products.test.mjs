import test from 'node:test';
import assert from 'node:assert/strict';
import { amazonDiagnostic, selectAmazonCandidates, verifyAmazonProductDetail } from '../server/amazon-products.mjs';

const product = (overrides = {}) => ({ asin: 'B0ABCDEF12', title: 'Atlas Laptop Intel Core i5 16 GB RAM 512 GB SSD Windows 11', price: 45990, currency: 'INR', rating: 4.3, ratingCount: 82, url: 'https://www.amazon.in/Atlas/dp/B0ABCDEF12/ref=sr_1_1', sponsored: false, position: 1, confidence: 1, ref: 'c12', bbox: { x: 20, y: 30, width: 400, height: 250 }, ...overrides });

test('A normal organic result qualifies', () => assert.equal(selectAmazonCandidates([product()], 50000).candidates.length, 1));
test('B sponsored results are rejected while organic results remain', () => {
  const result = selectAmazonCandidates([product({ sponsored: true }), product({ asin: 'B0ABCDEF13', url: 'https://www.amazon.in/dp/B0ABCDEF13', ref: 'c13' })], 50000);
  assert.equal(result.candidates.length, 1); assert.equal(result.rejected.sponsored, 1);
});
test('C missing price is rejected', () => assert.equal(selectAmazonCandidates([product({ price: null })], 50000).candidates.length, 0));
test('D missing ASIN is rejected', () => assert.equal(selectAmazonCandidates([product({ asin: '', url: '' })], 50000).candidates.length, 0));
test('E duplicate ASINs are merged by confidence', () => {
  const result = selectAmazonCandidates([product({ confidence: .7 }), product({ confidence: .95, ref: 'c18' })], 50000);
  assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].ref, 'c18');
});
test('F price above the threshold is rejected', () => assert.equal(selectAmazonCandidates([product({ price: 50001 })], 50000).candidates.length, 0));
test('G multiple qualifying products select the minimum price', () => {
  const result = selectAmazonCandidates([product(), product({ asin: 'B0ABCDEF13', url: 'https://www.amazon.in/dp/B0ABCDEF13', price: 39990, ref: 'c13' })], 50000);
  assert.equal(result.candidates[0].price, 39990);
});
test('H reordered products do not change the cheapest selection', () => {
  const cheap = product({ asin: 'B0ABCDEF13', url: 'https://www.amazon.in/dp/B0ABCDEF13', price: 39990, ref: 'c13' });
  assert.equal(selectAmazonCandidates([product(), cheap], 50000).candidates[0].asin, selectAmazonCandidates([cheap, product()], 50000).candidates[0].asin);
});
test('I delayed empty extraction produces zero qualifying candidates and safe diagnostics', () => {
  assert.equal(selectAmazonCandidates([], 50000).candidates.length, 0);
  assert.deepEqual(amazonDiagnostic([], 50000), { pageLoaded: true, candidatesFound: 0, candidatesWithAsin: 0, candidatesWithPrice: 0, organicCandidates: 0, qualifyingCandidates: 0, selectedAsin: '', selectedPrice: null, verificationPassed: false });
});
test('J malformed and advertising redirect URLs are rejected', () => {
  assert.equal(selectAmazonCandidates([product({ url: 'https://aax-eu.amazon.in/x/https://www.amazon.in/dp/B0ABCDEF12' })], 50000).candidates.length, 0);
});
test('K final product mismatch fails closed while exact identity, title and price pass', () => {
  const expected = { asin: 'B0ABCDEF12', title: product().title };
  assert.equal(verifyAmazonProductDetail(expected, { asin: 'B0WRONG123', title: product().title, price: 45990, url: 'https://www.amazon.in/dp/B0WRONG123' }, 50000).verified, false);
  assert.equal(verifyAmazonProductDetail(expected, { asin: expected.asin, title: product().title, price: 45990, url: 'https://www.amazon.in/dp/B0ABCDEF12' }, 50000).verified, true);
});
