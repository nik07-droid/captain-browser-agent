const deadline = Date.now() + 45000;
const youtube = process.argv.includes('--youtube');
const searchYoutube = process.argv.includes('--search-youtube');
let targets;
while (Date.now() < deadline) {
  try {
    targets = await fetch('http://127.0.0.1:9223/json/list').then((r) => r.json());
    if (targets.some((x) => x.type === 'page' && (searchYoutube ? x.url.includes('youtube.com') : x.url.includes('/demo.html')))) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const target = targets?.find((x) => x.type === 'page' && (searchYoutube ? x.url.includes('youtube.com') : x.url.includes('/demo.html')));
if (!target) throw new Error('CAPTAIN demo tab was not found on the local test browser.');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
function evaluate(expression) {
  return new Promise((resolve, reject) => {
    const callId = ++id;
    const timeout = setTimeout(() => { socket.removeEventListener('message', handler); reject(new Error('Browser evaluation timed out')); }, 8000);
    const handler = (event) => {
      const data = JSON.parse(event.data);
      if (data.id !== callId) return;
      clearTimeout(timeout);
      socket.removeEventListener('message', handler);
      if (data.error || data.result?.exceptionDetails) reject(new Error(data.error?.message || data.result.exceptionDetails.text));
      else resolve(data.result.result.value);
    };
    socket.addEventListener('message', handler);
    socket.send(JSON.stringify({ id: callId, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
}
while (Date.now() < deadline && !(await evaluate(`!!document.querySelector('#captain-agent-host')?.shadowRoot`))) await new Promise((r) => setTimeout(r, 200));
if (!(await evaluate(`!!document.querySelector('#captain-agent-host')?.shadowRoot`))) throw new Error('CAPTAIN panel was not injected.');
await evaluate(`(() => { const r=document.querySelector('#captain-agent-host').shadowRoot; r.querySelector('.task').value=${JSON.stringify(searchYoutube ? 'search for AI news' : youtube ? 'open YouTube' : 'Find me a laptop under 50000')}; r.querySelector('.go').click(); return true })()`);
let result = {};
while (Date.now() < deadline) {
  try { result = await evaluate(`(() => { const r=document.querySelector('#captain-agent-host')?.shadowRoot; return {url:location.href,page:document.querySelector('#result')?.textContent || '', phase:r?.querySelector('.phase')?.textContent || '', pii:r?.querySelector('.pii')?.textContent || '', steps:r?.querySelector('.steps')?.textContent || ''} })()`); }
  catch { await new Promise(r => setTimeout(r, 350)); continue; }
  if (searchYoutube) result.videoResults = await evaluate(`Array.from(document.querySelectorAll('a[href*="/watch"]')).filter(a => a.textContent.trim() && a.getBoundingClientRect().width > 0).length`);
  if (youtube && result.url.startsWith('https://www.youtube.com') && /Opened youtube/i.test(result.phase)) break;
  if (searchYoutube && result.url.includes('/results?search_query=') && result.phase.includes('Search submitted') && result.videoResults > 0) break;
  if (!searchYoutube && result.phase.includes('Search submitted')) break;
  await new Promise((r) => setTimeout(r, 350));
}
socket.close();
if (searchYoutube) {
  if (!result.url.includes('/results?search_query=') || new URL(result.url).searchParams.get('search_query') !== 'AI news' || !result.videoResults) throw new Error(`Search E2E failed: ${JSON.stringify(result)}`);
  console.log(`Search E2E PASS: ${result.url}; ${result.phase}; ${result.videoResults} visible video links`);
  process.exit(0);
}
if (youtube) {
  if (!result.url.startsWith('https://www.youtube.com') || !/Opened youtube/i.test(result.phase)) throw new Error(`YouTube E2E failed: ${JSON.stringify(result)}`);
  console.log(`YouTube E2E PASS: ${result.url}; ${result.phase}`);
  process.exit(0);
}
if (!result.page.includes('laptop under 50000') || !result.phase.includes('Search submitted') || !/^2 PII/.test(result.pii)) throw new Error(`E2E failed: ${JSON.stringify(result)}`);
console.log(`E2E PASS: ${result.page}; ${result.pii}; ${result.steps}`);
