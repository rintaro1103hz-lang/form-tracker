export const FORMAT = 'form-personal-backup';
export const uid = () => crypto.randomUUID();
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const shiftDay = (date, n) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate()+n); return localDate(d); };
export const emptyState = () => ({ foods: [], meals: [], days: [], weights: [], goals: [], exercises: [], templates: [], sessions: [], supplements: [], supplementLogs: [], mealSets: [], settings: {} });
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
  // 食事のセット（いつもの組み合わせ）は後から追加した項目なので、ない場合は空として扱う。
  if (!('mealSets' in next)) next.mealSets = [];
  return next;
}
const withSupplements = state => ({ ...state, supplements: state.supplements ?? [], supplementLogs: state.supplementLogs ?? [] });
// 食事のセット：その日の食事をまとめて保存し、別の日に一度で記録する。値は保存したときの分量のまま。
const MEAL_ITEM_KEYS = ['name', 'base', 'unit', 'amount', 'kcal', 'p', 'f', 'c', 'foodId'];
export const mealSetItem = meal => Object.fromEntries(MEAL_ITEM_KEYS.map(k => [k, meal[k] ?? null]));
export function addMealSet(state, setId, date, slot) {
  const set = state.mealSets.find(x => x.id === setId);
  if (!set) throw new Error('セットが見つかりません。');
  state.meals.push(...set.items.map(item => ({ ...item, foodId: item.foodId && state.foods.some(f => f.id === item.foodId) ? item.foodId : null, id: uid(), date, slot })));
  markPartial(state, date);
  return set.items.length;
}
// 種目の削除：プリセットと過去の記録からも取り除く（記録に残すと参照切れになるため）。消えるセット数を返す。
export function deleteExercise(state, id) {
  let removed = 0;
  state.exercises = state.exercises.filter(e => e.id !== id);
  state.templates = state.templates.map(t => ({ ...t, exerciseIds: t.exerciseIds.filter(x => x !== id) })).filter(t => t.exerciseIds.length);
  state.sessions = state.sessions.map(s => { const sets = s.sets.filter(x => x.exerciseId !== id); removed += s.sets.length - sets.length; return { ...s, exerciseIds: s.exerciseIds.filter(x => x !== id), sets }; });
  return removed;
}
export const exerciseUsage = (state, id) => state.sessions.reduce((n, s) => n + s.sets.filter(x => x.exerciseId === id).length, 0);
// 指定日までの7日間の、部位（ジャンル）ごとのセット数。
export function categorySets(state, date) {
  const from = shiftDay(date, -6), counts = new Map();
  for (const s of state.sessions) if (s.date >= from && s.date <= date) for (const x of s.sets) {
    const c = state.exercises.find(e => e.id === x.exerciseId)?.category;
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts].map(([category, sets]) => ({ category, sets })).sort((a, b) => b.sets - a.sets);
}
// 指定日までの7日間のふりかえり。前の7日間と比べられるよう、同じ形で返す。
export function weekSummary(state, date) {
  const days = Array.from({ length: 7 }, (_, i) => shiftDay(date, i - 6)), start = days[0], inWeek = d => d >= start && d <= date;
  const logged = days.filter(d => state.meals.some(m => m.date === d) || dayStatus(state, d) === 'complete');
  const totals = logged.map(d => totalMeals(state.meals.filter(m => m.date === d)));
  const avg = k => totals.length ? totals.reduce((s, t) => s + t[k].value, 0) / totals.length : null;
  const goals = logged.map(d => goalFor(state, d)?.kcal).filter(Boolean);
  const now = trendAt(state.weights, date), before = trendAt(state.weights, shiftDay(date, -7));
  const sessions = state.sessions.filter(s => inWeek(s.date) && s.sets.length);
  // サプリの登録日は持っていないため、初めて飲んだ日より前は「飲み忘れ」に数えない。
  const firstLog = id => state.supplementLogs.filter(l => l.supplementId === id).reduce((m, l) => (!m || l.date < m ? l.date : m), null);
  const supp = days.flatMap(d => supplementDay(state, d).flatMap(g => g.items).filter(x => { const f = firstLog(x.supplement.id); return f && d >= f; }));
  const prs = state.exercises.flatMap(e => e1rmHistory(state, e.id).filter((h, i) => i > 0 && h.pr && inWeek(h.date)).map(h => ({ name: e.name, value: h.value, date: h.date })));
  return {
    start, end: date, loggedDays: logged.length, kcal: avg('kcal'), p: avg('p'), f: avg('f'), c: avg('c'),
    goalKcal: goals.length ? goals.reduce((s, v) => s + v, 0) / goals.length : null,
    weight: now?.value ?? null, weightChange: now && before ? now.value - before.value : null, weighIns: state.weights.filter(w => inWeek(w.date)).length,
    workouts: sessions.length, sets: sessions.reduce((s, x) => s + x.sets.length, 0),
    suppTaken: supp.filter(x => x.taken).length, suppTotal: supp.length, prs,
  };
}
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
// 体重の目標：消費カロリーを Mifflin-St Jeor式 × 活動量で推定し、目標ペースの分を増減して1日の摂取カロリーと達成日を出す。
export const ACTIVITY = { low: 1.2, light: 1.375, moderate: 1.55, high: 1.725 };
export const KCAL_PER_KG = 7200;
// 計算に使う体重：7日トレンドがあればそれ、なければ直近の実測。
export function currentWeight(state, date) {
  const t = trendAt(state.weights, date);
  if (t) return t.value;
  return state.weights.filter(w => w.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0]?.kg ?? null;
}
// 記録からの消費カロリー（実績）：直近4週間の「平均摂取カロリー − 体重の増減ぶんのカロリー」。
// 体重の増減は実測値の回帰直線の傾きから求める。食事は、記録があり、カロリー不明の品がない日だけを使う（今日は完了済みのときだけ）。
export const ADAPT = { window: 28, minSpan: 14, minWeighIns: 6, minIntakeDays: 10 };
export function adaptiveTdee(state, date) {
  const dayNo = d => Math.round(Date.parse(`${d}T12:00:00Z`) / 86400000), from = shiftDay(date, -ADAPT.window);
  const ws = state.weights.filter(w => w.date >= from && w.date <= date).sort((a, b) => a.date.localeCompare(b.date));
  const span = ws.length ? dayNo(ws.at(-1).date) - dayNo(ws[0].date) : 0, intakes = [];
  for (let i = ADAPT.window; i >= 0; i--) {
    const d = shiftDay(date, -i), meals = state.meals.filter(m => m.date === d), complete = dayStatus(state, d) === 'complete';
    if ((i === 0 && !complete) || (!meals.length && !complete) || meals.some(m => m.kcal == null)) continue;
    intakes.push(meals.reduce((s, m) => s + m.kcal, 0));
  }
  const need = { intakeDays: Math.max(0, ADAPT.minIntakeDays - intakes.length), weighIns: Math.max(0, ADAPT.minWeighIns - ws.length), span: Math.max(0, ADAPT.minSpan - span) };
  const base = { intakeDays: intakes.length, weighIns: ws.length, span, need };
  if (need.intakeDays || need.weighIns || need.span) return { ready: false, ...base };
  const xs = ws.map(w => dayNo(w.date)), mx = xs.reduce((s, x) => s + x, 0) / xs.length, my = ws.reduce((s, w) => s + w.kg, 0) / ws.length;
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ws[i].kg - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const intake = intakes.reduce((s, v) => s + v, 0) / intakes.length;
  return { ready: true, ...base, intake, weekly: slope * 7, tdee: intake - slope * KCAL_PER_KG };
}
// measured：記録からの消費カロリー。計算式の0.6〜1.6倍に収まるときだけ採用する（記録漏れなどで極端な値になった場合は計算式に戻す）。
export function computePlan(plan, kg, date, measured = null) {
  const bmr = 10 * kg + 6.25 * plan.height - 5 * plan.age + (plan.sex === 'male' ? 5 : -161), formula = bmr * ACTIVITY[plan.activity];
  const useMeasured = measured != null && measured >= formula * 0.6 && measured <= formula * 1.6, tdee = useMeasured ? measured : formula;
  const diff = plan.targetKg - kg, mode = Math.abs(diff) < 0.1 ? 'maintain' : diff < 0 ? 'lose' : 'gain';
  let delta = mode === 'maintain' ? 0 : plan.pace * KCAL_PER_KG / 7, limited = false;
  // 減量でも基礎代謝は下回らないようにし、その分ペースを落として日数を計算する。
  if (mode === 'lose' && tdee - delta < bmr) { delta = tdee - bmr; limited = true; }
  const kcal = Math.round((tdee + (mode === 'lose' ? -delta : delta)) / 10) * 10, pace = delta * 7 / KCAL_PER_KG;
  const days = mode === 'maintain' ? 0 : Math.ceil(Math.abs(diff) / pace * 7);
  // PFCの目安：たんぱく質は体重1kgあたり2g、脂質はカロリーの25%、残りを炭水化物。
  const p = Math.round(kg * 2), f = Math.round(kcal * 0.25 / 9), c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
  const total = plan.targetKg - plan.startKg, progress = total === 0 ? 1 : Math.min(1, Math.max(0, (kg - plan.startKg) / total));
  return { mode, kg, bmr, tdee, formula, useMeasured, rejected: measured != null && !useMeasured, kcal, p, f, c, pace, limited, days, eta: mode === 'maintain' ? null : shiftDay(date, days), remaining: diff, progress };
}
// 直近2週間の実際のペース（kg/週）。両端の7日トレンドがそろうときだけ。
export function weeklyChange(state, date) {
  const now = trendAt(state.weights, date), before = trendAt(state.weights, shiftDay(date, -14));
  return now && before ? (now.value - before.value) / 2 : null;
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
export const planOK = p => isObject(p) && numberOK(p.targetKg, true) && p.targetKg <= 1000 && numberOK(p.pace, true) && p.pace <= 2 && ['male', 'female'].includes(p.sex)
  && Number.isInteger(p.age) && p.age >= 10 && p.age <= 120 && numberOK(p.height) && p.height >= 100 && p.height <= 250 && Object.hasOwn(ACTIVITY, p.activity)
  && numberOK(p.startKg, true) && p.startKg <= 1000 && dateOK(p.startDate);
export function validateBackup(input) {
  if (!input || input.format!==FORMAT || ![1,2,3].includes(input.schemaVersion)) throw new Error('このバックアップ形式には対応していません。記録は変更していません。');
  if (typeof input.exportedAt!=='string' || Number.isNaN(Date.parse(input.exportedAt))) fail();
  if (!input.data || typeof input.data!=='object') fail();
  // バージョン1（サプリ機能追加前）にはサプリの項目がないため、空として読み込む。旧形式の項目は現在の形式に読み替える。
  const d=upgrade(input.schemaVersion===1 ? withSupplements(input.data) : input.data);
  const keys=['foods','meals','days','weights','goals','exercises','templates','sessions','supplements','supplementLogs','mealSets'];
  if (!d || keys.some(k=>!Array.isArray(d[k])||d[k].length>100000) || !d.settings || Array.isArray(d.settings) || typeof d.settings!=='object') fail();
  if (d.settings.plan !== undefined && !planOK(d.settings.plan)) fail();
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
  for(const x of d.mealSets) {
    if(!textOK(x.name)||!Array.isArray(x.items)||!x.items.length||x.items.length>50) fail();
    for(const m of x.items) if(!isObject(m)||!textOK(m.name)||!textOK(m.unit)||!numberOK(m.base,true)||!numberOK(m.amount,true)||!nutritionOK(m)||(m.foodId!==null&&!ids.foods.has(m.foodId))) fail();
  }
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
  s.settings.plan={targetKg:76,pace:0.5,sex:'male',age:30,height:172,activity:'moderate',startKg:80.9,startDate:shiftDay(date,-20)};
  for(const [i,amount,slot] of [[0,60,'朝食'],[3,1,'朝食'],[1,180,'昼食'],[2,200,'昼食']]) { const f=s.foods[i]; s.meals.push({...f,...scaleFood(f,amount),id:uid(),foodId:f.id,date,amount,slot}); }
  s.mealSets=[{id:uid(),name:'いつもの朝食',items:s.meals.filter(m=>m.slot==='朝食').map(mealSetItem)}];
  // 過去20日分の食事（記録からの消費カロリー補正を確かめるため）。
  const today=[...s.meals];
  for(let i=20;i>=1;i--){const d=shiftDay(date,-i);s.meals.push(...today.map(m=>({...m,id:uid(),date:d})),{id:uid(),foodId:null,date:d,slot:'夕食',name:'鮭の定食',base:1,unit:'食',amount:1,kcal:1350+(i%3)*60,p:45,f:40,c:190});}
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
