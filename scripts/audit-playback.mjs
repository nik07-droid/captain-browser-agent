import { mkdir, writeFile } from 'node:fs/promises';
import { cdp, debugJson, extensionPath, findSession } from './reload-in-place.mjs';
const version=await debugJson('/json/version');
const installed=await cdp(version.webSocketDebuggerUrl,'Extensions.getExtensions');
const extension=installed.extensions.find(item=>item.path?.toLowerCase()===extensionPath.toLowerCase());
if(!extension)throw new Error('CAPTAIN project extension is not installed. Run npm run demo first.');
const voice=(await findSession(extension.id))?.controller;
if(!voice)throw new Error('No CAPTAIN Incognito controller is open. Run npm run demo first.');
const ws=new WebSocket(voice.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let seq=0;
async function evaluate(expression){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{ws.removeEventListener('message',handler);reject(new Error('Browser timeout'));},12000);const handler=e=>{const m=JSON.parse(e.data);if(m.id!==id)return;clearTimeout(timer);ws.removeEventListener('message',handler);if(m.error||m.result.exceptionDetails)reject(new Error(JSON.stringify(m.error||m.result.exceptionDetails)));else resolve(m.result.result.value);};ws.addEventListener('message',handler);ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true,userGesture:true}}));});}
const snapshot=()=>evaluate(`(async()=>{
 const controller=await chrome.tabs.getCurrent();
 if(!controller?.incognito)throw new Error('CAPTAIN controller must be Incognito.');
 const state=await chrome.runtime.sendMessage({type:'GET_STATE'});
 if(!state.session)throw new Error('Outdated extension: window-bound session status is missing. Run npm run reload.');
 if(!state.session.connected||!state.session.tabId)throw new Error('No connected working tab. Run Open YouTube in CAPTAIN once, then retry this playback audit.');
 const id=state.session.tabId;
 let tab;try{tab=await chrome.tabs.get(id);}catch{throw new Error('The working tab closed during the audit. Run Open YouTube in CAPTAIN and retry.');}
 if(!tab.incognito||tab.windowId!==controller.windowId||state.session.windowId!==controller.windowId||tab.id===controller.id)throw new Error('The working tab left the controller Incognito window.');
 const tabs=await chrome.tabs.query({windowId:controller.windowId});
 let media=[],page={},timer;
 try{
  const result=await Promise.race([
   chrome.scripting.executeScript({target:{tabId:id},func:()=>({title:document.title,visible:document.visibilityState,ad:!!document.querySelector('.ad-showing'),media:Array.from(document.querySelectorAll('#movie_player video, #movie_player audio')).filter(v=>v.currentSrc).map(v=>({paused:v.paused,ended:v.ended,time:v.currentTime,ready:v.readyState,error:v.error?.code||null}))})}),
   new Promise(resolve=>{timer=setTimeout(()=>resolve(null),3000);})
  ]);
  if(result?.[0]?.result){page=result[0].result;media=page.media;}
 }catch{}finally{clearTimeout(timer);}
 return{id:tab.id,windowId:tab.windowId,controllerId:controller.id,url:tab.url,incognito:tab.incognito,tabs:tabs.map(t=>t.id).sort((a,b)=>a-b),state,media,page,microphoneActive:typeof listening!=='undefined'&&listening||typeof micStarting!=='undefined'&&micStarting};
})()`);
const report={started:new Date().toISOString(),steps:[]};
try{
const baseline=await snapshot();report.baseline=baseline;
if(baseline.microphoneActive)throw new Error('Turn off Speak before running this typed playback audit.');
if(baseline.state.status==='running')throw new Error('A CAPTAIN task is running. Wait for it to finish before this audit.');
for(const command of (process.argv.includes('--second-singer') ? ['open YouTube','search for Shreya Ghoshal songs','play Shreya Ghoshal songs','pause'] : ['open YouTube','play Arijit Singh songs','pause','search for Shreya Ghoshal songs','play Shreya Ghoshal songs','pause'])){
 const since=Date.now();await evaluate(`(async()=>{await refresh();if(document.querySelector('#run').disabled)throw new Error('Controller is still busy');document.querySelector('#task').value=${JSON.stringify(command)};document.querySelector('#run').click();return true;})()`);
 let current;
 while(Date.now()-since<120000){current=await snapshot();if(current.state.task===command&&current.state.updatedAt>=since&&['complete','error'].includes(current.state.status))break;await new Promise(r=>setTimeout(r,700));}
 const row={command,...current};report.steps.push(row);console.log(JSON.stringify({command,id:current.id,windowId:current.windowId,status:current.state.status,message:current.state.message,url:current.url,page:current.page}));
 if(current.id!==baseline.id||current.windowId!==baseline.windowId||current.controllerId!==baseline.controllerId||!current.incognito||JSON.stringify(current.tabs)!==JSON.stringify(baseline.tabs))throw new Error('Same-tab/Incognito invariant failed');
 if(current.state.task!==command||current.state.updatedAt<since)throw new Error('Command was not accepted by the controller within the deadline');
 if(current.state.status!=='complete')throw new Error(current.state.message||'Task timed out');
 if(current.state.requiresInput)throw new Error(`CAPTAIN asked for clarification: ${current.state.message}`);
 if(command==='open YouTube' && new URL(current.url).hostname!=='www.youtube.com')throw new Error('YouTube was not actually opened');
 if(command.startsWith('search') && new URL(current.url).searchParams.get('search_query')!=='Shreya Ghoshal songs')throw new Error('Search query was not applied');
 if(command.startsWith('play')){if(current.page.ad||!current.page.title?.toLowerCase().includes(command.includes('Arijit')?'arijit singh':'shreya ghoshal'))throw new Error('Wrong singer or advertisement');const before=current.media.find(m=>!m.paused)?.time;await new Promise(r=>setTimeout(r,2000));const after=await snapshot();row.playbackClock={before,after:after.media.find(m=>!m.paused)?.time};if(before===undefined||!after.media.some(m=>!m.paused&&m.time>before))throw new Error('Playback clock did not advance');}
 if(command==='pause' && (!current.media.length||current.media.some(m=>!m.paused))) throw new Error('No paused player was observed');
}
report.success=true;
}catch(error){report.success=false;report.error=error.message;process.exitCode=1;}finally{ws.close();await mkdir(new URL('../runtime/',import.meta.url),{recursive:true});await writeFile(new URL('../runtime/playback-audit.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({success:report.success,error:report.error}));}
