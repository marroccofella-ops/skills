const {HarnessAdapter}=require('./harness-adapter');
const {applyMode}=require('../summarize');
const HOOK_PAYLOAD_BYTES=524288,HOOK_TEXT_BYTES=65536,BROWSER_JSON_BYTES=32768;
const unavailable=new Set(['browser-state-not-found','browser-state-inaccessible','browser-descriptor-invalid','browser-owner-unobservable','browser-server-identity-unverified','browser-loopback-denied','browser-transport-timeout','browser-transport-unreachable','browser-not-connected','restart-required','speech-busy','browser-history-full','browser-source-capacity']);
function failure(error){const code=error?.message,uncertain=['browser-transport-timeout','browser-transport-unreachable','browser-loopback-denied'].includes(code);return {state:unavailable.has(code)?'skipped':'failed',code:unavailable.has(code)?code:'hook-admission-refused',...(uncertain?{admission:'unknown'}:{}),audio:false};}
// Normalize supplied Markdown before applying browser limits. A long valid reply
// gets an explicitly labelled excerpt, rather than silently disappearing.
function spokenReply(raw){
 const text=applyMode(raw,'informative');if(!text.trim())return {text:'',summarized:false};
 const fits=value=>value.length<=6000&&Buffer.byteLength(JSON.stringify({text:value}),'utf8')<=BROWSER_JSON_BYTES;
 if(fits(text))return {text,summarized:false};
 const prefix='Spoken excerpt. ',suffix=' Full reply remains in writing.';let excerpt='';
 for(const {segment}of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)){if(!fits(prefix+excerpt+segment+suffix))break;excerpt+=segment;}
 return {text:excerpt?prefix+excerpt.trimEnd()+suffix:'This reply exceeds the spoken excerpt limit. Full reply remains in writing.',summarized:true};
}
// Admission receipt only. No transcript paths are opened and no audio is awaited.
async function admitHook(record,{source,selectedSessions,dryRun=false,connect,send}={}){
 if(typeof dryRun!=='boolean')return {state:'failed',code:'hook-options-invalid',audio:false};
 const finals=[];let result;
 try{const adapter=new HarnessAdapter({source,selectedSessions,maxBytes:HOOK_TEXT_BYTES,emit:event=>{if(event.kind==='complete')finals.push(event.text);}});result=adapter.accept(record);}catch{return {state:'failed',code:'hook-event-invalid',audio:false};}
 if(!finals.length)return {...result,audio:false};
 if(finals.length!==1)return {state:'failed',code:'hook-event-invalid',audio:false};
 let speech;try{if(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(finals[0]))throw Error();speech=spokenReply(finals[0]);}catch{return {state:'failed',code:'hook-text-invalid',audio:false};}if(!speech.text)return {state:'skipped',code:'hook-no-readable-text',audio:false};
 const metadata={...(speech.summarized?{summarized:true,code:'hook-spoken-excerpt'}:{})};
 if(dryRun)return {state:'preview',messages:1,...metadata,audio:false};
 try{
  const browser=require('../browser-speak');const conn=await (connect||browser.connection)();const receipt=await (send||browser.request)(conn,'/api/queue/enqueue',{text:speech.text});
  if(receipt.state!=='queued'||typeof receipt.id!=='string'||!/^[a-f0-9]{32}$/.test(receipt.id))return {state:'failed',code:'hook-receipt-invalid',audio:false};
  return {state:'queued',id:receipt.id,...metadata,audio:true,completed:false,humanHearing:'unconfirmed'};
 }catch(error){return failure(error);}
}
module.exports={admitHook,spokenReply,failure,HOOK_PAYLOAD_BYTES,HOOK_TEXT_BYTES,BROWSER_JSON_BYTES};
