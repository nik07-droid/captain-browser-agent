import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('Hey Captain arms one command without dispatching; completion sleeps; next wake rearms', async () => {
  const elements = new Map();
  const element = key => { if (!elements.has(key)) elements.set(key, { classList: { toggle() {} }, style: {}, parentElement: { after() {} }, value: '', textContent: '' }); return elements.get(key); };
  const messages = [], spoken = [];
  let recognizer;
  let state = { status: 'idle' };
  let refresh;
  class Speech { constructor() { recognizer = this; } start() { this.onstart?.(); } abort() {} }
  const sandbox = {
    window: {}, requestAnimationFrame() {}, addEventListener() {},
    AudioContext: class { async resume() {} async close() {} createAnalyser() { return { fftSize: 512, getFloatTimeDomainData() {} }; } createMediaStreamSource() { return { connect() {} }; } },
    document: { querySelector: element, createElement: () => ({ style: {} }) },
    self: { SpeechRecognition: Speech }, URL, location: { href: 'chrome-extension://captain/popup.html?target=42' },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    speechSynthesis: { speaking: false, cancel() {}, speak(utterance) { spoken.push(utterance.text); } },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    chrome: { runtime: { sendMessage: async message => { messages.push(message); return message.type === 'GET_STATE' ? state : { ok: true }; } } },
    setInterval(fn) { refresh = fn; }, setTimeout() {}, clearTimeout() {},
  };
  vm.runInNewContext(await readFile(new URL('../extension/popup.js', import.meta.url), 'utf8'), sandbox);
  await element('#voice').onclick();
  const hear = transcript => recognizer.onresult({ results: [[{ transcript }]] });
  await hear('open YouTube');
  assert.equal(messages.filter(item => item.type === 'START_TASK').length, 0);
  await hear('Hey Captain');
  assert.equal(sandbox.window.captainVoiceMode, 'awake');
  assert.equal(messages.filter(item => item.type === 'START_TASK').length, 0, 'Wake phrase alone must not start a task');
  await hear('open YouTube');
  await hear('play another song');
  assert.equal(messages.filter(item => item.type === 'START_TASK').length, 1);
  const command = messages.find(item => item.type === 'START_TASK');
  assert.equal(command.task, 'open YouTube');
  assert.equal(command.tabId, 42);
  assert.deepEqual(spoken, ['Yes, sir. What should I do?', 'Okay, sir.']);
  state = { status: 'complete', task: 'open YouTube', updatedAt: Date.now() + 1000, message: 'Opened YouTube.' };
  await refresh();
  assert.equal(sandbox.window.captainVoiceMode, 'sleeping');
  await hear('play a song');
  assert.equal(messages.filter(item => item.type === 'START_TASK').length, 1);
  await hear('Hey Captain');
  assert.equal(sandbox.window.captainVoiceMode, 'awake');
  assert.equal(messages.filter(item => item.type === 'START_TASK').length, 1, 'Reawakening must not repeat the last task');
  await hear('play a song');
  assert.equal(messages.filter(item => item.type === 'START_TASK').length, 2);
  state = { status: 'error', task: 'play a song', updatedAt: Date.now() + 2000, message: 'Playback failed.' };
  await refresh();
  assert.equal(sandbox.window.captainVoiceMode, 'sleeping');
  await hear('Hey, Captain');
  assert.equal(sandbox.window.captainVoiceMode, 'awake');
  assert.equal(messages.filter(item => item.type === 'START_TASK').length, 2, 'Punctuated wake phrase alone must not start a task');
  await hear('go to sleep');
  assert.equal(sandbox.window.captainVoiceMode, 'sleeping');
  await hear('wake up captain');
  assert.equal(sandbox.window.captainVoiceMode, 'awake', 'Legacy wake phrase remains supported');
  assert.equal(messages.filter(item => item.type === 'START_TASK').length, 2);
  await hear('go to sleep');
  assert.equal(sandbox.window.captainVoiceMode, 'sleeping');
  await hear('Captain, open Google');
  assert.equal(messages.filter(item => item.type === 'START_TASK').at(-1).task, 'open Google');
  await hear('cancel');
  assert.ok(messages.some(item => item.type === 'CANCEL_TASK'));
  state = { status: 'error', task: 'open Google', updatedAt: Date.now() + 5000, message: 'Cancelled' };
  await refresh();
  await hear('hey open youtube and then play the song ae ajnabee by aditya rikhari');
  assert.equal(messages.filter(item => item.type === 'START_TASK').at(-1).task, 'open youtube and then play the song ae ajnabee by aditya rikhari');
});

test('incomplete request prompts for a detail and combines the answer', async () => {
  const elements = new Map();
  const element = key => { if (!elements.has(key)) elements.set(key, { classList: { toggle() {} }, style: {}, value: '', textContent: '' }); return elements.get(key); };
  const messages = [], spoken = [], timers = new Map(); let state = { status: 'idle' }, tick, recognition, timerId = 0;
  const sandbox = { window: {}, requestAnimationFrame() {}, addEventListener() {},
    document: { querySelector: element },
    AudioContext: class { async resume() {} async close() {} createAnalyser() { return { fftSize: 512 }; } createMediaStreamSource() { return { connect() {} }; } },
    self: { SpeechRecognition: class { constructor() { recognition = this; } start() { this.onstart?.(); } abort() {} } },
    URL, location: { href: 'chrome-extension://captain/popup.html?window=3' },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    speechSynthesis: { speaking: false, cancel() {}, speak(u) { spoken.push(u.text); } }, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    chrome: { runtime: { sendMessage: async m => { messages.push(m); return m.type === 'GET_STATE' ? state : { ok: true }; } } },
    setInterval(fn) { tick = fn; }, setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); }
  };
  vm.runInNewContext(await readFile(new URL('../extension/popup.js', import.meta.url), 'utf8'), sandbox);
  await element('#voice').onclick();
  const hear = text => recognition.onresult({ results: [[{ transcript: text }]] });
  await hear('Hey Captain, play');
  assert.equal(messages.filter(m => m.type === 'START_TASK').at(-1).task, 'play');
  state = { status: 'complete', task: 'play', requiresInput: true, followUpPrefix: 'play ', message: 'What should I play?', updatedAt: Date.now() + 1000 };
  await tick();
  assert.equal(spoken.at(-1), 'What should I play?');
  assert.equal(sandbox.window.captainVoiceMode, 'awake');
  await hear('Arijit Singh songs');
  assert.equal(messages.filter(m => m.type === 'START_TASK').at(-1).task, 'play Arijit Singh songs');
  state = { status: 'error', task: 'play Arijit Singh songs', updatedAt: Date.now() + 2000, message: 'Buffering' };
  await tick();
  await hear('Hey Captain');
  for (const fn of [...timers.values()]) fn();
  assert.equal(sandbox.window.captainVoiceMode, 'sleeping');
  const count = messages.filter(m => m.type === 'START_TASK').length;
  await hear('unrelated room conversation');
  assert.equal(messages.filter(m => m.type === 'START_TASK').length, count);
  vm.runInNewContext("followUpPrefix = 'open '; setVoiceMode('awake')", sandbox);
  element('#task').value = 'YouTube';
  await element('#run').onclick();
  assert.equal(messages.filter(m => m.type === 'START_TASK').at(-1).task, 'open YouTube');
  state = { status: 'complete', task: 'open YouTube', updatedAt: Date.now() + 3000, message: 'Opened YouTube.' };
  await tick();
  vm.runInNewContext("followUpPrefix = 'play '; setVoiceMode('awake')", sandbox);
  await hear('play Shreya Ghoshal songs');
  assert.equal(messages.filter(m => m.type === 'START_TASK').at(-1).task, 'play Shreya Ghoshal songs');
});

async function voiceHarness({ autoStart = true, getUserMedia } = {}) {
  const elements = new Map(), messages = [], spoken = [], timers = new Map(), events = new Map();
  const recognizers = [], streams = [], contexts = [];
  let state = { status: 'idle' }, refresh, nextTimer = 0;
  const element = key => {
    if (!elements.has(key)) elements.set(key, { classList: { toggle() {} }, style: {}, value: '', textContent: '', focus() {} });
    return elements.get(key);
  };
  class Speech {
    constructor() { this.starts = 0; this.aborts = 0; recognizers.push(this); }
    start() { this.starts++; if (this.startError) throw new Error(this.startError); if (autoStart) this.onstart?.(); }
    abort() { this.aborts++; this.onend?.(); }
  }
  const newStream = () => {
    const track = { stops: 0, stop() { this.stops++; } };
    const stream = { track, getTracks: () => [track] }; streams.push(stream); return stream;
  };
  const sandbox = {
    window: {}, requestAnimationFrame() {}, addEventListener(name, fn) { events.set(name, fn); },
    document: { querySelector: element },
    AudioContext: class {
      constructor() { this.closes = 0; contexts.push(this); }
      async resume() {} async close() { this.closes++; }
      createAnalyser() { return { fftSize: 512 }; }
      createMediaStreamSource() { return { connect() {} }; }
    },
    self: { SpeechRecognition: Speech }, URL, location: { href: 'chrome-extension://captain/popup.html?window=3' },
    navigator: { mediaDevices: { getUserMedia: getUserMedia || (async () => newStream()) } },
    speechSynthesis: { speaking: false, cancel() {}, speak(u) { spoken.push(u.text); } },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    chrome: { runtime: { sendMessage: async message => { messages.push(message); return message.type === 'GET_STATE' ? state : { ok: true }; } } },
    setInterval(fn) { refresh = fn; },
    setTimeout(fn, delay) { timers.set(++nextTimer, { fn, delay }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.runInNewContext(await readFile(new URL('../extension/popup.js', import.meta.url), 'utf8'), sandbox);
  return {
    element, messages, spoken, timers, events, recognizers, streams, contexts, sandbox, newStream,
    read: expression => vm.runInNewContext(expression, sandbox),
    click: () => element('#voice').onclick(),
    hear: transcript => recognizers.at(-1).onresult({ results: [[{ transcript }]] }),
    setState: value => { state = value; }, refresh: () => refresh(),
    runTimer(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `Expected ${delay}ms timer`);
      timers.delete(entry[0]); return entry[1].fn();
    },
  };
}

test('delayed recognition start retains the startup lock until onstart', async () => {
  const h = await voiceHarness({ autoStart: false });
  assert.equal(h.streams.length, 0, 'Loading the controller must not enable the microphone');
  await h.click();
  assert.equal(h.read('micStarting'), true);
  assert.equal(h.read('listening'), false);
  await h.click();
  assert.equal(h.streams.length, 1);
  assert.equal(h.recognizers.length, 1);
  assert.equal(h.recognizers[0].starts, 1);
  h.recognizers[0].onstart();
  assert.equal(h.read('micStarting'), false);
  assert.equal(h.read('listening'), true);
  assert.equal([...h.timers.values()].some(timer => timer.delay === 10000), false);
});

test('recognizer restart failure closes microphone resources and exposes the error', async () => {
  const h = await voiceHarness(); await h.click();
  const recognition = h.recognizers[0];
  recognition.onend(); recognition.startError = 'Restart rejected';
  h.runTimer(500);
  assert.equal(h.read('listening'), false);
  assert.equal(h.read('micStarting'), false);
  assert.equal(h.read('micStream'), null);
  assert.equal(h.streams[0].track.stops, 1);
  assert.equal(h.contexts[0].closes, 1);
  assert.equal(h.timers.size, 0);
  assert.match(h.element('#voice-status').textContent, /Restart rejected.*Speak to retry/);
});

test('old restart timers and recognition callbacks cannot restart or dispatch a newer session', async () => {
  const h = await voiceHarness(); await h.click();
  const oldRecognition = h.recognizers[0]; oldRecognition.onend();
  const oldTimer = [...h.timers.values()].find(timer => timer.delay === 500).fn;
  await h.click(); // Explicit mic off cancels the scheduled restart.
  assert.equal([...h.timers.values()].some(timer => timer.delay === 500), false);
  await h.click();
  const currentRecognition = h.recognizers[1];
  oldTimer(); oldRecognition.onstart(); oldRecognition.onerror({ error: 'network' });
  await oldRecognition.onresult({ results: [[{ transcript: 'Hey Captain, open YouTube' }]] });
  assert.equal(oldRecognition.starts, 1);
  assert.equal(currentRecognition.starts, 1);
  assert.equal(h.read('listening'), true);
  assert.equal(h.streams[1].track.stops, 0);
  assert.equal(h.messages.filter(message => message.type === 'START_TASK').length, 0);
});

test('a speech error while awake survives the previous inactivity timeout', async () => {
  const h = await voiceHarness(); await h.click(); await h.hear('Hey Captain');
  const awakeCallback = [...h.timers.values()].find(timer => timer.delay === 20000).fn;
  h.recognizers[0].onerror({ error: 'network' });
  const errorMessage = h.element('#voice-status').textContent;
  assert.match(errorMessage, /Voice stopped: network/);
  assert.equal(h.sandbox.window.captainVoiceMode, 'sleeping');
  assert.equal(h.timers.size, 0);
  awakeCallback(); await h.refresh();
  assert.equal(h.element('#voice-status').textContent, errorMessage);
  assert.equal(h.read('listening'), false);
  assert.equal(h.streams[0].track.stops, 1);
});

test('turning off or failing the microphone does not unlock a running browser task', async () => {
  const h = await voiceHarness(); await h.click(); await h.hear('Hey Captain, open YouTube');
  await h.click();
  assert.equal(h.sandbox.window.captainVoiceMode, 'busy');
  assert.match(h.element('#voice-status').textContent, /browser task is still running/);
  h.element('#task').value = 'open Gmail'; await h.element('#run').onclick();
  assert.equal(h.messages.filter(message => message.type === 'START_TASK').length, 1);
  await h.click(); h.recognizers[1].onerror({ error: 'not-allowed' });
  assert.equal(h.sandbox.window.captainVoiceMode, 'busy');
  await h.element('#run').onclick();
  assert.equal(h.messages.filter(message => message.type === 'START_TASK').length, 1);
  h.setState({ status: 'complete', task: 'open YouTube', updatedAt: Date.now() + 1000, message: 'Opened YouTube.' });
  await h.refresh();
  assert.equal(h.sandbox.window.captainVoiceMode, 'sleeping');
  assert.equal(h.read('listening'), false);
});

test('start timeout releases the mic and ignores a late onstart event', async () => {
  const h = await voiceHarness({ autoStart: false }); await h.click();
  h.runTimer(10000);
  assert.match(h.element('#voice-status').textContent, /did not start within 10 seconds/);
  h.recognizers[0].onstart();
  assert.equal(h.read('listening'), false);
  assert.equal(h.streams[0].track.stops, 1);
  assert.equal(h.contexts[0].closes, 1);
});

test('a microphone permission result arriving after pagehide is immediately closed', async () => {
  let grantPermission;
  const h = await voiceHarness({ getUserMedia: () => new Promise(resolve => { grantPermission = resolve; }) });
  const starting = h.click();
  h.events.get('pagehide')();
  const stream = h.newStream(); grantPermission(stream); await starting;
  assert.equal(stream.track.stops, 1);
  assert.equal(h.contexts.length, 0);
  assert.equal(h.recognizers.length, 0);
  assert.equal(h.read('micStarting'), false);
});

test('online speech disclosure is separate from transient voice status', async () => {
  const html = await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8');
  assert.match(html, /id="voice-privacy"[^>]*>Voice privacy: browser speech recognition may send audio to an online service/);
  assert.match(html, /This is not local wake-word detection/);
  assert.match(html, /aria-describedby="voice-privacy"/);
});

test('a registered edge wake/ASR transcript enters the same command dispatcher already awake', async () => {
  const elements = new Map();
  const element = key => { if (!elements.has(key)) elements.set(key, { classList: { toggle() {} }, style: {}, value: '', textContent: '' }); return elements.get(key); };
  const messages = [], spoken = [], sockets = [];
  class Socket {
    constructor(url) { this.url = url; this.sent = []; sockets.push(this); }
    send(value) { this.sent.push(JSON.parse(value)); }
  }
  const sandbox = {
    window: {}, WebSocket: Socket, requestAnimationFrame() {}, addEventListener() {},
    document: { querySelector: element }, self: {}, URL, location: { href: 'chrome-extension://captain/popup.html?window=3' },
    navigator: {}, speechSynthesis: { speaking: false, cancel() {}, speak(u) { spoken.push(u.text); } }, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    chrome: {
      runtime: { sendMessage: async message => { messages.push(message); return message.type === 'GET_STATE' ? { status: 'idle' } : { ok: true }; } },
      storage: {
        sync: { get: async () => ({ edgeAsrUrl: 'wss://asr.example.org', edgeClientId: 'browser-7' }) },
        local: { get: async () => ({ edgeAsrToken: 'secret' }) },
      },
    },
    setInterval() {}, setTimeout() { return 1; }, clearTimeout() {},
  };
  vm.runInNewContext(await readFile(new URL('../extension/popup.js', import.meta.url), 'utf8'), sandbox);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sockets.length, 1);
  sockets[0].onopen();
  assert.deepEqual(sockets[0].sent[0], { type: 'register_browser', clientId: 'browser-7', token: 'secret' });
  await sockets[0].onmessage({ data: JSON.stringify({ type: 'command', text: 'search for privacy browser and open it', source: 'edge-kws-asr' }) });
  const task = messages.find(message => message.type === 'START_TASK');
  assert.equal(task.task, 'search for privacy browser and open it');
  assert.equal(sandbox.window.captainVoiceMode, 'busy');
  assert.equal(spoken.at(-1), 'Okay, sir.');
});
