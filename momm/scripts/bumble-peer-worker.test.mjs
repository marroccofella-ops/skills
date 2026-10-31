// Retired issued-key route must refuse without input, filesystem or network access.
import assert from 'node:assert/strict';import fs from 'node:fs';import https from 'node:https';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {validateShadowConnection,readProtectedServiceKey,runPeerShadowWorker} from './bumble-peer-worker.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
let checks=0,touches=0,io=0;
const trap=()=>{touches++;throw Error('Synthetic inspection reached');};
const poison=new Proxy({},{get:trap,has:trap,ownKeys:trap,getOwnPropertyDescriptor:trap,getPrototypeOf:trap});
const originals={read:fs.readFileSync,open:fs.openSync,stat:fs.lstatSync,request:https.request};
try{
 fs.readFileSync=fs.openSync=fs.lstatSync=https.request=()=>{io++;throw Error('Retired route attempted I/O');};
 for(const value of [undefined,null,{},poison,path.resolve('synthetic-refusal.json')]){assert.throws(()=>validateShadowConnection(value),/unsupported/);checks++;assert.throws(()=>readProtectedServiceKey(value),/unsupported/);checks++;const r=await runPeerShadowWorker(value);assert.equal(r.transport,'refused');assert.equal(r.payload,'protected_preflight_refused');assert.equal(r.finished,false);assert.equal(r.content,null);assert.equal(r.attempt_id,null);checks++;}
 assert.equal(touches,0);assert.equal(io,0);checks+=2;
}finally{fs.readFileSync=originals.read;fs.openSync=originals.open;fs.lstatSync=originals.stat;https.request=originals.request;}
const cli=await new Promise((resolve,reject)=>{
 const env={...process.env,NO_UPDATE_CHECK:'1'};delete env.NODE_OPTIONS;
 const child=spawn(process.execPath,[fileURLToPath(new URL('./bumble-peer-worker.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe'],windowsHide:true,env});
 let stdout='',stderr='',timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill();},10000);
 child.stdout.on('data',b=>{stdout+=b;if(stdout.length>4096)child.kill();});child.stderr.on('data',b=>{stderr+=b;if(stderr.length>4096)child.kill();});
 child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',(status,signal)=>{clearTimeout(timer);resolve({status,signal,stdout,stderr,timedOut});});
 // Keep stdin open and send nothing: the closed entry must not await an input frame.
});
assert.equal(cli.status,2);assert.equal(cli.signal,null);assert.equal(cli.timedOut,false);assert.equal(cli.stderr,'');assert.equal(JSON.parse(cli.stdout).transport,'refused');checks++;
console.log(JSON.stringify({passed:checks,caller_properties_read:touches,credential_or_network_operations:io,external_requests:0,real_credentials_read:0,scope:'Issued-key route retired; OAuth transport is tested separately. No native activation.'}));
