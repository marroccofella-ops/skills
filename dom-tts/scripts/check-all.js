// Complete portable regression plan, including the core corpus. Native audible
// certification is separate: this plan never invokes windows-check.cjs.
const path=require('node:path'),{spawn}=require('node:child_process');
const {ROOT,safeEnv}=require('./runtime');
async function main(){
 const plan=require('./test-suites.json');
 if(plan.schema!=='dom-tts-portable-tests/1'||!Array.isArray(plan.suites)||plan.suites.some(item=>!item||!/^((scripts\/self-test\.js)|(tests\/[a-z0-9-]+\.cjs))$/.test(item.file)||!Array.isArray(item.args)||item.args.some(arg=>!/^--[a-z-]+$/.test(arg))||item.file==='tests/windows-check.cjs'))throw Error('Portable test plan refused');
 if(process.argv.length>2){if(process.argv.length!==3||process.argv[2]!=='--list')throw Error('Use --list or no arguments');console.log(JSON.stringify(plan,null,2));return;}
 require('./package').verify();
 const env=safeEnv();delete env.DOM_TTS_HOME;delete env.DOM_TTS_STATE_DIR;
 const results=[];
 for(const item of plan.suites){
  if(item.platform&&item.platform!==process.platform){results.push({file:item.file,args:item.args,state:'platform-skipped'});continue;}
  const start=Date.now(),child=spawn(process.execPath,[path.join(ROOT,item.file),...item.args],{env,windowsHide:true,shell:false,stdio:'inherit'});
  let spawnError=false,timedOut=false;child.on('error',()=>{spawnError=true;});
  const timer=setTimeout(()=>{timedOut=true;child.kill();},process.platform==='win32'?1200000:600000);
  const [code,signal]=await new Promise(resolve=>child.once('close',(code,signal)=>resolve([code,signal])));clearTimeout(timer);
  const result={file:item.file,args:item.args,state:code===0&&!spawnError&&!timedOut?'passed':'failed',exitCode:code,signal,timedOut,elapsedMs:Date.now()-start};results.push(result);
  if(result.state!=='passed'){console.error(JSON.stringify(result));process.exitCode=1;break;}
 }
 console.log(JSON.stringify({schema:plan.schema,passed:results.filter(r=>r.state==='passed').length,skipped:results.filter(r=>r.state==='platform-skipped').length,failed:results.filter(r=>r.state==='failed').length,totalPlanned:plan.suites.length,scope:'Portable process/fixture checks. No native audio, GUI, signing or human hearing certification.'},null,2));
}
if(require.main===module)main().catch(()=>{console.error('Portable test runner failed; inspect the preceding suite output.');process.exitCode=1;});
module.exports={main};
