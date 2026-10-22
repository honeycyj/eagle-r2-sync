'use strict';
const https=require('https');
const MAX=80*1024*1024;
function request(url,method,headers,body){
 const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='api.tinify.com'||u.port||u.username||u.password)throw Error('TinyPNG 返回了不可信的地址');
 return new Promise((resolve,reject)=>{
  let parts=[],total=0,done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);for(const p of parts)p.fill(0);parts=[];error?reject(error):resolve(value);};
  const req=https.request({hostname:u.hostname,path:u.pathname+u.search,method,headers:{...headers,...(body?{'content-length':body.length}:{})}},res=>{
   res.on('data',chunk=>{total+=chunk.length;if(total>MAX){req.destroy();finish(Error('TinyPNG 响应超过处理上限'));}else parts.push(chunk);});
   res.on('end',()=>{const data=Buffer.concat(parts);finish(null,{status:res.statusCode,headers:res.headers,body:data});});
   res.on('aborted',()=>finish(Error('TinyPNG 响应中断')));res.on('error',()=>finish(Error('TinyPNG 响应中断')));
  });
  const timer=setTimeout(()=>{req.destroy();finish(Error('TinyPNG 请求超时'));},120000);
  req.on('error',()=>finish(Error('TinyPNG 网络连接失败')));req.end(body);
 });
}
async function compress(bytes,ext,key,transport=request){
 if(!key)throw Object.assign(Error('请先保存 TinyPNG API Key'),{permanent:true});
 if(!['jpg','jpeg','png','webp'].includes(ext))throw Object.assign(Error('TinyPNG 暂不处理此图片格式，请选择本地处理'),{permanent:true});
 const headers={authorization:'Basic '+Buffer.from('api:'+key).toString('base64'),'content-type':'application/octet-stream'};
 const response=await transport('https://api.tinify.com/shrink','POST',headers,bytes);
 try{
  if(response.status!==201){throw Object.assign(Error('TinyPNG HTTP '+response.status+([401,402].includes(response.status)?'：请检查密钥或额度，更新后手动重试':'')),{permanent:[400,401,402,413,415].includes(response.status),retryAfterMs:60000});}
  const u=new URL(response.headers.location);
  if(u.protocol!=='https:'||u.hostname!=='api.tinify.com'||u.port||u.username||u.password||!/^\/output\/[^/?#]+$/.test(u.pathname)||u.search||u.hash)throw Error('TinyPNG 返回了不可信的结果地址');
  const output=await transport(u.href,'GET',{authorization:headers.authorization});
  if(output.status!==200){output.body.fill(0);throw Error('TinyPNG 下载结果失败 HTTP '+output.status);}
  const mime=String(output.headers['content-type']||'').split(';')[0];
  const format=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[mime];
  if(!format){output.body.fill(0);throw Error('TinyPNG 返回了不支持的结果格式');}
  return{body:output.body,ext:format,mime};
 }finally{response.body.fill(0);}
}
module.exports={compress};
