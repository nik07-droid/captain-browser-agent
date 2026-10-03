import assert from 'node:assert/strict';
import { debugJson, evaluate } from './reload-in-place.mjs';

const targets = await debugJson('/json/list');
const controller = targets.find(target => target.type === 'page' && /chrome-extension:\/\/[^/]+\/popup\.html/.test(target.url || ''));
assert.ok(controller, 'CAPTAIN controller is not open.');
const report = await evaluate(controller, `(async()=>{
  const me=await chrome.tabs.getCurrent(),key='captainWindow:'+me.windowId;
  const saved=(await chrome.storage.session.get(key))[key],tab=await chrome.tabs.get(saved.tabId);
  const state=await chrome.runtime.sendMessage({type:'GET_STATE'});
  let observed={};try{observed=await chrome.tabs.sendMessage(saved.tabId,{type:'OBSERVE'})}catch(error){observed={error:error.message}}
  const products=(observed.amazonProducts||[]).map(({asin,title,price,currency,rating,ratingCount,sponsored,position,confidence,ref,url})=>({asin,title,price,currency,rating,ratingCount,sponsored,position,confidence,ref,url}));
  const [{result:raw}]=await chrome.scripting.executeScript({target:{tabId:saved.tabId},func:()=>({hostname:location.hostname,pathname:location.pathname,resultCards:document.querySelectorAll('[data-component-type="s-search-result"][data-asin]').length,asinNodes:document.querySelectorAll('[data-asin]:not([data-asin=""])').length})});
  return {tab:{url:tab.url,status:tab.status,incognito:tab.incognito},raw,task:{status:state?.status,completionStatus:state?.completionStatus,message:state?.message,step:state?.step},history:(state?.history||[]).map(item=>({intent:item.intent,actionType:item.action?.type,expectedAsin:item.action?.expectedAsin,reason:item.reason,result:item.result,diagnostic:item.amazonDiagnostic})),observation:{challenge:observed.challenge,productCount:products.length,products,detail:observed.amazonProductDetail}};
})()`);
console.log(JSON.stringify(report, null, 2));
