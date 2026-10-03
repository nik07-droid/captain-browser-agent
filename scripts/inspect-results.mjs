const targets=await fetch('http://127.0.0.1:9223/json/list').then(r=>r.json());
const page=targets.find(t=>t.type==='page'&&t.url.includes('youtube.com/results'));
if(!page)throw new Error('No YouTube results page');
const socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r);
socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id!==1)return;console.log(JSON.stringify(m.result?.result?.value||m,null,2));socket.close();};
socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{returnByValue:true,expression:`({title:document.title,visibility:document.visibilityState,width:innerWidth,height:innerHeight,search:!!document.querySelector('ytd-search'),links:[...document.querySelectorAll('a[href*="/watch"]')].slice(0,30).map(a=>({text:(a.innerText||a.getAttribute('aria-label')||a.title||'').slice(0,150),search:!!a.closest('ytd-search'),rect:(()=>{const r=a.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width,height:r.height};})(),ref:a.dataset.captainRef}))})`}}));
