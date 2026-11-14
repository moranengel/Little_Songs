'use strict';
(() => {
  const normalize = text => String(text).normalize('NFKD').replace(/[\u0591-\u05c7]/g,'').toLocaleLowerCase('he').trim();
  function validate(value, allowedIds) {
    if (!Array.isArray(value) || value.length > 1000) throw new Error('רשימת הפלייליסטים אינה תקינה.');
    const seen = new Set(); const allowed = allowedIds && new Set(allowedIds);
    return value.map(p => {
      if (!p || typeof p.id!=='string' || !p.id || p.id==='all' || p.id.length>240 || seen.has(p.id) || typeof p.name!=='string' || !p.name.trim() || p.name.length>80 || typeof p.icon!=='string' || !p.icon || [...p.icon].length>24 || typeof p.color!=='string' || !/^#[a-f0-9]{6}$/i.test(p.color) || !Array.isArray(p.trackIds) || p.trackIds.length>10000 || p.trackIds.some(id=>typeof id!=='string'||!id||id.length>240) || new Set(p.trackIds).size!==p.trackIds.length || (allowed && p.trackIds.some(id=>!allowed.has(id))) || !['manual','name'].includes(p.sortMode || 'manual')) throw new Error('פרטי הפלייליסט אינם תקינים.');
      if(p.pinned!==undefined&&typeof p.pinned!=='boolean')throw new Error('סימון הנעיצה אינו תקין.');
      seen.add(p.id); return {id:p.id,name:p.name.trim(),icon:p.icon,color:p.color,trackIds:[...p.trackIds],sortMode:p.sortMode || 'manual',...(p.pinned===undefined?{}:{pinned:p.pinned})};
    });
  }
  function select(tracks, playlist, sortMode='manual') {
    const all = tracks.filter(t=>!t.hidden); const map = new Map(all.map(t=>[t.id,t]));
    const result = playlist ? playlist.trackIds.map(id=>map.get(id)).filter(Boolean) : [...all].sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
    return (playlist?.sortMode || sortMode)==='name' ? result.sort((a,b)=>a.title.localeCompare(b.title,'he')) : result;
  }
  function shuffled(ids, random=Math.random) {
    const out=[...ids]; for(let i=out.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;
  }
  function queue(ids,startId,shuffle=false,random=Math.random) {
    if (!ids.includes(startId)) return [];
    return shuffle ? [startId,...shuffled(ids.filter(id=>id!==startId),random)] : [...ids];
  }
  function adjacent(ids,currentId,offset,repeat='off') {
    if (!ids.length) return null; const i=ids.indexOf(currentId);if(i<0)return null;
    const next=i+offset;
    return next>=0 && next<ids.length ? ids[next] : repeat==='all' ? ids[(next+ids.length)%ids.length] : null;
  }
  function assign(playlists,targetId,ids) {
    if(!playlists.some(p=>p.id===targetId))throw new Error('בחרי פלייליסט קיים.');
    return validate(playlists.map(p=>p.id===targetId?{...p,trackIds:[...new Set([...p.trackIds,...ids])]}:p));
  }
  function copy(playlist,id) {
    return validate([{...playlist,id,name:playlist.name.slice(0,72)+' — עותק',trackIds:[...playlist.trackIds]}])[0];
  }
  function planRemoval(tracks,playlists,ids) {
    const selected=new Set(ids),found=tracks.filter(t=>!t.hidden&&selected.has(t.id));
    const deleted=found.map(t=>({trackId:t.id,title:t.title,memberships:playlists.filter(p=>p.trackIds.includes(t.id)).map(p=>({id:p.id,index:p.trackIds.indexOf(t.id)}))}));
    const actual=new Set(found.map(t=>t.id));
    return {records:found.map(t=>({...t,hidden:true,trashPurged:false})),playlists:playlists.map(p=>({...p,trackIds:p.trackIds.filter(id=>!actual.has(id))})),deleted};
  }
  function restoreMemberships(playlists,items) {
    return playlists.map(p=>{
      let ids=[...p.trackIds];
      const members=items.filter(item=>item.kind==='song').flatMap(item=>item.memberships.filter(m=>m.id===p.id).map(m=>({id:item.trackId,index:m.index}))).sort((a,b)=>a.index-b.index);
      for(const member of members){ids=ids.filter(id=>id!==member.id);ids.splice(Math.min(Math.max(0,member.index),ids.length),0,member.id);}
      return {...p,trackIds:ids};
    });
  }
  function sidebar(playlists){return [...playlists.filter(p=>p.pinned),...playlists.filter(p=>!p.pinned)];}
  function moveSidebar(playlists,id,targetId){const out=[...playlists],from=out.findIndex(p=>p.id===id),to=out.findIndex(p=>p.id===targetId);if(from<0||to<0||from===to||!!out[from].pinned!==!!out[to].pinned)return out;const [item]=out.splice(from,1);out.splice(to,0,item);return out;}
  function upsertSidebar(playlists,playlist){const old=playlists.find(p=>p.id===playlist.id);const next=old&&!!old.pinned===!!playlist.pinned?playlists.map(p=>p.id===playlist.id?playlist:p):[...playlists.filter(p=>p.id!==playlist.id),playlist];return validate(sidebar(next));}
  function removeMembership(playlists,playlistId,ids){const p=playlists.find(p=>p.id===playlistId);if(!p)throw new Error('הפלייליסט אינו קיים.');const selected=new Set(ids),removed=p.trackIds.flatMap((id,index)=>selected.has(id)?[{trackId:id,index}]:[]);return {playlistId,removed,playlists:playlists.map(q=>q.id===p.id?{...q,trackIds:q.trackIds.filter(id=>!selected.has(id))}:q)};}
  const api={validate,select,normalize,shuffled,queue,adjacent,assign,copy,planRemoval,restoreMemberships,sidebar,moveSidebar,upsertSidebar,removeMembership};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else window.LittleSongsPlaylists=api;
})();
