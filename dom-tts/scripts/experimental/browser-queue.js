// Selected supplied text only. Browser transport owns the one actual utterance.
const crypto=require('node:crypto');
const {NarrationQueue}=require('./narration-queue');
const {DeltaNarrator}=require('./delta-narrator');
const {applyMode}=require('../summarize');
class BrowserQueue extends NarrationQueue{
 next(){return this.paused?undefined:super.next();}
 pause(){this.paused=true;return {state:'paused-after-current',activeContinues:!!this.active};}
 resume(){if(this.externallyStopped)throw Error('restart-required');this.paused=false;this.schedule();return {state:'resumed'};}
 skip(){if(this.active){this.active.state='cancelling';this.active.controller.abort();return {state:'skip-requested'};}const blocked=[...this.jobs.values()].find(j=>j.state==='failed');if(blocked){const [sessionId,turnId,generationId]=JSON.parse(blocked.generation);this.cancel({sessionId,turnId,generationId});return {state:'failed-message-skipped'};}return {state:'idle'};}
 async pump(){await super.pump();for(const job of this.jobs.values())if(job.state==='failed')this.forgetText(job);}
 stop(){this.externallyStopped=true;this.paused=false;for(const id of [...this.sessions])this.revokeSession(id);return {state:'queue-stop-requested'};}
}
function createBrowserQueue({transport,sessions=['manual'],maxQueueAgeMs=120000,now=()=>Date.now()}={}){
 let queue,adapter,closed=false;const admitted=new Map(),retired=new Map();
 // Receipts are a rolling window, not a lifetime admission quota. Only forget
 // closed input whose entire playback has settled successfully or was cancelled.
 // Failed messages still block until explicitly skipped; open streams stay live.
 function trimHistory(protectedKey){
  if(adapter.messages.size<48&&queue.jobs.size<96)return;
  for(const [key,message] of adapter.messages){
   if(adapter.messages.size<32&&queue.jobs.size<64)break;
   if(key===protectedKey)continue;
   if(!['sealed','cancelled','revision-refused'].includes(message.state)||message.pending.length)continue;
   const jobs=queue.groups.get(key)||[];
   if(jobs.some(job=>job===queue.active||!['completed','cancelled'].includes(job.state)))continue;
   for(const job of jobs)queue.jobs.delete(job.job);
   queue.groups.delete(key);queue.sealedMessages.delete(key);
   adapter.bytes-=Buffer.byteLength(message.text,'utf8');adapter.messages.delete(key);admitted.delete(key);
   const generation=JSON.stringify([message.base.sessionId,message.base.turnId,message.base.generationId]);
   if(queue.messageCursor.get(generation)===key)queue.messageCursor.delete(generation);
   if(![...adapter.messages.values()].some(m=>JSON.stringify([m.base.sessionId,m.base.turnId,m.base.generationId])===generation))queue.cancelled.delete(generation);
   // Text-free tombstones reject delayed retries after detailed receipts roll out.
   retired.set(key,true);while(retired.size>256)retired.delete(retired.keys().next().value);
  }
 }
 function reset(){if(queue?.active)throw Error('previous-speech-unsettled');if(queue)for(const id of sessions)adapter.revokeSession(id);admitted.clear();retired.clear();queue=new BrowserQueue({selectedSessions:sessions,play:async(text,{signal})=>{
  if(signal.aborted)throw Error('cancelled');
  const job=transport.submit({text},true);let stopping=false;const cancel=()=>{stopping=true;transport.stopOwned(job.id);};signal.addEventListener('abort',cancel,{once:true});
  try{return await new Promise((resolve,reject)=>{const poll=()=>{const receipt=transport.receipt(job.id);if(!receipt)return reject(Error('receipt-unavailable'));if(receipt.state==='failed')return reject(Error('browser-playback-failed'));if(receipt.state==='completed')return resolve(receipt);if(receipt.state==='cancelled')return resolve({state:stopping?'cancelled':'stopped'});setTimeout(poll,50);};poll();});}finally{signal.removeEventListener('abort',cancel);}
 }});adapter=new DeltaNarrator({queue,selectedSessions:sessions,mode:'informative',incrementalMarkdown:true,segmentBytes:420});}
 reset();
 const status=()=>({queue:queue.status(),stream:adapter.status(),paused:!!queue.paused,stopped:!!queue.externallyStopped,selectedSessions:[...queue.sessions],maxQueueAgeMs});
 function event(data){if(closed||!transport.status().connected)throw Error('browser-not-connected');const key=JSON.stringify([data.sessionId,data.turnId,data.generationId,data.messageId]);if(retired.has(key))throw Error('reply-history-expired');trimHistory(key);if(data.kind==='start'&&!adapter.messages.has(key)&&adapter.messages.size>=adapter.maxMessages)throw Error('browser-history-full');const result=adapter.accept(data);if(data.kind==='start'&&!admitted.has(key))admitted.set(key,{at:now(),identity:{sessionId:data.sessionId,turnId:data.turnId,generationId:data.generationId}});return result;}
 function enqueue(data){if(typeof data.text!=='string'||!data.text.trim()||data.text.length>6000||!applyMode(data.text,'informative').trim())throw Error('invalid-text');const id=crypto.randomBytes(16).toString('hex'),base={schema:'dom-tts-text/1',role:'assistant',phase:'final_answer',sessionId:data.sessionId||'manual',turnId:id,generationId:id,messageId:id,format:'markdown'};event({...base,kind:'start',sequence:0});const result=event({...base,kind:'complete',sequence:1,text:data.text});return {...result,id,state:'queued',provider:'browser-local-queue'};}
 function delivery(data){const jobs=[...queue.jobs.values()].filter(j=>JSON.parse(j.group)[3]===data.id);if(!jobs.length)return {id:data.id,state:'unknown',terminal:false};const states=jobs.map(j=>j.state);return {id:data.id,state:states.includes('failed')?'failed':states.some(s=>['playing','cancelling'].includes(s))?'speaking':states.includes('queued')?'queued':states.includes('cancelled')?'cancelled':'completed',terminal:states.every(s=>['failed','completed','cancelled'].includes(s)),segments:jobs.length};}
 function selectedMessage(data){for(const field of ['sessionId','turnId','generationId','messageId'])if(typeof data[field]!=='string'||! /^[\w.-]{1,128}$/.test(data[field]))throw Error('invalid-reply-identity');if(!sessions.includes(data.sessionId))throw Error('session-not-selected');const message=adapter.messages.get(JSON.stringify([data.sessionId,data.turnId,data.generationId,data.messageId]));if(!message)throw Error('unknown-reply');return message;}
 function replyReceipt(data){const message=selectedMessage(data),result=delivery({id:data.messageId}),closedInput=['sealed','cancelled','revision-refused'].includes(message.state);if(result.state==='unknown')return {...result,state:closedInput?(message.state==='sealed'?'completed':'cancelled'):'streaming',segments:0,inputState:message.state,inputSealed:message.state==='sealed',terminal:closedInput};return {...result,inputState:message.state,inputSealed:message.state==='sealed',terminal:result.terminal&&closedInput};}
 function seal(data){const message=selectedMessage(data);if(message.state==='sealed')return replyReceipt(data);if(message.state!=='streaming'||message.pending.length)throw Error('reply-not-sealable');event({...message.base,kind:'complete',sequence:message.next,text:message.text});return replyReceipt(data);}
 function cancelReply(data){selectedMessage(data);return adapter.cancelGeneration(data);}
 function command(action,data={}){if(action==='status')return status();if(action==='enqueue')return enqueue(data);if(action==='event')return event(data);if(action==='flush')return adapter.flush(data);if(action==='receipt')return delivery(data);if(action==='reply-receipt')return replyReceipt(data);if(action==='seal')return seal(data);if(action==='cancel-reply')return cancelReply(data);if(action==='pause')return queue.pause();if(action==='resume')return queue.resume();if(action==='skip')return queue.skip();if(action==='stop'){for(const id of sessions)adapter.revokeSession(id);return queue.stop();}if(action==='restart'){if(!queue.externallyStopped)throw Error('stop-before-restart');reset();return {state:'restarted'};}throw Error('invalid-queue-command');}
 const timer=setInterval(()=>{for(const [id,item]of admitted){const message=adapter.messages.get(id),jobs=queue.groups.get(id)||[];if(message&&['sealed','cancelled','revision-refused'].includes(message.state)&&jobs.every(j=>['completed','cancelled'].includes(j.state))){admitted.delete(id);continue;}if(now()-item.at>maxQueueAgeMs){try{adapter.cancelGeneration(item.identity);}catch{}admitted.delete(id);}}},250);timer.unref();
 return {status,command,occupied:()=>!!queue.active||queue.status().queued>0,close(){closed=true;clearInterval(timer);command('stop');},settled:()=>queue.idle()};
}
module.exports={createBrowserQueue};
