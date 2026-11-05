// Prove the descriptor's server on one exact TCP connection before sending secrets.
const http=require('node:http'),crypto=require('node:crypto');
const PROOF_SCHEMA='dom-tts-server-proof/2',PROOF_ROUTE='/api/server-proof';
function identityFailure(){return Object.assign(Error('browser-server-identity-unverified'),{code:'BROWSER_IDENTITY'});}
function parseIntentTick(value){if(typeof value!=='string'||!/^[1-9]\d{0,19}$/.test(value))throw identityFailure();return BigInt(value);}
function validateIntentTick(value,now=process.hrtime.bigint()){const tick=parseIntentTick(value);if(typeof now!=='bigint'||tick>now||now-tick>10000000000n)throw identityFailure();return tick;}
function proofMac(token,nonce,port,intentTick){
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||typeof nonce!=='string'||!/^[a-f0-9]{64}$/.test(nonce)||!Number.isSafeInteger(port)||port<1||port>65535)throw identityFailure();parseIntentTick(intentTick);
 return crypto.createHmac('sha256',Buffer.from(token,'hex')).update(PROOF_SCHEMA+'\0'+port+'\0'+nonce+'\0'+intentTick).digest('hex');
}
function verifyProof(value,token,nonce,port,intentTick){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==5||value.schema!==PROOF_SCHEMA||value.nonce!==nonce||value.port!==port||value.intentTick!==intentTick||typeof value.mac!=='string'||!/^[a-f0-9]{64}$/.test(value.mac))throw identityFailure();
 if(!crypto.timingSafeEqual(Buffer.from(value.mac,'hex'),Buffer.from(proofMac(token,nonce,port,intentTick),'hex')))throw identityFailure();
}
async function request(connection,route,data){
 const intentTick=process.hrtime.bigint().toString();
 if(!connection||typeof route!=='string'||!route.startsWith('/api/')||route.length>256||/[\x00-\x20\x7f]/.test(route)||route===PROOF_ROUTE)throw identityFailure();
 const nonce=crypto.randomBytes(32).toString('hex');proofMac(connection.token,nonce,connection.port,intentTick);
 const agent=new http.Agent({keepAlive:true,maxSockets:1,maxFreeSockets:1}),create=agent.createConnection.bind(agent),deadline=Date.now()+3000;let socket;
 // Even if the server closes its keepalive socket, the secret request cannot reconnect.
 agent.createConnection=(options,callback)=>{if(socket){queueMicrotask(()=>callback(identityFailure()));return;}socket=create(options,callback);return socket;};
 function send(path,data,authenticated){return new Promise((resolve,reject)=>{
  const text=data===undefined?null:JSON.stringify(data);let timer,settled=false;
  const fail=error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error);};
  const req=http.request({hostname:'127.0.0.1',port:connection.port,path,agent,method:text?'POST':'GET',headers:{...(authenticated?{'x-dom-tts-token':connection.token}:{}),...(text?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(text)}:{})}},res=>{
   if(res.socket!==socket){res.destroy();return fail(identityFailure());}
   let chunks=[],bytes=0;
   res.on('data',chunk=>{if(settled)return;bytes+=chunk.length;if(bytes>8192){chunks=[];fail(identityFailure());res.destroy();}else chunks.push(chunk);});
   res.on('error',()=>fail(Error('browser-transport-unreachable')));res.on('aborted',()=>fail(Error('browser-transport-unreachable')));
   res.on('end',()=>{if(settled)return;try{const body=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes));chunks=[];const value=JSON.parse(body);if(res.statusCode<200||res.statusCode>=300)throw Error(authenticated&&typeof value.error==='string'?value.error:'browser-server-identity-unverified');settled=true;clearTimeout(timer);resolve(value);}catch(error){fail(error);}});
  });
  req.on('socket',actual=>{if(actual!==socket)req.destroy(identityFailure());});
  req.on('error',error=>fail(error.code==='BROWSER_IDENTITY'?identityFailure():Error(['EACCES','EPERM'].includes(error.code)?'browser-loopback-denied':error.code==='ETIMEDOUT'?'browser-transport-timeout':'browser-transport-unreachable')));
  timer=setTimeout(()=>req.destroy(Object.assign(Error('timeout'),{code:'ETIMEDOUT'})),Math.max(1,deadline-Date.now()));
  if(text)req.write(text);req.end();
 });}
 try{
  let proof;try{proof=await send(PROOF_ROUTE,{nonce,intentTick},false);}catch(error){if(['browser-loopback-denied','browser-transport-timeout','browser-transport-unreachable'].includes(error.message))throw error;throw identityFailure();}
  verifyProof(proof,connection.token,nonce,connection.port,intentTick);if(!socket||socket.destroyed)throw identityFailure();
  return await send(route,data,true);
 }finally{agent.destroy();}
}
module.exports={request,proofMac,verifyProof,parseIntentTick,validateIntentTick,PROOF_SCHEMA,PROOF_ROUTE};
