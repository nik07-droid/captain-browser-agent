const $ = (q) => document.querySelector(q);
let listening = false;
let voiceMode = 'sleeping';
window.captainVoiceMode = voiceMode;
let pendingVoiceTask = null;
let followUpPrefix = '';
let awakeTimer;
let micStarting = false;
let micSession = 0;
let restartTimer, startTimer;
function setVoiceMode(mode) {
  clearTimeout(awakeTimer);
  voiceMode = mode;
  window.captainVoiceMode = mode;
  if (listening || mode === 'busy') voiceStatus.textContent = mode === 'sleeping' ? 'Sleeping — say “Hey Captain”. Microphone remains on for the wake phrase.' : mode === 'awake' ? 'Awake — say one command, or “go to sleep”.' : 'Executing your command — then returning to sleep.';
  else voiceStatus.textContent = mode === 'awake' ? 'Type your answer, or enable the microphone.' : 'Microphone off — click Speak to enable wake listening.';
  if (mode === 'awake') awakeTimer = setTimeout(() => { if (voiceMode === 'awake') { followUpPrefix = ''; setVoiceMode('sleeping'); voiceStatus.textContent = listening ? 'No command heard. Sleeping — say “Hey Captain”.' : 'No answer received. Microphone off — click Speak or type a command.'; } }, 20000);
}
const Speech = self.SpeechRecognition || self.webkitSpeechRecognition;
const tabId = Number(new URL(location.href).searchParams.get('target')) || undefined;
const windowId = Number(new URL(location.href).searchParams.get('window')) || undefined;
let recognition;
let micStream, micContext, micAnalyser, micSamples;
window.captainMicLevel = 0;
function releaseMicrophone() {
  micStream?.getTracks().forEach(track => track.stop());
  micStream = null; micAnalyser = null; micSamples = null;
  micContext?.close().catch(() => {}); micContext = null;
  window.captainMicLevel = 0;
}
function stopMicrophone(message) {
  // Invalidate callbacks before abort(), which may synchronously fire onend.
  micSession++;
  listening = false; micStarting = false;
  clearTimeout(restartTimer); clearTimeout(startTimer); clearTimeout(awakeTimer);
  restartTimer = null; startTimer = null;
  const previous = recognition; recognition = null;
  try { previous?.abort(); } catch {}
  releaseMicrophone();
  followUpPrefix = '';
  // Turning the mic off does not cancel or unlock the browser task.
  setVoiceMode(pendingVoiceTask || voiceMode === 'busy' ? 'busy' : 'sleeping');
  $('#voice').textContent = '🎙 Speak';
  if (message) voiceStatus.textContent = `${message}${voiceMode === 'busy' ? ' Your browser task is still running; use Cancel task to stop it.' : ''}`;
}
function measureMicrophone() {
  if (micAnalyser && micSamples) {
    micAnalyser.getFloatTimeDomainData(micSamples);
    let sum = 0; for (const sample of micSamples) sum += sample * sample;
    const volume = Math.min(1, Math.max(0, Math.sqrt(sum / micSamples.length) - 0.008) * 10);
    window.captainMicLevel += (volume - window.captainMicLevel) * (volume > window.captainMicLevel ? 0.65 : 0.18);
  }
  requestAnimationFrame(measureMicrophone);
}
requestAnimationFrame(measureMicrophone);
addEventListener('pagehide', () => stopMicrophone());
let lastSpoken = Date.now();
function speak(text) {
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-IN';
  speechSynthesis.speak(utterance);
}
const voiceStatus = document.querySelector('#voice-status');
voiceStatus.style.cssText = 'color:#a1a1aa;font-size:12px';
voiceStatus.textContent = 'Click Speak once, allow the microphone, then say “Hey Captain”.';

async function refresh() {
  let s;
  try { s = await chrome.runtime.sendMessage({ type: 'GET_STATE' }); }
  catch { voiceStatus.textContent = 'Extension disconnected. Reload CAPTAIN before sending another command.'; return; }
  if (s.build && s.build !== '0.5.0') { $('#run').disabled = true; voiceStatus.textContent = 'CAPTAIN components are out of date. Run npm run reload in the project folder.'; return; }
  if ($('#target-status')) $('#target-status').textContent = s.session?.message || '';
  $('#phase').textContent = s.phase || (s.status === 'idle' ? 'Ready' : s.status);
  $('#message').textContent = s.message || (s.status === 'running' ? `Working on: ${s.task}` : 'Screenshots withheld. DOM text is filtered locally.');
  $('#step').textContent = s.step || 0; $('#pii').textContent = s.piiDetected || 0;
  $('#latency').textContent = s.latencyMs ? `${(s.latencyMs / 1000).toFixed(1)}s` : '—';
  const waitingHuman = s.status === 'waiting_human';
  $('#dot').classList.toggle('running', s.status === 'running' || waitingHuman); $('#shield').textContent = 'Incognito';
  $('#run').disabled = s.status === 'running' || waitingHuman;
  $('#cancel-task').disabled = !['running', 'waiting_human'].includes(s.status);
  $('#resume-task').hidden = !waitingHuman;
  if (s.updatedAt > lastSpoken && ['complete', 'error'].includes(s.status)) {
    lastSpoken = s.updatedAt;
    if (s.requiresInput && pendingVoiceTask === s.task) {
      pendingVoiceTask = null;
      followUpPrefix = s.followUpPrefix || '';
      setVoiceMode('awake'); voiceStatus.textContent = s.message;
      speak(s.message); return;
    }
    if (pendingVoiceTask === s.task) { pendingVoiceTask = null; setVoiceMode('sleeping'); }
    speak(s.status === 'complete' ? s.completionStatus === 'COMPLETED' && s.outcomeVerified !== false ? `Done, sir. ${s.message || ''}` : `I could not fully complete that, sir. ${s.message || ''}` : `Sorry, sir. ${s.message || 'The task stopped.'}`);
  }
}
$('#resume-task').onclick = async () => {
  $('#resume-task').disabled = true;
  voiceStatus.textContent = 'Checking locally that human verification is cleared…';
  try {
    const result = await chrome.runtime.sendMessage({ type: 'RESUME_TASK' });
    voiceStatus.textContent = result.ok ? 'Verification cleared. CAPTAIN is resuming.' : result.error;
  } catch (error) { voiceStatus.textContent = error.message; }
  finally { $('#resume-task').disabled = false; }
};
async function dispatchCommand(command) {
  if (voiceMode === 'busy' || pendingVoiceTask) { voiceStatus.textContent = listening ? 'A task is running. Say “cancel” or wait for the result.' : 'A task is running. Use Cancel task or wait for the result.'; return; }
  setVoiceMode('busy'); pendingVoiceTask = command; followUpPrefix = '';
  $('#task').value = command;
  $('#heard').textContent = `You said: ${command}`;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'START_TASK', task: command, tabId });
    if (result.ok) speak('Okay, sir.');
    else { pendingVoiceTask = null; setVoiceMode('sleeping'); voiceStatus.textContent = result.error; speak(`Sorry, sir. ${result.error}`); }
  } catch { pendingVoiceTask = null; setVoiceMode('sleeping'); voiceStatus.textContent = 'CAPTAIN could not connect. Reload the extension and try again.'; }
}
async function handleVoicePhrase(phrase, wakeAlreadyDetected = false) {
  phrase = String(phrase || '').trim();
  if (!phrase) return;
  if (/^(?:captain[, ]+)?(?:cancel(?: task)?|stop)[.!]*$/i.test(phrase) && voiceMode === 'busy') { speechSynthesis.cancel(); await $('#cancel-task').onclick(); return; }
  if (!wakeAlreadyDetected && speechSynthesis.speaking) return;
  if (voiceMode === 'busy') return;
  const wake = !wakeAlreadyDetected && (phrase.match(/^(?:hey[\s,]+captain|captain|wake\s+up\s+captain)\b[\s,.:!?]*(.*)$/i) || phrase.match(/^hey[\s,!:]+((?:open|launch|go to|navigate|play|put on|listen to|search|find|pause|resume|scroll)\b.*)$/i));
  if (wakeAlreadyDetected) { followUpPrefix = ''; setVoiceMode('awake'); }
  if (wake) {
    followUpPrefix = ''; setVoiceMode('awake');
    if (!wake[1].trim()) { speak('Yes, sir. What should I do?'); return; }
  }
  if (voiceMode !== 'awake') return;
  const request = wake ? wake[1].trim() : phrase;
  if (/^(?:go to sleep|sleep(?: captain)?|cancel)[.!?,]*$/i.test(request)) { followUpPrefix = ''; setVoiceMode('sleeping'); speak('Going to sleep, sir.'); return; }
  const command = completeFollowUp(request);
  if (command) await dispatchCommand(command);
}

let edgeSocket, edgeReconnect;
async function connectEdgeVoice() {
  if (typeof WebSocket !== 'function' || !chrome.storage?.sync || !chrome.storage?.local) return;
  const [settings, local] = await Promise.all([chrome.storage.sync.get({ edgeAsrUrl: '', edgeClientId: 'captain-browser' }), chrome.storage.local.get({ edgeAsrToken: '' })]);
  if (!settings.edgeAsrUrl) return;
  let url;
  try { url = new URL(settings.edgeAsrUrl); } catch { voiceStatus.textContent = 'Edge ASR URL is invalid. Check Settings.'; return; }
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && isLocal)) { voiceStatus.textContent = 'Edge ASR requires WSS, except for localhost development.'; return; }
  try { edgeSocket = new WebSocket(url.href); }
  catch (error) { voiceStatus.textContent = `Edge ASR could not connect: ${error.message}`; return; }
  edgeSocket.onopen = () => edgeSocket.send(JSON.stringify({ type: 'register_browser', clientId: settings.edgeClientId || 'captain-browser', token: local.edgeAsrToken || '' }));
  edgeSocket.onmessage = async event => {
    let message; try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'registered') voiceStatus.textContent = listening ? 'Browser microphone on; edge wake device also connected.' : 'Edge wake device connected — say “Hey Captain” near the device.';
    if (message.type === 'command' && message.source === 'edge-kws-asr') await handleVoicePhrase(message.text, true);
  };
  edgeSocket.onclose = () => { clearTimeout(edgeReconnect); edgeReconnect = setTimeout(connectEdgeVoice, 2500); };
  edgeSocket.onerror = () => { voiceStatus.textContent = 'Edge ASR disconnected. CAPTAIN will retry; typed commands still work.'; };
}

let visionWorker, visionSequence = 0;
const visionPending = new Map();
function runLocalVision(message) {
  if (typeof Worker !== 'function') return Promise.reject(new Error('This browser cannot start the local vision worker.'));
  if (!visionWorker) {
    visionWorker = new Worker(chrome.runtime.getURL('vision-worker.js'));
    visionWorker.onmessage = event => {
      const pending = visionPending.get(event.data?.id); if (!pending) return;
      visionPending.delete(event.data.id);
      event.data.ok ? pending.resolve(event.data.result) : pending.reject(new Error(event.data.error || 'Local vision failed.'));
    };
    visionWorker.onerror = event => {
      for (const pending of visionPending.values()) pending.reject(new Error(event.message || 'Local vision worker stopped.'));
      visionPending.clear(); visionWorker?.terminate(); visionWorker = null;
    };
  }
  const id = ++visionSequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { visionPending.delete(id); reject(new Error('Local vision exceeded 25 seconds.')); }, 25000);
    visionPending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    visionWorker.postMessage({ id, screenshot: message.screenshot, viewport: message.viewport, redactionBoxes: message.redactionBoxes });
  });
}
chrome.runtime.onMessage?.addListener?.((message, _sender, respond) => {
  if (message.type !== 'VISION_REDACT' || (windowId && message.windowId !== windowId)) return;
  runLocalVision(message).then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }));
  return true;
});
function completeFollowUp(request) {
  // A full replacement command should not become e.g. "play play Arijit".
  const fullCommand = /^(?:(?:hey|wake up)\s+)?captain\b|^(?:please\s+)?(?:open|launch|go to|navigate|search|find|look up|show me|play|put on|listen to|pause|stop|resume|unpause|scroll|click|press|type|select|back)\b/i.test(request);
  return `${fullCommand ? '' : followUpPrefix}${request}`.trim();
}
$('#run').onclick = async () => {
  const task = $('#task').value.trim();
  if (!task) return $('#task').focus();
  await dispatchCommand(completeFollowUp(task));
  refresh();
};
$('#settings').onclick = () => chrome.runtime.openOptionsPage();
$('#cancel-task').onclick = async () => {
  try { await chrome.runtime.sendMessage({ type: 'CANCEL_TASK' }); voiceStatus.textContent = 'Cancellation requested. Actions already sent cannot be undone.'; }
  catch { voiceStatus.textContent = 'Could not send cancellation: extension disconnected.'; }
};
$('#voice').onclick = async () => {
  if (listening) { stopMicrophone('Microphone off — click Speak to enable wake listening.'); return; }
  if (micStarting) return;
  if (!tabId && !windowId) {
    try { const result = await chrome.runtime.sendMessage({ type: 'OPEN_VOICE' }); voiceStatus.textContent = result.ok ? 'Click Speak in the CAPTAIN tab to enable the microphone.' : result.error; }
    catch { voiceStatus.textContent = 'Could not open voice controls. Reload CAPTAIN and try again.'; }
    return;
  }
  if (!Speech) { $('#message').textContent = 'Voice recognition is unavailable in this browser. Type the command instead.'; return; }
  const session = ++micSession;
  micStarting = true;
  voiceStatus.textContent = 'Starting microphone — allow access if Chrome asks.';
  let stream, context;
  try {
    releaseMicrophone();
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    if (session !== micSession) { stream.getTracks().forEach(track => track.stop()); return; }
    context = new AudioContext(); await context.resume();
    if (session !== micSession) { stream.getTracks().forEach(track => track.stop()); await context.close(); return; }
    micStream = stream; micContext = context;
    micAnalyser = context.createAnalyser(); micAnalyser.fftSize = 512;
    micSamples = new Float32Array(micAnalyser.fftSize);
    context.createMediaStreamSource(stream).connect(micAnalyser);
  }
  catch (error) {
    // Local resources can exist before they have been published to this session.
    if (stream !== micStream) stream?.getTracks().forEach(track => track.stop());
    if (context !== micContext) context?.close().catch(() => {});
    if (session === micSession) stopMicrophone(`Microphone unavailable: ${error.message}. Click Speak to retry.`);
    return;
  }
  let currentRecognition;
  try { currentRecognition = new Speech(); }
  catch (error) { stopMicrophone(`Voice could not start: ${error.message}. Click Speak to retry.`); return; }
  recognition = currentRecognition;
  const isCurrent = () => session === micSession && recognition === currentRecognition;
  const startRecognition = () => {
    if (!isCurrent()) return;
    micStarting = true;
    clearTimeout(startTimer);
    startTimer = setTimeout(() => { if (isCurrent() && micStarting) stopMicrophone('Voice did not start within 10 seconds. Check your connection and click Speak to retry.'); }, 10000);
    try { currentRecognition.start(); }
    catch (error) { if (isCurrent()) stopMicrophone(`Voice could not start: ${error.message}. Click Speak to retry.`); }
  };
  currentRecognition.lang = 'en-IN'; currentRecognition.interimResults = false; currentRecognition.continuous = true;
  currentRecognition.onstart = () => {
    if (!isCurrent()) return;
    clearTimeout(startTimer); startTimer = null;
    micStarting = false; listening = true;
    $('#voice').textContent = '● Mic on'; setVoiceMode(voiceMode);
  };
  currentRecognition.onresult = async event => {
    if (!isCurrent() || !listening) return;
    const finalResult = event.results[event.results.length - 1];
    if (finalResult.isFinal === false) return;
    await handleVoicePhrase(finalResult[0].transcript);
  };
  currentRecognition.onend = () => {
    if (!isCurrent() || (!listening && !micStarting)) return;
    clearTimeout(startTimer); clearTimeout(restartTimer);
    restartTimer = setTimeout(() => { if (isCurrent() && (listening || micStarting)) startRecognition(); }, 500);
  };
  currentRecognition.onerror = event => {
    if (isCurrent() && event.error !== 'no-speech') stopMicrophone(`Voice stopped: ${event.error}. Type your command or click Speak to retry.`);
  };
  startRecognition();
};
refresh(); setInterval(refresh, 700); connectEdgeVoice();
