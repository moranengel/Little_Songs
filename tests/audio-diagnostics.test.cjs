const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const fields=Object.fromEntries(['audio-diagnostics-again','audio-diagnostics-status','audio-diagnostics-report'].map(id=>[id,{textContent:'',disabled:false}]));
const tracks=[{id:'a',title:'First',blob:new Blob(['A']),fingerprint:'A'},{id:'b',title:'Second',blob:new Blob(['B']),fingerprint:'B'}];
let loaded=tracks[0].blob,writes=0;
const ctx={$:id=>fields[id],APP_VERSION:'test',current:()=>tracks[1],currentId:'b',playToken:1,audio:{currentSrc:'blob:active',paused:false,duration:20},time:n=>String(n),visible:()=>tracks,SAFE:{fingerprint:b=>b.text()},read:async(_s,id)=>tracks.find(t=>t.id===id),write(){writes++},fetch:async()=>({ok:true,blob:async()=>loaded}),message:e=>e.message};
vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  let checkingAudio=false;'),source.indexOf("  $('check-audio').addEventListener")),ctx);
(async()=>{
 await ctx.checkAudioDiagnostics();assert.match(fields['audio-diagnostics-report'].textContent,/אינו תואם/,'Detect source/selection mismatch');assert.match(fields['audio-diagnostics-report'].textContent,/Second/);
 loaded=tracks[1].blob;await ctx.checkAudioDiagnostics();assert.ok(!fields['audio-diagnostics-report'].textContent.includes('אינו תואם'));assert.match(fields['audio-diagnostics-report'].textContent,/תואם לשיר שנבחר/);
 tracks[0].fingerprint='expected-other';tracks.push({...tracks[0],id:'copy',title:'Copy'});await ctx.checkAudioDiagnostics();assert.match(fields['audio-diagnostics-report'].textContent,/שונה מהחתימה/);assert.match(fields['audio-diagnostics-report'].textContent,/First \/ Copy/);assert.equal(writes,0,'Diagnostics never write library data');assert.equal(fields['audio-diagnostics-again'].disabled,false);
 console.log('PASS: source mismatch, matching source, altered stored bytes, identical records and read-only diagnostics.');
})().catch(e=>{console.error(e);process.exitCode=1});
