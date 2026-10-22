'use strict';
async function read(store) {
 try {return JSON.parse(await store.keychain('get'));}
 catch(error) {if(error.code==='KEYCHAIN_NOT_FOUND')return {};throw error;}
}
function merge(existing,values) {
 const access=(values.access||'').trim(),secret=(values.secret||'').trim(),tinyKey=(values.tinyKey||'').trim();
 if(Boolean(access)!==Boolean(secret))throw Error('请同时填写 Access Key ID 和 Secret Access Key');
 if(access&&!/^[A-Za-z0-9]+$/.test(access))throw Error('Access Key ID 格式不合法');
 return {...existing,...(access?{access,secret}:{}),...(tinyKey?{tinyKey}:{})};
}
async function save(store,values,requireTiny=false) {
 const existing=await read(store),next=merge(existing,values);
 if(requireTiny&&!next.tinyKey)throw Error('请填写 TinyPNG API Key');
 if(JSON.stringify(next)!==JSON.stringify(existing))await store.keychain('set',JSON.stringify(next));
 return next;
}
module.exports={read,merge,save};
