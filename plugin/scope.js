const {syncIds}=require('./core');
async function scope(eagle,c,item){
 if(eagle.library.path!==c.library)return false;
 const ids=syncIds(await eagle.folder.getAll(),c),folders=await eagle.folder.getSelected();
 if(!folders.length||!folders.every(f=>ids.has(f.id)))return false;
 return !item||(!item.isDeleted&&(item.folders||[]).some(id=>ids.has(id)));
}
module.exports={scope};
