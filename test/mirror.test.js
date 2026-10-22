const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const Engine=require('../plugin/engine'),core=require('../plugin/core'),{GRACE_MS}=require('../plugin/mirror');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eagle-mirror-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const library=path.join(dir,'library');fs.mkdirSync(library);const file=path.join(dir,'image.png');fs.writeFileSync(file,'original');fs.utimesSync(file,new Date(0),new Date(0));
 let now=Date.now(),folders=[{id:'root',children:[{id:'child',children:[{id:'deep'}]}]},{id:'second'}];
 let c={enabled:true,mirrorEnabled:true,folders:[{id:'root',enabled:true}],account:'a'.repeat(32),bucket:'test-bucket',domain:'https://img.example.com',prefix:'eagle',namespace:'test',library};
 const a={id:'A',name:'image',ext:'png',folders:['root'],filePath:file},items=new Map([['A',a]]),remote=new Map(),requests=[],stateFile=path.join(dir,'state.json');
 const storage={root:dir,config:()=>({...c,folders:c.folders.map(f=>({...f}))}),state:()=>core.read(stateFile,{items:{}}),statePath:()=>stateFile,keychain:async()=>JSON.stringify({access:'dummy',secret:'dummy'})};
 const eagle={library:{path:library},folder:{getAll:async()=>folders},item:{get:async({folders:ids})=>[...items.values()].filter(i=>(i.folders||[]).some(id=>ids.includes(id))),getById:async id=>items.get(id)||null}};
 const transport=async(c,cr,method,key,body,headers)=>{
  requests.push({method,key});const object=remote.get(key);
  if(method==='PUT'){if(object)return{status:412};const value=Buffer.from(body);const etag='"'+crypto.createHash('md5').update(value).digest('hex')+'"';remote.set(key,{body:value,etag});return{status:200,etag};}
  if(method==='HEAD')return object?{status:200,etag:object.etag}:{status:404};
  if(method==='GET')return object?{status:200,etag:object.etag,sha256:core.hash(object.body)}:{status:404};
  if(method==='DELETE'){remote.delete(key);return{status:204};}
  throw Error('Unexpected request');
 };
 const engine=new Engine(eagle,async f=>({body:Buffer.from(fs.readFileSync(f)),ext:'png',mime:'image/png',mode:'original'}),transport,storage,{now:()=>now});
 return{dir,library,file,a,items,remote,requests,storage,eagle,engine,get c(){return c;},config:v=>c={...c,...v},folders:v=>folders=v,advance:n=>now+=n,scan:async(n=1)=>{for(let i=0;i<n;i++)await engine.scan();},get state(){return storage.state();},get pending(){return Object.values(storage.state().mirror?.pending||{});}};
}
const puts=f=>f.requests.filter(r=>r.method==='PUT').length,deletes=f=>f.requests.filter(r=>r.method==='DELETE').length;
test('rename and moves into nested or overlapping enabled folders never upload again',async t=>{
 const f=fixture(t);f.config({folders:[{id:'root'},{id:'child'},{id:'second'}]});await f.scan();const url=f.state.items.A.url;
 for(const folder of ['child','deep','second','root']){f.a.name='renamed';f.a.folders=[folder];await f.scan(2);assert.equal(puts(f),1);assert.equal(f.state.items.A.url,url);assert.equal(f.pending.length,0);}
});
test('deletion requires two observations and a full seven-day grace, then only removes mapped object',async t=>{
 const f=fixture(t);await f.scan();const key=f.state.items.A.key;f.remote.set('foreign/file.png',{body:Buffer.from('other'),etag:'foreign'});
 f.a.isDeleted=true;await f.scan();assert.equal(f.pending.length,0);await f.scan();assert.equal(f.pending.length,1);
 f.advance(GRACE_MS-1);await f.scan();assert.equal(deletes(f),0);assert.ok(f.remote.has(key));
 f.advance(2);await f.scan();assert.equal(deletes(f),1);assert.ok(!f.remote.has(key));assert.ok(f.remote.has('foreign/file.png'));assert.equal(f.state.items.A.url,null);
});
test('Eagle trash restore cancels deletion and preserves URL without PUT',async t=>{
 const f=fixture(t);await f.scan();const url=f.state.items.A.url;f.a.isDeleted=true;await f.scan(2);f.advance(GRACE_MS+1);f.a.isDeleted=false;f.a.folders=['deep'];await f.scan();assert.equal(f.pending.length,0);assert.equal(deletes(f),0);assert.equal(puts(f),1);assert.equal(f.state.items.A.url,url);
});
test('same bytes reimported as a new project do not claim old object',async t=>{
 const f=fixture(t);await f.scan();const old=f.state.items.A.key;f.items.delete('A');await f.scan(2);f.items.set('B',{...f.a,id:'B'});await f.scan();const next=f.state.items.B.key;assert.notEqual(next,old);assert.equal(puts(f),2);
 f.advance(GRACE_MS+1);await f.scan();assert.ok(!f.remote.has(old));assert.ok(f.remote.has(next));
});
test('changed content publishes first and buffers old version; old version survives failed upload',async t=>{
 const f=fixture(t);await f.scan();const first=f.state.items.A.key;const transport=f.engine.transport;
 fs.writeFileSync(f.file,'changed');fs.utimesSync(f.file,new Date(0),new Date(0));f.engine.transport=async()=>({status:503});await f.scan();assert.ok(f.remote.has(first));assert.equal(f.pending.length,0);
 const state=f.state;state.items.A.retryAt=0;core.atomic(f.storage.statePath(),state);f.engine.transport=transport;await f.scan();const next=f.state.items.A.key;assert.notEqual(next,first);assert.equal(f.pending[0].reason,'replaced');
 f.advance(GRACE_MS+1);await f.scan();assert.ok(!f.remote.has(first));assert.ok(f.remote.has(next));
});
test('moving outside every root buffers deletion, returning into any enabled child cancels it',async t=>{
 const f=fixture(t);await f.scan();f.a.folders=['unbound'];await f.scan(2);assert.equal(f.pending.length,1);f.a.folders=['deep'];await f.scan();assert.equal(f.pending.length,0);assert.equal(puts(f),1);
});
test('pause, disabling/removing binding, missing root and offline library cancel deletion plans',async t=>{
 for(const mode of ['pause','remove','disable','root-missing','offline']){
  const f=fixture(t);await f.scan();f.a.isDeleted=true;await f.scan(2);assert.equal(f.pending.length,1);
  if(mode==='pause')f.config({enabled:false});if(mode==='remove')f.config({folders:[{id:'second'}]});if(mode==='disable')f.config({folders:[{id:'root',enabled:false},{id:'second'}]});if(mode==='root-missing')f.folders([{id:'second'}]);if(mode==='offline')fs.renameSync(f.library,f.library+'-offline');
  f.advance(GRACE_MS+1);await f.scan();assert.equal(deletes(f),0,mode);assert.equal(f.pending.length,0,mode);
 }
});
test('failed library query and wrong active library never trigger deletion',async t=>{
 const f=fixture(t);await f.scan();f.items.delete('A');await f.scan(2);f.advance(GRACE_MS+1);const original=f.eagle.item.getById;f.eagle.item.getById=async()=>{throw Error('SDK unavailable');};await f.scan();assert.equal(deletes(f),0);f.eagle.item.getById=original;f.eagle.library.path='other';await f.scan();assert.equal(deletes(f),0);
});
test('final SDK check after HEAD stops deletion if item returns',async t=>{
 const f=fixture(t);await f.scan();f.a.isDeleted=true;await f.scan(2);f.advance(GRACE_MS+1);const transport=f.engine.transport;f.engine.transport=async(...args)=>{const result=await transport(...args);if(args[2]==='HEAD')f.a.isDeleted=false;return result;};await f.scan();assert.equal(deletes(f),0);assert.equal(f.pending.length,0);
});
test('objects changed by another writer are blocked, never deleted',async t=>{
 const f=fixture(t);await f.scan();const key=f.state.items.A.key;f.items.delete('A');await f.scan(2);f.remote.get(key).etag='"changed"';f.advance(GRACE_MS+1);await f.scan();assert.equal(deletes(f),0);assert.equal(f.pending[0].blocked,true);
});
test('legacy current mapping is streamed and hashed before deletion',async t=>{
 const f=fixture(t);await f.scan();const state=f.state;delete state.items.A.etag;core.atomic(f.storage.statePath(),state);f.items.delete('A');await f.scan(2);f.advance(GRACE_MS+1);await f.scan();assert.equal(f.requests.filter(r=>r.method==='GET').length,1);assert.equal(deletes(f),1);
});
test('expired object must upload again when original project comes back',async t=>{
 const f=fixture(t);await f.scan();f.a.isDeleted=true;await f.scan(2);f.advance(GRACE_MS+1);await f.scan();f.a.isDeleted=false;await f.scan();assert.equal(puts(f),2);assert.equal(f.state.items.A.status,'published');assert.ok(f.state.items.A.url);
});
test('retaining a buffered object prevents auto-deletion',async t=>{
 const f=fixture(t);await f.scan();f.items.delete('A');await f.scan(2);const task=f.pending[0];core.atomic(path.join(f.dir,'mirror-retain-request.json'),{library:f.library,tokens:[task.token]});f.advance(GRACE_MS+1);await f.scan();assert.equal(deletes(f),0);assert.equal(f.pending.length,0);assert.ok(f.state.mirror.retained[task.token]);
});
test('legacy items first observed outside the scope are not adopted for deletion',async t=>{
 const f=fixture(t);await f.scan();const state=f.state;delete state.items.A.managedRoots;delete state.mirror;core.atomic(f.storage.statePath(),state);f.items.delete('A');await f.scan(2);f.advance(GRACE_MS+1);await f.scan();assert.equal(deletes(f),0);assert.equal(f.pending.length,0);
});
test('moving into a newly created child uses the existing object and URL',async t=>{
 const f=fixture(t);await f.scan();const url=f.state.items.A.url;f.folders([{id:'root',children:[{id:'new-child'}]}]);f.a.folders=['new-child'];await f.scan(2);assert.equal(puts(f),1);assert.equal(f.state.items.A.url,url);assert.equal(f.pending.length,0);
});
test('retain request arriving during cloud HEAD cancels the final deletion',async t=>{
 const f=fixture(t);await f.scan();f.items.delete('A');await f.scan(2);const task=f.pending[0],transport=f.engine.transport;f.engine.transport=async(...args)=>{const response=await transport(...args);if(args[2]==='HEAD')core.atomic(path.join(f.dir,'mirror-retain-request.json'),{library:f.library,tokens:[task.token]});return response;};f.advance(GRACE_MS+1);await f.scan();assert.equal(deletes(f),0);assert.equal(f.pending.length,0);
});
test('transient deletion failure backs off then retries successfully',async t=>{
 const f=fixture(t);await f.scan();f.items.delete('A');await f.scan(2);const transport=f.engine.transport;let failures=0;f.engine.transport=async(...args)=>{if(args[2]==='DELETE'&&failures++===0)return{status:503};return transport(...args);};f.advance(GRACE_MS+1);await f.scan();assert.equal(f.pending.length,1);assert.ok(f.pending[0].error);await f.scan();assert.equal(failures,1);f.advance(60001);await f.scan();assert.equal(f.pending.length,0);assert.equal(deletes(f),1);
});
test('pause/resume begins a new full buffer rather than executing an expired plan',async t=>{
 const f=fixture(t);await f.scan();f.a.isDeleted=true;await f.scan(2);f.config({enabled:false});await f.scan();f.advance(GRACE_MS+1);f.config({enabled:true});await f.scan(2);assert.equal(deletes(f),0);assert.equal(f.pending.length,1);f.advance(GRACE_MS-1);await f.scan();assert.equal(deletes(f),0);
});
test('destination change cannot delete objects in a newly configured bucket',async t=>{
 const f=fixture(t);await f.scan();f.items.delete('A');await f.scan(2);f.advance(GRACE_MS+1);f.config({bucket:'other-bucket'});await f.scan(2);assert.equal(deletes(f),0);assert.equal(f.pending.length,0);
});
test('corrupt deadline and unowned key never authorize deletion',async t=>{
 const f=fixture(t);await f.scan();f.items.delete('A');await f.scan(2);let state=f.state;const task=Object.values(state.mirror.pending)[0];task.createdAt=null;task.deleteAfter=0;core.atomic(f.storage.statePath(),state);f.advance(GRACE_MS+1);await f.scan();assert.equal(deletes(f),0);
 state=f.state;state.items.A.key='foreign/file.png';core.atomic(f.storage.statePath(),state);await f.scan(2);assert.equal(deletes(f),0);
});
test('legacy download checksum mismatch blocks deletion',async t=>{
 const f=fixture(t);await f.scan();let state=f.state;delete state.items.A.etag;core.atomic(f.storage.statePath(),state);f.items.delete('A');await f.scan(2);const transport=f.engine.transport;f.engine.transport=async(...args)=>args[2]==='GET'?{status:200,etag:f.pending[0].etag,sha256:'wrong'}:transport(...args);f.advance(GRACE_MS+1);await f.scan();assert.equal(deletes(f),0);assert.equal(f.pending[0].blocked,true);
});

test('same project moved to a different local file path is not re-uploaded',async t=>{
 const f=fixture(t);await f.scan();const url=f.state.items.A.url;const next=path.join(f.dir,'renamed.png');fs.renameSync(f.file,next);f.a.filePath=next;f.a.folders=['deep'];await f.scan();assert.equal(puts(f),1);assert.equal(f.state.items.A.url,url);
});

test('uncertain in-flight deletion cannot remove a restored new publication',async t=>{
 const f=fixture(t);await f.scan();const old=f.state.items.A.key;f.a.isDeleted=true;await f.scan(2);f.advance(GRACE_MS+1);const transport=f.engine.transport;
 f.engine.transport=async(...args)=>{if(args[2]==='DELETE')throw Error('network lost after sending');return transport(...args);};await f.scan();assert.equal(f.state.items.A.deleteUncertain,true);
 f.a.isDeleted=false;f.engine.transport=transport;await f.scan();const next=f.state.items.A.key;assert.notEqual(next,old);assert.ok(f.remote.has(next));
 // A previously dispatched request may complete late, but only targets the old object key.
 f.remote.delete(old);assert.ok(f.remote.has(next));assert.equal(f.state.items.A.status,'published');
});

test('reverting to a historical version avoids its uncertain deletion key',async t=>{
 const f=fixture(t);await f.scan();const old=f.state.items.A.key;fs.writeFileSync(f.file,'version-two');fs.utimesSync(f.file,new Date(0),new Date(0));await f.scan();f.advance(GRACE_MS+1);const transport=f.engine.transport;f.engine.transport=async(...args)=>args[2]==='DELETE'?Promise.reject(Error('unknown outcome')):transport(...args);await f.scan();
 fs.writeFileSync(f.file,'original');fs.utimesSync(f.file,new Date(0),new Date(0));f.engine.transport=transport;await f.scan();const restored=f.state.items.A.key;assert.notEqual(restored,old);f.remote.delete(old);assert.ok(f.remote.has(restored));
});
