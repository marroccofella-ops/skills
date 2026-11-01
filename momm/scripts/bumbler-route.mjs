// A Bumbler is an ordinary pool reviewer: a lower-powered open model the owner
// runs on their own tailnet. Saved settings say where it answers. This route
// carries no credential, so it refuses any address outside the tailnet range.
import fs from 'node:fs';import http from 'node:http';import https from 'node:https';import net from 'node:net';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {defaultRegistryHome} from './reviewer-registry.mjs';
import {preparePrivateEvidence,requirePrivateEvidence} from './evidence-permissions.mjs';
export const BUMBLER_CLIENT=fileURLToPath(new URL('./bumbler-client.mjs',import.meta.url));
export const BUILT_IN_ROUTES=new Set(['codex','gemini','claude','antigravity','copilot','grok']);
const NAME=/^[a-z][a-z0-9-]{0,31}$/,FIELDS=new Set(['base_url','model','max_tokens','timeout_seconds']);
const problem=(name,detail)=>Error(`Bumbler ${name}: ${detail}`);
const MAX_CONFIG_BYTES=1_000_000;
const settingsRefused=()=>Object.assign(Error('Bumbler settings must be a bounded regular file in a private reviewer home outside the project; inspection or reading was refused.'),{code:'BUMBLER_SETTINGS_REFUSED'});
const sameIdentity=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const sameFile=(a,b)=>sameIdentity(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
function canonical(entry){
 const rest=[];
 for(let current=entry;;current=path.dirname(current)){
  try{return path.join(fs.realpathSync.native(current),...rest.reverse());}
  catch(error){if(error?.code!=='ENOENT'||path.dirname(current)===current)throw settingsRefused();rest.push(path.basename(current));}
 }
}
function readBumblers(env){
 const selected=defaultRegistryHome(env);
 if(!path.isAbsolute(selected))throw settingsRefused();
 const root=path.resolve(selected);
 let missing=false;
 for(let entry=root;;entry=path.dirname(entry)){
  try{const stat=fs.lstatSync(entry);if(stat.isSymbolicLink()||!stat.isDirectory())throw settingsRefused();}
  catch(error){if(error?.code==='ENOENT')missing=true;else throw settingsRefused();}
  if(path.dirname(entry)===entry)break;
 }
 // Literal links are refused above, so this resolves only spellings such as 8.3 short names.
 const relative=path.relative(fs.realpathSync.native(process.cwd()),canonical(root));
 if(!relative||(!(relative==='..'||relative.startsWith('..'+path.sep))&&!path.isAbsolute(relative)))throw settingsRefused();
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
function checked(name,entry){
 if(typeof name!=='string'||!NAME.test(name)||BUILT_IN_ROUTES.has(name))throw problem(name,'invalid or reserved name');
 if(!entry||typeof entry!=='object'||Array.isArray(entry)||Object.keys(entry).some(key=>!FIELDS.has(key)))throw problem(name,'unsupported fields');
 if(typeof entry.model!=='string'||!entry.model.trim()||entry.model.length>200)throw problem(name,'model is required');
 const maxTokens=entry.max_tokens??1024,seconds=entry.timeout_seconds??180;
 if(!Number.isSafeInteger(maxTokens)||maxTokens<1||maxTokens>65536||!Number.isSafeInteger(seconds)||seconds<1||seconds>3600)throw problem(name,'max_tokens must be 1 to 65536 and timeout_seconds 1 to 3600');
 try{return {base_url:bumblerBase(entry.base_url),model:entry.model.trim(),max_tokens:maxTokens,timeout_seconds:seconds};}catch(error){throw problem(name,error.message);}
}
function savedFile(env){return path.join(defaultRegistryHome(env),'bumblers.json');}
function readSaved(env){
 const text=readBumblers(env);if(text===null)return {};
 let saved;try{saved=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw Error('bumblers.json is not valid JSON');}
 if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('bumblers.json must be an object of named Bumblers');
 return Object.fromEntries(Object.entries(saved).map(([name,entry])=>[name,checked(name,entry)]));
}
function writeSaved(saved,env){
 const file=savedFile(env),temporary=`${file}.${process.pid}.tmp`;preparePrivateEvidence(path.dirname(file));
 try{fs.writeFileSync(temporary,JSON.stringify(saved,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temporary,file);}
 catch(error){fs.rmSync(temporary,{force:true});throw error;}
}
export function loadBumblers(env=process.env){
 const saved=readSaved(env),routes=Object.create(null);
 for(const [name,entry] of Object.entries(saved))routes[name]={base_url:entry.base_url,model:entry.model,max_tokens:entry.max_tokens,timeout_ms:entry.timeout_seconds*1000};
 return routes;
}
export function listBumblers(env=process.env){return Object.entries(readSaved(env)).map(([name,entry])=>({name,...entry}));}
export function saveBumbler(name,entry,env=process.env){const saved=readSaved(env);saved[name]=checked(name,entry);writeSaved(saved,env);return listBumblers(env);}
export function removeBumbler(name,env=process.env){const saved=readSaved(env);if(!Object.hasOwn(saved,name))throw problem(name,'not saved');delete saved[name];writeSaved(saved,env);return listBumblers(env);}
// A reply that fails the quotation contract still goes to the governor: its findings join the
// report marked quotes_unverified, and it counts as no successful review and no vote.
// Models often think aloud before the JSON.
export function bumblerAnswer(text){
 const raw=String(text??'');if(raw.length>1_000_000)return null;
 // The last few object starts, newest first, so preamble braces cost nothing.
 const end=raw.lastIndexOf('}')+1;let tries=0;
 for(let at=raw.lastIndexOf('{',end);at>=0&&tries<256;at=at?raw.lastIndexOf('{',at-1):-1){
  if(!/^\{\s*"/.test(raw.slice(at,at+400)))continue;tries++;
  let value;try{value=JSON.parse(raw.slice(at,end));}catch{continue;}
  if(!value||typeof value!=='object'||!('verdict' in value||'findings' in value))continue;
  const clip=(item,max=600)=>typeof item==='string'?item.slice(0,max):null;
  return {verdict:clip(value.verdict,20),summary:clip(value.summary),findings:(Array.isArray(value.findings)?value.findings:[]).slice(0,20).filter(f=>typeof f?.issue==='string'&&f.issue.trim()),suggestions:(Array.isArray(value.suggested_improvements)?value.suggested_improvements:[]).slice(0,10).map(s=>clip(s)).filter(Boolean)};
 }
 return null;
}
// Preflight says whether the model answers. Like every route, it is informational.
export function bumblerReadiness(agent,bumbler,timeoutMs=5000){
 return new Promise(resolve=>{
  let timer;const finish=(ready,note)=>{clearTimeout(timer);resolve({agent,installed:true,version:null,ready,auth:'none',modalities:['text'],...(note?{note}:{})});};
  const request=(bumbler.base_url.startsWith('https:')?https:http).get(`${bumbler.base_url}/models`,response=>{response.resume();response.on('error',()=>{});finish(response.statusCode>=200&&response.statusCode<300,response.statusCode<300?null:`model server answered HTTP ${response.statusCode}`);request.destroy();});
  timer=setTimeout(()=>request.destroy(Error('timeout')),timeoutMs);request.on('error',()=>finish(false,'model server did not answer'));
 });
}
