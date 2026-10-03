import test from 'node:test';
import assert from 'node:assert/strict';
import { deterministicPlan } from '../server/planner.mjs';

const task = 'Find me the cheapest laptop under ₹50,000';
const base = { pageText: '', elements: [
  { ref: 'c1', tag: 'input', name: 'Search products', value: '' },
  { ref: 'c2', tag: 'select', name: 'Product category All categories Laptops Tablets', value: 'all' },
  { ref: 'c3', tag: 'input', name: 'Maximum price 80000', value: '80000' },
  { ref: 'c4', tag: 'select', name: 'Sort products Featured Price low to high', value: 'featured' }
] };

test('shopping plan uses observed controls then chooses the cheapest qualifying card', () => {
  const search = deterministicPlan(task, base); assert.deepEqual(search.action, { type: 'type', target: { ref: 'c1' }, value: 'laptop', submit: true });
  const category = deterministicPlan(task, { ...base, elements: base.elements.map(el => el.ref === 'c1' ? { ...el, value: 'laptop' } : el) }); assert.equal(category.action.type, 'select'); assert.equal(category.action.value, 'laptop');
  const price = deterministicPlan(task, { ...base, elements: base.elements.map(el => el.ref === 'c1' ? { ...el, value: 'laptop' } : el.ref === 'c2' ? { ...el, value: 'laptop' } : el) }); assert.equal(price.action.value, '50000');
  const filtered = { ...base, elements: [
    { ...base.elements[0], value: 'laptop' }, { ...base.elements[1], value: 'laptop' }, { ...base.elements[2], value: '50000' }, { ...base.elements[3], value: 'price-asc' },
    { ref: 'c5', tag: 'button', name: 'View Nova', groupText: 'LAPTOP Nova ₹49,499' },
    { ref: 'c6', tag: 'button', name: 'View Atlas', groupText: 'LAPTOP Atlas ₹43,990' },
    { ref: 'c7', tag: 'button', name: 'View tablet', groupText: 'TABLET Slate ₹32,990' }
  ] };
  assert.equal(deterministicPlan(task, filtered).action.target.ref, 'c6');
});

test('shopping completion is based on observed product detail and price', () => {
  const result = deterministicPlan(task, { pageText: 'Selected product: Atlas Lite\n₹43,990\nProduct detail verified.', elements: [] });
  assert.equal(result.action.type, 'finish'); assert.match(result.action.message, /Atlas Lite/); assert.match(result.action.message, /43,990/);
});

test('Amazon shopping stays in one grounded flow and compares observed product links', () => {
  const amazonTask = 'Open Amazon and find the cheapest laptop under ₹50,000';
  const open = deterministicPlan(amazonTask, { url: 'about:blank', pageText: '', elements: [] });
  assert.equal(open.action.url, 'https://www.amazon.in');

  const search = deterministicPlan(amazonTask, { url: 'https://www.amazon.in/', pageText: '', searchQuery: '', elements: [
    { ref: 'c1', tag: 'input', name: 'Search Amazon.in', value: '', sensitive: false }
  ] }, [{ action: open.action, result: { ok: true, navigated: true }, intent: open.intent }]);
  assert.deepEqual(search.action, { type: 'type', target: { ref: 'c1' }, value: 'laptop', submit: true });

  const priceBand = deterministicPlan(amazonTask, { url: 'https://www.amazon.in/s', pageText: 'results', searchQuery: 'laptop', elements: [
    { ref: 'c8', tag: 'input', type: 'range', name: 'Maximum price 189', value: '189' },
    { ref: 'c9', tag: 'a', name: 'Up to ₹44,500', groupText: 'Up to ₹44,500', href: 'https://www.amazon.in/s' }
  ] }, [{ action: search.action, result: { ok: true }, intent: search.intent }]);
  assert.equal(priceBand.action.type, 'click');
  assert.equal(priceBand.action.target.ref, 'c9');
  assert.equal(priceBand.intent, 'shopping-amazon-price');

  const sort = deterministicPlan(amazonTask, { url: 'https://www.amazon.in/s', pageText: 'results', searchQuery: 'laptop', elements: [
    { ref: 'c20', tag: 'select', name: 'Sort by Featured Price: Low to High', value: 'featured', state: { options: [{ text: 'Featured', value: 'featured' }, { text: 'Price: Low to High', value: 'price-asc-rank' }] } }
  ] }, [{ action: search.action, result: { ok: true }, intent: search.intent }]);
  assert.deepEqual(sort.action, { type: 'select', target: { ref: 'c20' }, value: 'price-asc-rank' });
  assert.equal(sort.intent, 'shopping-amazon-sort');

  const products = [
    { ref: 'c10', asin: 'B0ABCDEFGH', title: 'Nova Laptop 8 GB RAM 512 GB SSD', price: 49499, currency: 'INR', url: 'https://www.amazon.in/dp/B0ABCDEFGH', confidence: 1, sponsored: false },
    { ref: 'c11', asin: 'B0JKLMNOPQ', title: 'Atlas Laptop 16 GB RAM 512 GB SSD', price: 43990, currency: 'INR', url: 'https://www.amazon.in/dp/B0JKLMNOPQ', confidence: 1, sponsored: false },
    { ref: 'c12', asin: 'B0ACCESSRY', title: 'Laptop bag', price: 999, currency: 'INR', url: 'https://www.amazon.in/dp/B0ACCESSRY', confidence: 1, sponsored: false }
  ];
  const choose = deterministicPlan(amazonTask, { url: 'https://www.amazon.in/s', pageText: 'results', searchQuery: 'laptop', elements: [], amazonProducts: products }, [
    { action: open.action, result: { ok: true, navigated: true }, intent: open.intent },
    { action: search.action, result: { ok: true }, intent: search.intent },
    { action: priceBand.action, result: { ok: true, navigated: true }, intent: priceBand.intent }
  ]);
  assert.equal(choose.action.type, 'click');
  assert.equal(choose.action.target.ref, 'c11');
  assert.equal(choose.action.expectedAsin, 'B0JKLMNOPQ');
  assert.equal(choose.action.compared.length, 2);

  const finish = deterministicPlan(amazonTask, { url: 'https://www.amazon.in/dp/B0JKLMNOPQ', pageText: 'Atlas Laptop', elements: [], amazonProductDetail: { asin: 'B0JKLMNOPQ', title: 'Atlas Laptop 16 GB RAM 512 GB SSD', price: 43990, currency: 'INR', url: 'https://www.amazon.in/dp/B0JKLMNOPQ' } }, [
    { action: choose.action, result: { ok: true, navigated: true }, intent: choose.intent }
  ]);
  assert.equal(finish.action.type, 'finish');
  assert.match(finish.action.message, /Atlas Laptop/);
  assert.match(finish.reason, /ASIN/);
});

test('Amazon completion fails closed when the final ASIN does not match', () => {
  const task = 'Open Amazon and find a laptop under ₹50,000';
  const result = deterministicPlan(task, { url: 'https://www.amazon.in/dp/B0WRONGASIN', pageText: '', elements: [] }, [{
    intent: 'shopping-amazon-product',
    action: { type: 'click', target: { ref: 'c8' }, expectedAsin: 'B0EXPECTED1', expectedTitle: 'Expected Laptop', expectedPrice: 45000 },
    result: { ok: true, navigated: true }
  }]);
  assert.equal(result.action.type, 'back');
  assert.match(result.reason, /mismatch/i);
});
