// A Bumbler is an ordinary pool reviewer: a lower-powered open model the owner
// runs on their own tailnet. Saved settings say where it answers. This route
// carries no credential, so it refuses any address outside the tailnet range.
import fs from 'node:fs';import http from 'node:http';import https from 'node:https';import net from 'node:net';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {defaultRegistryHome} from './reviewer-registry.mjs';
import {requirePrivateEvidence} from './evidence-permissions.mjs';
export const BUMBLER_CLIENT=fileURLToPath(new URL('./bumbler-client.mjs',import.meta.url));
export const BUILT_IN_ROUTES=new Set(['codex','gemini','claude','antigravity','copilot','grok']);
const NAME=/^[a-z][a-z0-9-]{0,31}$/,FIELDS=new Set(['base_url','model','max_tokens','timeout_seconds']);
const problem=(name,detail)=>Error(`Bumbler ${name}: ${detail}`);
const MAX_CONFIG_BYTES=1_000_000;
const settingsRefused=()=>Object.assign(Error('Bumbler settings must be a bounded regular file in a private reviewer home outside the project; inspection or reading was refused.'),{code:'BUMBLER_SETTINGS_REFUSED'});
const sameIdentity=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const sameFile=(a,b)=>sameIdentity(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
function readBumblers(env){
 const selected=defaultRegistryHome(env);
 if(!path.isAbsolute(selected))throw settingsRefused();
 const root=path.resolve(selected),relative=path.relative(fs.realpathSync(process.cwd()),root);
 if(!relative||(!(relative==='..'||relative.startsWith('..'+path.sep))&&!path.isAbsolute(relative)))throw settingsRefused();
 let missing=false;
 for(let entry=root;;entry=path.dirname(entry)){
  try{const stat=fs.lstatSync(entry);if(stat.isSymbolicLink()||!stat.isDirectory())throw settingsRefused();}
  catch(error){if(error?.code==='ENOENT')missing=true;else throw settingsRefused();}
  if(path.dirname(entry)===entry)break;
 }
 if(missing)return null;
 const rootBefore=fs.lstatSync(root,{bigint:true}),file=path.join(root,'bumblers.json');
 let before;
 try{before=fs.lstatSync(file,{bigint:true});}catch(error){if(error?.code!=='ENOENT')throw settingsRefused();}
 if(before&&(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size>BigInt(MAX_CONFIG_BYTES)))throw settingsRefused();
 try{requirePrivateEvidence(root);}catch{throw settingsRefused();}
 if(!before)return null;
 let fd;
 try{
  fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
  const opened=fs.fstatSync(fd,{bigint:true});
  if(!sameFile(before,opened)||!opened.isFile()||opened.nlink!==1n)throw settingsRefused();
  const bytes=Buffer.alloc(MAX_CONFIG_BYTES+1);let length=0;
  while(length<bytes.length){const count=fs.readSync(fd,bytes,length,bytes.length-length,null);if(count===0)break;length+=count;}
  if(length>MAX_CONFIG_BYTES)throw settingsRefused();
  const after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true}),rootAfter=fs.lstatSync(root,{bigint:true});
  if(!sameFile(opened,after)||!sameFile(after,named)||after.size!==BigInt(length)||after.nlink!==1n||named.isSymbolicLink()||!sameIdentity(rootBefore,rootAfter)||rootAfter.isSymbolicLink())throw settingsRefused();
  return bytes.subarray(0,length).toString('utf8');
 }catch{throw settingsRefused();}finally{if(fd!==undefined)fs.closeSync(fd);}
}
function tailnetAddress(host){if(host==='127.0.0.1')return true;if(net.isIP(host)!==4)return false;const [a,b]=host.split('.').map(Number);return a===100&&b>=64&&b<=127;}
export function bumblerBase(value){
 let url;try{url=new URL(value);}catch{throw Error('base_url is not a URL');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/v1')throw Error('base_url must look like http://<tailnet address>:<port>/v1');
 if(!tailnetAddress(url.hostname))throw Error('base_url must be a literal tailnet address, because this route has no credential');
 return url.toString().replace(/\/$/,'');
}
export function loadBumblers(env=process.env){
 let text;try{text=readBumblers(env);}catch{throw settingsRefused();}if(text===null)return Object.create(null);
 let saved;try{saved=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw Error('bumblers.json is not valid JSON');}if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('bumblers.json must be an object of named Bumblers');
 return Object.assign(Object.create(null),Object.fromEntries(Object.entries(saved).map(([name,entry])=>{
  if(!NAME.test(name)||BUILT_IN_ROUTES.has(name))throw problem(name,'invalid or reserved name');
  if(!entry||typeof entry!=='object'||Object.keys(entry).some(key=>!FIELDS.has(key)))throw problem(name,'unsupported fields');
  if(typeof entry.model!=='string'||!entry.model.trim()||entry.model.length>200)throw problem(name,'model is required');
  const maxTokens=entry.max_tokens??1024,seconds=entry.timeout_seconds??180;
  if(!Number.isSafeInteger(maxTokens)||maxTokens<1||maxTokens>65536||!Number.isSafeInteger(seconds)||seconds<1||seconds>3600)throw problem(name,'max_tokens must be 1 to 65536 and timeout_seconds 1 to 3600');
  try{return [name,{base_url:bumblerBase(entry.base_url),model:entry.model.trim(),max_tokens:maxTokens,timeout_ms:seconds*1000}];}catch(error){throw problem(name,error.message);}
 })));
}
// Preflight says whether the model answers. Like every route, it is informational.
export function bumblerReadiness(agent,bumbler,timeoutMs=5000){
 return new Promise(resolve=>{
  let timer;const finish=(ready,note)=>{clearTimeout(timer);resolve({agent,installed:true,version:null,ready,auth:'none',modalities:['text'],...(note?{note}:{})});};
  const request=(bumbler.base_url.startsWith('https:')?https:http).get(`${bumbler.base_url}/models`,response=>{response.resume();response.on('error',()=>{});finish(response.statusCode>=200&&response.statusCode<300,response.statusCode<300?null:`model server answered HTTP ${response.statusCode}`);request.destroy();});
  timer=setTimeout(()=>request.destroy(Error('timeout')),timeoutMs);request.on('error',()=>finish(false,'model server did not answer'));
 });
}
