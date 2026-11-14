const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const app=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8'),PL=require('../playlists.js');
let audioReads=0;const badAudio={size:999,async arrayBuffer(){audioReads++;throw Error('broken legacy audio')}};
const raw=[{id:'a',title:'A',icon:'🎵',order:0,blob:badAudio},{id:'b',title:'B',icon:'🎵',order:1,blob:badAudio}];
const meta=new Map([['songEdit:a',{title:'Edited',icon:'🎸'}],['playlists',[{id:'p',name:'P',icon:'🎵',color:'#eee5fa',trackIds:['a','b'],sortMode:'manual'}]]]);
const fields={};const ctx={PL,tracks:raw,playlists:meta.get('playlists'),trash:[],currentId:null,crypto:globalThis.crypto,confirm:()=>true,selectedSongIds:new Set(),lastUndoIds:[],$:id=>fields[id]||(fields[id]={close(){}}),read:async(store,key)=>{assert.equal(store,'meta');return key===undefined?[...meta].map(([key,value])=>({key,value})):{key,value:meta.get(key)}},write:async(store,entries)=>{assert.equal(store,'meta','Deletion must only write metadata');for(const entry of entries)meta.set(entry.key,entry.value)},busy:task=>task(),offerUndo(){},resetPlayer(){throw Error('not playing')},async reload(){ctx.tracks=ctx.applySongEdits(raw,await ctx.read('meta'));ctx.trash=meta.get('trash')||[];ctx.playlists=meta.get('playlists')}};
vm.createContext(ctx);vm.runInContext(app.slice(app.indexOf('  function applySongEdits('),app.indexOf('  async function reload('))+app.slice(app.indexOf('  async function deleteTracks('),app.indexOf('  function renderBackup(')),ctx);
(async()=>{
 await ctx.deleteTracks(['a','b']);assert.ok(ctx.tracks.every(t=>t.hidden));assert.equal(ctx.trash.length,2);assert.equal(meta.get('playlists')[0].trackIds.length,0);assert.equal(audioReads,0);assert.equal(raw[0].hidden,undefined);
 await ctx.updateTrackState([{id:'a',hidden:false}]);await ctx.reload();assert.equal(ctx.tracks[0].hidden,false);assert.equal(ctx.tracks[0].title,'Edited');assert.equal(ctx.tracks[0].icon,'🎸');
 await ctx.updateTrackState([{id:'a',order:9}]);await ctx.reload();assert.equal(ctx.tracks[0].hidden,false);assert.equal(ctx.tracks[0].order,9);assert.equal(audioReads,0);
 const S=require('../safeguards.js'),file=new Blob([new Uint8Array(999)]),fingerprint=await S.fingerprint(file);
 const duplicateSource=app.slice(app.indexOf('          let duplicate=null;'),app.indexOf('          if(duplicate) {'));
 const duplicateContext={SAFE:S,file,fingerprint,candidates:[{id:'bad',blob:badAudio,hidden:true}]};vm.createContext(duplicateContext);
 await vm.runInContext('(async()=>{'+duplicateSource+';this.result=duplicate;})()',duplicateContext);assert.equal(duplicateContext.result,null,'Unreadable trash must not block upload');
 duplicateContext.candidates.push({id:'good',blob:file,fingerprint,audioStorage:'bytes-v1'});
 await vm.runInContext('(async()=>{'+duplicateSource+';this.result=duplicate;})()',duplicateContext);assert.equal(duplicateContext.result.id,'good','Readable byte-backed duplicates remain detected');
 console.log('PASS: batch soft deletion with unreadable audio, membership removal, undo state, retained song edits/order and zero audio reads.');
})().catch(e=>{console.error(e);process.exitCode=1});
