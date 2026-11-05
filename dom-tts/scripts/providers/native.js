const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {fork,spawnSync}=require('node:child_process');
const {powershell,safeEnv,ROOT}=require('../runtime');
const {helperInfo}=require('./windows-helper');
function selectProvider(provider='auto',platform=process.platform){
 const native={win32:'sapi',darwin:'say',linux:'espeak-ng'}[platform];
 if(!native)throw new Error('No native speech adapter for platform '+platform);
 if(provider!=='auto'&&provider!==native)throw new Error('Provider '+provider+' is unavailable on '+platform+'; use '+native);
 return native;
}
function commandFor(provider,options,inputFile){
 if(provider==='sapi'){
  const helper=helperInfo();
  if(helper.state==='blocked')throw new Error('Windows native helper was refused ('+helper.code+'); install a reviewed signed build.');
  if(helper.state==='verified')return {file:helper.file,args:['--input-file',inputFile]};
  return {file:powershell,args:['-NoProfile','-File',path.join(ROOT,'scripts','providers','sapi.ps1'),'-InputFile',inputFile]};
 }
 if(provider==='say')return {file:'/usr/bin/say',args:['-r',String(Math.round(175*options.speed)),...(options.voice?['-v',options.voice]:[]),'-f','-']};
 if(provider==='espeak-ng')return {file:findEspeak(),args:['--stdin','-s',String(Math.round(175*options.speed)),...(options.voice?['-v',options.voice]:[])]};
 throw new Error('Unknown native provider');
}
function findEspeak(){
 // Only absolute PATH entries outside the project may supply executable files.
 // Scripts/symlinks are allowed for package-managed launchers; PATH is a user trust boundary.
 for(const dir of (process.env.PATH||'').split(path.delimiter).filter(Boolean)){
  if(!path.isAbsolute(dir))continue;
  const file=path.resolve(dir,'espeak-ng');
  const inside=(base,target)=>{const rel=path.relative(base,target);return !rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));};
  if(inside(process.cwd(),file)||inside(ROOT,file))continue;
  try{if(inside(process.cwd(),fs.realpathSync(file))||inside(ROOT,fs.realpathSync(file)))continue;const stat=fs.lstatSync(file);if(stat.isFile()||stat.isSymbolicLink()){fs.accessSync(file,fs.constants.X_OK);return file;}}catch{}
 }
 throw new Error('espeak-ng was not found on trusted absolute PATH entries outside this project. Install it through your OS package manager, then run doctor again.');
}
function readBuildIdentity(){
 let sourceManifestSha256=null;try{sourceManifestSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'manifest.json'))).digest('hex');}catch{}
 return {version:require('../../package.json').version,sourceManifestSha256};
}
const loadedBuildIdentity=Object.freeze(readBuildIdentity());
function buildIdentity(){return {...loadedBuildIdentity};}
function availability(provider,{find=findEspeak,access=fs.accessSync,helper=helperInfo}={}){
 if(!['sapi','say','espeak-ng'].includes(provider))return {available:false,code:'native-provider-unavailable',reason:'No supported native speech provider was selected.'};
 try{
  if(provider==='espeak-ng')find();else{
   if(provider==='sapi'){const info=helper();if(info.state==='blocked')return {available:false,code:info.code,reason:'Windows native helper signature or integrity was refused.'};if(info.state==='verified')return {available:true,code:'native-engine-present'};}
   access(provider==='sapi'?powershell:'/usr/bin/say',fs.constants.F_OK);
  }
  return {available:true,code:'native-engine-present'};
 }catch{return {available:false,code:'native-engine-missing',reason:provider==='espeak-ng'?'espeak-ng was not found on trusted absolute PATH entries outside this project. Install it through your OS package manager, then run doctor again.':provider==='say'?'The macOS say engine was not found. Run doctor on a supported macOS installation.':'Windows PowerShell was not found; run doctor on a supported Windows installation.'};}
}
function available(provider){return availability(provider).available;}
function failureFact(stderr=''){
 // Classify only known engine facts, never echo arbitrary stderr or supplied speech.
 stderr=String(stderr).slice(-8192).replace(/\s+/g,' ');
 if(/PSSecurityException|running scripts is disabled|execution polic(?:y|ies)/i.test(stderr))
  return {code:'native-execution-policy-blocked',message:'Windows speech script was blocked by execution policy; use a reviewed signed native-helper package or an administrator-approved script policy. Dom TTS does not bypass policy.'};
 if(/SelectVoice|\bFailed to read voice\b|\bVoice\s+[`'"].*?[`'"]\s+(?:was )?not found\b/i.test(stderr))
  return {code:'native-voice-unavailable',message:'Native speech failed: requested voice is unavailable'};
 // A zero exit is not proof of playback: eSpeak can swallow a PortAudio open error.
 // Do not reject incidental ALSA warnings or generic mentions of audio/voice failure.
 if(/\bPa_OpenStream\b\s*:?\s*(?:err\s*=\s*-\d+|[^;]*?(?:invalid device|error|failed))|\b(?:cannot|could not|failed to) open (?:the )?(?:audio|sound) (?:device|output)|\baudio_open\s*:\s*(?:error|failed)/i.test(stderr))
  return {code:'native-audio-output-unavailable',message:'Native speech failed: audio output is unavailable; check doctor and your audio device'};
 return null;
}
function failureMessage(stderr=''){return failureFact(stderr)?.message||'Native speech failed; check doctor and your audio device';}
function runChild(command,input,context,onProgress){
 return new Promise((resolve,reject)=>{
  if(context.stopped())return resolve();
  const child=fork(path.join(__dirname,'native-worker.js'),[],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:safeEnv(),execArgv:[]});
  let cancelling=false,heartbeat;
  const disconnect=()=>{try{if(child.connected)child.disconnect();}catch{}};
  const cancel=()=>{cancelling=true;clearInterval(heartbeat);if(!child.connected)return;try{child.send({action:'stop'},error=>{if(error)disconnect();});}catch{disconnect();}};context.setChild({kill:cancel});
  let done=false,timedOut=false,ipcError=null,heartbeatError=null,stderr='',engineFailure=null,buffer='',discardingStdout=false;
  const timeout=()=>{if(done)return;timedOut=true;cancel();};
  let timer=setTimeout(timeout,120000);
  function finish(error){if(done)return;done=true;clearTimeout(timer);clearInterval(heartbeat);context.setChild(null);error&&!context.stopped()?reject(error):resolve();}
  child.stderr.on('data',data=>{
   // Retain a fixed safe fact even when later diagnostics fill the bounded text window.
   const text=String(data),priority={'native-execution-policy-blocked':3,'native-voice-unavailable':2,'native-audio-output-unavailable':1};
   for(let i=0;i<text.length;i+=4096){stderr=(stderr+text.slice(i,i+4096)).slice(-8192);const fact=failureFact(stderr);if(fact&&(!engineFailure||priority[fact.code]>priority[engineFailure.code]))engineFailure=fact;}
  });
  child.stdout.on('data',data=>{
   // Only short newline-delimited CHUNK messages are protocol. Discard oversized
   // lines through their delimiter so arbitrary engine stdout cannot grow memory.
   const text=String(data);let at=0;
   while(at<text.length){const newline=text.indexOf('\n',at),end=newline<0?text.length:newline;
    if(!discardingStdout){if(buffer.length+end-at>128){buffer='';discardingStdout=true;}else buffer+=text.slice(at,end);}
    if(newline<0)break;
    if(!discardingStdout){const match=buffer.trim().match(/^CHUNK (\d+)$/);if(match&&!done&&!timedOut&&!ipcError&&!heartbeatError&&Number.isSafeInteger(Number(match[1]))){clearTimeout(timer);timer=setTimeout(timeout,120000);onProgress(Number(match[1]));}}
    buffer='';discardingStdout=false;at=newline+1;
   }
  });
  child.on('error',error=>{const failure=new Error(error.code==='ENOENT'?'Native speech executable is missing':'Native speech could not start');if(!child.pid)return finish(failure);ipcError=failure;cancel();});
  // Wait for pipes to drain as well as worker exit so a final diagnostic is retained.
  // An IPC child disconnected before start may emit exit and pipe closes without close.
  let exited=false,exitCode,stdoutClosed=false,stderrClosed=false;
  const settle=()=>{if(!exited||!stdoutClosed||!stderrClosed)return;const fact=engineFailure;finish(ipcError|| (timedOut?new Error('Native speech chunk exceeded 120 seconds'):exitCode===0&&!fact?null:heartbeatError||Object.assign(new Error(fact?.message||failureMessage(stderr)),{code:fact?.code||'native-playback-failed'})));};
  child.stdout.on('close',()=>{stdoutClosed=true;settle();});child.stderr.on('close',()=>{stderrClosed=true;settle();});
  child.on('exit',code=>{exited=true;exitCode=code;settle();});
  // A heartbeat callback can fail as a successful worker exits; its exit result is authoritative.
  heartbeat=setInterval(()=>{if(done||cancelling)return;try{child.send({action:'heartbeat'},error=>{if(error&&!done){heartbeatError=new Error('Native speech IPC failed');cancel();}});}catch{heartbeatError=new Error('Native speech IPC failed');cancel();}},1000);
  try{child.send({action:'start',command,input:input||''},error=>{if(error){ipcError=new Error('Native speech IPC failed');cancel();}});}catch{ipcError=new Error('Native speech IPC failed');cancel();}
 });
}
async function play(chunks,options,context){
 const provider=selectProvider(options.provider);if(!available(provider))throw new Error('Native speech engine is missing; run doctor');
 if(provider==='sapi'){
  const file=path.join(context.stateDir,'speech-'+crypto.randomBytes(12).toString('hex')+'.json');
  fs.writeFileSync(file,JSON.stringify({chunks,voice:options.voice||'',rate:Math.max(-10,Math.min(10,Math.round((options.speed-1)*10)))}),{encoding:'utf8',mode:0o600,flag:'wx'});
  try{await runChild(commandFor(provider,options,file),'',context,context.progress);}finally{try{fs.unlinkSync(file);}catch{}}
 }else{
  for(let i=0;i<chunks.length&&!context.stopped();i++){context.progress(i);await runChild(commandFor(provider,options),chunks[i],context,()=>{});}
 }
 return provider;
}
function voices(provider){
 let helper;if(provider==='sapi'){helper=helperInfo();if(helper.state==='blocked')throw new Error('Windows native helper signature or integrity was refused');}
 const command=provider==='sapi'?(helper.state==='verified'?{file:helper.file,args:['--voices']}:{file:powershell,args:['-NoProfile','-Command',"Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name } } finally { $s.Dispose() }"]}):provider==='say'?{file:'/usr/bin/say',args:['-v','?']}:{file:findEspeak(),args:['--voices']};
 const result=spawnSync(command.file,command.args,{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:262144,env:safeEnv()});if(result.error||result.status!==0)throw new Error('Voice discovery failed');return parseVoices(provider,result.stdout);
}
function parseVoices(provider,stdout=''){
 const names=[];
 for(const line of String(stdout).slice(0,262144).split(/\r?\n/)){
  let name;
  if(provider==='espeak-ng'){
   // eSpeak's File column is its selectable voice identifier, not the padded display row.
   const match=line.trim().match(/^\d+\s+\S+\s+\S+\s+\S+\s+([a-z0-9_+./-]+)(?:\s|$)/i);name=match?.[1];
  }else if(provider==='say')name=line.match(/^(.+?)\s+[a-z]{2,3}_(?:[a-z]{2}|\d{3})(?:\s|$)/i)?.[1].trim();
  else if(provider==='sapi')name=line.trim();
  if(name&&!names.includes(name))names.push(name);
  if(names.length>=2048)break;
 }
 return names;
}
module.exports={selectProvider,commandFor,available,availability,buildIdentity,play,voices,parseVoices,runChild,failureMessage,failureFact,findEspeak};
