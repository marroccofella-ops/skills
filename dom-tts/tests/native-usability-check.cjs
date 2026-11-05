// Native-process stand-ins and public stderr fixtures; never invokes an audio engine.
const assert=require('node:assert/strict'),cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const originalSpawn=cp.spawnSync;
let voiceTable='Pty Language Age/Gender VoiceName          File          Other Languages\n 5  en-us    --/M       English_(America)   gmw/en-US     (en 3)\n 5  en-gb    --/M       English_(GB)        gmw/en        (en 2)\n';
cp.spawnSync=()=>({status:0,stdout:voiceTable,stderr:''});
const native=require('../scripts/providers/native');
const {doctor}=require('../scripts/doctor');
const audioError="ALSA lib confmisc.c:855:(parse_card) cannot find card '0'\nALSA lib pcm.c:2666:(snd_pcm_open_noupdate) Unknown PCM default\nwave_open_sound > Pa_OpenStream : err=-9996 (Invalid device)\n";
async function observe(){
 const before=process.env.PATH;process.env.PATH='';let missing;
 try { missing=native.availability?native.availability('espeak-ng'):{available:native.available('espeak-ng')}; } finally {process.env.PATH=before;}
 // SAPI avoids looking up an actual platform executable; injected stdout is public fixture data.
 const rawVoiceLines=native.parseVoices?native.parseVoices('espeak-ng',voiceTable):native.voices('say');
 let outcome;try{await native.runChild({file:process.execPath,args:['-e',`process.stderr.write(${JSON.stringify(audioError)});process.exit(0)`]},'',{stopped:()=>false,setChild:()=>{}},()=>{});outcome='completed';}catch(e){outcome=e.message;}
 return {qualification:'Windows Node stand-in and injected engine output only; no native playback or Linux audio engine run',zeroExitAudioFailure:outcome,voiceIdentifiers:rawVoiceLines,invalidEspeakVoice:native.failureMessage("Error: Failed to read voice 'missing-voice'"),invalidMacVoice:native.failureMessage("Voice `missing-voice' not found."),missingEngine:missing};
}
async function main(){
 const observation=await observe();
 if(process.argv.includes('--observe')){console.log(JSON.stringify(observation,null,2));return;}
 assert.match(observation.zeroExitAudioFailure,/audio output.*unavailable/i);
 assert.deepEqual(observation.voiceIdentifiers,['gmw/en-US','gmw/en']);
 assert.match(observation.invalidEspeakVoice,/requested voice is unavailable/);
 assert.match(observation.invalidMacVoice,/requested voice is unavailable/);
 assert.equal(observation.missingEngine.available,false);assert.equal(observation.missingEngine.code,'native-engine-missing');assert.match(observation.missingEngine.reason,/espeak-ng.*not found/);
 assert.deepEqual(native.parseVoices('sapi','Microsoft David Desktop\nMicrosoft Zira Desktop\n'),['Microsoft David Desktop','Microsoft Zira Desktop']);
 assert.deepEqual(native.parseVoices('say','Eddy (English (US))  en_US # Hello\nSamantha             en_US # Hello\n'),['Eddy (English (US))','Samantha']);
 assert.deepEqual(native.parseVoices('espeak-ng','unrecognized output\n 5 en-us --/M English file\n'),['file']);
 assert.match(native.failureMessage("PSSecurityException SelectVoice Failed to read voice"),/blocked by execution policy/);
 for(const text of ['unrelated failure','audio policy denied','voice initialization failed','ALSA lib parser warning'])assert.doesNotMatch(native.failureMessage(text),/requested voice is unavailable|audio output.*unavailable/);
 await native.runChild({file:process.execPath,args:['-e',"process.stderr.write('ALSA lib parser warning\\n');process.exit(0)"]},'',{stopped:()=>false,setChild:()=>{}},()=>{});
 const fallbackWarnings="ALSA lib confmisc.c:855:(parse_card) cannot find card '0'\nALSA lib pcm.c:2666:(snd_pcm_open_noupdate) Unknown PCM default\n";
 await native.runChild({file:process.execPath,args:['-e',`process.stderr.write(${JSON.stringify(fallbackWarnings)});process.exitCode=0;`]},'',{stopped:()=>false,setChild:()=>{}},()=>{});
 const chunks=[];await native.runChild({file:process.execPath,args:['-e',"process.stdout.write('x'.repeat(2000000)+'CHUNK 99\\n');process.stdout.write('CHU');setTimeout(()=>process.stdout.write('NK 3\\r\\nCHUNK 4\\n'),25);process.exitCode=0;"]},'',{stopped:()=>false,setChild:()=>{}},index=>chunks.push(index));assert.deepEqual(chunks,[3,4]);
 const flood="const b=Buffer.alloc(65536,120);let left=512;function next(){while(left-->0){if(!process.stdout.write(b)){process.stdout.once('drain',next);return;}}process.stdout.write('\\nCHUNK 2\\n');}next();";
 const governor=`const n=require(${JSON.stringify(require.resolve('../scripts/providers/native'))});const seen=[];n.runChild({file:process.execPath,args:['-e',${JSON.stringify(flood)}]},'',{stopped:()=>false,setChild:()=>{}},i=>seen.push(i)).then(()=>{if(JSON.stringify(seen)!=='[2]')process.exitCode=2;else console.log('bounded stdout completed');},()=>process.exitCode=3);`;
 const bounded=originalSpawn(process.execPath,['--max-old-space-size=24','-e',governor],{encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:8192,env:require('../scripts/runtime').safeEnv()});assert.equal(bounded.status,0,'Native stdout governor must survive a 32MB line under a 24MB heap limit');assert.match(bounded.stdout,/bounded stdout completed/);
 await assert.rejects(native.runChild({file:process.execPath,args:['-e',`process.stderr.write(${JSON.stringify(audioError)}+'x'.repeat(20000));process.stderr.write('PRIVATE_SENTINEL');process.exitCode=0;`]},'',{stopped:()=>false,setChild:()=>{}},()=>{}),error=>error.code==='native-audio-output-unavailable'&&!error.message.includes('PRIVATE_SENTINEL'));
 await assert.rejects(native.runChild({file:process.execPath,args:['-e',`process.stderr.write(${JSON.stringify("Voice `missing-voice' not found.")});process.exit(1)`]},'',{stopped:()=>false,setChild:()=>{}},()=>{}),/requested voice is unavailable/);
 const info=doctor({platform:'linux',select:()=> 'espeak-ng',inspect:()=>({available:false,code:'native-engine-missing',reason:'espeak-ng was not found'})});
 assert.equal(info.available,false);assert.equal(info.code,'native-engine-missing');assert.match(info.reason,/not found/);assert.equal(info.outputDevice.state,'unverified');assert.equal(info.audiblePlaybackVerified,false);
 const {status}=require('../scripts/status'),idleStatus=status(path.join(__dirname,'nonexistent-status-fixture'));assert.equal(idleStatus.playbackBuild.state,'unverified');
 for(const value of [info,idleStatus.reporterBuild]){assert.equal(value.version,require('../package.json').version);assert.match(value.sourceManifestSha256,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(value),/speech text|PRIVATE_SENTINEL/);}
 const ownerBase=path.resolve(__dirname,'../.local-test');fs.mkdirSync(ownerBase,{recursive:true});const ownerDir=fs.mkdtempSync(path.join(ownerBase,'dom-native-owner-'));try{const oldBuild={version:'old-owner',sourceManifestSha256:'b'.repeat(64)};fs.writeFileSync(path.join(ownerDir,'status.json'),JSON.stringify({state:'speaking',version:'ambiguous-old-field',playbackBuild:oldBuild}));const seen=status(ownerDir);assert.deepEqual(seen.playbackBuild,oldBuild);assert.deepEqual(seen.reporterBuild,native.buildIdentity());assert.equal(seen.version,undefined);await require('../scripts/speak').playback({waitMs:0,chunks:['Public stand-in text'],mode:'informative',profile:'conversational',provider:'auto'},{dir:ownerDir,privacy:()=>{},play:async()=>{}});assert.deepEqual(status(ownerDir).playbackBuild,native.buildIdentity());}finally{assert.equal(path.dirname(path.resolve(ownerDir)),ownerBase);assert(path.basename(ownerDir).startsWith('dom-native-owner-'));fs.rmSync(ownerDir,{recursive:true,force:true});}
 assert.equal(info.sourceManifestSha256,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../manifest.json'))).digest('hex'));
 console.log('PASS: native audio failure despite zero exit, selectable voice parsing, precise voice/policy classification, missing-engine diagnostics and public build identity; Node stand-ins only, no audible certification');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>{cp.spawnSync=originalSpawn;});
