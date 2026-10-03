import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const code = await readFile(new URL('../extension/content-script.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const rect = visible => ({ width: visible ? 180 : 0, height: visible ? 32 : 0, left: 10, top: 10, x: 10, y: 10, right: 190, bottom: 42 });

function link(href, title = 'Example official site', options = {}) {
  const heading = options.noHeading ? null : {
    innerText: title, textContent: title,
    getBoundingClientRect: () => rect(options.headingVisible !== false)
  };
  const element = {
    href, innerText: title, tagName: options.tagName || 'A', dataset: {}, isConnected: true,
    cite: options.cite === undefined ? null : {
      innerText: options.cite, textContent: options.cite,
      getBoundingClientRect: () => rect(options.citeVisible !== false)
    },
    clicks: 0, scrolls: 0,
    getAttribute: () => '', getBoundingClientRect: () => rect(options.visible !== false),
    querySelector(selector) { return selector === 'h3' ? heading : selector === 'cite' ? this.cite : null; },
    closest(selector) {
      if (selector === '#search, #rso') return options.organic === false ? null : {};
      if (selector.includes('#tads')) return options.sponsored ? {} : null;
      if (selector === 'a[href]') return this.tagName === 'A' && this.href ? this : null;
      return null;
    },
    scrollIntoView() { this.scrolls++; }, click() { this.clicks++; }
  };
  return element;
}

function page(nodes, url = 'https://www.google.com/search?q=example+official+website') {
  let listener;
  const parsed = new URL(url), host = {};
  const sandbox = {
    URL, innerWidth: 1000, innerHeight: 800, devicePixelRatio: 1,
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    location: { href: parsed.href, origin: parsed.origin, hostname: parsed.hostname, pathname: parsed.pathname },
    document: {
      images: [], title: 'Example - Google Search', body: { innerText: '' },
      querySelector: selector => selector === '#captain-agent-host' ? host : null,
      querySelectorAll: selector => selector === 'video,audio' ? [] : nodes
    },
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } }
  };
  vm.runInNewContext(code, sandbox);
  const send = message => new Promise(resolve => listener(message, {}, resolve));
  return { observe: () => send({ type: 'OBSERVE' }), execute: action => send({ type: 'EXECUTE', action }) };
}

test('organic discovery reuses observed element refs and omits query/fragment without mutating local links', async () => {
  const original = 'https://example.com/products?campaign=search&email=user%40example.com#details';
  const button = link('', 'Search', { tagName: 'BUTTON', noHeading: true });
  const result = link(original);
  const p = page([button, result]), observed = await p.observe();
  assert.deepEqual(plain(observed.searchResults), [{ ref: 'c2', title: 'Example official site', href: 'https://example.com/products' }]);
  assert.equal(observed.searchResults[0].ref, observed.elements[1].ref);
  assert.equal(result.dataset.captainRef, 'c2');
  assert.equal(result.href, original, 'Outbound redaction must not rewrite the local DOM destination');
  const opened = await p.execute({ type: 'click', target: { ref: 'c2' }, expectedHost: 'example.com' });
  assert.equal(opened.ok, true); assert.equal(opened.navigateUrl, original);
  assert.equal(result.clicks, 0, 'Navigation is returned for the same-tab worker executor, not clicked directly');
});

test('discovery excludes sponsored, invisible, non-heading, internal and unsafe result links', async () => {
  const candidates = [
    link('https://organic.example/', 'Organic official website'),
    link('https://sponsor.example/', 'Sponsor', { sponsored: true }),
    link('https://outside.example/', 'Outside results', { organic: false }),
    link('https://plain.example/', 'Unstructured link', { noHeading: true }),
    link('https://hidden.example/', 'Hidden anchor', { visible: false }),
    link('https://heading.example/', 'Hidden heading', { headingVisible: false }),
    link('https://not-anchor.example/', 'Heading button', { tagName: 'BUTTON' }),
    link('http://insecure.example/', 'HTTP website'),
    link('javascript:alert(1)', 'Script'),
    link('https://user:password@credentials.example/', 'Credentials'),
    link('https://www.google.com/preferences', 'Google preferences'),
    link('https://accounts.google.com/', 'Google account'),
    link('https://www.googleadservices.com/pagead/aclk', 'Advertising redirect'),
    link('https://ad.doubleclick.net/', 'Advertising link'),
    link('https://cache.googleusercontent.com/', 'Cached result'),
    link('https://empty.example/', '   '),
    link('not a valid URL', 'Broken link')
  ];
  assert.deepEqual(plain((await page(candidates).observe()).searchResults), [{ ref: 'c1', title: 'Organic official website', href: 'https://organic.example/' }]);
});

test('discovery withholds result titles and path URLs containing locally detected PII', async () => {
  const p = page([
    link('https://public.example/', 'Public website'),
    link('https://private.example/user/person@example.com', 'Private profile'),
    link('https://private.example/9876543210', 'Private phone page'),
    link('https://private.example/profile', 'Contact person@example.com'),
    link('https://private.example/person', 'Name: Someone Private')
  ]);
  assert.deepEqual(plain((await p.observe()).searchResults), [{ ref: 'c1', title: 'Public website', href: 'https://public.example/' }]);
});

test('structured discovery is restricted to Google search pages and deduplicates sanitized destinations', async () => {
  for (const url of ['https://www.google.com/', 'https://www.google.com/maps', 'https://example.com/search', 'https://www.google.com.evil.example/search']) {
    assert.deepEqual(plain((await page([link('https://example.com/')], url).observe()).searchResults), []);
  }
  const nodes = Array.from({ length: 14 }, (_, index) => link(`https://site${index}.example/`, `Site ${index}`));
  nodes.splice(1, 0, link('https://site0.example/?tracking=second', 'Repeated result'));
  const results = (await page(nodes).observe()).searchResults;
  assert.equal(results.length, 12);
  assert.equal(new Set(results.map(result => result.href)).size, 12);
  assert.equal(results[0].title, 'Site 0');
});

test('expectedHost rejects changed host, insecure and credentialed links before navigation', async () => {
  for (const changedUrl of ['https://other.example/', 'https://example.com.evil.example/', 'http://example.com/', 'https://user:secret@example.com/']) {
    const result = link('https://example.com/');
    const p = page([result]); await p.observe();
    result.href = changedUrl;
    const action = await p.execute({ type: 'click', target: { ref: 'c1' }, expectedHost: 'example.com' });
    assert.equal(action.ok, false, changedUrl);
    assert.match(action.error, /changed.*No navigation/i);
    assert.equal(action.navigateUrl, undefined); assert.equal(result.clicks, 0);
  }
});

test('disconnected observed refs cannot open a discovered website', async () => {
  const result = link('https://example.com/'), p = page([result]);
  await p.observe(); result.isConnected = false;
  const action = await p.execute({ type: 'click', target: { ref: 'c1' }, expectedHost: 'example.com' });
  assert.equal(action.ok, false); assert.match(action.error, /Target not found/);
  assert.equal(action.navigateUrl, undefined); assert.equal(result.clicks, 0); assert.equal(result.scrolls, 0);
});

test('wrapped organic links use only the visible HTTPS cite origin and keep wrappers local', async () => {
  for (const path of ['/goto?url=opaque-token&source=web', '/url?q=opaque-token']) {
    for (const cite of ['https://www.python.org', 'https://www.python.org › downloads › release…', 'https://www.python.org/downloads/…']) {
      const original = `https://www.google.com${path}`;
      const result = link(original, 'Welcome to Python.org', { cite });
      const p = page([result]), observed = await p.observe();
      assert.deepEqual(plain(observed.searchResults), [{ ref: 'c1', title: 'Welcome to Python.org', href: 'https://www.python.org/', source: 'displayed-origin' }], `${path}: ${cite}`);
      assert.equal(observed.elements[0].href, 'https://www.python.org/', 'The planner must see the same safe destination for the ref');
      assert.equal(result.href, original, 'The original opaque wrapper remains untouched in the page');
      assert.equal(JSON.stringify(observed).includes('opaque-token'), false, 'Opaque redirect data must not leave the local content script');
      const opened = await p.execute({ type: 'click', target: { ref: 'c1' }, expectedHost: 'www.python.org' });
      assert.equal(opened.ok, true); assert.equal(opened.navigateUrl, 'https://www.python.org/');
      assert.equal(result.clicks, 0, 'Do not follow the opaque wrapper');
    }
  }
});

test('wrapped discovery rejects absent, hidden, unsafe or ambiguous displayed origins and sponsored links', async () => {
  const candidates = [
    link('https://www.google.com/goto?url=opaque', 'Missing cite'),
    link('https://www.google.com/goto?url=opaque', 'Hidden cite', { cite: 'https://www.python.org', citeVisible: false }),
    link('https://www.google.com/goto?url=opaque', 'Malformed cite', { cite: 'not a URL' }),
    link('https://www.google.com/goto?url=opaque', 'HTTP cite', { cite: 'http://www.python.org' }),
    link('https://www.google.com/goto?url=opaque', 'Protocol-relative cite', { cite: '//www.python.org' }),
    link('https://www.google.com/goto?url=opaque', 'Scheme-less cite', { cite: 'www.python.org' }),
    link('https://www.google.com/goto?url=opaque', 'Credentialed cite', { cite: 'https://user:secret@www.python.org' }),
    link('https://www.google.com/goto?url=opaque', 'Ellipsis in origin', { cite: 'https://www.pyth…org/downloads' }),
    link('https://www.google.com/goto?url=opaque', 'ASCII ellipsis in origin', { cite: 'https://www.python...org/downloads' }),
    link('https://www.google.com/goto?url=opaque', 'Ad origin cite', { cite: 'https://www.googleadservices.com' }),
    link('https://www.google.com/goto?url=opaque', 'Sponsored wrapper', { cite: 'https://www.python.org', sponsored: true }),
    link('https://www.google.com/goto?url=opaque', 'Outside organic', { cite: 'https://www.python.org', organic: false }),
    link('https://www.google.com/preferences?url=opaque', 'Not a recognized wrapper', { cite: 'https://www.python.org' }),
    link('http://www.google.com/goto?url=opaque', 'Insecure wrapper', { cite: 'https://www.python.org' }),
    link('https://user:secret@www.google.com/goto?url=opaque', 'Credentialed wrapper', { cite: 'https://www.python.org' })
  ];
  assert.deepEqual(plain((await page(candidates).observe()).searchResults), []);
});

test('wrapped discovery rechecks both the original wrapper and visible cite before executing', async () => {
  const mutations = [
    result => { result.href = 'https://www.google.com/goto?url=different-opaque-token'; },
    result => { result.href = 'https://www.google.com/url?q=original-opaque-token'; },
    result => { result.href = 'https://www.python.org/'; },
    result => { result.cite.innerText = result.cite.textContent = 'https://other.example'; },
    result => { result.cite = null; },
    result => { result.cite.getBoundingClientRect = () => rect(false); }
  ];
  for (const mutate of mutations) {
    const result = link('https://www.google.com/goto?url=original-opaque-token', 'Welcome to Python.org', { cite: 'https://www.python.org' });
    const p = page([result]);
    const observed = await p.observe();
    assert.equal(observed.searchResults.length, 1);
    mutate(result);
    const opened = await p.execute({ type: 'click', target: { ref: 'c1' }, expectedHost: 'www.python.org' });
    assert.equal(opened.ok, false); assert.match(opened.error, /changed.*No navigation/i);
    assert.equal(opened.navigateUrl, undefined); assert.equal(result.clicks, 0);
  }
});
