import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const code = await readFile(new URL('../extension/content-script.js', import.meta.url), 'utf8');
async function verify({ title='Shreya Ghoshal live', query='Shreya Ghoshal songs', ad=false, advances=true, paused=false, readyState=4, mutate }={}) {
  let listener;
  const media={paused,ended:false,readyState,currentTime:10,currentSrc:'blob:test',getBoundingClientRect:()=>({width:640,height:360,bottom:360,right:640,top:0,left:0})};
  const host={shadowRoot:{querySelector:()=>null}};
  const sandbox={innerHeight:800,innerWidth:1000,getComputedStyle:()=>({visibility:'visible',display:'block'}),location:{origin:'https://www.youtube.com',href:'https://www.youtube.com/watch?v=test'},document:{title,querySelectorAll:()=>[media],querySelector:q=>q==='#captain-agent-host'?host:q==='.ad-showing'&&ad?{}:null},chrome:{runtime:{onMessage:{addListener:fn=>listener=fn}}},setTimeout:fn=>{if(advances)media.currentTime+=2;mutate?.(media,sandbox);fn();}};
  vm.runInNewContext(code,sandbox);
  return new Promise(resolve=>listener({type:'EXECUTE',action:{type:'verifyPlayback',query}},{},resolve));
}
test('playback verification requires matching title and advancing time',async()=>assert.equal((await verify()).verified,true));
test('playback verification rejects wrong singer and advertisements',async()=>{
  assert.equal((await verify({title:'Arijit Singh live'})).ok,false);
  assert.equal((await verify({ad:true})).ok,false);
});
test('playback verification rejects buffering despite paused=false',async()=>assert.equal((await verify({advances:false})).ok,false));

test('requested Ae Ajnabee title and artist match without requiring the word by in metadata', async () => {
  const query = 'ae ajnabee by aditya rikhari';
  assert.equal((await verify({query,title:'Ae Ajnabee (Official Music Video) - Aditya Rikhari, Ravator, Kutle Khan | Coke Studio Bharat'})).verified, true);
  assert.equal((await verify({query,title:'Ae Ajnabee - Udit Narayan'})).ok, false);
  assert.equal((await verify({query,title:'Ae Ajnabee - Aditya Rikhariya'})).ok, false);
});

test('only a matching paused non-ad player is eligible for resume recovery', async () => {
  assert.equal((await verify({paused:true})).needsResume, true);
  assert.equal((await verify({paused:true,readyState:1})).needsResume, true);
  assert.notEqual((await verify({paused:true,ad:true})).needsResume, true);
  assert.notEqual((await verify({paused:true,title:'Unrelated singer'})).needsResume, true);
});

test('playback verification rejects title, media source and page changes during its sample', async () => {
  for (const mutate of [(_media, page) => page.document.title = 'Other singer', media => media.currentSrc = 'blob:replacement', (_media, page) => page.location.href = 'https://www.youtube.com/watch?v=other']) {
    assert.equal((await verify({mutate})).ok, false);
  }
});
