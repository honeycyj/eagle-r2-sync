'use strict';
const fs=require('fs'),crypto=require('crypto');
const core=require('./core'),store=require('./storage'),media=require('./media'),mirror=require('./mirror');
class Engine {
 constructor(eagle,encode,transport=core.request,storage=store,options={}){
  this.eagle=eagle;this.encode=encode;this.transport=transport;this.store=storage;
  this.mirror=new mirror.Mirror(this,options.now);this.busy=false;this.error=null;this.fingerprints=new Map();this.message='尚未启用';
 }
 current(c,lib){const live=this.store.config();return live.enabled&&JSON.stringify(live)===JSON.stringify(c)&&this.eagle.library.path===lib;}
 persist(lib,state){state.updatedAt=new Date().toISOString();core.atomic(this.store.statePath(lib),state);}
 async digest(item,lib,stat,video){
  const fingerprint=lib+'|'+item.filePath+'|'+media.identity(stat),cached=this.fingerprints.get(item.id);
  if(cached?.fingerprint===fingerprint&&cached.until>Date.now())return cached;
  const hashes=video?await media.hashFile(item.filePath):{sha256:core.hash(fs.readFileSync(item.filePath))};
  const value={...hashes,fingerprint,until:Date.now()+(video?600000:60000)};
  this.fingerprints.set(item.id,value);return value;
 }
 async inScope(item,c){
  const fresh=await this.eagle.item.getById(item.id),ids=core.syncIds(await this.eagle.folder.getAll(),c);
  return fresh&&!fresh.isDeleted&&(fresh.folders||[]).some(id=>ids.has(id));
 }
 async scan(){
  if(this.busy)return;this.busy=true;
  try{
   this.error=null;const c=this.store.config();if(!c.enabled){if(c.library){const state=this.store.state(c.library);mirror.reset(state);this.persist(c.library,state);}this.message='已暂停';return;}core.validate(c);
   const lib=this.eagle.library.path;if(lib!==c.library){this.message='当前资源库未绑定，未上传';return;}
   const folders=await this.eagle.folder.getAll(),ids=core.syncIds(folders,c);if(!ids.size){const state=this.store.state(lib);mirror.reset(state);this.persist(lib,state);this.message='没有已启用且存在的同步文件夹';return;}
   const state=this.store.state(lib),seen=new Map(),all=new Map();
   for(const id of ids)for(const item of await this.eagle.item.get({folders:[id]}))all.set(item.id,item);
   let credentials;
   for(const item of all.values()){
    if(!this.current(c,lib))break;
    if(item.isDeleted||!(item.folders||[]).some(id=>ids.has(id)))continue;seen.set(item.id,item);
    const prev=state.items[item.id]||{history:[]},format=media.type(item.ext);
    if(!format){state.items[item.id]={...prev,status:'skipped',error:'暂不支持此文件格式'};continue;}
    let body;
    try{
     const stat=fs.statSync(item.filePath),video=format.kind==='video',sourceIdentity=media.identity(stat);
     // Replaced files can recover from a previous permanent error without manual retry.
     if((prev.blocked||prev.retryAt>Date.now())&&prev.sourceIdentity===sourceIdentity)continue;
     if(Date.now()-stat.mtimeMs<3000)continue;
     const limit=video?media.MAX_VIDEO_BYTES:media.MAX_IMAGE_BYTES;
     if(stat.size===0)throw Object.assign(Error('文件为空，等待有效内容'),{permanent:true});
     if(stat.size>limit)throw Object.assign(Error(video?'视频超过单次上传上限 5 GiB，暂不支持分片上传':'图片超过 80 MB，暂不处理'),{permanent:true});
     const cachedVideo=this.fingerprints.get(item.id);
     if(video&&!(cachedVideo?.fingerprint===lib+'|'+item.filePath+'|'+sourceIdentity&&cachedVideo.until>Date.now())){state.items[item.id]={...prev,status:'hashing',error:null};this.persist(lib,state);}
     const hashes=await this.digest(item,lib,stat,video),digest=hashes.sha256;
     if(media.identity(fs.statSync(item.filePath))!==sourceIdentity)throw Error('文件正在变化，等待下一轮');
     const destination=core.hash(JSON.stringify([c.account,c.bucket,c.domain,c.prefix,c.namespace]));
     const target=core.hash(JSON.stringify([c.account,c.bucket,c.domain,c.prefix,c.namespace,c.quality,c.maxSize]));
     if(prev.digest===digest&&prev.url&&!prev.cloudDeletedAt&&!prev.deleteUncertain&&(prev.destination===destination||(!prev.destination&&prev.target===target))){state.items[item.id]={...prev,destination,sourceIdentity,status:'published',error:null,blocked:false,name:item.name||prev.name||item.id,managedRoots:mirror.rootsFor(item,folders,c)};continue;}
     let encoded;
     if(video){body={filePath:item.filePath,size:stat.size,sha256:digest,md5:hashes.md5,identity:sourceIdentity};encoded={ext:format.ext,mime:format.mime,mode:'video',originalBytes:stat.size};}
     else{
      state.items[item.id]={...prev,status:'encoding',error:null};this.persist(lib,state);
      encoded=await this.encode(item.filePath,c);body=Buffer.isBuffer(encoded)?encoded:encoded.body;
      if(core.hash(fs.readFileSync(item.filePath))!==digest)throw Error('处理时原图已变化，等待下一轮');
     }
     if(!this.current(c,lib))break;
     if(!await this.inScope(item,c)){state.items[item.id]={...prev,status:'out-of-scope'};continue;}
     if(!credentials){credentials=JSON.parse(await this.store.keychain('get'));if(!credentials.access||!credentials.secret)throw Error('请先保存 R2 凭据');}
     const ext=encoded.ext||'webp',mime=encoded.mime||'image/webp',bytes=video?stat.size:body.length;
     let versionNonce=prev.cloudDeletedAt||prev.deleteUncertain?crypto.randomBytes(8).toString('hex'):prev.versionNonce||'';
     const outputHash=video?digest:core.hash(body);let key=core.objectKey(c,lib,item.id,digest,outputHash,ext,versionNonce);
     if((prev.history||[]).some(h=>h.key===key&&(h.cloudDeletedAt||h.deleteUncertain))){versionNonce=crypto.randomBytes(8).toString('hex');key=core.objectKey(c,lib,item.id,digest,outputHash,ext,versionNonce);}
     state.items[item.id]={...prev,status:'uploading',error:null,progress:0};this.persist(lib,state);
     if(video){let last=0;body.onProgress=percent=>{if(percent<100&&Date.now()-last<1000)return;last=Date.now();state.items[item.id].progress=percent;this.persist(lib,state);};}
     const response=await this.transport(c,credentials,'PUT',key,body,{'content-type':mime,'cache-control':'public, max-age=31536000, immutable','if-none-match':'*'});
     if(video&&media.identity(fs.statSync(item.filePath))!==sourceIdentity)throw Error('上传时视频已变化，等待下一轮重新上传');
     if(response.status===412){
      const head=await this.transport(c,credentials,'HEAD',key);
      const expected='"'+(video?hashes.md5:crypto.createHash('md5').update(body).digest('hex'))+'"';
      if(head.status!==200||head.etag!==expected)throw Error('同名对象存在且无法验证，未覆盖');
     }else if(response.status<200||response.status>=300)throw Object.assign(Error('R2 HTTP '+response.status+'；请检查凭据、权限和桶名'),{permanent:[401,403,404].includes(response.status),retryAfterMs:response.retryAfterMs||0});
     const record={versionNonce,etag:response.etag||(video?'"'+hashes.md5+'"':'"'+crypto.createHash('md5').update(body).digest('hex')+'"'),name:item.name||item.id,managedRoots:mirror.rootsFor(item,folders,c),key,url:core.publicURL(c,key),digest,target,destination,sourceIdentity,bytes,originalBytes:encoded.originalBytes||stat.size,format:ext,mode:encoded.mode||'webp',publishedAt:new Date().toISOString()};
     state.items[item.id]={...record,status:'published',error:null,failures:0,history:[...(prev.history||[]),...(prev.url?[Object.fromEntries(['url','key','publishedAt','etag','destination','target','digest','format','bytes','cloudDeletedAt','versionNonce','deleteUncertain'].filter(k=>prev[k]!==undefined).map(k=>[k,prev[k]]))]:[])]};
    }catch(error){
     const failures=(prev.failures||0)+1;let sourceIdentity;try{sourceIdentity=media.identity(fs.statSync(item.filePath));}catch(e){}
     state.items[item.id]={...prev,sourceIdentity,status:'error',error:error.message,failures,blocked:!!error.permanent,retryAt:Date.now()+Math.max(error.retryAfterMs||0,Math.min(300000,15000*2**Math.min(failures-1,5)))};
    }finally{if(Buffer.isBuffer(body))body.fill(0);body=null;}
    this.persist(lib,state);
   }
   for(const [id,r]of Object.entries(state.items))if(!seen.has(id)){r.status='out-of-scope';this.fingerprints.delete(id);}
   if(this.current(c,lib))await this.mirror.reconcile(c,lib,state,seen,folders);
   this.persist(lib,state);this.message='扫描完成 '+new Date().toLocaleTimeString();
  }catch(error){this.message=error.message;this.error=error.message;}finally{this.busy=false;}
 }
}
module.exports=Engine;
