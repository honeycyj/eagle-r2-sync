const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const core=require('../plugin/core'),Engine=require('../plugin/engine');
const base={enabled:true,account:'a'.repeat(32),bucket:'test-bucket',folder:'root',folderName:'Test',library:'/mock/library',domain:'https://img.example.com',prefix:'eagle',namespace:'test',quality:0.82,maxSize:2560};
test('folder descendants exclude unrelated folders',()=>{assert.deepEqual([...core.descendants([{id:'other'},{id:'root',children:[{id:'child',children:[{id:'deep'}]}]}],'root')],['root','child','deep']);});
test('config rejects endpoint/credential injection and bad prefix',()=>{for(const patch of [{mirrorEnabled:'false'},{account:'https://evil.test'},{domain:'http://example.com'},{domain:'https://user:pass@example.com'},{prefix:'../escape'}])assert.throws(()=>core.validate({...base,...patch}));});
test('URLs and version keys remain distinct and encoded',()=>{const a=core.objectKey(base,'lib','id','a','b'),b=core.objectKey(base,'lib','id','c','d');assert.notEqual(a,b);assert.equal(core.uri('eagle/空 格.webp'),'/eagle/%E7%A9%BA%20%E6%A0%BC.webp');});
function fixture(t){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'eagle-r2-test-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const file=path.join(tmp,'image.png');fs.writeFileSync(file,'original');fs.utimesSync(file,new Date(0),new Date(0));
 let c={...base},items=[{id:'A',ext:'png',folders:['child'],filePath:file}],requests=[],state={items:{}};
 const stateFile=path.join(tmp,'state.json');
 const storage={config:()=>({...c}),state:()=>core.read(stateFile,state),statePath:()=>stateFile,keychain:async()=>JSON.stringify({access:'fake',secret:'fake'})};
 const eagle={library:{path:base.library},folder:{getAll:async()=>[{id:'root',children:[{id:'child'}]}]},item:{get:async({folders})=>items.filter(x=>x.folders.includes(folders[0])),getById:async id=>items.find(x=>x.id===id)}};
 const transport=async(...args)=>{requests.push(args);return{status:200};};
 const engine=new Engine(eagle,async()=>Buffer.from('webp-output'),transport,storage);
 return{engine,requests,storage,eagle,file,get state(){return storage.state();},setItems:x=>items=x,setConfig:x=>c={...c,...x}};
}
test('publish, deduplicate, version on change, preserve originals and history, never delete',async t=>{
 const f=fixture(t);await f.engine.scan();assert.equal(f.requests.length,1);assert.equal(f.requests[0][2],'PUT');assert.equal(f.requests[0][5]['if-none-match'],'*');assert.equal(f.state.items.A.status,'published');const first=f.state.items.A.url;
 await f.engine.scan();assert.equal(f.requests.length,1);assert.equal(fs.readFileSync(f.file,'utf8'),'original');
 fs.writeFileSync(f.file,'changed');fs.utimesSync(f.file,new Date(0),new Date(0));await f.engine.scan();assert.equal(f.requests.length,2);assert.notEqual(f.state.items.A.url,first);assert.equal(f.state.items.A.history[0].url,first);
 f.setItems([]);await f.engine.scan();assert.equal(f.requests.length,2);assert.equal(f.state.items.A.status,'out-of-scope');assert.ok(f.state.items.A.url);
});
test('pause and library switch prevent writes',async t=>{const f=fixture(t);f.setConfig({enabled:false});await f.engine.scan();assert.equal(f.requests.length,0);f.setConfig({enabled:true});f.eagle.library.path='/other';await f.engine.scan();assert.equal(f.requests.length,0);});
test('membership removal during encoding prevents upload',async t=>{const f=fixture(t);f.engine.encode=async()=>{f.setItems([]);return Buffer.from('encoded');};await f.engine.scan();assert.equal(f.requests.length,0);});
test('failure records bounded backoff and next scan does not hammer server',async t=>{const f=fixture(t);f.engine.transport=async()=>{f.requests.push('attempt');return{status:403};};await f.engine.scan();assert.equal(f.state.items.A.status,'error');assert.ok(f.state.items.A.retryAt>Date.now());await f.engine.scan();assert.equal(f.requests.length,1);});
test('412 is accepted only after verifying existing single-part ETag',async t=>{const f=fixture(t);f.engine.transport=async(c,cr,m)=>m==='PUT'?{status:412}:{status:200,etag:'"wrong"'};await f.engine.scan();assert.equal(f.state.items.A.status,'error');assert.equal(f.state.items.A.url,undefined);});
test('unsupported and deleted items never upload',async t=>{const f=fixture(t);f.setItems([{id:'A',ext:'gif',folders:['child']},{id:'B',ext:'png',folders:['child'],isDeleted:true}]);await f.engine.scan();assert.equal(f.requests.length,0);assert.equal(f.state.items.A.status,'skipped');assert.equal(f.state.items.B,undefined);});
test('corrupt state is not silently discarded',t=>{const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'r2-json-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));const file=path.join(tmp,'state.json');fs.writeFileSync(file,'{broken');assert.throws(()=>core.read(file,{}));});
test('compression buffer is cleared after successful or failed upload',async t=>{for(const status of [200,403]){const f=fixture(t);let buffer;f.engine.encode=async()=>({body:buffer=Buffer.from('compressed private image'),ext:'webp',mime:'image/webp',mode:'webp'});f.engine.transport=async()=>({status});await f.engine.scan();assert.ok(buffer.every(x=>x===0));assert.equal(f.state.items.A.status,status===200?'published':'error');}});
test('changing compression settings preserves existing URL',async t=>{const f=fixture(t);await f.engine.scan();const url=f.state.items.A.url;f.setConfig({quality:0.5,maxSize:1000});await f.engine.scan();assert.equal(f.requests.length,1);assert.equal(f.state.items.A.url,url);});
test('original format fallback sends matching MIME and extension',async t=>{const f=fixture(t);f.engine.encode=async()=>({body:Buffer.from('original'),ext:'png',mime:'image/png',originalBytes:8,mode:'original'});await f.engine.scan();assert.ok(f.state.items.A.key.endsWith('.png'));assert.equal(f.requests[0][5]['content-type'],'image/png');});
test('scope hides other folders, all-items view, other libraries and unrelated images',async()=>{const {scope}=require('../plugin/scope');let selected=[{id:'child'}];const eagle={library:{path:base.library},folder:{getAll:async()=>[{id:'root',children:[{id:'child'}]}],getSelected:async()=>selected}};assert.equal(await scope(eagle,base,{folders:['child']}),true);selected=[{id:'other'}];assert.equal(await scope(eagle,base,{folders:['child']}),false);selected=[];assert.equal(await scope(eagle,base,{folders:['child']}),false);selected=[{id:'child'}];assert.equal(await scope(eagle,base,{folders:['other']}),false);eagle.library.path='/other';assert.equal(await scope(eagle,base),false);});
test('multiple roots include descendants, ignore disabled roots, deduplicate overlaps',()=>{const tree=[{id:'a',children:[{id:'b'}]},{id:'c'},{id:'d'}];const c={folders:[{id:'a'},{id:'b'},{id:'c',enabled:false},{id:'d'}]};assert.deepEqual([...core.syncIds(tree,c)],['a','b','d']);assert.equal(core.roots(base)[0].id,'root');});
test('engine uploads from two roots once and stops disabled root',async t=>{const f=fixture(t);f.eagle.folder.getAll=async()=>[{id:'root',children:[{id:'child'}]},{id:'second'}];f.setItems([{id:'A',ext:'png',folders:['child','second'],filePath:f.file},{id:'B',ext:'png',folders:['second'],filePath:f.file}]);f.setConfig({folders:[{id:'root'},{id:'second'}]});await f.engine.scan();assert.equal(f.requests.length,2);f.setConfig({folders:[{id:'root'},{id:'second',enabled:false}]});await f.engine.scan();assert.equal(f.requests.length,2);assert.equal(f.state.items.B.status,'out-of-scope');});
test('TinyPNG requires explicit config consent',()=>{assert.throws(()=>core.validate({...base,provider:'tinypng',tinyConsent:false}));assert.doesNotThrow(()=>core.validate({...base,provider:'tinypng',tinyConsent:true}));});
test('empty folder list can be saved while paused, but cannot run',()=>{assert.doesNotThrow(()=>core.validate({...base,folders:[],enabled:false}));assert.throws(()=>core.validate({...base,folders:[],enabled:true}));});

test('transient failure retries, then Eagle deletion retains published object and link',async t=>{
 const f=fixture(t);let attempts=0;
 f.engine.transport=async(...args)=>{f.requests.push(args);return{status:++attempts===1?503:200};};
 await f.engine.scan();assert.equal(f.state.items.A.status,'error');
 await f.engine.scan();assert.equal(attempts,1);
 const state=f.state;state.items.A.retryAt=0;core.atomic(f.storage.statePath(),state);
 await f.engine.scan();assert.equal(f.state.items.A.status,'published');const published=f.state.items.A.url;
 f.setItems([{id:'A',ext:'png',folders:['child'],filePath:f.file,isDeleted:true}]);await f.engine.scan();
 assert.equal(f.state.items.A.url,published);assert.equal(f.state.items.A.status,'out-of-scope');
 f.setItems([]);await f.engine.scan();assert.equal(f.state.items.A.url,published);
 assert.deepEqual(f.requests.map(args=>args[2]),['PUT','PUT']);
});
