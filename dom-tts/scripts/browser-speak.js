const fs=require('node:fs');
const path=require('node:path');
const {stateDir,ensurePrivate,readObject,alive,parseCli}=require('./runtime');
const {speechDeadline}=require('../assets/browser/player');
const {splitGraphemes}=require('./experimental/delta-narrator');
const {applyMode}=require('./summarize');
function waitBudget(text,queued=false,backlog=0){
 if(!queued)return speechDeadline(text,0.5)+5000;
 const chunks=splitGraphemes(applyMode(text,'informative'),420).filter(chunk=>chunk.trim());
 const ahead=Math.min(128,Math.max(0,Number.isSafeInteger(backlog)?backlog:128));
 return chunks.reduce((ms,chunk)=>ms+speechDeadline(chunk,0.5),5000)+ahead*speechDeadline('x'.repeat(420),0.5);
}
function connection(){try{ensurePrivate();}catch{throw Error('browser-state-inaccessible');}const file=path.join(stateDir,'browser-session.json');let data;try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)throw Error('invalid');data=JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){throw Error(error.code==='ENOENT'?'browser-state-not-found':['EACCES','EPERM'].includes(error.code)?'browser-state-inaccessible':'browser-descriptor-invalid');}if(!data||data.schema!=='dom-tts-browser/1'||!Number.isSafeInteger(data.pid)||data.pid<1||!Number.isSafeInteger(data.port)||data.port<1||data.port>65535||typeof data.token!=='string'||!/^[a-f0-9]{64}$/.test(data.token))throw Error('browser-descriptor-invalid');if(!alive(data.pid))throw Error('browser-owner-unobservable');return data;}
const {request}=require('./experimental/browser-client');

async function main(){
 const args=parseCli(process.argv.slice(2),{command:'speak',wait:'false'},['command','text','textFile','stdin','wait','id','enqueue','sessionId']);if(!['speak','stop','status','receipt','queue-status','pause','resume','skip','restart','queue-receipt'].includes(args.command))throw Error('invalid-command');if(!['true','false'].includes(args.wait))throw Error('--wait requires true or false');if(args.enqueue!==undefined&&typeof args.enqueue!=='boolean')throw Error('--enqueue requires a boolean');if(args.sessionId!==undefined&&(typeof args.sessionId!=='string'||! /^[\w.-]{1,128}$/.test(args.sessionId)||args.command!=='speak'||!args.enqueue))throw Error('session-id-requires-queued-speech');if(['receipt','queue-receipt'].includes(args.command)&&(typeof args.id!=='string'||!/^[a-f0-9]{32}$/.test(args.id)))throw Error('receipt requires a valid --id');
 let text;if(args.command==='speak'){text=require('./speak').prepare({...args,mode:'informative',profile:'conversational'},{settings:{}}).chunks.join(' ');if(!text.trim()||text.length>1000)throw Error('Browser replies must contain 1 to 1000 spoken characters.');}
 const conn=connection();if(['queue-status','pause','resume','skip','restart','queue-receipt'].includes(args.command)){const action=args.command.replace('queue-','');console.log(JSON.stringify(await request(conn,'/api/queue/'+action,action==='status'?undefined:args.id?{id:args.id}:{})));return;}if(args.command==='status'||args.command==='stop'){console.log(JSON.stringify(await request(conn,args.command==='status'?'/api/status':'/api/stop',args.command==='stop'?{}:undefined)));return;}
 if(args.command==='receipt'){console.log(JSON.stringify({provider:'browser-local',...await request(conn,'/api/receipt/'+args.id)}));return;}
 if(args.sessionId&&args.sessionId!=='manual')await request(conn,'/api/queue/select-source',{sessionId:args.sessionId});
 const job=await request(conn,args.enqueue?'/api/queue/enqueue':'/api/speak',{text,...(args.sessionId?{sessionId:args.sessionId}:{})});let stopping=false;const stop=()=>{if(stopping)return;stopping=true;request(conn,args.enqueue?'/api/queue/cancel-reply':'/api/stop-owned',args.enqueue?{sessionId:args.sessionId||'manual',turnId:job.id,generationId:job.id,messageId:job.id}:{id:job.id}).catch(()=>{});};process.on('SIGINT',stop);process.on('SIGTERM',stop);
 if(args.wait==='false'){process.off('SIGINT',stop);process.off('SIGTERM',stop);console.log(JSON.stringify(job));return;}
 try{
  // Only explicit wait asks for a backlog snapshot. Admission remains immediate
  // by default. A waiter may leave; it never globally stops unrelated replies.
  const state=args.enqueue?await request(conn,'/api/queue/status').catch(()=>null):null;
  const backlog=state?state.queue.queued+state.queue.playing+state.queue.cancelling:128;
  const deadline=Date.now()+waitBudget(text,!!args.enqueue,backlog);
  while(Date.now()<deadline){let result;try{result=await request(conn,args.enqueue?'/api/queue/receipt':'/api/receipt/'+job.id,args.enqueue?{id:job.id}:undefined);}catch{console.log(JSON.stringify({id:job.id,state:'receipt-unavailable',terminal:false,provider:args.enqueue?'browser-local-queue':'browser-local',code:'browser-receipt-unavailable'}));process.exitCode=1;return;}if(['completed','cancelled','failed'].includes(result.state)){console.log(JSON.stringify({provider:args.enqueue?'browser-local-queue':'browser-local',...result}));if(result.state==='failed')process.exitCode=1;return;}await new Promise(r=>setTimeout(r,200));}
  console.log(JSON.stringify({id:job.id,state:'receipt-timeout',terminal:false,provider:args.enqueue?'browser-local-queue':'browser-local',code:'speech-receipt-timeout'}));process.exitCode=1;
 }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={request,connection,waitBudget,main};
