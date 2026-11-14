const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const events=[],urls=new Map();let serial=0,pending=null;
const audio={paused:true,ended:false,currentTime:0,src:'',buffer:'',pause(){this.paused=true;events.push('pause')},removeAttribute(){this.src='';events.push('detach')},getAttribute(){return this.src},load(){this.buffer=this.src;events.push('load:'+this.src)},play(){this.paused=false;events.push('play:'+this.buffer);return pending||Promise.resolve()}};
const tracks=[{id:'a',title:'A',blob:new Blob(['A'])},{id:'b',title:'B',blob:new Blob(['B'])},{id:'c',title:'C',blob:new Blob(['C'])},{id:'remote',title:'Offline',url:'https://example.org/song.wav'}];
const ctx={audio,tracks,playToken:0,objectURL:null,currentId:null,activePlaylistId:'p',queueIds:[],queuePlaylistId:'all',shuffle:false,navigator:{onLine:true},PL:require('../playlists.js'),listed:()=>tracks,render(){},setMediaInfo(){},syncPlayer(){},notify:m=>events.push('notice:'+m),URL:{createObjectURL(blob){const u='blob:test-'+(++serial);urls.set(u,blob);return u},revokeObjectURL(url){assert.notEqual(audio.src,url,'Detach media before revoking its URL');events.push('revoke:'+url);urls.delete(url)}}};
vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  function clearAudioSource('),source.indexOf('  function moveSong(')),ctx);
(async()=>{
 await ctx.playSong('a');const first=audio.src;assert.equal(await urls.get(audio.buffer).text(),'A');
 await ctx.playSong('b');assert.equal(ctx.currentId,'b');assert.equal(await urls.get(audio.buffer).text(),'B');assert.ok(!urls.has(first));
 assert.ok(events.indexOf('detach')<events.indexOf('revoke:'+first));
 const loads=events.filter(e=>e.startsWith('load:')).length;
 await ctx.playSong('b');assert.equal(audio.paused,true);await ctx.playSong('b');assert.equal(audio.paused,false);assert.equal(events.filter(e=>e.startsWith('load:')).length,loads,'Pause/resume must not reset the current song');
 let rejectOld;pending=new Promise((_,reject)=>rejectOld=reject);const old=ctx.playSong('a');pending=null;await ctx.playSong('c');const last=audio.src;rejectOld(Object.assign(new Error('interrupted'),{name:'AbortError'}));await old;assert.equal(ctx.currentId,'c');assert.equal(audio.src,last);assert.equal(await urls.get(audio.buffer).text(),'C','An old play promise must not overwrite a newer choice');
 ctx.navigator.onLine=false;await ctx.playSong('remote');assert.equal(audio.paused,true);assert.equal(audio.src,'');assert.equal(ctx.currentId,null,'Unavailable selection must not leave previous song playing');
 ctx.navigator.onLine=true;await ctx.playSong('a');ctx.resetPlayer();assert.equal(ctx.currentId,null);assert.equal(audio.src,'');assert.equal(urls.size,0);
 console.log('PASS: distinct audio sources, explicit buffer reload, safe URL release, pause/resume, rapid selections, offline failure and reset.');
})().catch(e=>{console.error(e);process.exitCode=1});
