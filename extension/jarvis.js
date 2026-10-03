const canvas = document.querySelector('#waves'), ctx = canvas.getContext('2d');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let activity = 'idle';
function render(ms) {
  const size = canvas.clientWidth, ratio = devicePixelRatio || 1;
  if (canvas.width !== Math.round(size * ratio)) canvas.width = canvas.height = Math.round(size * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, size, size);
  const c = size / 2, r = size * .39, time = reduced ? 0 : ms / 1000;
  const level = window.captainMicLevel || 0;
  const energy = activity === 'listening' ? .12 + level * 2.5 : activity === 'speaking' ? 1.3 : activity === 'working' ? .7 : .35;
  const halo = ctx.createRadialGradient(c,c,r*.65,c,c,r*1.3); halo.addColorStop(0,'#ff163300'); halo.addColorStop(.65,'#ff163325'); halo.addColorStop(1,'#ff163300');ctx.fillStyle=halo;ctx.fillRect(0,0,size,size);
  ctx.save();ctx.beginPath();ctx.arc(c,c,r,0,Math.PI*2);ctx.clip();
  const fill=ctx.createRadialGradient(c,c,0,c,c,r);fill.addColorStop(0,'#160c10');fill.addColorStop(.85,'#250d15');fill.addColorStop(1,'#831729');ctx.fillStyle=fill;ctx.fillRect(0,0,size,size);
  for(let layer=0;layer<5;layer++){
    ctx.beginPath();
    for(let side=0;side<2;side++)for(let i=0;i<=160;i++){
      const u=side ? 1-i/160 : i/160,x=c-r+2*r*u;
      const envelope=Math.pow(Math.sin(Math.PI*u),1.5);
      const wave=Math.sin(u*Math.PI*(5+layer*.22)-time*(1.5+layer*.15)+layer*.5);
      const amplitude=r*(.07+energy*.18)*(1-layer*.12);
      const y=c+wave*amplitude*envelope+(side?1:-1)*Math.sin(Math.PI*u)*amplitude*.38;
      if(!side&&!i)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    }
    ctx.closePath();ctx.fillStyle=`rgba(255,${35+layer*9},${60+layer*8},${.12+layer*.025})`;ctx.fill();
  }
  ctx.beginPath();for(let i=0;i<=180;i++){const u=i/180,x=c-r+2*r*u,y=c+Math.sin(u*Math.PI*5-time*2)*Math.sin(Math.PI*u)*r*.08*energy;if(!i)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.strokeStyle='#ff6c7b';ctx.lineWidth=1.5;ctx.shadowColor='#ff2548';ctx.shadowBlur=12;ctx.stroke();ctx.restore();
  ctx.beginPath();ctx.arc(c,c,r,0,Math.PI*2);ctx.strokeStyle='#ff5164';ctx.lineWidth=1.5;ctx.shadowColor='#ff2548';ctx.shadowBlur=16;ctx.stroke();ctx.shadowBlur=0;
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
document.querySelector('#type-toggle').onclick=()=>{const composer=document.querySelector('#composer');composer.hidden=!composer.hidden;if(!composer.hidden)document.querySelector('#task').focus();};
document.querySelector('#settings-shortcut').onclick=()=>chrome.runtime.openOptionsPage();
document.querySelectorAll('[data-command]').forEach(button=>button.onclick=()=>{document.querySelector('#composer').hidden=false;document.querySelector('#task').value=button.dataset.command;document.querySelector('#task').focus();});
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=async()=>{
 document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b===button));
 const chat=button.dataset.view==='chat';document.querySelector('#chat-view').hidden=!chat;document.querySelector('#records-view').hidden=chat;if(chat)return;
 document.querySelector('#records-title').textContent=button.dataset.view==='tasks'?'Current task':'Current session history';
 const state=await chrome.runtime.sendMessage({type:'GET_STATE'}),records=document.querySelector('#records');records.replaceChildren();
 const entries=button.dataset.view==='tasks'?[state.task?`${state.task}\n${state.status}: ${state.message||state.phase||''}`:'No task yet. Give CAPTAIN a command.']:(state.history||[]).map(x=>`${x.action?.type||'Action'} — ${x.reason||''}\n${x.result?.error||x.result?.message||''}`);
 for(const text of entries.length?entries:['No actions in this session yet.']){const article=document.createElement('article');article.textContent=text;records.appendChild(article);}
});
setInterval(()=>{const mode=window.captainVoiceMode;activity=speechSynthesis.speaking?'speaking':mode==='busy'?'working':listening&&mode==='awake'?'listening':'idle';document.querySelector('#voice').textContent=listening?'■':'●';document.querySelector('#voice-label').textContent=listening?'Mic off':'Speak';if(listening&&!speechSynthesis.speaking&&mode!=='busy')document.querySelector('#phase').textContent=mode==='awake'?'Listening for your command…':'Sleeping — say “Hey Captain”';},150);
async function health(){try{const h=await fetch('http://127.0.0.1:4317/health').then(r=>r.json());document.querySelector('#connection').textContent=h.ok?'Online':'Offline';document.querySelector('#dot').classList.toggle('online',!!h.ok);}catch{document.querySelector('#connection').textContent='Offline';}}
health();setInterval(health,10000);
