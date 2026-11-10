let db;
let revision=0;
export async function openStore() {
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open('form-personal-v1',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('state');
    r.onsuccess=()=>{db=r.result; db.onversionchange=()=>db.close(); resolve();};
    r.onerror=()=>reject(r.error);
    r.onblocked=()=>reject(new Error('ほかのタブを閉じて、もう一度開いてください。'));
  });
}
export async function loadState() {return new Promise((resolve,reject)=>{const t=db.transaction('state'),store=t.objectStore('state'),data=store.get('personal'),rev=store.get('revision');t.oncomplete=()=>{revision=rev.result||0;resolve(data.result);};t.onerror=()=>reject(t.error);});}
export async function saveState(state) {return new Promise((resolve,reject)=>{
 const t=db.transaction('state','readwrite'),store=t.objectStore('state'),r=store.get('revision');let conflict=false;
 r.onsuccess=()=>{if((r.result||0)!==revision){conflict=true;t.abort();return;}store.put(state,'personal');store.put(revision+1,'revision');};
 t.oncomplete=()=>{revision++;resolve();};t.onerror=()=>reject(t.error);t.onabort=()=>reject(conflict?new Error('別のタブで記録が更新されました。入力内容を控えてから、この画面を再読み込みしてください。'):t.error||new Error('保存できませんでした。'));
});}
