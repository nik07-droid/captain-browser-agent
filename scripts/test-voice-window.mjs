const targets = await fetch('http://127.0.0.1:9223/json/list').then(r => r.json());
const target = targets.filter(t => t.type === 'page' && t.url.includes('/popup.html?target=')).sort((a,b) => Number(new URL(b.url).searchParams.get('target')) - Number(new URL(a.url).searchParams.get('target')))[0];
if (!target) throw new Error('Persistent CAPTAIN voice window did not open.');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Voice-window inspection timed out')), 5000);
  socket.onmessage = e => { const msg = JSON.parse(e.data); if (msg.id === 1) { clearTimeout(timer); resolve(msg.result); } };
  socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'JSON.stringify({incognito:chrome.extension.inIncognitoContext,target:new URL(location.href).searchParams.get("target"),microphone:!!document.querySelector("#voice"),speechSupported:!!(window.SpeechRecognition||window.webkitSpeechRecognition)})', returnByValue: true } }));
});
socket.close();
const state = JSON.parse(result.result.value);
if (!state.incognito || !state.target || !state.microphone) throw new Error(JSON.stringify(state));
console.log('Persistent voice window PASS:', JSON.stringify(state));
if (process.argv.includes('--search')) {
  const query = `space exploration ${Math.random().toString(36).slice(2).replace(/[0-9]/g, 'x')}`;
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => ws.onopen = resolve);
  await new Promise(resolve => { ws.onmessage = e => { if (JSON.parse(e.data).id === 2) resolve(); }; ws.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { expression: `document.querySelector("#task").value=${JSON.stringify('open YouTube and search for '+query)}; document.querySelector("#run").click();`, userGesture: true } })); });
  ws.close();
  let verified = false;
  for (let i = 0; i < 90; i++) {
    const tabs = await fetch('http://127.0.0.1:9223/json/list').then(r => r.json());
    if (tabs.some(t => t.url.startsWith('https://www.youtube.com/results?') && new URL(t.url).searchParams.get('search_query') === query)) { verified = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!verified) throw new Error('Voice-window command did not navigate the target tab to YouTube search.');
  console.log('Voice-window typed command → YouTube results PASS (microphone audio not tested).');
}
