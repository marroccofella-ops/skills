const {connection,request}=require('../browser-speak');
const {speechDeadline}=require('../../assets/browser/player');
// One explicitly supplied segment; no cloud/native fallback or speech replay.
function createBrowserPlayer({connect=connection,send=request,timeoutMs}={}){
 if(timeoutMs!==undefined&&(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>305000))throw Error('invalid-timeout');
 return async(text,{signal}={})=>{
  if(signal?.aborted)throw Error('cancelled');const conn=connect();const job=await send(conn,'/api/speak',{text});let cancelPromise;
  const stop=()=>{cancelPromise=send(conn,'/api/stop-owned',{id:job.id}).catch(()=>{});};signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
  try{const until=Date.now()+(timeoutMs??speechDeadline(text,0.5)+5000);while(Date.now()<until){const result=await send(conn,'/api/receipt/'+job.id);if(result.state==='failed')throw Error('browser-playback-failed');if(result.state==='completed')return result;if(result.state==='cancelled')return {state:signal?.aborted?'cancelled':'stopped'};await new Promise(r=>setTimeout(r,100));}stop();throw Error('browser-receipt-timeout');}finally{signal?.removeEventListener('abort',stop);if(cancelPromise)await cancelPromise;}
 };
}
module.exports={createBrowserPlayer};
