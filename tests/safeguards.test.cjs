const assert=require('node:assert/strict');
const fs=require('node:fs');
const S=require('../safeguards.js');
const B=require('../backup.js');
(async()=>{
 const first=new Blob(['same audio'],{type:'audio/wav'}), renamed=new Blob(['same audio'],{type:'audio/mp3'});
 assert.equal(await S.fingerprint(first),await S.fingerprint(renamed),'Names and MIME types do not change the content fingerprint');
 assert.notEqual(await S.fingerprint(first),await S.fingerprint(new Blob(['different audio'])));
 assert.throws(()=>S.checkSize(S.MAX_TRACK_BYTES+1,S.MAX_TRACK_BYTES,'audio'));
 await assert.rejects(()=>S.fingerprint({size:S.MAX_TRACK_BYTES+1,arrayBuffer:()=>{throw Error('must not allocate');}}),/100 MB/);
 class HugeBackup extends Blob {get size(){return S.MAX_BACKUP_BYTES+1;}}
 await assert.rejects(()=>B.decodeLibrary(new HugeBackup()),/1024 MB/);
 await assert.rejects(()=>B.encode(Array(10001).fill({})),/10,000/);
 class HugeTrack extends Blob {get size(){return S.MAX_TRACK_BYTES+1;}arrayBuffer(){throw new Error('must reject before allocating');}}
 await assert.rejects(()=>B.encode([{blob:new HugeTrack(['x'])}]),/100 MB/);
 assert.deepEqual(S.insertAt(['a','c'],'b',1),['a','b','c'],'Restore original membership order');
 assert.deepEqual(S.insertAt(['a','b','c'],'b',0),['b','a','c'],'Never duplicate membership');
 assert.deepEqual(S.insertAt(['a'],'b',999),['a','b']);
 const body=new Blob(['test audio'],{type:'audio/wav'});
 assert.equal(await (await S.limitedAudio(new Response(body))).text(),'test audio');
 await assert.rejects(()=>S.limitedAudio(new Response('x',{headers:{'content-length':String(S.MAX_TRACK_BYTES+1)}})),/100 MB/);
 const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
 assert.ok(html.includes('Content-Security-Policy'));
 const version=JSON.parse(fs.readFileSync(require.resolve('../version.json'),'utf8')).version;
 assert.ok(fs.readFileSync(require.resolve('../app.js'),'utf8').includes("APP_VERSION='"+version+"'"));
 console.log('PASS: content duplicate hashes, allocation limits, bounded downloads, ordered recovery, CSP and release version consistency.');
})().catch(e=>{console.error(e);process.exitCode=1;});
