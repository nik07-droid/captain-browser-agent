const defaults = { serverUrl: 'http://127.0.0.1:4317', maxSteps: 12, includeScreenshot: true, edgeAsrUrl: '', edgeClientId: 'captain-browser' };
Promise.all([chrome.storage.sync.get(defaults), chrome.storage.local.get({ edgeAsrToken: '' })]).then(([s, local]) => {
  for (const [k, v] of Object.entries({ ...s, ...local })) { const el = document.querySelector(`#${k}`); if (!el) continue; if (el.type === 'checkbox') el.checked = v; else el.value = v; }
});
document.querySelector('#save').onclick = async () => {
  const edgeAsrUrl = document.querySelector('#edgeAsrUrl').value.trim().replace(/\/$/, '');
  if (edgeAsrUrl) {
    let url; try { url = new URL(edgeAsrUrl); } catch { document.querySelector('#saved').textContent = 'Invalid WebSocket URL'; return; }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && local)) { document.querySelector('#saved').textContent = 'Use WSS (or localhost WS)'; return; }
  }
  await chrome.storage.sync.set({ serverUrl: document.querySelector('#serverUrl').value.replace(/\/$/, ''), maxSteps: Number(document.querySelector('#maxSteps').value), includeScreenshot: document.querySelector('#includeScreenshot').checked, edgeAsrUrl, edgeClientId: document.querySelector('#edgeClientId').value.trim() || 'captain-browser' });
  await chrome.storage.local.set({ edgeAsrToken: document.querySelector('#edgeAsrToken').value });
  document.querySelector('#saved').textContent = 'Saved — reopen the CAPTAIN controller'; setTimeout(() => document.querySelector('#saved').textContent = '', 2500);
};
