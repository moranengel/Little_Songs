const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const app=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const worker=new EventTarget();worker.state='installing';let reloaded=0,requests=0,notices=[];
const button={disabled:false,setAttribute(){},removeAttribute(){}};
const ctx={$:()=>button,operation:false,notify:m=>notices.push(m),AbortController,setTimeout,clearTimeout,navigator:{serviceWorker:{getRegistration:async()=>({installing:worker,update:async()=>setTimeout(()=>{worker.state='activated';worker.dispatchEvent(new Event('statechange'))},10)})}},fetch:async(_url,options)=>{requests++;assert.equal(options.cache,'no-store');return {ok:true,json:async()=>({version:'new'})}},location:{reload(){assert.equal(worker.state,'activated');reloaded++}}};
vm.createContext(ctx);vm.runInContext(app.slice(app.indexOf('  let pullingVersion=false;'),app.indexOf("  $('version-shortcut').addEventListener")),ctx);
(async()=>{
 const pending=ctx.pullLatestVersion();await ctx.pullLatestVersion();assert.equal(reloaded,0,'Wait for installation before reload');await pending;assert.equal(reloaded,1);assert.equal(requests,1,'Double clicks do not start another pull');assert.equal(button.disabled,false);
 ctx.fetch=async()=>{throw Error('offline')};await ctx.pullLatestVersion();assert.equal(reloaded,1,'Failure must not reload');assert.ok(notices.at(-1).includes('לא ניתן'));assert.equal(button.disabled,false);
 ctx.operation=true;requests=0;ctx.fetch=async()=>{requests++;};await ctx.pullLatestVersion();assert.equal(requests,0,'Do not interrupt an active write');
 ctx.operation=false;ctx.fetch=async()=>({ok:true,json:async()=>({version:''})});await ctx.pullLatestVersion();assert.equal(reloaded,1,'Invalid version must not reload');
 console.log('PASS: no-store version pull, wait for worker activation, duplicate click prevention, offline/invalid responses and active-write guard.');
})().catch(e=>{console.error(e);process.exitCode=1});
