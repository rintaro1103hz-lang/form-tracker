export const FORMAT = 'form-personal-backup';
export const uid = () => crypto.randomUUID();
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const shiftDay = (date, n) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate()+n); return localDate(d); };
export const emptyState = () => ({ foods: [], meals: [], days: [], weights: [], goals: [], exercises: [], templates: [], sessions: [], supplements: [], supplementLogs: [], settings: {} });
export const MAX_DOSES = 10;
// 旧バージョン（サプリ機能追加前）の保存データに、空のサプリ記録を補う。元のオブジェクトは変更しない。
export const migrate = state => ({ ...state, supplements: state.supplements ?? [], supplementLogs: state.supplementLogs ?? [] });
export function supplementDay(state, date) {
  const logs = state.supplementLogs.filter(l => l.date === date);
  return state.supplements.map(s => ({ supplement: s, log: logs.find(l => l.supplementId === s.id) }))
    .filter(r => r.supplement.active || r.log)
    .map(r => ({ supplement: r.supplement, taken: r.log?.taken ?? 0, target: r.log?.target ?? r.supplement.timesPerDay }));
}
export function toggleDose(state, date, supplementId, index) {
  const s = state.supplements.find(x => x.id === supplementId);
  if (!s) throw new Error('サプリメントが見つかりません。');
  const old = state.supplementLogs.find(l => l.date === date && l.supplementId === supplementId);
  const target = Math.max(s.timesPerDay, old?.taken ?? 0), current = old?.taken ?? 0;
  const taken = Math.min(target, Math.max(0, index < current ? current - 1 : current + 1));
  state.supplementLogs = state.supplementLogs.filter(l => l !== old);
  if (taken > 0) state.supplementLogs.push({ id: old?.id || uid(), date, supplementId, taken, target });
  return taken;
}
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
export const nutrients = ['kcal','p','f','c'];
export function totalMeals(meals) {
  return Object.fromEntries(nutrients.map(key => [key, { value: meals.reduce((s,m) => s+(m[key] ?? 0),0), unknown: meals.some(m => m[key] == null) }]));
}
export function scaleFood(food, amount) {
  if (!Number.isFinite(amount) || amount <= 0 || !(food.base > 0)) throw new Error('分量は0より大きい数値にしてください。');
  return Object.fromEntries(nutrients.map(k => [k, food[k] == null ? null : food[k] * amount / food.base]));
}
export function dayStatus(state,date) { return state.days.find(d=>d.date===date)?.status === 'complete' ? 'complete' : state.meals.some(m=>m.date===date) ? 'partial' : 'empty'; }
export function markPartial(state,date) { state.days = state.days.filter(x=>x.date!==date); }
export function goalFor(state,date) { return [...state.goals].filter(g=>g.date<=date).sort((a,b)=>b.date.localeCompare(a.date))[0]; }
export function trendAt(weights,date) {
  const rows=weights.filter(w=>w.date>=shiftDay(date,-6)&&w.date<=date);
  return rows.length>=3 ? {value:rows.reduce((s,w)=>s+w.kg,0)/rows.length,count:rows.length} : null;
}
export function previousSets(state, exerciseId, date) {
  const session=[...state.sessions].filter(s=>s.date<date && s.complete && s.sets.some(x=>x.exerciseId===exerciseId)).sort((a,b)=>b.date.localeCompare(a.date)||b.updatedAt.localeCompare(a.updatedAt))[0];
  return session ? {date:session.date,sets:session.sets.filter(x=>x.exerciseId===exerciseId)} : null;
}
export function makeBackup(state) { return { format: FORMAT, schemaVersion: 2, exportedAt: new Date().toISOString(), data: structuredClone(state) }; }
const fail = () => { throw new Error('データの形式・値・参照先に問題があります。記録は変更していません。'); };
const dateOK = x => typeof x==='string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x)) && new Date(`${x}T12:00:00Z`).toISOString().slice(0,10)===x;
const numberOK = (x,positive=false) => typeof x==='number' && Number.isFinite(x) && (positive ? x>0 : x>=0);
const textOK = x => typeof x==='string' && x.length>0 && x.length<=500;
const idOK = x => typeof x==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(x);
export function validateBackup(input) {
  if (!input || input.format!==FORMAT || ![1,2].includes(input.schemaVersion)) throw new Error('このバックアップ形式には対応していません。KetoLogのファイルは原本のまま保管してください。');
  if (typeof input.exportedAt!=='string' || Number.isNaN(Date.parse(input.exportedAt))) fail();
  if (!input.data || typeof input.data!=='object') fail();
  // バージョン1（サプリ機能追加前）にはサプリの項目がないため、空として読み込む。
  const d=input.schemaVersion===1 ? migrate(input.data) : input.data;
  const keys=['foods','meals','days','weights','goals','exercises','templates','sessions','supplements','supplementLogs'];
  if (!d || keys.some(k=>!Array.isArray(d[k])||d[k].length>100000) || !d.settings || Array.isArray(d.settings) || typeof d.settings!=='object') fail();
  const ids={};
  for (const k of keys) {
    ids[k]=new Set();
    for (const x of d[k]) {
      if (!x || !idOK(x.id) || ids[k].has(x.id)) fail();
      ids[k].add(x.id);
    }
  }
  const nutritionOK=x=>nutrients.every(k=>x[k]===null||numberOK(x[k]));
  for(const x of d.foods) if(!textOK(x.name)||!textOK(x.unit)||!numberOK(x.base,true)||!nutritionOK(x)||typeof x.favorite!=='boolean') fail();
  for(const x of d.meals) if(!dateOK(x.date)||!textOK(x.name)||!textOK(x.unit)||!numberOK(x.base,true)||!numberOK(x.amount,true)||!nutritionOK(x)||!['朝食','昼食','夕食','間食'].includes(x.slot)||(x.foodId!==null&&!ids.foods.has(x.foodId))) fail();
  for(const k of ['days','weights','goals']) {
    const dates=new Set();
    for(const x of d[k]) {if(!dateOK(x.date)||dates.has(x.date)) fail(); dates.add(x.date);}
  }
  for(const x of d.days) if(x.status!=='complete') fail();
  for(const x of d.weights) if(!numberOK(x.kg,true)||x.kg>1000) fail();
  for(const x of d.goals) if(!['lose','maintain','gain'].includes(x.mode)||!nutrients.every(k=>numberOK(x[k]))||x.kcal===0) fail();
  for(const x of d.exercises) if(!textOK(x.name)||!['weighted','bodyweight'].includes(x.mode)) fail();
  for(const x of d.templates) if(!textOK(x.name)||!Array.isArray(x.exerciseIds)||new Set(x.exerciseIds).size!==x.exerciseIds.length||x.exerciseIds.some(id=>!ids.exercises.has(id))) fail();
  for(const x of d.sessions) {
    if(!dateOK(x.date)||!textOK(x.name)||typeof x.complete!=='boolean'||typeof x.updatedAt!=='string'||Number.isNaN(Date.parse(x.updatedAt))||!Array.isArray(x.exerciseIds)||new Set(x.exerciseIds).size!==x.exerciseIds.length||x.exerciseIds.some(id=>!ids.exercises.has(id))||!Array.isArray(x.sets)) fail();
    const setIds=new Set();
    for(const s of x.sets) {
      if(!idOK(s.id)||setIds.has(s.id)||!x.exerciseIds.includes(s.exerciseId)||!numberOK(s.kg)||!Number.isInteger(s.reps)||s.reps<=0||s.reps>10000) fail();
      setIds.add(s.id);
    }
  }
  const dosesOK=x=>Number.isInteger(x)&&x>=1&&x<=MAX_DOSES;
  for(const x of d.supplements) if(!textOK(x.name)||!dosesOK(x.timesPerDay)||typeof x.active!=='boolean') fail();
  const logKeys=new Set();
  for(const x of d.supplementLogs) {
    const key=`${x.date}|${x.supplementId}`;
    if(!dateOK(x.date)||!ids.supplements.has(x.supplementId)||logKeys.has(key)||!dosesOK(x.target)||!dosesOK(x.taken)||x.taken>x.target) fail();
    logKeys.add(key);
  }
  return structuredClone(d);
}
export function sampleState(date) {
  const s=emptyState();
  const foods=[['オートミール',100,'g',380,13.7,5.7,69.1],['鶏むね肉',100,'g',108,22.3,1.5,0],['白ごはん',100,'g',156,2.5,0.3,37.1],['ギリシャヨーグルト',1,'個',100,10,0,15]];
  s.foods=foods.map(([name,base,unit,kcal,p,f,c])=>({id:uid(),name,base,unit,kcal,p,f,c,favorite:true}));
  for(let i=20;i>=0;i--) s.weights.push({id:uid(),date:shiftDay(date,-i),kg:Math.round((80.2-i*-0.035+Math.sin(i)*0.23)*10)/10});
  s.goals=[{id:uid(),date:shiftDay(date,-30),mode:'lose',kcal:2200,p:150,f:65,c:254}];
  for(const [i,amount,slot] of [[0,60,'朝食'],[3,1,'朝食'],[1,180,'昼食'],[2,200,'昼食']]) { const f=s.foods[i]; s.meals.push({...f,...scaleFood(f,amount),id:uid(),foodId:f.id,date,amount,slot}); }
  s.exercises=[{id:uid(),name:'ベンチプレス',mode:'weighted'},{id:uid(),name:'スクワット',mode:'weighted'},{id:uid(),name:'ラットプルダウン',mode:'weighted'}];
  s.templates=[{id:uid(),name:'全身トレーニング',exerciseIds:s.exercises.map(x=>x.id)}];
  s.sessions=[{id:uid(),name:'全身トレーニング',date:shiftDay(date,-3),updatedAt:new Date().toISOString(),complete:true,exerciseIds:s.exercises.map(x=>x.id),sets:s.exercises.flatMap((x,i)=>[0,1,2].map(()=>({id:uid(),exerciseId:x.id,kg:[50,70,40][i],reps:10})))}];
  s.supplements=[['クレアチン',1],['プロテイン',2],['マルチビタミン',1]].map(([name,timesPerDay])=>({id:uid(),name,timesPerDay,active:true}));
  for(let i=6;i>=1;i--) for(const x of s.supplements) { const taken=Math.max(0,x.timesPerDay-(i%3===0?1:0)); if(taken) s.supplementLogs.push({id:uid(),date:shiftDay(date,-i),supplementId:x.id,taken,target:x.timesPerDay}); }
  return s;
}
