'use strict';
(() => {
  const MAX_TRACK_BYTES=100*1024*1024, MAX_BACKUP_BYTES=1024*1024*1024;
  function checkSize(size,limit,label) {
    if(!Number.isSafeInteger(size)||size<=0)throw new Error('הקובץ ריק או אינו תקין.');
    if(size>limit)throw new Error(label+' גדול מדי. המגבלה היא '+Math.round(limit/1024/1024)+' MB.');
  }
  async function audioBytes(blob) {
    checkSize(blob.size,MAX_TRACK_BYTES,'קובץ השמע');
    const bytes=await blob.arrayBuffer();
    if(bytes.byteLength!==blob.size)throw new Error('קריאת השמע החזירה '+bytes.byteLength+' בתים במקום '+blob.size+'. אין לשמור עותק מהקריאה הזאת; יש לשחזר מהגיבוי המקורי או להוסיף את קובץ המקור.');
    return bytes;
  }
  async function hashBytes(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
  async function fingerprint(blob) {return hashBytes(await audioBytes(blob));}
  async function packAudio(track) {
    if(!track.blob)return track;
    const bytes=await audioBytes(track.blob),fingerprint=await hashBytes(bytes);
    if(track.fingerprint&&track.fingerprint!==fingerprint)throw new Error('השמע של ״'+track.title+'״ אינו תואם לחתימה המקורית. הרשומה לא שונתה.');
    const {blob,...record}=track;
    return {...record,audioBytes:bytes,audioType:blob.type||'application/octet-stream',audioStorage:'bytes-v1',fingerprint};
  }
  function unpackAudio(record) {
    if(!record||!record.audioBytes)return record;
    const {audioBytes:bytes,audioType,...track}=record;
    checkSize(bytes.byteLength,MAX_TRACK_BYTES,'קובץ השמע');
    return {...track,blob:new Blob([bytes],{type:audioType||'application/octet-stream'}),audioStorage:'bytes-v1'};
  }
  async function limitedAudio(response) {
    if(!response.ok)throw new Error('ההורדה נכשלה.');
    const length=Number(response.headers.get('content-length'));
    if(length>MAX_TRACK_BYTES)throw new Error('קובץ השמע גדול מדי. המגבלה היא 100 MB.');
    if(!response.body){const blob=await response.blob();checkSize(blob.size,MAX_TRACK_BYTES,'קובץ השמע');return blob;}
    const reader=response.body.getReader(),chunks=[];let size=0;
    try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_TRACK_BYTES)throw new Error('קובץ השמע גדול מדי. המגבלה היא 100 MB.');chunks.push(part.value);}}
    catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
    checkSize(size,MAX_TRACK_BYTES,'קובץ השמע');return new Blob(chunks,{type:response.headers.get('content-type')||'application/octet-stream'});
  }
  function repairAudio(current, restored) {
    const incoming=new Map(restored.map(t=>[t.id,t]));
    return current.filter(t=>!t.hidden&&incoming.has(t.id)).map(t=>({...t,blob:incoming.get(t.id).blob,fingerprint:incoming.get(t.id).fingerprint}));
  }
  function insertAt(ids,id,index){const out=ids.filter(value=>value!==id);out.splice(Math.min(Math.max(index,0),out.length),0,id);return out;}
  const api={MAX_TRACK_BYTES,MAX_BACKUP_BYTES,checkSize,audioBytes,fingerprint,packAudio,unpackAudio,limitedAudio,repairAudio,insertAt};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else window.LittleSongsSafeguards=api;
})();
