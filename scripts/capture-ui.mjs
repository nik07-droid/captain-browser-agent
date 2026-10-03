import { writeFile } from 'node:fs/promises';
const tabs=await fetch('http://127.0.0.1:9223/json/list').then(r=>r.json());
const tab=tabs.filter(t=>t.url.includes('/popup.html?target=')).sort((a,b)=>Number(new URL(b.url).searchParams.get('target'))-Number(new URL(a.url).searchParams.get('target')))[0];
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
const result=await new Promise((resolve,reject)=>{ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id===1){if(m.error)reject(m.error);else resolve(m.result);}};ws.send(JSON.stringify({id:1,method:'Page.captureScreenshot',params:{format:'png'}}));});
ws.close();await writeFile(process.argv[2],Buffer.from(result.data,'base64'));
