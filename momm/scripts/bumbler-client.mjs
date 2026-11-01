// The CLI half of a Bumbler route: prompt on stdin, answer on stdout, like any
// reviewer CLI. One request, no credential, no retry. The dispatcher's process
// containment owns the deadline, so this sets no timer of its own.
import http from 'node:http';import https from 'node:https';
import {bumblerBase} from './bumbler-route.mjs';
const [baseUrl,model,maxTokens]=process.argv.slice(2);
const stop=(message,code=1)=>{process.stderr.write(`${message}\n`);process.exit(code);};
const MAX_REPLY_BYTES=4_000_000;
try{bumblerBase(baseUrl);}catch{stop('Bumbler address refused');}
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
const body=Buffer.from(JSON.stringify({model,messages:[{role:'user',content:Buffer.concat(chunks).toString('utf8')}],max_tokens:Number(maxTokens),temperature:0,stream:false,response_format:{type:'json_object'}}));
const request=(baseUrl.startsWith('https:')?https:http).request(`${baseUrl}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':body.length}},response=>{
 const reply=[];let bytes=0;response.on('data',chunk=>{bytes+=chunk.length;if(bytes>MAX_REPLY_BYTES)stop('Bumbler reply was too large');reply.push(chunk);});response.on('error',()=>stop('Bumbler connection failed during the reply'));
 response.on('end',()=>{
  if(response.statusCode<200||response.statusCode>=300)stop(`Bumbler model server answered HTTP ${response.statusCode}`);
  let choice;try{choice=JSON.parse(Buffer.concat(reply).toString('utf8')).choices?.[0];}catch{stop('Bumbler reply was not JSON');}
  if(typeof choice?.message?.content!=='string')stop('Bumbler reply had no message content');
  if(choice.finish_reason==='length')stop('Bumbler reply was cut off at the token limit');
  process.stdout.write(choice.message.content);
 });
});
request.on('error',()=>stop('Bumbler model server did not answer'));request.end(body);
