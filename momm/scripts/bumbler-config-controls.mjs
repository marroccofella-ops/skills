import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {loadBumblers} from './bumbler-route.mjs';
import {privateTestFixture} from './private-test-fixture.mjs';

export function bumblerConfigControls(load=loadBumblers){
 const parent=fs.realpathSync.native(privateTestFixture('momm-config-controls-'));
 const home=path.join(parent,'reviewers'),file=path.join(home,'bumblers.json');
 const saved=JSON.stringify({bab:{base_url:'http://127.0.0.1:9/v1',model:'synthetic'}});
 const write=()=>fs.writeFileSync(file,saved,{mode:0o600});
 const run=()=>load({MOMM_REVIEWER_HOME:home});let checks=0;
 const check=(name,fn)=>{fn();checks++;};
 const refused=fn=>assert.throws(fn,{code:'BUMBLER_SETTINGS_REFUSED'});
 try{
  fs.mkdirSync(home,{mode:0o700});
  check('private missing file',()=>assert.equal(Object.keys(run()).length,0));
  write();check('private file',()=>assert.equal(run().bab.model,'synthetic'));
  check('hard link',()=>{const alias=path.join(home,'alias.json');fs.linkSync(file,alias);try{refused(run);}finally{fs.unlinkSync(alias);}});
  check('nonregular file',()=>{fs.unlinkSync(file);fs.mkdirSync(file,{mode:0o700});try{refused(run);}finally{fs.rmdirSync(file);write();}});
  check('oversized file',()=>{fs.writeFileSync(file,Buffer.alloc(1_000_001,32));try{refused(run);}finally{write();}});
  check('linked root',()=>{const link=path.join(parent,'linked');fs.symlinkSync(home,link,process.platform==='win32'?'junction':'dir');try{refused(()=>load({MOMM_REVIEWER_HOME:link}));}finally{fs.unlinkSync(link);}});
  check('linked ancestor',()=>{const child=path.join(home,'child'),link=path.join(parent,'ancestor');fs.mkdirSync(child,{mode:0o700});fs.symlinkSync(home,link,process.platform==='win32'?'junction':'dir');try{refused(()=>load({MOMM_REVIEWER_HOME:path.join(link,'child')}));}finally{fs.unlinkSync(link);fs.rmdirSync(child);}});
  check('missing root',()=>assert.equal(Object.keys(load({MOMM_REVIEWER_HOME:path.join(parent,'absent')})).length,0));
  check('relative root',()=>refused(()=>load({MOMM_REVIEWER_HOME:'relative'})));
  check('project root',()=>refused(()=>load({MOMM_REVIEWER_HOME:process.cwd()})));
  check('malformed file',()=>{fs.writeFileSync(file,'{');try{assert.throws(run,/not valid JSON/);}finally{write();}});
  check('inspection error',()=>{const lstat=fs.lstatSync;fs.lstatSync=(target,...args)=>{if(target===file)throw Object.assign(Error('PRIVATE_MARKER'),{code:'EACCES'});return lstat(target,...args);};try{assert.throws(run,error=>error.code==='BUMBLER_SETTINGS_REFUSED'&&!error.message.includes('PRIVATE_MARKER'));}finally{fs.lstatSync=lstat;}});
  check('opened identity change',()=>{
   const other=path.join(home,'other.json');fs.writeFileSync(other,saved,{mode:0o600});const open=fs.openSync,read=fs.readSync;let reads=0;
   fs.openSync=(target,...args)=>open(target===file?other:target,...args);fs.readSync=(...args)=>{reads++;return read(...args);};
   try{refused(run);assert.equal(reads,0);}finally{fs.openSync=open;fs.readSync=read;fs.unlinkSync(other);}
  });
  check('change during read',()=>{const read=fs.readSync;let changed=false;fs.readSync=(...args)=>{const n=read(...args);if(!changed&&n){changed=true;fs.appendFileSync(file,' ');}return n;};try{refused(run);assert(changed);}finally{fs.readSync=read;write();}});
  check('privacy refusal before content access',()=>{
   const source=fs.readFileSync(new URL('./bumbler-route.mjs',import.meta.url),'utf8');
   const start=source.indexOf('const MAX_CONFIG_BYTES='),end=source.indexOf('function tailnetAddress',start);assert(start>=0&&end>start);
   let reads=0;const context={path,process,Buffer,fs:{...fs,readSync(...args){reads++;return fs.readSync(...args);}},defaultRegistryHome:()=>home,requirePrivateEvidence(){throw Error('PRIVATE_MARKER');}};
   vm.createContext(context);new vm.Script(source.slice(start,end)+'\nglobalThis.read=readBumblers;').runInContext(context);
   assert.throws(()=>context.read({}),error=>error.code==='BUMBLER_SETTINGS_REFUSED'&&!error.message.includes('PRIVATE_MARKER'));assert.equal(reads,0);
  });
  return {passed:true,checks,scope:'synthetic configuration-only filesystem controls; no preflight or dispatch invoked'};
 }finally{assert(path.resolve(parent).startsWith(fs.realpathSync.native(os.tmpdir())+path.sep+'momm-config-controls-'));fs.rmSync(parent,{recursive:true,force:true});}
}
