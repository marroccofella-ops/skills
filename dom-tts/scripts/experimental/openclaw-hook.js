const {admitHook}=require('./harness-hook');
const {HarnessAdapter}=require('./harness-adapter');const {createHash}=require('node:crypto');
// Operator passes an exact session list at registration. No source discovery.
function createOpenClawHook({selectedSessions,dryRun=false,onReceipt=()=>{},admit=admitHook,inspect}={}){
 if(!Array.isArray(selectedSessions)||!selectedSessions.length||typeof onReceipt!=='function'||typeof admit!=='function'||typeof dryRun!=='boolean'||inspect!==undefined&&typeof inspect!=='function')throw Error('explicit selected sessions and receipt handler required');
 const sessions=[...selectedSessions];new HarnessAdapter({source:'openclaw-message-sent',selectedSessions:sessions,emit(){}});const seen=new Map(),retired=new Map();
 const fingerprint=key=>createHash('sha256').update(key).digest('hex');
 const settled=receipt=>receipt?.admission!=='unknown'&&(receipt?.state==='preview'||receipt?.state==='skipped'||receipt?.state==='ignored'||receipt?.terminal!==false&&['completed','cancelled'].includes(receipt?.state));
 const report=receipt=>{try{onReceipt(receipt);}catch{}};
 const retire=()=>{for(const [key,item]of seen){if(seen.size<64)break;if(!item.safe)continue;retired.set(fingerprint(key),item.hash);while(retired.size>256)retired.delete(retired.keys().next().value);seen.delete(key);}};
 async function refresh(){
  // Snapshot prior deliveries before another admission can roll the browser's
  // receipt window. No wait for playback and no resend; unknown stays retained.
  retire();
  const candidates=[...seen.values()].filter(item=>!item.safe&&item.receipt?.state==='queued'&&/^[a-f0-9]{32}$/.test(item.receipt.id));if(!candidates.length)return;
  let read=inspect;if(!read){try{const browser=require('../browser-speak'),conn=browser.connection();read=receipt=>browser.request(conn,'/api/queue/receipt',{id:receipt.id});}catch{return;}}
  await Promise.all(candidates.map(async item=>{try{const receipt=await read(item.receipt);if(receipt?.id===item.receipt.id&&receipt.terminal===true&&['completed','cancelled'].includes(receipt.state))item.safe=true;}catch{}}));retire();
 }
 const handler=async event=>{if(event?.type!=='message'||event?.action!=='sent'||!sessions.includes(event.sessionKey)||event.context?.success!==true)return;
  const session=event.sessionKey,id=event.context.messageId,text=event.context.content;if(typeof id!=='string'||!id||id.length>256||/[\x00-\x20\x7f]/.test(id)||typeof text!=='string'||Buffer.byteLength(text)>65536){report({state:'failed',code:'hook-admission-refused',audio:false});return;}
  const selected={type:'message',action:'sent',sessionKey:session,context:{success:true,messageId:id,content:text}};
  const key=JSON.stringify([session,id]),hash=createHash('sha256').update(text).digest('hex');
  const duplicate=()=>{const previous=seen.get(key)?.hash||retired.get(fingerprint(key));if(previous===undefined)return false;report({state:previous===hash?'duplicate':'failed',code:previous===hash?'previous-event-retained':'conflicting-hook-replay',audio:false});return true;};
  if(duplicate())return;
  await refresh();
  if(duplicate())return;
  if(seen.size>=64){report({state:'failed',code:'hook-history-limit',audio:false});return;}
  // Reserve before awaiting admission: overlapping retries cannot speak twice.
  // A failed/uncertain admission is retained too; never retry it automatically.
  const item={hash,safe:false,receipt:null};seen.set(key,item);
  try{const receipt=await admit(selected,{source:'openclaw-message-sent',selectedSessions:[...sessions],dryRun});item.receipt=Object.freeze(Object.fromEntries(['id','state','terminal','admission'].map(key=>[key,receipt?.[key]])));item.safe=settled(item.receipt);report(receipt);}catch{report({state:'failed',code:'hook-admission-refused',audio:false});}
 };
 handler.status=()=>({retained:seen.size,retired:retired.size,pending:[...seen.values()].filter(item=>!item.safe).length});return handler;
}
module.exports={createOpenClawHook};
