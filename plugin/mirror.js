'use strict';
const fs=require('fs'),path=require('path'),core=require('./core');
const GRACE_MS=7*86400000;
const destination=c=>core.hash(JSON.stringify([c.account,c.bucket,c.domain,c.prefix,c.namespace]));
function rootsFor(item,folders,c){return core.roots(c).filter(f=>f.enabled!==false&&(item.folders||[]).some(id=>core.descendants(folders,f.id).has(id))).map(f=>f.id);}
function healthy(lib,folders,c){
 try{fs.accessSync(lib,fs.constants.R_OK);if(!fs.statSync(lib).isDirectory())return false;}catch(e){return false;}
 const active=core.roots(c).filter(f=>f.enabled!==false);
 return active.length>0&&active.every(f=>core.descendants(folders,f.id).size>0);
}
function owned(c,lib,id,r){
 if(!r||!r.key||r.cloudDeletedAt||typeof c.namespace!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(c.namespace))return null;
 const match=r.key.match(/\/([a-f0-9]{64})-([a-f0-9]{64})\.([a-z0-9]+)$/);
 if(!match)return null;
 try{if(core.objectKey(c,lib,id,match[1],match[2],match[3],r.versionNonce||'')!==r.key)return null;}catch(e){return null;}
 const dest=destination(c),legacy=core.hash(JSON.stringify([c.account,c.bucket,c.domain,c.prefix,c.namespace,c.quality,c.maxSize]));
 if(r.destination!==dest&&!(r.destination==null&&r.target===legacy))return null;
 return {key:r.key,url:r.url,destination:dest,outputHash:match[2],etag:r.etag||null};
}
function reset(state){if(state.mirror){state.mirror.pending={};state.mirror.absent={};state.mirror.policy=null;}}
class Mirror{
 constructor(engine,now=()=>Date.now()){this.engine=engine;this.now=now;}
 async reconcile(c,lib,state,seen,folders){
  const e=this.engine,now=this.now();
  if(c.mirrorEnabled!==true||!c.enabled||!healthy(lib,folders,c)){reset(state);return;}
  const policy=core.hash(JSON.stringify([lib,destination(c),core.roots(c).filter(f=>f.enabled!==false).map(f=>f.id).sort()]));
  if(state.mirror?.policy!==policy)state.mirror={version:1,policy,pending:{},absent:{},retained:state.mirror?.retained||{}};
  const m=state.mirror,active=new Set(core.roots(c).filter(f=>f.enabled!==false).map(f=>f.id)),wanted=new Set();
  const queue=(id,r,reason)=>{
   const info=owned(c,lib,id,r);if(!info)return;
   const token=core.hash(info.destination+'|'+info.key);wanted.add(token);if(m.retained[token])return;
   if(!m.pending[token])m.pending[token]={...info,token,id,name:state.items[id].name||id,reason,createdAt:now,deleteAfter:now+GRACE_MS,attempts:0};
   // Restoring then changing content starts a fresh grace period for the previous version.
   if(m.pending[token].reason!==reason)m.pending[token]={...m.pending[token],reason,createdAt:now,deleteAfter:now+GRACE_MS,phase:'pending',retryAt:0,error:null,blocked:false};
  };
  for(const [id,r]of Object.entries(state.items)){
   if(!e.current(c,lib))return;
   let item=seen.has(id)?seen.get(id):await e.eagle.item.getById(id);
   const inside=item&&!item.isDeleted&&(item.folders||[]).some(id=>core.syncIds(folders,c).has(id));
   if(inside){
    delete m.absent[id];r.managedRoots=rootsFor(item,folders,c);
    // Only successful, known versions can make older versions eligible for cleanup.
    if(r.url&&!r.cloudDeletedAt)for(const h of r.history||[])if(h.key!==r.key)queue(id,h,'replaced');
   }else{
    // Never infer ownership for an old item first encountered outside the configured scope.
    if(!r.managedRoots?.length||!r.managedRoots.every(id=>active.has(id))){delete m.absent[id];continue;}
    const absence=m.absent[id]||(m.absent[id]={count:0});absence.count++;
    if(absence.count>=2){queue(id,r,'missing');for(const h of r.history||[])queue(id,h,'missing');}
   }
  }
  for(const token of Object.keys(m.pending))if(!wanted.has(token))delete m.pending[token];
  this.retainRequests(lib,state);
  e.persist(lib,state); // Persist a deletion intent before any network request.
  let processed=0;
  for(const task of Object.values(m.pending)){
   if(processed>=5)break;
   if(task.deleteAfter>now||task.retryAt>now||task.blocked)continue;
   if(!Number.isFinite(task.createdAt)||!Number.isFinite(task.deleteAfter)||task.createdAt>now||task.deleteAfter-task.createdAt<GRACE_MS)continue;
   try{
    if(!await this.eligible(c,lib,state,task))continue;
    processed++;
    const credentials=JSON.parse(await e.store.keychain('get'));
    const head=await e.transport(c,credentials,'HEAD',task.key);
    if(head.status!==404){
     if(head.status!==200)throw Object.assign(Error('云端删除检查失败：R2 HTTP '+head.status),{blocked:[401,403].includes(head.status)});
     let expected=task.etag;
     if(!expected){
      // Older releases did not store output ETags. Verify their content by streaming it once.
      const get=await e.transport(c,credentials,'GET',task.key);
      if(get.status!==200||get.sha256!==task.outputHash||get.etag!==head.etag)throw Object.assign(Error('旧对象内容无法核实，已停止删除'),{blocked:true});
      expected=get.etag;task.etag=expected;e.persist(lib,state);
     }
     if(!expected||head.etag!==expected)throw Object.assign(Error('云端对象已变化，已停止删除'),{blocked:true});
     // R2 S3 ignores If-Match on DELETE (verified against an isolated object).
     // HEAD verification is not an atomic lock: other tools must not overwrite this private namespace.
     // Final fresh SDK/config check after network verification.
     if(!await this.eligible(c,lib,state,task))continue;
     task.phase='deleting';const tracked=state.items[task.id];for(const v of [tracked,...(tracked.history||[])])if(v.key===task.key)v.deleteUncertain=true;e.persist(lib,state);
     const result=await e.transport(c,credentials,'DELETE',task.key);
     if(![200,202,204,404].includes(result.status))throw Object.assign(Error('云端删除失败：R2 HTTP '+result.status),{blocked:[401,403,412].includes(result.status),retryAfterMs:result.retryAfterMs});
    }
    const record=state.items[task.id];
    for(const version of [record,...(record.history||[])])if(version.key===task.key){version.cloudDeletedAt=new Date(now).toISOString();version.deleteUncertain=false;if(version===record){version.url=null;version.status='cloud-deleted';}}
    delete m.pending[task.token];e.persist(lib,state);
   }catch(error){task.error=error.message;task.blocked=!!error.blocked;task.attempts++;task.retryAt=now+Math.max(error.retryAfterMs||0,Math.min(3600000,60000*2**Math.min(task.attempts-1,6)));e.persist(lib,state);}
  }
 }
 retainRequests(lib,state){
  const e=this.engine,requestFile=e.store.root&&path.join(e.store.root,'mirror-retain-request.json');
  if(requestFile&&fs.existsSync(requestFile)){
   const request=core.read(requestFile,{});
   if(request.library===lib){for(const token of request.tokens||[])if(state.mirror.pending[token]){state.mirror.retained[token]=true;delete state.mirror.pending[token];}e.persist(lib,state);fs.unlinkSync(requestFile);}
  }
 }
 async eligible(c,lib,state,task){
  const e=this.engine;if(!e.current(c,lib)||c.mirrorEnabled!==true)return false;this.retainRequests(lib,state);if(!state.mirror.pending[task.token]||task.destination!==destination(c)||task.token!==core.hash(task.destination+'|'+task.key))return false;
  const folders=await e.eagle.folder.getAll();if(!healthy(lib,folders,c))return false;
  const r=state.items[task.id];if(!r)return false;
  const item=await e.eagle.item.getById(task.id),inside=item&&!item.isDeleted&&(item.folders||[]).some(id=>core.syncIds(folders,c).has(id));
  if(task.reason==='missing'&&inside){delete state.mirror.pending[task.token];return false;}
  if(task.reason==='replaced'&&(!inside||!r.url||r.key===task.key||r.cloudDeletedAt))return false;
  const match=[r,...(r.history||[])].find(v=>v.key===task.key);
  return !!owned(c,lib,task.id,match)&&e.current(c,lib);
 }
}
module.exports={Mirror,GRACE_MS,destination,rootsFor,reset};
