import test from 'node:test';
import assert from 'node:assert/strict';
import { deterministicPlan, normalizeCommand, rankVideoResults, validatePlan, explicitWebsiteUrl } from '../server/planner.mjs';

const blank = { url: 'about:blank', elements: [] };
const player = { ...blank, media: [{ paused: true, ended: false, readyState: 4 }] };

test('Gmail public landing follows only its observed official sign-in link', () => {
  const context = { ...blank, url: 'https://workspace.google.com/intl/en-US/gmail/', elements: [
    { ref: 'c1', name: 'Sign in', href: 'https://accounts.google.com.evil.example/login' },
    { ref: 'c2', name: 'Sign in', href: 'https://accounts.google.com/ServiceLogin' }
  ] };
  assert.equal(deterministicPlan('open Gmail', context).action.target.ref, 'c2');
  assert.match(deterministicPlan('open Gmail', { ...context, elements: [] }).action.message, /public website.*sign in/);
  const redirected = { ...blank, url: 'https://accounts.google.com/' };
  assert.match(deterministicPlan('hey open gmail', redirected, [{ action: { type: 'navigate', url: 'https://mail.google.com' }, result: { ok: true, navigated: true } }, { action: { type: 'click', target: { ref: 'c2' } } }]).action.message, /sign in/i);
});

test('polite wake-word command variants preserve the requested title', () => {
  for (const command of [
    'Wake up CAPTAIN, could you please play Arijit Singh songs?',
    'Hey Captain: please play Arijit Singh songs, thank you.',
    'Okay Captain, would you play Arijit Singh songs please?',
  ]) assert.equal(normalizeCommand(command), 'play Arijit Singh songs');
  assert.equal(normalizeCommand('search for Captain America'), 'search for Captain America');
  assert.equal(normalizeCommand('hey open youtube'), 'open youtube');
  assert.equal(normalizeCommand('Hey, play Hey Jude'), 'play Hey Jude');
  assert.equal(normalizeCommand('search for hey open youtube'), 'search for hey open youtube');
  assert.equal(normalizeCommand('hey jude'), 'hey jude');
});

test('the exact combined song request opens YouTube and selects both title and artist', () => {
  const command = 'hey open youtube and then play the song ae ajnabee by aditya rikhari';
  const query = 'ae ajnabee by aditya rikhari';
  assert.equal(deterministicPlan(command, blank).action.url, 'https://www.youtube.com');
  const youtube = { ...blank, site: 'youtube', url: 'https://www.youtube.com/' };
  assert.equal(deterministicPlan(command, youtube).action.url, `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
  const results = { ...youtube, searchQuery: query, elements: [
    { ref: 'c1', tag: 'a', href: '/watch?v=wrongArtist', name: 'Ae Ajnabee - Udit Narayan' },
    { ref: 'c2', tag: 'a', href: '/watch?v=wrongSong', name: 'Sahiba - Aditya Rikhari' },
    { ref: 'c3', tag: 'a', href: '/watch?v=official', name: 'Ae Ajnabee (Official Music Video) - Aditya Rikhari, Ravator, Kutle Khan | Coke Studio Bharat' },
  ] };
  assert.deepEqual(deterministicPlan(command, results).action, { type: 'click', target: { ref: 'c3' } });
  const completion = deterministicPlan(command, { ...youtube, media: [{ paused: false, ended: false, readyState: 4 }] }, [{ action: { type: 'click' } }]);
  assert.deepEqual(completion.action.verification, { type: 'playback', query });
  assert.equal(deterministicPlan('play Song 2 by Blur', youtube).action.url, 'https://www.youtube.com/results?search_query=Song%202%20by%20Blur');
});

test('video matching does not accept substring lookalikes as the requested title', () => {
  const videos = [{ tag: 'a', href: '/watch?v=wrong', name: 'Caesar Ajnabee - Aditya Rikhari', ref: 'c1' }];
  assert.deepEqual(rankVideoResults(videos, 'ae ajnabee by aditya rikhari'), []);
});

test('spoken site aliases resolve only known addresses', () => {
  for (const command of ['open gmail', 'hey open g mail', 'go to the google mail website']) {
    assert.equal(deterministicPlan(command, blank).action.url, 'https://mail.google.com');
  }
  assert.equal(deterministicPlan('open you tube', blank).action.url, 'https://www.youtube.com');
  assert.equal(deterministicPlan('open git hub', blank).action.url, 'https://github.com');
});

test('Gmail redirect requires sign-in without claiming an inbox was opened', () => {
  const signIn = { ...blank, url: 'https://accounts.google.com/ServiceLogin?service=mail' };
  const history = [{ action: { type: 'navigate', url: 'https://mail.google.com' } }];
  const plan = deterministicPlan('open Gmail', signIn, history);
  assert.equal(plan.action.type, 'finish');
  assert.match(plan.action.message, /needs you to sign in/);
  assert.equal(deterministicPlan('open Gmail', signIn).action.type, 'navigate');
  assert.equal(deterministicPlan('open Gmail', { ...signIn, url: 'https://accounts.google.com.evil.example/' }, history).action.type, 'wait');
  assert.equal(deterministicPlan('open Gmail', { ...blank, url: 'https://mail.google.com/mail/u/0/' }).action.type, 'finish');
});

test('spoken explicit domains are validated and unknown names search instead of guessing', () => {
  for (const command of ['open example dot com', 'launch example.com', 'navigate to https://example.com/']) {
    assert.equal(deterministicPlan(command, blank).action.url, 'https://example.com/');
  }
  for (const address of ['javascript:alert(1)', 'file:///private', 'https://user:secret@example.com', 'example.com@evil.example', 'example..com', '-bad.example', 'example.com:99999']) {
    assert.equal(explicitWebsiteUrl(address), null, address);
    assert.equal(deterministicPlan(`open ${address}`, blank).action.clarification, true, address);
  }
  const unknown = deterministicPlan('open new unknown shop', { ...blank, elements: [{ ref: 'c1', tag: 'a', name: 'Visit new unknown shop now' }] });
  assert.equal(unknown.action.type, 'navigate');
  assert.equal(unknown.action.url, 'https://www.google.com/search?q=new%20unknown%20shop%20official%20website');
  assert.equal(deterministicPlan('open Settings', { ...blank, elements: [{ ref: 'c1', tag: 'button', name: 'Settings' }] }).action.type, 'click');
});

test('incomplete commands ask for a missing detail with a typed follow-up prefix', () => {
  for (const [command, prefix] of [['open', 'open '], ['search for', 'search for '], ['play', 'play '], ['scroll', 'scroll '], ['play on YouTube', 'play '], ['put on', 'play '], ['put on on YouTube', 'play ']]) {
    const plan = deterministicPlan(command, blank);
    assert.equal(plan.action.type, 'finish');
    assert.equal(plan.action.clarification, true, command);
    assert.equal(plan.action.followUpPrefix, prefix);
    assert.equal(validatePlan(plan), plan);
  }
  assert.equal(deterministicPlan('wake up captain', blank).action.clarification, true);
  assert.equal(deterministicPlan('put on', player).action.clarification, true);
});

test('put on aliases select the requested video and require verified playback', () => {
  const query = 'Shreya Ghoshal songs';
  const youtube = { ...blank, site: 'youtube', url: 'https://www.youtube.com/' };
  const results = { ...youtube, searchQuery: query, elements: [
    { ref: 'c1', tag: 'a', href: '/watch?v=wrong', name: 'Arijit Singh songs' },
    { ref: 'c2', tag: 'a', href: '/watch?v=requested', name: 'Shreya Ghoshal songs official audio' },
  ] };
  for (const command of ['put on Shreya Ghoshal songs', 'Hey Captain, could you please put on Shreya Ghoshal songs on YouTube?', 'open YouTube and then put on Shreya Ghoshal songs']) {
    assert.equal(deterministicPlan(command, blank).action.url, 'https://www.youtube.com');
    assert.equal(deterministicPlan(command, youtube).action.url, 'https://www.youtube.com/results?search_query=Shreya%20Ghoshal%20songs');
    const selected = deterministicPlan(command, results).action;
    assert.deepEqual(selected, { type: 'click', target: { ref: 'c2' } });
    const history = [{ action: selected }];
    assert.deepEqual(deterministicPlan(command, { ...youtube, media: player.media }, history).action, { type: 'media', operation: 'play' });
    const completion = deterministicPlan(command, { ...youtube, media: [{ paused: false, ended: false, readyState: 4 }] }, history).action;
    assert.equal(completion.type, 'finish');
    assert.deepEqual(completion.verification, { type: 'playback', query });
  }
});

test('resume, unpause, and bare play use the existing player, not a new search', () => {
  for (const command of ['resume', 'please unpause', 'play', 'continue playing', 'play this song']) {
    assert.deepEqual(deterministicPlan(command, player).action, { type: 'media', operation: 'play' });
  }
  assert.equal(deterministicPlan('resume', blank).action.clarification, true);
});

test('pause completion is based on observed state rather than a prior action', () => {
  const playing = { ...blank, media: [{ paused: false, ended: false, readyState: 4 }] };
  const history = [{ action: { type: 'media', operation: 'pause' } }];
  assert.equal(deterministicPlan('pause', playing, history).action.type, 'media');
  assert.equal(deterministicPlan('pause', player, history).action.message, 'Playback is paused.');
  assert.equal(deterministicPlan('pause', blank).action.clarification, true);
});

test('named sites open only on an explicit site command, not words in a query', () => {
  assert.deepEqual(deterministicPlan('Could you please open YouTube?', blank).action, { type: 'navigate', url: 'https://www.youtube.com' });
  assert.equal(deterministicPlan('search for YouTube outage', blank).action.url, 'https://www.google.com/search?q=YouTube%20outage');
});

test('open named site returns to its home from results without claiming navigation already happened', () => {
  const context = { ...blank, site: 'youtube', url: 'https://www.youtube.com/results', searchQuery: 'old search' };
  assert.equal(deterministicPlan('open YouTube', context).action.url, 'https://www.youtube.com/');
  assert.equal(deterministicPlan('open YouTube', { ...context, url: 'https://www.youtube.com/' }).action.type, 'finish');
});

test('named website home redirects finish only after successful navigation to that home', () => {
  const context = { ...blank, url: 'https://wikipedia.org/portal/' };
  const navigation = { action: { type: 'navigate', url: 'https://www.wikipedia.org' }, result: { ok: true, navigated: true } };
  assert.equal(deterministicPlan('open wikipedia', context, [navigation]).action.type, 'finish');
  assert.equal(deterministicPlan('open wikipedia', context).action.type, 'navigate');
  assert.equal(deterministicPlan('open wikipedia', context, [{ ...navigation, result: { ok: false } }]).action.type, 'navigate');
  assert.equal(deterministicPlan('open wikipedia', context, [{ ...navigation, action: { type: 'navigate', url: 'https://www.wikipedia.org/different' } }]).action.type, 'navigate');
  assert.equal(deterministicPlan('open wikipedia', { ...blank, url: 'https://wikipedia.org.evil.example/portal/' }, [navigation]).action.type, 'wait');
});

test('explicit address redirects require a verified navigation to the exact requested address', () => {
  const context = { ...blank, url: 'https://example.com/docs/' };
  const navigation = { action: { type: 'navigate', url: 'https://www.example.com/docs' }, result: { ok: true, navigated: true } };
  assert.equal(deterministicPlan('open https://www.example.com/docs', context, [navigation]).action.type, 'finish');
  assert.equal(deterministicPlan('open https://www.example.com/docs', context).action.type, 'navigate');
  assert.equal(deterministicPlan('open https://www.example.com/docs', context, [{ ...navigation, result: { ok: false } }]).action.type, 'navigate');
  assert.equal(deterministicPlan('open https://www.example.com/other', context, [navigation]).action.type, 'navigate');
  assert.equal(deterministicPlan('open https://www.example.com/docs', { ...blank, url: 'https://accounts.example.com/docs/' }, [navigation]).action.type, 'navigate');
});

test('open-site completion rejects lookalike hostnames and stale navigation', () => {
  const context = { ...blank, url: 'https://www.youtube.com.evil.example/' };
  assert.equal(deterministicPlan('open youtube', context).action.type, 'navigate');
  assert.equal(deterministicPlan('open youtube', context, [{ action: { type: 'navigate' } }]).action.type, 'wait');
});

test('explicit domains and URLs open without guessing a page control', () => {
  assert.equal(deterministicPlan('open example.com', blank).action.url, 'https://example.com/');
  assert.equal(deterministicPlan('launch https://example.com/docs', blank).action.url, 'https://example.com/docs');
  assert.equal(deterministicPlan('open https://example.com', { ...blank, url: 'https://example.com/' }).action.type, 'finish');
});

test('search from a blank page navigates to a web query and verifies the query', () => {
  const first = deterministicPlan('search for lightweight laptops', blank);
  assert.equal(first.action.url, 'https://www.google.com/search?q=lightweight%20laptops');
  const second = deterministicPlan('search for lightweight laptops', { ...blank, url: first.action.url }, [{ action: first.action }]);
  assert.equal(second.action.type, 'finish');
});

test('look up uses the current editable search field', () => {
  const context = { ...blank, elements: [{ ref: 'c1', tag: 'input', name: 'Search' }] };
  const plan = deterministicPlan('look up electric cars', context);
  assert.equal(plan.action.value, 'electric cars');
  assert.equal(plan.action.target.ref, 'c1');
});

test('YouTube search aliases target results instead of submitting the whole command', () => {
  const context = { ...blank, site: 'youtube', url: 'https://www.youtube.com/' };
  for (const command of ['find Shreya Ghoshal songs', 'look up Shreya Ghoshal songs', 'search for Shreya Ghoshal songs on YouTube']) {
    const plan = deterministicPlan(command, context);
    assert.equal(plan.action.url, 'https://www.youtube.com/results?search_query=Shreya%20Ghoshal%20songs');
  }
});

test('video ranking skips unrelated first links and penalizes unrequested reactions', () => {
  const elements = [
    { ref: 'c1', tag: 'a', href: '/watch?v=1', name: 'Unrelated recommended video' },
    { ref: 'c2', tag: 'a', href: '/watch?v=2', name: 'Arijit Singh reaction' },
    { ref: 'c3', tag: 'a', href: '/watch?v=3', name: 'Arijit Singh songs official audio' },
  ];
  assert.equal(rankVideoResults(elements, 'Arijit Singh songs')[0].ref, 'c3');
  assert.equal(rankVideoResults(elements, 'Shreya Ghoshal songs').length, 0);
  const context = { site: 'youtube', searchQuery: 'Arijit Singh songs', elements };
  assert.equal(deterministicPlan('play Arijit Singh songs', context).action.target.ref, 'c3');
});

test('open YouTube then play is one supported compound intent', () => {
  const task = 'please open YouTube and then play Arijit Singh songs';
  assert.equal(deterministicPlan(task, blank).action.url, 'https://www.youtube.com');
  const context = { ...blank, site: 'youtube', url: 'https://www.youtube.com/' };
  assert.equal(deterministicPlan(task, context, [{ action: { type: 'navigate' } }]).action.url, 'https://www.youtube.com/results?search_query=Arijit%20Singh%20songs');
});

test('open a known website then search preserves the bounded compound search intent', () => {
  for (const command of ['Open YouTube and search for AI news', 'hey open you tube and then search for AI news']) {
    const first = deterministicPlan(command, blank);
    assert.deepEqual(first.action, { type: 'navigate', url: 'https://www.youtube.com' });
    const history = [{ action: first.action, result: { ok: true, navigated: true } }];
    const context = { ...blank, url: 'https://www.youtube.com/', elements: [{ ref: 'c8', tag: 'input', name: 'Search' }] };
    assert.deepEqual(deterministicPlan(command, context, history).action, { type: 'type', target: { ref: 'c8' }, value: 'AI news', submit: true });
    assert.equal(deterministicPlan(command, { ...context, site: 'youtube' }, history).action.url, 'https://www.youtube.com/results?search_query=AI%20news');
    assert.equal(deterministicPlan(command, { ...context, site: 'youtube', searchQuery: 'AI news' }, history).action.type, 'finish');
  }
  const currentYouTube = { ...blank, site: 'youtube', url: 'https://www.youtube.com/' };
  assert.equal(deterministicPlan('open google and then search for AI news', currentYouTube).action.url, 'https://www.google.com');
  assert.equal(deterministicPlan('open unknown company and search for AI news', blank).action.clarification, true);
});

test('nonmatching video results produce a bounded clarification, not a random click', () => {
  const context = { ...blank, site: 'youtube', searchQuery: 'Shreya Ghoshal songs', elements: [{ ref: 'c1', tag: 'a', href: '/watch?v=wrong', name: 'Unrelated video' }] };
  assert.equal(deterministicPlan('play Shreya Ghoshal songs', context).action.type, 'wait');
  assert.equal(deterministicPlan('play Shreya Ghoshal songs', context, [{ action: { type: 'wait' } }]).action.type, 'scroll');
  const history = [...Array.from({ length: 3 }, () => ({ action: { type: 'wait' } })), ...Array.from({ length: 3 }, () => ({ action: { type: 'scroll' } }))];
  const plan = deterministicPlan('play Shreya Ghoshal songs', context, history);
  assert.equal(plan.action.clarification, true);
  assert.equal(plan.action.followUpPrefix, 'play ');
});
