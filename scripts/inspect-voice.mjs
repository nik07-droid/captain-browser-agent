const targets = await fetch('http://127.0.0.1:9223/json/list').then(r=>r.json());
for (const t of targets.filter(t=>t.url.includes('/popup.html?target='))) {
 const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
 await new Promise(r=>{ ws.onmessage=e=>{const d=JSON.parse(e.data);if(d.id===1){ console.log(t.url, JSON.stringify(d.result));r();}};ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'document.body.innerText',returnByValue:true}}));});ws.close();
}
