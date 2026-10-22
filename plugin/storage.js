const fs=require('fs'),path=require('path'),os=require('os');
const {execFile}=require('child_process');
const core=require('./core');
const root=path.join(os.homedir(),'Library','Application Support','Honeycyj Eagle R2');
fs.mkdirSync(root,{recursive:true,mode:0o700});
const configPath=path.join(root,'config.json');
function config(){const c=core.read(configPath,{enabled:false,domain:'',prefix:'eagle',namespace:require('crypto').randomBytes(16).toString('hex')});return {...c,folders:core.roots(c),provider:c.provider||'local',preset:c.preset||'standard'};}
function statePath(lib){return path.join(root,'state-'+core.hash(lib)+'.json');}
function state(lib){return core.read(statePath(lib),{items:{},updatedAt:null});}
function keychain(action,input){return new Promise((resolve,reject)=>{
 const child=execFile(path.join(__dirname,'bin','keychain'),[action],{timeout:30000,maxBuffer:16384},(err,out,stderr)=>{if(!err)return resolve(out);const missing=String(stderr).includes('status -25300');reject(Object.assign(Error(missing?'尚未保存凭据':'钥匙串操作失败或被拒绝；请检查 macOS 提示'),{code:missing?'KEYCHAIN_NOT_FOUND':'KEYCHAIN_DENIED'}));});
 child.stdin.on('error',()=>{});child.stdin.end(input||'');
});}
module.exports={root,configPath,config,statePath,state,keychain};
