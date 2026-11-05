'use strict';
// Synthetic PE metadata only: no runnable instructions, native invocation,
// downloads, reflection loading or trust/policy changes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {assemblyVersion,readAssemblyVersion,LIMIT}=require('./pe-assembly-version.cjs');
const align=value=>Math.ceil(value/4)*4;
function fixture({pe64=false,heaps=0,large='none',version=[3,7,11,13]}={}){
 const S=heaps&1?4:2,B=heaps&4?4:2;
 // Independently specified layouts for these four small preceding tables;
 // large fixtures exercise 2/4-byte heap, coded and direct table indexes.
 const rows=new Map([[0,1],[1,large==='coded'?16384:1],[2,1],...(large==='simple'?[[6,65536]]:[]),[12,1],[32,1]]);
 const sizes=new Map([[0,2+S+3*(heaps&2?4:2)],[1,(large==='coded'?4:2)+2*S],[2,4+2*S+(large==='coded'?4:2)+2+(large==='simple'?4:2)],[6,8+S+B+2],[12,(large==='none'?2:4)+(large==='simple'?4:2)+B],[32,16+B+2*S]]);
 const tables=Buffer.alloc(24+rows.size*4+[...rows].reduce((sum,[table,count])=>sum+count*sizes.get(table),0));
 tables[4]=2;tables[6]=heaps;tables[7]=1;let valid=0n;for(const table of rows.keys())valid|=1n<<BigInt(table);tables.writeBigUInt64LE(valid,8);
 let offset=24;for(const count of rows.values()){tables.writeUInt32LE(count,offset);offset+=4;}
 let assembly;for(const [table,count]of rows){if(table===32)assembly=offset;offset+=count*sizes.get(table);}
 for(let i=0;i<4;i++)tables.writeUInt16LE(version[i],assembly+4+i*2);
 if(S===2)tables.writeUInt16LE(1,assembly+16+B);else tables.writeUInt32LE(1,assembly+16+B);
 const contents=[['#~',tables],['#Strings',Buffer.from('\0Fixture\0')],['#Blob',Buffer.from([0])]];
 const streamHeaders=contents.reduce((sum,[name])=>sum+8+align(name.length+1),0),rootSize=32+streamHeaders;
 const metadata=Buffer.alloc(rootSize+contents.reduce((sum,[,data])=>sum+align(data.length),0));
 metadata.writeUInt32LE(0x424a5342,0);metadata.writeUInt16LE(1,4);metadata.writeUInt16LE(1,6);metadata.writeUInt32LE(12,12);metadata.write('v4.0.30319\0',16);metadata.writeUInt16LE(contents.length,30);
 const positions={};let header=32,dataAt=rootSize;for(const [name,data]of contents){positions[name]={header,at:dataAt,size:data.length};metadata.writeUInt32LE(dataAt,header);metadata.writeUInt32LE(data.length,header+4);metadata.write(name+'\0',header+8);data.copy(metadata,dataAt);header+=8+align(name.length+1);dataAt+=align(data.length);}
 const pe=0x80,optional=pe+24,optionalSize=pe64?0xf0:0xe0,section=optional+optionalSize,raw=0x200,metaRaw=raw+0x80,rawSize=Math.ceil((0x80+metadata.length)/0x200)*0x200;
 const bytes=Buffer.alloc(raw+rawSize);bytes.writeUInt16LE(0x5a4d,0);bytes.writeUInt32LE(pe,0x3c);bytes.writeUInt32LE(0x4550,pe);bytes.writeUInt16LE(pe64?0x8664:0x14c,pe+4);bytes.writeUInt16LE(1,pe+6);bytes.writeUInt16LE(optionalSize,pe+20);bytes.writeUInt16LE(pe64?0x20b:0x10b,optional);bytes.writeUInt32LE(raw,optional+60);
 const directory=optional+(pe64?112:96);bytes.writeUInt32LE(16,directory-4);bytes.writeUInt32LE(0x2000,directory+14*8);bytes.writeUInt32LE(72,directory+14*8+4);
 bytes.write('.text',section);bytes.writeUInt32LE(rawSize,section+8);bytes.writeUInt32LE(0x2000,section+12);bytes.writeUInt32LE(rawSize,section+16);bytes.writeUInt32LE(raw,section+20);
 bytes.writeUInt32LE(72,raw);bytes.writeUInt16LE(2,raw+4);bytes.writeUInt16LE(5,raw+6);bytes.writeUInt32LE(0x2080,raw+8);bytes.writeUInt32LE(metadata.length,raw+12);metadata.copy(bytes,metaRaw);
 return {bytes,pe,optional,section,directory,raw,metadata:metaRaw,table:metaRaw+positions['#~'].at,assembly:metaRaw+positions['#~'].at+assembly,positions,version:version.join('.')};
}
function checkFixtures(){
 let accepted=0,refused=0;for(const options of [{},{pe64:true},{heaps:7},{large:'coded'},{large:'simple'},{pe64:true,heaps:7,large:'coded'},{version:[0,65535,1,0]}]){const item=fixture(options);assert.equal(assemblyVersion(item.bytes),item.version);accepted++;}
 const original=fixture(),fail=mutate=>{const bytes=Buffer.from(original.bytes);mutate(bytes,original);assert.throws(()=>assemblyVersion(bytes),/^Error: PE Assembly metadata refused$/);refused++;};
 for(const length of [0,1,63,0x80,0x180,original.raw+71,original.metadata+23,original.bytes.length-1]){assert.throws(()=>assemblyVersion(original.bytes.subarray(0,length)),/PE Assembly metadata refused/);refused++;}
 for(const value of [undefined,null,'MZ',new Uint8Array(64)]){assert.throws(()=>assemblyVersion(value),/PE Assembly metadata refused/);refused++;}
 fail(bytes=>bytes.writeUInt16LE(0,0));fail(bytes=>bytes.writeUInt32LE(0xffffffff,0x3c));fail((bytes,x)=>bytes.writeUInt32LE(0,x.pe));
 fail((bytes,x)=>bytes.writeUInt16LE(97,x.pe+6));fail((bytes,x)=>bytes.writeUInt16LE(0x999,x.optional));fail((bytes,x)=>bytes.writeUInt32LE(14,x.directory-4));
 fail((bytes,x)=>bytes.writeUInt32LE(0x100,x.optional+60));fail((bytes,x)=>bytes.writeUInt32LE(0xffffffff,x.section+16));fail((bytes,x)=>bytes.writeUInt32LE(0xfffffff0,x.section+12));
 fail((bytes,x)=>bytes.writeUInt32LE(0,x.directory+14*8));fail((bytes,x)=>bytes.writeUInt32LE(71,x.directory+14*8+4));fail((bytes,x)=>bytes.writeUInt32LE(4097,x.directory+14*8+4));
 fail((bytes,x)=>bytes.writeUInt32LE(0xffffffff,x.raw+8));fail((bytes,x)=>bytes.writeUInt32LE(0xffffffff,x.raw+12));fail((bytes,x)=>bytes.writeUInt32LE(0,x.metadata));
 fail((bytes,x)=>bytes.writeUInt32LE(0xffffffff,x.metadata+12));fail((bytes,x)=>bytes.writeUInt16LE(33,x.metadata+30));
 fail((bytes,x)=>bytes.write('#-',x.metadata+40));fail((bytes,x)=>bytes.writeUInt32LE(0,x.metadata+x.positions['#~'].header));
 fail((bytes,x)=>bytes.writeUInt32LE(x.positions['#~'].at,x.metadata+x.positions['#Strings'].header));fail((bytes,x)=>bytes.writeUInt32LE(1,x.metadata+x.positions['#~'].header+4));
 fail((bytes,x)=>{bytes[x.table+6]=0x80;});fail((bytes,x)=>{bytes[x.table+4]=3;});fail((bytes,x)=>bytes.writeBigUInt64LE(1n<<63n,x.table+8));
 fail((bytes,x)=>bytes.writeUInt32LE(1000001,x.table+24));fail((bytes,x)=>bytes.writeUInt32LE(0xffffffff,x.table+28));fail((bytes,x)=>bytes.writeUInt32LE(2,x.table+24+4*4));
 fail((bytes,x)=>bytes.writeUInt16LE(0,x.assembly+18));fail((bytes,x)=>bytes.writeUInt16LE(65535,x.assembly+18));fail((bytes,x)=>bytes.writeUInt16LE(65535,x.assembly+16));
 fail((bytes,x)=>bytes.fill(65,x.metadata+x.positions['#Strings'].at+1,x.metadata+x.positions['#Strings'].at+x.positions['#Strings'].size));
 fail((bytes,x)=>{bytes.writeUInt16LE(2,x.pe+6);bytes.copy(bytes,x.section+40,x.section,x.section+40);});
 fail((bytes,x)=>{bytes[x.metadata+40]=0xa3;});fail((bytes,x)=>bytes.write('#~\0',x.metadata+x.positions['#Blob'].header+8));
 fail((bytes,x)=>bytes.fill(65,x.metadata+40,x.metadata+72));fail((bytes,x)=>bytes.writeUInt16LE(0,x.pe+20));
 fail((bytes,x)=>bytes.writeUInt32LE(0x2000+bytes.readUInt32LE(x.section+16)-8,x.directory+14*8));
 assert.throws(()=>assemblyVersion(Buffer.alloc(LIMIT+1)),/PE Assembly metadata refused/);refused++;
 // Random truncations/mutations must fail with a sanitized code or still return
 // four UInt16 version fields. Runtime loading is never part of inspection.
 let fuzzed=0,seed=12345;for(let i=0;i<200;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const bytes=Buffer.from(original.bytes),offset=seed%bytes.length;bytes[offset]^=255;try{assert.match(assemblyVersion(bytes),/^\d+\.\d+\.\d+\.\d+$/);}catch(error){assert.equal(error.message,'PE Assembly metadata refused');}fuzzed++;}
 // Descriptor fixtures exercise the bounded file reader without opening real
 // files, including pre-read link/size checks and a changed/truncated file.
 let files=0;const methods=['lstatSync','openSync','fstatSync','readSync','closeSync'],saved=Object.fromEntries(methods.map(name=>[name,fs[name]]));
 try{for(const kind of ['valid','oversize','symlink','changed-identity','truncated','changed-after-read']){
  let opened=0,reads=0,closed=0,position=0,stats=0;const stat={isFile:()=>true,isSymbolicLink:()=>kind==='symlink',size:kind==='oversize'?LIMIT+1:original.bytes.length,ino:1,dev:1,mtimeMs:1};
  fs.lstatSync=()=>stat;fs.openSync=()=>{opened++;return 999999;};fs.fstatSync=()=>({...stat,ino:kind==='changed-identity'?2:1,mtimeMs:kind==='changed-after-read'&&stats++?2:1});
  fs.readSync=(descriptor,buffer,offset,length,at)=>{assert.equal(at,position);assert(length<=original.bytes.length);reads++;if(kind==='truncated')return 0;const count=Math.min(17,length);original.bytes.copy(buffer,offset,at,at+count);position+=count;return count;};fs.closeSync=()=>closed++;
  if(kind==='valid')assert.equal(readAssemblyVersion('explicit-synthetic-fixture'),original.version);else assert.throws(()=>readAssemblyVersion('explicit-synthetic-fixture'),/PE Assembly metadata refused/);
  if(['oversize','symlink'].includes(kind)){assert.equal(opened,0);assert.equal(reads,0);}else{assert.equal(opened,1);assert.equal(closed,1);}if(kind==='changed-identity')assert.equal(reads,0);files++;
 }}finally{for(const name of methods)fs[name]=saved[name];}
 return {accepted,refused,fuzzed,files};
}
module.exports={fixture,checkFixtures};
