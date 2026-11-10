export const FORMAT = 'form-personal-backup';
export const uid = () => crypto.randomUUID();
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const shiftDay = (date, n) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate()+n); return localDate(d); };
export const emptyState = () => ({ foods: [], meals: [], days: [], weights: [], goals: [], exercises: [], templates: [], sessions: [], supplements: [], supplementLogs: [], settings: {} });
export const SLOTS = ['朝', '昼', '晩'];
export const MAX_AMOUNT = 1000;
const isObject = x => x && typeof x === 'object' && !Array.isArray(x);
// 旧形式の保存データ・バックアップを現在の形式に読み替える。元のオブジェクトは変更しない。
// ・サプリ：「1日の回数」だけの形式 → 朝・昼・晩ごとの量（1回→朝、2回→朝・晩、3回以上→朝・昼・晩）
// ・種目：ジャンルなし → 「その他」
function upgrade(state) {
  const next = { ...state }, oldSlots = new Map();
  if (Array.isArray(next.supplements)) next.supplements = next.supplements.map(s => {
    if (!isObject(s) || 'doses' in s || !('timesPerDay' in s)) return s;
    const slots = s.timesPerDay >= 3 ? SLOTS : s.timesPerDay === 2 ? ['朝', '晩'] : ['朝'];
    oldSlots.set(s.id, slots);
    return { id: s.id, name: s.name, active: s.active, unit: '個', doses: Object.fromEntries(SLOTS.map(k => [k, slots.includes(k) ? 1 : 0])) };
  });
  if (Array.isArray(next.supplementLogs)) next.supplementLogs = next.supplementLogs.flatMap(l => {
    if (!isObject(l) || 'slot' in l || !('taken' in l)) return [l];
    return (oldSlots.get(l.supplementId) ?? SLOTS).slice(0, l.taken).map((slot, i) => ({ id: i ? `${l.id}-${i}` : l.id, date: l.date, supplementId: l.supplementId, slot, amount: 1, unit: '個' }));
  });
  if (Array.isArray(next.exercises)) next.exercises = next.exercises.map(e => isObject(e) && !('category' in e) ? { ...e, category: 'その他' } : e);
  return next;
}
const withSupplements = state => ({ ...state, supplements: state.supplements ?? [], supplementLogs: state.supplementLogs ?? [] });
export const migrate = state => upgrade(withSupplements(state));
export const plannedSlots = supplement => SLOTS.filter(k => supplement.doses[k] > 0);
export function supplementDay(state, date) {
  const logs = state.supplementLogs.filter(l => l.date === date);
  return SLOTS.map(slot => ({ slot, items: state.supplements.map(s => {
    const log = logs.find(l => l.supplementId === s.id && l.slot === slot);
    if (!log && !(s.active && s.doses[slot] > 0)) return null;
    return { supplement: s, taken: !!log, amount: log ? log.amount : s.doses[slot], unit: log ? log.unit : s.unit };
  }).filter(Boolean) }));
}
export function toggleDose(state, date, supplementId, slot) {
  const s = state.supplements.find(x => x.id === supplementId);
  if (!s || !SLOTS.includes(slot)) throw new Error('サプリメントが見つかりません。');
  const old = state.supplementLogs.find(l => l.date === date && l.supplementId === supplementId && l.slot === slot);
  if (old) { state.supplementLogs = state.supplementLogs.filter(l => l !== old); return false; }
  if (!(s.doses[slot] > 0)) throw new Error('この時間帯には設定されていません。');
  state.supplementLogs.push({ id: uid(), date, supplementId, slot, amount: s.doses[slot], unit: s.unit });
  return true;
}
export function takeAll(state, date, slot) {
  for (const item of supplementDay(state, date).find(g => g.slot === slot).items) if (!item.taken) toggleDose(state, date, item.supplement.id, slot);
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
// 推定1RM（Epley式：重量 ×（1 + 回数 / 30）、1回なら重量そのもの）。回数が多いほど誤差が増えるため1〜12回に限る。
export const E1RM_MAX_REPS = 12;
export function estimate1RM(kg, reps) {
  if (!(kg > 0) || !Number.isInteger(reps) || reps < 1 || reps > E1RM_MAX_REPS) return null;
  return reps === 1 ? kg : kg * (1 + reps / 30);
}
export function bestSet(sets) {
  return sets.map(s => ({ set: s, value: estimate1RM(s.kg, s.reps) })).filter(x => x.value != null).sort((a, b) => b.value - a.value)[0] ?? null;
}
// 種目ごとの推定1RMの推移（日付ごとの最大値）。自重種目は追加重量しか記録しないため対象外。
export function e1rmHistory(state, exerciseId) {
  const ex = state.exercises.find(e => e.id === exerciseId);
  if (!ex || ex.mode !== 'weighted') return [];
  const byDate = new Map();
  for (const s of state.sessions) {
    const best = bestSet(s.sets.filter(x => x.exerciseId === exerciseId));
    if (best && !(byDate.get(s.date)?.value >= best.value)) byDate.set(s.date, { date: s.date, ...best });
  }
  let record = 0;
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map(x => { const pr = x.value > record; if (pr) record = x.value; return { ...x, pr }; });
}
export function makeBackup(state) { return { format: FORMAT, schemaVersion: 3, exportedAt: new Date().toISOString(), data: structuredClone(state) }; }
const fail = () => { throw new Error('データの形式・値・参照先に問題があります。記録は変更していません。'); };
const dateOK = x => typeof x==='string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x)) && new Date(`${x}T12:00:00Z`).toISOString().slice(0,10)===x;
const numberOK = (x,positive=false) => typeof x==='number' && Number.isFinite(x) && (positive ? x>0 : x>=0);
const textOK = x => typeof x==='string' && x.length>0 && x.length<=500;
const shortOK = x => textOK(x) && x.length<=20;
const idOK = x => typeof x==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(x);
export function validateBackup(input) {
  if (!input || input.format!==FORMAT || ![1,2,3].includes(input.schemaVersion)) throw new Error('このバックアップ形式には対応していません。記録は変更していません。');
  if (typeof input.exportedAt!=='string' || Number.isNaN(Date.parse(input.exportedAt))) fail();
  if (!input.data || typeof input.data!=='object') fail();
  // バージョン1（サプリ機能追加前）にはサプリの項目がないため、空として読み込む。旧形式の項目は現在の形式に読み替える。
  const d=upgrade(input.schemaVersion===1 ? withSupplements(input.data) : input.data);
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
  for(const x of d.exercises) if(!textOK(x.name)||!shortOK(x.category)||!['weighted','bodyweight'].includes(x.mode)) fail();
  for(const x of d.templates) if(!textOK(x.name)||!Array.isArray(x.exerciseIds)||new Set(x.exerciseIds).size!==x.exerciseIds.length||x.exerciseIds.some(id=>!ids.exercises.has(id))) fail();
  for(const x of d.sessions) {
    if(!dateOK(x.date)||!textOK(x.name)||typeof x.complete!=='boolean'||typeof x.updatedAt!=='string'||Number.isNaN(Date.parse(x.updatedAt))||!Array.isArray(x.exerciseIds)||new Set(x.exerciseIds).size!==x.exerciseIds.length||x.exerciseIds.some(id=>!ids.exercises.has(id))||!Array.isArray(x.sets)) fail();
    const setIds=new Set();
    for(const s of x.sets) {
      if(!idOK(s.id)||setIds.has(s.id)||!x.exerciseIds.includes(s.exerciseId)||!numberOK(s.kg)||!Number.isInteger(s.reps)||s.reps<=0||s.reps>10000) fail();
      setIds.add(s.id);
    }
  }
  for(const x of d.supplements) if(!textOK(x.name)||!shortOK(x.unit)||typeof x.active!=='boolean'||!isObject(x.doses)||Object.keys(x.doses).length!==SLOTS.length||!SLOTS.every(k=>numberOK(x.doses[k])&&x.doses[k]<=MAX_AMOUNT)||!SLOTS.some(k=>x.doses[k]>0)) fail();
  const logKeys=new Set();
  for(const x of d.supplementLogs) {
    const key=`${x.date}|${x.supplementId}|${x.slot}`;
    if(!dateOK(x.date)||!ids.supplements.has(x.supplementId)||!SLOTS.includes(x.slot)||logKeys.has(key)||!numberOK(x.amount,true)||x.amount>MAX_AMOUNT||!shortOK(x.unit)) fail();
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
  s.exercises=[['胸','ベンチプレス'],['胸','ダンベルフライ'],['背中','ラットプルダウン'],['背中','デッドリフト'],['肩','ショルダープレス'],['脚','スクワット']].map(([category,name])=>({id:uid(),name,category,mode:'weighted'}));
  const pick=category=>s.exercises.filter(x=>x.category===category).map(x=>x.id);
  s.templates=[['胸の日','胸'],['背中の日','背中'],['肩の日','肩'],['脚の日','脚']].map(([name,category])=>({id:uid(),name,exerciseIds:pick(category)}));
  // 約5週間分。少しずつ重量が伸びていく記録（推定1RMの推移を確かめるため）。
  for(let w=9;w>=1;w--) for(const [name,cat,base,step,off] of [['胸の日','胸',[50,12],[1.25,0.5],0],['背中の日','背中',[45,80],[1.25,2.5],1],['脚の日','脚',[70],[2.5],2]]) {
    const ids=pick(cat);
    s.sessions.push({id:uid(),name,date:shiftDay(date,-(w*4+off)),updatedAt:new Date().toISOString(),complete:true,exerciseIds:ids,sets:ids.flatMap((id,i)=>[10,8,8].map(reps=>({id:uid(),exerciseId:id,kg:base[i]+step[i]*(9-w),reps})))});
  }
  s.supplements=[['クレアチン','g',5,0,0],['プロテイン','杯',1,0,1],['マルチビタミン','粒',2,0,0],['マグネシウム','粒',0,0,2]].map(([name,unit,...d])=>({id:uid(),name,unit,active:true,doses:Object.fromEntries(SLOTS.map((k,i)=>[k,d[i]]))}));
  for(let i=6;i>=1;i--) for(const x of s.supplements) for(const slot of plannedSlots(x)) if(!(i%3===0&&slot==='晩')) s.supplementLogs.push({id:uid(),date:shiftDay(date,-i),supplementId:x.id,slot,amount:x.doses[slot],unit:x.unit});
  return s;
}
