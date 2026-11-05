const {HarnessAdapter,stableId}=require('./harness-adapter');
const {DeltaNarrator}=require('./delta-narrator');const {NarrationQueue}=require('./narration-queue');
// Tap an explicitly supplied host stream after the caller renders text. observe()
// is synchronous admission, never a promise tied to speech completion.
function createHarnessObserver({source,selectedSessions,play,mode='informative',incrementalMarkdown=false,onReceipt=()=>{}}={}){
 if(!Array.isArray(selectedSessions)||typeof play!=='function'||typeof onReceipt!=='function')throw Error('explicit observer, source selection and player required');
 const sessions=selectedSessions.map(stableId),queue=new NarrationQueue({selectedSessions:sessions,play}),narrator=new DeltaNarrator({queue,selectedSessions:sessions,mode,incrementalMarkdown});
 // The host can forget a terminal turn only after its downstream messages and
 // owned jobs have settled. Admission alone is never a playback completion.
 const canRetire=turn=>{
  const keys=[];for(const item of turn.messages.values()){
   if(!item.started)continue;
   const key=JSON.stringify([stableId(turn.session),stableId(turn.id),stableId(turn.id),stableId(item.id)]),message=narrator.messages.get(key),jobs=queue.groups.get(key)||[];
   if(!message||!['sealed','cancelled','revision-refused'].includes(message.state)||message.pending.length||jobs.length!==message.nextSegment||jobs.some(job=>queue.jobs.get(job.job)!==job||job===queue.active||!['completed','cancelled'].includes(job.state)))return false;
   keys.push(key);
  }
  for(const key of keys){const message=narrator.messages.get(key);for(const job of queue.groups.get(key)||[])queue.jobs.delete(job.job);queue.groups.delete(key);queue.sealedMessages.delete(key);narrator.bytes-=Buffer.byteLength(message.text,'utf8');narrator.messages.delete(key);
   const generation=JSON.stringify([message.base.sessionId,message.base.turnId,message.base.generationId]);if(queue.messageCursor.get(generation)===key)queue.messageCursor.delete(generation);
   if(![...narrator.messages.values()].some(m=>JSON.stringify([m.base.sessionId,m.base.turnId,m.base.generationId])===generation))queue.cancelled.delete(generation);
  }return true;
 };
 const host=new HarnessAdapter({source,selectedSessions,emit:event=>narrator.accept(event),canRetire});let closed=false;
 const close=()=>{if(closed)return;closed=true;try{host.revoke();}catch{}for(const session of sessions)try{narrator.revokeSession(session);}catch{}};
 return {
  observe(record){if(closed)return {state:'closed'};let receipt;try{receipt=host.accept(record);}catch{close();receipt={state:'refused',code:'selected-event-refused'};}try{onReceipt(receipt);}catch{}return receipt;},
  close,
  async settle(){const before=host.finish();if(before.unfinished)close();await queue.idle();const stream=narrator.status(),status=queue.status(),incomplete=before.unfinished||stream.pending||stream.unfinished||stream.revisions||status.failed;if(incomplete)close();return {state:incomplete?'incomplete':closed||before.cancelledTurns?'cancelled':'complete',queue:queue.status(),stream:narrator.status(),host:host.status(),humanHearing:'unconfirmed'};},
  status(){return {closed,queue:queue.status(),stream:narrator.status(),host:host.status()};}
 };
}
module.exports={createHarnessObserver};
