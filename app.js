'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const audio = $('audio');
  const SAFE=LittleSongsSafeguards, APP_VERSION='2026.11.14.1';
  let childMode=false, adultUnlocked=false, gateAction=null, gateAnswer=0, trash=[], lastUndoId=null, undoTimer;
  let drawerOrdering=false, drawerDraft=[], drawerDrag=null, lastUndoMembership=null;
  let checkingUpdate=false, bulkSelecting=false, selectedSongIds=new Set(), assignIds=[], draftPlaylistId=null, draftSortMode='manual', lastUndoIds=[];
  const PL = LittleSongsPlaylists;
  let playlists = [], activePlaylistId = 'all', librarySort = 'manual';
  let queueIds = [], queuePlaylistId = 'all', shuffle = false, repeat = 'off';
  let playlistEditingId = null, draftTrackIds = new Set(), importTargetId = 'all';
  let draftOrdering = false, draftOrderChanged = false, draftDrag = null;
  const icons = ['🐻','🐰','🐸','🐳','🦁','🦋','🐥','🐼','🐶','🐱','🐘','🦄','🚂','🚗','⭐','🌈','🌙','☀️','🌸','🎵'];
  const colors = ['#ffe3cd','#f7dde9','#ddeed5','#d9edf8','#fff0be','#e8dff8'];
  let db, tracks = [], currentId = null, objectURL = null, editing = false;
  let editingId = null, pickedIcon = '', operation = false, shellReady = false, scrubbing = false;
  let noticeTimer, playToken = 0;
  let backupState = {revision:0,savedRevision:0,lastConfirmedAt:0};
  let preparedBackup = null, offeredBackup = null, preparationTimer, preparationToken = 0, preparing = false, backupError = '';
  const visible = () => PL.select(tracks,null,librarySort);
  const activePlaylist = () => playlists.find(p=>p.id===activePlaylistId);
  const listed = () => PL.select(tracks,activePlaylist(),librarySort);
  const playlistName = id => id==='all' ? 'כל השירים' : playlists.find(p=>p.id===id)?.name || 'פלייליסט שנמחק';
  function playableQueue() { const p = playlists.find(p=>p.id===queuePlaylistId); const allowed = new Set((queuePlaylistId==='all' ? visible() : p ? PL.select(tracks,p) : []).map(t=>t.id)); return queueIds.filter(id=>allowed.has(id)); }
  const searchKey = text => text.normalize('NFKD').replace(/[\u0591-\u05c7]/g,'').toLocaleLowerCase('he').trim();
  const matchesSearch = track => searchKey(track.title).includes(searchKey($('song-search').value));
  const current = () => tracks.find(t => t.id === currentId);
  const hash = str => [...str].reduce((h,c) => (h*31+c.codePointAt(0))>>>0,0);
  const iconFor = t => t.icon || icons[hash(t.id)%8];
  const time = n => { n = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; return Math.floor(n/60)+':'+String(n%60).padStart(2,'0'); };
  const message = error => error?.name === 'QuotaExceededError' ? 'אין מספיק מקום פנוי לשמירה. פנו מקום באייפון ונסו שוב.' : error?.message || String(error);
  function notify(text, duration=6000) { clearTimeout(noticeTimer); $('notice').textContent = text; $('notice').hidden = false; noticeTimer = setTimeout(() => $('notice').hidden = true,duration); }
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
      request.onsuccess = () => {try{const result=request.result;resolve(store==='tracks'?(Array.isArray(result)?result.map(SAFE.unpackAudio):SAFE.unpackAudio(result)):result);}catch(error){reject(error);}}; request.onerror = () => reject(request.error);
    }).then(async result=>{if(store!=='tracks'||result===undefined)return result;const metadata=await read('meta');const records=applySongEdits(Array.isArray(result)?result:[result],metadata);return Array.isArray(result)?records:records[0];});
  }
  async function write(store, entries, deletions = [], changed = false, extraMeta = []) {
    // Materialize all audio before opening the transaction; persist bytes, never Blob handles.
    const storedEntries=[];for(const entry of entries)storedEntries.push(store==='tracks'?await SAFE.packAudio(entry):entry);
    return new Promise((resolve,reject) => {
      const tx = db.transaction(changed || extraMeta.length ? [...new Set([store,'meta'])] : store,'readwrite'); const table = tx.objectStore(store);
      if (changed) {
        const meta = tx.objectStore('meta'); const stateRequest = meta.get('backupState');
        stateRequest.onsuccess = () => {
          const old = stateRequest.result?.value || {revision:0,savedRevision:0,lastConfirmedAt:0};
          meta.put({key:'backupState',value:{...old,revision:old.revision+1}});
        };
      }
      storedEntries.forEach(entry => table.put(entry)); deletions.forEach(key => table.delete(key));
      if (extraMeta.length) extraMeta.forEach(entry=>tx.objectStore('meta').put(entry));
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('השמירה לא הושלמה.'));
    });
  }
  function applySongEdits(records, metadata) {
    const edits=new Map(metadata.filter(item=>item.key.startsWith('songEdit:')&&item.value&&typeof item.value.title==='string'&&typeof item.value.icon==='string').map(item=>[item.key.slice(9),item.value]));
    const states=new Map(metadata.filter(item=>item.key.startsWith('trackState:')&&item.value).map(item=>[item.key.slice(11),item.value]));
    return records.map(track=>{const edit=edits.get(track.id),state=states.get(track.id),patch={};
      if(typeof state?.hidden==='boolean')patch.hidden=state.hidden;
      if(typeof state?.trashPurged==='boolean')patch.trashPurged=state.trashPurged;
      if(Number.isFinite(state?.order))patch.order=state.order;
      return {...track,...(edit?{title:edit.title,icon:edit.icon,renamed:true}:{}),...patch};
    });
  }
  async function updateTrackState(records, extraMeta=[], changed=true) {
    const entries=[];
    for(const record of records){
      const key='trackState:'+record.id,old=(await read('meta',key))?.value||{},patch={};
      if(typeof record.hidden==='boolean')patch.hidden=record.hidden;
      if(typeof record.trashPurged==='boolean')patch.trashPurged=record.trashPurged;
      if(Number.isFinite(record.order))patch.order=record.order;
      entries.push({key,value:{...old,...patch}});
    }
    await write('meta',[...entries,...extraMeta],[],changed);
  }
  async function reload() {
    tracks = await read('tracks');
    childMode=!!(await read('meta','childMode'))?.value;
    trash=(await read('meta','trash'))?.value || [];
    const legacyHidden=tracks.filter(t=>t.hidden&&!t.trashPurged&&!trash.some(item=>item.kind==='song'&&item.trackId===t.id));
    if(legacyHidden.length){trash.push(...legacyHidden.map(t=>({id:crypto.randomUUID(),kind:'song',trackId:t.id,title:t.title,deletedAt:Date.now(),memberships:[]})));await write('meta',[{key:'trash',value:trash}]);}
    playlists = PL.validate((await read('meta','playlists'))?.value || []);
    librarySort = (await read('meta','librarySort'))?.value === 'name' ? 'name' : 'manual';
    if (activePlaylistId!=='all' && !activePlaylist()) activePlaylistId='all';
    const stored = await read('meta','backupState');
    backupState = stored?.value || {revision:tracks.length ? 1 : 0,savedRevision:0,lastConfirmedAt:0};
    if (!stored && tracks.length) await write('meta',[{key:'backupState',value:backupState}]);
    if (preparedBackup && preparedBackup.revision !== backupState.revision) preparedBackup = null;
    render(); renderProtection(); renderStorage(); scheduleBackup();
  }
  async function busy(task) {
    if (operation) return;
    operation = true; document.querySelectorAll('.parent-actions button,#import,#edit-toggle,#select-songs,#bulk-add,#bulk-delete,#assign-save,#empty-import,#edit-form button,#backup-import,#playlist-form button,#song-sort,#manage-current,#manage-playlists,#create-playlist').forEach(b => b.disabled = true);
    try { await task(); } catch(error) { if ($('parents').open) backupError = message(error); notify(message(error)); }
    finally { operation = false; document.querySelectorAll('.parent-actions button,#import,#edit-toggle,#select-songs,#bulk-add,#bulk-delete,#assign-save,#empty-import,#edit-form button,#backup-import,#playlist-form button,#song-sort,#manage-current,#manage-playlists,#create-playlist').forEach(b => b.disabled = false); renderBackup(); renderProtection(); renderBulk();renderDrawerControls(); }
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
        return old ? {...old,url:t.url,order:Number.isFinite(old.order) ? old.order : t.order,duration:t.duration,title:old.renamed ? old.title : t.title} : {...t,icon:t.defaultIcon,hidden:false};
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
      try { navigator.mediaSession.metadata = new MediaMetadata({title:track.title,artist:'השירים הקטנים שלנו',artwork:[{src:new URL('./icons/rainbow-note-512.png',location.href).href,sizes:'512x512',type:'image/png'}]}); } catch {}
    }
  }
  function clearAudioSource() {
    // Detach the previous resource before revoking its URL. Explicit load()
    // cancels any old pending play/load and discards the previous media buffer.
    audio.pause();audio.removeAttribute('src');audio.load();
    if(objectURL){URL.revokeObjectURL(objectURL);objectURL=null;}
  }
  function resetPlayer() {
    playToken++;currentId=null;clearAudioSource();syncPlayer();
  }
  async function playSong(id, toggle = true, fromQueue = false) {
    const track=tracks.find(t=>t.id===id&&!t.hidden);if(!track)return;
    if(!fromQueue){queuePlaylistId=activePlaylistId;queueIds=PL.queue(listed().map(t=>t.id),id,shuffle);}
    const token=++playToken;
    try {
      if(currentId===id&&audio.getAttribute('src')){
        if(toggle&&!audio.paused){audio.pause();return;}
        if(audio.ended)audio.currentTime=0;
      } else {
        currentId=null;clearAudioSource();
        if(!track.blob&&navigator.onLine===false){
          notify('השיר הזה עדיין לא נשמר לאופליין. התחברי לאינטרנט ושמרי אותו דרך ההגדרות.');syncPlayer();return;
        }
        const source=track.blob?URL.createObjectURL(track.blob):track.url;
        if(!source)throw new Error('לשיר אין קובץ שמע זמין.');
        if(track.blob)objectURL=source;
        audio.src=source;audio.load();currentId=id;
        setMediaInfo(track);render();
      }
      await audio.play();
    } catch(error) {
      if(token!==playToken)return;
      currentId=null;clearAudioSource();
      notify('לא ניתן לנגן את השיר שנבחר. נסי לבחור אותו שוב או לבחור שיר אחר.');
    }
    if(token===playToken)syncPlayer();
  }
  function moveSong(offset, ended = false) {
    if (ended && repeat==='one' && current() && !current().hidden) { audio.currentTime=0; return playSong(currentId,false,true); }
    const next = PL.adjacent(playableQueue(),currentId,offset,repeat);
    if (next) return playSong(next,false,true);
    if (ended) { audio.pause(); syncPlayer(); }
  }
  function syncPlayer() {
    const track = current(); const list = listed();
    $('now-title').textContent = track?.title || 'בוחרים ומקשיבים';
    $('now-icon').textContent = track ? iconFor(track) : '🧸';
    $('now-label').textContent = track ? 'השיר שבחרנו' : 'איזה שיר נשמע היום?';
    const isPlaying = !!track && !audio.paused && !audio.ended;
    $('play').textContent=isPlaying?'Ⅱ':'▶︎'; $('play').setAttribute('aria-label',isPlaying ? 'השהיה' : 'ניגון'); $('play').disabled = !track && !list.length;
    $('play-state').textContent = !track ? 'קצת מוזיקה, המון שמחה' : audio.error ? 'לא ניתן לנגן את הקובץ' : audio.ended ? 'איזה כיף לשיר ביחד' : isPlaying ? 'שרים ביחד 🎶' : 'מוכנים להמשיך?';
    const duration = Number.isFinite(audio.duration) ? audio.duration : track?.duration || 0;
    $('elapsed').textContent = time(audio.currentTime); $('duration').textContent = time(duration);
    $('seek').disabled = !track || !duration; $('seek').max = String(Math.max(1,duration));
    if (!scrubbing) $('seek').value = String(Math.min(audio.currentTime || 0,Math.max(1,duration)));
    const queue = playableQueue(); $('previous').disabled = !PL.adjacent(queue,currentId,-1,repeat); $('next').disabled = !PL.adjacent(queue,currentId,1,repeat);
    $('shuffle').textContent='⤨ ערבוב';$('shuffle').setAttribute('aria-label',shuffle?'ערבוב מופעל':'ערבוב כבוי');$('shuffle').title=shuffle?'ערבוב מופעל':'ערבוב כבוי';$('shuffle').setAttribute('aria-pressed',String(shuffle));
    const repeatLabel = repeat==='one' ? 'חזרה על שיר אחד' : repeat==='all' ? 'חזרה על הפלייליסט' : 'חזרה כבויה';
    $('repeat').textContent = (repeat==='one' ? '↻ 1 ' : '↻ ')+repeatLabel;$('repeat').title=repeatLabel; $('repeat').setAttribute('aria-label',repeatLabel); $('repeat').classList.toggle('repeat-active',repeat!=='off');
    $('queue-label').textContent = track ? 'מנגנים מתוך: '+playlistName(queuePlaylistId) : 'בחירת שיר תתחיל את הרשימה';
    document.querySelectorAll('.song-card').forEach(card => {
      const active = card.dataset.id === currentId; card.classList.toggle('active',active);
      const main = card.querySelector('.song-main'), play=main.querySelector('.song-play');play.textContent=active&&isPlaying?'Ⅱ':'▶︎';
      const item = tracks.find(t => t.id === card.dataset.id);
      if(item){const label=bulkSelecting?'בחירת '+item.title:(active&&isPlaying?'השהיית ':'ניגון ')+item.title;if(main.tagName==='BUTTON')main.setAttribute('aria-label',label);else play.setAttribute('aria-label',label);}
    });
  }
  function render() {
    const library = visible(); const all = listed(); const list = all.filter(matchesSearch); $('song-list').replaceChildren(); $('empty').hidden = !!all.length; $('no-results').hidden = !all.length || !!list.length; $('count').textContent = list.length === all.length ? all.length+' שירים' : list.length+' מתוך '+all.length;
    const title = (activePlaylist()?.icon || '🎶')+' '+playlistName(activePlaylistId);
    $('list-title').replaceChildren();
    if(activePlaylist()) { const button=document.createElement('button');button.type='button';button.className='playlist-title-button';button.textContent=title;button.setAttribute('aria-label','עריכת הפלייליסט '+playlistName(activePlaylistId));button.addEventListener('click',()=>editPlaylist(activePlaylistId));$('list-title').append(button); }
    else $('list-title').textContent=title;
 $('song-sort').value = activePlaylist()?.sortMode || librarySort;
    $('import').title=activePlaylist()?'הוספת שירים לפלייליסט ״'+playlistName(activePlaylistId)+'״':'הוספת שירים לספרייה';
    $('manual-order-help').hidden = !editing||bulkSelecting;
    $('empty-title').textContent = activePlaylistId==='all' ? 'כאן יגורו השירים שלכם' : 'הפלייליסט הזה עדיין ריק';
    $('empty-hint').textContent = activePlaylistId==='all' ? 'אפשר להוסיף קובצי שירים בעזרת הפלוס ליד החיפוש, או לשחזר גיבוי בהגדרות.' : 'בחרו שירים מהספרייה או הוסיפו קובצי שירים ישירות לפלייליסט.';
    $('empty-choose').hidden = activePlaylistId==='all';
    renderDrawer();
    for (const track of list) {
      const rowEditing=editing&&!bulkSelecting;
      const card = document.createElement('div'); card.className = 'song-card'; card.dataset.id = track.id; card.style.backgroundColor = colors[hash(track.id)%colors.length];
      const button = document.createElement(rowEditing?'div':'button'); button.className = 'song-main'; if(!rowEditing)button.type = 'button';
      const animal = document.createElement(rowEditing?'button':'span'); animal.className = 'song-animal'; animal.textContent = iconFor(track);if(rowEditing){animal.type='button';animal.setAttribute('aria-label','עריכת האייקון של '+track.title);animal.addEventListener('click',()=>editSong(track.id));}else animal.setAttribute('aria-hidden','true');
      const copy = document.createElement('span'); copy.className = 'song-copy';
      const name = document.createElement(rowEditing?'button':'span'); name.className = 'song-name'; name.textContent = track.title;if(rowEditing){name.type='button';name.setAttribute('aria-label','עריכת שם השיר '+track.title);name.addEventListener('click',()=>editSong(track.id));}
      const caption = document.createElement('span'); caption.className = 'song-caption'; caption.textContent = track.blob ? '✓ שמור במכשיר' : '☁ להאזנה דרך האינטרנט';
      copy.append(name,caption); const play = document.createElement(rowEditing?'button':'span'); play.className = 'song-play'; play.textContent = '▶︎';if(rowEditing){play.type='button';play.addEventListener('click',()=>playSong(track.id));}else play.setAttribute('aria-hidden','true');
      if(bulkSelecting){const box=document.createElement('input');box.type='checkbox';box.className='bulk-checkbox';box.checked=selectedSongIds.has(track.id);box.setAttribute('aria-label','בחירת '+track.title);box.addEventListener('change',()=>{box.checked?selectedSongIds.add(track.id):selectedSongIds.delete(track.id);renderBulk();});card.append(box);}
      button.append(animal,copy,play); if(!rowEditing)button.addEventListener('click',() => {if(bulkSelecting){selectedSongIds.has(track.id)?selectedSongIds.delete(track.id):selectedSongIds.add(track.id);const box=card.querySelector('.bulk-checkbox');if(box)box.checked=selectedSongIds.has(track.id);renderBulk();}else playSong(track.id);}); card.append(button);
      if(editing&&!bulkSelecting){
        const remove=document.createElement('button');remove.className='song-delete';remove.setAttribute('aria-label',(activePlaylist()?'הסרה מהפלייליסט של ':'מחיקה מהספרייה של ')+track.title);remove.title=activePlaylist()?'הסרה מהפלייליסט בלבד':'מחיקה מהספרייה (אפשר לשחזר)';
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','22');svg.setAttribute('height','22');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',activePlaylist()?'M5 12h14':'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7');svg.append(path);remove.append(svg);
        remove.addEventListener('click',()=>{if(operation)return;requireAdult(()=>activePlaylist()?removeFromPlaylist(track.id):deleteTracks([track.id]));});card.append(remove);
      }
      if (rowEditing) {
        const order = listed(); const pos=order.findIndex(t=>t.id===track.id); const controls=document.createElement('div'); controls.className='order-controls';
        for (const [delta,label] of [[-1,'הזזה למעלה'],[1,'הזזה למטה']]) { const b=document.createElement('button'); b.textContent=delta<0?'↑':'↓'; b.setAttribute('aria-label',label+' '+track.title); b.disabled=delta<0?pos===0:pos===order.length-1; b.addEventListener('click',()=>reorderTrack(track.id,delta)); controls.append(b); }
        card.append(controls);
      }
      $('song-list').append(card);
    }
    $('restore').hidden = !trash.length;
    $('edit-toggle').setAttribute('aria-label',editing?'סיום עריכה':'עריכת שירים');$('edit-toggle').title=editing?'סיום עריכה':'עריכת שירים';$('edit-toggle').classList.toggle('editing-active',editing); $('edit-toggle').setAttribute('aria-pressed',String(editing));
    const saved = library.filter(t => t.blob).length;
    $('offline-status').textContent = (shellReady ? '✓ הממשק מוכן לאופליין' : 'הממשק עדיין לא אושר לאופליין')+' · '+saved+' מתוך '+library.length+' שירים שמורים';
    syncPlayer(); renderBackup(); renderProtection(); renderBulk();
  }
  async function requestPersistence() { try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch {} }
  async function importFiles(files) {
    const targetId = importTargetId; importTargetId='all';
    if (!files.length) return;
    await busy(async () => {
      await requestPersistence(); let added = 0, reused=0, linked=0, recovered=0; const failed = [], report=[];
      const candidates=(await read('tracks')).sort((a,b)=>Number(!!a.hidden)-Number(!!b.hidden));
      for (const file of files) {
        try {
          if (!(file.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|aif|aiff|flac|caf|ogg|mp4)$/i.test(file.name))) throw new Error('סוג קובץ לא נתמך');
          SAFE.checkSize(file.size,SAFE.MAX_TRACK_BYTES,'קובץ השמע');
          const fingerprint=await SAFE.fingerprint(file);
          let duplicate=null;
          for(const t of candidates.filter(t=>t.blob?.size===file.size)) {
            if(!t.fingerprint||t.audioStorage!=='bytes-v1'){
              try{const actual=await SAFE.fingerprint(t.blob);if(t.fingerprint&&t.fingerprint!==actual)continue;t.fingerprint=actual;}
              catch{continue;} // An unreadable old/trash item must not block a fresh upload.
            }
            if(t.fingerprint===fingerprint){duplicate=t;break;}
          }
          if(duplicate) {
            let detail='השיר כבר נמצא בספרייה; לא נוסף עותק.';
            const target=playlists.find(p=>p.id===targetId);
            const needsLink=target&&!target.trackIds.includes(duplicate.id);
            if((needsLink||duplicate.hidden)&&confirm('השיר ״'+duplicate.title+'״ כבר קיים'+(duplicate.hidden?' בפריטים שנמחקו':' בספרייה')+'. '+(needsLink?'להשתמש בו ולהוסיף לפלייליסט ״'+target.name+'״?':'להחזיר אותו לספרייה?'))) {
              if(duplicate.hidden) {
                detail='השיר הקיים הוחזר מהפריטים שנמחקו.';
                const item=trash.find(item=>item.kind==='song'&&item.trackId===duplicate.id);
                if(item)await restoreTrashItem(item.id);else {duplicate.hidden=false;await updateTrackState([{id:duplicate.id,hidden:false}]);}
                duplicate.hidden=false;recovered++;
              }
              if(needsLink){detail='השיר הקיים נוסף לפלייליסט ״'+target.name+'״ ללא עותק נוסף.';playlists=playlists.map(p=>p.id===targetId?{...p,trackIds:[...p.trackIds.filter(id=>id!==duplicate.id),duplicate.id]}:p);await write('meta',[{key:'playlists',value:playlists}],[],true);linked++;}
            }
            else if(needsLink||duplicate.hidden)detail='זוהה קובץ זהה; דילגת על הוספתו או שחזורו.';
            reused++;report.push({name:file.name,status:'כפול',detail});continue;
          }
          const id = 'local:'+(crypto.randomUUID ? crypto.randomUUID() : Date.now()+'-'+Math.random().toString(36).slice(2));
          const nextPlaylists=playlists.map(p=>p.id===targetId ? {...p,trackIds:[...p.trackIds,id]} : p);
          await write('tracks',[{id,title:file.name.replace(/\.[^.]+$/,'').slice(0,180),source:'local',blob:file,fingerprint,hidden:false,order:Date.now()+added}],[],true,[{key:'playlists',value:nextPlaylists}]); playlists=nextPlaylists; candidates.push({id,title:file.name,blob:file,fingerprint,hidden:false}); added++;report.push({name:file.name,status:'נוסף',detail:targetId==='all'?'נוסף לספרייה.':'נוסף לספרייה ולפלייליסט שנבחר.'});
        } catch(error) { failed.push(file.name+': '+message(error));report.push({name:file.name,status:'נכשל',detail:message(error)}); }
      }
      await reload(); notify('נוספו '+added+' שירים'+(reused?' · '+reused+' קבצים זהים כבר קיימים':'')+(failed.length ? '. חלק מהקבצים לא נשמרו.' : ''));
      $('download-progress').textContent = failed.join(' | '); $('files').value = '';showImportReport(report,{added,reused,linked,recovered,failed:failed.length});
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
          try { response = await fetch(track.url,{signal:controller.signal}); if (!response.ok) throw new Error('ההורדה נכשלה'); blob = await SAFE.limitedAudio(response); } finally { clearTimeout(timeout); }
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
    if(childMode&&!adultUnlocked){requireAdult(()=>editSong(id));return;}
    const track = tracks.find(t => t.id === id); if (!track) return;
    $('edit-status').textContent=''; editingId = id; $('song-name').value = track.title; $('icon-options').replaceChildren();
    for (const icon of icons) { const b = document.createElement('button'); b.type = 'button'; b.className = 'icon-option'; b.textContent = icon; b.setAttribute('aria-label','בחירת '+icon); b.addEventListener('click',() => markIcon(icon)); $('icon-options').append(b); }
    markIcon(iconFor(track)); $('song-playlist-options').replaceChildren();
    for (const p of playlists) { const row=document.createElement('label');row.className='check-row';const check=document.createElement('input');check.type='checkbox';check.value=p.id;check.checked=p.trackIds.includes(id);const text=document.createElement('span');text.textContent=p.icon+' '+p.name;row.append(check,text);$('song-playlist-options').append(row); }
    if (!playlists.length) $('song-playlist-options').textContent='אפשר ליצור פלייליסט דרך תו הנגינה למעלה.';
    $('edit-dialog').showModal();
  }
  async function saveEdit(event) {
    event.preventDefault();
    const status=$('edit-status');
    if(operation){status.textContent='ממתינים לסיום הפעולה הנוכחית. נסי שוב בעוד רגע.';return;}
    // Capture the selected icon and fields before any asynchronous work.
    const id=editingId, title=$('song-name').value.trim(), icon=pickedIcon.trim();
    const assigned=new Set([...$('song-playlist-options').querySelectorAll('input:checked')].map(c=>c.value));
    if(!title){status.textContent='הזיני שם לשיר.';$('song-name').focus();return;}
    if(title.length>180){status.textContent='שם השיר ארוך מדי. אפשר להזין עד 180 תווים.';return;}
    if(!icon||[...icon].length>24){status.textContent='בחרי אימוג׳י אחד או סמל קצר.';return;}
    status.textContent='שומרים את השינויים…';
    await busy(async () => {
      try {
        const stored=await read('tracks',id);
        const track=tracks.find(t=>t.id===id)||stored;
        if(!stored||stored.hidden)throw new Error('השיר אינו נמצא עוד בספרייה.');
        const nextPlaylists=playlists.map(p=>({...p,trackIds:assigned.has(p.id) ? p.trackIds.includes(id)?p.trackIds:[...p.trackIds,id] : p.trackIds.filter(trackId=>trackId!==id)}));
        const updated={...track,title,icon,renamed:true};
        // Editing metadata must not re-serialize an unchanged audio Blob.
        await write('meta',[{key:'songEdit:'+id,value:{title,icon}},{key:'playlists',value:nextPlaylists}],[],title!==track.title || icon!==iconFor(track) || JSON.stringify(nextPlaylists)!==JSON.stringify(playlists));
        $('edit-dialog').close();status.textContent='';
        tracks=tracks.map(t=>t.id===id?updated:t);playlists=nextPlaylists;
        if(currentId===id)setMediaInfo(updated);
        notify('השם והאייקון נשמרו');
        try { await reload(); } catch(error) { notify('השינויים נשמרו. לא ניתן לרענן את התצוגה: '+message(error)); }

      } catch(error) {
        status.textContent='לא ניתן לשמור: '+message(error)+' אפשר לנסות שוב בלי לצאת מהעריכה.';
        throw error;
      }
    });
  }
  async function deleteSong(){await deleteTracks([editingId]);}
  async function deleteTracks(ids) {
    const plan=PL.planRemoval(tracks,playlists,ids);if(!plan.records.length)return;
    if(!confirm(plan.records.length===1?'למחוק את ״'+plan.records[0].title+'״ מהספרייה ומכל הפלייליסטים? אפשר לשחזר בהמשך.':'למחוק '+plan.records.length+' שירים מהספרייה ומכל הפלייליסטים? אפשר לשחזר בהמשך.'))return;
    await busy(async()=>{
      if(plan.records.some(t=>t.id===currentId))resetPlayer();
      const items=plan.deleted.map(item=>({...item,id:crypto.randomUUID(),kind:'song',deletedAt:Date.now()}));
      await updateTrackState(plan.records.map(t=>({id:t.id,hidden:true,trashPurged:false})),[{key:'playlists',value:plan.playlists},{key:'trash',value:[...trash,...items]}]);
      selectedSongIds.clear();await reload();$('edit-dialog').close();offerUndo(items[items.length-1]);lastUndoIds=items.map(item=>item.id);
      if(items.length>1)$('undo-label').textContent='נמחקו '+items.length+' שירים';
    });
  }
  function renderBackup() {
    const dirty = backupState.revision > backupState.savedRevision;
    const all = visible(); const missing = all.filter(t => !t.blob).length;
    $('backup-shortcut').disabled = !dirty || operation || preparing;
    $('backup-shortcut').classList.toggle('needs-backup',dirty);
    const shortcutLabel = !dirty ? 'אין שינויים שממתינים לגיבוי' : preparing ? 'מכינים את קובץ הגיבוי' : operation ? 'ממתינים לסיום הפעולה' : 'שמירת גיבוי — יש שינויים שלא גובו';
    $('backup-shortcut').setAttribute('aria-label',shortcutLabel); $('backup-shortcut').title=shortcutLabel;
    $('backup-status').textContent = dirty ? 'יש שינויים מאז הגיבוי האחרון שאישרת.' : backupState.lastConfirmedAt ? 'אישרת שמירת גיבוי ב־'+new Date(backupState.lastConfirmedAt).toLocaleString('he-IL') : 'עדיין לא אושרה שמירת גיבוי בקובץ.';
    const ready = preparedBackup?.revision === backupState.revision;
    $('backup-save').textContent = !all.length && !playlists.length && !dirty ? 'אין שירים לגיבוי' : operation ? 'ממתינים לסיום הפעולה…' : preparing ? 'מכינים את קובץ הגיבוי…' : ready ? 'שמירת קובץ הגיבוי' : missing ? 'הורדת השירים והכנת גיבוי' : 'הכנת גיבוי';
    $('backup-save').disabled = operation || preparing || (!all.length && !playlists.length && !dirty);
    $('backup-cancel').hidden = !preparing;
    $('backup-confirm').hidden = !offeredBackup;
    $('backup-confirm').disabled = operation;
    if (backupError) $('backup-progress').textContent = backupError;
    else if (missing) $('backup-progress').textContent = missing+' שירים עדיין לא שמורים במכשיר. לחצי על הכפתור להורדתם והכנת גיבוי. נדרש אינטרנט להשלמת ההורדה.';
    else if (ready && !offeredBackup) $('backup-progress').textContent = 'הקובץ מוכן: '+all.length+' שירים · '+(preparedBackup.file.size/1024/1024).toFixed(1)+' MB. לחצי לשמירה ובחרי ״שמירה בקבצים״.';
    else if (!preparing && !offeredBackup) $('backup-progress').textContent = all.length ? 'הגיבוי נשמר כקובץ עם הסיומת little-songs. לאחר שמירתו אפשר לשחזר גם ללא אינטרנט.' : 'הוסיפי שירים כדי ליצור גיבוי.';
  }
  function scheduleBackup() {
    clearTimeout(preparationTimer);
    // Only prepare locally while the app is open; never launch downloads automatically.
    if (backupState.revision <= backupState.savedRevision || visible().some(t => !t.blob) || preparedBackup?.revision === backupState.revision) return;
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
      const backupPlaylists = PL.validate(playlists.map(p=>({...p,trackIds:p.trackIds.filter(id=>all.some(t=>t.id===id))})),all.map(t=>t.id));
      const blob = await LittleSongsBackup.encode(all,(done,total) => {
        if (token !== preparationToken || revision !== backupState.revision) throw new DOMException('הספרייה השתנתה','AbortError');
        $('backup-progress').textContent = 'מכינים גיבוי: '+done+' מתוך '+total+' שירים';
      },{playlists:backupPlaylists,librarySort});
      if (token !== preparationToken || revision !== backupState.revision) return;
      preparedBackup = {revision,file:new File([blob],'Backup.little-songs',{type:'application/octet-stream'})};
    } catch(error) { if (token === preparationToken && error.name !== 'AbortError') backupError = 'לא ניתן להכין גיבוי: '+message(error); }
    finally { if (token === preparationToken) { preparing = false; renderBackup(); } }
  }
  async function saveBackup(event) {
    const direct = event?.currentTarget?.id === 'backup-shortcut';
    if (operation || preparing) return;
    if (!visible().length && !playlists.length && backupState.revision<=backupState.savedRevision) { notify('הוסיפי שירים או פלייליסט לפני יצירת גיבוי.'); return; }
    if (visible().some(t => !t.blob)) {
      backupError = '';
      if (visible().some(t => !t.blob && t.source !== 'catalog')) {
        backupError = 'חסר קובץ שמע מקומי. הוסיפי אותו מחדש דרך ״הוספת שירים מהאייפון״ כדי לכלול אותו בגיבוי.'; renderBackup(); if (direct) notify(backupError); return;
      }
      if (navigator.onLine === false) { backupError = 'חלק מהשירים עדיין לא הורדו. התחברי לאינטרנט ולחצי שוב על הכנת גיבוי.'; renderBackup(); if(direct)notify(backupError); return; }
      await downloadAll();
      if (visible().some(t => !t.blob)) { backupError = 'חלק מהשירים לא הורדו. בדקי את החיבור ונסי שוב. לא נוצר גיבוי חלקי.'; renderBackup(); if(direct)notify(backupError); return; }
    }
    if (!preparedBackup || preparedBackup.revision !== backupState.revision) { await prepareBackup(); if (direct) notify(backupError || 'הגיבוי מוכן. לחצי שוב על אייקון השמירה כדי לבחור היכן לשמור.'); return; }
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
      if (direct) $('backup-saved-dialog').showModal();
      $('backup-progress').textContent = 'בחרי ״שמירה בקבצים״, באותה תיקייה, ואז ״החלפה״ אם מתבקשת. רק לאחר שהקובץ נשמר לחצי ״שמרתי את הקובץ״.';
      renderBackup();
    } catch(error) { if (error.name !== 'AbortError') { backupError = 'לא ניתן לפתוח שמירה: '+message(error); renderBackup(); if (direct) notify(backupError); } }
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
      offeredBackup = null; $('backup-saved-dialog').close(); await reload(); notify('אישור שמירת הגיבוי נרשם');
    });
  }
  async function restoreBackup(file, audioOnly=false) {
    if (!file) return;
    await busy(async () => {
      backupError = '';
      $('backup-progress').textContent = 'בודקים את קובץ הגיבוי…';
      SAFE.checkSize(file.size,SAFE.MAX_BACKUP_BYTES,'קובץ הגיבוי');
      const archive = await LittleSongsBackup.decodeLibrary(file,(done,total) => { $('backup-progress').textContent = 'בדיקת הגיבוי: '+done+' מתוך '+total+' שירים'; });
      const restored=archive.tracks;
      if(audioOnly){
        const repairs=SAFE.repairAudio(tracks,restored);
        if(!repairs.length)throw new Error('אין בגיבוי שירים עם מזהים תואמים לשירים הפעילים במכשיר. הספרייה לא שונתה.');
        const missing=visible().length-repairs.length;
        if(!confirm('לתקן את קובצי השמע של '+repairs.length+' שירים מהגיבוי? השמות, האייקונים, הפלייליסטים והסדר הנוכחיים יישמרו.'+(missing?' '+missing+' שירים אינם כלולים בתיקון.':'')))return;
        await write('tracks',repairs,[],true);resetPlayer();preparedBackup=null;offeredBackup=null;await reload();
        $('audio-diagnostics').close();$('parents').close();notify('תוקנו קובצי השמע של '+repairs.length+' שירים. השמות והפלייליסטים נשמרו.');return;
      }
      if (!restored.length && !archive.playlists.length) throw new Error('קובץ הגיבוי אינו מכיל שירים או פלייליסטים.');
      if (!confirm('לשחזר '+restored.length+' שירים ו־'+archive.playlists.length+' פלייליסטים מהגיבוי? שירים עם אותו מזהה יעודכנו, כולל השם והאייקון. שירים אחרים שכבר קיימים בנגן יישארו.')) return;
      await requestPersistence();
      const entries = restored.map(t => t.source === 'catalog' ? {...t,url:new URL(t.file,new URL('./',location.href)).href} : t);
      // All bytes and checksums have been validated before this single atomic write.
      const incoming=new Map(archive.playlists.map(p=>[p.id,p]));
      const merged=[...playlists.filter(p=>!incoming.has(p.id)),...archive.playlists];
      const restoredIds=new Set(entries.map(t=>t.id));const meta=[{key:'playlists',value:merged},{key:'trash',value:trash.filter(item=>item.kind!=='song'||!restoredIds.has(item.trackId))}];if(archive.hasPlaylists)meta.push({key:'librarySort',value:archive.librarySort});
      meta.push(...entries.flatMap(t=>[{key:'songEdit:'+t.id,value:null},{key:'trackState:'+t.id,value:null}]));
      await write('tracks',entries,[],true,meta); resetPlayer();
      offeredBackup = null; preparedBackup = null; $('song-search').value = ''; await reload();
      notify('שוחזרו '+entries.length+' שירים ו־'+archive.playlists.length+' פלייליסטים');
    });
    $('backup-file').value = '';
  }
  let checkingAudio=false;
  async function checkAudioDiagnostics() {
    if(checkingAudio)return;
    checkingAudio=true;$('audio-diagnostics-again').disabled=true;
    const status=$('audio-diagnostics-status'),output=$('audio-diagnostics-report');
    const selected=current(),selectedId=currentId,token=playToken,source=audio.currentSrc||audio.getAttribute('src');
    const lines=['גרסה: '+APP_VERSION,'השיר שמוצג: '+(selected?.title||'לא נבחר'),'הנגן: '+(audio.paused?'מושהה':'מנגן'),'משך מדווח: '+time(audio.duration),''];
    status.textContent='קוראים את קובצי השמע במכשיר…';output.textContent='';
    try {
      let loadedHash=null,loadedError='';
      if(source?.startsWith('blob:')){
        try{const response=await fetch(source);if(!response.ok)throw new Error('קריאת המקור נכשלה');loadedHash=await SAFE.fingerprint(await response.blob());}
        catch(error){loadedError=message(error);}
      }
      const groups=new Map();let selectedHash=null,issues=0;
      for(const [index,track] of visible().entries()){
        status.textContent='בודקים שיר '+(index+1)+' מתוך '+visible().length+'…';
        const record=await read('tracks',track.id);
        if(!record?.blob){lines.push(track.title+': אין קובץ מקומי');continue;}
        try {
          const storedHash=await SAFE.fingerprint(record.blob);
          const memoryHash=track.blob===record.blob?storedHash:track.blob?await SAFE.fingerprint(track.blob):null;
          const expected=record.fingerprint;
          const mismatch=!!expected&&expected!==storedHash;
          if(mismatch||memoryHash!==storedHash)issues++;
          if(track.id===selectedId)selectedHash=storedHash;
          const names=groups.get(storedHash)||[];names.push(track.title);groups.set(storedHash,names);
          lines.push(track.title+'\nגודל: '+record.blob.size+' בתים · חתימה: '+storedHash.slice(0,16)+'\nאחסון: '+(record.audioStorage==='bytes-v1'?'בתים עצמאיים':'הפניית קובץ ישנה')+'\nסוג: '+(record.blob.type||'לא צוין')+'\n'+(expected?(mismatch?'⚠ הקובץ שונה מהחתימה שנשמרה בהעלאה':'✓ תואם לחתימה מההעלאה'):'אין חתימת מקור להשוואה')+'\n'+(memoryHash===storedHash?'✓ הזיכרון תואם לאחסון':'⚠ הזיכרון שונה מהאחסון')+'\n');
        }catch(error){issues++;lines.push(track.title+': כשל בקריאת שמע — '+message(error)+'\n');}
      }
      lines.push('בדיקת המקור בנגן:');
      if(token!==playToken)lines.push('הבחירה השתנתה במהלך הבדיקה. הפעילי שוב.');
      else if(loadedHash&&selectedHash)lines.push(loadedHash===selectedHash?'✓ הקובץ שנטען לנגן תואם לשיר שנבחר':'⚠ הקובץ שנטען לנגן אינו תואם לשיר שנבחר');
      else lines.push(loadedError||'אין מקור מקומי פעיל שאפשר להשוות.');
      const duplicates=[...groups.values()].filter(names=>names.length>1);
      lines.push('','קבצים זהים בין שירים: '+(duplicates.length?duplicates.map(names=>names.join(' / ')).join('; '):'לא נמצאו'));
      lines.push('ממצאי אי־התאמה/קריאה: '+issues);
      output.textContent=lines.join('\n');status.textContent='הבדיקה הסתיימה. השירים לא שונו.';
    }catch(error){output.textContent=lines.join('\n');status.textContent='הבדיקה לא הושלמה: '+message(error);}
    finally{checkingAudio=false;$('audio-diagnostics-again').disabled=false;}
  }
  $('check-audio').addEventListener('click',()=>requireAdult(()=>{$('audio-diagnostics').showModal();checkAudioDiagnostics();}));
  $('repair-audio').addEventListener('click',()=>{if(!operation)requireAdult(()=>{$('repair-audio-file').value='';$('repair-audio-file').click();});});
  $('repair-audio-file').addEventListener('change',()=>{const file=$('repair-audio-file').files[0];$('repair-audio-file').value='';requireAdult(()=>restoreBackup(file,true));});
  $('audio-diagnostics-again').addEventListener('click',checkAudioDiagnostics);
  $('audio-diagnostics-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('audio-diagnostics-status').textContent+'\n'+$('audio-diagnostics-report').textContent);$('audio-diagnostics-status').textContent='הדוח הועתק. אפשר להדביק אותו בצ׳אט.';}catch{$('audio-diagnostics-status').textContent='ההעתקה לא התאפשרה. אפשר לצלם את הדוח.';}});
  $('audio-diagnostics-close').addEventListener('click',()=>$('audio-diagnostics').close());
  async function setupOffline() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) { $('download-progress').textContent = 'להתקנה ולאופליין יש לפתוח את האתר דרך כתובת HTTPS, ולא כקובץ מקומי.'; return; }
    try {
      const existing = await navigator.serviceWorker.getRegistration('./');
      if (existing?.active) { shellReady = true; render(); }
      await navigator.serviceWorker.register('./sw.js',{scope:'./'});
      await navigator.serviceWorker.ready; shellReady = true; render();
    } catch { if (!shellReady) $('download-progress').textContent = 'הממשק לא נשמר לאופליין. נסי לרענן כשהאינטרנט מחובר.'; }
  }
  function choosePlaylist(id) {
    activePlaylistId = id; bulkSelecting=false;selectedSongIds.clear();$('song-search').value='';
    $('playlists-drawer').close(); render(); document.querySelector('.library-scroll').scrollTop=0;
  }
  function renderDrawerControls(){
    const query=PL.normalize($('drawer-search').value);
    $('drawer-order-toggle').disabled=operation||!!query||playlists.length<2;
    $('drawer-order-toggle').setAttribute('aria-pressed',String(drawerOrdering));
    $('drawer-order-toggle').setAttribute('aria-label',drawerOrdering?'שמירת סדר הפלייליסטים':'סידור פלייליסטים');
    $('drawer-order-toggle').title=query?'נקי את החיפוש כדי לסדר פלייליסטים':drawerOrdering?'לחיצה נוספת לשמירת הסדר':'סידור פלייליסטים';
    $('drawer-search-toggle').disabled=operation||drawerOrdering;$('create-playlist').disabled=operation||drawerOrdering;
    $('drawer-order-help').hidden=!drawerOrdering;
  }
  function renderDrawer() {
    const nav=$('playlist-nav');nav.replaceChildren();const query=PL.normalize($('drawer-search').value);
    const ordered=drawerOrdering?drawerDraft:PL.sidebar(playlists),filtered=ordered.filter(p=>PL.normalize(p.name).includes(query));
    for(const p of [{id:'all',name:'כל השירים',icon:'🎶',color:'#eee5fa'},...filtered]){
      const row=document.createElement('div');row.className='playlist-nav-row';row.style.backgroundColor=p.color;row.classList.toggle('current',p.id===activePlaylistId);if(p.id!=='all')row.dataset.playlistId=p.id;
      const button=document.createElement('button');button.className='playlist-choice';button.disabled=drawerOrdering;button.setAttribute('aria-current',String(p.id===activePlaylistId));button.setAttribute('aria-label','בחירת '+p.name);
      const icon=document.createElement('span');icon.textContent=p.icon;const copy=document.createElement('span');const name=document.createElement('strong');name.textContent=(p.pinned?'📌 ':'')+p.name;const count=document.createElement('small');count.textContent=(p.id==='all'?visible():PL.select(tracks,p)).length+' שירים';copy.append(name,count);button.append(icon,copy);button.addEventListener('click',()=>choosePlaylist(p.id));row.append(button);
      if(p.id!=='all'&&!drawerOrdering){const edit=document.createElement('button');edit.className='playlist-nav-edit';edit.textContent='✎';edit.setAttribute('aria-label','עריכת הפלייליסט '+p.name);edit.addEventListener('click',()=>editPlaylist(p.id));row.append(edit);}
      if(p.id!=='all'&&drawerOrdering){
        const controls=document.createElement('div');controls.className='drawer-order-controls';const handle=document.createElement('button');handle.className='drawer-drag';handle.textContent='⠿';handle.setAttribute('aria-label','גרירת הפלייליסט '+p.name);handle.addEventListener('pointerdown',event=>startDrawerDrag(event,row,p.id));controls.append(handle);
        const group=ordered.filter(q=>!!q.pinned===!!p.pinned),index=group.findIndex(q=>q.id===p.id);
        for(const [delta,text] of [[-1,'↑'],[1,'↓']]){const move=document.createElement('button');move.textContent=text;move.disabled=index+delta<0||index+delta>=group.length;move.setAttribute('aria-label',(delta<0?'העלאת הפלייליסט ':'הורדת הפלייליסט ')+p.name);move.addEventListener('click',()=>{drawerDraft=PL.moveSidebar(drawerDraft,p.id,group[index+delta].id);const top=nav.scrollTop;renderDrawer();nav.scrollTop=top;[...nav.querySelectorAll('.playlist-nav-row')].find(r=>r.dataset.playlistId===p.id)?.querySelector('.drawer-drag')?.focus({preventScroll:true});});controls.append(move);}row.append(controls);
      }
      nav.append(row);
    }
    if(query&&!filtered.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='לא נמצאו פלייליסטים מתאימים.';nav.append(empty);}
    renderDrawerControls();
  }
  function startDrawerDrag(event,row,id){
    if(event.button!==0||drawerDrag||operation)return;event.preventDefault();const handle=event.currentTarget,root=$('playlist-nav'),initial=[...drawerDraft];drawerDrag=id;handle.setPointerCapture(event.pointerId);row.classList.add('dragging');
    const move=e=>{const bounds=root.getBoundingClientRect();if(e.clientY<bounds.top+40)root.scrollTop-=18;else if(e.clientY>bounds.bottom-40)root.scrollTop+=18;const target=[...root.querySelectorAll('[data-playlist-id]')].find(r=>r!==row&&e.clientY>=r.getBoundingClientRect().top&&e.clientY<=r.getBoundingClientRect().bottom);if(!target)return;const next=PL.moveSidebar(drawerDraft,id,target.dataset.playlistId);if(next.findIndex(p=>p.id===id)===drawerDraft.findIndex(p=>p.id===id))return;drawerDraft=next;if(next.findIndex(p=>p.id===id)<next.findIndex(p=>p.id===target.dataset.playlistId))root.insertBefore(row,target);else root.insertBefore(row,target.nextSibling);handle.setPointerCapture(e.pointerId);};
    const finish=e=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',finish);handle.removeEventListener('pointercancel',finish);if(e.type==='pointercancel')drawerDraft=initial;drawerDrag=null;const top=root.scrollTop;renderDrawer();root.scrollTop=top;};
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);
  }
  function openDrawer() {if(operation)return;$('parents').close();drawerOrdering=false;drawerDraft=[];$('drawer-search').value='';$('drawer-search-box').hidden=true;$('drawer-search-toggle').setAttribute('aria-expanded','false');renderDrawer();$('playlists-drawer').showModal();$('playlists-toggle').setAttribute('aria-expanded','true');}
  $('drawer-order-toggle').addEventListener('click',()=>{if(operation||PL.normalize($('drawer-search').value))return;requireAdult(()=>{if(!drawerOrdering){drawerDraft=PL.validate(PL.sidebar(playlists));drawerOrdering=true;$('drawer-search-box').hidden=true;$('drawer-search-toggle').setAttribute('aria-expanded','false');renderDrawer();return;}busy(async()=>{const next=PL.validate(drawerDraft),changed=JSON.stringify(next.map(p=>p.id))!==JSON.stringify(playlists.map(p=>p.id));if(changed)await write('meta',[{key:'playlists',value:next}],[],true);drawerOrdering=false;drawerDraft=[];await reload();if(changed)notify('סדר הפלייליסטים נשמר');});});});
  $('drawer-search-toggle').addEventListener('click',()=>{const open=$('drawer-search-box').hidden;$('drawer-search-box').hidden=!open;$('drawer-search-toggle').setAttribute('aria-expanded',String(open));if(open)$('drawer-search').focus();else{$('drawer-search').value='';renderDrawer();}});
  $('drawer-search').addEventListener('input',renderDrawer);$('drawer-search-clear').addEventListener('click',()=>{$('drawer-search').value='';renderDrawer();$('drawer-search').focus();});
  function editPlaylist(id=null) {
    if(operation)return;
    if(childMode&&!adultUnlocked){requireAdult(()=>editPlaylist(id));return;}
    const p=playlists.find(p=>p.id===id);playlistEditingId=p?.id || null;draftTrackIds=new Set(p?PL.select(tracks,p).map(t=>t.id):[]);draftOrdering=false;draftOrderChanged=false;draftPlaylistId=p?.id||'playlist:'+crypto.randomUUID();draftSortMode=p?.sortMode||'manual';
    $('playlists-drawer').close();$('parents').close();
    $('playlist-editor-title').textContent=p?'עריכת הפלייליסט':'פלייליסט חדש';$('playlist-name').value=p?.name || '';
    $('playlist-pinned').checked=!!p?.pinned;$('playlist-icon').value=p?.icon || '🎵';$('playlist-color').value=p?.color || '#eee5fa';$('playlist-song-search').value='';$('delete-playlist').hidden=!p;$('duplicate-playlist').hidden=!p;$('playlist-editor-status').textContent='';
    renderPlaylistChoices();$('playlist-editor').showModal();
  }
  function moveDraftTrack(id, targetId) {
    const ids=[...draftTrackIds], from=ids.indexOf(id), to=ids.indexOf(targetId);
    if(from<0||to<0||from===to)return false;
    ids.splice(from,1);ids.splice(to,0,id);draftTrackIds=new Set(ids);draftOrderChanged=true;return true;
  }
  function renderPlaylistChoices() {
    const root=$('playlist-track-options');root.replaceChildren();root.classList.toggle('ordering',draftOrdering);
    $('playlist-order-toggle').textContent=draftOrdering?'חזרה לבחירת שירים':'סידור שירים';
    $('playlist-order-toggle').setAttribute('aria-pressed',String(draftOrdering));
    $('playlist-selection-fields').hidden=draftOrdering;
    $('playlist-order-help').hidden=!draftOrdering;
    const query=PL.normalize($('playlist-song-search').value), all=visible();
    const filtered=draftOrdering?[...draftTrackIds].map(id=>all.find(t=>t.id===id)).filter(Boolean):all.filter(t=>PL.normalize(t.title).includes(query));
    for(const [index,t] of filtered.entries()) {
      const row=document.createElement(draftOrdering?'div':'label');row.className='check-row';row.dataset.trackId=t.id;
      const label=document.createElement('span');label.className='draft-track-title';label.textContent=iconFor(t)+' '+t.title;
      if(draftOrdering) {
        const handle=document.createElement('button');handle.type='button';handle.className='drag-handle';handle.textContent='⠿';handle.setAttribute('aria-label','גרירת '+t.title);handle.addEventListener('pointerdown',event=>startDraftDrag(event,row,t.id));row.append(handle,label);
        for(const [delta,text] of [[-1,'↑'],[1,'↓']]) {
          const button=document.createElement('button');button.type='button';button.className='draft-move';button.textContent=text;button.disabled=index+delta<0||index+delta>=filtered.length;
          button.setAttribute('aria-label',(delta<0?'העלאת ':'הורדת ')+t.title);
          button.addEventListener('click',()=>{if(moveDraftTrack(t.id,filtered[index+delta].id)){const scroll=root.scrollTop;renderPlaylistChoices();root.scrollTop=scroll;const moved=[...root.children].find(r=>r.dataset.trackId===t.id);moved?.querySelector(delta<0?'.draft-move':'.draft-move:last-child')?.focus({preventScroll:true});$('playlist-editor-status').textContent='סדר השירים עודכן. לחצי על שמירת הפלייליסט כדי לשמור.';}});row.append(button);
        }
      } else {
        const box=document.createElement('input');box.type='checkbox';box.value=t.id;box.checked=draftTrackIds.has(t.id);
        box.addEventListener('change',()=>{box.checked?draftTrackIds.add(t.id):draftTrackIds.delete(t.id);$('selection-count').textContent=draftTrackIds.size+' נבחרו';});row.append(box,label);
      }
      root.append(row);
    }
    if(!filtered.length){const p=document.createElement('p');p.className='hint';p.textContent=draftOrdering?'בחרי שירים לפלייליסט כדי לסדר אותם.':all.length?'לא נמצאו שירים לחיפוש הזה.':'הספרייה ריקה. אפשר לשמור את הפלייליסט ולהוסיף אליו שירים בהמשך.';root.append(p);}
    $('selection-count').textContent=draftTrackIds.size+' נבחרו';
  }
  function startDraftDrag(event,row,id) {
    if(event.button!==0||draftDrag)return;
    event.preventDefault();const handle=event.currentTarget,root=$('playlist-track-options');
    const initial=[...draftTrackIds],wasChanged=draftOrderChanged;
    draftDrag={id};handle.setPointerCapture(event.pointerId);row.classList.add('dragging');
    const move=e=>{
      const bounds=root.getBoundingClientRect();if(e.clientY<bounds.top+40)root.scrollTop-=18;else if(e.clientY>bounds.bottom-40)root.scrollTop+=18;
      const target=[...root.children].find(r=>r!==row&&r.dataset.trackId&&e.clientY>=r.getBoundingClientRect().top&&e.clientY<=r.getBoundingClientRect().bottom);
      if(target&&moveDraftTrack(id,target.dataset.trackId)){const order=[...draftTrackIds];if(order.indexOf(id)<order.indexOf(target.dataset.trackId))root.insertBefore(row,target);else root.insertBefore(row,target.nextSibling);handle.setPointerCapture(e.pointerId);}
    };
    const finish=e=>{
      handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',finish);handle.removeEventListener('pointercancel',finish);
      if(e.type==='pointercancel'){draftTrackIds=new Set(initial);draftOrderChanged=wasChanged;}
      draftDrag=null;const scroll=root.scrollTop;renderPlaylistChoices();root.scrollTop=scroll;
      if(draftOrderChanged)$('playlist-editor-status').textContent='סדר השירים עודכן. לחצי על שמירת הפלייליסט כדי לשמור.';
    };
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);
  }
  async function savePlaylist(event) {
    event.preventDefault();
    await busy(async()=>{
      try{
        const old=playlists.find(p=>p.id===playlistEditingId);const selected=new Set([...draftTrackIds].filter(id=>visible().some(t=>t.id===id)));
        const ids=draftOrderChanged?[...selected]:[...(old?.trackIds || []).filter(id=>selected.has(id)),...[...selected].filter(id=>!old?.trackIds.includes(id))];
        const p={id:old?.id || draftPlaylistId,name:$('playlist-name').value.trim(),icon:$('playlist-icon').value.trim(),color:$('playlist-color').value,trackIds:ids,sortMode:draftOrderChanged?'manual':draftSortMode,pinned:$('playlist-pinned').checked};
        const ordered=PL.upsertSidebar(playlists,p);
        await write('meta',[{key:'playlists',value:ordered}],[],true);activePlaylistId=p.id;await reload();$('playlist-editor').close();notify('הפלייליסט נשמר');
      }catch(error){$('playlist-editor-status').textContent=message(error);throw error;}
    });
  }
  async function deletePlaylist() {
    const p=playlists.find(p=>p.id===playlistEditingId);if(!p||!confirm('למחוק את הפלייליסט ״'+p.name+'״? כל השירים יישארו בספרייה.'))return;
    await busy(async()=>{const item={id:crypto.randomUUID(),kind:'playlist',playlist:p,title:p.name,index:playlists.findIndex(q=>q.id===p.id),deletedAt:Date.now()};await write('meta',[{key:'playlists',value:playlists.filter(q=>q.id!==p.id)},{key:'trash',value:[...trash,item]}],[],true);lastUndoId=item.id;if(activePlaylistId===p.id)activePlaylistId='all';await reload();$('playlist-editor').close();offerUndo(trash.find(item=>item.id===lastUndoId));});
  }
  async function removeFromPlaylist(id){return removePlaylistTracks([id]);}
  async function removePlaylistTracks(ids){
    const p=activePlaylist();if(!p||operation)return;const allowed=new Set(visible().map(t=>t.id));const plan=PL.removeMembership(playlists,p.id,ids.filter(id=>allowed.has(id)));if(!plan.removed.length)return;
    if(!confirm('להסיר '+plan.removed.length+' שירים מהפלייליסט ״'+p.name+'״ בלבד? הם יישארו בספרייה ובפלייליסטים האחרים.'))return;
    await busy(async()=>{await write('meta',[{key:'playlists',value:plan.playlists}],[],true);selectedSongIds.clear();await reload();clearTimeout(undoTimer);lastUndoIds=[];lastUndoId=null;lastUndoMembership={playlistId:p.id,removed:plan.removed};$('undo-delete').textContent='ביטול הסרה';$('undo-label').textContent='הוסרו '+plan.removed.length+' שירים מ״'+p.name+'״';$('undo-bar').hidden=false;undoTimer=setTimeout(()=>{$('undo-bar').hidden=true;lastUndoMembership=null;},5000);});
  }
  async function undoMembershipRemoval(){const snapshot=lastUndoMembership;if(!snapshot)return;const p=playlists.find(q=>q.id===snapshot.playlistId);if(!p)throw new Error('הפלייליסט כבר אינו קיים.');const allowed=new Set(visible().map(t=>t.id));const items=snapshot.removed.filter(m=>allowed.has(m.trackId)).map(m=>({kind:'song',trackId:m.trackId,memberships:[{id:p.id,index:m.index}]}));const next=PL.restoreMemberships(playlists,items);await write('meta',[{key:'playlists',value:next}],[],true);lastUndoMembership=null;clearTimeout(undoTimer);$('undo-bar').hidden=true;await reload();notify('השירים הוחזרו למקומם בפלייליסט');}
  async function reorderTrack(id,delta) {
    await busy(async()=>{
      const order=listed();const i=order.findIndex(t=>t.id===id);const j=i+delta;if(i<0||j<0||j>=order.length)return;
      [order[i],order[j]]=[order[j],order[i]];
      if(activePlaylist()) { const p=activePlaylist();await write('meta',[{key:'playlists',value:playlists.map(q=>q.id===p.id?{...q,sortMode:'manual',trackIds:order.map(t=>t.id)}:q)}],[],true); }
      else await updateTrackState(order.map((t,i)=>({id:t.id,order:i})),[{key:'librarySort',value:'manual'}]);
      await reload();
    });
  }
  $('playlists-toggle').addEventListener('click',openDrawer);
  $('drawer-close').addEventListener('click',()=>$('playlists-drawer').close());
  $('drawer-backdrop').addEventListener('click',()=>$('playlists-drawer').close());
  $('playlists-drawer').addEventListener('close',()=>{drawerOrdering=false;drawerDraft=[];$('playlists-toggle').setAttribute('aria-expanded','false');});
  $('manage-playlists').addEventListener('click',openDrawer);
  $('create-playlist').addEventListener('click',()=>editPlaylist());
  $('playlist-order-toggle').addEventListener('click',()=>{draftOrdering=!draftOrdering;renderPlaylistChoices();$('playlist-track-options').scrollTop=0;});
  $('playlist-editor-close').addEventListener('click',()=>$('playlist-editor').close());
  $('playlist-form').addEventListener('submit',savePlaylist);
  $('delete-playlist').addEventListener('click',deletePlaylist);
  $('playlist-song-search').addEventListener('input',renderPlaylistChoices);
  $('select-all-tracks').addEventListener('click',()=>{const query=PL.normalize($('playlist-song-search').value);visible().filter(t=>PL.normalize(t.title).includes(query)).forEach(t=>draftTrackIds.add(t.id));renderPlaylistChoices();});
  $('clear-tracks').addEventListener('click',()=>{draftTrackIds.clear();renderPlaylistChoices();});
  $('empty-choose').addEventListener('click',()=>editPlaylist(activePlaylistId));
  $('empty-import').addEventListener('click',()=>{importTargetId=activePlaylistId;$('files').click();});
  $('song-sort').addEventListener('change',()=>busy(async()=>{const value=$('song-sort').value==='name'?'name':'manual';const p=activePlaylist();await write('meta',p?[{key:'playlists',value:playlists.map(q=>q.id===p.id?{...q,sortMode:value}:q)}]:[{key:'librarySort',value}],[],true);await reload();}));
  $('shuffle').addEventListener('click',()=>{shuffle=!shuffle;const p=playlists.find(p=>p.id===queuePlaylistId);if(currentId)queueIds=PL.queue(PL.select(tracks,p,librarySort).map(t=>t.id),currentId,shuffle);syncPlayer();});
  $('repeat').addEventListener('click',()=>{repeat=repeat==='off'?'one':repeat==='one'?'all':'off';syncPlayer();});

  $('backup-save').addEventListener('click',saveBackup);
  $('backup-cancel').addEventListener('click',() => {
    clearTimeout(preparationTimer); preparationToken++; preparing = false;
    backupError = 'ההכנה בוטלה. אפשר ללחוץ שוב על הכנת גיבוי.'; renderBackup();
  });
  $('backup-confirm').addEventListener('click',confirmBackup);
  $('backup-import').addEventListener('click',() => { if (!operation) {$('backup-file').click();} });
  $('backup-file').addEventListener('change',() => {const file=$('backup-file').files[0];requireAdult(()=>restoreBackup(file));});
  $('backup-shortcut').addEventListener('click',saveBackup);
  $('backup-saved-yes').addEventListener('click',confirmBackup);
  $('backup-saved-later').addEventListener('click',() => $('backup-saved-dialog').close());
  $('play').addEventListener('click',() => { const t = current() || listed()[0]; if (t) playSong(t.id,true,!!current()); });
  $('previous').addEventListener('click',() => moveSong(-1)); $('next').addEventListener('click',() => moveSong(1));
  $('seek').addEventListener('input',() => { scrubbing = true; $('elapsed').textContent = time(Number($('seek').value)); });
  $('seek').addEventListener('change',() => { if (current() && Number.isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration,Math.max(0,Number($('seek').value))); scrubbing = false; syncPlayer(); });
  for (const name of ['play','pause','ended','timeupdate','loadedmetadata','durationchange','emptied']) audio.addEventListener(name,syncPlayer);
  audio.addEventListener('ended',()=>moveSong(1,true));
  audio.addEventListener('error',() => { if (currentId) { syncPlayer(); notify('לא ניתן לנגן את השיר. נסי להוריד אותו לאופליין או לבחור קובץ אחר.'); } });
  $('parents-toggle').addEventListener('click',() => requireAdult(()=>{ $('parents').showModal(); $('parents-toggle').setAttribute('aria-expanded','true'); refreshStorageEstimate(); }));
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
  $('edit-toggle').addEventListener('click',() => { if(operation)return; bulkSelecting=false;selectedSongIds.clear();editing = !editing; render(); if (editing) $('parents').close(); });
  $('import').addEventListener('click',() => {importTargetId=activePlaylistId;$('files').click();}); $('files').addEventListener('change',() => {const files=[...$('files').files];requireAdult(()=>importFiles(files));});
  $('download-all').addEventListener('click',downloadAll);
  $('restore').addEventListener('click',openTrash);
  $('edit-form').addEventListener('submit',saveEdit); $('delete-song').addEventListener('click',deleteSong); $('edit-close').addEventListener('click',() => $('edit-dialog').close());
  $('custom-icon').addEventListener('input',() => { pickedIcon = $('custom-icon').value; });
  if ('mediaSession' in navigator) { for (const [action,handler] of Object.entries({play:() => {const t=current();if(t)playSong(t.id,false,true);},pause:()=>audio.pause(),previoustrack:()=>moveSong(-1),nexttrack:()=>moveSong(1),seekto:details=>{if(Number.isFinite(details.seekTime)) audio.currentTime=details.seekTime;}})) try { navigator.mediaSession.setActionHandler(action,handler); } catch {} }
  window.addEventListener('online',() => { notify('החיבור חזר. אפשר לשמור עוד שירים לאופליין.'); });
  function renderProtection() {
    const locked=childMode&&!adultUnlocked;
    $('child-lock').hidden=!childMode;$('child-lock').textContent=locked?'🔒':'🔓';
    $('child-lock').setAttribute('aria-label',locked?'מצב ילדים — פתיחה להורים':'נעילת העריכה למצב ילדים');
    $('child-mode-toggle').textContent=childMode?'כיבוי מצב ילדים':'הפעלת מצב ילדים';$('child-mode-toggle').setAttribute('aria-pressed',String(childMode));
    $('song-sort').disabled=locked||operation;
    if(locked&&editing){editing=false;}
  }
  function requireAdult(action) {
    if(!childMode||adultUnlocked){action();return;}
    const a=4+Math.floor(Math.random()*6),b=3+Math.floor(Math.random()*6);gateAnswer=a+b;gateAction=action;
    $('adult-question').textContent=a+' + '+b+' = ?';$('adult-question').dir='ltr';$('adult-answer').value='';$('adult-error').textContent='';
    if(!$('adult-gate').open)$('adult-gate').showModal();$('adult-answer').focus();
  }
  function lockChildren() {
    if(!childMode)return;
    adultUnlocked=false;editing=false;drawerOrdering=false;drawerDraft=[];bulkSelecting=false;selectedSongIds.clear();gateAction=null;
    for(const id of ['parents','edit-dialog','playlist-editor','trash-dialog','adult-gate','backup-saved-dialog','assign-dialog','import-report','audio-diagnostics'])if($(id).open)$(id).close();
    render();renderProtection();
  }
  document.addEventListener('click',event=>{
    if(!childMode||adultUnlocked)return;
    const button=event.target.closest('#backup-shortcut,#import,#edit-toggle,#select-songs,#bulk-add,#bulk-delete,#empty-import,#empty-choose,#create-playlist,.playlist-nav-edit,.playlist-title-button,#undo-delete');
    if(button){event.preventDefault();event.stopImmediatePropagation();requireAdult(()=>button.click());}
  },true);
  $('adult-form').addEventListener('submit',event=>{event.preventDefault();const value=$('adult-answer').value.trim();if(!/^\d+$/.test(value)||Number(value)!==gateAnswer){$('adult-error').textContent='התשובה אינה נכונה. נסו שוב.';return;}adultUnlocked=true;const action=gateAction;gateAction=null;$('adult-gate').close();renderProtection();action?.();});
  $('adult-close').addEventListener('click',()=>$('adult-gate').close());
  $('adult-gate').addEventListener('close',()=>{gateAction=null;});
  $('child-lock').addEventListener('click',()=>adultUnlocked?lockChildren():requireAdult(()=>{$('parents').showModal();refreshStorageEstimate();}));
  $('child-mode-toggle').addEventListener('click',()=>busy(async()=>{childMode=!childMode;await write('meta',[{key:'childMode',value:childMode}]);if(childMode)lockChildren();else renderProtection();}));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)lockChildren();});
  function offerUndo(item){if(!item)return;lastUndoMembership=null;$('undo-delete').textContent='ביטול מחיקה';lastUndoId=item.id;lastUndoIds=[item.id];clearTimeout(undoTimer);$('undo-label').textContent='נמחק: '+item.title;$('undo-bar').hidden=false;undoTimer=setTimeout(()=>$('undo-bar').hidden=true,5000);notify('אפשר לשחזר גם בהמשך דרך אחסון וגיבוי.',5000);}
  async function restoreTrashItem(id){return restoreTrashItems([id]);}
  async function restoreTrashItems(ids) {
    const wanted=new Set(ids),items=trash.filter(item=>wanted.has(item.id));if(!items.length)return;
    let next=[...playlists];const records=[];
    for(const item of items){
      if(item.kind==='song'){
        const track=await read('tracks',item.trackId);if(!track)throw new Error('קובץ השיר אינו זמין לשחזור.');records.push({...track,hidden:false});
      }else{
        if(next.some(p=>p.id===item.playlist.id))throw new Error('פלייליסט עם אותו מזהה כבר קיים.');
        next.splice(Math.min(item.index,next.length),0,item.playlist);
      }
    }
    next=PL.restoreMemberships(next,items);
    const meta=[{key:'playlists',value:PL.validate(next)},{key:'trash',value:trash.filter(item=>!wanted.has(item.id))}];
    await updateTrackState(records.map(t=>({id:t.id,hidden:false})),meta);await reload();renderTrash();$('undo-bar').hidden=true;notify(items.length===1?'הפריט שוחזר':items.length+' פריטים שוחזרו');
  }
  async function purgeTrashItem(id) {
    const item=trash.find(t=>t.id===id);if(!item||!confirm('למחוק לצמיתות את ״'+item.title+'״? לא ניתן יהיה לשחזר מתוך הנגן. גיבוי שכבר שמרת וקובץ המקור אינם נמחקים.'))return;
    await busy(async()=>{
      const meta=[{key:'trash',value:trash.filter(t=>t.id!==id)}];
      if(item.kind==='song'){
        const track=await read('tracks',item.trackId);
        if(track?.hidden){meta.push({key:'trackState:'+track.id,value:null},{key:'songEdit:'+track.id,value:null});if(track.source==='local')await write('tracks',[],[track.id],false,meta);else{const record={...track,trashPurged:true};delete record.blob;await write('tracks',[record],[],false,meta);}}
        else await write('meta',meta);
      }else await write('meta',meta);
      await reload();renderTrash();if(lastUndoId===id)$('undo-bar').hidden=true;refreshStorageEstimate();notify('הפריט נמחק לצמיתות',5000);
    });
  }
  function renderTrash(){const root=$('trash-list');root.replaceChildren();for(const item of [...trash].reverse()){const row=document.createElement('div');row.className='trash-row';const title=document.createElement('span');title.textContent=(item.kind==='song'?'שיר: ':'פלייליסט: ')+item.title;const button=document.createElement('button');button.className='outline';button.textContent='שחזור';button.setAttribute('aria-label','שחזור '+item.title);button.addEventListener('click',()=>busy(()=>restoreTrashItem(item.id)));const purge=document.createElement('button');purge.className='danger';purge.textContent='מחיקה לצמיתות';purge.setAttribute('aria-label','מחיקה לצמיתות של '+item.title);purge.addEventListener('click',()=>purgeTrashItem(item.id));row.append(title,button,purge);root.append(row);}if(!trash.length)root.textContent='אין פריטים שנמחקו.';}
  function openTrash(){requireAdult(()=>{renderTrash();$('trash-dialog').showModal();});}
  $('open-trash').addEventListener('click',openTrash);$('trash-close').addEventListener('click',()=>$('trash-dialog').close());
  $('undo-delete').addEventListener('click',()=>busy(()=>lastUndoMembership?undoMembershipRemoval():restoreTrashItems(lastUndoIds)));
  const megabytes=n=>(n/1024/1024).toLocaleString('he-IL',{maximumFractionDigits:1})+' MB';
  function renderStorage(){const all=visible(),saved=all.filter(t=>t.blob),size=saved.reduce((sum,t)=>sum+t.blob.size,0),deleted=tracks.filter(t=>t.hidden&&t.blob).reduce((sum,t)=>sum+t.blob.size,0);$('storage-summary').textContent=all.length+' שירים בספרייה · '+saved.length+' זמינים אופליין · '+megabytes(size)+' בשירים פעילים · '+megabytes(deleted)+' בפריטים שנמחקו. '+(saved.length===all.length?'נפח השמע בגיבוי: כ־'+megabytes(size)+'.':'יש להשלים הורדה לפני גיבוי מלא.');$('open-trash').textContent='שחזור פריטים שנמחקו ('+trash.length+')';$('app-version').textContent='גרסה: \u2066'+APP_VERSION+'\u2069';}
  async function refreshStorageEstimate(){renderStorage();try{const estimate=await navigator.storage?.estimate?.();$('storage-estimate').textContent=estimate?.quota?'אחסון הדומיין בדפדפן: כ־'+megabytes(estimate.usage||0)+' מתוך מכסה של '+megabytes(estimate.quota)+'. זו הערכה, לא המקום הפנוי בטלפון.':'הדפדפן אינו מספק הערכת מכסת אחסון.';}catch{$('storage-estimate').textContent='הערכת האחסון אינה זמינה.';}}
  async function checkUpdate(silent=false){if(checkingUpdate)return;checkingUpdate=true;$('check-update').disabled=true;if(!silent)$('update-status').textContent='בודקים עדכון…';const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);try{const response=await fetch('./version.json',{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error();const remote=await response.json();if(typeof remote.version!=='string'||remote.version.length>80)throw new Error();const available=remote.version!==APP_VERSION;$('update-status').textContent=available?'זמין עדכון לגרסה '+remote.version+'. טעינתו תרענן את הנגן.':'זו הגרסה העדכנית.';$('apply-update').hidden=!available;const registration=await navigator.serviceWorker?.getRegistration?.();await registration?.update();}catch{$('update-status').textContent='לא ניתן לבדוק עדכון כרגע. הגרסה המקומית ממשיכה לעבוד.';}finally{clearTimeout(timer);checkingUpdate=false;$('check-update').disabled=false;}}
  $('check-update').addEventListener('click',()=>checkUpdate());$('apply-update').addEventListener('click',()=>location.reload());
  function renderBulk(){$('select-songs').hidden=!editing;const visibleIds=new Set(visible().map(t=>t.id));selectedSongIds=new Set([...selectedSongIds].filter(id=>visibleIds.has(id)));$('bulk-bar').hidden=!bulkSelecting;$('bulk-delete').textContent=activePlaylist()?'הסרה מהפלייליסט':'מחיקה מהספרייה';$('bulk-count').textContent=selectedSongIds.size+' נבחרו';$('select-songs').textContent=bulkSelecting?'סיום בחירה':'בחירת כמה שירים';$('select-songs').setAttribute('aria-pressed',String(bulkSelecting));$('bulk-add').disabled=operation||!selectedSongIds.size;$('bulk-delete').disabled=operation||!selectedSongIds.size;}
  $('select-songs').addEventListener('click',()=>{if(operation||!editing)return;requireAdult(()=>{bulkSelecting=!bulkSelecting;selectedSongIds.clear();render();});});
  $('bulk-all').addEventListener('click',()=>{listed().filter(matchesSearch).forEach(t=>selectedSongIds.add(t.id));render();});
  $('bulk-clear').addEventListener('click',()=>{selectedSongIds.clear();render();});
  $('bulk-add').addEventListener('click',()=>openAssignment([...selectedSongIds]));
  $('bulk-delete').addEventListener('click',()=>activePlaylist()?removePlaylistTracks([...selectedSongIds]):deleteTracks([...selectedSongIds]));
  function openAssignment(ids){if(operation)return;requireAdult(()=>{assignIds=ids.filter(id=>visible().some(t=>t.id===id));$('assign-summary').textContent=assignIds.length+' שירים יתווספו לפלייליסט שתבחרי. שירים שכבר נמצאים בו לא יתווספו שוב.';$('assign-error').textContent='';const select=$('assign-target');select.replaceChildren();for(const p of playlists){const option=document.createElement('option');option.value=p.id;option.textContent=p.icon+' '+p.name;select.append(option);}$('assign-save').disabled=!playlists.length||!assignIds.length;select.disabled=!playlists.length;if(!playlists.length)$('assign-error').textContent='אין עדיין פלייליסטים. צרי פלייליסט דרך תפריט התו ואז חזרי לכאן.';$('assign-dialog').showModal();});}
  $('assign-close').addEventListener('click',()=>$('assign-dialog').close());
  $('assign-form').addEventListener('submit',event=>{event.preventDefault();busy(async()=>{try{const next=PL.assign(playlists,$('assign-target').value,assignIds);await write('meta',[{key:'playlists',value:next}],[],true);await reload();$('assign-dialog').close();notify('השירים שויכו לפלייליסט');}catch(error){$('assign-error').textContent=message(error);throw error;}});});
  $('duplicate-playlist').addEventListener('click',()=>{if(operation)return;try{const source={id:playlistEditingId,name:$('playlist-name').value.trim(),icon:$('playlist-icon').value.trim(),color:$('playlist-color').value,trackIds:[...draftTrackIds],sortMode:draftOrderChanged?'manual':draftSortMode,pinned:$('playlist-pinned').checked};const copy=PL.copy(source,'playlist:'+crypto.randomUUID());playlistEditingId=null;draftPlaylistId=copy.id;draftSortMode=copy.sortMode;draftTrackIds=new Set(copy.trackIds);draftOrderChanged=false;$('playlist-name').value=copy.name;$('playlist-editor-title').textContent='עותק של הפלייליסט';$('delete-playlist').hidden=true;$('duplicate-playlist').hidden=true;$('playlist-editor-status').textContent='זהו עותק חדש. הפלייליסט המקורי לא ישתנה. לחצי על שמירה כדי ליצור אותו.';renderPlaylistChoices();}catch(error){$('playlist-editor-status').textContent=message(error);}});
  function showImportReport(report,totals){$('import-report-summary').textContent='נוספו '+totals.added+' שירים · זוהו '+totals.reused+' קבצים כפולים · '+totals.failed+' נכשלו.'+(totals.linked?' '+totals.linked+' שירים קיימים שויכו לפלייליסט.':'')+(totals.recovered?' '+totals.recovered+' שירים שוחזרו.':'');const root=$('import-report-list');root.replaceChildren();for(const item of report){const row=document.createElement('div');row.className='import-report-row';const name=document.createElement('strong');name.textContent=item.name;const detail=document.createElement('p');detail.textContent=item.status+' — '+item.detail;row.append(name,detail);root.append(row);}if(!childMode||adultUnlocked)$('import-report').showModal();}
  for(const id of ['import-report-close','import-report-done'])$(id).addEventListener('click',()=>$('import-report').close());
  async function start() {
    try { db = await openDB(); await reload(); setupOffline(); checkUpdate(true); await refreshCatalog(true); }
    catch(error) { $('fatal').hidden = false; $('fatal').textContent = 'לא ניתן לפתוח את האחסון המקומי. נסי לפתוח בספארי מחוץ לגלישה פרטית. '+message(error); }
  }
  start();
})();
