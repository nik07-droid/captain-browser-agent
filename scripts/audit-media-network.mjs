const targets = await fetch('http://127.0.0.1:9223/json/list').then(r=>r.json());
const target = targets.find(t=>t.url.includes('youtube.com/watch'));
if(!target)throw new Error('No player');
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
const requests=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=m.params;
 if(m.method==='Network.requestWillBeSent') { const u=new URL(p.request.url);requests.set(p.requestId,u.hostname); }
 if(m.method==='Network.loadingFailed')console.log(JSON.stringify({host:requests.get(p.requestId),error:p.errorText,blocked:p.blockedReason}));
 if(m.method==='Network.responseReceived'&&requests.get(p.requestId)?.includes('googlevideo'))console.log(JSON.stringify({host:requests.get(p.requestId),status:p.response.status}));
};
ws.send(JSON.stringify({id:1,method:'Network.enable'}));
setTimeout(()=>ws.close(),20000);
