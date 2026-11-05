const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {createSession}=require('../scripts/experimental/browser-session');
const {splitGraphemes}=require('../scripts/experimental/delta-narrator');
const {speechDeadline}=require('../assets/browser/player');
const {request}=require('../scripts/browser-speak');
const wait=()=>new Promise(r=>setTimeout(r,65));
function load(relative,extra){const filename=path.resolve(__dirname,relative),module={exports:{}};vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require:createRequire(filename),Buffer,console,setTimeout,clearTimeout,setInterval,clearInterval,...extra},{filename});return module.exports;}
(async()=>{
 const paragraph=('Earlier context. '.repeat(30).slice(0,411)+' future readers deserve intact words and sentences. Extra text.');
 const parts=splitGraphemes(paragraph,420);assert.equal(parts.join(''),paragraph);assert(parts.every(p=>Buffer.byteLength(p)<=420));assert(!parts.some((p,i)=>i&&/\w$/.test(parts[i-1])&&/^\w/.test(p)));
 const unicode=('漢字 e\u0301 👨‍👩‍👧‍👦 🧠 ').repeat(30),unicodeParts=splitGraphemes(unicode,80);assert.equal(unicodeParts.join(''),unicode);assert(unicodeParts.every(p=>Buffer.byteLength(p)<=80));
 const token='é'.repeat(1000),tokenParts=splitGraphemes(token,420);assert.equal(tokenParts.join(''),token);assert(tokenParts.every(p=>Buffer.byteLength(p)<=420));assert.throws(()=>splitGraphemes('e'+'\u0301'.repeat(300),420),/grapheme/);
 assert.equal(speechDeadline('x'.repeat(1000),0.5),295000);
 // Fake browser speech timers: a slow utterance remains active after 46s,
 // times out at its finite budget, and Stop still owns cancellation.
 let clock=0,next=0,utterance,cancels=0;const timers=new Map();
 const fakeSet=(fn,ms)=>{const id=++next;timers.set(id,{fn,at:clock+ms});return id;};
 const advance=ms=>{clock+=ms;for(const[id,t]of [...timers])if(t.at<=clock){timers.delete(id);t.fn();}};
 const {create}=load('../assets/browser/player.js',{Date:{now:()=>clock},setTimeout:fakeSet,clearTimeout:id=>timers.delete(id)});
 const voice={voiceURI:'local',localService:true};const player=create({synth:{getVoices:()=>[voice],speak:u=>{utterance=u;u.onstart();},cancel:()=>cancels++},Utterance:function(text){this.text=text;}});
 const long=player.speak('x'.repeat(1000),'local',0.5);advance(46000);assert(player.busy());assert.equal(cancels,0);advance(200000);assert(player.busy());utterance.onend();assert.equal((await long).state,'completed');
 const stuck=player.speak('x'.repeat(1000),'local',0.5);advance(295001);assert.equal((await stuck).code,'speech-timeout');assert.equal(cancels,1);
 const stop=player.speak('x'.repeat(1000),'local',0.5);player.stop();assert.equal((await stop).state,'cancelled');assert.equal(cancels,2);
 const neverStarts=create({synth:{getVoices:()=>[voice],speak(){},cancel:()=>cancels++},Utterance:function(){}});const stalled=neverStarts.speak('x'.repeat(1000),'local',0.5);advance(45001);assert.equal((await stalled).code,'speech-timeout');
 let launched=0,queuedStop;queuedStop=create({synth:{getVoices:()=>[voice],speak:()=>launched++,cancel(){}},Utterance:function(){},onState:state=>{if(state.state==='queued')queuedStop.stop();}});assert.equal((await queuedStop.speak('Stop before launch.','local')).state,'cancelled');assert.equal(launched,0);
 // Real session, injected clock and authenticated receipt events, no audio.
 clock=0;const client='a'.repeat(32),s=createSession({now:()=>clock});
 try{s.enable({client,voice:'local',rate:0.5});const job=s.submit({text:'x'.repeat(1000)});s.accept({client,id:job.id,state:'speaking'});
  for(clock=10000;clock<=250000;clock+=10000){s.poll({client});assert.equal(s.receipt(job.id).state,'speaking');}
  s.accept({client,id:job.id,state:'completed',startObserved:true,elapsedMs:250000,localService:true});assert.equal(s.receipt(job.id).state,'completed');assert.equal(s.accept({client,id:job.id,state:'completed'}).duplicate,true);
  const timeout=s.submit({text:'x'.repeat(1000)});s.accept({client,id:timeout.id,state:'speaking'});for(let i=0;i<30;i++){clock+=10000;s.poll({client});}assert.equal(s.receipt(timeout.id).code,'speech-timeout');assert.equal(s.poll({client}).text,null);s.accept({client,id:timeout.id,state:'cancelled',startObserved:true,elapsedMs:300000,localService:true});
  const startup=s.submit({text:'x'.repeat(1000)});for(let i=0;i<5;i++){clock+=10000;s.poll({client});}assert.equal(s.receipt(startup.id).code,'speech-timeout');s.accept({client,id:startup.id,state:'cancelled',startObserved:false,elapsedMs:50000,localService:true});
  const disconnected=s.submit({text:'private disconnect'});s.accept({client,id:disconnected.id,state:'speaking'});clock+=30001;assert.equal(s.receipt(disconnected.id).code,'browser-disconnected');assert.equal(s.poll({client}).text,null);s.accept({client,id:disconnected.id,state:'cancelled',startObserved:true,elapsedMs:30001,localService:true});s.poll({client});
  // Max-length Unicode enqueue fits the bounded HTTP envelope; over-limit
  // requests still fail without retaining their text.
  await new Promise(r=>s.server.listen(0,'127.0.0.1',r));const conn={port:s.server.address().port,token:s.token};s.queue.command('pause');
  const cjk=await request(conn,'/api/queue/enqueue',{text:'漢'.repeat(6000)});assert.equal(cjk.state,'queued');
  await assert.rejects(request(conn,'/api/queue/enqueue',{text:'漢'.repeat(12000)}),/invalid-json/);
 }finally{s.close();await s.queue.settled();if(s.server.listening)await new Promise(r=>s.server.close(r));}
 // Fake queue maintenance clock: multiple segments carry a reply well past
 // 120s; pause, lost browser, abandoned input and a nonsettling transport expire.
 clock=0;let maintain;const {createBrowserQueue}=load('../scripts/experimental/browser-queue.js',{setInterval:fn=>{maintain=fn;return {unref(){}};},clearInterval(){}});
 let connected=true,receipt={state:'speaking'},submitted=[],stops=0;
 const q=createBrowserQueue({now:()=>clock,transport:{status:()=>({connected}),submit:({text})=>{submitted.push(text);receipt={state:'speaking'};return {id:'b'.repeat(32)};},receipt:()=>receipt,stopOwned:()=>{stops++;receipt.state='cancelled';}}});
 try{
  const text=('A long but readable supplied paragraph for future readers. ').repeat(30),job=q.command('enqueue',{text});await wait();
  while(!q.command('receipt',{id:job.id}).terminal){for(let i=0;i<4;i++){clock+=30000;maintain();assert.equal(stops,0);}receipt.state='completed';await wait();}
  assert(clock>120000);assert.equal(submitted.join(''),text.trim());assert.equal(q.command('receipt',{id:job.id}).state,'completed');assert.equal(q.status().queue.bytes,0);
  const activePause=q.command('enqueue',{text:'word '.repeat(80)});await wait();q.command('pause');for(let i=0;i<5;i++){clock+=25000;maintain();}assert.equal(q.command('receipt',{id:activePause.id}).state,'speaking');assert.equal(stops,0);receipt.state='completed';await wait();q.command('resume');
  q.command('pause');const paused=q.command('enqueue',{text:'Paused private words.'});clock+=120001;maintain();assert.equal(q.command('receipt',{id:paused.id}).state,'cancelled');assert.equal(q.status().queue.bytes,0);q.command('resume');
  const lost=q.command('enqueue',{text:'Disconnect private words.'});await wait();connected=false;clock+=120001;maintain();await wait();assert.equal(q.command('receipt',{id:lost.id}).state,'cancelled');assert.equal(q.status().queue.bytes,0);connected=true;
  const base={schema:'dom-tts-text/1',role:'assistant',phase:'final_answer',sessionId:'manual',turnId:'idle',generationId:'idle',messageId:'idle',format:'plain'};q.command('event',{...base,kind:'start',sequence:0});q.command('event',{...base,kind:'delta',sequence:1,text:'Unfinished private words'});clock+=120001;maintain();assert.equal(q.command('reply-receipt',base).state,'cancelled');assert.equal(q.status().stream.retainedBytes,0);
  const bounded=q.command('enqueue',{text:'Never ending private speech.'});await wait();clock+=speechDeadline('Never ending private speech.',0.5)+5001;await wait();assert(stops>=2);assert.equal(q.command('receipt',{id:bounded.id}).state,'failed');assert.equal(q.status().queue.bytes,0);
  q.command('skip');q.command('enqueue',{text:'Immediate injected failure.'});await wait();receipt.state='failed';await wait();
  const blocked=q.command('enqueue',{text:'Blocked source must expire.'});q.command('select-source',{sessionId:'other'});q.command('enqueue',{sessionId:'other',text:'Different source has healthy ongoing speech. '.repeat(25)});await wait();
  for(let i=0;i<5;i++){clock+=25000;maintain();}await wait();assert.equal(q.command('receipt',{id:blocked.id}).state,'cancelled');
  q.command('stop');await wait();assert.equal(q.status().queue.bytes,0);assert.equal(q.status().stream.retainedBytes,0);assert.throws(()=>q.command('enqueue',{sessionId:'other',text:'No replay after Stop.'}),/restart-required/);assert.throws(()=>q.command('event',{...base,kind:'start',sequence:0}),/restart-required/);
 }finally{q.close();await q.settled();}
 // The generic direct adapter must also allow a slow job past its old 50s
 // receipt wait. Only injected clock/send are used.
 clock=0;let polls=0;const {createBrowserPlayer}=load('../scripts/experimental/browser-player.js',{Date:{now:()=>clock},setTimeout:fn=>setTimeout(()=>{clock+=60000;fn();},0)});
 const direct=createBrowserPlayer({connect:()=>({}),send:async(_,route)=>route==='/api/speak'?{id:'c'.repeat(32)}:{state:++polls<4?'speaking':'completed'}});assert.equal((await direct('x'.repeat(1000))).state,'completed');assert.equal(clock,180000);
 console.log('PASS: lossless sentence/word UTF-8 segmentation, bounded long tokens, >120s progressing queue, 250s slow direct speech, 45s startup/finite speech timeouts, owned Stop, replay, disconnect/pause/open-stream privacy expiry and bounded Unicode HTTP. Fake clock/player; no audio claim.');
})().catch(e=>{console.error(e);process.exitCode=1;});
