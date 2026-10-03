import test from 'node:test';
import assert from 'node:assert/strict';
import { deterministicPlan } from '../server/planner.mjs';
import { namedSite, SITES } from '../server/sites.mjs';

const blank = { url: 'about:blank', elements: [] };
const youtube = { url: 'https://www.youtube.com/', site: 'youtube', elements: [{ ref: 'c1', tag: 'input', name: 'Search' }] };
const page = { url: 'https://example.com/', elements: [{ ref: 'c2', tag: 'input', name: 'Search' }] };
const searchUrl = query => `https://www.google.com/search?q=${encodeURIComponent(query)}`;

test('exact Spotify commands open the official player from blank, YouTube, and another page', () => {
  for (const context of [blank, youtube, page]) {
    for (const task of ['open Spotify', 'hey captain, search spotify', 'search for Spotify', 'find Spotify website', 'look up the Spotify site']) {
      assert.deepEqual(deterministicPlan(task, context).action, { type: 'navigate', url: 'https://open.spotify.com/' }, task);
    }
  }
});

test('curated destinations and spoken aliases use exact known names only', () => {
  for (const [name, url] of Object.entries(SITES)) assert.equal(deterministicPlan(`open ${name}`, blank).action.url, url);
  for (const [alias, name] of [['spot ify', 'spotify'], ['net flix', 'netflix'], ['face book', 'facebook'], ['whats app', 'whatsapp'], ['duck duck go', 'duckduckgo'], ['stack overflow', 'stackoverflow']]) {
    assert.equal(deterministicPlan(`search for ${alias}`, youtube).action.url, SITES[name]);
  }
  assert.equal(namedSite('Spotify premium price'), null);
  assert.equal(namedSite('spotify.evil.example'), null);
});

test('longer queries remain queries rather than opening a mentioned brand', () => {
  assert.equal(deterministicPlan('search for Spotify premium price', blank).action.url, searchUrl('Spotify premium price'));
  assert.equal(deterministicPlan('search Spotify premium price', youtube).action.url, 'https://www.youtube.com/results?search_query=Spotify%20premium%20price');
  assert.equal(deterministicPlan('find Spotify premium price', page).action.value, 'Spotify premium price');
});

test('explicit YouTube search scope takes precedence over brand shortcuts', () => {
  assert.equal(deterministicPlan('search Spotify on YouTube', blank).action.url, SITES.youtube);
  for (const task of ['search Spotify on YouTube', 'search for Spotify on you tube', 'find Spotify on YouTube']) {
    const first = deterministicPlan(task, youtube);
    assert.equal(first.action.url, 'https://www.youtube.com/results?search_query=Spotify');
    assert.equal(deterministicPlan(task, { ...youtube, searchQuery: 'Spotify' }, [{ action: first.action }]).action.type, 'finish');
  }
});

test('explicit current-page scope strips its suffix and never opens the named brand', () => {
  for (const suffix of ['on this page', 'on this website', 'on current website']) {
    const task = `search Spotify ${suffix}`;
    assert.equal(deterministicPlan(task, page).action.value, 'Spotify');
    assert.equal(deterministicPlan(task, youtube).action.url, 'https://www.youtube.com/results?search_query=Spotify');
    assert.equal(deterministicPlan(task, blank).action.clarification, true);
  }
});

test('web and Google scope bypass the current YouTube and page search controls', () => {
  for (const context of [blank, youtube, page]) {
    for (const task of ['search the web for Spotify', 'search internet for Spotify', 'search Spotify on Google', 'find Spotify on Google']) {
      assert.equal(deterministicPlan(task, context).action.url, searchUrl('Spotify'), task);
      assert.equal(deterministicPlan(task, { ...blank, url: searchUrl('Spotify') }).action.type, 'finish');
    }
  }
});

test('search scope can target another named site without rewriting its query into navigation', () => {
  const command = 'search YouTube on Spotify';
  const initial = deterministicPlan(command, youtube);
  assert.equal(initial.action.url, SITES.spotify);
  const current = { ...page, url: SITES.spotify };
  assert.equal(deterministicPlan(command, current, [{ action: initial.action }]).action.value, 'YouTube');
  assert.equal(deterministicPlan(command, { ...blank, url: SITES.spotify }).action.clarification, true);
});

test('compound site-then-search keeps the named website as its search scope', () => {
  const command = 'open YouTube and then search Spotify';
  assert.equal(deterministicPlan(command, blank).action.url, SITES.youtube);
  assert.equal(deterministicPlan(command, youtube, [{ action: { type: 'navigate', url: SITES.youtube } }]).action.url, 'https://www.youtube.com/results?search_query=Spotify');
  assert.equal(deterministicPlan('open unknown brand and then search AI', blank).action.clarification, true);
});

test('unknown brand searches then asks after bounded discovery, never clicking an arbitrary result', () => {
  const command = 'open Something New';
  const first = deterministicPlan(command, youtube);
  assert.equal(first.action.url, searchUrl('Something New official website'));
  const results = { ...blank, url: first.action.url, elements: [{ ref: 'c3', tag: 'a', name: 'Something New', href: 'https://unverified.example' }] };
  const history = [{ action: first.action, result: { ok: true, navigated: true } }];
  for (const expectedType of ['wait', 'wait', 'scroll', 'scroll']) {
    const step = deterministicPlan(command, results, history);
    assert.equal(step.action.type, expectedType);
    assert.equal(step.intent, 'website-discovery');
    history.push({ ...step, result: { ok: true } });
  }
  const completed = deterministicPlan(command, results, history);
  assert.equal(completed.action.type, 'finish');
  assert.equal(completed.action.clarification, true);
  assert.match(completed.action.message, /not the website itself/);
  assert.equal(deterministicPlan('open Settings', { ...page, elements: [{ ref: 'c4', tag: 'button', name: 'Settings' }] }).action.target.ref, 'c4');
});

test('malformed addresses and credentials never become search-engine queries', () => {
  for (const address of ['https://user:secret@example.com', 'javascript:alert(1)', 'file:///private', 'example.com@evil.example', 'example..com', '-bad.example', 'example.com:99999']) {
    for (const context of [blank, youtube]) assert.equal(deterministicPlan(`open ${address}`, context).action.clarification, true, address);
  }
  assert.equal(deterministicPlan('open EXAMPLE dot COM/docs', youtube).action.url, 'https://example.com/docs');
});

test('site-name shortcuts retain home-navigation completion and reject host lookalikes', () => {
  const history = [{ action: { type: 'navigate', url: SITES.spotify }, result: { ok: true, navigated: true } }];
  assert.equal(deterministicPlan('search Spotify', { ...blank, url: 'https://open.spotify.com/search' }, history).action.type, 'finish');
  assert.equal(deterministicPlan('search Spotify', { ...blank, url: 'https://open.spotify.com.evil.example/' }, history).action.type, 'wait');
  assert.equal(deterministicPlan('search Spotify', { ...blank, url: 'https://open.spotify.com/search' }).action.url, SITES.spotify);
});

test('clarification follow-up can resolve directly to a known site', () => {
  const prefix = deterministicPlan('open', blank).action.followUpPrefix;
  assert.equal(deterministicPlan(`${prefix}Spotify`, youtube).action.url, SITES.spotify);
  const searchPrefix = deterministicPlan('search for', blank).action.followUpPrefix;
  assert.equal(deterministicPlan(`${searchPrefix}Spotify`, youtube).action.url, SITES.spotify);
});
