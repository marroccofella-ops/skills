const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function assertNoLinks(dir){for(let current=path.resolve(dir);;current=path.dirname(current)){if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('Historical snapshot path contains a link');if(path.dirname(current)===current)break;}}
function present(file){try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
// Published source identities reviewed here are restoration authority, never
// adjacent metadata, environment configuration or a backup's executable code.
const approved=Object.freeze([Object.freeze({version:'0.5.0-rc.2',sha256:'32856addd81fe34d5c934b1ea2f46f84c808f30c88f2e79f845ba8d58049e8e7'})]);
const roots=['scripts','tests','references','assets/voices.json','assets/control','assets/browser','assets/optional-voice','README.md','SKILL.md','LICENSE','package.json','CHANGELOG.md','COMPATIBILITY.md','EVOLUTION.md'];
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function safePath(file){return typeof file==='string'&&file.length<=240&&!/[\\:\u0000-\u001f\u007f]/.test(file)&&!file.startsWith('/')&&file.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[. ]$/.test(p)&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))&&roots.some(r=>file===r||file.startsWith(r+'/'));}
function readFile(file,limit){let fd;try{assertNoLinks(file);const before=fs.lstatSync(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||!Number.isSafeInteger(before.size)||before.size>limit)throw Error('Historical snapshot file refused');fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const opened=fs.fstatSync(fd);if(!opened.isFile()||opened.nlink!==1||opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size)throw Error('Historical snapshot changed');const bytes=Buffer.alloc(opened.size+1);let offset=0,count;while(offset<bytes.length&&(count=fs.readSync(fd,bytes,offset,bytes.length-offset,null)))offset+=count;const after=fs.fstatSync(fd);if(offset!==opened.size||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||after.ctimeMs!==opened.ctimeMs)throw Error('Historical snapshot changed');return bytes.subarray(0,offset);}finally{if(fd!==undefined)fs.closeSync(fd);}}
// A trusted in-process function is the sole seam for small synthetic fixtures.
// The installer CLI supplies neither this function nor a replacement policy.
function createHistoricalVerifier(trustedPolicy=()=>approved){
 if(typeof trustedPolicy!=='function')throw Error('Historical policy must be a trusted function');
 return function verifyHistorical(root){
  assertNoLinks(root);if(!fs.lstatSync(root).isDirectory())throw Error('Historical snapshot is not a directory');
  const bytes=readFile(path.join(root,'manifest.json'),1048576),hash=digest(bytes),policy=trustedPolicy();
  if(!Array.isArray(policy)||policy.length>16)throw Error('Historical restoration policy refused');
  const pin=policy.find(p=>p&&typeof p.version==='string'&&/^[a-f0-9]{64}$/.test(p.sha256||'')&&p.sha256===hash);
  if(!pin)throw Error('Historical rollback manifest is not approved');
  let manifest;try{manifest=JSON.parse(bytes.toString('utf8'));}catch{throw Error('Approved historical manifest is invalid');}
  if(manifest.schema!=='dom-tts-source/1'||manifest.version!==pin.version||!Array.isArray(manifest.files)||manifest.files.length<1||manifest.files.length>1023||Object.keys(manifest).sort().join(',')!=='files,schema,version')throw Error('Historical manifest schema refused');
  const expected=new Map();for(const item of manifest.files){if(!item||Object.keys(item).sort().join(',')!=='path,sha256'||!safePath(item.path)||!/^[a-f0-9]{64}$/.test(item.sha256||'')||expected.has(item.path.toLowerCase()))throw Error('Historical manifest path refused');expected.set(item.path.toLowerCase(),item);}
  if(!expected.has('package.json'))throw Error('Historical package identity missing');
  const seen=new Set();let total=0,entries=0;
  function visit(relative){if(++entries>2048)throw Error('Historical snapshot entry limit exceeded');const file=path.join(root,relative);assertNoLinks(file);const stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw Error('Historical snapshot contains a link');
   if(stat.isDirectory()){if(!manifest.files.some(f=>f.path.startsWith(relative+'/')))throw Error('Unknown historical packaged directory');const directory=fs.opendirSync(file);try{let child;while((child=directory.readSync()))visit(relative+'/'+child.name);}finally{directory.closeSync();}}
   else if(stat.isFile()){const item=expected.get(relative.toLowerCase());if(!item||item.path!==relative||stat.nlink!==1)throw Error('Unknown historical packaged artifact');if(!Number.isSafeInteger(stat.size)||stat.size<0||stat.size>8*1024*1024||(total+=stat.size)>30*1024*1024)throw Error('Historical snapshot size limit exceeded');seen.add(relative);}
   else throw Error('Historical snapshot contains a special file');}
  for(const entry of roots)if(present(path.join(root,entry)))visit(entry);
  if(seen.size!==expected.size)throw Error('Historical snapshot file missing');
  // Reject newer recipe/native payload claims rather than broadening old roots.
  if(present(path.join(root,'source-files.json'))||present(path.join(root,'.gitignore')))throw Error('Unknown historical packaged artifact');
  for(const item of manifest.files)if(digest(readFile(path.join(root,item.path),8*1024*1024))!==item.sha256)throw Error('Historical snapshot hash mismatch');
  const identity=JSON.parse(readFile(path.join(root,'package.json'),65536).toString('utf8'));if(identity.version!==pin.version)throw Error('Historical package version mismatch');
  return manifest;
 };
}
module.exports={verifyHistorical:createHistoricalVerifier(),createHistoricalVerifier};
