// Synthetic executable bytes and trusted function seams only; no executable/signing action.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {helperInfo}=require('../scripts/providers/windows-helper');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dom-publisher-')),a='A'.repeat(40),b='B'.repeat(40),fixtureVersion='0.1.0-fixture',dir=path.join(root,'scripts/providers/windows');
try{
 fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:fixtureVersion}));
 const file=path.join(dir,'NativeSpeech.exe');fs.writeFileSync(file,'SYNTHETIC B executable; never run');
 fs.writeFileSync(path.join(dir,'release.json'),JSON.stringify({schema:'dom-tts-windows-helper/1',protocol:1,version:fixtureVersion,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),signerThumbprint:b}));
 const verifySignature=()=>({status:'Valid',signatureType:'Authenticode',productName:'Dom TTS',productVersion:fixtureVersion,thumbprint:b});
 const publicFacts=({state,code,protocol})=>({state,...(code?{code}:{}),...(protocol?{protocol}:{})});
 const observed={qualification:'Synthetic bytes and injected signature facts only; no executable or CA certification',selfApprovedBReceipt:publicFacts(helperInfo({root,verifySignature})),bExeAndReceiptAgainstARootPin:publicFacts(helperInfo({root,verifySignature,publisherPolicy:()=>[a]}))};
 if(process.argv.includes('--observe'))console.log(JSON.stringify(observed,null,2));
 else{
  assert.equal(observed.selfApprovedBReceipt.code,'helper-publisher-unconfigured');assert.equal(observed.bExeAndReceiptAgainstARootPin.code,'helper-publisher-refused');
  const policy=require('../scripts/providers/publisher-policy');assert.deepEqual(policy.reviewedPublishers(),[]);assert.equal(policy.approvedThumbprint(a),false);
  const copy=policy.reviewedPublishers();copy.push(b);assert.deepEqual(policy.reviewedPublishers(),[]);
  fs.writeFileSync(path.join(root,'publisher-policy.json'),JSON.stringify({approvedPublishers:[b]}));assert.equal(helperInfo({root,verifySignature}).code,'helper-publisher-unconfigured');
  assert.equal(policy.approvedThumbprint(a,()=>[a]),true);assert.equal(policy.approvedThumbprint(b,()=>[a]),false);assert.equal(policy.approvedThumbprint(a.toLowerCase(),()=>[a]),true);
  assert.throws(()=>policy.publisherPins(()=>['invalid']),/publisher policy/);assert.throws(()=>policy.publisherPins([a]),/publisher policy/);
  const generated=policy.publisherIdentitySource('0.5.0-rc.3',()=>[a]);assert.match(generated,/class TrustedPublisherIdentity/);assert.match(generated,/Version="0\.5\.0-rc\.3"/);assert.match(generated,/ApprovedThumbprint\(string value\)/);assert(generated.includes(a));assert(!generated.includes(b));assert.throws(()=>policy.publisherIdentitySource('bad"version'),/version/);
  const csharp=fs.readFileSync(path.join(__dirname,'../scripts/providers/windows/SetupCompanion.cs'),'utf8');assert.match(csharp,/Trusted\(string file\)\{return TrustedSignature\(file,true\);/);assert.match(csharp,/TrustedRuntime\(string file\)\{return TrustedSignature\(file,false\);/);assert.match(csharp,/!TrustedRuntime\(node\)/);assert.match(csharp,/!Trusted\(self\)/);assert.match(csharp,/ProductVersion!=TrustedPublisherIdentity.Version/);assert.match(csharp,/type=="Authenticode"&&TrustedPublisherIdentity.ApprovedThumbprint\(thumbprint\)/);
  const tray=fs.readFileSync(path.join(__dirname,'../scripts/providers/windows/TrayCompanion.cs'),'utf8');assert(tray.indexOf('if(!TrustedSelf())')<tray.indexOf('using(var mutex='));assert.match(tray,/ProductVersion!=TrustedPublisherIdentity.Version/);assert.match(tray,/\["signatureType"\]=="Authenticode"&&TrustedPublisherIdentity.ApprovedThumbprint/);assert.match(tray,/About.*TrustedPublisherIdentity.Version/);assert.match(tray,/GetEnvironmentVariable\("DOM_TTS_STATE_DIR"\)/);assert.match(tray,/GetOwner\(typeof\(SecurityIdentifier\)\)/);assert.match(tray,/Start at login unavailable.*Enabled=false/);assert.doesNotMatch(tray,/CreateSubKey|\.SetValue\(/);assert.match(tray,/void EnableStartup\(\)\{throw new InvalidOperationException/);
  const {trayEnvironment}=require('../scripts/tray');assert.equal(trayEnvironment({stateDirectory:root,env:{PATH:'public'}}).DOM_TTS_STATE_DIR,path.resolve(root));assert.deepEqual(trayEnvironment({stateDirectory:'',env:{PATH:'public'}}),{PATH:'public'});for(const selected of ['relative','.',1,...(process.platform==='win32'?['\\relative','C:relative']:[])])assert.throws(()=>trayEnvironment({stateDirectory:selected,env:{}}),/absolute path/);
  if(process.platform==='win32'){
   const {buildNative}=require('../scripts/build-native'),signedArgs={out:path.join(root,'never-produced.exe'),signTool:path.join(root,'signtool.exe'),certificateThumbprint:a,timestampUrl:'https://timestamp.example.test'},mustNotRun=()=>{throw Error('must not query or compile');};
   assert.throws(()=>buildNative(signedArgs,{verifySignature:mustNotRun,run:mustNotRun}),/publisher policy is unconfigured/);
   assert.throws(()=>buildNative({...signedArgs,certificateThumbprint:b},{publisherPolicy:()=>[a],verifySignature:mustNotRun,run:mustNotRun}),/not approved/);
   for(const trust of [{status:'NotSigned',signatureType:'None',thumbprint:''},{status:'Valid',signatureType:'Unknown',thumbprint:b},{status:'Valid',signatureType:'Authenticode',thumbprint:''}])assert.throws(()=>buildNative(signedArgs,{publisherPolicy:()=>[a],verifySignature:()=>trust,run:mustNotRun}),/Signing tool must have/);
   for(const product of [{productName:'Other app',productVersion:require('../package.json').version},{productName:'Dom TTS',productVersion:'0.1.0-old.1'}]){
    let compiled=false,signed=false;const standIn=(file,args)=>{if(args[0]==='sign'){signed=true;return {status:0};}compiled=true;fs.writeFileSync(args.find(arg=>arg.startsWith('/out:')).slice(5),'Synthetic compiler bytes; never executable');return {status:0};};
    assert.throws(()=>buildNative(signedArgs,{publisherPolicy:()=>[a],run:standIn,verifySignature:file=>file===signedArgs.signTool?{status:'Valid',signatureType:'Catalog',thumbprint:b}:{status:'Valid',signatureType:'Authenticode',thumbprint:a,...product}}),/Signed helper failed/);assert(compiled&&signed);assert(!fs.existsSync(signedArgs.out));
   }
  }
  console.log('PASS: self-approved B receipt refused by empty source policy and A root pin; source-only policy and exact-version C# generation; synthetic signatures only');
 }
}finally{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('dom-publisher-'));fs.rmSync(root,{recursive:true,force:true});}
