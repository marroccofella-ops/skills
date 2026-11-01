// A Bumbler is an ordinary pool reviewer: a lower-powered open model the owner
// runs on their own tailnet. Saved settings say where it answers. This route
// carries no credential, so it refuses any address outside the tailnet range.
import fs from 'node:fs';import http from 'node:http';import https from 'node:https';import net from 'node:net';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {defaultRegistryHome} from './reviewer-registry.mjs';
export const BUMBLER_CLIENT=fileURLToPath(new URL('./bumbler-client.mjs',import.meta.url));
export const BUILT_IN_ROUTES=new Set(['codex','gemini','claude','antigravity','copilot','grok']);
const NAME=/^[a-z][a-z0-9-]{0,31}$/,FIELDS=new Set(['base_url','model','max_tokens','timeout_seconds']);
const problem=(name,detail)=>Error(`Bumbler ${name}: ${detail}`);
function tailnetAddress(host){if(host==='127.0.0.1')return true;if(net.isIP(host)!==4)return false;const [a,b]=host.split('.').map(Number);return a===100&&b>=64&&b<=127;}
export function bumblerBase(value){
 let url;try{url=new URL(value);}catch{throw Error('base_url is not a URL');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/v1')throw Error('base_url must look like http://<tailnet address>:<port>/v1');
 if(!tailnetAddress(url.hostname))throw Error('base_url must be a literal tailnet address, because this route has no credential');
 return url.toString().replace(/\/$/,'');
}
export function loadBumblers(env=process.env){
 const file=path.join(defaultRegistryHome(env),'bumblers.json');let text;
 try{text=fs.readFileSync(file,'utf8');}catch(error){if(error?.code==='ENOENT')return Object.create(null);throw error;}
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
