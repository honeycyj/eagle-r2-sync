eagle.onPluginCreate(async plugin=>{
 const path=require('path'),fs=require('fs'),core=require(path.join(plugin.path,'core.js')),store=require(path.join(plugin.path,'storage.js')),keys=require(path.join(plugin.path,'credentials.js'));
 const Engine=require(path.join(plugin.path,'engine.js'));
 const engine=new Engine(eagle,require(path.join(plugin.path,'encode.js'))),$=id=>document.getElementById(id),fields=['account','bucket','domain','prefix'];
 let draftFolders=[],draftLibrary,credentialsSaved=false,tinySaved=false,dirty=false,resizeTimer,windowChrome=null,resizing=false,resizeAgain=false,availableFolders=[],picked=new Set(),removedFolder=null;
 let tinyDraft={key:'',consent:false},tinyRevealRevision=0,r2Draft={},r2Keys={access:'',secret:''},r2RevealRevision=0,uploadSession=null,mirrorDraft=false,pendingSignature='';
 const theme=v=>document.documentElement.dataset.theme=['LIGHT','LIGHTGRAY'].includes(String(v).toUpperCase())?'light':'dark';theme(eagle.app.theme);if(eagle.onThemeChanged)eagle.onThemeChanged(theme);
 function markDirty(){dirty=true;$('dirty').textContent='更改尚未保存';$('save').disabled=false;$('notice').hidden=true;}
 // Resize only for explicit structural actions, never from a resize-observer feedback loop.
 function resize(){clearTimeout(resizeTimer);resizeTimer=setTimeout(fitWindow,120);}
 async function fitWindow(){
  if(uploadSession)return;
  if(resizing){resizeAgain=true;return;}
  resizing=true;
  try{
   if(!eagle.window?.setSize)return;
   const size=await eagle.window.getSize();if(uploadSession)return;
   if(windowChrome===null)windowChrome=Math.max(0,Math.min(80,size[1]-window.innerHeight));
   const height=Math.min(Math.max(320,Math.ceil($('content').getBoundingClientRect().height+windowChrome)),Math.max(320,screen.availHeight-80));
   if(Math.abs(size[1]-height)>2)await eagle.window.setSize(size[0],height);
  }catch(e){}finally{resizing=false;if(resizeAgain){resizeAgain=false;resize();}}
 }
 function renderFolders(){
  const list=$('folders'),add=$('openPicker');list.replaceChildren();$('folderCount').textContent=draftFolders.length;
  for(const [index,f]of draftFolders.entries()){
   const chip=document.createElement('div');chip.className='folder-chip';chip.dataset.enabled=f.enabled!==false;
   const toggle=document.createElement('button');toggle.type='button';toggle.className='chip-toggle';toggle.textContent=f.name.split(' / ').pop();toggle.setAttribute('role','switch');toggle.setAttribute('aria-label','同步 '+f.name);
   function reflect(){toggle.setAttribute('aria-checked',String(f.enabled!==false));toggle.title=f.name+' · '+(f.enabled!==false?'同步已启用，点击暂停':'已暂停，点击启用');chip.dataset.enabled=f.enabled!==false;}
   reflect();toggle.onclick=()=>{f.enabled=f.enabled===false;reflect();markDirty();};
   const remove=document.createElement('button');remove.type='button';remove.className='chip-remove';remove.textContent='×';remove.title='移除 '+f.name;remove.setAttribute('aria-label','移除 '+f.name);remove.onclick=()=>{removedFolder={folder:{...f},index,library:draftLibrary};draftFolders=draftFolders.filter(x=>x.id!==f.id);$('removedName').textContent='已移除「'+f.name.split(' / ').pop()+'」';$('undoNotice').hidden=false;markDirty();renderFolders();renderChoices();$('openPicker').focus();};
   chip.append(toggle,remove);list.appendChild(chip);
  }
  add.textContent=draftFolders.length?'＋':'＋ 添加文件夹';list.appendChild(add);resize();
 }
 function renderChoices(){
  const list=$('folderChoices'),query=$('folderSearch').value.trim().toLocaleLowerCase();list.replaceChildren();
  const added=new Set(draftFolders.map(f=>f.id)),matches=availableFolders.filter(f=>f.name.toLocaleLowerCase().includes(query));
  for(const f of matches){const label=document.createElement('label');label.className='folder-option';label.dataset.added=added.has(f.id);label.title=f.name;const check=document.createElement('input');check.type='checkbox';check.disabled=added.has(f.id);check.checked=check.disabled||picked.has(f.id);check.setAttribute('aria-label','添加 '+f.name);check.onchange=()=>{check.checked?picked.add(f.id):picked.delete(f.id);updatePickerCount();};const name=document.createElement('span');name.className='choice-path';name.textContent=query?f.name:f.leaf;label.append(check);if(!query)for(let i=0;i<f.depth;i++){const indent=document.createElement('span');indent.className='folder-indent';indent.setAttribute('aria-hidden','true');label.append(indent);}label.append(name);if(check.disabled){const badge=document.createElement('small');badge.textContent='已添加';label.append(badge);}list.append(label);}
  if(!matches.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=availableFolders.length?'没有匹配的文件夹':'此资源库还没有文件夹';list.append(empty);}
  updatePickerCount();resize();
 }
 function updatePickerCount(){$('pickerCount').textContent=picked.size?'已选 '+picked.size+' 个':'可多选';$('bind').textContent=picked.size?'添加 '+picked.size+' 个文件夹':'添加所选';$('bind').disabled=!picked.size;}
 function closePicker(){$('folderPicker').close();}
 async function choices(){const all=await eagle.folder.getAll();availableFolders=[];function walk(nodes,prefix='',depth=0){for(const f of nodes){const name=prefix+f.name;availableFolders.push({id:f.id,name,leaf:f.name,depth});walk(f.children||[],name+' / ',depth+1);}}walk(all);renderChoices();}
 $('openPicker').onclick=()=>action(async()=>{if(draftFolders.length&&draftLibrary!==eagle.library.path)throw Error('请切回已绑定的资源库，或先移除原资源库的文件夹');await choices();$('folderSearch').value='';picked.clear();renderChoices();$('folderError').hidden=true;$('folderPicker').showModal();$('folderSearch').focus();});
 $('cancelPicker').onclick=closePicker;$('closePicker').onclick=closePicker;
 $('folderPicker').addEventListener('close',()=>{picked.clear();$('folderError').hidden=true;});
 $('folderSearch').oninput=renderChoices;
 $('folderPicker').addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target===$('folderSearch')&&picked.size){event.preventDefault();$('bind').click();}});
 $('useSelectedFolders').onclick=async()=>{
  try{const selected=await eagle.folder.getSelected();if(!$('folderPicker').open)return;const ids=selected.map(f=>f.id).filter(id=>!draftFolders.some(f=>f.id===id));if(!ids.length)throw Error(selected.length?'当前所选文件夹已在同步列表中。':'请先在 Eagle 侧边栏选择文件夹。');picked=new Set(ids);await addPickedFolders();}
  catch(e){$('folderError').textContent=e.message;$('folderError').hidden=false;}
 };
 $('undoRemove').onclick=()=>{if(!removedFolder)return;draftLibrary=removedFolder.library;if(!draftFolders.some(f=>f.id===removedFolder.folder.id))draftFolders.splice(Math.min(removedFolder.index,draftFolders.length),0,removedFolder.folder);removedFolder=null;$('undoNotice').hidden=true;markDirty();renderFolders();renderChoices();};
 // Both service choices occupy the same slot; provider settings use an in-window modal.
 function processing(){const tiny=$('provider').value==='tinypng';$('serviceRow').hidden=!tiny;$('presetRow').hidden=tiny;$('serviceSettings').textContent=tinyDraft.key||tinySaved?'管理 TinyPNG':'配置 TinyPNG';}
 function render(){const c=store.config();$('toggle').textContent=c.enabled?'暂停同步':'启用同步';$('content').dataset.enabled=c.enabled;$('save').disabled=!dirty;$('connectionSummary').textContent=r2Draft.domain?r2Draft.domain.replace(/^https:\/\//,''):'待配置';$('credentialState').textContent=credentialsSaved?'凭据已保存':'待配置';$('r2KeyHint').textContent=credentialsSaved?'密钥已保存在本机；可点显示核对，或更换密钥。':'输入两项密钥后点保存设置。';$('changeCredentials').hidden=!credentialsSaved;$('access').placeholder=credentialsSaved?'已保存，点击显示可查看':'填写 Access Key ID';$('secret').placeholder=credentialsSaved?'已保存，点击显示可查看':'填写 Secret Access Key';$('tinyKey').placeholder=tinySaved?'已保存，留空保留':'填写 API Key';
  try{
   const state=store.state(eagle.library.path),tasks=Object.values(state.mirror?.pending||{}),failures=Object.values(state.items).filter(r=>r.status==='error');
   const deleteErrors=tasks.filter(t=>t.error);$('openPending').hidden=!c.mirrorEnabled||c.library!==eagle.library.path||!tasks.length;$('openPending').textContent='待删除 '+tasks.length+' 个云端文件';if($('pendingDialog').open)renderPending(state);
   const error=engine.error||(deleteErrors.length?deleteErrors.length+' 个云端文件未清理：'+deleteErrors[0].error:'')||(failures.length?failures.length+' 个文件未上传：'+(failures[0].error||'请检查网络或上传配置'):'');
   $('uploadFailure').hidden=!c.enabled||c.library!==eagle.library.path||!error;
   $('summary').textContent=error;$('scan').disabled=engine.busy;
  }catch(e){$('uploadFailure').hidden=!c.enabled;$('summary').textContent=e.message;$('scan').disabled=engine.busy;}
 }
 async function action(fn){$('notice').hidden=true;try{await fn();}catch(e){engine.message=e.message;$('notice').textContent=e.message;$('notice').dataset.kind='error';$('notice').hidden=false;}render();resize();}
 async function checkCredentials(){try{const v=await keys.read(store);credentialsSaved=!!v.access&&!!v.secret;tinySaved=!!v.tinyKey;processing();}catch(e){credentialsSaved=false;tinySaved=false;}render();}
 async function tick(){if(engine.busy)return;const file=path.join(store.root,'retry-request.json');try{if(fs.existsSync(file)){const request=core.read(file,{});fs.unlinkSync(file);if(request.library===eagle.library.path){const s=store.state(request.library);for(const [id,r] of Object.entries(s.items)){if(!request.id||request.id===id){r.retryAt=0;r.blocked=false;}}for(const task of Object.values(s.mirror?.pending||{}))if(!request.id||task.id===request.id){task.retryAt=0;task.blocked=false;task.error=null;}core.atomic(store.statePath(request.library),s);}}}catch(e){engine.message='重试请求读取失败';}await engine.scan();}
 function load(){const c=store.config();r2Draft=Object.fromEntries(fields.map(k=>[k,c[k]??'']));mirrorDraft=c.mirrorEnabled===true;draftFolders=core.roots(c).map(f=>({...f}));draftLibrary=c.library;$('provider').value=c.provider||'local';$('preset').value=c.preset||'standard';tinyDraft={key:'',consent:!!c.tinyConsent};renderFolders();processing();render();}
 async function addPickedFolders(){
  if(draftFolders.length&&draftLibrary!==eagle.library.path)throw Error('请切回已绑定的资源库，或先移除原资源库的文件夹');
  if(!picked.size)return;
  const ids=[...picked],found=[];
  for(const id of ids){const folder=await eagle.folder.getById(id);if(!folder)throw Error('选中的文件夹已不存在，请重新选择');found.push({id:folder.id,name:availableFolders.find(f=>f.id===id)?.name||folder.name,enabled:true});}
  draftLibrary=eagle.library.path;for(const f of found)if(!draftFolders.some(x=>x.id===f.id))draftFolders.push(f);
  $('undoNotice').hidden=true;removedFolder=null;markDirty();renderFolders();closePicker();engine.message='文件夹已添加，保存后生效';
 }
 $('bind').onclick=async()=>{try{await addPickedFolders();render();}catch(e){$('folderError').textContent=e.message;$('folderError').hidden=false;}};
 $('save').onclick=()=>action(async()=>{
  if(engine.busy)throw Error('正在处理文件，请稍后保存');
  const c={...store.config(),folders:draftFolders.map(f=>({...f})),library:draftLibrary,provider:$('provider').value,preset:$('preset').value,tinyConsent:$('provider').value==='tinypng'&&tinyDraft.consent,mirrorEnabled:mirrorDraft};for(const k of fields)c[k]=r2Draft[k];delete c.folder;delete c.folderName;if(!c.folders.some(f=>f.enabled!==false))c.enabled=false;core.validate(c);
  await keys.save(store,{access:r2Keys.access,secret:r2Keys.secret,tinyKey:tinyDraft.key},c.provider==='tinypng');
  clearSecrets();
  core.atomic(store.configPath,c);dirty=false;$('dirty').textContent='';$('undoNotice').hidden=true;removedFolder=null;$('notice').textContent='设置已保存';$('notice').dataset.kind='success';$('notice').hidden=false;engine.message='设置已保存';await checkCredentials();core.atomic(path.join(store.root,'retry-request.json'),{library:c.library});void tick();
 });
 $('toggle').onclick=()=>action(async()=>{const c=store.config();if(!c.enabled){if(dirty)throw Error('请先保存设置');core.validate(c);await checkCredentials();if(!credentialsSaved)throw Error('请先保存 R2 凭据');if(!core.roots(c).some(f=>f.enabled!==false))throw Error('请至少启用一个同步文件夹');if(c.provider==='tinypng'&&!tinySaved)throw Error('请先保存 TinyPNG API Key');}c.enabled=!c.enabled;core.atomic(store.configPath,c);engine.message=c.enabled?'同步中':'已暂停';if(c.enabled)void tick();});
 $('scan').onclick=()=>action(async()=>{if(engine.busy)return;core.atomic(path.join(store.root,'retry-request.json'),{library:eagle.library.path});await tick();});
 function resetSecret(field,button){$(field).value='';$(field).type='password';$(button).textContent='显示';$(button).setAttribute('aria-label','显示 '+(field==='access'?'Access Key ID':field==='secret'?'Secret Access Key':'TinyPNG API Key'));}
 function clearSecrets(){r2Keys={access:'',secret:''};tinyDraft.key='';if($('r2Settings').open)$('r2Settings').close();if($('tinySettings').open)$('tinySettings').close();for(const [field,button]of [['access','showAccess'],['secret','showSecret'],['tinyKey','showTiny']]){$(field).value='';$(field).type='password';$(button).textContent='显示';$(button).setAttribute('aria-label','显示 '+(field==='access'?'Access Key ID':field==='secret'?'Secret Access Key':'TinyPNG API Key'));}}
 $('openConnection').onclick=()=>{
  if(uploadSession)return;
  for(const k of fields)$(k).value=r2Draft[k];for(const [field,button]of [['access','showAccess'],['secret','showSecret']]){resetSecret(field,button);$(field).value=r2Keys[field];}
  const session={closed:false,restore:null,changed:false,pending:null};uploadSession=session;
  $('r2Error').hidden=true;$('mirrorEnabled').checked=mirrorDraft;$('r2Settings').showModal();$('domain').focus();$('domain').setSelectionRange(0,0);
  session.pending=(async()=>{
   try{
    if(!eagle.window?.setSize)return;
    // Wait for an earlier main-panel adjustment before measuring the modal.
    if(resizing)await new Promise(resolve=>setTimeout(resolve,160));
    const size=await eagle.window.getSize();if(session.closed)return;session.restore=size;
    const dialog=$('r2Settings'),body=dialog.querySelector('.connection-body'),chrome=windowChrome??Math.max(0,Math.min(80,size[1]-window.innerHeight));
    const needed=Math.ceil(dialog.getBoundingClientRect().height+Math.max(0,body.scrollHeight-body.clientHeight)+28+chrome);
    const height=Math.min(Math.max(size[1],needed),screen.availHeight-60);
    if(height>size[1]+2){await eagle.window.setSize(size[0],height);session.changed=true;}
   }catch(e){} // A host without window resizing retains the scrollable form.
  })();
 };
 $('closeConnection').onclick=()=> $('r2Settings').close();$('cancelConnection').onclick=()=> $('r2Settings').close();
 $('r2Settings').addEventListener('close',()=>{
  r2RevealRevision++;resetSecret('access','showAccess');resetSecret('secret','showSecret');$('r2Error').hidden=true;
  const session=uploadSession;if(!session)return;session.closed=true;
  void (async()=>{try{await session.pending;if(session.changed&&session.restore)await eagle.window.setSize(...session.restore);}catch(e){}finally{if(uploadSession===session)uploadSession=null;}})();
 });
 $('applyConnection').onclick=()=>{
  try{const values=Object.fromEntries(fields.map(k=>[k,$(k).value.trim()]));const valid=core.validate({...store.config(),...values,enabled:false});const pair=keys.merge({}, {access:$('access').value,secret:$('secret').value});r2Draft=Object.fromEntries(fields.map(k=>[k,valid[k]]));r2Keys={access:pair.access||'',secret:pair.secret||''};mirrorDraft=$('mirrorEnabled').checked;markDirty();render();$('r2Settings').close();}
  catch(e){$('r2Error').textContent=e.message;$('r2Error').hidden=false;}
 };
 for(const [field,button]of [['access','showAccess'],['secret','showSecret']])$(button).onclick=async()=>{
  const input=$(field),reveal=input.type==='password',revision=++r2RevealRevision;
  try{if(reveal&&!input.value){const saved=await keys.read(store);if(!$('r2Settings').open||revision!==r2RevealRevision)return;if(!$('access').value&&!$('secret').value){$('access').value=saved.access||'';$('secret').value=saved.secret||'';}}if(!$('r2Settings').open)return;input.type=reveal?'text':'password';$(button).textContent=reveal?'隐藏':'显示';}
  catch(e){$('r2Error').textContent='无法读取本机密钥，请检查钥匙串权限。';$('r2Error').hidden=false;}
 };
 $('changeCredentials').onclick=()=>{resetSecret('access','showAccess');resetSecret('secret','showSecret');$('access').focus();};
 if(eagle.onPluginHide)eagle.onPluginHide(clearSecrets);
 $('forget').onclick=()=>action(async()=>{const c=store.config();c.enabled=false;core.atomic(store.configPath,c);await store.keychain('delete');credentialsSaved=false;tinySaved=false;clearSecrets();engine.message='已暂停并移除本机凭据';});
 function renderPending(state,force=false){
  const tasks=Object.values(state.mirror?.pending||{}).sort((a,b)=>a.deleteAfter-b.deleteAfter),signature=JSON.stringify(tasks.map(t=>[t.token,t.error,Math.ceil((t.deleteAfter-Date.now())/86400000)]));
  if(!force&&signature===pendingSignature)return;pendingSignature=signature;$('pendingList').replaceChildren();
  if(!tasks.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='暂无待删除文件';$('pendingList').append(empty);}
  for(const task of tasks){const row=document.createElement('div');row.className='pending-row';const title=document.createElement('div');title.className='pending-name';title.textContent=task.name||task.id;const hint=document.createElement('p');hint.className='hint';const days=Math.max(0,Math.ceil((task.deleteAfter-Date.now())/86400000));hint.textContent=(task.reason==='replaced'?'历史版本':'已删除或移出同步范围')+' · '+(days?'剩余 '+days+' 天':'等待复核')+(task.error?' · '+task.error:'');const actions=document.createElement('div');actions.className='pending-actions';const keep=document.createElement('button');keep.className='text-button';keep.textContent='保留云端';keep.title='保留此云端对象，后续不自动删除';keep.onclick=()=>{try{const file=path.join(store.root,'mirror-retain-request.json'),previous=core.read(file,{}),tokens=previous.library===eagle.library.path?previous.tokens||[]:[];core.atomic(file,{library:eagle.library.path,tokens:[...new Set([...tokens,task.token])]});keep.textContent='已提交';keep.disabled=true;}catch(e){keep.textContent='提交失败，请重试';}};actions.append(keep);if(task.url){const copy=document.createElement('button');copy.className='text-button';copy.textContent='复制链接';copy.onclick=async()=>{await eagle.clipboard.writeText(task.url);copy.textContent='已复制';};actions.append(copy);}row.append(title,hint,actions);$('pendingList').append(row);}
 }
 $('openPending').onclick=()=>{renderPending(store.state(eagle.library.path),true);$('pendingDialog').showModal();};
 $('closePending').onclick=()=> $('pendingDialog').close();$('donePending').onclick=()=> $('pendingDialog').close();
 function closeService(){$('tinySettings').close();}
 $('serviceSettings').onclick=()=>{
  resetSecret('tinyKey','showTiny');$('tinyKey').value=tinyDraft.key;$('tinyConsent').checked=tinyDraft.consent;$('serviceError').hidden=true;
  $('tinySettings').showModal();$('tinyKey').focus();
 };
 $('closeService').onclick=closeService;$('cancelService').onclick=closeService;
 $('tinySettings').addEventListener('close',()=>{tinyRevealRevision++;resetSecret('tinyKey','showTiny');$('tinyConsent').checked=false;$('serviceError').hidden=true;});
 $('applyService').onclick=()=>{
  const key=$('tinyKey').value.trim(),consent=$('tinyConsent').checked;
  const error=!key&&!tinySaved?'请填写 API Key。':!consent?'请确认允许将图片发送至 TinyPNG。':'';
  if(error){$('serviceError').textContent=error;$('serviceError').hidden=false;(!key&&!tinySaved?$('tinyKey'):$('tinyConsent')).focus();return;}
  tinyDraft={key,consent};markDirty();processing();closeService();
 };
 $('showTiny').onclick=async()=>{
  const input=$('tinyKey'),reveal=input.type==='password',revision=++tinyRevealRevision;
  try{if(reveal&&!input.value){const saved=await keys.read(store);if(!$('tinySettings').open||revision!==tinyRevealRevision)return;input.value=saved.tinyKey||'';}if(!$('tinySettings').open)return;input.type=reveal?'text':'password';$('showTiny').textContent=reveal?'隐藏':'显示';$('showTiny').setAttribute('aria-label',(reveal?'隐藏 ':'显示 ')+'TinyPNG API Key');}
  catch(e){$('serviceError').textContent='无法读取本机密钥，请检查钥匙串权限。';$('serviceError').hidden=false;}
 };
 $('tinySettings').addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target===$('tinyKey')){event.preventDefault();$('applyService').click();}});
 $('provider').onchange=()=>{if($('provider').value!=='tinypng')tinyDraft.consent=false;markDirty();processing();};for(const id of ['preset'])$(id).addEventListener('input',markDirty);


 load();void choices().catch(()=>{engine.message='无法读取当前资源库的文件夹';render();});void checkCredentials();setInterval(()=>{void tick();},3000);setInterval(render,1000);void tick();resize();
 eagle.onLibraryChanged(()=>{engine.message='仅同步已绑定资源库中的文件夹';picked.clear();if($('folderPicker').open)$('folderPicker').close();void choices().catch(()=>{});render();});if(eagle.onPluginShow)eagle.onPluginShow(()=>{void choices().catch(()=>{});resize();});
});
