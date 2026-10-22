const fs=require('fs'),path=require('path');
const qualities={light:0.92,standard:0.82,strong:0.65};
const mimes={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',bmp:'image/bmp'};
function assertStatic(bytes){
 const riff=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(riff||png){let off=riff?12:8;while(off+8<=bytes.length){const size=riff?bytes.readUInt32LE(off+4):bytes.readUInt32BE(off),type=bytes.toString('ascii',off+(riff?0:4),off+(riff?4:8));if(type==='ANIM'||type==='acTL')throw Object.assign(Error('动图暂不发布，避免丢失动画'),{permanent:true});off+=riff?8+size+(size%2):12+size;}}
}
async function encode(file,c){
 const bytes=fs.readFileSync(file),ext=path.extname(file).slice(1).toLowerCase();
 let bitmap,canvas,result,outputBitmap;
 try{
  if(bytes.length>80*1024*1024)throw Error('原图超过 80MB，暂不处理');
  assertStatic(bytes);
  const original=()=>({body:Buffer.from(bytes),ext,mime:mimes[ext],originalBytes:bytes.length,mode:'original'});
  if(c.provider!=='tinypng'&&c.preset==='original')return original();
  bitmap=await createImageBitmap(new Blob([bytes]));
  if(bitmap.width*bitmap.height>80000000)throw Error('图像超过 8000 万像素');
  if(c.provider==='tinypng'){
   if(!c.tinyConsent)throw Object.assign(Error('使用 TinyPNG 需要先授权发送图片'),{permanent:true});
   const credentials=JSON.parse(await require('./storage').keychain('get'));
   result=await require('./tinypng').compress(bytes,ext,credentials.tinyKey);
   outputBitmap=await createImageBitmap(new Blob([result.body]));
   if(outputBitmap.width!==bitmap.width||outputBitmap.height!==bitmap.height)throw Error('压缩服务改变了图片尺寸，未发布该结果');
   result.mode='tinypng';
  }else{
   canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
   canvas.getContext('2d').drawImage(bitmap,0,0);
   const blob=await new Promise(r=>canvas.toBlob(r,'image/webp',qualities[c.preset]||qualities.standard));
   if(!blob||blob.type!=='image/webp')throw Error('运行环境不支持 WebP 编码');
   result={body:Buffer.from(await blob.arrayBuffer()),ext:'webp',mime:'image/webp',mode:'webp'};
  }
  if(result.body.length>=bytes.length){result.body.fill(0);result=null;return original();}
  const output={...result,originalBytes:bytes.length,width:bitmap.width,height:bitmap.height};result=null;return output;
 }finally{if(result)result.body.fill(0);if(outputBitmap)outputBitmap.close();if(bitmap)bitmap.close();if(canvas){canvas.width=0;canvas.height=0;}bytes.fill(0);}
}
module.exports=encode;
