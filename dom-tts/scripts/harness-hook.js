// One explicitly selected host hook payload on stdin; never a transcript watcher.
const {parseCli}=require('./runtime');const {admitHook,HOOK_PAYLOAD_BYTES}=require('./experimental/harness-hook');
async function main({argv=process.argv.slice(2),stdin=process.stdin,stdout=process.stdout,stderr=process.stderr,admit=admitHook}={}){
 let result;
 try{
  let args;try{args=parseCli(argv,{},['source','sessions','dryRun']);if(!['claude-stop','openclaw-message-sent'].includes(args.source)||!args.sessions)throw Error();}catch{throw Error('hook-options-invalid');}
  let bytes=0,chunks=[];for await(const chunk of stdin){const value=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=value.length;if(bytes>HOOK_PAYLOAD_BYTES)throw Error('hook-payload-too-large');chunks.push(value);}
  let raw;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{throw Error('hook-payload-invalid-utf8');}chunks=[];
  if(!raw.trim())result={state:'skipped',code:'hook-empty-input',audio:false};
  else{let record;try{record=JSON.parse(raw);}catch{throw Error('hook-payload-invalid-json');}
   result=await admit(record,{source:args.source,selectedSessions:args.sessions.split(','),dryRun:args.dryRun===undefined?false:args.dryRun});
  }
 }catch(error){const known=new Set(['hook-options-invalid','hook-payload-too-large','hook-payload-invalid-utf8','hook-payload-invalid-json']);result={state:'failed',code:known.has(error?.message)?error.message:'hook-admission-refused',audio:false};}
 // Always leave the host's decision unchanged, including unavailable speech.
 // Failures are typed metadata, never a blocking decision or raw exception.
 stdout.write('{}\n');stderr.write(JSON.stringify(result)+'\n');return result;
}
if(require.main===module)main();
module.exports={main};
