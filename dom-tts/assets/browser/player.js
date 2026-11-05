(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.DomBrowserSpeech=factory();})(typeof window==='object'?window:null,function(){
 'use strict';
 const codes=new Set(['audio-busy','audio-hardware','network','synthesis-unavailable','synthesis-failed','language-unavailable','voice-unavailable','text-too-long','invalid-argument','not-allowed','interrupted','canceled']);
 // A finite utterance budget: 45s startup allowance plus a conservative eight
 // characters/second at rate 1. Text and rate remain independently bounded.
 const speechDeadline=(text,rate=0.5)=>Math.min(300000,45000+Math.ceil(text.length*125/rate));
 function create({synth,Utterance,onState=()=>{},deadlineMs}={}){
  if(deadlineMs!==undefined&&(!Number.isFinite(deadlineMs)||deadlineMs<=0||deadlineMs>300000))throw Error('invalid-deadline');
  let active=null;
  const emit=value=>{try{onState(value);}catch{}};
  const voices=()=>synth&&typeof synth.getVoices==='function'?synth.getVoices().filter(v=>v.localService===true):[];
  function stop(){if(!active)return {state:'idle'};const current=active;current.finish({state:'cancelled',code:'owned-stop'});try{synth.cancel();}catch{}return {state:'cancelled',code:'owned-stop'};}
  function speak(text,voiceURI,rate=0.9){
   if(!synth||typeof Utterance!=='function')return Promise.reject(Error('browser-speech-unavailable'));
   if(typeof text!=='string'||!text.trim()||text.length>1000||!Number.isFinite(rate)||rate<0.5||rate>2)return Promise.reject(Error('invalid-input'));
   if(active||synth.speaking||synth.pending)return Promise.reject(Error('speech-busy'));
   const voice=voices().find(v=>v.voiceURI===voiceURI);if(!voice)return Promise.reject(Error('local-voice-required'));
   return new Promise(resolve=>{
    const utterance=new Utterance(text);utterance.voice=voice;utterance.lang=voice.lang;utterance.rate=rate;utterance.pitch=1;utterance.volume=1;
    const began=Date.now();let started=false,timer;
    const current={utterance,finish(value){if(active!==current)return;clearTimeout(timer);active=null;utterance.onstart=utterance.onend=utterance.onerror=null;const receipt={...value,startObserved:started,elapsedMs:Date.now()-began,localService:true,humanHearing:'unconfirmed'};emit(receipt);resolve(receipt);}};
    active=current;
    const budget=deadlineMs??speechDeadline(text,rate);
    const timeout=()=>{if(active!==current)return;current.finish({state:'failed',code:'speech-timeout'});try{synth.cancel();}catch{}};
    utterance.onstart=()=>{if(active!==current||started)return;started=true;clearTimeout(timer);timer=setTimeout(timeout,Math.max(0,budget-(Date.now()-began)));emit({state:'speaking',localService:true,voice:voice.name,rate});};
    utterance.onend=()=>current.finish({state:'completed'});
    utterance.onerror=event=>current.finish({state:'failed',code:codes.has(event.error)?event.error:'speech-error'});
    timer=setTimeout(timeout,Math.min(45000,budget));
    emit({state:'queued',localService:true,voice:voice.name,rate});
    if(active!==current)return;
    try{synth.speak(utterance);}catch{current.finish({state:'failed',code:'speech-launch-failed'});}
   });
  }
  return {voices,speak,stop,busy:()=>!!active};
 }
 return {create,speechDeadline};
});
