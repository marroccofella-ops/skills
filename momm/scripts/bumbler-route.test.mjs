// Real multi-review CLI against a local stand-in model server. No real model, credential or tailnet traffic.
import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {bumblerBase,loadBumblers} from './bumbler-route.mjs';
import {inspectCompletion} from './governor.mjs';
import {privateTestFixture} from './private-test-fixture.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const script=fileURLToPath(new URL('./multi-review.mjs',import.meta.url));
const diff='diff --git a/sample.js b/sample.js\n--- a/sample.js\n+++ b/sample.js\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n';
const review={review_status:'complete',verdict:'ACCEPT',confidence:0.8,summary:'Synthetic Bumbler review.',reviewed_scope:[{quote:'const a = 2;',assessment:'Synthetic change inspected.'}],findings:[],suggested_improvements:[]};
for(const good of ['http://127.0.0.1:9/v1','http://100.64.0.1:8080/v1','https://100.127.255.1:8080/v1'])assert.equal(bumblerBase(good),good);
for(const bad of ['http://8.8.8.8:8080/v1','http://example.com/v1','http://100.128.0.1/v1','http://100.64.0.1:8080/v2','http://user:pw@100.64.0.1/v1','http://100.64.0.1/v1?x=1','not a url'])assert.throws(()=>bumblerBase(bad),undefined,bad);
const parent=fs.realpathSync.native(privateTestFixture('momm-bumbler-test-'));
const home=path.join(parent,'reviewers'),project=path.join(parent,'project');fs.mkdirSync(home,{mode:0o700});fs.mkdirSync(project,{mode:0o700});
const save=value=>fs.writeFileSync(path.join(home,'bumblers.json'),JSON.stringify(value),{mode:0o600});
assert.equal(Object.keys(loadBumblers({MOMM_REVIEWER_HOME:home})).length,0,'no saved Bumblers is not an error');assert.equal(loadBumblers({MOMM_REVIEWER_HOME:home}).constructor,undefined,'inherited names are not saved routes');
for(const bad of [{bab:{base_url:'http://127.0.0.1:9/v1',model:'m',timeout_seconds:3601}},{bab:{base_url:'http://127.0.0.1:9/v1',model:'m',max_tokens:70000}},{codex:{base_url:'http://127.0.0.1:9/v1',model:'m'}},{bab:{base_url:'http://8.8.8.8/v1',model:'m'}},{bab:{base_url:'http://127.0.0.1:9/v1'}},{bab:{base_url:'http://127.0.0.1:9/v1',model:'m',api_key:'x'}}]){save(bad);assert.throws(()=>loadBumblers({MOMM_REVIEWER_HOME:home}),/Bumbler /);}
fs.writeFileSync(path.join(home,'bumblers.json'),'{not json');assert.throws(()=>loadBumblers({MOMM_REVIEWER_HOME:home}),/bumblers\.json/);
const run=(args,input)=>new Promise(resolve=>{
 const env={...process.env,MOMM_REVIEWER_HOME:home,MOMM_EVIDENCE_HOME:path.join(parent,'evidence'),NO_UPDATE_CHECK:'1',MOMM_NO_UPDATE_CHECK:'1',DO_NOT_TRACK:'1'};
 const child=spawn(process.execPath,[script,'--governor','claude','--no-ui',...args],{cwd:project,env,windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.setEncoding('utf8');child.stdout.on('data',b=>{stdout+=b;});child.stderr.setEncoding('utf8');child.stderr.on('data',b=>{stderr+=b;});child.stdin.end(input);
 child.on('close',code=>{let report=null;try{report=JSON.parse(stdout);}catch{}resolve({code,report,stderr});});
});
{const file=path.join(home,'bumblers.json'),bad=fs.readFileSync(file);fs.rmSync(file);const inherited=await run(['--preflight','--reviewers','constructor'],'');fs.writeFileSync(file,bad);assert.equal(inherited.code,0,inherited.stderr);assert.doesNotMatch(inherited.stderr,/TypeError/);}
const broken=await run(['--reviewers','bab'],diff);assert.equal(broken.code,4,'a broken settings file is a clean refusal');assert.match(broken.stderr,/bumblers\.json/);
let answer,seen=[],active=0,peak=0;
const server=http.createServer((request,response)=>{
 if(request.method==='GET'){response.writeHead(200,{'Content-Type':'application/json'});response.end('{"data":[]}');return;}
 const chunks=[];request.on('data',b=>chunks.push(b));request.on('end',async()=>{seen.push({headers:request.headers,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,20));active--;answer(response);});
});
const reply=(content,finish='stop')=>response=>{response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({choices:[{finish_reason:finish,message:{content}}]}));};
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 save({bab:{base_url:`http://127.0.0.1:${server.address().port}/v1`,model:'synthetic-open-model',max_tokens:512,timeout_seconds:30}});
 const row=result=>result.report?.reviewers?.find(r=>r.agent==='bab');
 answer=reply(JSON.stringify(review));
 const good=await run(['--reviewers','bab'],diff);assert.equal(row(good)?.status,'success',JSON.stringify(row(good)));assert.equal(row(good).verdict,'ACCEPT');
 assert.equal(seen.length,1);assert.equal(seen[0].body.model,'synthetic-open-model');assert.equal(seen[0].body.max_tokens,512);assert.equal(seen[0].headers.authorization,undefined,'this route carries no credential');assert.match(seen[0].body.messages[0].content,/const a = 2;/);
 fs.writeFileSync(path.join(project,'change.diff'),diff);const gate=await run(['--reviewers','bab','--min-success','1','--input','change.diff'],'');assert.equal(row(gate)?.status,'success');assert.equal(gate.report.quorum.achieved,0,'a Bumbler finding is evidence, not a quorum vote');assert.equal(gate.code,3);assert.equal(row(gate).advisory,true);assert.equal(row(gate).credential,'none');assert.equal(row(gate).model,'synthetic-open-model');assert.equal(row(gate).max_tokens,512);assert.equal(row(gate).timeout_ms,30000);assert.equal(row(gate).base_url,undefined,'reports reach the public evidence export, so the address stays out');assert.equal(row(gate).endpoint_sha256,createHash('sha256').update(`http://127.0.0.1:${server.address().port}/v1`).digest('hex'));assert(!JSON.stringify(gate.report).includes(`127.0.0.1:${server.address().port}`));
 process.env.MOMM_EVIDENCE_HOME=path.join(parent,'evidence');const recount=inspectCompletion(project,gate.report.run_id);delete process.env.MOMM_EVIDENCE_HOME;assert.equal(recount.quorum?.achieved,0,'the governor recount agrees');assert.equal(recount.quorum.met,false);
 assert.equal(peak,1,'one request at a time');save({bab:{base_url:`http://127.0.0.1:${server.address().port}/v1`,model:'synthetic-open-model',max_tokens:512,timeout_seconds:30},bee:{base_url:`http://127.0.0.1:${server.address().port}/v1`,model:'synthetic-open-model',max_tokens:512,timeout_seconds:30}});
 answer=response=>{response.writeHead(503);response.end('busy');};const covered=await run(['--reviewers','bab,bee','--cover'],diff);assert.equal(JSON.stringify(covered.report).includes('covering_for'),false,'a Bumbler neither covers nor is covered');save({bab:{base_url:`http://127.0.0.1:${server.address().port}/v1`,model:'synthetic-open-model',max_tokens:512,timeout_seconds:30}});
 answer=reply('This looks fine to me.');const prose=await run(['--reviewers','bab'],diff);assert.equal(row(prose)?.status,'invalid_output');
 answer=reply('{"verdict":',  'length');const cut=await run(['--reviewers','bab'],diff);assert.equal(row(cut)?.status,'error',JSON.stringify(row(cut)));
 answer=response=>{response.writeHead(503);response.end('busy');};const busy=await run(['--reviewers','bab'],diff);
 answer=response=>{response.writeHead(200,{'Content-Type':'application/json'});response.end(Buffer.alloc(5_000_000,32));};const huge=await run(['--reviewers','bab'],diff);assert.equal(row(huge)?.status,'error','an oversized reply is refused');assert.notEqual(row(busy)?.status,'success');assert(row(busy),'a busy model is a status on the report');
 await new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);});
 const off=await run(['--reviewers','bab'],diff);assert.notEqual(row(off)?.status,'success');assert(row(off),'a model server that is off is a status on the report');assert(off.report,'the review still reports');
 console.log(JSON.stringify({passed:true,transport:'loopback stand-in only',scope:'real multi-review CLI against a local stand-in model server'}));
}finally{if(server.listening)await new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);});fs.rmSync(parent,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
