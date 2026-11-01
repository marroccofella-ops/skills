// Actual disposable private filesystem controls; no credentials/network/model.
import fs from 'node:fs';import vm from 'node:vm';import path from 'node:path';import assert from 'node:assert/strict';
import {privateTestFixture} from './private-test-fixture.mjs';
import {publishImmutableBytes} from './bumble-immutable-file.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const root=fs.realpathSync.native(privateTestFixture('momm-immutable-file-')),bytes=Buffer.from('{"synthetic":true}\n');
// Exact generated fault still required. The proposed typed wrapper retains its
// private cause; tests inspect that cause without exposing it in UI/status data.
const fault=pattern=>error=>pattern.test(error.message)||pattern.test(error.cause?.message??'');
let passed=0;const observations=[];
const test=(name,fn)=>{fn();passed++;observations.push(name);};
try{
 test('actual stage reads bind the opened file and bounded bytes across replacement',()=>{
  const source=fs.readFileSync(new URL('./bumble-stage.mjs',import.meta.url),'utf8'),method=source.match(/^  #regularBytes\(file\)\{[\s\S]*?(?=^  #exclusiveFile)/m);assert(method);
  for(const mode of ['unchanged','replaced','grown']){
   let consumed=false,closed=0;
   const stat=(options,ino=1,size=4)=>({isFile:()=>true,isSymbolicLink:()=>false,nlink:options?.bigint?1n:1,ino:options?.bigint?BigInt(ino):ino,dev:options?.bigint?1n:1,size:options?.bigint?BigInt(size):size,mtimeNs:100n});
   const io={constants:{O_RDONLY:0,O_NOFOLLOW:0},lstatSync:(_file,options)=>stat(options,consumed&&mode==='replaced'?2:1,consumed&&mode==='grown'?5:4),openSync:()=>42,fstatSync:(_fd,options)=>stat(options,1,consumed&&mode==='grown'?5:4),closeSync(){closed++;},readFileSync:()=>Buffer.from(mode==='unchanged'?'safe':'other'),readSync(_fd,buffer,offset,length,position){if(position)return 0;const b=Buffer.from(mode==='grown'?'other':'safe');b.copy(buffer,offset,0,length);consumed=true;return Math.min(length,b.length);}};
   const read=vm.runInNewContext('(new class{'+method[0]+'read(file){return this.#regularBytes(file);}})',{fs:io,Buffer,Number,MAX_BYTES:1000,process:{platform:'win32'}});
   if(mode==='unchanged')assert.equal(read.read('/synthetic-stage/state.json').toString(),'safe');
   else assert.throws(()=>read.read('/synthetic-stage/state.json'),/Supplementary store/);
   if(consumed)assert.equal(closed,1,'owned descriptor must close on success or refusal');
  }
 });
 test('complete exclusive publication',()=>{const file=path.join(root,'normal.json'),result=publishImmutableBytes(root,file,bytes);assert(result.published&&result.exclusive);assert.equal(result.completion,false);assert.equal(fs.lstatSync(file).nlink,1);assert(fs.readFileSync(file).equals(bytes));});
 test('dot segments are not publishable names',()=>{for(const name of ['.','..'])assert.throws(()=>publishImmutableBytes(root,root+path.sep+name,bytes),/Invalid bounded immutable publication/,name);});
 test('existing evidence never overwritten',()=>{const file=path.join(root,'normal.json'),original=fs.readFileSync(file);assert.throws(()=>publishImmutableBytes(root,file,Buffer.from('replacement')));assert(fs.readFileSync(file).equals(original));assert.equal(fs.readdirSync(root).filter(n=>n.endsWith('.tmp')).length,0);});
 test('partial write throws before final name exists',()=>{const file=path.join(root,'partial.json'),write=fs.writeFileSync;fs.writeFileSync=function(fd,input,...args){if(typeof fd==='number'){write.call(this,fd,input.subarray(0,3),...args);throw Error('Generated partial write');}return write.call(this,fd,input,...args);};try{assert.throws(()=>publishImmutableBytes(root,file,bytes),fault(/Generated partial write/));}finally{fs.writeFileSync=write;}assert(!fs.existsSync(file));assert.equal(fs.readdirSync(root).filter(n=>n.endsWith('.tmp')).length,0);});
 test('silent short write detected before publication',()=>{const file=path.join(root,'short.json'),write=fs.writeFileSync;fs.writeFileSync=function(fd,input,...args){return write.call(this,fd,typeof fd==='number'?input.subarray(0,3):input,...args);};try{assert.throws(()=>publishImmutableBytes(root,file,bytes),fault(/incomplete/));}finally{fs.writeFileSync=write;}assert(!fs.existsSync(file));});
 test('failed file fsync cannot publish final',()=>{const file=path.join(root,'fsync.json'),sync=fs.fsyncSync;fs.fsyncSync=()=>{throw Error('Generated fsync failure');};try{assert.throws(()=>publishImmutableBytes(root,file,bytes),fault(/Generated fsync failure/));}finally{fs.fsyncSync=sync;}assert(!fs.existsSync(file));});
 test('exclusive link failure preserves prior names',()=>{const file=path.join(root,'link.json'),link=fs.linkSync;fs.linkSync=()=>{throw Error('Generated exclusive link failure');};try{assert.throws(()=>publishImmutableBytes(root,file,bytes),fault(/Generated exclusive link failure/));}finally{fs.linkSync=link;}assert(!fs.existsSync(file));assert.equal(fs.readdirSync(root).filter(n=>n.endsWith('.tmp')).length,0);});
 test('malformed and escaped publication requests refuse',()=>{assert.throws(()=>publishImmutableBytes(root,path.join(root,'..','escape.json'),bytes));assert.throws(()=>publishImmutableBytes(root,path.join(root,'shape.json'),'string'));assert.throws(()=>publishImmutableBytes(root,path.join(root,'huge.json'),Buffer.alloc(4_000_001)));});
 test('failed post-publication cleanup retains complete quarantine aliases',()=>{const file=path.join(root,'cleanup.json'),unlink=fs.unlinkSync;fs.unlinkSync=function(target){if(typeof target==='string'&&target.startsWith(file+'.'))throw Error('Generated alias cleanup failure');return unlink.call(this,target);};try{assert.throws(()=>publishImmutableBytes(root,file,bytes),fault(/Generated alias cleanup failure/));}finally{fs.unlinkSync=unlink;}assert(fs.readFileSync(file).equals(bytes));assert.equal(fs.lstatSync(file).nlink,2);const temporary=fs.readdirSync(root).filter(n=>n.startsWith('cleanup.json.')&&n.endsWith('.tmp'));assert.equal(temporary.length,1);assert.equal(fs.lstatSync(path.join(root,temporary[0])).ino,fs.lstatSync(file).ino);assert.throws(()=>publishImmutableBytes(root,path.join(root,'after-quarantine.json'),bytes),'No automatic alias recovery or weakened privacy inspection');});

 function writeProbe(name,{platform='linux',failSync=false,mutation=null}={}){
  const source=fs.readFileSync(new URL('./'+name,import.meta.url),'utf8'),journal=name.includes('journal');
  function method(signature){const at=source.indexOf(signature);assert(at>=0);if(signature.includes('#write')||signature.includes('#exclusiveFile'))return source.slice(at,source.indexOf('\n',at));const tail=source.slice(at),close=/\r?\n  }(?:\r?\n|$)/.exec(tail);assert(close);return tail.slice(0,close.index+close[0].length);}
  let body=method(journal?' #write(file,bytes){':'  #save(state){'),exclusive=name.includes('stage')?method('  #exclusiveFile(file,bytes){'):'';
  if(mutation==='rename')body=body.replace('fs.renameSync(temporary,this.#file);','');
  if(mutation==='file-fsync'){body=body.replace('fs.fsyncSync(fd);','');exclusive=exclusive.replace('fs.fsyncSync(fd);','');}
  const helpers=source.split(/\r?\n/).filter(line=>/^function (syncPrivateDirectory|publicationFault)\(/.test(line)).join('\n');assert(helpers.includes('syncPrivateDirectory'));
  let fd=0,renamed=false;const paths=new Map(),events=[],fake={constants:{},openSync(file){paths.set(++fd,file);return fd;},writeFileSync(){},fsyncSync(n){events.push(['fsync',paths.get(n)]);if(failSync&&paths.get(n)==='/synthetic-store'&&(journal||renamed))throw Error('Synthetic directory flush failure');},closeSync(){},renameSync(){renamed=true;events.push(['rename']);},existsSync(){return false;},unlinkSync(){}};
  const code=helpers+";class Probe{#root='/synthetic-store';#file='/synthetic-store/state.json';#store='synthetic';#readMarker(){return 'synthetic';}"+exclusive+body+(journal?"run(){this.#write('/synthetic-store/event.json',Buffer.from('synthetic'));}":"run(){this.#save({store_id:'synthetic'});}")+"}new Probe().run();";
  let error;try{vm.runInNewContext(code,{fs:fake,path:path.posix,crypto:{randomUUID:()=> 'synthetic-unique'},Buffer,JSON,encode:JSON.stringify,Error,MAX_BYTES:4000000,requirePrivateEvidence(){},stateFilePresent(){return false;},process:{platform}});}catch(fault){error=fault;}
  return {events,error,journal};
 }
 function ordered({events,error,journal},platform='linux'){
  assert.equal(error,undefined);const fileFlush=events.findIndex(e=>e[0]==='fsync'&&e[1]!=='/synthetic-store');assert(fileFlush>=0,'production file bytes must be flushed');
  const directoryFlush=events.findLastIndex(e=>e[0]==='fsync'&&e[1]==='/synthetic-store');
  if(!journal){const rename=events.findIndex(e=>e[0]==='rename');assert(rename>=0,'production rename must occur');assert(fileFlush<rename,'file bytes flush before rename');if(platform!=='win32')assert(directoryFlush>rename,'directory flush after rename');}
  else if(platform!=='win32')assert(directoryFlush>fileFlush,'journal file flush precedes directory flush');
  if(platform==='win32')assert.equal(directoryFlush,-1,'Windows directory durability remains unqualified');
 }
 for(const name of ['bumble-capacity.mjs','bumble-stage.mjs','bumble-oauth-journal.mjs']){
  for(const platform of ['linux','win32'])test('production file/rename/directory order: '+name+' '+platform,()=>ordered(writeProbe(name,{platform}),platform));
  test('post-publication flush failure requires reconciliation: '+name,()=>{const {error}=writeProbe(name,{failSync:true});assert.equal(error?.code,'MOMM_PRIVATE_STATE_RECONCILIATION_REQUIRED');assert.equal(error.publication_possible,true);assert.match(error.cause.message,/Synthetic directory flush failure/);});
  test('removed production file flush is detected: '+name,()=>assert.throws(()=>ordered(writeProbe(name,{mutation:'file-fsync'})),/production file bytes/));
  if(!name.includes('journal'))test('removed production rename is detected: '+name,()=>assert.throws(()=>ordered(writeProbe(name,{mutation:'rename'})),/production rename/));
 }
 console.log(JSON.stringify({passed,observations,network_calls:0,model_calls:0,credentials_read:false,scope:'Actual local exclusive publication and controlled POSIX ledger write-ordering/failure seams; no native POSIX or power-loss certification'}));
}finally{if(path.dirname(root)!==fs.realpathSync.native(path.dirname(root))||!path.basename(root).startsWith('momm-immutable-file-'))throw Error('Cleanup outside disposable fixture');fs.rmSync(root,{recursive:true,force:true});}
