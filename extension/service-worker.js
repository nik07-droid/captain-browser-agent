const CAPTAIN_BUILD = '0.5.0';
function enforceActionPrivacy(action, elements = []) {
  const target = action?.target?.ref ? elements.find(element => element.ref === action.target.ref) : null;
  if (['type', 'select', 'press', 'submit'].includes(action?.type) && target?.sensitive) throw new Error('Remote control of a sensitive field was blocked. Use local secure input.');
  if (action?.type === 'request_local_input') {
    if (!target?.sensitive) throw new Error('Local secure input requires an observed sensitive field.');
    if (!['password', 'otp', 'pin', 'cvv', 'card', 'token', 'api-key', 'secret', 'security-answer'].includes(action.inputType)) throw new Error('Unsupported local secure input type.');
    if (['value', 'text', 'secret', 'data'].some(key => Object.hasOwn(action, key))) throw new Error('A local secure-input action must not contain a value.');
  }
  return target;
}
const DEFAULTS = { serverUrl: 'http://127.0.0.1:4317', maxSteps: 12, includeScreenshot: true };
let running = false;
let taskAbort;
let preferDebuggerCapture = false;
let humanHandoff = null;
const SAFE_EVENT_FIELDS = new Set(['step', 'actionType', 'phase', 'status', 'provider', 'model', 'latencyMs', 'piiDetected', 'recoveryCount', 'pageChange', 'reasonCode']);
function timelineEvent(timeline, started, type, metadata = {}) {
  const safe = Object.fromEntries(Object.entries(metadata).filter(([key, value]) => SAFE_EVENT_FIELDS.has(key) && ['string', 'number', 'boolean'].includes(typeof value)).map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 80) : value]));
  timeline.push({ type, atMs: Math.max(0, Math.round(performance.now() - started)), ...safe });
  if (timeline.length > 260) timeline.splice(0, timeline.length - 260);
}
function pageChange(before, after) {
  if (!before) return 'INITIAL';
  if (after?.challenge?.detected) return 'BLOCKED';
  if (before.url !== after?.url) return 'NAVIGATION';
  if (before.pageMetadata?.domFingerprint === after?.pageMetadata?.domFingerprint && before.pageMetadata?.visibleTextHash === after?.pageMetadata?.visibleTextHash) return 'NO_CHANGE';
  if (after?.pageMetadata?.meaningfulContent === false) return 'LOADING';
  return 'EXPECTED_CHANGE';
}
function checkpoint() { if (taskAbort?.signal.aborted) throw new Error('Task cancelled. An action already sent to the page cannot be undone.'); }
async function bounded(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out; the action was not repeated.`)), ms); })]); }
  finally { clearTimeout(timer); }
}
async function bindTarget(tab, originId) {
  const binding = { tabId: tab.id, windowId: tab.windowId };
  const values = { [`captainWindow:${tab.windowId}`]: binding };
  if (originId) values[`captainTarget:${originId}`] = binding;
  await chrome.storage.session.set(values);
  return tab;
}
async function resolveTarget(tabId, controllerWindowId) {
  if (controllerWindowId) {
    const window = await chrome.windows.get(controllerWindowId);
    if (!window.incognito) throw new Error('CAPTAIN must run in an Incognito window.');
    const windowKey = `captainWindow:${controllerWindowId}`;
    const windowBinding = (await chrome.storage.session.get(windowKey))[windowKey];
    const legacyKey = `captainTarget:${tabId}`;
    const legacyBinding = tabId ? (await chrome.storage.session.get(legacyKey))[legacyKey] : null;
    const selected = windowBinding || legacyBinding;
    const selectedId = selected?.tabId || tabId;
    let tab;
    if (selectedId) { try { tab = await chrome.tabs.get(selectedId); } catch { /* Closed target: recover inside the controller's window. */ } }
    if (tab && (!tab.incognito || tab.windowId !== controllerWindowId)) throw new Error('The working tab moved to another window. Open CAPTAIN from a website tab in this Incognito window to reconnect.');
    if (tab?.url?.startsWith(chrome.runtime.getURL(''))) tab = null;
    if (!tab) {
      checkpoint();
      tab = await chrome.tabs.create({ windowId: controllerWindowId, url: 'about:blank', active: true });
      await bindTarget(tab, tabId);
      return { ...tab, captainRecovered: true };
    }
    return bindTarget(tab, tabId);
  }
  if (!tabId) return activeTab();
  const key = `captainTarget:${tabId}`;
  const saved = (await chrome.storage.session.get(key))[key];
  let tab;
  try { tab = await chrome.tabs.get(saved?.tabId || tabId); }
  catch { throw new Error('The selected task tab was closed. Open CAPTAIN from the website tab you want to control.'); }
  if (saved && tab.windowId !== saved.windowId) throw new Error('The selected tab moved to another window. Reconnect CAPTAIN from that tab.');
  return tab;
}
async function sessionTarget(windowId, originId) {
  if (!windowId) return null;
  const key = `captainWindow:${windowId}`, saved = (await chrome.storage.session.get(key))[key];
  const legacyKey = `captainTarget:${originId}`, legacy = originId ? (await chrome.storage.session.get(legacyKey))[legacyKey] : null;
  const id = saved?.tabId || legacy?.tabId || originId;
  let tab;
  try { if (id) tab = await chrome.tabs.get(id); } catch {}
  const connected = !!tab?.incognito && tab.windowId === windowId && !tab.url?.startsWith(chrome.runtime.getURL(''));
  return { connected, windowId, tabId: connected ? tab.id : null, message: connected ? `Working tab ${tab.id} · same Incognito window` : 'No working tab. Your next command will open one in this Incognito window.' };
}
const PRIVATE_TEXT = [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, /(?<!\d)(?:\+?91[-\s]?)?[6-9]\d{9}(?!\d)/g, /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, /\b[A-Z]{5}\d{4}[A-Z]\b/g];
function sanitizeCommand(value) { return [...PRIVATE_TEXT, /\b(?:\d[ -]*?){13,19}\b/g].reduce((text, pattern) => text.replace(pattern, '[REDACTED_PII]'), String(value)); }
function sanitizePayload(value, key = '') {
  if (key === 'screenshot' || key === 'imageSha256' || key === 'modelSha256') return value;
  if (typeof value === 'string') return sanitizeCommand(value);
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
  if (Array.isArray(value)) return value.map(item => sanitizePayload(item, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sanitizePayload(v, k)]));
  return value;
}

async function settings() { return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) }; }
async function state(value) { await chrome.storage.local.set({ captainState: { updatedAt: Date.now(), ...value } }); }
async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return tab; }
async function chromeEdit(operation) {
  for (let attempt = 0; ; attempt++) {
    checkpoint();
    try { return await operation(); }
    catch (error) {
      // Chrome explicitly rejects these edits during tab-strip interactions.
      // No other failure (especially an uncertain action) is repeated here.
      if (attempt >= 9 || !/tabs cannot be edited right now/i.test(error.message)) throw error;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
}
async function focusTarget(tab) {
  let window = await chrome.windows.get(tab.windowId);
  if (window.state === 'minimized') {
    await chromeEdit(() => chrome.windows.update(tab.windowId, { state: 'normal' }));
    window = await chrome.windows.get(tab.windowId);
  }
  // Some Windows restore paths leave a title-bar-sized window, not a usable viewport.
  if (window.state === 'normal' && (window.height < 400 || window.width < 600)) await chromeEdit(() => chrome.windows.update(tab.windowId, { width: 1180, height: 800, left: 20, top: 20 }));
  await chromeEdit(() => chrome.tabs.update(tab.id, { active: true }));
  await chromeEdit(() => chrome.windows.update(tab.windowId, { focused: true }));
}
async function verifyRequestedPlayback(tab, query, onWait) {
  const deadline = Date.now() + 90000;
  let verification, resumeAttempts = 0;
  do {
    checkpoint();
    await focusTarget(tab);
    verification = await send(tab.id, { type: 'EXECUTE', action: { type: 'verifyPlayback', query } });
    if (verification.ok && verification.verified === true) return verification;
    if (!verification.retryable) throw new Error(verification.error || 'The page did not provide verified playback evidence.');
    await onWait(verification.error);
    if (verification.needsResume && resumeAttempts < 2) {
      // An ad/source transition can pause the requested video after play was accepted.
      // Retry only a title-checked paused player, not buffering media or unknown pages.
      checkpoint();
      resumeAttempts++;
      const resumed = await send(tab.id, { type: 'EXECUTE', action: { type: 'media', operation: 'play' } });
      if (resumed.requiresPlayClick) await trustedPlayClick(tab, resumed.requiresPlayClick);
      else if (!resumed.ok) throw new Error(resumed.error || 'Could not resume the requested player.');
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  } while (Date.now() < deadline);
  throw new Error(`Playback was not verified within 90 seconds. ${verification.error}`);
}
async function trustedPlayClick(tab, point) {
  checkpoint();
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y) || point.x < 0 || point.y < 0) throw new Error('Invalid player control position.');
  if (!chrome.debugger?.attach) throw new Error('This browser does not support the trusted coordinate-click fallback.');
  const debuggee = { tabId: tab.id };
  await focusTarget(tab);
  await chrome.debugger.attach(debuggee, '1.3');
  try {
    checkpoint();
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  } finally { await chrome.debugger.detach(debuggee); }
}
async function send(tabId, message, retries = message.type === 'OBSERVE' ? 45 : 1) {
  const deadline = Date.now() + 30000;
  let reinjected = false, lastError;
  for (let i = 0; i < retries; i++) {
    checkpoint();
    if (Date.now() >= deadline) break;
    try { return await bounded(chrome.tabs.sendMessage(tabId, message), 8000, 'Page response'); }
    catch (error) {
      if (message.type !== 'OBSERVE') throw error;
      lastError = error;
      if (!reinjected && /receiving end does not exist|could not establish connection|extension context invalidated/i.test(error.message)) {
        checkpoint();
        const tab = await chrome.tabs.get(tabId);
        if (!tab.incognito) throw new Error('Page reconnection requires an Incognito tab.');
        // Do not spend the one recovery attempt on an old/unloading document.
        // Once the committed HTTPS page is complete, inject exactly once.
        if (tab.status === 'complete' && !tab.pendingUrl && /^https?:\/\//.test(tab.url || '')) {
          await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] });
          reinjected = true;
        }
      }
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  throw new Error(message.type === 'OBSERVE' ? `The page did not become readable within 30 seconds. ${lastError?.message || 'Check whether it loaded or shows a network error.'}` : 'The page changed while executing the action; the action was not repeated.');
}
async function captureWorkingTab(tab) {
  let lastError;
  for (let attempt = 0; !preferDebuggerCapture && attempt < 2; attempt++) {
    checkpoint();
    await focusTarget(tab);
    const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (active?.id !== tab.id) throw new Error('Visual capture refused because the working tab is not active.');
    try { return await bounded(chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 82 }), 2500, 'Local screen capture'); }
    catch (error) {
      lastError = error;
      if (!/(?:image readback failed|Local screen capture timed out)/i.test(error.message || '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  if (!chrome.debugger?.attach) throw lastError;
  preferDebuggerCapture = true;
  const debuggee = { tabId: tab.id };
  await chrome.debugger.attach(debuggee, '1.3');
  try {
    checkpoint();
    const captured = await chrome.debugger.sendCommand(debuggee, 'Page.captureScreenshot', { format: 'jpeg', quality: 82, fromSurface: true });
    if (!captured?.data) throw lastError;
    return `data:image/jpeg;base64,${captured.data}`;
  } finally { await chrome.debugger.detach(debuggee); }
}
async function observe(tab, config) {
  if (/^(?:about:blank|chrome:\/\/|edge:\/\/)/.test(tab.url || '')) {
    return { url: 'about:blank', title: 'New browser tab', site: '', elements: [], media: [], piiCounts: {}, vision: { screenshot: 'disabled-until-complete-visual-redaction' } };
  }
  // Sign-in gates are not inbox content; navigation away needs no form inspection.
  if (new URL(tab.url || 'about:blank').hostname === 'accounts.google.com') return { url: 'https://accounts.google.com/', title: 'Google sign-in', site: '', elements: [], media: [], piiCounts: {}, vision: { screenshot: 'disabled-until-complete-visual-redaction' } };
  const domStarted = performance.now(), context = await send(tab.id, { type: 'OBSERVE' });
  context.localTiming = { ...context.localTiming, extensionDomRoundTripMs: Math.round(performance.now() - domStarted) };
  if (config.includeScreenshot) {
    const captureStarted = performance.now();
    const rawScreenshot = await captureWorkingTab(tab);
    context.localTiming.captureMs = Math.round(performance.now() - captureStarted);
    const visualStarted = performance.now();
    const visual = await bounded(chrome.runtime.sendMessage({ type: 'VISION_REDACT', windowId: tab.windowId, screenshot: rawScreenshot, viewport: context.viewport, redactionBoxes: context.redactionBoxes || [] }), 30000, 'Local visual privacy');
    context.localTiming.localVisionAndRedactionMs = Math.round(performance.now() - visualStarted);
    if (!visual?.ok || !visual.screenshot || visual.visualPrivacy?.sanitized !== true || visual.visualPrivacy?.rawScreenshotTransmitted !== false) throw new Error(`Local visual privacy failed; raw screen was withheld. ${visual?.error || ''}`.trim());
    context.screenshot = visual.screenshot;
    context.visualPrivacy = visual.visualPrivacy;
    context.screenshotMetadata = { sanitized: true, format: 'image/jpeg', bytes: visual.visualPrivacy.outputBytes, sha256: visual.visualPrivacy.imageSha256, rawScreenshotTransmitted: false };
    context.pageMetadata = { ...context.pageMetadata, sanitizedScreenshotFingerprint: visual.visualPrivacy.imageSha256 };
    context.vision = { ...context.vision, mode: 'DOM+UltraFace+local-redaction', status: 'sanitized', faces: visual.visualPrivacy.faces, redactionBoxes: visual.visualPrivacy.domBoxes, inferenceMs: visual.visualPrivacy.inferenceMs, totalMs: visual.visualPrivacy.totalMs };
  } else if (config.amazonDomFastPath) context.vision = { ...context.vision, mode: 'DOM+Amazon-semantic-fast-path', status: 'dom-sanitized-fast-path', rawScreenshotTransmitted: false };
  else context.vision = { ...context.vision, status: 'visual-disabled' };
  delete context.redactionBoxes;
  return context;
}
async function navigateSameTab(tabId, rawUrl, expected = {}) {
  const navigationStarted = Date.now();
  const destination = new URL(rawUrl);
  if (!['https:', 'http:'].includes(destination.protocol)) throw new Error('Unsupported navigation URL.');
  const tab = await chrome.tabs.get(tabId);
  if (!tab.incognito) throw new Error('Navigation requires Incognito.');
  await chromeEdit(() => chrome.tabs.update(tabId, { url: destination.href }));
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    checkpoint();
    const current = await chrome.tabs.get(tabId);
    let arrived = false, sameHost = false;
    try {
      const actual = new URL(current.url);
      sameHost = actual.hostname.replace(/^www\./, '') === destination.hostname.replace(/^www\./, '');
      const queryMatches = [...destination.searchParams].every(([k,v]) => actual.searchParams.get(k) === v);
      const exactPath = actual.pathname === destination.pathname;
      const homeRedirect = destination.pathname === '/' && !destination.search && current.url !== tab.url;
      const slashRedirect = actual.pathname.replace(/\/$/, '') === destination.pathname.replace(/\/$/, '');
      arrived = sameHost && queryMatches && (exactPath || homeRedirect || slashRedirect);
    } catch {}
    let signIn = false, gmailLanding = false;
    try {
      const actual = new URL(current.url);
      signIn = ['mail.google.com', 'accounts.google.com'].includes(destination.hostname) && actual.hostname === 'accounts.google.com';
      gmailLanding = destination.hostname === 'mail.google.com' && actual.hostname === 'workspace.google.com' && /^\/(?:intl\/[a-z-]+\/)?gmail\/?$/i.test(actual.pathname);
    } catch {}
    if ((arrived || signIn || gmailLanding) && current.status === 'complete' && !current.pendingUrl) return { ok: true, navigated: true, navigationMs: Date.now() - navigationStarted, ...(signIn || gmailLanding ? { requiresSignIn: true } : {}) };
    // Streaming pages can remain "loading" after their usable DOM is ready.
    if ((arrived || (expected.searchValue && sameHost)) && !current.pendingUrl) {
      let timer;
      try {
        const readinessBudgetMs = /(^|\.)amazon\.in$/i.test(destination.hostname) ? 900 : 1200;
        const readable = await Promise.race([chrome.tabs.sendMessage(tabId, { type: 'READINESS' }), new Promise(resolve => { timer = setTimeout(() => resolve(null), readinessBudgetMs); })]);
        const usable = (readable?.ready && readable?.meaningfulContent) || (Array.isArray(readable?.elements) && readable.elements.length > 0);
        if (readable?.url === `${destination.origin}${destination.pathname}` && usable) return { ok: true, navigated: true, navigationMs: Date.now() - navigationStarted };
        const observedQuery = String(readable?.searchQuery || '').trim().toLocaleLowerCase();
        const expectedQuery = String(expected.searchValue || '').trim().toLocaleLowerCase();
        if (sameHost && expectedQuery && observedQuery === expectedQuery && usable) return { ok: true, navigated: true, canonicalized: true, navigationMs: Date.now() - navigationStarted };
      } catch {} finally { clearTimeout(timer); }
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('The requested page did not finish loading in 45 seconds. Navigation was not repeated.');
}
async function backSameTab(tabId) {
  const started = Date.now(), before = await chrome.tabs.get(tabId);
  const requested = await chrome.tabs.sendMessage(tabId, { type: 'EXECUTE', action: { type: 'back' } });
  if (!requested?.ok) throw new Error(requested?.error || 'The page could not request back navigation.');
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    checkpoint();
    const current = await chrome.tabs.get(tabId);
    if (!current.pendingUrl && current.url !== before.url) {
      try {
        const observed = await bounded(chrome.tabs.sendMessage(tabId, { type: 'READINESS' }), 900, 'Back-navigation readiness');
        if (observed?.ready && observed?.meaningfulContent) return { ok: true, navigated: true, navigationMs: Date.now() - started };
      } catch { /* The returning document may still be committing. */ }
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('The previous page did not become usable within 30 seconds.');
}
function completionSummary(plan, result, verification) {
  const message = result.message || plan.action.message;
  if (plan.action.clarification) return { phase: 'Waiting for your answer', phaseCode: 'VERIFYING', completionStatus: 'PARTIAL', message };
  if (plan.action.completionStatus && plan.action.completionStatus !== 'COMPLETED') return { phase: plan.action.completionStatus === 'PARTIAL' ? 'Partial result' : plan.action.completionStatus, phaseCode: plan.action.completionStatus, completionStatus: plan.action.completionStatus, outcomeVerified: false, message };
  if (['ollama', 'remote-vlm'].includes(plan.planner) && verification?.verified !== true) return { phase: 'Review required', phaseCode: 'VERIFYING', completionStatus: 'PARTIAL', outcomeVerified: false, message: `The planner stopped with this message: ${message || 'No result provided.'} This result has not been independently verified. Please check the page.` };
  return { phase: 'Complete', phaseCode: 'COMPLETED', completionStatus: 'COMPLETED', outcomeVerified: true, message };
}
async function run(task, tabId, controllerWindowId) {
  if (running) throw new Error('A CAPTAIN task is already running');
  running = true;
  taskAbort = new AbortController();
  const history = [];
  const handoffMetrics = { captchaDetected: false, handoffDuration: 0, resumed: false, taskCompletedAfterHandoff: false };
  const started = performance.now();
  const timeline = [];
  const failedActionSignatures = new Set();
  let recoveryCount = 0, previousContext = null;
  timelineEvent(timeline, started, 'TASK_STARTED', { status: 'OBSERVING' });
  let taskWindowId = controllerWindowId;
  const saveState = value => state({ windowId: taskWindowId, timeline, recoveryCount, ...value });
  try {
    const config = await settings();
    // Amazon can legitimately require several identity-checked backtracks when
    // a low-price result redirects to a different ASIN. Keep this site-specific
    // recovery bounded without increasing the budget for ordinary commands.
    const taskStepLimit = /\bamazon\b/i.test(task) && /\blaptop(?:s)?\b/i.test(task) ? Math.max(config.maxSteps, 18) : config.maxSteps;
    const amazonFastPath = /\bamazon\b/i.test(task) && /\blaptop(?:s)?\b/i.test(task);
    const observationConfig = { ...config, includeScreenshot: config.includeScreenshot && !amazonFastPath, amazonDomFastPath: amazonFastPath };
    await saveState({ status: 'running', task, phase: 'OBSERVING', history });
    let tab = await resolveTarget(tabId, controllerWindowId);
    if (!tab?.incognito) throw new Error('Open CAPTAIN in an Incognito tab to run commands.');
    taskWindowId = tab.windowId;
    // Recovery already supplies the one requested new tab; do not create two.
    if (/\bin (?:a )?new tab\b/i.test(task) && !tab.captainRecovered) {
      const created = await chrome.tabs.create({ windowId: tab.windowId, url: 'about:blank', active: true });
      await bindTarget(created, tabId);
      tab = created;
    }
    if (chrome.storage.session.set) await bindTarget(tab, tabId);
    await focusTarget(tab);
    for (let step = 1; step <= taskStepLimit; step++) {
      checkpoint();
      tab = await chrome.tabs.get(tab.id);
      if (!tab.incognito) throw new Error('CAPTAIN actions require an Incognito tab.');
      timelineEvent(timeline, started, 'SCREEN_CAPTURED', { step });
      let context = await observe(tab, observationConfig);
      const measured = context.localTiming || {};
      for (const [type, key] of [['PAGE_READY','readinessMs'],['DOM_EXTRACTION','domExtractionMs'],['ACCESSIBILITY_EXTRACTION','accessibilityExtractionMs'],['AMAZON_EXTRACTION','amazonExtractionMs'],['PRIVACY_SCAN','privacyRegionMs'],['SCREEN_CAPTURE','captureMs'],['LOCAL_VISION_REDACTION','localVisionAndRedactionMs'],['PERCEPTION_TOTAL','extensionDomRoundTripMs'],['OCR','ocrMs']]) if (Number.isFinite(measured[key])) timelineEvent(timeline, started, type, { step, latencyMs: measured[key] });
      const change = pageChange(previousContext, context);
      if (history.length && !history.at(-1).pageChange) history.at(-1).pageChange = change;
      timelineEvent(timeline, started, 'PERCEPTION_COMPLETE', { step, pageChange: change });
      previousContext = context;
      checkpoint();
      const piiDetected = Object.values(context.piiCounts || {}).reduce((a, b) => a + b, 0);
      timelineEvent(timeline, started, 'PRIVACY_SCAN_COMPLETE', { step, piiDetected });
      if (context.challenge?.detected) {
        handoffMetrics.captchaDetected = true;
        const handoffStarted = Date.now();
        timelineEvent(timeline, started, 'HUMAN_ACTION_REQUIRED', { step, reasonCode: 'CAPTCHA' });
        await saveState({ status: 'waiting_human', task, phase: 'HUMAN_ACTION_REQUIRED', completionStatus: 'BLOCKED', message: 'Human verification required. Please complete the verification in your browser, then press Resume CAPTAIN.', step, piiDetected, vision: context.vision, history, captchaDetected: true, handoffState: 'WAITING_FOR_HUMAN', resumed: false });
        const handoff = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Human verification timed out after 15 minutes. The task was not resumed.')), 15 * 60 * 1000);
          humanHandoff = { tabId: tab.id, windowId: tab.windowId, resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
        });
        humanHandoff = null;
        checkpoint();
        timelineEvent(timeline, started, 'RECOVERY_STARTED', { step, reasonCode: 'HUMAN_VERIFICATION_CLEARED', recoveryCount: recoveryCount + 1 });
        recoveryCount++;
        await saveState({ status: 'running', task, phase: 'RESUMING', phaseCode: 'RECOVERING', message: 'Verification cleared. Re-observing the page locally before resuming.', step, piiDetected, vision: context.vision, history, captchaDetected: true, handoffState: 'VERIFICATION_CLEARED', handoffDuration: Date.now() - handoffStarted, resumed: true });
        context = handoff.context;
        handoffMetrics.handoffDuration += Date.now() - handoffStarted;
        handoffMetrics.resumed = true;
        if (context.challenge?.detected) throw new Error('Human verification is still present. CAPTAIN did not resume.');
      }
      await saveState({ status: 'running', task, phase: 'PROTECTING_PRIVACY', step, piiDetected, vision: context.vision, history });
      const payloadStarted = performance.now();
      const payload = JSON.stringify(sanitizePayload({ task: task.replace(/\s+in (?:a )?new tab\b/i, ''), context, history }));
      timelineEvent(timeline, started, 'SANITIZATION_PAYLOAD', { step, latencyMs: Math.round(performance.now() - payloadStarted) });
      timelineEvent(timeline, started, 'REQUEST_SENT', { step, provider: 'planner' });
      const requestStarted = performance.now();
      const response = await bounded(fetch(`${config.serverUrl}/api/agent/step`, { signal: taskAbort.signal, method: 'POST', headers: { 'content-type': 'application/json' }, body: payload }), 100000, 'Planner');
      const plan = await response.json();
      timelineEvent(timeline, started, 'NETWORK_AND_SERVER', { step, latencyMs: Math.round(performance.now() - requestStarted) });
      if (plan.serverTiming) {
        timelineEvent(timeline, started, 'SERVER_RECEIVE_PARSE', { step, latencyMs: plan.serverTiming.bodyParseMs || 0 });
        timelineEvent(timeline, started, 'SERVER_PRIVACY_BOUNDARY', { step, latencyMs: plan.serverTiming.privacyBoundaryMs || 0 });
        timelineEvent(timeline, started, 'PLANNER', { step, latencyMs: plan.serverTiming.plannerMs || 0, provider: plan.planner || 'unknown' });
      }
      if (!response.ok) throw new Error(`${plan.error || `Agent server error ${response.status}`}${plan.categories ? ` (${plan.categories.join(', ')})` : ''}`);
      checkpoint();
      // Enforce locally before persisting planner output or sending an action
      // to the page. A malicious/buggy server cannot type or submit credentials.
      enforceActionPrivacy(plan.action, context.elements || []);
      timelineEvent(timeline, started, 'PLAN_RECEIVED', { step, provider: plan.planner || 'unknown', model: plan.model || '' });
      const actionSignature = JSON.stringify({ type: plan.action.type, target: plan.action.target?.ref, value: plan.action.value, url: plan.action.url });
      if (failedActionSignatures.has(actionSignature)) throw new Error('No progress: the planner repeated the same failed action after recovery.');
      timelineEvent(timeline, started, 'ACTION_STARTED', { step, actionType: plan.action.type });
      const actionStarted = performance.now();
      await saveState({ status: 'running', task, phase: 'EXECUTING', step, piiDetected, history: [...history, plan] });
      let result;
      if (plan.action.type === 'media' && plan.action.operation === 'play') {
        // Chrome may defer playback while a tab is hidden without rejecting play().
        await focusTarget(tab);
        checkpoint();
      }
      if (plan.action.type === 'finish') result = { ok: true, done: true, message: plan.action.message };
      else if (plan.action.type === 'navigate') result = await navigateSameTab(tab.id, plan.action.url);
      else if (plan.action.type === 'back') result = await backSameTab(tab.id);
      else {
        result = await send(tab.id, { type: 'EXECUTE', action: plan.action });
        if (result.navigateUrl) result = await navigateSameTab(tab.id, result.navigateUrl, { searchValue: result.expectedSearchValue });
        if (result.requiresPlayClick) {
          await trustedPlayClick(tab, result.requiresPlayClick);
          result = { ok: true, pending: 'Play clicked; verifying playback on next observation' };
        }
      }
      history.push({ ...plan, result });
      timelineEvent(timeline, started, 'ACTION_COMPLETED', { step, actionType: plan.action.type, status: result.ok ? 'ok' : 'failed', latencyMs: Math.round(performance.now() - actionStarted) });
      if (Number.isFinite(result.navigationMs)) timelineEvent(timeline, started, 'PAGE_NAVIGATION', { step, actionType: plan.action.type, latencyMs: result.navigationMs });
      if (plan.action.type === 'finish' || result.done) {
        if (!plan.action.clarification && plan.action.verification?.type === 'playback') {
          await focusTarget(tab);
          timelineEvent(timeline, started, 'VERIFICATION_STARTED', { step });
          const verification = await verifyRequestedPlayback(tab, plan.action.verification.query || '', message => saveState({ status: 'running', task, phase: 'VERIFYING', message, step, piiDetected, history }));
          history[history.length - 1].verification = verification;
        }
        checkpoint();
        const latencyMs = Math.round(performance.now() - started);
        handoffMetrics.taskCompletedAfterHandoff = handoffMetrics.resumed;
        const completion = completionSummary(plan, result, history[history.length - 1].verification);
        timelineEvent(timeline, started, completion.completionStatus === 'COMPLETED' ? 'TASK_COMPLETED' : 'TASK_PARTIAL', { step, status: completion.completionStatus, latencyMs });
        await saveState({ status: 'complete', task, ...completion, requiresInput: !!plan.action.clarification, followUpPrefix: plan.action.followUpPrefix || '', step, piiDetected, vision: context.vision, latencyMs, history, ...handoffMetrics });
        fetch(`${config.serverUrl}/api/metrics`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ latencyMs, piiDetected, steps: step, vision: context.vision }) }).catch(() => {});
        return;
      }
      if (!result.ok) {
        const recoverable = recoveryCount < 2 && (result.retryable || /target not found|stale|changed while executing/i.test(result.error || ''));
        if (!recoverable) throw new Error(result.error);
        failedActionSignatures.add(actionSignature); recoveryCount++;
        timelineEvent(timeline, started, 'RECOVERY_STARTED', { step, reasonCode: /target not found/i.test(result.error || '') ? 'ELEMENT_NOT_FOUND' : 'STALE_ELEMENT', recoveryCount });
        await saveState({ status: 'running', task, phase: 'RECOVERING', message: 'The page changed. Re-observing before choosing another grounded action.', step, piiDetected, history });
        await new Promise(resolve => setTimeout(resolve, 500 * recoveryCount));
        continue;
      }
      // Scrolling updates geometry immediately; a short paint-settle delay keeps
      // the action loop responsive without weakening navigation/click waits.
      const settleMs = amazonFastPath
        ? result.navigated ? 80 : plan.action.type === 'scroll' ? 100 : plan.action.type === 'wait' ? 0 : plan.action.type === 'select' ? 200 : 80
        : result.navigated ? 1800 : plan.action.type === 'scroll' ? 250 : 900;
      const settleStarted = performance.now();
      await new Promise((r) => setTimeout(r, settleMs));
      timelineEvent(timeline, started, 'PAGE_STABLE_WAIT', { step, latencyMs: Math.round(performance.now() - settleStarted) });
      tab = await chrome.tabs.get(tab.id);
    }
    throw new Error(`Stopped after ${taskStepLimit} steps`);
  } catch (error) {
    timelineEvent(timeline, started, 'TASK_FAILED', { status: taskAbort?.signal.aborted ? 'CANCELLED' : 'FAILED' });
    await saveState({ status: 'error', task, phase: taskAbort?.signal.aborted ? 'Cancelled' : 'Stopped', phaseCode: taskAbort?.signal.aborted ? 'CANCELLED' : 'FAILED', completionStatus: 'FAILED', message: taskAbort?.signal.aborted ? 'Cancelled. No further actions will be sent; an action already sent cannot be undone.' : error.message, history, ...handoffMetrics });
  }
  finally { humanHandoff = null; taskAbort = null; running = false; }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'CANCEL_TASK') { taskAbort?.abort(); humanHandoff?.reject(new Error('Task cancelled during human verification.')); humanHandoff = null; respond({ ok: true, running }); return; }
  if (message.type === 'RESUME_TASK') {
    (async () => {
      if (!humanHandoff) return { ok: false, error: 'CAPTAIN is not waiting for human verification.' };
      const tab = await chrome.tabs.get(humanHandoff.tabId);
      if (!tab.incognito || tab.windowId !== humanHandoff.windowId) return { ok: false, error: 'The verification tab moved or is no longer Incognito.' };
      const context = await send(tab.id, { type: 'OBSERVE' });
      if (context.challenge?.detected) return { ok: false, error: 'Human verification is still visible. Complete it before resuming CAPTAIN.' };
      const handoff = humanHandoff; humanHandoff = null; handoff.resolve({ context });
      return { ok: true, handoffState: 'VERIFICATION_CLEARED' };
    })().then(respond, error => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'OPEN_VOICE') {
    (async () => {
      const tab = sender.tab || await activeTab();
      if (!tab?.incognito) throw new Error('Voice control requires an Incognito tab.');
      const controllerBase = chrome.runtime.getURL('popup.html');
      const controllerUrl = chrome.runtime.getURL(`popup.html?window=${tab.windowId}`);
      if (!tab.url?.startsWith(chrome.runtime.getURL(''))) await bindTarget(tab);
      const controllers = await chrome.tabs.query({ windowId: tab.windowId });
      const existing = controllers.find(item => item.incognito && item.windowId === tab.windowId && item.url?.split(/[?#]/, 1)[0] === controllerBase);
      if (existing) {
        const update = { active: true };
        // A toolbar/startup popup can be opened without routing parameters.
        // Reuse that tab and give it its actual window; never auto-enable audio.
        // Already initialized controllers must not be navigated away from an
        // active microphone session merely because the page panel was clicked.
        if (!new URL(existing.url).search) update.url = controllerUrl;
        await chromeEdit(() => chrome.tabs.update(existing.id, update));
      } else await chromeEdit(() => chrome.tabs.create({ windowId: tab.windowId, url: controllerUrl, active: true }));
      respond({ ok: true });
    })().catch(error => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'START_TASK') {
    if (running) { respond({ ok: false, error: 'A task is already running.' }); return; }
    if (typeof message.task !== 'string' || !message.task.trim()) { respond({ ok: false, error: 'Enter a command.' }); return; }
    const fromVoiceWindow = sender.url?.startsWith(chrome.runtime.getURL('popup.html'));
    const targetId = fromVoiceWindow ? message.tabId : sender.tab?.id;
    const controllerWindowId = fromVoiceWindow ? sender.tab?.windowId : undefined;
    run(message.task, targetId, controllerWindowId).catch(error => state({ status: 'error', message: error.message }));
    respond({ ok: true });
  }
  if (message.type === 'GET_STATE') {
    (async () => {
      const saved = (await chrome.storage.local.get('captainState')).captainState;
      const windowId = sender.tab?.windowId;
      const originId = sender.url?.startsWith(chrome.runtime.getURL('popup.html')) ? Number(new URL(sender.url).searchParams.get('target')) || undefined : sender.tab?.id;
      const value = saved && (!windowId || saved.windowId === windowId) ? saved : { status: 'idle' };
      respond({ ...value, build: CAPTAIN_BUILD, session: await sessionTarget(windowId, originId) });
    })().catch(error => respond({ status: 'error', message: error.message, build: CAPTAIN_BUILD }));
    return true;
  }
});
