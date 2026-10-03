import test from 'node:test';
import assert from 'node:assert/strict';
import { deterministicPlan, rankSearchResults, rankWebsiteResults } from '../server/planner.mjs';

const blank = { url: 'about:blank', elements: [] };
const queryUrl = name => `https://www.google.com/search?q=${encodeURIComponent(`${name} official website`)}`;
const result = (href = 'https://www.python.org/', title = 'Welcome to Python.org', ref = 'c1') => ({ ref, href, title });
const element = item => ({ ref: item.ref, href: item.href, tag: 'a', name: item.title });
const rank = (items, name = 'Python', elements = items.map(element)) => rankWebsiteResults(items, elements, name);
const resultsPage = (items, name = 'Python', overrides = {}) => ({ url: queryUrl(name), searchResults: items, elements: items.map(element), ...overrides });

test('unknown site names use discovery rather than inventing a domain', () => {
  for (const name of ['Python', 'Mozilla', 'National Geographic']) {
    const plan = deterministicPlan(`open ${name}`, blank);
    assert.equal(plan.action.type, 'navigate');
    assert.equal(plan.action.url, queryUrl(name));
    assert.equal(new URL(plan.action.url).hostname, 'www.google.com');
  }
});

test('one strong title-and-ownership-domain match selects only its observed link ref', () => {
  const items = [result('https://www.python.org/', 'Welcome to Python.org', 'c21')];
  assert.equal(rank(items).length, 1);
  const plan = deterministicPlan('open Python', resultsPage(items));
  assert.deepEqual(plan.action, { type: 'click', target: { ref: 'c21' }, expectedHost: 'www.python.org' });
  assert.equal(plan.intent, 'website-discovery');
});

test('discovery requires both title and ownership label rather than either alone', () => {
  assert.deepEqual(rank([result('https://www.python.org/', 'Unrelated product')]), []);
  assert.deepEqual(rank([result('https://www.unrelated.org/', 'Python official website')]), []);
  assert.deepEqual(rank([result('https://python.evil.com/', 'Python official website')]), []);
  assert.deepEqual(rank([result('https://evilpython.org/', 'Python official website')]), []);
  assert.deepEqual(rank([result('https://python.tools.example.com/', 'Python official website')]), []);
  assert.equal(rank([result('https://www.python.co.uk/', 'Python official website')]).length, 1);
});

test('multiword brand matching permits compact ownership labels without substring title matches', () => {
  assert.equal(rank([result('https://www.nationalgeographic.com/', 'National Geographic')], 'National Geographic').length, 1);
  assert.deepEqual(rank([result('https://www.nationalgeographic.com/', 'National Geographical Games')], 'National Geographic'), []);
  assert.deepEqual(rank([result('https://www.python.org/', 'Pythons official website')]), []);
});

test('candidate must reference an enabled observed anchor', () => {
  const item = result();
  for (const observed of [[], [{ ...element(item), ref: 'c2' }], [{ ...element(item), tag: 'button' }], [{ ...element(item), disabled: true }]]) {
    assert.deepEqual(rank([item], 'Python', observed), []);
  }
  for (const ref of ['', 'other', 'c1-script', 'c-1']) assert.deepEqual(rank([result(undefined, undefined, ref)]), []);
});

test('result URL must be identical to the URL belonging to its observed ref', () => {
  const item = result();
  for (const href of ['https://evil.org/', 'https://www.python.org/downloads/', 'http://www.python.org/', 'https://www.python.org:8443/', 'https://www.python.org/?next=changed', 'https://www.python.org/#changed']) {
    assert.deepEqual(rank([item], 'Python', [{ ...element(item), href }]), [], href);
  }
});

test('advertised and sponsored candidates never qualify', () => {
  for (const flag of ['ad', 'isAd', 'sponsored']) assert.deepEqual(rank([{ ...result(), [flag]: true }]), []);
});

test('malformed, non-HTTPS, credentialed and port-specific destinations never qualify', () => {
  for (const href of ['not a url', 'http://python.org/', 'javascript:alert(1)', 'data:text/html,Python', 'file:///python', 'https://user:secret@python.org/', 'https://python.org:8443/']) {
    assert.deepEqual(rank([result(href)]), [], href);
  }
});

test('private, loopback, IP and reserved hostname candidates never qualify', () => {
  for (const href of ['https://localhost/', 'https://python.local/', 'https://python.internal/', 'https://python.test/', 'https://python.invalid/', 'https://python.example/', 'https://127.0.0.1/', 'https://192.168.1.5/', 'https://[::1]/']) {
    assert.deepEqual(rank([result(href)]), [], href);
  }
});

test('PII in discovery names, titles or URLs is withheld instead of becoming a candidate', () => {
  assert.deepEqual(rank([result()], 'Python person@example.com'), []);
  assert.deepEqual(rank([result(undefined, 'Python contact person@example.com')]), []);
  assert.deepEqual(rank([result('https://python.org/person@example.com')]), []);
  assert.deepEqual(rank([result('https://python.org/person%40example.com')]), []);
  assert.deepEqual(rank([result('https://python.org/9876543210')]), []);
  const plan = deterministicPlan('open Python person@example.com', blank);
  assert.equal(plan.action.clarification, true);
  assert.notEqual(plan.action.type, 'navigate');
});

test('multiple eligible hosts ask the user to choose rather than clicking the first', () => {
  const items = [result('https://python.org/'), result('https://python.com/', 'Python', 'c2')];
  const plan = deterministicPlan('open Python', resultsPage(items));
  assert.equal(plan.action.type, 'finish');
  assert.equal(plan.action.clarification, true);
  assert.match(plan.action.message, /python\.org/);
  assert.match(plan.action.message, /python\.com/);
  assert.equal(plan.action.followUpPrefix, 'open ');
});

test('multiple results for one logical host are one website candidate', () => {
  const items = [result('https://python.org/'), result('https://www.python.org/downloads/', 'Python Downloads', 'c2')];
  assert.equal(rank(items).length, 1);
  assert.equal(rank(items)[0].ref, 'c1');
  assert.equal(rank([...items].reverse())[0].ref, 'c1');
  assert.equal(deterministicPlan('open Python', resultsPage(items)).action.type, 'click');
});

test('candidate payloads exclude query/hash metadata and invalid encoded paths', () => {
  for (const href of ['https://python.org/?tracking=value', 'https://python.org/#section', 'https://python.org/%FF', 'https://python.org/%']) {
    assert.deepEqual(rank([result(href)]), [], href);
  }
});

test('repeating a command on its current search results uses fresh grounded results without prior history', () => {
  const items = [result()];
  assert.equal(deterministicPlan('open Python', resultsPage(items), []).action.type, 'click');
  // A same-label link alone is not an extracted non-ad result and cannot become
  // the generic exact-label "open" fallback on this search page.
  const ungrounded = resultsPage([], 'Python', { elements: [{ ref: 'c2', tag: 'a', name: 'Python', href: 'https://python.evil.com/' }] });
  const step = deterministicPlan('open Python', ungrounded, []);
  assert.equal(step.action.type, 'wait');
  assert.equal(step.intent, 'website-discovery');
});

test('wrong search query and lookalike search-engine hosts cannot supply discovery links', () => {
  const items = [result()];
  for (const url of [queryUrl('Something else'), 'https://google.com.evil.net/search?q=Python', 'https://www.google.com/']) {
    const plan = deterministicPlan('open Python', resultsPage(items, 'Python', { url }));
    assert.equal(plan.action.type, 'navigate');
    assert.equal(plan.action.url, queryUrl('Python'));
  }
});

test('empty results wait and scroll only a bounded number of times before honest clarification', () => {
  const context = resultsPage([]), history = [];
  for (const type of ['wait', 'wait', 'scroll', 'scroll']) {
    const step = deterministicPlan('open Python', context, history);
    assert.equal(step.action.type, type);
    assert.equal(step.intent, 'website-discovery');
    history.push({ ...step, result: { ok: true } });
  }
  const plan = deterministicPlan('open Python', context, history);
  assert.equal(plan.action.type, 'finish');
  assert.equal(plan.action.clarification, true);
  assert.match(plan.action.message, /not the website itself/);
});

test('discovery completion requires successful navigation and an actually observed exact expected host', () => {
  const click = deterministicPlan('open Python', resultsPage([result()]));
  const context = { ...blank, url: 'https://www.python.org/', title: 'Python' };
  const success = deterministicPlan('open Python', context, [{ ...click, result: { ok: true, navigated: true } }]);
  assert.equal(success.action.type, 'finish');
  assert.notEqual(success.action.clarification, true);
  assert.match(success.action.message, /www\.python\.org/);
  for (const result of [{}, { ok: true }, { ok: false, navigated: true }, { ok: true, navigated: false }]) {
    assert.equal(deterministicPlan('open Python', context, [{ ...click, result }]).action.clarification, true);
  }
  for (const url of ['about:blank', queryUrl('Python'), 'https://www.python.org.evil.com/', 'https://python.org/', 'https://python.evil.com/']) {
    assert.equal(deterministicPlan('open Python', { ...context, url }, [{ ...click, result: { ok: true, navigated: true } }]).action.clarification, true, url);
  }
});

test('a discovery sign-in page is reported as requiring manual sign-in, not account access', () => {
  const click = deterministicPlan('open Python', resultsPage([result()]));
  const plan = deterministicPlan('open Python', { ...blank, url: 'https://www.python.org/login', title: 'Sign in to Python' }, [{ ...click, result: { ok: true, navigated: true } }]);
  assert.match(plan.action.message, /sign in yourself/);
  assert.match(plan.action.message, /Verify its address/);
});

test('explicit search-and-open uses a freshly observed organic result and verifies its destination', () => {
  const query = 'CAPTAIN browser agent';
  const item = { ref: 'c7', title: 'CAPTAIN browser agent', href: 'https://captain.example.org/project' };
  const elementItem = { ...item, tag: 'a', name: item.title };
  const first = deterministicPlan(`search for ${query} and open it`, blank);
  assert.equal(first.action.url, `https://www.google.com/search?q=${encodeURIComponent(query)}`);
  const results = { url: first.action.url, searchQuery: query, searchResults: [item], elements: [elementItem] };
  const click = deterministicPlan(`search for ${query} and open it`, results, [{ ...first, result: { ok: true, navigated: true } }]);
  assert.deepEqual(click.action, { type: 'click', target: { ref: 'c7' }, expectedHost: 'captain.example.org' });
  assert.equal(click.intent, 'search-open');
  const done = deterministicPlan(`search for ${query} and open it`, { url: item.href, elements: [] }, [{ ...click, result: { ok: true, navigated: true } }]);
  assert.equal(done.action.type, 'finish');
  assert.match(done.action.message, /captain\.example\.org/);
});

test('open first result works only on current results and rejects unsafe candidates', () => {
  const query = 'privacy browser';
  const safe = { ref: 'c2', title: 'Privacy browser', href: 'https://privacybrowser.org/' };
  const context = { url: `https://www.google.com/search?q=${encodeURIComponent(query)}`, searchQuery: query, searchResults: [safe], elements: [{ ...safe, tag: 'a' }] };
  assert.equal(deterministicPlan('open the first result', context).action.target.ref, 'c2');
  for (const href of ['http://privacybrowser.org/', 'https://user:secret@privacybrowser.org/', 'https://privacybrowser.org/?track=1', 'https://localhost/']) {
    const bad = { ...safe, href };
    assert.deepEqual(rankSearchResults([bad], [{ ...bad, tag: 'a' }]), [], href);
  }
  assert.equal(deterministicPlan('open the first result', blank).action.clarification, true);
});
