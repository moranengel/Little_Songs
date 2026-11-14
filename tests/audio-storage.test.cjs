const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const S=require('../safeguards.js'),B=require('../backup.js');
(async()=>{
 const originals=[{id:'a',title:'A',icon:'🐻',source:'local',order:0,blob:new Blob(['one'],{type:'audio/mpeg'})},{id:'b',title:'B',icon:'🐰',source:'local',order:1,blob:new Blob(['different second'],{type:'audio/mpeg'})}];
 const packed=await Promise.all(originals.map(S.packAudio));
 assert.ok(packed.every(r=>r.audioBytes instanceof ArrayBuffer&&!('blob' in r)),'No Blob handles reach storage');
 const loaded=structuredClone(packed).map(S.unpackAudio);
 assert.equal(await loaded[0].blob.text(),'one');assert.equal(await loaded[1].blob.text(),'different second');assert.notEqual(loaded[0].fingerprint,loaded[1].fingerprint);
 assert.equal(S.unpackAudio(originals[0]),originals[0],'Legacy data is read without automatic migration');
 const archive=await B.encode(loaded);const restored=await B.decode(archive);
 for(let i=0;i<restored.length;i++)assert.equal(restored[i].fingerprint,loaded[i].fingerprint,'Portable backup checksum survives restore');
 const edited=[{...loaded[0],title:'Current name',icon:'🎸',order:9},{...loaded[1],hidden:true},{id:'unmatched',title:'Keep',blob:new Blob(['keep'])}];
 const repairs=S.repairAudio(edited,restored);assert.equal(repairs.length,1);assert.equal(repairs[0].title,'Current name');assert.equal(repairs[0].icon,'🎸');assert.equal(repairs[0].order,9);assert.equal(repairs[0].blob,restored[0].blob);assert.equal(edited[1].hidden,true);
 const repacked=await Promise.all(restored.map(S.packAudio));assert.equal(await S.unpackAudio(structuredClone(repacked[1])).blob.text(),'different second');
 class WrongRead extends Blob {async arrayBuffer(){return new TextEncoder().encode('one').buffer}}
 const alias={...originals[1],blob:new WrongRead(['different second'],{type:'audio/mpeg'})};
 await assert.rejects(()=>S.packAudio(alias),/3.*16/);await assert.rejects(()=>S.fingerprint(alias.blob),/3.*16/);await assert.rejects(()=>B.encode([alias]),/קריאת/);
 await assert.rejects(()=>S.packAudio({...originals[0],fingerprint:'wrong'}),/חתימה/);await assert.rejects(()=>B.encode([{...originals[0],fingerprint:'wrong'}]),/חתימה/);
 let transactions=0;const ctx={SAFE:S,db:{transaction(){transactions++;throw Error('must not open transaction')}}};vm.createContext(ctx);
 const app=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');vm.runInContext(app.slice(app.indexOf('  async function write('),app.indexOf('  function applySongEdits(')),ctx);
 await assert.rejects(()=>ctx.write('tracks',[originals[0],alias],[],true),/בתים/);assert.equal(transactions,0,'A bad record rejects the whole batch before any write');
 console.log('PASS: byte-backed persistence, distinct audio after structured-clone/reload, legacy reads, checksum-preserving backup/restore, alias rejection and atomic preflight.');
})().catch(e=>{console.error(e);process.exitCode=1});
