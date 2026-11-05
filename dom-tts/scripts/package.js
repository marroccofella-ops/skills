const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {ROOT,writeObject}=require('./runtime');
const roots=['scripts','tests','references','assets/voices.json','assets/control','assets/browser','assets/optional-voice','README.md','SKILL.md','LICENSE','package.json','CHANGELOG.md','COMPATIBILITY.md','EVOLUTION.md','.gitignore','source-files.json'];
const nativePaths=new Set(['scripts/providers/windows/NativeSpeech.exe','scripts/providers/windows/release.json','scripts/providers/windows/tray/TrayCompanion.exe','scripts/providers/windows/tray/release.json']);
function safeSourcePath(file){
 if(typeof file!=='string'||file.length>240||/[\\:\u0000-\u001f\u007f]/.test(file)||file.startsWith('/')||file.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)))return false;
 if(!roots.some(root=>file===root||file.startsWith(root+'/')))return false;
 if(nativePaths.has(file))return true;
 const parts=file.toLowerCase().split('/'),name=parts.at(-1);
 return !parts.some(p=>['state','.local-test','node_modules','__pycache__','.git','recordings'].includes(p))&&!['settings.json','status.json','browser-session.json','control-session.json','release.json'].includes(name)&&!/^\.env(?:\.|$)/.test(name)&&!/[.](?:exe|dll|pdb|zip|wav|mp3|ogg|webm|pem|key|pfx|p12|log|pyc|tmp)$/i.test(name);
}
function sourceStat(root,relative){
 let current=path.resolve(root),stat=fs.lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Source package contains a link or invalid root');
 const parts=relative.split('/');for(let i=0;i<parts.length;i++){current=path.join(current,parts[i]);stat=fs.lstatSync(current);if(stat.isSymbolicLink()||stat.isFile()&&stat.nlink!==1)throw Error('Source package contains a link');if(i<parts.length-1&&!stat.isDirectory())throw Error('Invalid source ancestor');}
 return stat;
}
function sourceJson(root,name,limit,label){
 const file=path.join(root,name);let descriptor;
 try{
  const stat=sourceStat(root,name);if(!stat.isFile()||stat.size>limit)throw Error();
  descriptor=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const opened=fs.fstatSync(descriptor);
  if(!opened.isFile()||opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size)throw Error();
  const bytes=fs.readFileSync(descriptor),after=fs.fstatSync(descriptor);
  if(bytes.length!==stat.size||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs)throw Error();
  return JSON.parse(bytes.toString('utf8'));
 }catch{throw Error(label+' refused');}finally{if(descriptor!==undefined)fs.closeSync(descriptor);}
}
function recipe(root=ROOT){
 const value=sourceJson(root,'source-files.json',131072,'Reviewed source recipe');
 if(value.schema!=='dom-tts-source-inputs/1'||!Array.isArray(value.files)||value.files.length<2||value.files.length>1023||value.files.some(f=>!safeSourcePath(f))||new Set(value.files.map(f=>f.toLowerCase())).size!==value.files.length||!value.files.includes('source-files.json')||!value.files.includes('package.json'))throw Error('Reviewed source recipe refused');
 return value.files;
}
function sourceFiles(root=ROOT){
 // The reviewed recipe, not a fresh recursive inventory, authorizes packaging.
 // Unknown local files are refused before their contents can be hashed/copied.
 const expected=new Set(recipe(root)),seen=new Set();let totalBytes=0;
 function visit(relative){
  const stat=sourceStat(root,relative);
  if(stat.isSymbolicLink())throw Error('Source package contains a link');
  if(stat.isDirectory()){
   if(![...expected].some(file=>file.startsWith(relative+'/')))throw Error('Unreviewed local artifact in source tree');
   for(const child of fs.readdirSync(path.join(root,relative)))visit(relative+'/'+child);
  }else if(stat.isFile()){
   if(!safeSourcePath(relative)||!expected.has(relative))throw Error('Unreviewed local artifact in source tree');
   if(!Number.isSafeInteger(stat.size)||stat.size<0||stat.size>8*1024*1024||(totalBytes+=stat.size)>30*1024*1024)throw Error('Reviewed source size limit exceeded');
   seen.add(relative);
  }else throw Error('Source package contains a special file');
 }
 for(const rootEntry of roots)visit(rootEntry);
 if(seen.size!==expected.size||[...expected].some(file=>!seen.has(file)))throw Error('Reviewed source input missing');
 for(const [binary,receipt]of [['scripts/providers/windows/NativeSpeech.exe','scripts/providers/windows/release.json'],['scripts/providers/windows/tray/TrayCompanion.exe','scripts/providers/windows/tray/release.json']])if(seen.has(binary)!==seen.has(receipt))throw Error('Native source artifacts require paired reviewed receipts');
 return [...seen].sort();
}
function manifest(root=ROOT){const files=sourceFiles(root);return {schema:'dom-tts-source/1',version:sourceJson(root,'package.json',65536,'Package identity').version,files:files.map(file=>({path:file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')}))};}
function verify(root=ROOT){const current=manifest(root),saved=sourceJson(root,'manifest.json',1048576,'Source manifest');if(JSON.stringify(saved)!==JSON.stringify(current))throw new Error('Source manifest mismatch; rebuild from reviewed source');return saved;}
if(require.main===module){try{writeObject(path.join(ROOT,'manifest.json'),manifest());console.log('Source manifest created from reviewed source recipe; local artifacts refused.');}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={sourceFiles,manifest,verify,recipe,safeSourcePath,nativePaths};
