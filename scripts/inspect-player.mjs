const targets = await fetch('http://127.0.0.1:9223/json/list').then(r=>r.json());
const target = targets.find(t=>t.url.includes('youtube.com/watch'));
if (!target) throw new Error('No YouTube player');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);
ws.onmessage = e => { const m=JSON.parse(e.data); if(m.id!==1)return; console.log(JSON.stringify(m.result?.result?.value || m,null,2)); ws.close(); };
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{returnByValue:true,expression:`({title:document.title,playerText:document.querySelector('#movie_player')?.innerText,ad:!!document.querySelector('.ad-showing'),media:[...document.querySelectorAll('video')].map(v=>({ready:v.readyState,network:v.networkState,paused:v.paused,time:v.currentTime,error:v.error?.message,buffered:v.buffered.length,sourceKind:v.currentSrc.split(':')[0]})),resources:performance.getEntriesByType('resource').filter(r=>r.name.includes('googlevideo')).map(r=>({host:new URL(r.name).hostname,duration:r.duration,size:r.transferSize,status:r.responseStatus})).slice(-10)})`}}));
