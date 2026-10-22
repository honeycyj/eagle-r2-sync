'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const media = require('./media');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const uri = key => '/' + key.split('/').map(enc).join('/');
function atomic(file, value) {
 fs.mkdirSync(path.dirname(file), {recursive:true, mode:0o700});
 const tmp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
 fs.writeFileSync(tmp, JSON.stringify(value,null,2), {mode:0o600}); fs.renameSync(tmp,file);
}
function read(file, fallback) {
 try {return JSON.parse(fs.readFileSync(file,'utf8'));} catch(e) {if(e.code==='ENOENT')return fallback; throw new Error('本地状态损坏，请备份后检查：'+path.basename(file));}
}
function validate(c) {
 if(c.mirrorEnabled!==undefined&&typeof c.mirrorEnabled!=='boolean')throw Error('同步删除选项必须为开关值');
 if(!/^[a-f0-9]{32}$/i.test(c.account))throw Error('Account ID 应为 32 位十六进制');
 if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(c.bucket))throw Error('桶名不合法');
 const d = new URL(c.domain); if(d.protocol!=='https:'||d.username||d.password||d.search||d.hash)throw Error('公开域名需要 HTTPS，不能包含凭据或查询参数');
 c.domain=c.domain.replace(/\/+$/,'');
 c.prefix=c.prefix.trim().replace(/^\/+|\/+$/g,'');
 if(c.prefix.split('/').some(x=>x==='..'||x==='.')||/[\x00-\x1f\\]/.test(c.prefix))throw Error('发布目录不合法');
 if((c.enabled&&!roots(c).length)||(roots(c).length&&!c.library))throw Error('请添加至少一个 Eagle 文件夹');
 if(c.folders&&c.folders.some(f=>!f||typeof f.id!=='string'||!f.id))throw Error('文件夹配置不合法');
 if(c.preset&&!['original','light','standard','strong'].includes(c.preset))throw Error('压缩档位不合法');
 if(c.provider&&!['local','tinypng'].includes(c.provider))throw Error('压缩服务不合法');
 if(c.provider==='tinypng'&&!c.tinyConsent)throw Error('使用 TinyPNG 前需要勾选图片发送授权');
 return c;
}
function roots(c){return Array.isArray(c.folders)?c.folders:(c.folder?[{id:c.folder,name:c.folderName||c.folder,enabled:true}]:[]);}
function syncIds(folders,c){const ids=new Set();for(const f of roots(c)){if(f.enabled!==false)for(const id of descendants(folders,f.id))ids.add(id);}return ids;}
function descendants(folders, id) {
 const result=new Set();
 function find(nodes){for(const f of nodes){if(f.id===id)collect(f);else find(f.children||[]);}}
 function collect(f){if(result.has(f.id))return;result.add(f.id);for(const ch of f.children||[])collect(ch);}
 find(folders); return result;
}
function sign({method,host,key,body=Buffer.alloc(0),credentials,date=new Date(),headers={},payloadHash}) {
 const stamp=date.toISOString().replace(/[:-]|\.\d{3}/g,''), day=stamp.slice(0,8), scope=day+'/auto/s3/aws4_request';
 const h={host,'x-amz-content-sha256':payloadHash||hash(body),'x-amz-date':stamp,...headers};
 const names=Object.keys(h).sort(), signed=names.join(';');
 const canonical=[method,uri(key),'',names.map(n=>n+':'+String(h[n]).trim()+'\n').join(''),signed,h['x-amz-content-sha256']].join('\n');
 const mac=(k,s)=>crypto.createHmac('sha256',k).update(s).digest();
 let k=mac('AWS4'+credentials.secret,day);k=mac(k,'auto');k=mac(k,'s3');k=mac(k,'aws4_request');
 const signature=mac(k,['AWS4-HMAC-SHA256',stamp,scope,hash(canonical)].join('\n')).toString('hex');
 h.authorization=`AWS4-HMAC-SHA256 Credential=${credentials.access}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
 return h;
}
const uploadAgent=new https.Agent({keepAlive:true,maxSockets:2});
function retryAfter(value,now=Date.now()){
 if(!value)return 0;
 const seconds=Number(value);return Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(value)-now)||0;
}
function request(c,credentials,method,key,body=Buffer.alloc(0),extra={}) {
 const host=c.account+'.r2.cloudflarestorage.com',full=c.bucket+'/'+key,file=body&&body.filePath?body:null;
 const headers=sign({method,host,key:full,body:file?Buffer.alloc(0):body,credentials,headers:extra,payloadHash:file?.sha256});
 headers['content-length']=file?file.size:body.length;
 return new Promise((resolve,reject)=>{
  let stream,timer,settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(stream)stream.destroy();error?reject(error):resolve(value);};
  const req=https.request({hostname:host,path:uri(full),method,headers,agent:uploadAgent},res=>{
   res.on('error',()=>finish(Error('R2 响应中断')));res.on('aborted',()=>finish(Error('R2 响应中断')));
   const responseHash=method==='GET'?crypto.createHash('sha256'):null;if(responseHash)res.on('data',chunk=>responseHash.update(chunk));res.resume();res.on('end',()=>finish(null,{status:res.statusCode,etag:res.headers.etag,sha256:responseHash?responseHash.digest('hex'):undefined,retryAfterMs:retryAfter(res.headers['retry-after'])}));
  });
  timer=setTimeout(()=>req.destroy(Object.assign(Error('total timeout'),{code:'R2_TOTAL_TIMEOUT'})),3600000);
  req.setTimeout(60000,()=>req.destroy(Object.assign(Error('idle timeout'),{code:'R2_IDLE_TIMEOUT'})));
  req.on('error',error=>finish(Error(error.code==='R2_TOTAL_TIMEOUT'?'上传超过 1 小时，稍后重试':error.code==='R2_IDLE_TIMEOUT'?'网络 60 秒无响应，稍后重试':'R2 网络连接失败或文件传输中断')));
  req.on('close',()=>{if(stream)stream.destroy();});
  if(file){
   try{
    if(media.identity(fs.statSync(file.filePath))!==file.identity){req.destroy();return finish(Error('视频已变化，等待下一轮重新上传'));}
    stream=fs.createReadStream(file.filePath);let sent=0;
    stream.on('data',chunk=>{sent+=chunk.length;if(file.onProgress){try{file.onProgress(Math.min(100,Math.round(sent/file.size*100)));}catch(e){}}});
    stream.on('error',()=>req.destroy());stream.pipe(req);
   }catch(e){req.destroy();finish(Error('无法读取视频原文件'));}
  }else req.end(body);
 });
}
function objectKey(c, library, id, digest, outputHash, ext='webp',versionNonce='') {
 // Full digests plus a persisted random publisher namespace avoid collisions with existing URLs.
 if(!media.type(ext))throw Error('不支持的输出格式');if(versionNonce&&!/^[a-f0-9]{16}$/.test(versionNonce))throw Error('版本标识不合法');
 return [c.prefix,c.namespace,hash(library).slice(0,24),enc(id),versionNonce,digest+'-'+outputHash+'.'+ext].filter(Boolean).join('/');
}
function publicURL(c,key){return c.domain+uri(key);}
module.exports={hash,atomic,read,validate,descendants,roots,syncIds,sign,request,objectKey,publicURL,uri,retryAfter};
