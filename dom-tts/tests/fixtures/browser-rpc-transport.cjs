// Actual browser WebCrypto asset + Node AES-GCM around an injected app dispatcher.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const {createBrowserRpc,assertControlEpoch,ROUTE}=require('../../scripts/experimental/browser-rpc');
const source=fs.readFileSync(path.join(__dirname,'../../assets/browser/rpc.js'),'utf8'),tasks=new Set();
function track(promise){tasks.add(promise);promise.then(()=>tasks.delete(promise),()=>tasks.delete(promise));return promise;}
async function flush(){for(let i=0;i<12;i++){await Promise.allSettled([...tasks]);await Promise.resolve();}}
function attach(context,dispatch,{port=42002,token='a'.repeat(64),getEpoch}={}){
 const transport=createBrowserRpc({token,port:()=>port});let localEpoch=0;const currentEpoch=getEpoch||(()=>localEpoch);
 Object.assign(context,{TextEncoder,TextDecoder,Uint8Array,btoa,atob,AbortSignal,crypto:{getRandomValues:array=>webcrypto.getRandomValues(array),subtle:Object.fromEntries(['importKey','encrypt','decrypt'].map(method=>[method,(...args)=>track(webcrypto.subtle[method](...args))]))}});
 context.location.port=String(port);context.sessionStorage.removeItem||=()=>{};
 context.fetch=async(route,options)=>{
  if(route!==ROUTE||options.headers['x-dom-tts-token']!==undefined)throw Error('Fixture forbids plaintext browser transport');
  const opened=transport.open(JSON.parse(options.body));let result,data;
  try{assertControlEpoch(opened.route,opened.epoch,currentEpoch());}catch(error){return new Response(JSON.stringify(transport.seal(opened.nonce,400,{error:error.message},currentEpoch())),{status:200,headers:{'content-type':'application/json'}});}
  result=await dispatch(opened.route,{method:opened.method,body:opened.data===undefined?undefined:JSON.stringify(opened.data)});data=await result.json();if(!getEpoch&&result.ok&&['/api/stop','/api/queue/stop','/api/disable'].includes(opened.route))localEpoch++;
  return new Response(JSON.stringify(transport.seal(opened.nonce,result.ok?200:401,data,currentEpoch())),{status:200,headers:{'content-type':'application/json'}});
 };
 vm.createContext(context);vm.runInContext(source,context,{filename:'actual-browser-rpc.js'});return {epoch:currentEpoch,advance:()=>localEpoch++};
}
module.exports={attach,flush};
