import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const code = await readFile(new URL('../extension/content-script.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const plain = value => JSON.parse(JSON.stringify(value));

// Small DOM adapter for panel behavior, not a substitute for browser layout QA.
// Geometry deliberately depends on collapsed state and viewport dimensions.
class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn, options = {}) {
    const entries = this.listeners.get(type) || [];
    if (!entries.some(entry => entry.fn === fn)) entries.push({ fn, once: !!options.once });
    this.listeners.set(type, entries);
  }
  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(entry => entry.fn !== fn));
  }
  dispatchEvent(event) {
    event.target ||= this;
    event.preventDefault ||= () => { event.defaultPrevented = true; };
    for (const entry of [...(this.listeners.get(event.type) || [])]) {
      if (entry.once) this.removeEventListener(event.type, entry.fn);
      entry.fn(event);
    }
    return !event.defaultPrevented;
  }
  count(type) { return (this.listeners.get(type) || []).length; }
}

function harness({ stored, state = { status: 'idle', message: 'Ready' } } = {}) {
  const events = new Target(), document = new Target();
  const messages = [], writes = [], spoken = [], intervals = new Map(), messageListeners = new Set();
  let intervalId = 0, reloads = 0, host, rejectSend = null, getStored;
  const sandbox = {
    URL, Event: class { constructor(type) { this.type = type; } }, console,
    innerWidth: 1000, innerHeight: 800, devicePixelRatio: 1,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    setInterval(fn) { intervals.set(++intervalId, fn); return intervalId; },
    clearInterval(id) { intervals.delete(id); }, setTimeout, clearTimeout,
    location: { href: 'https://example.com/', origin: 'https://example.com', hostname: 'example.com', pathname: '/', reload() { reloads++; } },
    speechSynthesis: { speak(utterance) { spoken.push(utterance.text); } },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    chrome: {
      runtime: {
        id: 'captain-test',
        onMessage: { addListener(fn) { messageListeners.add(fn); }, removeListener(fn) { messageListeners.delete(fn); } },
        async sendMessage(message) {
          messages.push(plain(message));
          if (rejectSend) throw rejectSend;
          return message.type === 'GET_STATE' ? state : { ok: true };
        }
      },
      storage: { local: {
        get() { return getStored ? getStored() : Promise.resolve({ captainPanelLayout: stored }); },
        async set(value) { writes.push(plain(value)); }
      } }
    }, document
  };
  class Element extends Target {
    constructor(tagName = 'DIV') {
      super(); this.tagName = tagName; this.style = {}; this.dataset = {}; this.attributes = {};
      this.value = ''; this.textContent = ''; this.disabled = false; this.hidden = false; this.isConnected = false;
      const classes = new Set();
      this.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name), toggle(name, force) {
        const enabled = force ?? !classes.has(name); enabled ? classes.add(name) : classes.delete(name); return enabled;
      } };
      this.captured = new Set();
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    closest(selector) { return selector === 'button' && this.tagName === 'BUTTON' ? this : null; }
    focus() { this.focused = true; }
    setPointerCapture(id) { this.captured.add(id); }
    hasPointerCapture(id) { return this.captured.has(id); }
    releasePointerCapture(id) { this.captured.delete(id); }
    remove() { this.isConnected = false; if (host === this) host = null; }
    getBoundingClientRect() {
      const collapsed = this.shadowRoot?.querySelector('.card').classList.contains('collapsed');
      const width = collapsed ? 228 : Math.min(366, sandbox.innerWidth - 16), height = collapsed ? 54 : 230;
      const left = Number.parseFloat(this.style.left) || sandbox.innerWidth - width - 18;
      const top = Number.parseFloat(this.style.top) || sandbox.innerHeight - height - 18;
      return { left, top, x: left, y: top, width, height, right: left + width, bottom: top + height };
    }
    attachShadow() {
      const nodes = new Map();
      const root = { querySelector: selector => nodes.get(selector) || null };
      Object.defineProperty(root, 'innerHTML', { set(html) {
        root.html = html;
        for (const match of html.matchAll(/<([a-z]+)\b([^>]*\bclass="([^"]+)"[^>]*)>/gi)) {
          const element = new Element(match[1].toUpperCase());
          for (const name of match[3].split(/\s+/)) { nodes.set(`.${name}`, element); element.classList.add(name); }
          for (const attribute of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) element.setAttribute(attribute[1], attribute[2]);
          element.hidden = /\bhidden\b/.test(match[2]);
          element.title = element.getAttribute('title') || '';
          const after = html.slice(match.index + match[0].length);
          element.textContent = after.slice(0, after.indexOf(`</${match[1]}>`)).replace(/<[^>]+>/g, '');
        }
      } });
      this.shadowRoot = root;
      return root;
    }
  }
  document.documentElement = { appendChild(element) { host = element; element.isConnected = true; } };
  document.querySelector = selector => selector === '#captain-agent-host' ? host : null;
  document.createElement = tag => new Element(tag.toUpperCase());
  const context = vm.createContext(sandbox);
  const inject = () => vm.runInContext(code, context);
  inject();
  return {
    sandbox, events, document, messages, writes, spoken, intervals, messageListeners, inject,
    get host() { return host; }, get reloads() { return reloads; },
    node(selector) { return host.shadowRoot.querySelector(selector); },
    async click(selector) { await this.node(selector).onclick(); await flush(); },
    async fire(selector, type, extra = {}) { this.node(selector).dispatchEvent({ type, ...extra }); await flush(); },
    async poll() { for (const fn of [...intervals.values()]) await fn(); await flush(); },
    setSendError(error) { rejectSend = error; },
    deferStorage(promise) { getStored = () => promise; }
  };
}

test('panel header drag moves the panel, clamps every edge, and ignores control buttons', async () => {
  const h = harness(); await flush();
  const before = h.host.getBoundingClientRect(), head = h.node('.head');
  await h.fire('.head', 'pointerdown', { button: 0, pointerId: 1, clientX: before.left + 20, clientY: before.top + 15 });
  assert.equal(head.hasPointerCapture(1), true);
  await h.fire('.head', 'pointermove', { pointerId: 1, clientX: 160, clientY: 190 });
  assert.equal(h.host.style.left, '140px'); assert.equal(h.host.style.top, '175px');
  await h.fire('.head', 'pointermove', { pointerId: 2, clientX: 0, clientY: 0 });
  assert.equal(h.host.style.left, '140px', 'another pointer cannot move the active drag');
  await h.fire('.head', 'pointermove', { pointerId: 1, clientX: -1000, clientY: -1000 });
  assert.equal(h.host.style.left, '8px'); assert.equal(h.host.style.top, '8px');
  await h.fire('.head', 'pointermove', { pointerId: 1, clientX: 9000, clientY: 9000 });
  assert.equal(h.host.style.left, '626px'); assert.equal(h.host.style.top, '562px');
  await h.fire('.head', 'pointerup', { pointerId: 1 });
  assert.equal(head.hasPointerCapture(1), false); assert.equal(head.classList.contains('dragging'), false);
  assert.deepEqual(h.writes.at(-1), { captainPanelLayout: { x: 1, y: 1, collapsed: false } });
  await h.fire('.head', 'pointerdown', { button: 0, pointerId: 3, clientX: 630, clientY: 570, target: h.node('.collapse') });
  await h.fire('.head', 'pointermove', { pointerId: 3, clientX: 10, clientY: 10 });
  assert.equal(h.host.style.left, '626px', 'minimize/reset buttons must not initiate a drag');
});

test('keyboard movement, minimize, reset and resize retain a reachable panel', async () => {
  const h = harness(); await flush();
  await h.fire('.head', 'keydown', { key: 'ArrowLeft' });
  assert.equal(h.host.style.left, '616px');
  await h.fire('.head', 'keydown', { key: 'ArrowUp', shiftKey: true });
  assert.equal(h.host.style.top, '522px');
  await h.fire('.head', 'keydown', { key: 'ArrowLeft', target: h.node('.reset') });
  assert.equal(h.host.style.left, '616px', 'focused child controls must not move the panel');
  await h.click('.collapse');
  assert.equal(h.node('.card').classList.contains('collapsed'), true);
  assert.equal(h.node('.collapse').getAttribute('aria-expanded'), 'false');
  await h.click('.reset');
  assert.equal(h.host.style.left, '764px'); assert.equal(h.host.style.top, '738px');
  await h.click('.collapse');
  assert.equal(h.node('.collapse').getAttribute('aria-expanded'), 'true');
  await h.fire('.head', 'keydown', { key: 'Home' });
  assert.equal(h.host.style.left, '626px'); assert.equal(h.host.style.top, '562px');
  h.sandbox.innerWidth = 400; h.sandbox.innerHeight = 300;
  h.events.dispatchEvent({ type: 'resize' });
  assert.equal(h.host.style.left, '26px'); assert.equal(h.host.style.top, '62px');
});

test('saved layout is normalized and persists geometry only, never commands or transcripts', async () => {
  const h = harness({ stored: { x: -50, y: 90, collapsed: true, command: 'private text' } }); await flush();
  assert.equal(h.host.style.left, '8px'); assert.equal(h.host.style.top, '738px');
  assert.equal(h.node('.card').classList.contains('collapsed'), true);
  h.node('.task').value = 'secret@example.com';
  await h.fire('.head', 'keydown', { key: 'ArrowRight' });
  assert.deepEqual(Object.keys(h.writes[0]), ['captainPanelLayout']);
  assert.deepEqual(Object.keys(h.writes[0].captainPanelLayout).sort(), ['collapsed', 'x', 'y']);
  assert.equal(JSON.stringify(h.writes).includes('secret@example.com'), false);
  const invalid = harness({ stored: { x: '0.3', y: 0, collapsed: true } }); await flush();
  assert.equal(invalid.host.style.left, '626px'); assert.equal(invalid.node('.card').classList.contains('collapsed'), false);
});

test('runtime invalidation shows recovery, stops polling, and cannot dispatch a command', async () => {
  const h = harness(); await flush();
  h.node('.task').value = 'open YouTube';
  h.sandbox.chrome.runtime.id = undefined;
  await h.click('.go');
  assert.match(h.node('.phase').textContent, /updated or disconnected/i);
  assert.equal(h.node('.phase').textContent.includes('Extension context invalidated'), false);
  assert.equal(h.node('.recovery').hidden, false);
  assert.equal(h.node('.go').disabled, true); assert.equal(h.node('.mic').disabled, true);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.messages.filter(message => message.type === 'START_TASK').length, 0);
  assert.equal(h.reloads, 0, 'recovery must not reload a page containing unsaved user input automatically');
  await h.click('.reload'); assert.equal(h.reloads, 1);
});

test('a missing extension receiver becomes actionable recovery instead of silent polling', async () => {
  const h = harness(); await flush();
  h.setSendError(new Error('Could not establish connection. Receiving end does not exist.'));
  await h.poll();
  assert.equal(h.intervals.size, 0); assert.equal(h.node('.recovery').hidden, false);
  assert.match(h.node('.phase').textContent, /launcher.*reconnect/i);
});

test('duplicate injection does not multiply panels, listeners or polling; disposal removes them', async () => {
  const h = harness(); await flush(); const first = h.host;
  h.inject(); await flush();
  assert.equal(h.host, first); assert.equal(h.intervals.size, 1);
  assert.equal(h.messageListeners.size, 1); assert.equal(h.events.count('resize'), 1);
  assert.equal(h.document.count('captain:panel-replaced'), 1);
  h.sandbox.__captainPageController.dispose();
  assert.equal(h.host, null); assert.equal(first.isConnected, false);
  assert.equal(h.intervals.size, 0); assert.equal(h.messageListeners.size, 0);
  assert.equal(h.events.count('resize'), 0); assert.equal(h.document.count('captain:panel-replaced'), 0);
  h.inject(); await flush();
  assert.notEqual(h.host, first); assert.equal(h.intervals.size, 1); assert.equal(h.messageListeners.size, 1);
});

test('replacement event disposes the previous isolated-context panel', async () => {
  const h = harness(); await flush();
  h.document.dispatchEvent({ type: 'captain:panel-replaced' });
  assert.equal(h.host, null); assert.equal(h.intervals.size, 0);
  assert.equal(h.messageListeners.size, 0); assert.equal(h.events.count('resize'), 0);
});

test('microphone opens the persistent voice controller without claiming to listen', async () => {
  const h = harness(); await flush();
  await h.click('.mic');
  assert.deepEqual(h.messages.filter(message => message.type !== 'GET_STATE'), [{ type: 'OPEN_VOICE' }]);
  assert.equal(h.spoken.length, 0);
  assert.doesNotMatch(h.node('.phase').textContent, /listening/i);
  assert.match(h.node('.voice-help').textContent, /enable Speak once.*Hey Captain.*voice tab open/i);
});

test('Enter submits the same trimmed command as Run; composition and empty commands do not', async () => {
  const h = harness(); await flush();
  h.node('.task').value = '   open YouTube   ';
  await h.fire('.task', 'keydown', { key: 'Enter', isComposing: true });
  assert.equal(h.messages.filter(message => message.type === 'START_TASK').length, 0);
  await h.fire('.task', 'keydown', { key: 'Enter' });
  assert.deepEqual(h.messages.filter(message => message.type === 'START_TASK'), [{ type: 'START_TASK', task: 'open YouTube' }]);
  assert.deepEqual(h.spoken, ['Okay, sir.']);
  h.node('.task').value = '  '; await h.click('.go');
  assert.equal(h.node('.task').focused, true);
  assert.equal(h.messages.filter(message => message.type === 'START_TASK').length, 1);
});
