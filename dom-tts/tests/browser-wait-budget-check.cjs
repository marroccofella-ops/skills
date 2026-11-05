const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const {waitBudget}=require('../scripts/browser-speak');
const {speechDeadline}=require('../assets/browser/player');
assert.equal(waitBudget('x'.repeat(1000)),300000);assert(waitBudget('word '.repeat(200),true,3)>125000);assert(Number.isFinite(waitBudget('x'.repeat(1000),true,Infinity)));assert(waitBudget('x'.repeat(1000),true,999999)<20000000);
const filename=path.resolve(__dirname,'../scripts/browser-speak.js'),realRequire=createRequire(filename);
async function fixture({queued=false,waiting=true,completeAfter=4,step=60000,interrupt=false,unavailable=false}={}){
 let clock=0,polls=0;const routes=[],output=[],listeners=new Map();const id='d'.repeat(32);
 const proc={argv:['node',filename,'--text','fixture','--wait',String(waiting),...(queued?['--enqueue','true']:[])],pid:123,on:(event,fn)=>listeners.set(event,fn),off:event=>listeners.delete(event)};
 const transport={async request(conn,route,body){routes.push({route,body});if(unavailable&&route.includes('/receipt'))throw Error('browser-transport-unreachable');if(route==='/api/queue/status')return {queue:{queued:3,playing:1,cancelling:0}};if(route.includes('/receipt')){polls++;return {id,state:polls>=completeAfter?'completed':'speaking'};}return {id,state:'queued'};}};
 const fakeFs={lstatSync:()=>({isFile:()=>true,isSymbolicLink:()=>false,size:200}),readFileSync:()=>JSON.stringify({schema:'dom-tts-browser/1',pid:123,port:12345,token:'a'.repeat(64)})};
 const runtime={...realRequire('./runtime'),stateDir:'synthetic-state',ensurePrivate(){},alive:()=>true};
 const injected=id=>id==='./experimental/browser-client'?transport:id==='node:fs'?fakeFs:id==='./runtime'?runtime:id==='./speak'?{prepare:()=>({chunks:['x'.repeat(1000)]})}:realRequire(id);
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require:injected,process:proc,console:{log:text=>output.push(JSON.parse(text))},Buffer,TextDecoder,Date:{now:()=>clock},setTimeout:fn=>{clock+=step;if(interrupt){listeners.get('SIGINT')?.();interrupt=false;}queueMicrotask(fn);}},{filename});
 await module.exports.main();await new Promise(r=>setImmediate(r));assert.equal(listeners.size,0);return {clock,routes,output,exitCode:proc.exitCode,polls};
}
(async()=>{
 const direct=await fixture();assert.equal(direct.clock,180000);assert.equal(direct.output[0].state,'completed');assert(!direct.routes.some(r=>r.route.includes('stop')));
 const queued=await fixture({queued:true});assert.equal(queued.clock,180000);assert.equal(queued.output[0].state,'completed');
 const timed=await fixture({queued:true,completeAfter:999,step:20000000});assert.equal(timed.output[0].state,'receipt-timeout');assert.equal(timed.output[0].terminal,false);assert.equal(timed.output[0].id,'d'.repeat(32));assert.equal(timed.exitCode,1);assert(!timed.routes.some(r=>r.route.includes('stop')||r.route.includes('cancel')));
 const cancelled=await fixture({queued:true,interrupt:true});const own=cancelled.routes.find(r=>r.route==='/api/queue/cancel-reply');assert(own);assert.equal(own.body.messageId,'d'.repeat(32));assert.equal(own.body.sessionId,'manual');assert(!cancelled.routes.some(r=>r.route==='/api/queue/stop'));
 const admitted=await fixture({queued:true,waiting:false});assert.equal(admitted.polls,0);assert.equal(admitted.output[0].state,'queued');assert(!admitted.routes.some(r=>r.route==='/api/queue/status'));
 const missing=await fixture({queued:true,unavailable:true});assert.equal(missing.output[0].state,'receipt-unavailable');assert.equal(missing.output[0].terminal,false);assert.equal(missing.output[0].id,'d'.repeat(32));assert.equal(missing.exitCode,1);assert.equal(missing.routes.filter(r=>r.route==='/api/queue/enqueue').length,1);
 console.log('PASS: explicit CLI waits allow >125s queued/>50s direct jobs, derive finite text/backlog bounds, retain IDs on unavailable/timeout, cancel only owned replies on interrupt and leave default admission immediate. Injected verified-transport/clock; no audio or private state.');
})().catch(error=>{console.error(error);process.exitCode=1;});
