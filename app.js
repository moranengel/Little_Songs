'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const audio = $('audio');
  const icons = ['🐻','🐰','🐸','🐳','🦁','🦋','🐥','🐼','🐶','🐱','🐘','🦄','🚂','🚗','⭐','🌈','🌙','☀️','🌸','🎵'];
  const colors = ['#ffe3cd','#f7dde9','#ddeed5','#d9edf8','#fff0be','#e8dff8'];
  let db, tracks = [], currentId = null, objectURL = null, editing = false;
  let editingId = null, pickedIcon = '', operation = false, shellReady = false, scrubbing = false;
  let noticeTimer, playToken = 0;
  let backupState = {revision:0,savedRevision:0,lastConfirmedAt:0};
  let preparedBackup = null, offeredBackup = null, preparationTimer, preparationToken = 0, preparing = false, backupError = '', dismissedRevision = -1;
  const visible = () => tracks.filter(t => !t.hidden).sort((a,b) => a.order-b.order || a.id.localeCompare(b.id));
  const searchKey = text => text.normalize('NFKD').replace(/[\u0591-\u05c7]/g,'').toLocaleLowerCase('he').trim();
  const matchesSearch = track => searchKey(track.title).includes(searchKey($('song-search').value));
  const current = () => tracks.find(t => t.id === currentId);
  const hash = str => [...str].reduce((h,c) => (h*31+c.codePointAt(0))>>>0,0);
  const iconFor = t => t.icon || icons[hash(t.id)%8];
  const time = n => { n = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; return Math.floor(n/60)+':'+String(n%60).padStart(2,'0'); };
  const message = error => error?.name === 'QuotaExceededError' ? 'אין מספיק מקום פנוי לשמירה. פנו מקום באייפון ונסו שוב.' : error?.message || String(error);
  function notify(text) { clearTimeout(noticeTimer); $('notice').textContent = text; $('notice').hidden = false; noticeTimer = setTimeout(() => $('notice').hidden = true,6000); }
  function openDB() {
    return new Promise((resolve,reject) => {
      const request = indexedDB.open('little-songs-web-v1',1);
      request.onupgradeneeded = () => { request.result.createObjectStore('tracks',{keyPath:'id'}); request.result.createObjectStore('meta',{keyPath:'key'}); };
      request.onsuccess = () => { const result = request.result; result.onversionchange = () => result.close(); resolve(result); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('סגרי חלונות אחרים של הנגן ונסי שוב.'));
    });
  }
  function read(store, key) {
    return new Promise((resolve,reject) => {
      const tx = db.transaction(store,'readonly'); const request = key === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  function write(store, entries, deletions = [], changed = false) {
    return new Promise((resolve,reject) => {
      const tx = db.transaction(changed ? [store,'meta'] : store,'readwrite'); const table = tx.objectStore(store);
      if (changed) {
        const meta = tx.objectStore('meta'); const stateRequest = meta.get('backupState');
        stateRequest.onsuccess = () => {
          const old = stateRequest.result?.value || {revision:0,savedRevision:0,lastConfirmedAt:0};
          meta.put({key:'backupState',value:{...old,revision:old.revision+1}});
        };
      }
      entries.forEach(entry => table.put(entry)); deletions.forEach(key => table.delete(key));
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('השמירה לא הושלמה.'));
    });
  }
  async function reload() {
    tracks = await read('tracks');
    const stored = await read('meta','backupState');
    backupState = stored?.value || {revision:tracks.length ? 1 : 0,savedRevision:0,lastConfirmedAt:0};
    if (!stored && tracks.length) await write('meta',[{key:'backupState',value:backupState}]);
    if (preparedBackup && preparedBackup.revision !== backupState.revision) preparedBackup = null;
    render(); scheduleBackup();
  }
  async function busy(task) {
    if (operation) return;
    operation = true; document.querySelectorAll('.parent-actions button,#import,#edit-form button,#backup-import').forEach(b => b.disabled = true);
    try { await task(); } catch(error) { if ($('parents').open) backupError = message(error); notify(message(error)); }
    finally { operation = false; document.querySelectorAll('.parent-actions button,#import,#edit-form button,#backup-import').forEach(b => b.disabled = false); renderBackup(); }
  }
  function validateCatalog(data) {
    if (!data || !Array.isArray(data.songs)) throw new Error('רשימת השירים באתר אינה תקינה.');
    const seen = new Set();
    return data.songs.map((s,index) => {
      if (typeof s.id !== 'string' || !s.id || seen.has(s.id) || typeof s.file !== 'string' || typeof s.title !== 'string') throw new Error('פרטי השירים באתר אינם תקינים.');
      const url = new URL(s.file, location.href); const base = new URL('./',location.href);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname+'songs/')) throw new Error('קובץ שיר חייב להיות בתיקיית songs של האתר.');
      seen.add(s.id);
      return {id:'catalog:'+s.id,title:s.title.slice(0,180),url:url.href,source:'catalog',defaultIcon: typeof s.icon === 'string' ? s.icon : '',duration:Number(s.duration)||0,order:index};
    });
  }
  async function refreshCatalog(silent = false) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(),10000);
    try {
      const response = await fetch('./songs.json',{cache:'no-cache',signal:controller.signal});
      if (!response.ok) throw new Error('לא ניתן לטעון את רשימת השירים מהאתר.');
      const catalog = validateCatalog(await response.json()); const previous = new Map((await read('tracks')).map(t => [t.id,t]));
      const updates = catalog.map(t => {
        const old = previous.get(t.id);
        return old ? {...old,url:t.url,order:t.order,duration:t.duration,title:old.renamed ? old.title : t.title} : {...t,icon:t.defaultIcon,hidden:false};
      });
      const changed = updates.some(t => {const old=previous.get(t.id);return !old || t.title!==old.title || t.icon!==old.icon || t.order!==old.order;});
      await write('tracks',updates,[],changed); await write('meta',[{key:'catalogUpdated',value:Date.now()}]);
      await reload(); if (!silent) notify('רשימת השירים עודכנה. השינויים האישיים שלך נשמרו.');
    } catch(error) {
      if (!tracks.length) notify('לא ניתן לבדוק שירים באתר כרגע. אפשר להוסיף שירים מהמכשיר.');
      else if (!silent) notify('אין חיבור לאתר כרגע. הספרייה המקומית נשארה זמינה.');
    } finally { clearTimeout(timeout); }
  }
  function setMediaInfo(track) {
    if ('mediaSession' in navigator && 'MediaMetadata' in window) {
      try { navigator.mediaSession.metadata = new MediaMetadata({title:track.title,artist:'השירים הקטנים שלנו',artwork:[{src:new URL('./icons/icon-512.png',location.href).href,sizes:'512x512',type:'image/png'}]}); } catch {}
    }
  }
  function resetPlayer() {
    playToken++; audio.pause(); audio.removeAttribute('src'); audio.load(); currentId = null;
    if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; }
    syncPlayer();
  }
  async function playSong(id, toggle = true) {
    const track = tracks.find(t => t.id === id && !t.hidden); if (!track) return;
    const token = ++playToken;
    try {
      if (currentId === id && audio.getAttribute('src')) {
        if (toggle && !audio.paused) { audio.pause(); return; }
        if (audio.ended) audio.currentTime = 0;
      } else {
        if (!track.blob && navigator.onLine === false) { notify('השיר הזה עדיין לא נשמר לאופליין. התחברי לאינטרנט ושמרי אותו דרך האזור להורים.'); return; }
        audio.pause();
        if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; }
        currentId = id;
        if (track.blob) { objectURL = URL.createObjectURL(track.blob); audio.src = objectURL; }
        else audio.src = track.url;
        setMediaInfo(track); render();
      }
      await audio.play();
    } catch(error) { if (token === playToken && error.name !== 'AbortError') notify('לא ניתן לנגן את השיר. בדקי את החיבור או נסי קובץ שמע אחר.'); }
    syncPlayer();
  }
  function moveSong(offset) {
    const list = visible(); if (!list.length) return;
    const index = list.findIndex(t => t.id === currentId); const target = Math.max(0,Math.min(list.length-1,index+offset));
    return playSong(list[target].id,false);
  }
  function syncPlayer() {
    const track = current(); const list = visible();
    $('now-title').textContent = track?.title || 'בוחרים ומקשיבים';
    $('now-icon').textContent = track ? iconFor(track) : '🧸';
    $('now-label').textContent = track ? 'השיר שבחרנו' : 'איזה שיר נשמע היום?';
    const isPlaying = !!track && !audio.paused && !audio.ended;
    $('play').textContent = isPlaying ? 'Ⅱ' : '▶︎'; $('play').setAttribute('aria-label',isPlaying ? 'השהיה' : 'ניגון'); $('play').disabled = !list.length;
    $('play-state').textContent = !track ? 'קצת מוזיקה, המון שמחה' : audio.error ? 'לא ניתן לנגן את הקובץ' : audio.ended ? 'איזה כיף לשיר ביחד' : isPlaying ? 'שרים ביחד 🎶' : 'מוכנים להמשיך?';
    const duration = Number.isFinite(audio.duration) ? audio.duration : track?.duration || 0;
    $('elapsed').textContent = time(audio.currentTime); $('duration').textContent = time(duration);
    $('seek').disabled = !track || !duration; $('seek').max = String(Math.max(1,duration));
    if (!scrubbing) $('seek').value = String(Math.min(audio.currentTime || 0,Math.max(1,duration)));
    const index = list.findIndex(t => t.id === currentId); $('previous').disabled = list.length < 2 || index <= 0; $('next').disabled = list.length < 2 || index >= list.length-1;
    document.querySelectorAll('.song-card').forEach(card => {
      const active = card.dataset.id === currentId; card.classList.toggle('active',active);
      const button = card.querySelector('.song-main'); button.querySelector('.song-play').textContent = active && isPlaying ? 'Ⅱ' : '▶︎';
      const item = tracks.find(t => t.id === card.dataset.id);
      if (item) button.setAttribute('aria-label',(active && isPlaying ? 'השהיית ' : 'ניגון ')+item.title);
    });
  }
  function render() {
    const all = visible(); const list = all.filter(matchesSearch); $('song-list').replaceChildren(); $('empty').hidden = !!all.length; $('no-results').hidden = !all.length || !!list.length; $('count').textContent = list.length === all.length ? all.length+' שירים' : list.length+' מתוך '+all.length;
    for (const track of list) {
      const card = document.createElement('div'); card.className = 'song-card'; card.dataset.id = track.id; card.style.backgroundColor = colors[hash(track.id)%colors.length];
      const button = document.createElement('button'); button.className = 'song-main'; button.type = 'button';
      const animal = document.createElement('span'); animal.className = 'song-animal'; animal.textContent = iconFor(track); animal.setAttribute('aria-hidden','true');
      const copy = document.createElement('span'); copy.className = 'song-copy';
      const name = document.createElement('span'); name.className = 'song-name'; name.textContent = track.title;
      const caption = document.createElement('span'); caption.className = 'song-caption'; caption.textContent = track.blob ? '✓ שמור באייפון' : '☁ להאזנה דרך האינטרנט';
      copy.append(name,caption); const play = document.createElement('span'); play.className = 'song-play'; play.textContent = '▶︎'; play.setAttribute('aria-hidden','true');
      button.append(animal,copy,play); button.addEventListener('click',() => editing ? editSong(track.id) : playSong(track.id)); card.append(button);
      if (editing) { const edit = document.createElement('button'); edit.className = 'edit-song'; edit.textContent = '✎'; edit.setAttribute('aria-label','עריכת '+track.title); edit.addEventListener('click',() => editSong(track.id)); card.append(edit); }
      $('song-list').append(card);
    }
    $('restore').hidden = !tracks.some(t => t.hidden);
    $('edit-toggle').textContent = editing ? 'סיום עריכה' : 'עריכת שירים'; $('edit-toggle').setAttribute('aria-pressed',String(editing));
    const saved = all.filter(t => t.blob).length;
    $('offline-status').textContent = (shellReady ? '✓ הממשק מוכן לאופליין' : 'הממשק עדיין לא אושר לאופליין')+' · '+saved+' מתוך '+all.length+' שירים שמורים';
    syncPlayer(); renderBackup();
  }
  async function requestPersistence() { try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch {} }
  async function importFiles(files) {
    if (!files.length) return;
    await busy(async () => {
      await requestPersistence(); let added = 0; const failed = [];
      for (const file of files) {
        try {
          if (!(file.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|aif|aiff|flac|caf|ogg|mp4)$/i.test(file.name))) throw new Error('סוג קובץ לא נתמך');
          if (!file.size) throw new Error('הקובץ ריק');
          const id = 'local:'+(crypto.randomUUID ? crypto.randomUUID() : Date.now()+'-'+Math.random().toString(36).slice(2));
          await write('tracks',[{id,title:file.name.replace(/\.[^.]+$/,'').slice(0,180),source:'local',blob:file,hidden:false,order:Date.now()+added}],[],true); added++;
        } catch(error) { failed.push(file.name+': '+message(error)); }
      }
      await reload(); notify('נוספו '+added+' שירים לאייפון'+(failed.length ? '. חלק מהקבצים לא נשמרו.' : ''));
      $('download-progress').textContent = failed.join(' | '); $('files').value = '';
    });
  }
  async function downloadAll() {
    await busy(async () => {
      await requestPersistence();
      if (!shellReady) throw new Error('חכי להכנת הממשק לאופליין ונסי שוב. נדרש אתר מאובטח ב־HTTPS.');
      const pending = visible().filter(t => t.source === 'catalog' && !t.blob); let done = 0; const failures = [];
      for (const track of pending) {
        $('download-progress').textContent = 'שומרים '+(done+failures.length+1)+' מתוך '+pending.length+' · '+track.title;
        try {
          const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(),90000);
          let response, blob;
          try { response = await fetch(track.url,{signal:controller.signal}); if (!response.ok) throw new Error('ההורדה נכשלה'); blob = await response.blob(); } finally { clearTimeout(timeout); }
          if (!blob.size || blob.type.includes('text/html')) throw new Error('קובץ שמע לא תקין');
          const latest = await read('tracks',track.id); if (!latest || latest.hidden) continue;
          await write('tracks',[{...latest,blob}],[],true); done++; await reload();
        } catch(error) { failures.push(track.title+': '+message(error)); }
      }
      $('download-progress').textContent = failures.length ? failures.join(' | ') : pending.length ? 'השמירה הסתיימה. אפשר לבדוק במצב טיסה 🎉' : 'כל השירים הגלויים כבר שמורים באייפון ✓';
      notify(failures.length ? 'חלק מהשירים לא נשמרו. אפשר לנסות שוב — שירים שכבר נשמרו לא יורדו מחדש.' : 'השירים מוכנים להאזנה ללא אינטרנט');
    });
  }
  function markIcon(value) { pickedIcon = value; $('custom-icon').value = value; document.querySelectorAll('.icon-option').forEach(b => { const selected = b.textContent === value; b.classList.toggle('selected',selected); b.setAttribute('aria-pressed',String(selected)); }); }
  function editSong(id) {
    const track = tracks.find(t => t.id === id); if (!track) return;
    editingId = id; $('song-name').value = track.title; $('icon-options').replaceChildren();
    for (const icon of icons) { const b = document.createElement('button'); b.type = 'button'; b.className = 'icon-option'; b.textContent = icon; b.setAttribute('aria-label','בחירת '+icon); b.addEventListener('click',() => markIcon(icon)); $('icon-options').append(b); }
    markIcon(iconFor(track)); $('edit-dialog').showModal();
  }
  async function saveEdit(event) {
    event.preventDefault(); await busy(async () => {
      const track = await read('tracks',editingId); if (!track) throw new Error('השיר אינו נמצא עוד בספרייה.');
      const title = $('song-name').value.trim(); const icon = $('custom-icon').value.trim() || pickedIcon;
      if (!title) throw new Error('הזיני שם לשיר.');
      if ([...icon].length > 24) throw new Error('בחרי אימוג׳י אחד או סמל קצר.');
      await write('tracks',[{...track,title,icon,renamed:true}],[],title!==track.title || icon!==iconFor(track)); await reload();
      if (currentId === track.id) setMediaInfo({...track,title}); $('edit-dialog').close(); notify('השם והאייקון נשמרו');
    });
  }
  async function deleteSong() {
    const track = tracks.find(t => t.id === editingId); if (!track || !confirm('למחוק את ״'+track.title+'״ מהספרייה במכשיר הזה? קובץ המקור נשאר במקומו.')) return;
    await busy(async () => {
      if (currentId === track.id) resetPlayer();
      if (track.source === 'local') await write('tracks',[],[track.id],true);
      else { const record = {...track,hidden:true}; delete record.blob; await write('tracks',[record],[],true); }
      await reload(); $('edit-dialog').close(); notify('השיר הוסר מהמכשיר');
    });
  }
  function renderBackup() {
    const dirty = backupState.revision > backupState.savedRevision;
    const all = visible(); const missing = all.filter(t => !t.blob).length;
    $('backup-reminder').hidden = !dirty || dismissedRevision === backupState.revision;
    $('backup-reminder-text').textContent = preparing ? 'מכינים גיבוי לשינויים האחרונים…' : offeredBackup ? 'בחרת לשמור גיבוי? אשרי לאחר השמירה ב״קבצים״' : 'יש שינויים שעדיין לא גובו בקובץ';
    $('backup-status').textContent = dirty ? 'יש שינויים מאז הגיבוי האחרון שאישרת.' : backupState.lastConfirmedAt ? 'אישרת שמירת גיבוי ב־'+new Date(backupState.lastConfirmedAt).toLocaleString('he-IL') : 'עדיין לא אושרה שמירת גיבוי בקובץ.';
    const ready = preparedBackup?.revision === backupState.revision;
    $('backup-save').textContent = preparing ? 'מכינים את קובץ הגיבוי…' : ready ? 'שמירת קובץ הגיבוי' : 'הכנת גיבוי';
    $('backup-save').disabled = operation || preparing || !all.length || !!missing;
    $('backup-confirm').hidden = !offeredBackup;
    $('backup-confirm').disabled = operation;
    if (backupError) $('backup-progress').textContent = backupError;
    else if (missing) $('backup-progress').textContent = missing+' שירים עדיין לא זמינים לגיבוי. לחצי על ״שמירת כל השירים לאופליין״ ואז נכין גיבוי מלא.';
    else if (ready && !offeredBackup) $('backup-progress').textContent = 'הקובץ מוכן: '+all.length+' שירים · '+(preparedBackup.file.size/1024/1024).toFixed(1)+' MB. לחצי לשמירה ובחרי ״שמירה בקבצים״.';
    else if (!preparing && !offeredBackup) $('backup-progress').textContent = all.length ? 'הגיבוי נשמר כקובץ עם הסיומת little-songs. לאחר שמירתו אפשר לשחזר גם ללא אינטרנט.' : 'הוסיפי שירים כדי ליצור גיבוי.';
  }
  function scheduleBackup() {
    clearTimeout(preparationTimer);
    // Only prepare locally while the app is open; never launch downloads automatically.
    if (backupState.revision <= backupState.savedRevision || !visible().length || visible().some(t => !t.blob) || preparedBackup?.revision === backupState.revision) return;
    preparationTimer = setTimeout(() => prepareBackup(),700);
  }
  async function prepareBackup() {
    clearTimeout(preparationTimer);
    const token = ++preparationToken; const revision = backupState.revision;
    preparing = true; backupError = ''; renderBackup();
    try {
      const all = visible().map(t => {
        let file = '';
        if (t.source === 'catalog') {
          const url = new URL(t.url || t.file,location.href); const base = new URL('./',location.href);
          if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname+'songs/')) throw new Error('כתובת השיר אינה תקינה.');
          file = url.pathname.slice(base.pathname.length);
        }
        return {...t,icon:iconFor(t),file};
      });
      const blob = await LittleSongsBackup.encode(all,(done,total) => {
        if (token !== preparationToken || revision !== backupState.revision) throw new DOMException('הספרייה השתנתה','AbortError');
        $('backup-progress').textContent = 'מכינים גיבוי: '+done+' מתוך '+total+' שירים';
      });
      if (token !== preparationToken || revision !== backupState.revision) return;
      const stamp = new Date().toISOString().replace(/[:.]/g,'-');
      preparedBackup = {revision,file:new File([blob],'Little-Songs-'+stamp+'.little-songs',{type:'application/octet-stream'})};
    } catch(error) { if (token === preparationToken && error.name !== 'AbortError') backupError = 'לא ניתן להכין גיבוי: '+message(error); }
    finally { if (token === preparationToken) { preparing = false; renderBackup(); } }
  }
  async function saveBackup() {
    if (operation || preparing) return;
    if (!preparedBackup || preparedBackup.revision !== backupState.revision) { await prepareBackup(); return; }
    // This runs directly from the user's click, so Safari can open its share sheet.
    const snapshot = preparedBackup;
    try {
      if (navigator.canShare?.({files:[snapshot.file]}) && navigator.share) {
        await navigator.share({files:[snapshot.file],title:'גיבוי השירים שלנו'});
      } else {
        const url = URL.createObjectURL(snapshot.file); const link = document.createElement('a');
        link.href = url; link.download = snapshot.file.name; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url),60000);
      }
      offeredBackup = snapshot;
      $('backup-progress').textContent = 'בחרי ״שמירה בקבצים״ ושמרי באייפון או ב־iCloud Drive. רק לאחר שהקובץ נשמר לחצי ״שמרתי את הקובץ״.';
      renderBackup();
    } catch(error) { if (error.name !== 'AbortError') notify('לא ניתן לפתוח שמירה: '+message(error)); }
  }
  async function confirmBackup() {
    if (!offeredBackup) return;
    const revision = offeredBackup.revision;
    await busy(async () => {
      await new Promise((resolve,reject) => {
        const tx = db.transaction('meta','readwrite'); const table = tx.objectStore('meta'); const request = table.get('backupState');
        request.onsuccess = () => {
          const latest = request.result?.value || backupState;
          table.put({key:'backupState',value:{...latest,savedRevision:Math.max(latest.savedRevision,revision),lastConfirmedAt:Date.now()}});
        };
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
      offeredBackup = null; await reload(); notify('אישור שמירת הגיבוי נרשם');
    });
  }
  async function restoreBackup(file) {
    if (!file) return;
    await busy(async () => {
      backupError = '';
      $('backup-progress').textContent = 'בודקים את קובץ הגיבוי…';
      const restored = await LittleSongsBackup.decode(file,(done,total) => { $('backup-progress').textContent = 'בדיקת הגיבוי: '+done+' מתוך '+total+' שירים'; });
      if (!restored.length) throw new Error('קובץ הגיבוי אינו מכיל שירים.');
      if (!confirm('לשחזר '+restored.length+' שירים מהגיבוי? שירים עם אותו מזהה יעודכנו, כולל השם והאייקון. שירים אחרים שכבר קיימים בנגן יישארו.')) return;
      await requestPersistence();
      const entries = restored.map(t => t.source === 'catalog' ? {...t,url:new URL(t.file,new URL('./',location.href)).href} : t);
      // All bytes and checksums have been validated before this single atomic write.
      await write('tracks',entries,[],true); resetPlayer();
      offeredBackup = null; preparedBackup = null; $('song-search').value = ''; await reload();
      notify('שוחזרו '+entries.length+' שירים, כולל השמות והאייקונים');
    });
    $('backup-file').value = '';
  }
  async function setupOffline() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) { $('download-progress').textContent = 'להתקנה ולאופליין יש לפתוח את האתר דרך כתובת HTTPS, ולא כקובץ מקומי.'; return; }
    try {
      const existing = await navigator.serviceWorker.getRegistration('./');
      if (existing?.active) { shellReady = true; render(); }
      await navigator.serviceWorker.register('./sw.js',{scope:'./'});
      await navigator.serviceWorker.ready; shellReady = true; render();
    } catch { if (!shellReady) $('download-progress').textContent = 'הממשק לא נשמר לאופליין. נסי לרענן כשהאינטרנט מחובר.'; }
  }
  $('backup-save').addEventListener('click',saveBackup);
  $('backup-confirm').addEventListener('click',confirmBackup);
  $('backup-import').addEventListener('click',() => { if (!operation) $('backup-file').click(); });
  $('backup-file').addEventListener('change',() => restoreBackup($('backup-file').files[0]));
  $('backup-reminder-open').addEventListener('click',() => { $('parents').showModal(); $('parents-toggle').setAttribute('aria-expanded','true'); $('backup-title').scrollIntoView({block:'start'}); });
  $('backup-reminder-dismiss').addEventListener('click',() => { dismissedRevision = backupState.revision; renderBackup(); });
  $('play').addEventListener('click',() => { const t = current() || visible()[0]; if (t) playSong(t.id); });
  $('previous').addEventListener('click',() => moveSong(-1)); $('next').addEventListener('click',() => moveSong(1));
  $('seek').addEventListener('input',() => { scrubbing = true; $('elapsed').textContent = time(Number($('seek').value)); });
  $('seek').addEventListener('change',() => { if (current() && Number.isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration,Math.max(0,Number($('seek').value))); scrubbing = false; syncPlayer(); });
  for (const name of ['play','pause','ended','timeupdate','loadedmetadata','durationchange','emptied']) audio.addEventListener(name,syncPlayer);
  audio.addEventListener('error',() => { if (currentId) { syncPlayer(); notify('לא ניתן לנגן את השיר. נסי להוריד אותו לאופליין או לבחור קובץ אחר.'); } });
  $('parents-toggle').addEventListener('click',() => { $('parents').showModal(); $('parents-toggle').setAttribute('aria-expanded','true'); });
  $('parents-close').addEventListener('click',() => $('parents').close());
  $('parents').addEventListener('close',() => $('parents-toggle').setAttribute('aria-expanded','false'));
  $('search-toggle').addEventListener('click',() => {
    const open = $('search-box').hidden; $('search-box').hidden = !open;
    $('search-toggle').setAttribute('aria-expanded',String(open));
    if (open) $('song-search').focus();
    else { $('song-search').value = ''; render(); }
  });
  $('song-search').addEventListener('input',() => { render(); document.querySelector('.library-scroll').scrollTop = 0; });
  $('search-clear').addEventListener('click',() => { $('song-search').value = ''; render(); $('song-search').focus(); });
  $('edit-toggle').addEventListener('click',() => { editing = !editing; render(); if (editing) $('parents').close(); });
  $('import').addEventListener('click',() => $('files').click()); $('files').addEventListener('change',() => importFiles([...$('files').files]));
  $('download-all').addEventListener('click',downloadAll); $('refresh').addEventListener('click',() => busy(() => refreshCatalog()));
  $('restore').addEventListener('click',() => busy(async () => { await write('tracks',tracks.filter(t => t.hidden).map(t => ({...t,hidden:false})),[],true); await reload(); notify('השירים חזרו לרשימה. להאזנה אופליין יש לשמור אותם שוב.'); }));
  $('edit-form').addEventListener('submit',saveEdit); $('delete-song').addEventListener('click',deleteSong); $('edit-close').addEventListener('click',() => $('edit-dialog').close());
  $('custom-icon').addEventListener('input',() => { pickedIcon = $('custom-icon').value; });
  if ('mediaSession' in navigator) { for (const [action,handler] of Object.entries({play:() => {const t=current();if(t)playSong(t.id,false);},pause:()=>audio.pause(),previoustrack:()=>moveSong(-1),nexttrack:()=>moveSong(1),seekto:details=>{if(Number.isFinite(details.seekTime)) audio.currentTime=details.seekTime;}})) try { navigator.mediaSession.setActionHandler(action,handler); } catch {} }
  window.addEventListener('online',() => { notify('החיבור חזר. אפשר לשמור עוד שירים לאופליין.'); });
  async function start() {
    try { db = await openDB(); await reload(); setupOffline(); await refreshCatalog(true); }
    catch(error) { $('fatal').hidden = false; $('fatal').textContent = 'לא ניתן לפתוח את האחסון המקומי. נסי לפתוח בספארי מחוץ לגלישה פרטית. '+message(error); }
  }
  start();
})();
