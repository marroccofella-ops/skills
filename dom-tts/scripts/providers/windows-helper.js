const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {ROOT,powershell,psQuote,safeEnv}=require('../runtime');
const {reviewedPublishers,publisherPins}=require('./publisher-policy');
const {windowsProductMetadata}=require('../windows-product-metadata');
function signature(file,{run=spawnSync}={}){
 const command="$ErrorActionPreference='Stop'; $env:PSModulePath=Join-Path $PSHOME 'Modules'; $s=Get-AuthenticodeSignature -LiteralPath "+psQuote(file)+"; $v=[Diagnostics.FileVersionInfo]::GetVersionInfo("+psQuote(file)+"); [ordered]@{productName=[string]$v.ProductName;productVersion=[string]$v.ProductVersion;status=[string]$s.Status;signatureType=[string]$s.SignatureType;thumbprint=if($s.SignerCertificate){[string]$s.SignerCertificate.Thumbprint}else{''}}|ConvertTo-Json -Compress";
 try{
  const result=run(powershell,['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:8192,env:safeEnv()});
  if(result.error||result.status!==0)return {status:'UnknownError',signatureType:'None',thumbprint:'',productName:'',productVersion:''};
  const value=JSON.parse(result.stdout.replace(/^\uFEFF/,''));
  if(typeof value.productName!=='string'||value.productName.length>128||/[\x00-\x1f\x7f]/.test(value.productName)||typeof value.productVersion!=='string'||value.productVersion.length>128||/[\x00-\x1f\x7f]/.test(value.productVersion)||!['Valid','NotSigned','HashMismatch','NotTrusted','UnknownError'].includes(value.status)||!['None','Authenticode','Catalog'].includes(value.signatureType)||typeof value.thumbprint!=='string'||value.thumbprint&&!/^[a-f0-9]{40}$/i.test(value.thumbprint))return {status:'UnknownError',signatureType:'None',thumbprint:'',productName:'',productVersion:''};
  return {status:value.status,signatureType:value.signatureType,thumbprint:value.thumbprint.toUpperCase(),productName:value.productName,productVersion:value.productVersion};
 }catch{return {status:'UnknownError',signatureType:'None',thumbprint:'',productName:'',productVersion:''};}
}
function trustedSignature(value,{embedded=false}={}){return !!value&&value.status==='Valid'&&typeof value.thumbprint==='string'&&/^[a-f0-9]{40}$/i.test(value.thumbprint)&&(embedded?value.signatureType==='Authenticode':['Authenticode','Catalog'].includes(value.signatureType));}
function helperInfo({root=ROOT,verifySignature=signature,component='speech',publisherPolicy=reviewedPublishers}={}){
 if(!['speech','tray'].includes(component))throw Error('invalid native component');
 const base=path.join(root,'scripts','providers','windows'),dir=component==='tray'?path.join(base,'tray'):base,file=path.join(dir,component==='tray'?'TrayCompanion.exe':'NativeSpeech.exe'),metadata=path.join(dir,'release.json');
 if(!fs.existsSync(file))return {state:'absent'};
 try{
  // Function injection is for trusted tests only; runtime policy is reviewed source.
  const pins=publisherPins(publisherPolicy);if(!pins.length)return {state:'blocked',code:'helper-publisher-unconfigured'};
  for(const item of [root,path.join(root,'scripts'),path.join(root,'scripts','providers'),base,dir,file,metadata])if(fs.lstatSync(item).isSymbolicLink())throw Error();
  if(!fs.lstatSync(file).isFile()||fs.statSync(file).size>1048576||!fs.lstatSync(metadata).isFile()||fs.statSync(metadata).size>4096)throw Error();
  const release=JSON.parse(fs.readFileSync(metadata,'utf8')),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,productMetadata=windowsProductMetadata(version,component);
  if(release.schema!==(component==='tray'?'dom-tts-windows-tray/1':'dom-tts-windows-helper/1')||release.protocol!==1||release.version!==version||!/^[a-f0-9]{64}$/.test(release.sha256)||!/^[a-f0-9]{40}$/i.test(release.signerThumbprint))throw Error();
  const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');if(hash!==release.sha256)throw Error();
  const trust=verifySignature(file);
  if(!trustedSignature(trust,{embedded:true})||trust.thumbprint.toUpperCase()!==release.signerThumbprint.toUpperCase())return {state:'blocked',code:'helper-signature-refused'};
  if(trust.productName!==productMetadata.productName||trust.productVersion!==productMetadata.productVersion)return {state:'blocked',code:'helper-product-refused'};
  if(!pins.includes(trust.thumbprint.toUpperCase()))return {state:'blocked',code:'helper-publisher-refused'};
  return {state:'verified',file,protocol:1};
 }catch{return {state:'blocked',code:'helper-integrity-refused'};}
}
module.exports={signature,trustedSignature,helperInfo};
