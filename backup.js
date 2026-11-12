'use strict';
// Portable local archive: a small JSON index followed by the original audio bytes.
// No executable content, compression dependency, base64 expansion, or server upload.
(() => {
  const MAGIC = 'LSONGS01';
  const encoder = new TextEncoder();
  const invalid = () => new Error('קובץ הגיבוי אינו תקין או אינו נתמך. הספרייה לא שונתה.');
  async function digest(blob) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(n => n.toString(16).padStart(2,'0')).join('');
  }
  function validateRecord(t) {
    if (!t || typeof t.id !== 'string' || !t.id || t.id.length > 240 || typeof t.title !== 'string' || !t.title.trim() || t.title.length > 180 || typeof t.icon !== 'string' || [...t.icon].length > 24 || !['local','catalog'].includes(t.source) || !Number.isSafeInteger(t.size) || t.size <= 0 || typeof t.type !== 'string' || t.type.length > 160 || !/^[a-f0-9]{64}$/.test(t.sha256)) throw invalid();
    if (t.source === 'catalog' && (typeof t.file !== 'string' || !/^songs\/[a-zA-Z0-9_%./() -]+$/.test(t.file) || t.file.includes('..'))) throw invalid();
    if (!Number.isFinite(t.order) || !Number.isFinite(t.duration) || t.duration < 0) throw invalid();
  }
  async function encode(tracks, progress = () => {}) {
    const records = [], payload = [], seen = new Set();
    for (let i=0;i<tracks.length;i++) {
      const t = tracks[i]; progress(i,tracks.length);
      if (!(t.blob instanceof Blob) || !t.blob.size) throw new Error('יש שירים שעדיין לא נשמרו במכשיר. שמרי את כל השירים לאופליין ואז נסי שוב.');
      const r = {id:t.id,title:t.title,icon:t.icon || '🎵',source:t.source === 'catalog' ? 'catalog' : 'local',file:t.file || '',order:Number.isFinite(t.order) ? t.order : i,duration:Number.isFinite(t.duration) && t.duration > 0 ? t.duration : 0,size:t.blob.size,type:t.blob.type || 'application/octet-stream',sha256:await digest(t.blob)};
      validateRecord(r); if (seen.has(r.id)) throw invalid(); seen.add(r.id);
      records.push(r); payload.push(t.blob);
    }
    progress(tracks.length,tracks.length);
    const manifest = encoder.encode(JSON.stringify({format:'little-songs',version:1,createdAt:new Date().toISOString(),tracks:records}));
    if (manifest.byteLength > 8*1024*1024) throw new Error('הספרייה גדולה מדי לקובץ גיבוי אחד.');
    const header = new ArrayBuffer(12); new Uint8Array(header).set(encoder.encode(MAGIC)); new DataView(header).setUint32(8,manifest.byteLength);
    return new Blob([header,manifest,...payload],{type:'application/octet-stream'});
  }
  async function decode(file, progress = () => {}) {
    if (!(file instanceof Blob) || file.size < 12) throw invalid();
    const header = await file.slice(0,12).arrayBuffer();
    if (new TextDecoder().decode(new Uint8Array(header,0,8)) !== MAGIC) throw invalid();
    const length = new DataView(header).getUint32(8);
    if (!length || length > 8*1024*1024 || 12+length > file.size) throw invalid();
    let manifest; try { manifest = JSON.parse(await file.slice(12,12+length).text()); } catch { throw invalid(); }
    if (!manifest || manifest.format !== 'little-songs' || manifest.version !== 1 || !Array.isArray(manifest.tracks) || manifest.tracks.length > 10000) throw invalid();
    let offset = 12+length; const result = [], seen = new Set();
    for (let i=0;i<manifest.tracks.length;i++) {
      progress(i,manifest.tracks.length); const t = manifest.tracks[i]; validateRecord(t);
      if (seen.has(t.id) || offset+t.size > file.size) throw invalid(); seen.add(t.id);
      const blob = file.slice(offset,offset+t.size,t.type); offset += t.size;
      if (await digest(blob) !== t.sha256) throw new Error('קובץ הגיבוי פגום או לא הורד במלואו. הספרייה לא שונתה.');
      result.push({id:t.id,title:t.title,icon:t.icon,source:t.source,file:t.file,order:t.order,duration:t.duration,blob,hidden:false,renamed:true});
    }
    if (offset !== file.size) throw invalid();
    progress(result.length,result.length); return result;
  }
  const api = {encode,decode};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.LittleSongsBackup = api;
})();
