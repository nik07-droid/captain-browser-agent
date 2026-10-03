import { fileURLToPath, pathToFileURL } from 'node:url';

export const extensionPath = fileURLToPath(new URL('../extension', import.meta.url));
export const endpoint = 'http://127.0.0.1:9223';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function debugJson(path) {
  const response = await fetch(`${endpoint}${path}`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Chrome debugging endpoint returned ${response.status}.`);
  return response.json();
}

export function cdp(url, method, params = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(`${method} timed out.`)), timeoutMs);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method, params }));
    socket.onerror = () => finish(new Error(`Chrome connection failed during ${method}.`));
    socket.onclose = () => finish(new Error(`Chrome connection closed during ${method}.`));
    socket.onmessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.id !== 1) return;
      finish(message.error ? new Error(message.error.message) : null, message.result);
    };
  });
}

export function isController(target, extensionId) {
  try {
    const url = new URL(target.url);
    return target.type === 'page' && url.protocol === 'chrome-extension:' &&
      (!extensionId || url.hostname === extensionId) && url.pathname === '/popup.html';
  } catch { return false; }
}

export async function evaluate(target, expression, timeoutMs = 10000) {
  const result = await cdp(target.webSocketDebuggerUrl, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}

// A closed legacy target must not invalidate the still-open controller.
export const readSessionExpression = `(async()=>{
  const controller=await chrome.tabs.getCurrent();
  if(!controller?.incognito)return null;
  const legacy=Number(new URL(location.href).searchParams.get('target'));
  const key='captainWindow:'+controller.windowId;
  const saved=await chrome.storage.session.get([key,'captainTarget:'+legacy]);
  const binding=saved[key]||saved['captainTarget:'+legacy];
  let target=null;
  try {
    const candidate=await chrome.tabs.get(binding?.tabId||legacy);
    if(candidate.incognito&&candidate.windowId===controller.windowId&&candidate.id!==controller.id&&!candidate.url?.startsWith(chrome.runtime.getURL('')))target={tabId:candidate.id,windowId:candidate.windowId};
  } catch {}
  return {controllerTabId:controller.id,windowId:controller.windowId,target,documentUrl:location.href,controllerUrl:chrome.runtime.getURL('popup.html?window='+controller.windowId)};
})()`;

export async function findSession(extensionId) {
  for (const controller of (await debugJson('/json/list')).filter(target => isController(target, extensionId))) {
    try {
      const session = await evaluate(controller, readSessionExpression);
      if (session) return { ...session, controller };
    } catch { /* A stale extension page can be recovered during reload. */ }
  }
  return null;
}

export const panelTargetsExpression = `(async()=>{
  const controller=await chrome.tabs.getCurrent();
  if(!controller?.incognito)throw new Error('Panel recovery requires an Incognito controller.');
  const tabs=await chrome.tabs.query({windowId:controller.windowId});
  return {windowId:controller.windowId,tabIds:tabs.filter(tab=>tab.incognito&&tab.windowId===controller.windowId&&/^https?:\\/\\//i.test(tab.url||'')).map(tab=>tab.id)};
})()`;

export function reconnectPanelExpression(tabId, windowId) {
  if (!Number.isInteger(tabId) || !Number.isInteger(windowId)) throw new Error('Panel recovery requires valid tab and window IDs.');
  return `(async()=>{
    const controller=await chrome.tabs.getCurrent();
    if(!controller?.incognito||controller.windowId!==${windowId})throw new Error('The Incognito controller window changed during panel recovery.');
    const tab=await chrome.tabs.get(${tabId});
    if(!tab.incognito||tab.windowId!==controller.windowId||!/^https?:\\/\\//i.test(tab.url||''))return {tabId:${tabId},status:'skipped',reason:'The tab moved or no longer contains an eligible website.'};
    await chrome.scripting.executeScript({target:{tabId:${tabId},frameIds:[0]},files:['content-script.js']});
    return {tabId:${tabId},status:'injected'};
  })()`;
}

// Updating an extension invalidates old content-script event handlers, but does
// not reload their website documents. Replace only CAPTAIN's script/panel. Never
// refresh pages: the user's forms, playback and navigation must stay untouched.
export async function reconnectPanels(session, { evaluateTarget = evaluate } = {}) {
  if (!Number.isInteger(session?.windowId) || !session.controller) throw new Error('A live Incognito controller is required for panel recovery.');
  const targets = await evaluateTarget(session.controller, panelTargetsExpression, 8000);
  if (targets?.windowId !== session.windowId || !Array.isArray(targets.tabIds)) throw new Error('The controller window changed before panel recovery.');
  const tabIds = [...new Set(targets.tabIds)].filter(Number.isInteger);
  const results = new Array(tabIds.length);
  let next = 0;
  // Each CDP evaluation has an eight-second deadline. A timed-out injection is
  // not retried: Chrome may still complete it, and the page script is idempotent.
  await Promise.all(Array.from({ length: Math.min(3, tabIds.length) }, async () => {
    while (next < tabIds.length) {
      const index = next++;
      const tabId = tabIds[index];
      try {
        const result = await evaluateTarget(session.controller, reconnectPanelExpression(tabId, session.windowId), 8000);
        if (!result || result.tabId !== tabId || !['injected', 'skipped'].includes(result.status)) throw new Error('Chrome returned no panel recovery confirmation.');
        results[index] = result;
      } catch (error) {
        results[index] = { tabId, status: 'error', error: error.message || String(error) };
      }
    }
  }));
  return {
    windowId: session.windowId,
    injected: results.filter(result => result.status === 'injected').length,
    skipped: results.filter(result => result.status === 'skipped').length,
    errors: results.filter(result => result.status === 'error').map(({ tabId, error }) => ({ tabId, error })),
    tabs: results,
  };
}

async function waitForTarget(id) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const target = (await debugJson('/json/list')).find(item => item.id === id);
    if (target?.webSocketDebuggerUrl) return target;
    await wait(100);
  }
  throw new Error('CAPTAIN controller did not become available.');
}

async function waitForDocument(id, url, requireExtension = false) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    try {
      const target = (await debugJson('/json/list')).find(item => item.id === id);
      if (target?.webSocketDebuggerUrl) {
        const ready = await evaluate(target, `location.href===${JSON.stringify(url)}&&document.readyState==='complete'${requireExtension ? "&&!!globalThis.chrome?.runtime?.id&&!!globalThis.chrome?.tabs" : ''}`);
        if (ready) return { ...target, url };
      }
    } catch { /* Navigation can destroy an execution context between checks. */ }
    await wait(100);
  }
  throw new Error(`CAPTAIN controller did not finish loading ${requireExtension ? 'its extension page' : 'the reload transition'}. No replacement controller was opened.`);
}

// A CDP navigation acknowledgement does not mean the new document has committed.
// Always await its exact URL and extension APIs before using controller metadata.
export async function navigateController(target, url, { send = cdp, waitDocument = waitForDocument } = {}) {
  await send(target.webSocketDebuggerUrl, 'Page.navigate', { url });
  return waitDocument(target.id, url, true);
}

export async function prepareController(target, binding, { evaluateTarget = evaluate, navigate = navigateController, pause = wait } = {}) {
  // The actual window is trusted, never a stale URL query parameter.
  let session;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { session = await evaluateTarget(target, readSessionExpression); if (session) break; } catch {}
    await pause(100);
  }
  if (!session) throw new Error('CAPTAIN must run in an Incognito window.');
  if (binding && binding.windowId === session.windowId) {
    await evaluateTarget(target, `(async()=>{try{const binding=${JSON.stringify(binding)};const tab=await chrome.tabs.get(binding.tabId);if(tab.incognito&&tab.windowId===binding.windowId)await chrome.storage.session.set({['captainWindow:'+binding.windowId]:binding});}catch{}})()`);
  }
  // Chrome can report an empty or stale target.url during first launch. Obtain
  // both the current URL and extension origin from the live extension context.
  const controllerUrl = session.controllerUrl;
  if (!isController({ type: 'page', url: controllerUrl })) throw new Error('CAPTAIN controller did not expose a valid extension URL.');
  if (session.documentUrl !== controllerUrl) {
    target = await navigate(target, controllerUrl);
  } else {
    target = { ...target, url: controllerUrl };
  }
  await evaluateTarget(target, `(async()=>{const tab=await chrome.tabs.getCurrent();let window=await chrome.windows.get(tab.windowId);if(window.state==='minimized'){await chrome.windows.update(window.id,{state:'normal'});window=await chrome.windows.get(window.id);}if(window.state==='normal'&&(window.height<400||window.width<600))await chrome.windows.update(window.id,{width:1180,height:800,left:20,top:20});await chrome.tabs.update(tab.id,{active:true});await chrome.windows.update(window.id,{focused:true});})()`);
  return { ...session, documentUrl: controllerUrl, controller: target, target: binding || session.target };
}

// Split-mode extensions have two workers. Probe the private window explicitly.
export async function findIncognitoWorker(extensionId, windowId) {
  const candidates = (await debugJson('/json/list')).filter(target => target.type === 'service_worker' && target.url === `chrome-extension://${extensionId}/service-worker.js`);
  for (const worker of candidates) {
    try {
      const info = await evaluate(worker, `(async()=>{if(!chrome.extension.inIncognitoContext)return null;const windows=${Number.isInteger(windowId) ? `[await chrome.windows.get(${windowId})]` : "await chrome.windows.getAll({windowTypes:['normal']})"};const window=windows.find(w=>w.incognito);if(!window)return null;const checked=await chrome.windows.get(window.id);return checked.incognito?{windowId:checked.id}:null;})()`);
      if (info) return { worker, ...info };
    } catch { /* The normal worker cannot see the requested private window. */ }
  }
  return null;
}

export async function ensureController(browserUrl, extensionId, { previous, bootstrapTargetId } = {}) {
  const existing = await findSession(extensionId);
  if (existing) return prepareController(existing.controller, previous?.target || existing.target);

  if (bootstrapTargetId) {
    const bootstrap = await waitForTarget(bootstrapTargetId);
    // Only the brand-new launcher's own blank tab may be replaced.
    if (bootstrap.url !== 'about:blank') throw new Error('The startup tab changed. It was not replaced.');
    const committed = await navigateController(bootstrap, `chrome-extension://${extensionId}/popup.html`);
    return prepareController(committed, previous?.target);
  }

  let incognito;
  for (let attempt = 0; attempt < 35; attempt++) {
    incognito = await findIncognitoWorker(extensionId, previous?.windowId);
    if (incognito) break;
    if (attempt === 0) {
      // Extension workers can be asleep when the controller was closed. Loading
      // this same project path wakes them; it never navigates website tabs.
      await cdp(browserUrl, 'Extensions.loadUnpacked', { path: extensionPath, enableInIncognito: true });
    }
    await wait(150);
  }
  if (incognito) {
    const created = await evaluate(incognito.worker, `chrome.tabs.create({windowId:${incognito.windowId},url:chrome.runtime.getURL('popup.html?window=${incognito.windowId}'),active:true}).then(async tab=>{const target=(await chrome.debugger.getTargets()).find(t=>t.tabId===tab.id);return {id:target?.id};})`);
    if (created?.id) return prepareController(await waitForDocument(created.id, `chrome-extension://${extensionId}/popup.html?window=${incognito.windowId}`, true), previous?.target);
    // Do not create another controller if debugger target enumeration raced.
    for (let attempt = 0; attempt < 30; attempt++) {
      const session = await findSession(extensionId);
      if (session) return prepareController(session.controller, previous?.target);
      await wait(100);
    }
    throw new Error('CAPTAIN controller was created but did not initialize.');
  }

  // Start the private worker directly, without navigating an existing website.
  const { targetInfos } = await cdp(browserUrl, 'Target.getTargets');
  const contexts = [...new Set(targetInfos.filter(info => info.type === 'page').map(info => info.browserContextId).filter(Boolean))];
  for (const browserContextId of contexts) {
    let targetId;
    try { ({ targetId } = await cdp(browserUrl, 'Target.createTarget', { url: `chrome-extension://${extensionId}/popup.html`, browserContextId, newWindow: false })); }
    catch { continue; } // Chrome's original private context may not be CDP-creatable.
    const target = await waitForTarget(targetId);
    try {
      const session = await evaluate(target, readSessionExpression);
      if (session && (!previous || session.windowId === previous.windowId)) return prepareController(target, previous?.target);
    } catch {}
    await cdp(browserUrl, 'Target.closeTarget', { targetId }); // Only our just-created controller.
  }
  throw new Error('No usable CAPTAIN Incognito window was found. Close the dedicated CAPTAIN browser, then launch CAPTAIN again. Existing website tabs were left untouched.');
}

export async function reloadInPlace() {
  const { webSocketDebuggerUrl: browserUrl } = await debugJson('/json/version');
  const { extensions = [] } = await cdp(browserUrl, 'Extensions.getExtensions');
  const installed = extensions.find(item => item.path?.toLowerCase() === extensionPath.toLowerCase());
  if (!installed) throw new Error('CAPTAIN is not installed in this development browser. Run npm run demo first.');
  const previous = await findSession(installed.id);
  // Temporarily navigate only our controller out of the extension origin so
  // Chrome's extension reload cannot close the last private tab/window. This
  // preserves its tab ID too; no placeholder website tab is created.
  if (previous) {
    await cdp(previous.controller.webSocketDebuggerUrl, 'Page.navigate', { url: 'about:blank' });
    // Page.navigate acknowledges before committing. Wait for the actual blank
    // document, otherwise Chrome still sees an extension tab and closes it.
    await waitForDocument(previous.controller.id, 'about:blank');
  }
  let loaded;
  try {
    loaded = await cdp(browserUrl, 'Extensions.loadUnpacked', { path: extensionPath, enableInIncognito: true });
  } finally {
    if (previous) {
      const target = (await debugJson('/json/list')).find(item => item.id === previous.controller.id);
      if (!target) throw new Error('The CAPTAIN controller closed during reload. Website tabs were not replaced.');
      const url = `chrome-extension://${loaded?.id || installed.id}/popup.html?window=${previous.windowId}`;
      await cdp(target.webSocketDebuggerUrl, 'Page.navigate', { url });
      await waitForDocument(target.id, url, true);
    }
  }
  const session = await ensureController(browserUrl, loaded.id, { previous });
  if (previous && (session.controllerTabId !== previous.controllerTabId || session.windowId !== previous.windowId)) throw new Error('Reload did not preserve the CAPTAIN controller and window.');
  const panels = await reconnectPanels(session);
  console.log(JSON.stringify({ reloaded: true, windowId: session.windowId, target: session.target?.tabId || null, controller: session.controllerTabId, preservedController: previous ? session.controllerTabId === previous.controllerTabId : null, panels }));
  return { ...session, panels };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reloadInPlace().catch(error => { console.error(error.message); process.exitCode = 1; });
}
