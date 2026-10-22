eagle.onPluginCreate(plugin=>{
 const path=require('path'),store=require(path.join(plugin.path,'storage.js')),core=require(path.join(plugin.path,'core.js'));
 const {scope}=require(path.join(plugin.path,'scope.js'));
 const $=id=>document.getElementById(id),size=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':(n/1024).toFixed(1)+' KB';
 let url='',busy=false,itemId;const labels={hashing:'准备上传',published:'已发布',encoding:'正在压缩',uploading:'正在上传',error:'上传失败',skipped:'已跳过'};
 const theme=v=>document.documentElement.dataset.theme=['LIGHT','LIGHTGRAY'].includes(String(v).toUpperCase())?'light':'dark';theme(eagle.app.theme);if(eagle.onThemeChanged)eagle.onThemeChanged(theme);
 async function render(){if(busy)return;busy=true;try{
  itemId=new URLSearchParams(location.search).get('id')||(await eagle.item.getSelected())[0]?.id;
  const c=store.config(),item=itemId&&await eagle.item.getById(itemId);
  const visible=!!item&&await scope(eagle,c,item);document.body.hidden=!visible;if(!visible){url='';return;}
  const r=store.state(eagle.library.path).items[itemId];url=r?.url||'';
  $('status').textContent=(r?labels[r.status]||'等待上传':'等待上传')+(r?.status==='uploading'&&r.progress!==undefined?' '+r.progress+'%':'')+(!c.enabled?' · 已暂停':'');$('dot').dataset.status=r?.status||'waiting';
  $('copy').disabled=!url;$('retry').hidden=!r||!['error','skipped'].includes(r.status);
  const reduction=r?.originalBytes?Math.max(0,Math.round((1-r.bytes/r.originalBytes)*100)):null;
  $('details').textContent=r?.error|| (r?.bytes?[(r.format||'webp').toUpperCase(),size(r.bytes),r.mode==='video'?'原文件 · 未压缩':reduction===null?'':r.mode==='original'?'保留原格式':'节省 '+reduction+'%',r.mode==='video'?'无视频副本':'无本地压缩缓存'].filter(Boolean).join(' · '):'自动处理，无需操作');
 }catch(e){document.body.hidden=true;}finally{busy=false;}}
 $('copy').onclick=async()=>{if(url){await eagle.clipboard.writeText(url);$('copy').textContent='已复制';setTimeout(()=>$('copy').textContent='复制链接',1500);}};
 $('retry').onclick=()=>{core.atomic(path.join(store.root,'retry-request.json'),{library:eagle.library.path,id:itemId});$('status').textContent='已加入重试';};
 void render();setInterval(render,1000);
});
