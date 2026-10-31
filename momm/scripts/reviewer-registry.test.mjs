import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {ReviewerRegistry,normalizeEndpoint} from './reviewer-registry.mjs';
import {applyReviewerSettings} from './reviewer-selection.mjs';
import * as selection from './reviewer-selection.mjs';
import {chooseSecondLookRoute} from './second-look.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
function selectionInspectionControls(){
 const source=fs.readFileSync(new URL('./reviewer-selection.mjs',import.meta.url),'utf8'),script=source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')+'\n;globalThis.apply=applyReviewerSettings;',root=path.join(os.tmpdir(),'synthetic-reviewer-settings-not-read');
 for(const code of ['EACCES','EPERM','EIO','ENOTDIR','ENOENT','present','linked','danglingRoot','danglingAncestor','missingRoot']){
  let reads=0;const error=()=>Object.assign(Error('Synthetic settings inspection failure'),{code});
  const missing=()=>Object.assign(Error('Synthetic verified absence'),{code:'ENOENT'}),stat=(link=false)=>({isSymbolicLink:()=>link,isDirectory:()=>!link});
  const context={path,fs:{existsSync:()=>code==='present',lstatSync(file){if(file===path.join(root,'registry.json')){if(['present','linked'].includes(code))return stat(code==='linked');if(['danglingRoot','danglingAncestor','missingRoot'].includes(code))throw missing();throw error();}if(file===root&&['danglingAncestor','missingRoot'].includes(code))throw missing();return stat(code==='danglingRoot'||code==='danglingAncestor');},statSync(){throw missing();}},defaultRegistryHome:()=>root,process:{cwd:()=>process.cwd()},ReviewerRegistry:class{read(){reads++;if(code==='linked')throw Error('linked settings refused');return{baseline_excluded:['copilot'],revision:1};}}};vm.createContext(context);new vm.Script(script).runInContext(context);
  const options={reviewers:['claude','copilot'],governor:'codex',minSuccess:1},before=JSON.stringify(options);
  if(['EACCES','EPERM','EIO','ENOTDIR','danglingRoot','danglingAncestor'].includes(code)){assert.throws(()=>context.apply(options,{root}),/inspect|inspection/i,code+' must not silently discard saved policy');assert.equal(JSON.stringify(options),before);assert.equal(reads,0);}
  else if(code==='linked'){assert.throws(()=>context.apply(options,{root}),/linked/);assert.equal(JSON.stringify(options),before);assert.equal(reads,1);}
  else{const result=context.apply(options,{root});assert.equal(reads,code==='present'?1:0);assert.equal(options.reviewers.join(','),code==='present'?'claude':'claude,copilot');assert.equal(result.applied,code==='present');}
 }
}
if(process.argv[2]==='--selection-inspection'){selectionInspectionControls();console.log(JSON.stringify({passed:true,checks:10,scope:'Actual selection source with synthetic filesystem failures; no real settings, ACL or provider access'}));process.exit(0);}
function selectionExclusionControls(){
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'momm-selection-exclusion-')),root=path.join(temporary,'private'),rows=[];
 const test=(name,fn)=>{try{fn();rows.push({name,passed:true});}catch(error){rows.push({name,passed:false,error:error.message});}};
 try{
  const registry=new ReviewerRegistry({root});registry.command({op:'exclude_cli',route:'copilot',revision:0});
  const source=fs.readFileSync(new URL('./multi-review.mjs',import.meta.url),'utf8'),tierStart=source.indexOf('function applyTier('),tierEnd=source.indexOf('\nfunction usage(',tierStart);assert(tierStart>=0&&tierEnd>tierStart);
  const tier=vm.runInNewContext('('+source.slice(tierStart,tierEnd)+')',{QUICK_POOL:['copilot','antigravity']});
  const guard=selection.assertReviewerSelection??(()=>{});
  test('quick tier cannot restore a saved exclusion',()=>{const options={governor:'codex',reviewers:['codex','claude','copilot','antigravity','grok'],tier:'quick',timeoutMs:180000};const saved=applyReviewerSettings(options,{root});tier(options);assert.throws(()=>guard(options,saved),/excluded/);});
  test('automatic media selection cannot restore a saved exclusion',()=>{
   const options={governor:'codex',reviewers:['claude','copilot','antigravity'],reviewersAuto:true},saved=applyReviewerSettings(options,{root});options.capabilities={matrix:{},autoReviewers:[],routable:()=>true};options.capabilitiesRegistry={};
   const start=source.indexOf('  {\n    if (options.reviewersAuto && attachedModalities.length)'),end=source.indexOf('  // 1.17 B1:',start);assert(start>=0&&end>start);
   const context={options,reviewerSelection:saved,attachedModalities:['image'],selectAutoReviewers:()=>({routes:['copilot','antigravity'],perModality:{image:['copilot','antigravity']}}),assertReviewerSelection:guard};
   assert.throws(()=>vm.runInNewContext(source.slice(start,end),context),/excluded/);
  });
  const report={governor:'codex',gate_policy:{requested_routes:['claude','copilot','antigravity']}},finding={sources:['claude']};
  test('second look default refuses an excluded original route',()=>assert.throws(()=>chooseSecondLookRoute({report,finding,excluded:['copilot']}),/excluded/));
  test('second look explicit selection refuses an excluded route',()=>assert.throws(()=>chooseSecondLookRoute({report,finding,reviewers:['copilot'],excluded:['copilot']}),/excluded/));
  test('permitted routes and caller quorum remain unchanged',()=>{const options={reviewers:['claude','antigravity'],governor:'codex',minSuccess:2},before=JSON.stringify(options);guard(options,{excluded:['copilot'],removed_from_selection:['copilot']});assert.equal(JSON.stringify(options),before);assert.equal(chooseSecondLookRoute({report,finding,reviewers:['antigravity'],excluded:['copilot']}),'antigravity');assert.throws(()=>guard({...options,reviewers:['claude']},{excluded:['copilot'],removed_from_selection:['copilot']}),/quorum/);});
  test('an unrelated exclusion preserves the governor-only structured quorum gate',()=>{const options={reviewers:['codex'],governor:'codex',minSuccess:1},before=JSON.stringify(options);assert.doesNotThrow(()=>guard(options,{excluded:['copilot'],removed_from_selection:[]}));assert.equal(JSON.stringify(options),before);});
  test('actual dispatch and second-look entry points carry the saved policy',()=>{assert(/assertReviewerSelection\(options, reviewerSelection\);\s*const uniqueReviewers/.test(source),'final dispatch guard missing');assert(/secondLookCommand\(options, reviewerSelection\)/.test(source),'second-look policy handoff missing');assert(/excluded: reviewerSelection\.excluded/.test(source),'second-look saved exclusions missing');const look=fs.readFileSync(new URL('./second-look.mjs',import.meta.url),'utf8');assert(/chooseSecondLookRoute\(\{ report, finding, reviewers, governor, excluded \}\)/.test(look),'second-look route guard wiring missing');});
  assert(rows.every(row=>row.passed),JSON.stringify(rows));return rows;
 }finally{assert(path.basename(temporary).startsWith('momm-selection-exclusion-'));fs.rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[2]==='--selection-exclusions'){const rows=selectionExclusionControls();console.log(JSON.stringify({passed:true,checks:rows.length,rows,network_calls:0,scope:'Actual selection functions and source wiring with synthetic saved settings; no provider calls'}));process.exit(0);}
function canonicalEndpointControls(){
 const bare=normalizeEndpoint('https://example.test/v1');
 for(const alias of ['https://example.test./v1','https://EXAMPLE.test.:443/v1/'])assert.deepEqual(normalizeEndpoint(alias),bare);
 assert.deepEqual(normalizeEndpoint('https://example.test.:8443/v1/'),normalizeEndpoint('https://example.test:8443/v1'));
 assert.notEqual(normalizeEndpoint('https://example.test:8443/v1').resource_group,bare.resource_group);
 assert.equal(normalizeEndpoint('https://example.test/api').resource_group,bare.resource_group);
 for(const invalid of ['https://example.test../v1','https://./v1','https://../v1'])assert.throws(()=>normalizeEndpoint(invalid),e=>e.code==='invalid_endpoint');
}
if(process.argv[2]==='--endpoint-canonicalization'){canonicalEndpointControls();console.log(JSON.stringify({passed:true,scope:'Pure URL/resource identity controls only; no DNS, socket, credential or registry access'}));process.exit(0);}
function endpointStructureControls(){
 for(const suffix of ['?','#','?#'])assert.throws(()=>normalizeEndpoint('https://example.test/v1'+suffix),e=>e.code==='invalid_endpoint');
 assert.equal(normalizeEndpoint('https://example.test/v1').base,'https://example.test/v1');
}
function profileShapeControls(){
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'momm-profile-shape-'));
 try{
  const r=new ReviewerRegistry({root:path.join(temporary,'private')});r.command({op:'save',revision:0,profile:{label:'Synthetic'}});const original=fs.readFileSync(r.file);
  for(const change of [{unexpected_field:'synthetic-private-value'},{label:1},{qualification:{unexpected_field:'synthetic-private-value'}},{wording:{}},{kind:'unreviewed'},{quorum_eligible:'yes'},{state:{}},{archived_at:{}},{archived_at:null},{archived_at:-1},{archived_at:'1'},{archived_at:1.5}]){
   const state=JSON.parse(original);Object.assign(state.profiles[0],change);fs.writeFileSync(r.file,JSON.stringify(state));const invalid=fs.readFileSync(r.file);
   try{assert.throws(()=>r.snapshot(),e=>e.code==='invalid_configuration');assert.deepEqual(fs.readFileSync(r.file),invalid,'rejection must preserve original settings bytes');}finally{fs.writeFileSync(r.file,original);}
  }
  assert.equal(r.snapshot().profiles[0].label,'Synthetic');
  const legacy=JSON.parse(original);legacy.profiles[0].auth_mode='api_key';legacy.profiles[0].qualification={synthetic:'private historical metadata'};fs.writeFileSync(r.file,JSON.stringify(legacy));const legacyBytes=fs.readFileSync(r.file);
  assert.deepEqual(r.read().profiles[0].qualification,legacy.profiles[0].qualification,'private inert history remains recoverable');
  assert.equal(r.snapshot().profiles[0].qualification,null,'inert historical qualification is not returned to the UI');assert.deepEqual(fs.readFileSync(r.file),legacyBytes);
 }finally{assert(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep+'momm-profile-shape-'));fs.rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[2]==='--endpoint-structure'){endpointStructureControls();console.log(JSON.stringify({passed:true,scope:'Pure endpoint delimiter controls; no network access'}));process.exit(0);}
if(process.argv[2]==='--profile-shape'){profileShapeControls();console.log(JSON.stringify({passed:true,scope:'Synthetic private registry files only; no real settings or credentials read'}));process.exit(0);}
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'momm-registry-test-'));
const root=path.join(fixture,'private');const registry=new ReviewerRegistry({root});let count=0;
const test=(name,fn)=>{fn();count++;};
const command=value=>registry.command({...value,revision:registry.read().revision});
try {
  test('save and restart preserve a disabled Bab',()=>{command({op:'save',profile:{label:'Bab',kind:'bumbler'}});const p=new ReviewerRegistry({root}).snapshot().profiles[0];assert.equal(p.label,'Bab');assert.equal(p.state,'draft');assert.equal(p.quorum_eligible,false);});
  const bab=registry.read().profiles[0].id;
  test('no arbitrary fields or credential imports',()=>{assert.throws(()=>command({op:'save',profile:{label:'Forged',quorum_eligible:true}}));assert.throws(()=>command({op:'save',profile:{label:'Forged'},connector:{base_url:'https://example.test/v1',secret_ref:'foreign'}}));});
  test('stale revisions never overwrite',()=>{assert.throws(()=>registry.command({op:'archive',id:bab,revision:0}),/another window/);assert.equal(registry.snapshot().profiles[0].state,'draft');});
  test('unknown CLI cannot become arbitrary shell execution',()=>{assert.throws(()=>command({op:'save',profile:{label:'Bad',kind:'cli',route:'custom-command'}}),/reviewed adapter/);});
  test('endpoint DNS aliases share one canonical identity',canonicalEndpointControls);
  test('empty query and fragment delimiters are not API bases',endpointStructureControls);
  test('unrecognized or invalid stored profile fields never reach snapshots',profileShapeControls);
  test('shared normalized connectors have one resource identity',()=>{for(const [label,base_url] of [['One','https://EXAMPLE.test:443/v1/'],['Two','https://example.test./v1']])command({op:'save',profile:{label},connector:{base_url}});const state=registry.read();assert.equal(state.connectors.length,1);assert.equal(state.profiles[1].connector_id,state.profiles[2].connector_id);});
  test('legacy noncanonical endpoint state refuses without rewriting',()=>{const original=fs.readFileSync(registry.file),state=JSON.parse(original);state.connectors[0].base_url='https://example.test./v1';state.connectors[0].resource_group=createHash('sha256').update(new URL(state.connectors[0].base_url).origin).digest('hex');fs.writeFileSync(registry.file,JSON.stringify(state));const legacy=fs.readFileSync(registry.file);try{assert.throws(()=>registry.read(),e=>e.code==='invalid_configuration');assert.deepEqual(fs.readFileSync(registry.file),legacy);}finally{fs.writeFileSync(registry.file,original);}});
  test('unsafe addresses and certificates refused',()=>{for(const url of ['http://example.test/v1','https://localhost/v1','https://127.0.0.1/v1','https://169.254.169.254/v1','https://u:p@example.test/v1','https://example.test/v1?x=1'])assert.throws(()=>normalizeEndpoint(url));assert.throws(()=>command({op:'save',profile:{label:'Bad'},connector:{base_url:'https://example.test/v1',certificate:'BEGIN PRIVATE KEY'}}));});
  test('wording approval binds exact saved hash',()=>{command({op:'wording',id:bab,wording:'Focus on boundary cases.'});const p=registry.read().profiles[0];assert.equal(p.overlay_approved,false);assert.throws(()=>command({op:'approve_wording',id:bab,hash:'old'}));command({op:'approve_wording',id:bab,hash:p.overlay_hash});assert.equal(registry.read().profiles[0].overlay_approved,true);});
  test('duplicate is a new disabled identity without approval',()=>{command({op:'duplicate',id:bab});const p=registry.read().profiles.at(-1);assert.notEqual(p.id,bab);assert.equal(p.state,'disabled');assert.equal(p.overlay_approved,false);});
  test('archive and Undo retain original events',()=>{const before=registry.read().events.length;command({op:'archive',id:bab});assert(!registry.snapshot().profiles.some(p=>p.id===bab));assert(registry.snapshot({state:'archived'}).profiles.some(p=>p.id===bab));command({op:'undo',id:bab});assert.equal(registry.read().profiles[0].state,'disabled');assert(registry.read().events.length>before);});
  test('remote tests cannot perform any credential operation',()=>{const bytes=fs.readFileSync(registry.file);for(const op of ['test','qualify','enable','rotate','revoke'])assert.throws(()=>command({op,id:bab}),/No request or credential operation/);assert.deepEqual(fs.readFileSync(registry.file),bytes);});
  test('exclusion retains quorum and rejects explicit bypass',()=>{command({op:'exclude_cli',route:'copilot'});const options={governor:'codex',reviewers:['claude','copilot'],minSuccess:2};assert.throws(()=>applyReviewerSettings(options,{root}),/quorum/);assert.throws(()=>applyReviewerSettings({governor:'codex',reviewers:['copilot'],reviewersExplicit:true},{root}),/excluded/);command({op:'restore_cli',route:'copilot'});});
  test('saved exclusions hold after presets, automatic routing and second look',selectionExclusionControls);
  test('unreadable saved settings refuse instead of dropping exclusions',selectionInspectionControls);
  test('one thousand saved profiles stay bounded and paged',()=>{registry.mutate(registry.read().revision,state=>{const p=state.profiles[0];for(let n=state.profiles.length;n<1000;n++)state.profiles.push({...p,id:`fixture-profile-${n}`,label:`Bee ${n}`});});assert.equal(registry.snapshot().profiles.length,25);assert.equal(registry.snapshot().counts.registered,1000);assert.throws(()=>command({op:'duplicate',id:bab}),/limit/);});
  test('unsupported migration retains original bytes',()=>{const original=fs.readFileSync(registry.file);const data=JSON.parse(original);data.schema='unsupported/99';fs.writeFileSync(registry.file,JSON.stringify(data));const unsupported=fs.readFileSync(registry.file);assert.throws(()=>registry.read(),/Unsupported registry/);assert.deepEqual(fs.readFileSync(registry.file),unsupported);fs.writeFileSync(registry.file,original);});
  console.log(JSON.stringify({passed:true,checks:count,network_calls:0,live_fleet:false}));
}finally{assert(path.resolve(fixture).startsWith(path.resolve(os.tmpdir())+path.sep+'momm-registry-test-'));fs.rmSync(fixture,{recursive:true,force:true});}
