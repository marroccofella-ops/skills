import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ReviewerRegistry,REGISTRY_SCHEMA} from './reviewer-registry.mjs';

export function archiveRecoveryControls(parent){
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  for(const kind of ['short','zero','invalid','corrupt','budget']){
    const root=path.join(parent,'archive-'+kind);fs.mkdirSync(root);
    const events=Array.from({length:501},(_,n)=>({id:'e'+n,at:'2026-11-01T00:00:00Z',action:'synthetic',profile_id:'p'}));
    const bytes=Buffer.from(JSON.stringify({schema:'momm-reviewer-settings-events/1',events:events.slice(0,500)})+'\n');
    const file=path.join(root,'events-'+hash(bytes)+'.json');
    fs.writeFileSync(file,bytes.subarray(0,100));
    const state={schema:REGISTRY_SCHEMA,revision:0,profiles:[],connectors:[],events,event_archives:[],reservations:[],baseline_excluded:[]};
    if(kind==='budget'){
      const filler=fs.openSync(path.join(root,'events-'+'0'.repeat(64)+'.json'),'wx');
      try{fs.ftruncateSync(filler,100_000_000-200);}finally{fs.closeSync(filler);}
    }
    const write=fs.writeSync;let calls=0;
    fs.writeSync=(fd,buffer,offset,length,position)=>{
      calls++;
      if(kind==='zero')return 0;
      if(kind==='invalid')return length+1;
      if(kind==='corrupt')return write(fd,Buffer.alloc(length),0,length,position);
      return write(fd,buffer,offset,calls===1?1:length,position);
    };
    try{
      const run=()=>ReviewerRegistry.prototype.archiveEvents.call({root},state);
      if(kind==='short'){
        run();assert.equal(calls,2,'a short write must resume');assert.deepEqual(fs.readFileSync(file),bytes);
        assert.equal(state.event_archives[0].sha256,hash(bytes));assert.equal(state.events.length,1);
      }else{
        assert.throws(run,{code:kind==='budget'?'storage_budget':'invalid_store'},kind+' must fail before acknowledging an archive');
        assert.equal(state.event_archives.length,0);
        if(kind==='budget'){assert.equal(calls,0);assert.equal(fs.statSync(file).size,100);}
      }
    }finally{fs.writeSync=write;}
  }
}
