const assert = require('node:assert/strict');
const {encode,decode} = require('../backup.js');
async function main() {
  const source = [
    {id:'local:a',title:'יוֹם הולדת 🎂',icon:'🌈',source:'local',order:5,duration:3,blob:new Blob([new Uint8Array([0,255,1,2,3])],{type:'audio/mpeg'})},
    {id:'catalog:b',title:'חנוכה',icon:'🕎',source:'catalog',file:'songs/song-02.mp3',order:6,duration:1.5,blob:new Blob(['second audio'],{type:'audio/mp4'})}
  ];
  const archive = await encode(source); const result = await decode(archive);
  assert.equal(result.length,2);
  for (let i=0;i<2;i++) {
    for (const key of ['id','title','icon','source','order','duration']) assert.equal(result[i][key],source[i][key]);
    assert.deepEqual(new Uint8Array(await result[i].blob.arrayBuffer()),new Uint8Array(await source[i].blob.arrayBuffer()));
    assert.equal(result[i].blob.type,source[i].blob.type);
  }
  assert.equal(result[1].file,'songs/song-02.mp3');
  assert.equal(result[0].hidden,false); assert.equal(result[0].renamed,true);
  // Truncation, bit corruption, trailing bytes and foreign formats must all fail.
  await assert.rejects(decode(archive.slice(0,archive.size-1)));
  const bytes = new Uint8Array(await archive.arrayBuffer()); bytes[bytes.length-1] ^= 1;
  await assert.rejects(decode(new Blob([bytes])));
  await assert.rejects(decode(new Blob([archive,'extra'])));
  await assert.rejects(decode(new Blob(['not a backup'])));
  await assert.rejects(encode([{...source[0],blob:null}]));
  await assert.rejects(encode([source[0],source[0]]));
  await assert.rejects(encode([{...source[1],file:'songs/../../outside.mp3'}]));
  // Restore only accepts known manifest versions and valid metadata.
  const h = new Uint8Array(await archive.slice(0,12).arrayBuffer());
  const size = new DataView(h.buffer).getUint32(8);
  const manifest = JSON.parse(await archive.slice(12,12+size).text());
  manifest.version=999;
  const json = new TextEncoder().encode(JSON.stringify(manifest));new DataView(h.buffer).setUint32(8,json.length);
  await assert.rejects(decode(new Blob([h,json,archive.slice(12+size)])));
  assert.deepEqual(await decode(await encode([])),[]);
  console.log('PASS: byte-exact audio and Unicode metadata round-trip, corrupt/truncated/foreign archives, duplicate IDs, unsafe paths, unknown versions, empty archive.');
}
main().catch(error=>{console.error(error);process.exit(1)});
