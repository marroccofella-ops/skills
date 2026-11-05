'use strict';
// Test-only structural metadata reader. No assembly/native loading, invocation,
// trust decision or policy change. ECMA-335 II.22 / II.24 / II.25 and PE/COFF:
// https://www.ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf
// https://learn.microsoft.com/en-us/windows/win32/debug/pe-format
const fs=require('node:fs');
const LIMIT=40*1024*1024;
const refused=()=>{throw Error('PE Assembly metadata refused');};
function assemblyVersion(bytes){
 try{
  if(!Buffer.isBuffer(bytes)||bytes.length<64||bytes.length>LIMIT)refused();
  const range=(offset,size,end=bytes.length)=>{if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset<0||size<0||offset>end-size)refused();return offset;};
  const u16=offset=>bytes.readUInt16LE(range(offset,2)),u32=offset=>bytes.readUInt32LE(range(offset,4));
  if(u16(0)!==0x5a4d)refused();const pe=u32(0x3c);if(pe<64||u32(pe)!==0x4550)refused();
  const coff=range(pe+4,20),count=u16(coff+2),optional=coff+20,optionalSize=u16(coff+16);
  if(count<1||count>96||optionalSize>4096)refused();range(optional,optionalSize);
  const magic=u16(optional),directoryOffset=magic===0x10b?96:magic===0x20b?112:0;
  if(!directoryOffset||optionalSize<directoryOffset+15*8||u32(optional+directoryOffset-4)<15)refused();
  const headers=u32(optional+60),sectionAt=optional+optionalSize;range(sectionAt,count*40);if(headers<sectionAt+count*40||headers>bytes.length)refused();
  const sections=[];for(let i=0;i<count;i++){
   const at=sectionAt+i*40,rva=u32(at+12),virtualSize=u32(at+8),size=u32(at+16),raw=u32(at+20);
   range(raw,size);if(rva+Math.max(size,virtualSize)>0x100000000||size&&raw<headers)refused();
   const section={rva,size,raw,span:Math.max(size,virtualSize)};
   for(const old of sections)if(size&&old.size&&raw<old.raw+old.size&&old.raw<raw+size||section.span&&old.span&&rva<old.rva+old.span&&old.rva<rva+section.span)refused();
   sections.push(section);
  }
  const rvaOffset=(rva,size)=>{
   if(!Number.isSafeInteger(size)||size<1||rva+size>0x100000000)refused();
   const matches=sections.filter(section=>rva>=section.rva&&rva+size<=section.rva+section.size);
   if(rva<headers){if(matches.length||rva+size>headers)refused();return range(rva,size);}
   if(matches.length!==1)refused();return range(matches[0].raw+rva-matches[0].rva,size);
  };
  const cliEntry=optional+directoryOffset+14*8,cliSize=u32(cliEntry+4);
  if(cliSize<72||cliSize>4096)refused();const cli=rvaOffset(u32(cliEntry),cliSize);if(u32(cli)<72||u32(cli)>cliSize)refused();
  const metadataSize=u32(cli+12);if(metadataSize<24||metadataSize>LIMIT)refused();
  const metadata=rvaOffset(u32(cli+8),metadataSize),end=metadata+metadataSize;
  const mr=(at,size)=>range(at,size,end);
  if(u32(metadata)!==0x424a5342)refused();const versionSize=u32(metadata+12);if(versionSize<1||versionSize>256||versionSize%4)refused();
  mr(metadata+16,versionSize);if(bytes[metadata+15+versionSize]!==0)refused();
  let at=metadata+16+versionSize;mr(at,4);const streamCount=u16(at+2);at+=4;if(streamCount<1||streamCount>32)refused();
  const streams=new Map();for(let i=0;i<streamCount;i++){
   mr(at,8);const offset=u32(at),size=u32(at+4),nameStart=at+8;let zero=nameStart;
   while(zero<Math.min(nameStart+32,end)&&bytes[zero]!==0)zero++;if(zero===Math.min(nameStart+32,end))refused();
   const nameBytes=bytes.subarray(nameStart,zero);if(nameBytes.some(value=>value>127))refused();const name=nameBytes.toString('ascii');if(!/^[#~A-Za-z0-9_-]{1,31}$/.test(name)||streams.has(name))refused();
   at=nameStart+Math.ceil((zero-nameStart+1)/4)*4;mr(at,0);mr(metadata+offset,size);streams.set(name,{at:metadata+offset,size});
  }
  const populated=[...streams.values()].filter(stream=>stream.size);for(let i=0;i<populated.length;i++){
   const stream=populated[i];if(stream.at<at)refused();for(let j=0;j<i;j++){const other=populated[j];if(stream.at<other.at+other.size&&other.at<stream.at+stream.size)refused();}
  }
  // The release compiler emits the optimized #~ format. Other metadata formats
  // are refused explicitly, rather than guessed or handed to a runtime loader.
  if(streams.has('#-'))refused();const tables=streams.get('#~'),strings=streams.get('#Strings'),blob=streams.get('#Blob');
  if(!tables||tables.size<24||!strings||!strings.size)refused();const tableEnd=tables.at+tables.size,tr=(offset,size)=>range(offset,size,tableEnd);
  at=tables.at;if(u32(at)!==0||bytes[at+4]!==2||bytes[at+5]!==0||bytes[at+6]&~7||bytes[at+7]!==1)refused();
  const heaps=bytes[at+6],valid=bytes.readBigUInt64LE(tr(at+8,8));if(valid>>45n)refused();at+=24;
  const rows=Array(45).fill(0);for(let table=0;table<45;table++)if(valid&(1n<<BigInt(table))){tr(at,4);rows[table]=u32(at);at+=4;if(rows[table]>1000000)refused();}
  if(rows[32]!==1)refused();const S=heaps&1?4:2,G=heaps&2?4:2,B=heaps&4?4:2;
  const T=table=>rows[table]>=65536?4:2,C=(bits,tables)=>tables.some(table=>rows[table]>=2**(16-bits))?4:2;
  const type=C(2,[2,1,27]),method=C(1,[6,10]),implementation=C(2,[38,35,39]);
  const widths=[2+S+3*G,C(2,[0,26,35,1])+2*S,4+2*S+type+T(4)+T(6),T(4),2+S+B,T(6),8+S+B+T(8),T(8),4+S,T(2)+type,C(3,[2,1,26,6,27])+S+B,
   2+C(2,[4,8,23])+B,C(5,[6,4,1,2,8,9,10,0,14,23,20,17,26,27,32,35,38,39,40,42,44,43])+C(3,[6,10])+B,C(1,[4,8])+B,2+C(2,[2,6,32])+B,6+T(2),4+T(4),B,T(2)+T(20),T(20),2+S+type,T(2)+T(23),T(23),2+S+B,2+T(6)+C(1,[20,23]),T(2)+2*method,S,B,2+C(1,[4,6])+S+T(26),4+T(4),8,4,
   16+B+2*S,4,12,12+2*B+2*S,4+T(35),12+T(35),4+S+B,8+2*S+implementation,8+S+implementation,2*T(2),4+C(1,[2,6])+S,method+B,T(42)+type];
  let assembly;for(let table=0;table<45;table++){const size=rows[table]*widths[table];tr(at,size);if(table===32)assembly=at;at+=size;}
  const index=(offset,width)=>width===2?u16(offset):u32(offset);
  const stringIndex=(value,required=false)=>{if(!value){if(required)refused();return;}if(value>=strings.size)refused();const zero=bytes.indexOf(0,strings.at+value);if(zero<0||zero>=strings.at+strings.size)refused();};
  stringIndex(index(assembly+16+B,S),true);stringIndex(index(assembly+16+B+S,S));
  const publicKey=index(assembly+16,B);if(publicKey){if(!blob||publicKey>=blob.size)refused();let offset=blob.at+publicKey;const first=bytes[offset++];let length=first;if(first&0x80){if(first&0x40){if(first&0x20||offset+3>blob.at+blob.size)refused();length=((first&31)*0x1000000)+(bytes[offset++]*65536)+(bytes[offset++]*256)+bytes[offset++];}else{if(offset>=blob.at+blob.size)refused();length=((first&63)*256)+bytes[offset++];}}range(offset,length,blob.at+blob.size);}
  return [0,1,2,3].map(i=>u16(assembly+4+i*2)).join('.');
 }catch{refused();}
}
function readAssemblyVersion(file){
 let descriptor;try{
  const before=fs.lstatSync(file);if(!before.isFile()||before.isSymbolicLink()||!Number.isSafeInteger(before.size)||before.size<64||before.size>LIMIT)refused();
  descriptor=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const stat=fs.fstatSync(descriptor);if(!stat.isFile()||stat.ino!==before.ino||stat.dev!==before.dev||stat.size!==before.size)refused();
  const bytes=Buffer.alloc(stat.size);let offset=0;while(offset<bytes.length){const count=fs.readSync(descriptor,bytes,offset,bytes.length-offset,offset);if(!count)refused();offset+=count;}
  const after=fs.fstatSync(descriptor);if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)refused();return assemblyVersion(bytes);
 }catch{refused();}finally{if(descriptor!==undefined)fs.closeSync(descriptor);}
}
module.exports={assemblyVersion,readAssemblyVersion,LIMIT};
