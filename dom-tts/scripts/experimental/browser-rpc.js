// Encrypted UI commands: never send the browser's bearer token or text to a stale port.
const crypto=require('node:crypto');
const SCHEMA='dom-tts-browser-rpc/2',ROUTE='/api/browser-rpc',TTL_MS=10000,MAX_DATA=32768,MAX_PLAIN=33280,MAX_RESPONSE=8192;
const refused=()=>Error('browser-rpc-refused');
const fencedRoutes=new Set(['/api/enable','/api/speak','/api/queue/restart','/api/queue/enqueue','/api/queue/event','/api/queue/flush','/api/queue/seal','/api/queue/select-source','/api/queue/pause','/api/queue/resume','/api/queue/skip']);
function requiresControlEpoch(route){return fencedRoutes.has(route);}
function assertControlEpoch(route,epoch,current){if(requiresControlEpoch(route)&&(!Number.isSafeInteger(epoch)||epoch!==current))throw Error('browser-control-epoch-stale');}
function aad(port,direction,requestNonce=''){return Buffer.from(SCHEMA+'\0'+port+'\0'+direction+(direction==='response'?'\0'+requestNonce:''),'utf8');}
function base64(value,min,max){if(typeof value!=='string'||value.length>Math.ceil(max/3)*4||value.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw refused();const bytes=Buffer.from(value,'base64');if(bytes.length<min||bytes.length>max||bytes.toString('base64')!==value)throw refused();return bytes;}
function envelope(value,max){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='ciphertext,nonce,schema'||value.schema!==SCHEMA)throw refused();return {nonce:base64(value.nonce,12,12),ciphertext:base64(value.ciphertext,16,max+16)};}
function createBrowserRpc({token,port,now=()=>Date.now(),maxNonces=256}){
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||typeof port!=='function'||typeof now!=='function'||!Number.isSafeInteger(maxNonces)||maxNonces<1||maxNonces>256)throw refused();
 const key=Buffer.from(token,'hex'),seen=new Map();let latestTime=0;
 const boundPort=()=>{const value=port();if(!Number.isSafeInteger(value)||value<1||value>65535)throw refused();return value;};
 function open(value){
  const bytes=envelope(value,MAX_PLAIN),decipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.nonce);decipher.setAAD(aad(boundPort(),'request'));decipher.setAuthTag(bytes.ciphertext.subarray(-16));let plain;
  try{plain=Buffer.concat([decipher.update(bytes.ciphertext.subarray(0,-16)),decipher.final()]);}catch{throw refused();}
  if(plain.length>MAX_PLAIN)throw refused();let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));}catch{throw refused();}
  if(!data||typeof data!=='object'||Array.isArray(data)||!['GET','POST'].includes(data.method)||Object.keys(data).sort().join(',')!==(data.method==='GET'?'epoch,method,route,timestamp':'data,epoch,method,route,timestamp')||typeof data.route!=='string'||!/^\/api\/[a-z0-9/-]{1,160}$/.test(data.route)||[ROUTE,'/api/server-proof'].includes(data.route)||!Number.isSafeInteger(data.timestamp)||!Number.isSafeInteger(data.epoch)||data.epoch<0)throw refused();
  if(data.method==='POST'&&(!data.data||typeof data.data!=='object'||Array.isArray(data.data)||Buffer.byteLength(JSON.stringify(data.data))>MAX_DATA))throw refused();
  const at=now();if(!Number.isSafeInteger(at)||at<latestTime||data.timestamp>at+1000||at-data.timestamp>TTL_MS)throw refused();latestTime=at;
  for(const [nonce,expires]of seen)if(expires<at)seen.delete(nonce);
  if(seen.has(value.nonce)||seen.size>=maxNonces)throw refused();seen.set(value.nonce,data.timestamp+TTL_MS);
  return {route:data.route,method:data.method,data:data.data,nonce:value.nonce,epoch:data.epoch};
 }
 function seal(requestNonce,status,data,epoch=0){
  base64(requestNonce,12,12);if(!Number.isSafeInteger(status)||status<200||status>599||!Number.isSafeInteger(epoch)||epoch<0)throw refused();const plain=Buffer.from(JSON.stringify({status,data,epoch}));if(plain.length>MAX_RESPONSE)throw refused();
  const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(aad(boundPort(),'response',requestNonce));const ciphertext=Buffer.concat([cipher.update(plain),cipher.final(),cipher.getAuthTag()]);return {schema:SCHEMA,nonce:nonce.toString('base64'),ciphertext:ciphertext.toString('base64')};
 }
 return {open,seal};
}
module.exports={createBrowserRpc,requiresControlEpoch,assertControlEpoch,aad,SCHEMA,ROUTE,TTL_MS,MAX_DATA,MAX_PLAIN,MAX_RESPONSE};
