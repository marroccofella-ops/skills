delete process.env.DOM_TTS_HOME;
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {ROOT,writeObject}=require('../scripts/runtime'),{sourceFiles,manifest,verify,recipe}=require('../scripts/package');
const parent=path.join(ROOT,'.local-test'),area=path.join(parent,'source-boundaries-'+crypto.randomBytes(8).toString('hex'));
fs.mkdirSync(area,{recursive:true});
try{
 for(const file of sourceFiles()){
  const target=path.join(area,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(ROOT,file),target);
 }
 const baseline=manifest(area);assert(baseline.files.some(item=>item.path==='.gitignore'));assert(baseline.files.some(item=>item.path==='source-files.json'));
 writeObject(path.join(area,'manifest.json'),baseline);
 for(const name of ['package.json','manifest.json']){
  const target=path.join(area,name),originalStat=fs.lstatSync,originalRead=fs.readFileSync;let read=false;
  fs.lstatSync=function(file,...args){const stat=originalStat.call(this,file,...args);return path.resolve(String(file))===path.resolve(target)?Object.assign(Object.create(Object.getPrototypeOf(stat)),stat,{isSymbolicLink:()=>true}):stat;};
  fs.readFileSync=function(file,...args){if(typeof file!=='number'&&path.resolve(String(file))===path.resolve(target))read=true;return originalRead.call(this,file,...args);};
  try{assert.throws(()=>name==='manifest.json'?verify(area):manifest(area),/link|refused/);assert.equal(read,false);}finally{fs.lstatSync=originalStat;fs.readFileSync=originalRead;}
 }
 {
  const target=path.join(area,'scripts','speak.js'),originalStat=fs.lstatSync,originalRead=fs.readFileSync;let read=false;
  fs.lstatSync=function(file,...args){const stat=originalStat.call(this,file,...args);return path.resolve(String(file))===path.resolve(target)?Object.assign(Object.create(Object.getPrototypeOf(stat)),stat,{size:2**40}):stat;};
  fs.readFileSync=function(file,...args){if(typeof file!=='number'&&path.resolve(String(file))===path.resolve(target))read=true;return originalRead.call(this,file,...args);};
  try{assert.throws(()=>manifest(area),/size limit/);assert.equal(read,false);}finally{fs.lstatSync=originalStat;fs.readFileSync=originalRead;}
 }
 // Actual local artifacts must not silently become source, even if named like code.
 for(const relative of ['scripts/local-settings.json','tests/fixture-recording.wav','scripts/local-helper.exe','tests/unreviewed-helper.cjs']){
  const file=path.join(area,relative),original=fs.readFileSync;fs.writeFileSync(file,'PRIVATE_PACKAGE_CANARY');let read=false;
  fs.readFileSync=function(target,...args){if(path.resolve(String(target))===path.resolve(file)){read=true;throw Error('private contents must not be read');}return original.call(this,target,...args);};
  try{assert.throws(()=>manifest(area),/Unreviewed local artifact/);assert.equal(read,false);}finally{fs.readFileSync=original;fs.unlinkSync(file);}
 }
 const nested=path.join(area,'tests','.local-test');fs.mkdirSync(nested);fs.writeFileSync(path.join(nested,'settings.json'),'PRIVATE_PACKAGE_CANARY');
 assert.throws(()=>sourceFiles(area),/Unreviewed local artifact/);fs.unlinkSync(path.join(nested,'settings.json'));fs.rmdirSync(nested);
 // Local runtime settings outside the declared source roots remain unshipped.
 fs.mkdirSync(path.join(area,'state'));fs.writeFileSync(path.join(area,'state','status.json'),'PRIVATE_PACKAGE_CANARY');
 fs.writeFileSync(path.join(area,'assets','settings.json'),'PRIVATE_PACKAGE_CANARY');assert.deepEqual(manifest(area),baseline);
 const sourceRecipe=path.join(area,'source-files.json'),originalRecipe=fs.readFileSync(sourceRecipe,'utf8'),value=recipe(area);
 for(const added of ['../outside','tests/../outside','state/status.json','scripts/settings.json','scripts/private.pfx']){
  writeObject(sourceRecipe,{schema:'dom-tts-source-inputs/1',files:[...value,added]});assert.throws(()=>sourceFiles(area),/recipe refused/);
 }
 fs.writeFileSync(sourceRecipe,originalRecipe);
 const missing=path.join(area,'scripts','speak.js'),saved=fs.readFileSync(missing);fs.unlinkSync(missing);assert.throws(()=>sourceFiles(area),/missing/);fs.writeFileSync(missing,saved);
 assert.deepEqual(manifest(area),baseline);
 console.log('PASS: reviewed source recipe, restored ignore file, unexpected code/settings/audio/binary refusal before contents are read, malformed recipe and missing input refusal; runtime state/settings stay outside packages.');
}finally{
 const resolved=fs.realpathSync(area);if(path.dirname(resolved)!==fs.realpathSync(parent)||!/^source-boundaries-[a-f0-9]+$/.test(path.basename(resolved))||fs.lstatSync(area).isSymbolicLink())throw Error('Unexpected source boundary fixture cleanup path');
 fs.rmSync(resolved,{recursive:true,force:true});
}
