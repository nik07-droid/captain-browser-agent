import { mkdir, writeFile } from 'node:fs/promises';
import { cdp, debugJson, evaluate, findSession } from './reload-in-place.mjs';

const session = await findSession();
if (!session) throw new Error('Start CAPTAIN first.');
const id = await evaluate(session.controller, `(async()=>{const state=await chrome.runtime.sendMessage({type:'GET_STATE'});return (await chrome.debugger.getTargets()).find(t=>t.tabId===state.session?.tabId)?.id;})()`);
const page = (await debugJson('/json/list')).find(t => t.id === id);
if (!page) throw new Error('No working webpage is connected.');
const panel = await evaluate(page, `(()=>{const host=document.querySelector('#captain-agent-host');if(!host)throw new Error('No CAPTAIN panel on the working webpage');const r=host.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()`);
const result = await cdp(page.webSocketDebuggerUrl, 'Page.captureScreenshot', { format: 'png', clip: panel, captureBeyondViewport: false });
await mkdir(new URL('../runtime/', import.meta.url), { recursive: true });
await writeFile(new URL('../runtime/panel-preview.png', import.meta.url), Buffer.from(result.data, 'base64'));
console.log(JSON.stringify({ screenshot: 'runtime/panel-preview.png', panel }));
