// The CLI half of a Bumbler route: prompt on stdin, answer on stdout, like any
// reviewer CLI. No credential. A shared server that answers 429 (busy) is asked again
// after busyWait, unless waiting is off or the wait would pass the deadline the dispatcher
// set once at launch. Nothing else is retried: a timeout or broken connection may have
// reached the model. The dispatcher's process containment still owns the hard limit.
import http from 'node:http';import https from 'node:https';
import {bumblerBase,busyWait} from './bumbler-route.mjs';
const [baseUrl,model,maxTokens,deadline,waitWhenBusy]=process.argv.slice(2);
const stop=(message,code=1)=>{process.stderr.write(`${message}\n`);process.exit(code);};
const MAX_REPLY_BYTES=4_000_000;
try{bumblerBase(baseUrl);}catch{stop('Bumbler address refused');}
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
const {system,user}=JSON.parse(Buffer.concat(chunks).toString('utf8'));
const body=Buffer.from(JSON.stringify({model,messages:[{role:'system',content:system},{role:'user',content:user}],max_tokens:Number(maxTokens),temperature:0,stream:false,response_format:{type:'json_object'}}));
let waits=0;
const limit=Number(deadline)||Infinity;
const send=()=>{if(Date.now()>=limit)stop('Bumbler model server was not asked: the time limit had passed');const request=(baseUrl.startsWith('https:')?https:http).request(`${baseUrl}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':body.length}},response=>{
 if(response.statusCode===429){response.resume();if(waitWhenBusy!=='1')stop('Bumbler model server answered HTTP 429 (busy)');const wait=busyWait(response.headers['retry-after'],waits++);if(Date.now()+wait>=limit)stop('Bumbler model server stayed busy until the time limit');process.stderr.write(`Bumbler model server is busy; asking again in ${Math.ceil(wait/1000)} s\n`);setTimeout(send,wait);return;}
 const reply=[];let bytes=0;response.on('data',chunk=>{bytes+=chunk.length;if(bytes>MAX_REPLY_BYTES)stop('Bumbler reply was too large');reply.push(chunk);});response.on('error',()=>stop('Bumbler connection failed during the reply'));
 response.on('end',()=>{
  if(response.statusCode<200||response.statusCode>=300)stop(`Bumbler model server answered HTTP ${response.statusCode}`);
  let choice;try{choice=JSON.parse(Buffer.concat(reply).toString('utf8')).choices?.[0];}catch{stop('Bumbler reply was not JSON');}
  if(typeof choice?.message?.content!=='string')stop('Bumbler reply had no message content');
  if(choice.finish_reason==='length')stop('Bumbler reply was cut off at the token limit');
  process.stdout.write(choice.message.content);
 });
});
request.on('error',()=>stop('Bumbler model server did not answer'));request.end(body);};
send();
