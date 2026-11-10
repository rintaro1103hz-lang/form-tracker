import { uid, localDate, shiftDay, emptyState, escapeHTML as esc, nutrients, totalMeals, scaleFood, dayStatus, markPartial, goalFor, trendAt, previousSets, makeBackup, validateBackup, sampleState, migrate, supplementDay, toggleDose, takeAll, plannedSlots, SLOTS, MAX_AMOUNT, estimate1RM, bestSet, e1rmHistory, E1RM_MAX_REPS, currentWeight, computePlan, weeklyChange } from './core.js';
import { normalize, searchMext, searchOff, lookupBarcode, barcodeOK, MEXT_SOURCE } from './fooddb.js';
import { openStore, loadState, saveState } from './storage.js';

let state, date=localDate(), page='today', demo=false, busy=false, pendingRestore=null, deferredInstall=null;
let period=28, foodFilter='all';
let pickSlot='朝食', picked=null, lastQuery='', localResults=[], offResults=[], searchTimer=0, searchSeq=0, scanStream=null, scanTimer=0;
const $=s=>document.querySelector(s);
const num=(v,d=0)=>v==null?'—':Number(v).toLocaleString('ja-JP',{maximumFractionDigits:d});
const statusLabels={empty:'未入力',partial:'記録途中',complete:'記録完了'};
const icons={today:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',meal:'<path d="M5 3v7m3-7v7M3 3v7c0 4 6 4 6 0M6 13v8M18 3c-4 4-5 10 0 10V3Zm0 10v8"/>',weight:'<path d="m3 17 6-6 4 3 8-10M16 4h5v5"/><path d="M3 4v17h18"/>',workout:'<path d="m6 6 12 12M3 8l5-5M2 6l4-4m12 19 4-4M16 21l5-5M6 10l4-4m4 12 4-4"/>',settings:'<path d="m9 3 1-1h4l1 3 3 1 3 3-1 3 1 3-3 3-3 1-1 3h-4l-1-3-3-1-3-3 1-3-1-3 3-3 3-1z"/><circle cx="12" cy="12" r="3"/>',plus:'<path d="M12 5v14M5 12h14"/>',arrow:'<path d="m9 5 7 7-7 7"/>',check:'<path d="m5 12 4 4L19 6"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',back:'<path d="m14 5-7 7 7 7"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',star:'<path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>',pill:'<path d="M10.5 20.5a5 5 0 0 1-7-7l9-9a5 5 0 0 1 7 7Z"/><path d="m8 8 8 8"/>',search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',barcode:'<path d="M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3M7 8v8M10 8v8M13 8v8M17 8v8"/>'};
const icon=(name,size=22)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.plus}</svg>`;
const button=(action,text,cls='primary',attrs='')=>`<button class="${cls}" data-action="${action}" ${attrs}>${text}</button>`;
const empty=(title,body,action,label)=>`<div class="empty"><div class="empty-symbol">${icon(action==='weight'?'weight':action==='start'?'workout':'meal',30)}</div><h3>${title}</h3><p>${body}</p>${action?button(action,label,'primary'):''}</div>`;
function toast(message) { $('#toast').textContent=message; $('#toast').classList.add('visible'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),4000); }
function modal(title,html) { stopScan(); const d=$('#modal'); d.innerHTML=`<div class="modal-head"><h2 id="modal-title">${title}</h2>${button('close',icon('close'),'icon-button','aria-label="閉じる"')}</div>${html}`; if(!d.open)d.showModal(); }
const close=()=>$('#modal').close();
function errorMessage(err) { console.error(err); toast(err?.message || '保存できませんでした。入力を確認してください。'); }
async function commit(change,message,closeModal=true) {
  if(busy)return false;
  busy=true;
  try { const next=structuredClone(state); change(next); validateBackup(makeBackup(next)); if(!demo)await saveState(next); state=next; if(closeModal)close(); render(); if(message)toast(message); return true; }
  catch(e){errorMessage(e); return false;}
  finally{busy=false;}
}
const dayMeals=()=>state.meals.filter(m=>m.date===date);
const summary=()=>totalMeals(dayMeals());
const dateLabel=d=>new Date(`${d}T12:00:00`).toLocaleDateString('ja-JP',{month:'long',day:'numeric',weekday:'short'});
function topDate() {return `<div class="date-control">${button('prev',icon('back'),'icon-button','aria-label="前の日"')}<label class="date-label">${dateLabel(date)}<input type="date" id="selected-date" value="${date}" aria-label="記録する日付"></label>${button('next',icon('arrow'),'icon-button','aria-label="次の日"')}${date!==localDate()?button('today','今日へ','text-button'):''}</div>`;}
function render() {
  const pages={today:['今日の記録','小さな積み重ねを、ひとつの場所に。'],meal:['食事の記録','食べたものを、無理なく残そう。'],weight:['体重の変化','日々の数字より、流れを見よう。'],workout:['筋トレの記録','前回の自分を、次の一歩に。'],settings:['設定とデータ','自分に合う目標と、安心できる保存を。']};
  $('#app').innerHTML=`<div class="app-shell"><aside class="sidebar"><a class="brand" href="#" data-action="nav" data-page="today"><span class="brand-mark">f<span>•</span></span><span>Form<small>食事とからだの記録</small></span></a><nav aria-label="メインナビ">${[['today','今日','today'],['meal','食事','meal'],['weight','体重','weight'],['workout','筋トレ','workout']].map(([p,t,i])=>`<button class="nav-item ${page===p?'active':''}" data-action="nav" data-page="${p}" ${page===p?'aria-current="page"':''}>${icon(i)}<span>${t}</span></button>`).join('')}</nav><div class="side-bottom"><div class="storage-indicator"><span></span>この端末に保存</div>${button('nav',icon('settings')+'<span>設定とバックアップ</span>','nav-item '+(page==='settings'?'active':''),'data-page="settings"')}<small>自分のペースで、続けよう。</small></div></aside><div class="workspace">${demo?`<div class="demo-banner"><span>サンプルを表示中 · 個人記録には保存されません</span>${button('exit-demo','自分の記録に戻る','text-button')}</div>`:''}<header class="page-header"><div><div class="mobile-brand">Form<span>•</span></div><h1>${pages[page][0]}</h1><p>${pages[page][1]}</p></div><div class="header-actions"><span class="offline-label">${navigator.onLine?'端末内保存':'オフライン'}</span>${button('nav',icon('settings'),'icon-button','data-page="settings" aria-label="設定とバックアップ"')}</div></header><main>${page!=='settings'?topDate():''}${({today:todayView,meal:mealView,weight:weightView,workout:workoutView,settings:settingsView})[page]()}</main><footer>Form <span>自分のペースで。</span></footer></div></div>`;
}
function nutritionCard() {
  const totals=summary(), goal=goalFor(state,date), meals=dayMeals(), status=dayStatus(state,date);
  const known=meals.length||status==='complete';
  const t=totals.kcal, remaining=goal?goal.kcal-t.value:null;
  const sumText=(key,d=0)=>!known || (totals[key].unknown&&!meals.some(m=>m[key]!=null)) ? '—' : (totals[key].unknown?'≥ ':'')+num(totals[key].value,d);
  return `<section class="nutrition panel"><div class="section-heading"><h2>${date===localDate()?'今日':'この日'}の栄養</h2><span class="status ${status}">${statusLabels[status]}</span></div><div class="energy"><div class="energy-main"><div class="overline">摂取カロリー</div><div class="energy-number">${sumText('kcal')}<span>kcal</span></div><div class="muted">${goal?`目標 ${num(goal.kcal)} kcal`:'目標はまだ設定されていません'}${t.unknown?' · 一部不明':''}</div></div><div class="energy-rest">${goal?`<span>${remaining>=0?'目標まで':'目標を超過'}</span><strong>${known&&!t.unknown?num(Math.abs(remaining)):'—'}<small> kcal</small></strong>`:button('goal','目標を設定','secondary')}</div></div><div class="energy-track"><span style="width:${goal&&known?Math.min(100,t.value/goal.kcal*100):0}%"></span></div><div class="macros">${[['p','たんぱく質','protein'],['f','脂質','fat'],['c','炭水化物','carbs']].map(([k,label,cl])=>`<div class="macro ${cl}"><div class="macro-label"><i></i>${label}</div><div><strong>${sumText(k,1)}</strong><span> / ${goal?num(goal[k]):'—'} g</span></div><div class="macro-track"><span style="width:${goal&&goal[k]>0&&known?Math.min(100,totals[k].value/goal[k]*100):0}%"></span></div>${totals[k].unknown?'<small>一部不明</small>':''}</div>`).join('')}</div><div class="nutrition-bottom"><span>${status==='partial'?'ここまでの記録です':status==='complete'?'1日分の食事を確認済み':'未入力を0 kcalとして扱いません'}</span>${button('food',icon('plus',17)+'食事を追加','primary small')}</div></section>`;
}
// 体重の目標。今の体重（7日トレンド、なければ直近の実測）から、1日の摂取カロリーと達成の目安を出す。
const MODE_LABEL={lose:'減量',maintain:'維持',gain:'増量'};
const ACTIVITY_LABEL={low:'ほぼ座って過ごす',light:'軽い運動を週1〜3回',moderate:'運動を週3〜5回',high:'激しい運動を週6〜7回'};
const PACES=[[0.25,'週0.25kg（ゆっくり）'],[0.5,'週0.5kg（標準）'],[0.75,'週0.75kg（速め）'],[1,'週1kg（かなり速い）']];
const longDate=d=>new Date(`${d}T12:00:00`).toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric'});
const signedKg=v=>`${v>0?'+':v<0?'−':''}${num(Math.abs(v),1)}`;
function planNow() {const plan=state.settings.plan,kg=plan?currentWeight(state,date):null;return plan&&kg!=null?computePlan(plan,kg,date):null;}
const planGoal=calc=>({id:uid(),date,mode:calc.mode,kcal:calc.kcal,p:calc.p,f:calc.f,c:calc.c});
function planCard(cls='') {
  const plan=state.settings.plan, calc=planNow(), head=`<div class="section-heading"><h2>体重の目標</h2>${plan?button('plan','変更する','text-button'):''}</div>`;
  if(!plan)return `<section class="panel ${cls}">${head}<p class="quiet-empty">目標体重を決めると、1日に摂るカロリーの目安と、達成までの日数を計算します。</p>${button('plan','目標体重を設定','primary')}</section>`;
  if(!calc)return `<section class="panel ${cls}">${head}<p class="quiet-empty">目標 ${num(plan.targetKg,1)} kg。体重を記録すると、摂取カロリーと達成の目安を計算します。</p>${button('weight','体重を記録','secondary')}</section>`;
  const goal=goalFor(state,date), actual=weeklyChange(state,date), stale=!goal||Math.abs(goal.kcal-calc.kcal)>=50;
  const done=calc.mode==='maintain';
  return `<section class="panel ${cls}">${head}<div class="plan-stats"><div><span class="muted">目標体重</span><strong>${num(plan.targetKg,1)}<small>kg</small></strong><small class="muted">${done?'目標に到達しました':`いま ${num(calc.kg,1)} kg · あと ${signedKg(calc.remaining)} kg`}</small></div><div><span class="muted">達成の目安</span><strong>${done?'達成':`${calc.days}<small>日後</small>`}</strong><small class="muted">${done?'この体重を維持':`${longDate(calc.eta)}ごろ · 週${num(calc.pace,2)}kgペース`}</small></div><div><span class="muted">1日の摂取カロリー</span><strong>${num(calc.kcal)}<small>kcal</small></strong><small class="muted">消費の推定 ${num(calc.tdee)} kcal</small></div></div><div class="energy-track plan-track" role="img" aria-label="開始${num(plan.startKg,1)}kgから目標までの進み具合 ${Math.round(calc.progress*100)}%"><span style="width:${calc.progress*100}%"></span></div><p class="note">${num(plan.startKg,1)} kg（${plan.startDate.slice(5).replace('-','/')}）から ${Math.round(calc.progress*100)}% 進みました。${actual!=null?`直近2週間の実際のペースは 週${signedKg(actual)} kg です。`:''}${calc.limited?'<br>基礎代謝を下回らないよう、選んだペースより緩やかにしています。':''}</p>${stale?`<div class="plan-apply"><span>${goal?`いまの栄養の目標は ${num(goal.kcal)} kcal です。`:'栄養の目標がまだありません。'}</span>${button('plan-apply',`${num(calc.kcal)} kcal を目標にする`,'secondary small')}</div>`:''}</section>`;
}
function planLine() {
  const plan=state.settings.plan, calc=planNow();
  if(!plan)return button('plan','目標体重を設定','text-button full');
  if(!calc)return '';
  return `<button class="plan-line" data-action="nav" data-page="weight"><span>目標 <strong>${num(plan.targetKg,1)} kg</strong></span><span>${calc.mode==='maintain'?'到達しました':`あと ${signedKg(calc.remaining)} kg · ${calc.days}日後`}</span></button>`;
}
function readPlan(form) {
  const fd=new FormData(form), n=k=>Number(fd.get(k)), old=state.settings.plan, kg=currentWeight(state,date)??n('kg');
  if(!(kg>0&&kg<=1000))throw new Error('今の体重を入力してください。');
  const p={targetKg:n('targetKg'),pace:n('pace'),sex:String(fd.get('sex')),age:n('age'),height:n('height'),activity:String(fd.get('activity'))};
  if(!(p.targetKg>0&&p.targetKg<=1000))throw new Error('目標体重を入力してください。');
  if(!Number.isInteger(p.age)||p.age<10||p.age>120)throw new Error('年齢は10〜120の整数で入力してください。');
  if(!(p.height>=100&&p.height<=250))throw new Error('身長は100〜250cmで入力してください。');
  const keep=old&&old.targetKg===p.targetKg;
  return {kg,plan:{...p,startKg:keep?old.startKg:kg,startDate:keep?old.startDate:date}};
}
function planPreview(form) {
  try{const {kg,plan}=readPlan(form),c=computePlan(plan,kg,date);
    return `<strong>${num(c.kcal)} kcal / 日</strong>　P ${c.p} / F ${c.f} / C ${c.c} g<br>${c.mode==='maintain'?'いまの体重とほぼ同じなので、維持のカロリーです。':`${MODE_LABEL[c.mode]} · ${c.days}日後（${longDate(c.eta)}ごろ）に達成の目安`}${c.limited?'<br>基礎代謝を下回らないよう、ペースを緩めています。':''}<br><small>消費の推定 ${num(c.tdee)} kcal（基礎代謝 ${num(c.bmr)} kcal）</small>`;
  }catch{return '入力すると、1日の摂取カロリーと達成の目安を表示します。';}
}
function planDialog() {
  const p=state.settings.plan, kg=currentWeight(state,date), select=(label,name,options,current)=>`<label class="field">${label}<select name="${name}">${options.map(([v,t])=>`<option value="${v}" ${String(current)===String(v)?'selected':''}>${t}</option>`).join('')}</select></label>`;
  modal('体重の目標を設定',`<form id="plan-form">${kg==null?field('今の体重 kg','kg','number','','required max="1000" placeholder="例：75.0"'):`<p class="note">今の体重は ${num(kg,1)} kg（体重の記録から）として計算します。</p>`}<div class="field-grid">${field('目標体重 kg','targetKg','number',p?.targetKg??'','required max="1000" placeholder="例：70"')}${select('ペース','pace',PACES,p?.pace??0.5)}</div><p class="note">消費カロリーの推定に使います。</p><div class="field-grid three">${select('性別','sex',[['male','男性'],['female','女性']],p?.sex??'male')}${field('年齢','age','number',p?.age??'','required max="120" inputmode="numeric"')}${field('身長 cm','height','number',p?.height??'','required max="250"')}</div>${select('ふだんの活動量','activity',Object.entries(ACTIVITY_LABEL),p?.activity??'light')}<div id="plan-preview" class="portion-preview"></div><label class="check-field"><input type="checkbox" name="applyGoal" checked>この計算を、今日からの栄養の目標（カロリー・PFC）にする</label>${formFooter('目標を保存')}${p?button('delete-plan','体重の目標を削除','danger-text full'):''}</form>`);
  $('#plan-preview').innerHTML=planPreview($('#plan-form'));
}
// 単位に「1個」のように数字まで入れてしまっても「1 1個」と二重にならないよう、先頭の数字は取り除く。
const cleanUnit=unit=>String(unit??'').replace(/^[\d.\s]+/,'').trim()||'個';
const amountText=(amount,unit)=>`${num(amount,2)}${esc(cleanUnit(unit))}`;
function weekDots(s) {
  const planned=plannedSlots(s).length;
  return `<span class="week" aria-hidden="true">${[6,5,4,3,2,1,0].map(i=>{const day=shiftDay(date,-i),taken=state.supplementLogs.filter(l=>l.supplementId===s.id&&l.date===day).length;return `<i class="${taken?(taken>=planned?'full':'part'):''}"></i>`;}).join('')}</span>`;
}
function supplementCard() {
  const groups=supplementDay(state,date).filter(g=>g.items.length), all=groups.flatMap(g=>g.items), done=all.filter(x=>x.taken).length;
  return `<section class="panel supplement"><div class="section-heading"><h2>${icon('pill',19)}サプリメント${all.length?` <span class="count">${done} / ${all.length}</span>`:''}</h2>${button('supplements','登録・編集','text-button')}</div>${all.length?groups.map(g=>{const left=g.items.filter(x=>!x.taken).length;return `<div class="supp-group"><div class="group-title"><h3>${g.slot}<span class="count">${g.items.length-left} / ${g.items.length}</span></h3>${left>1?button('dose-all','まとめて飲んだ','text-button',`data-slot="${g.slot}"`):''}</div>${g.items.map(x=>`<div class="supp-row"><div class="row-main"><strong>${esc(x.supplement.name)}</strong><small>${amountText(x.amount,x.unit)}</small></div>${button('dose',x.taken?icon('check',18):'','dose'+(x.taken?' on':''),`data-id="${x.supplement.id}" data-slot="${g.slot}" aria-pressed="${x.taken}" aria-label="${g.slot}の${esc(x.supplement.name)} ${amountText(x.amount,x.unit)}"`)}</div>`).join('')}</div>`;}).join(''):`<p class="quiet-empty">飲んでいるサプリを登録すると、朝・昼・晩ごとにここでチェックできます。</p>${button('supplement-edit',icon('plus',17)+'サプリを登録','secondary')}`}</section>`;
}
function supplementsDialog() {
  modal('サプリメントの登録・編集',`<p class="note">一度登録すれば、毎日のチェックに使い回せます。点は${dateLabel(date)}までの7日間です。</p><div class="food-picker">${state.supplements.map(s=>button('supplement-edit',`<span>${esc(s.name)}${s.active?'':'<span class="tag">停止中</span>'}<small>${plannedSlots(s).map(k=>`${k} ${amountText(s.doses[k],s.unit)}`).join(' · ')}</small>${weekDots(s)}</span>${icon('arrow',17)}`,'food-choice',`data-id="${s.id}"`)).join('')||'<p class="quiet-empty">まだ登録がありません。</p>'}</div>${button('supplement-edit',icon('plus',17)+'サプリを登録','primary full')}`);
}
function supplementDialog(id) {
  const s=state.supplements.find(x=>x.id===id);
  modal(s?'サプリを編集':'サプリを登録',`<form id="supplement-form" data-id="${s?.id||''}"><div class="field-grid">${field('サプリメント名','name','text',s?.name||'','required maxlength="120" placeholder="例：クレアチン"')}${field('単位（数字は入れない）','unit','text',s?cleanUnit(s.unit):'個','required maxlength="20" placeholder="個・粒・g・杯"')}</div><p class="note">1回に飲む量を、飲む時間帯に入れてください。飲まない時間帯は空欄のままで大丈夫です。</p><div class="field-grid three">${SLOTS.map(k=>field(k,`dose-${k}`,'number',s?.doses[k]||'',`max="${MAX_AMOUNT}" placeholder="—"`)).join('')}</div><p class="note">量を変えても、すでにチェックした日の記録は当時の量のまま残ります。</p>${formFooter(s?'変更を保存':'登録する')}${s?button('supplement-active',s.active?'毎日のチェックから外す（記録は残す）':'毎日のチェックに戻す','text-button full',`data-id="${s.id}"`)+button('delete-supplement','このサプリと記録を削除','danger-text full',`data-id="${s.id}"`):''}</form>`);
}
const CATEGORIES=['胸','背中','肩','腕','脚','腹','その他'];
const categories=()=>[...new Set([...CATEGORIES,...state.exercises.map(e=>e.category)])];
const grouped=exercises=>categories().map(c=>[c,exercises.filter(e=>e.category===c)]).filter(([,rows])=>rows.length);
const groupTitle=c=>`<p class="check-group">${esc(c)}</p>`;
function exerciseChecks(selected=[]) {
  return state.exercises.length?`<div class="check-list">${grouped(state.exercises).map(([c,rows])=>groupTitle(c)+rows.map(e=>`<label class="check-field"><input type="checkbox" name="exercises" value="${e.id}" ${selected.includes(e.id)?'checked':''}>${esc(e.name)}</label>`).join('')).join('')}</div>`:'';
}
function exercisesDialog() {
  modal('種目の登録・編集',`<div class="food-picker tall">${grouped(state.exercises).map(([c,rows])=>groupTitle(c)+rows.map(e=>button('exercise-edit',`<span>${esc(e.name)}<small>${e.mode==='bodyweight'?'自重＋追加重量':'使用重量'}</small></span>${icon('arrow',17)}`,'food-choice',`data-id="${e.id}"`)).join('')).join('')||'<p class="quiet-empty">まだ種目がありません。「胸」の「ベンチプレス」のように登録できます。</p>'}</div>${button('exercise',icon('plus',17)+'種目を登録','primary full')}`);
}
function presetPanel(first) {
  const names=t=>t.exerciseIds.map(id=>state.exercises.find(e=>e.id===id)?.name).filter(Boolean).join('、');
  return `<section class="panel ${first?'':'spaced'}"><div class="section-heading"><h2>${first?'今日やるメニューを選ぶ':'プリセット'}</h2>${button('template',icon('plus',17)+'プリセットを作成','text-button')}</div>${state.templates.length?state.templates.map(t=>`<div class="record-row"><div><strong>${esc(t.name)}</strong><small>${t.exerciseIds.length}種目 · ${esc(names(t))}</small></div>${button('template','編集','text-button',`data-id="${t.id}"`)}${button('start-template','始める','secondary small',`data-id="${t.id}" aria-label="${esc(t.name)}を始める"`)}</div>`).join(''):'<p class="quiet-empty">「胸の日」「背中の日」のように種目をまとめておくと、選ぶだけで始められます。</p>'}${first?`<div class="preset-other">${button('start','プリセットを使わずに始める','text-button')}</div>`:''}</section>`;
}
function todayView() {
  const w=state.weights.find(w=>w.date===date), trend=trendAt(state.weights,date), session=state.sessions.find(s=>s.date===date), counts=dayMeals().length;
  return `<div class="dashboard-grid"><div class="main-column">${nutritionCard()}${supplementCard()}<section class="panel meal-preview"><div class="section-heading"><h2>食事の記録 <span class="count">${counts}</span></h2>${button('nav','すべて見る '+icon('arrow',15),'text-button','data-page="meal"')}</div>${counts?mealRows(dayMeals().slice(-3)):empty('最初の食事を記録しよう','食品を登録すると、次回からすぐに選べます。','food','食事を追加')}</section></div><div class="sub-column"><section class="panel weight-mini"><div class="section-heading"><h2>${icon('weight',19)}体重</h2><span class="unit-label">kg</span></div><div class="weight-value">${w?num(w.kg,1):'—'}<span>${w?'記録済み':'この日の体重は未入力'}</span></div>${miniChart()}<div class="trend-caption">${trend?`7日トレンド <strong>${num(trend.value,1)} kg</strong><span>${trend.count}日分の実測</span>`:'実測が3日以上あるとトレンドを表示します'}</div>${planLine()}${button('weight',icon('plus',17)+(w?'体重を修正':'体重を記録'),'secondary full')}</section><section class="workout-prompt"><div class="workout-symbol">${icon('workout',30)}</div><h2>からだを動かす日。</h2><p>${session?`${esc(session.name)} · ${session.complete?'完了':'記録中'}`:'前回の記録を見ながら、<br>今日のトレーニングを。'}</p>${button(session?'nav':'start',(session?'今日の記録を見る':'筋トレを始める')+icon('arrow',17),'primary full','data-page="workout"')}</section></div></div>${!demo&&!state.meals.length&&!state.weights.length&&!state.sessions.length?`<div class="sample-invite"><span>まずは使い心地を確かめたい？</span>${button('demo','サンプルを見る','text-button')}</div>`:''}`;
}
function mealRows(rows) {return `<div class="meal-list">${rows.map(m=>`<div class="meal-row"><span class="food-dot">${esc(m.slot.slice(0,1))}</span><div class="row-main"><strong>${esc(m.name)}</strong><small>${num(m.amount,1)} ${esc(m.unit)}<span>P ${num(m.p,1)} / F ${num(m.f,1)} / C ${num(m.c,1)}</span></small></div><div class="row-value">${num(m.kcal)}<small>kcal</small></div>${button('edit-meal',icon('arrow',17),'icon-button',`data-id="${m.id}" aria-label="${esc(m.name)}を編集"`)}</div>`).join('')}</div>`;}
function mealView() {
  const status=dayStatus(state,date), meals=dayMeals();
  return `${nutritionCard()}<section class="panel spaced"><div class="section-heading"><h2>この日の食事</h2>${button('copy','別の日からコピー','text-button')}</div>${['朝食','昼食','夕食','間食'].map(slot=>`<div class="meal-group"><div class="group-title"><h3>${slot}</h3>${button('food',icon('plus',17)+'追加','text-button',`data-slot="${slot}"`)}</div>${meals.some(m=>m.slot===slot)?mealRows(meals.filter(m=>m.slot===slot)):'<p class="quiet-empty">まだ記録がありません</p>'}</div>`).join('')}<div class="completion-row"><div><strong>${status==='complete'?'1日分の記録を確認済み':'1日分の入力が終わったら'}</strong><p>${status==='complete'?'編集すると記録途中に戻ります。':'未入力の食事がないことを確認してください。'}</p></div>${button('complete',icon('check',18)+(status==='complete'?'完了を解除':'記録を完了'),'secondary')}</div></section>`;
}
const dayNum=d=>Math.round(new Date(`${d}T12:00:00`).getTime()/86400000);
// 折れ線グラフ。series: [{rows:[{date,value,pr?}], cls:'raw'|'trend', dots:true|false}]。色はCSSのクラスで決める。
function lineChart(series,{large=false,start,end,digits=1,label=''}={}) {
  const all=series.flatMap(s=>s.rows); if(!all.length)return '';
  const width=large?760:320,height=large?245:104,left=large?46:6,right=large?14:6,top=large?18:8,bottom=large?30:8;
  const vals=all.map(r=>r.value),lo=Math.min(...vals),hi=Math.max(...vals),pad=Math.max(0.5,(hi-lo)*0.12),min=lo-pad,max=hi+pad;
  const dates=all.map(r=>r.date).sort(),first=start||dates[0],last=end||dates.at(-1),span=Math.max(1,dayNum(last)-dayNum(first));
  const x=d=>left+(dayNum(d)-dayNum(first))/span*(width-left-right), y=v=>top+(1-(v-min)/(max-min))*(height-top-bottom);
  const grid=large?[0,.5,1].map(n=>{const yy=top+n*(height-top-bottom);return `<line class="chart-grid-line" x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}"/><text class="chart-label" x="0" y="${yy+4}">${num(max-n*(max-min),digits)}</text>`;}).join(''):'';
  const lines=series.map(s=>`${s.rows.length>1?`<polyline class="chart-${s.cls}" points="${s.rows.map(r=>`${x(r.date)},${y(r.value)}`).join(' ')}"/>`:''}${s.dots||s.rows.length===1?s.rows.map(r=>`<circle class="chart-dot-${s.cls}${r.pr?' pr':''}" cx="${x(r.date)}" cy="${y(r.value)}" r="${large?(r.pr?4.5:3):2.4}"><title>${r.date}: ${num(r.value,digits)}</title></circle>`).join(''):''}`).join('');
  const axis=large?`<text class="chart-label" x="${left}" y="${height-6}">${first.slice(5).replace('-','/')}</text><text class="chart-label" x="${width-right}" y="${height-6}" text-anchor="end">${last.slice(5).replace('-','/')}</text>`:'';
  return `<svg class="weight-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>${grid}${lines}${axis}</svg>`;
}
function chart(weights,large=false) {
  const start=period===9999?null:shiftDay(date,-(period-1));
  const rows=weights.filter(w=>w.date<=date&&(!start||w.date>=start)).sort((a,b)=>a.date.localeCompare(b.date));
  if(!rows.length)return `<div class="chart-empty ${large?'large':''}"><span>${large?'体重を記録すると、ここに変化が見えてきます。':'体重の変化をここに表示します'}</span><div class="chart-grid"></div></div>`;
  const trend=rows.map(w=>({date:w.date,t:trendAt(weights,w.date)})).filter(w=>w.t).map(w=>({date:w.date,value:w.t.value}));
  return lineChart([{rows:rows.map(w=>({date:w.date,value:w.kg})),cls:'raw',dots:true},{rows:trend,cls:'trend'}],{large,start:start||rows[0].date,end:date,label:`${rows.length}日分の体重推移。最新の実測${num(rows.at(-1).kg,1)}kg。細い線は実測、太い線は直近7暦日の平均。`});
}
function miniChart(){return chart(state.weights);}
function weightView() {
  const rows=state.weights.filter(w=>w.date<=date).sort((a,b)=>b.date.localeCompare(a.date)), latest=rows[0], trend=trendAt(state.weights,date);
  return `${planCard()}<section class="panel spaced"><div class="section-heading"><h2>体重の推移</h2>${button('weight',icon('plus',17)+'体重を記録','primary small')}</div><div class="weight-overview"><div><span class="muted">${latest?`${latest.date} の実測`:'最新の実測'}</span><strong>${latest?num(latest.kg,1):'—'}<small>kg</small></strong></div><div><span class="muted">7日トレンド</span><strong>${trend?num(trend.value,1):'—'}<small>kg</small></strong><small class="muted">${trend?`${trend.count}日分の平均`:'直近7暦日に3日分以上の実測が必要'}</small></div></div><div class="chart-tools"><div class="legend"><i></i>実測 <i class="trend"></i>7日トレンド</div><div class="segmented">${[[28,'4週'],[84,'12週'],[9999,'全期間']].map(([n,t])=>button('period',t,period===n?'selected':'',`data-value="${n}"`)).join('')}</div></div>${chart(state.weights,true)}<p class="note">欠測日は補完せず、実測値からトレンドを計算します。</p></section><section class="panel spaced"><div class="section-heading"><h2>これまでの記録</h2><span class="muted">${rows.length}件</span></div>${rows.length?`<div class="weight-history">${rows.slice(0,60).map(w=>`<div class="record-row"><span>${dateLabel(w.date)}</span><strong>${num(w.kg,1)} <small>kg</small></strong>${button('weight', '編集','text-button',`data-date="${w.date}"`)}</div>`).join('')}</div>`:empty('今日の数字から始めよう','同じ日の体重は、あとから修正できます。','weight','体重を記録')}</section>`;
}
const signed=v=>`${v>=0?'+':'−'}${num(Math.abs(v),1)}`;
function exerciseBlock(session,eid) {
  const ex=state.exercises.find(e=>e.id===eid), sets=session.sets.filter(x=>x.exerciseId===eid), prev=previousSets(state,eid,date), weighted=ex.mode==='weighted';
  const history=weighted?e1rmHistory(state,eid):[], record=Math.max(0,...history.filter(h=>h.date<date).map(h=>h.value)), today=weighted?bestSet(sets):null, pr=!!today&&record>0&&today.value>record;
  return `<div class="exercise-block"><div class="exercise-head"><h3>${esc(ex.name)}<span class="tag">${esc(ex.category)}</span>${ex.mode==='bodyweight'?'<span class="tag">自重</span>':''}</h3>${history.length?button('progress',`推移 ${icon('arrow',15)}`,'text-button',`data-id="${eid}"`):''}</div><p class="previous">前回 ${prev?`${prev.date}　${prev.sets.map(s=>`${num(s.kg,1)}kg × ${s.reps}回`).join(' / ')}`:'まだ記録がありません'}</p>${weighted&&(today||record)?`<div class="e1rm-summary"><div><span>今日の推定1RM</span><strong>${today?num(today.value,1):'—'}<small> kg</small></strong></div><div><span>これまでの最高</span><strong>${record?num(record,1):'—'}<small> kg</small></strong></div>${pr?'<span class="pr-badge">自己ベスト更新</span>':''}</div>`:''}<div class="set-table ${weighted?'with-e1rm':''}"><div class="set-row set-header"><span>セット</span><span>${weighted?'重量':'追加重量'}</span><span>回数</span>${weighted?'<span>推定1RM</span>':''}<span></span></div>${sets.map((s,i)=>`<div class="set-row"><span>${i+1}</span><strong>${num(s.kg,1)}<small> kg</small></strong><strong>${s.reps}<small> 回</small></strong>${weighted?`<span class="e1rm">${num(estimate1RM(s.kg,s.reps),1)}</span>`:''}${session.complete?icon('check',17):button('edit-set','編集','text-button',`data-session="${session.id}" data-id="${s.id}"`)}</div>`).join('')}</div>${!session.complete?button('set',icon('plus',17)+'セットを追加','text-button',`data-session="${session.id}" data-exercise="${eid}"`):''}</div>`;
}
function progressPanel() {
  const rows=state.exercises.filter(e=>e.mode==='weighted').map(e=>({e,h:e1rmHistory(state,e.id).filter(x=>x.date<=date)})).filter(r=>r.h.length);
  return `<section class="panel spaced"><div class="section-heading"><h2>推定1RMの推移</h2><span class="muted">${rows.length}種目</span></div>${rows.length?rows.map(({e,h})=>{const best=Math.max(...h.map(x=>x.value));return `<button class="progress-row" data-action="progress" data-id="${e.id}"><span class="row-main"><strong>${esc(e.name)}</strong><small>${esc(e.category)} · ${h.length}回分 · 最高 ${num(best,1)} kg</small></span><span class="spark">${lineChart([{rows:h,cls:'trend'}],{label:`${e.name}の推定1RM`})}</span><span class="row-value">${num(h.at(-1).value,1)}<small>${h.length>1?`${signed(h.at(-1).value-h[0].value)} kg`:'kg'}</small></span></button>`;}).join(''):'<p class="quiet-empty">重量と回数を記録すると、種目ごとの推定1RMの伸びがここに表示されます。</p>'}</section>`;
}
function progressDialog(id) {
  const e=state.exercises.find(x=>x.id===id), h=e1rmHistory(state,id); if(!e||!h.length)return;
  const best=h.reduce((a,b)=>b.value>a.value?b:a);
  modal(esc(e.name),`<div class="weight-overview compact"><div><span class="muted">自己ベスト（推定1RM）</span><strong>${num(best.value,1)}<small>kg</small></strong><small class="muted">${best.date} · ${num(best.set.kg,1)}kg × ${best.set.reps}回</small></div><div><span class="muted">初回から</span><strong>${signed(h.at(-1).value-h[0].value)}<small>kg</small></strong><small class="muted">${h[0].date} → ${h.at(-1).date}</small></div></div>${lineChart([{rows:h,cls:'trend',dots:true}],{large:true,label:`${e.name}の推定1RMの推移`})}<div class="weight-history short">${[...h].reverse().map(x=>`<div class="record-row"><span>${dateLabel(x.date)}${x.pr?'<span class="pr-badge small">PR</span>':''}<small>${num(x.set.kg,1)}kg × ${x.set.reps}回</small></span><strong>${num(x.value,1)} <small>kg</small></strong></div>`).join('')}</div><p class="note">推定1RMは Epley式（重量 ×（1 + 回数 ÷ 30））で、${E1RM_MAX_REPS}回以下のセットから計算した目安です。日ごとに一番高いセットを使います。</p>`);
}
function workoutView() {
  const sessions=state.sessions.filter(s=>s.date===date);
  return `${sessions.length?sessions.map((session,n)=>`<section class="panel session ${n?'spaced':''}"><div class="section-heading"><div><h2>${esc(session.name)}</h2><span class="status ${session.complete?'complete':'partial'}">${session.complete?'トレーニング完了':'記録中'}</span></div>${button('session-toggle',session.complete?'編集を再開':'完了にする','secondary small',`data-id="${session.id}"`)}</div>${session.exerciseIds.map(eid=>exerciseBlock(session,eid)).join('')}${!session.complete?`<div class="session-actions">${button('session-exercise',icon('plus',17)+'種目を追加','secondary',`data-id="${session.id}"`)}${button('delete-session','この記録を削除','danger-text',`data-id="${session.id}"`)}</div>`:''}</section>`).join('')+presetPanel(false):presetPanel(true)}${progressPanel()}<section class="panel spaced"><div class="section-heading"><h2>トレーニング履歴</h2></div>${state.sessions.filter(s=>s.date<date).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,15).map(s=>`<div class="record-row"><div><strong>${esc(s.name)}</strong><small>${s.date} · ${s.sets.length}セット · ${s.complete?'完了':'記録途中'}</small></div>${button('session-date',icon('arrow',18),'icon-button',`data-date="${s.date}" aria-label="${s.date}の記録を開く"`)}</div>`).join('')||'<p class="quiet-empty">完了した記録を、次回の参考に。</p>'}</section>`;
}
function settingsView() {
  const g=goalFor(state,date);
  return `<div class="settings-grid">${planCard()}<section class="panel"><div class="section-heading"><h2>栄養の目標</h2>${button('goal','変更する','text-button')}</div><div class="goal-summary"><span>${g?{lose:'減量',maintain:'維持',gain:'増量'}[g.mode]:'目標未設定'}</span><strong>${g?num(g.kcal):'—'}<small>kcal / 日</small></strong><p>P ${g?g.p:'—'} g　F ${g?g.f:'—'} g　C ${g?g.c:'—'} g</p></div><p class="note">1日に摂るカロリーとPFC（たんぱく質・脂質・炭水化物）の目安です。「今日」の画面の残りカロリーはこの数値と比べています。体重の目標から自動で計算でき、ここで手で直すこともできます。</p></section><section class="panel"><div class="section-heading"><h2>食品・種目の管理</h2></div>${button('foods','自作食品・お気に入り '+icon('arrow',17),'setting-link')}${button('exercises','種目を登録・編集 '+icon('arrow',17),'setting-link')}${button('template','プリセットを作成 '+icon('plus',17),'setting-link')}${button('supplements','サプリメントを登録・編集 '+icon('arrow',17),'setting-link')}</section><section class="panel backup-panel"><div class="section-heading"><h2>バックアップと復元</h2>${icon('download')}</div><p>この端末の記録を、ファイルとして手元に残せます。</p><p class="note">最終書き出し：${state.settings.lastExport?esc(new Date(state.settings.lastExport).toLocaleString('ja-JP')):'まだありません'}<br>ブラウザのデータ削除で記録が消えるため、定期的に書き出してください。</p><div class="backup-actions">${button('export',icon('download',18)+'書き出す','primary',demo?'disabled':'')}${button('restore','ファイルから復元','secondary',demo?'disabled':'')}</div><p class="note">復元は全件置換です。検証と確認を終えるまで記録を変更しません。</p></section><section class="panel"><div class="section-heading"><h2>このアプリについて</h2><span class="tag">試作版</span></div><p>Form は、食事・体重・筋トレ・サプリをまとめて残す自分用の記録帳です。</p><p class="note">消費カロリーは身長・体重・年齢・活動量からの推定（Mifflin-St Jeor式）で、体脂肪1kgを7,200kcalとして計算した目安です。実際の記録からの自動調整は未実装です。</p><p class="note">食品データ：${MEXT_SOURCE}（アプリに内蔵）、<a href="https://world.openfoodfacts.org/" target="_blank" rel="noopener">Open Food Facts</a>（市販品・バーコード、ODbL）。市販品の検索とバーコード読み取りのときだけ、検索語やバーコード番号をOpen Food Factsに送信します。</p>${button(demo?'exit-demo':'demo',demo?'自分の記録に戻る':'サンプルを試す','secondary')}${deferredInstall?button('install','ホーム画面に追加','primary spaced'):''}<details><summary>Androidで使うには</summary><p class="note">公開URLをChromeで開き、メニュー（⋮）から「ホーム画面に追加」を選びます。記録はその端末の中だけに保存され、ほかの端末とは共有されません。</p></details></section></div>`;
}
const field=(label,name,type='number',value='',extra='')=>`<label class="field">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra} ${type==='number'?'inputmode="decimal" min="0" step="any"':''}></label>`;
const formError='<p class="form-error" role="alert"></p>';
const formFooter=(label='保存する')=>`${formError}<button type="submit" class="primary full">${label}</button>`;
const inputNumber=(form,key,nullable=false)=>{const v=new FormData(form).get(key); if(v===''&&nullable)return null; const n=Number(v);if(v===''||v===null||!Number.isFinite(n)||n<0)throw new Error('数値は0以上で入力してください。');return n;};
const SLOT_NAMES=['朝食','昼食','夕食','間食'];
const slotSelect=current=>`<label class="field">食事<select name="slot">${SLOT_NAMES.map(s=>`<option ${s===current?'selected':''}>${s}</option>`).join('')}</select></label>`;
const nutrientLine=f=>`${num(f.base,1)}${esc(f.unit)}あたり ${num(f.kcal)} kcal · P ${num(f.p,1)} F ${num(f.f,1)} C ${num(f.c,1)}`;
const sourceTag={mine:'マイ食品',mext:'成分表',off:'市販品'};
const resultButton=(f,list,i)=>button('pick-result',`<span>${esc(f.name)}<small>${f.brand?`${esc(f.brand)} · `:''}${nutrientLine(f)}</small></span><span class="tag">${sourceTag[f.source]||''}</span>`,'food-choice',`data-list="${list}" data-index="${i}"`);
const myFoods=()=>[...state.foods].filter(f=>foodFilter!=='favorite'||f.favorite).sort((a,b)=>(b.favorite-a.favorite)||a.name.localeCompare(b.name,'ja')).map(f=>({...f,source:'mine'}));
function renderLocal(list) {
  localResults=list; const box=$('#food-results'); if(!box)return;
  box.innerHTML=list.map((f,i)=>resultButton(f,'local',i)).join('')||`<p class="quiet-empty">${lastQuery?'見つかりませんでした。下の「市販品を検索」か、手入力を試してください。':'検索して選んだ食品を「マイ食品」に登録すると、ここからすぐ選べます。'}</p>`;
}
async function runLocalSearch(query) {
  lastQuery=String(query??'').trim(); const seq=++searchSeq;
  const off=$('#off-search'); if(off)off.innerHTML=`${icon('search',17)}${lastQuery?`「${esc(lastQuery)}」を市販品で検索`:'市販品をネットで検索'}`;
  const tabs=$('#food-tabs'); if(tabs)tabs.hidden=!!lastQuery;
  if(!lastQuery){renderLocal(myFoods());return;}
  const tokens=lastQuery.split(/\s+/).map(normalize).filter(Boolean), mine=myFoods().filter(f=>tokens.every(t=>normalize(f.name).includes(t)));
  renderLocal(mine);
  try{const found=await searchMext(lastQuery); if(seq===searchSeq)renderLocal([...mine,...found]);}catch(e){if(seq===searchSeq)toast(e.message);}
}
function mealForm(entry,manual) {
  return `<form id="meal-form" data-id="${entry?.id||''}"><div class="field-grid">${field('日付','date','date',entry?.date||date,'required')}${slotSelect(entry?.slot||pickSlot)}</div>${field('食品・食事名','name','text',entry?.name||manual?.name||'','required maxlength="120" placeholder="例：鶏むね肉"')}<div class="field-grid">${field('基準量','base','number',entry?.base||100,'required')}${field('単位','unit','text',entry?.unit||'g','required maxlength="20"')}</div><p class="note">以下は基準量あたり。分からない栄養素は空欄のままにできます。</p><div class="field-grid nutrition-fields">${nutrients.map((k,i)=>field(['カロリー kcal','たんぱく質 g','脂質 g','炭水化物 g'][i],k,'number',entry?(entry[k]==null?'':Math.round(entry[k]*entry.base/entry.amount*1000)/1000):'')).join('')}</div>${field('食べた分量','amount','number',entry?.amount||100,'required')}<p class="note">基準量と同じ単位で入力します。</p>${!entry?'<label class="check-field"><input type="checkbox" name="saveFood" checked>マイ食品に登録</label>':''}${formFooter(entry?'変更を保存':'食事を保存')}${entry?button('delete-meal','この食事を削除','danger-text full',`data-id="${entry.id}"`):''}</form>`;
}
function foodDialog(slot,entry=null,manual=null) {
  if(slot)pickSlot=slot;
  if(entry){modal('食事を編集',mealForm(entry));return;}
  modal('食事を追加',`<div class="search-bar"><span class="search-icon">${icon('search',18)}</span><input id="food-search" type="search" value="${esc(lastQuery)}" placeholder="食品を検索（例：鶏むね、ごはん、納豆）" aria-label="食品を検索" autocomplete="off" enterkeyhint="search">${button('barcode',icon('barcode',20),'icon-button scan-button','aria-label="バーコードを読み取る"')}</div><div class="food-tabs" id="food-tabs">${button('food-tab','マイ食品',foodFilter==='all'?'selected':'','data-filter="all"')}${button('food-tab','お気に入り',foodFilter==='favorite'?'selected':'','data-filter="favorite"')}${button('food-history','履歴','')}</div><div id="food-results" class="food-picker"></div><div class="off-area">${button('off-search','','secondary full','id="off-search"')}<div id="off-results" class="food-picker"></div></div><details class="manual" ${manual?'open':''}><summary>手入力で記録</summary>${manual?.note?`<p class="note">${esc(manual.note)}</p>`:''}${mealForm(null,manual)}</details>`);
  runLocalSearch(lastQuery);
  if(!manual)setTimeout(()=>$('#food-search')?.focus({preventScroll:true}),50);
}
const portionText=(f,amount)=>{try{const v=scaleFood(f,Number(amount));return `<strong>${num(v.kcal)} kcal</strong>　P ${num(v.p,1)} / F ${num(v.f,1)} / C ${num(v.c,1)} g`;}catch{return '分量を入力してください';}};
function pickFood(food) {
  if(!food)return; picked=food;
  const mine=state.foods.some(x=>x.id===food.id), amount=food.serving||food.base, chips=food.unit==='g'?[50,100,150,200,300]:[0.5,1,2];
  modal('分量を選ぶ',`${button('back-search',icon('back',16)+'検索に戻る','text-button back-link')}<div class="food-detail"><span class="tag">${mine?'マイ食品':sourceTag[food.source]||''}</span><h3>${esc(food.name)}</h3>${food.brand?`<p>${esc(food.brand)}</p>`:''}<p>${nutrientLine(food)}</p></div><form id="portion-form">${field(`食べた分量（${esc(food.unit)}）`,'amount','number',amount,'required')}<div class="chips">${food.serving?button('pick-amount',`1食分 ${num(food.serving,1)}${esc(food.unit)}`,'chip',`type="button" data-value="${food.serving}"`):''}${chips.map(v=>button('pick-amount',`${v}${esc(food.unit)}`,'chip',`type="button" data-value="${v}"`)).join('')}</div>${slotSelect(pickSlot)}<div id="portion-preview" class="portion-preview">${portionText(food,amount)}</div>${mine?'':`<label class="check-field"><input type="checkbox" name="saveFood" ${food.source==='off'?'checked':''}>マイ食品に登録（次回すぐ選べて、お気に入りにもできます）</label>`}${formFooter('食事を保存')}</form>${mine?button('favorite',(food.favorite?'★ お気に入りを解除':'☆ お気に入りに追加'),'text-button full',`data-id="${food.id}"`):''}${food.source==='mext'?`<p class="note">出典：${MEXT_SOURCE}</p>`:food.source==='off'?`<p class="note">出典：Open Food Facts（利用者が投稿したデータです。パッケージの表示と違うときは手入力してください）${food.servingLabel?`<br>1食分の表示：${esc(food.servingLabel)}`:''}</p>`:''}`);
}
function stopScan() {clearTimeout(scanTimer);scanTimer=0;scanStream?.getTracks().forEach(t=>t.stop());scanStream=null;}
function barcodeDialog() {
  modal('バーコードで探す',`<div class="scanner"><video id="scan-video" playsinline muted></video><div class="scan-frame"></div></div><div id="scan-status" class="scan-status">カメラを準備しています…</div><form id="barcode-form">${field('または、バーコードの数字を入力','code','text','','inputmode="numeric" pattern="[0-9]*" maxlength="14" autocomplete="off" placeholder="例：4901234567890"')}${formFooter('この番号で探す')}</form>`);
  startScan();
}
async function startScan() {
  const status=$('#scan-status'), video=$('#scan-video'), hide=message=>{$('.scanner').hidden=true;status.textContent=message;};
  if(!('BarcodeDetector' in window)||!navigator.mediaDevices?.getUserMedia)return hide('このブラウザはカメラでの読み取りに対応していません。バーコードの下の数字を入力してください。');
  try {
    const formats=(await BarcodeDetector.getSupportedFormats()).filter(f=>['ean_13','ean_8','upc_a','upc_e'].includes(f));
    if(!formats.length)return hide('このブラウザはカメラでの読み取りに対応していません。バーコードの下の数字を入力してください。');
    const detector=new BarcodeDetector({formats});
    scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
    if(!$('#scan-video'))return stopScan();
    video.srcObject=scanStream; await video.play(); status.textContent='バーコードを枠に合わせてください。';
    const tick=async()=>{if(!scanStream)return;try{const hit=(await detector.detect(video)).find(c=>barcodeOK(c.rawValue));if(hit){stopScan();navigator.vibrate?.(60);await findBarcode(hit.rawValue);return;}}catch{}scanTimer=setTimeout(tick,250);};
    tick();
  } catch(e) { stopScan(); if($('#scan-status'))hide(e?.name==='NotAllowedError'?'カメラの使用が許可されていません。数字を入力するか、ブラウザの設定でカメラを許可してください。':'カメラを起動できませんでした。数字を入力してください。'); }
}
async function findBarcode(code) {
  const status=$('#scan-status'), say=html=>{if(status)status.innerHTML=html;else toast(html.replace(/<[^>]+>/g,''));};
  say(`${esc(code)} を探しています…`);
  try {
    const food=await lookupBarcode(code);
    if(food&&!food.empty)return pickFood(food);
    const note=food?`「${food.name}」は見つかりましたが、栄養成分が登録されていません。パッケージの栄養成分表示を見て入力してください。`:`この商品（${code}）はまだデータベースにありません。パッケージの栄養成分表示を見て入力してください。`;
    say(`${esc(note)}${button('manual-entry','手入力で記録する','secondary full',`data-name="${esc(food?.name||'')}" data-note="${esc(note)}"`)}`);
  } catch(e) { say(esc(e.message)); }
}
function weightDialog(target=date) {const w=state.weights.find(x=>x.date===target); modal('体重を記録',`<form id="weight-form">${field('日付','date','date',target,'required')}${field('体重 kg','kg','number',w?.kg||'','required max="1000" placeholder="例：80.2"')}<p class="note">同じ日に記録がある場合は、その値を更新します。</p>${formFooter()}${w?button('delete-weight','この体重記録を削除','danger-text full',`data-id="${w.id}"`):''}</form>`);}
function goalDialog(){const g=goalFor(state,date);modal('栄養の目標を設定',`<form id="goal-form">${field('適用開始日','date','date',date,'required')}<label class="field">目的<select name="mode">${[['lose','減量'],['maintain','維持'],['gain','増量']].map(([v,t])=>`<option value="${v}" ${g?.mode===v?'selected':''}>${t}</option>`).join('')}</select></label><div class="field-grid">${nutrients.map((k,i)=>field(['カロリー kcal','たんぱく質 g','脂質 g','炭水化物 g'][i],k,'number',g?.[k]??'','required')).join('')}</div><p class="note">各数値を自分で設定します。目的を選ぶだけでは数値は変わりません。体重の目標から計算したいときは「体重の目標」を使ってください。</p>${formFooter('目標を保存')}</form>`);}
function exerciseDialog(sessionId=null,id=null){const e=state.exercises.find(x=>x.id===id);modal(e?'種目を編集':'種目を登録',`<form id="exercise-form" data-session="${sessionId||''}" data-id="${e?.id||''}">${field('ジャンル（部位）','category','text',e?.category||'','required maxlength="20" placeholder="例：胸"')}<div class="chips">${categories().map(c=>button('pick-category',esc(c),'chip',`type="button" data-value="${esc(c)}"`)).join('')}</div>${field('種目名','name','text',e?.name||'','required maxlength="120" placeholder="例：ベンチプレス"')}<label class="field">重量の記録方法<select name="mode"><option value="weighted" ${e?.mode==='weighted'?'selected':''}>使用重量を記録</option><option value="bodyweight" ${e?.mode==='bodyweight'?'selected':''}>自重＋追加重量を記録</option></select></label>${e?'<p class="note">名前やジャンルを変えると、過去の記録の表示も新しい名前になります。</p>':''}${formFooter(e?'変更を保存':'種目を登録')}</form>`);}
function startDialog(){modal('筋トレを始める',`${state.templates.length?`<div class="food-picker">${state.templates.map(t=>button('start-template',`<span>${esc(t.name)}<small>${t.exerciseIds.length}種目</small></span>${icon('arrow')}`,'food-choice',`data-id="${t.id}"`)).join('')}</div><div class="form-divider">または、自由に記録</div>`:''}<form id="start-form">${field('トレーニング名','name','text','トレーニング','required maxlength="120"')}${exerciseChecks()||'<p class="note">開始後に種目を登録できます。</p>'}${formFooter('記録を始める')}</form>`);}
function templateDialog(id){const t=state.templates.find(x=>x.id===id);modal(t?'プリセットを編集':'プリセットを作成',`<form id="template-form" data-id="${t?.id||''}">${field('プリセット名','name','text',t?.name||'','required maxlength="120" placeholder="例：胸の日"')}${exerciseChecks(t?.exerciseIds)||'<p class="note">先に種目を登録してください。</p>'}${formFooter('プリセットを保存')}${t?button('delete-template','このプリセットを削除','danger-text full',`data-id="${t.id}"`):''}</form>${button('exercise','新しい種目を登録','secondary full')}`);}
const e1rmPreview=(kg,reps)=>{const v=estimate1RM(Number(kg),Number(reps));return v!=null?`推定1RM <strong>${num(v,1)} kg</strong>`:Number(reps)>E1RM_MAX_REPS?`推定1RMは${E1RM_MAX_REPS}回以下のセットで計算します`:'重量と回数を入れると推定1RMを表示します';};
function setDialog(sid,eid,setId=null){const session=state.sessions.find(x=>x.id===sid),ex=state.exercises.find(x=>x.id===eid),s=session.sets.find(x=>x.id===setId),prev=previousSets(state,eid,date)?.sets.at(-1),weighted=ex.mode==='weighted',kg=s?.kg??prev?.kg??0,reps=s?.reps??prev?.reps??'';modal(s?'セットを編集':'セットを追加',`<h3>${esc(ex.name)}</h3><form id="set-form" data-session="${sid}" data-exercise="${eid}" data-id="${setId||''}"><div class="field-grid">${field(weighted?'重量 kg':'追加重量 kg','kg','number',kg,'required')}${field('回数','reps','number',reps,'required max="10000"')}</div>${weighted?`<div id="e1rm-preview" class="portion-preview">${e1rmPreview(kg,reps)}</div>`:''}<p class="note">実施したセットを保存します。入力欄を閉じただけでは保存しません。</p>${formFooter()}${s?button('delete-set','このセットを削除','danger-text full',`data-session="${sid}" data-id="${s.id}"`):''}</form>`);}
function confirmDialog(title,body,action,attrs=''){modal(title,`<p>${body}</p><div class="confirm-actions">${button('close','戻る','secondary')}${button(action,'確認して続ける','primary',attrs)}</div>`);}
function downloadBackup(data,prefix='form-backup') {const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${prefix}-${localDate()}-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function exportBackup(){if(demo)return;const next=structuredClone(state);next.settings.lastExport=new Date().toISOString(); await saveState(next);state=next;downloadBackup(makeBackup(state));render();toast('書き出しました。ダウンロード先を確認してください。');}
function restoreDialog(){pendingRestore=null;modal('バックアップから復元',`<p>Formで書き出したJSONファイルを選んでください。</p><input type="file" id="backup-file" accept=".json,application/json"><div id="restore-preview"></div>`);}
function foodsDialog(){modal('自作食品・お気に入り',`<div class="food-picker">${state.foods.map(f=>`<div class="food-choice"><span>${esc(f.name)}<small>${f.base} ${esc(f.unit)}あたり ${num(f.kcal)} kcal</small></span>${button('favorite-manage',f.favorite?'★':'☆','icon-button',`data-id="${f.id}" aria-label="${esc(f.name)}のお気に入りを切替"`)}</div>`).join('')||'<p class="quiet-empty">食事を手入力するときに、食品として登録できます。</p>'}</div>${button('food','食品と食事を追加','primary full')}`);}

document.addEventListener('click',async event=>{
 const el=event.target.closest('[data-action]'); if(!el||busy)return;
 event.preventDefault();const a=el.dataset.action,id=el.dataset.id;
 try {
  if(a==='nav'){page=el.dataset.page;render();window.scrollTo(0,0);}
  else if(a==='close')close();
  else if(a==='prev'||a==='next'){date=shiftDay(date,a==='prev'?-1:1);render();}
  else if(a==='today'){date=localDate();render();}
  else if(a==='food')foodDialog(el.dataset.slot);
  else if(a==='edit-meal')foodDialog(null,state.meals.find(x=>x.id===id));
  else if(a==='food-tab'){foodFilter=el.dataset.filter;foodDialog(pickSlot);}
  else if(a==='food-history'){const rows=[...state.meals].sort((a,b)=>b.date.localeCompare(a.date));const unique=rows.filter((m,i)=>rows.findIndex(x=>x.name===m.name)===i).slice(0,20);modal('食事の履歴',`<p class="note">選んだ食事を${date}にコピーします。</p><div class="food-picker">${unique.map(m=>button('copy-one',`<span>${esc(m.name)}<small>${m.date} · ${num(m.amount,1)} ${esc(m.unit)} · ${num(m.kcal)} kcal</small></span>${icon('plus')}`,'food-choice',`data-id="${m.id}"`)).join('')||'<p class="quiet-empty">まだ食事の履歴がありません。</p>'}</div>`);}
  else if(a==='pick-result')pickFood((el.dataset.list==='off'?offResults:localResults)[Number(el.dataset.index)]);
  else if(a==='back-search')foodDialog(pickSlot);
  else if(a==='pick-amount'){const input=$('#portion-form').elements.amount;input.value=el.dataset.value;$('#portion-preview').innerHTML=portionText(picked,input.value);}
  else if(a==='barcode')barcodeDialog();
  else if(a==='manual-entry')foodDialog(pickSlot,null,{name:el.dataset.name,note:el.dataset.note});
  else if(a==='progress')progressDialog(id);
  else if(a==='off-search'){
    const q=$('#food-search')?.value.trim(),box=$('#off-results');if(!q){toast('商品名を入力してから検索してください。');return;}
    box.innerHTML='<p class="quiet-empty">市販品を検索しています…</p>';
    try{offResults=await searchOff(q);if(!$('#off-results'))return;box.innerHTML=offResults.map((f,i)=>resultButton(f,'off',i)).join('')||'<p class="quiet-empty">見つかりませんでした。別の言葉で探すか、手入力してください。</p>';}
    catch(e){if($('#off-results'))box.innerHTML=`<p class="quiet-empty">${esc(e.message)}</p>`;}
  }
  else if(a==='favorite'||a==='favorite-manage'){await commit(s=>{const f=s.foods.find(x=>x.id===id);f.favorite=!f.favorite;},null,false);if(a==='favorite')pickFood({...state.foods.find(x=>x.id===id),source:'mine'});else foodsDialog();}
  else if(a==='copy-one')await commit(s=>{const m=s.meals.find(x=>x.id===id);s.meals.push({...m,id:uid(),date});markPartial(s,date);},'食事をコピーしました');
  else if(a==='copy')modal('別の日からコピー',`<form id="copy-form">${field('コピー元の日付','source','date',shiftDay(date,-1),'required')}<p class="note">コピー先：${date}。同じ記録がある場合も追加されます。</p>${formFooter('内容を確認')}</form>`);
  else if(a==='copy-confirm')await commit(s=>{const rows=s.meals.filter(x=>x.date===el.dataset.date);s.meals.push(...rows.map(x=>({...x,id:uid(),date})));markPartial(s,date);},'食事をコピーしました');
  else if(a==='complete'){if(dayStatus(state,date)==='complete')await commit(s=>markPartial(s,date),'記録途中に戻しました');else confirmDialog('1日分の記録を完了',`${date}の食事はすべて入力しましたか？${!dayMeals().length?' 食事が0件です。明示的な0 kcalの記録として完了します。':''}`,'complete-confirm');}
  else if(a==='complete-confirm')await commit(s=>{s.days=s.days.filter(x=>x.date!==date);s.days.push({id:uid(),date,status:'complete'});},'1日分の記録を完了しました');
  else if(a==='delete-meal')confirmDialog('食事を削除','この食事記録を削除します。登録食品は残ります。','delete-meal-confirm',`data-id="${id}"`);
  else if(a==='delete-meal-confirm')await commit(s=>{const m=s.meals.find(x=>x.id===id);markPartial(s,m.date);s.meals=s.meals.filter(x=>x.id!==id);},'食事を削除しました');
  else if(a==='weight')weightDialog(el.dataset.date||date);
  else if(a==='delete-weight')confirmDialog('体重記録を削除','選択した日の実測を削除します。','delete-weight-confirm',`data-id="${id}"`);
  else if(a==='delete-weight-confirm')await commit(s=>{s.weights=s.weights.filter(x=>x.id!==id);},'体重記録を削除しました');
  else if(a==='goal')goalDialog();
  else if(a==='plan')planDialog();
  else if(a==='plan-apply'){const calc=planNow();if(calc)await commit(s=>{s.goals=s.goals.filter(x=>x.date!==date);s.goals.push(planGoal(calc));},'栄養の目標を更新しました',false);}
  else if(a==='delete-plan')confirmDialog('体重の目標を削除','目標体重と、計算に使う身長・年齢などの設定を削除します。体重の記録と栄養の目標は残ります。','delete-plan-confirm');
  else if(a==='delete-plan-confirm')await commit(s=>{delete s.settings.plan;},'体重の目標を削除しました');
  else if(a==='period'){period=Number(el.dataset.value);render();}
  else if(a==='start')startDialog();
  else if(a==='start-template'){const t=state.templates.find(x=>x.id===id);await startSession(t.name,t.exerciseIds);}
  else if(a==='exercise')exerciseDialog();
  else if(a==='template')templateDialog(id);
  else if(a==='session-exercise'){const s=state.sessions.find(x=>x.id===id);modal('種目を追加',`<div class="food-picker">${grouped(state.exercises.filter(e=>!s.exerciseIds.includes(e.id))).map(([c,rows])=>groupTitle(c)+rows.map(e=>button('add-session-exercise',esc(e.name)+icon('plus'),'food-choice',`data-id="${id}" data-exercise="${e.id}"`)).join('')).join('')||'<p class="quiet-empty">追加できる種目はありません。</p>'}</div>${button('new-session-exercise','新しい種目を登録','primary full',`data-id="${id}"`)}`);}
  else if(a==='new-session-exercise')exerciseDialog(id);
  else if(a==='add-session-exercise')await commit(s=>s.sessions.find(x=>x.id===id).exerciseIds.push(el.dataset.exercise),'種目を追加しました');
  else if(a==='set')setDialog(el.dataset.session,el.dataset.exercise);
  else if(a==='edit-set'){const s=state.sessions.find(x=>x.id===el.dataset.session);setDialog(s.id,s.sets.find(x=>x.id===id).exerciseId,id);}
  else if(a==='delete-set')await commit(s=>{const session=s.sessions.find(x=>x.id===el.dataset.session);session.sets=session.sets.filter(x=>x.id!==id);session.updatedAt=new Date().toISOString();},'セットを削除しました');
  else if(a==='session-toggle'){const s=state.sessions.find(x=>x.id===id);if(!s.complete&&!s.sets.length)throw new Error('実施したセットを1つ以上記録してください。');await commit(d=>{const x=d.sessions.find(x=>x.id===id);x.complete=!x.complete;x.updatedAt=new Date().toISOString();},s.complete?'編集を再開しました':'トレーニングを完了しました');}
  else if(a==='delete-session')confirmDialog('筋トレ記録を削除','このトレーニングのセットも削除します。','delete-session-confirm',`data-id="${id}"`);
  else if(a==='delete-session-confirm')await commit(s=>{s.sessions=s.sessions.filter(x=>x.id!==id);},'筋トレ記録を削除しました');
  else if(a==='session-date'){date=el.dataset.date;render();window.scrollTo(0,0);}
  else if(a==='export')await exportBackup();
  else if(a==='restore')restoreDialog();
  else if(a==='restore-backup'){downloadBackup(makeBackup(state),'form-before-restore');$('#restore-confirm').disabled=false;$('#restore-check').disabled=false;toast('復元前のバックアップをダウンロードしてください。');}
  else if(a==='restore-confirm'){if(!pendingRestore||!$('#restore-check').checked)throw new Error('バックアップの退避と、全件置換の確認にチェックを入れてください。');const candidate=validateBackup(pendingRestore);if(await commit(s=>{for(const k of Object.keys(s))delete s[k];Object.assign(s,candidate);},'バックアップを復元しました'))pendingRestore=null;}
  else if(a==='foods')foodsDialog();
  else if(a==='dose')await commit(s=>{toggleDose(s,date,id,el.dataset.slot);},null,false);
  else if(a==='dose-all')await commit(s=>takeAll(s,date,el.dataset.slot),null,false);
  else if(a==='exercises')exercisesDialog();
  else if(a==='exercise-edit')exerciseDialog(null,id);
  else if(a==='pick-category'){const input=el.closest('form').elements.category;input.value=el.dataset.value;}
  else if(a==='delete-template')confirmDialog('プリセットを削除',`「${esc(state.templates.find(x=>x.id===id).name)}」を削除します。種目と、これまでのトレーニング記録は残ります。`,'delete-template-confirm',`data-id="${id}"`);
  else if(a==='delete-template-confirm')await commit(s=>{s.templates=s.templates.filter(x=>x.id!==id);},'プリセットを削除しました');
  else if(a==='supplements')supplementsDialog();
  else if(a==='supplement-edit')supplementDialog(id);
  else if(a==='supplement-active'){if(await commit(s=>{const x=s.supplements.find(x=>x.id===id);x.active=!x.active;},'変更しました',false))supplementsDialog();}
  else if(a==='delete-supplement')confirmDialog('サプリを削除',`「${esc(state.supplements.find(x=>x.id===id).name)}」と、その服用記録${state.supplementLogs.filter(l=>l.supplementId===id).length}件を削除します。記録を残したい場合は「毎日のチェックから外す」を使ってください。`,'delete-supplement-confirm',`data-id="${id}"`);
  else if(a==='delete-supplement-confirm')await commit(s=>{s.supplements=s.supplements.filter(x=>x.id!==id);s.supplementLogs=s.supplementLogs.filter(l=>l.supplementId!==id);},'サプリを削除しました');
  else if(a==='demo'){demo=true;state=sampleState(localDate());date=localDate();page='today';close();render();toast('サンプルで操作を試せます');}
  else if(a==='exit-demo'){const saved=await loadState();state=saved?migrate(saved):emptyState();demo=false;page='today';date=localDate();close();render();}
  else if(a==='install'&&deferredInstall){await deferredInstall.prompt();deferredInstall=null;render();}
 }catch(e){errorMessage(e);}
});
async function startSession(name,exerciseIds){const ok=await commit(s=>s.sessions.push({id:uid(),name,date,exerciseIds:[...exerciseIds],sets:[],complete:false,updatedAt:new Date().toISOString()}),'トレーニングを開始しました');if(ok){page='workout';render();}}
document.addEventListener('submit',async event=>{
 const form=event.target;if(!form.matches('dialog form'))return;event.preventDefault();if(busy)return;
 const fd=new FormData(form),val=k=>String(fd.get(k)||'').trim();
 try {
  if(form.id==='meal-form'){
    const base=inputNumber(form,'base'),amount=inputNumber(form,'amount');if(base<=0||amount<=0)throw new Error('基準量と分量は0より大きくしてください。');
    if(nutrients.every(k=>fd.get(k)===''))throw new Error('カロリーかPFCを1つ以上入力してください。');
    const food={name:val('name'),base,unit:val('unit'),favorite:false,...Object.fromEntries(nutrients.map(k=>[k,inputNumber(form,k,true)]))};
    await commit(s=>{let foodId=null;if(fd.has('saveFood')){foodId=uid();s.foods.push({...food,id:foodId});}const old=s.meals.find(x=>x.id===form.dataset.id);if(old){foodId=old.foodId;markPartial(s,old.date);}const meal={...food,...scaleFood(food,amount),id:old?.id||uid(),foodId,amount,date:val('date'),slot:val('slot')};s.meals=s.meals.filter(x=>x.id!==meal.id);s.meals.push(meal);markPartial(s,meal.date);},'食事を保存しました');
  }else if(form.id==='portion-form'){
    const food=picked,amount=inputNumber(form,'amount'),values=scaleFood(food,amount),slot=val('slot'),save=fd.has('saveFood');
    const base={name:food.name,base:food.base,unit:food.unit,kcal:food.kcal,p:food.p,f:food.f,c:food.c};
    await commit(s=>{let foodId=s.foods.some(x=>x.id===food.id)?food.id:null;if(!foodId&&save){foodId=uid();s.foods.push({...base,id:foodId,favorite:false});}s.meals.push({...base,...values,id:uid(),foodId,amount,date,slot});markPartial(s,date);},'食事を保存しました');
  }else if(form.id==='barcode-form'){
    const code=val('code').replace(/\D/g,'');if(!barcodeOK(code))throw new Error('バーコードの数字（8桁または13桁）を入力してください。');stopScan();$('.scanner')&&($('.scanner').hidden=true);await findBarcode(code);
}else if(form.id==='weight-form'){
    const kg=inputNumber(form,'kg'),day=val('date');if(kg<=0||kg>1000)throw new Error('体重は0より大きく、1000kg以下にしてください。');
    await commit(s=>{const old=s.weights.find(x=>x.date===day);s.weights=s.weights.filter(x=>x.date!==day);s.weights.push({id:old?.id||uid(),date:day,kg});},'体重を保存しました');
  }else if(form.id==='goal-form'){
    const g={id:uid(),date:val('date'),mode:val('mode'),...Object.fromEntries(nutrients.map(k=>[k,inputNumber(form,k)]))};if(g.kcal<=0)throw new Error('カロリー目標は0より大きくしてください。');await commit(s=>{s.goals=s.goals.filter(x=>x.date!==g.date);s.goals.push(g);},'目標を保存しました');
  }else if(form.id==='plan-form'){
    const {kg,plan}=readPlan(form),calc=computePlan(plan,kg,date),hadWeight=currentWeight(state,date)!=null;
    await commit(s=>{s.settings.plan=plan;if(!hadWeight)s.weights.push({id:uid(),date,kg});if(fd.has('applyGoal')){s.goals=s.goals.filter(x=>x.date!==date);s.goals.push(planGoal(calc));}},'体重の目標を保存しました');
  }else if(form.id==='start-form'){await startSession(val('name'),fd.getAll('exercises'));
  }else if(form.id==='supplement-form'){
    const name=val('name'),unit=val('unit')&&cleanUnit(val('unit')),doses=Object.fromEntries(SLOTS.map(k=>[k,inputNumber(form,`dose-${k}`,true)??0]));
    if(!name||!unit)throw new Error('サプリメント名と単位を入力してください。');
    if(SLOTS.some(k=>doses[k]>MAX_AMOUNT))throw new Error(`量は${MAX_AMOUNT}以下で入力してください。`);
    if(!SLOTS.some(k=>doses[k]>0))throw new Error('朝・昼・晩のどれかに、1回に飲む量を入れてください。');
    if(state.supplements.some(x=>x.name===name&&x.id!==form.dataset.id))throw new Error('同じ名前のサプリが登録済みです。');
    await commit(s=>{const old=s.supplements.find(x=>x.id===form.dataset.id);if(old)Object.assign(old,{name,unit,doses});else s.supplements.push({id:uid(),name,unit,active:true,doses});},'サプリを保存しました');
  }else if(form.id==='exercise-form'){
    const name=val('name'),category=val('category'),mode=val('mode');if(!name||!category)throw new Error('ジャンルと種目名を入力してください。');
    if(state.exercises.some(x=>x.name===name&&x.category===category&&x.id!==form.dataset.id))throw new Error('同じジャンルに同じ名前の種目が登録済みです。');
    await commit(s=>{const old=s.exercises.find(x=>x.id===form.dataset.id);if(old)Object.assign(old,{name,category,mode});else{const ex={id:uid(),name,category,mode};s.exercises.push(ex);if(form.dataset.session)s.sessions.find(x=>x.id===form.dataset.session).exerciseIds.push(ex.id);}},'種目を保存しました');
  }else if(form.id==='template-form'){
    const ids=fd.getAll('exercises'),name=val('name');if(!name)throw new Error('プリセット名を入力してください。');if(!ids.length)throw new Error('種目を1つ以上選んでください。');
    await commit(s=>{const old=s.templates.find(x=>x.id===form.dataset.id);if(old)Object.assign(old,{name,exerciseIds:ids});else s.templates.push({id:uid(),name,exerciseIds:ids});},'プリセットを保存しました');
}else if(form.id==='set-form'){
    const kg=inputNumber(form,'kg'),reps=inputNumber(form,'reps');if(!Number.isInteger(reps)||reps<1||reps>10000)throw new Error('回数は1以上の整数で入力してください。');
    await commit(s=>{const session=s.sessions.find(x=>x.id===form.dataset.session);if(session.complete)throw new Error('先に編集を再開してください。');session.sets=session.sets.filter(x=>x.id!==form.dataset.id);session.sets.push({id:form.dataset.id||uid(),exerciseId:form.dataset.exercise,kg,reps});session.updatedAt=new Date().toISOString();},'セットを保存しました');
  }else if(form.id==='copy-form'){
    const source=val('source'),rows=state.meals.filter(x=>x.date===source);if(source===date)throw new Error('別の日付を選んでください。');if(!rows.length)throw new Error('この日に食事の記録がありません。');modal('コピー内容を確認',`<p>${source}の${rows.length}件を${date}に追加します。</p>${mealRows(rows).replace(/<button[\s\S]*?<\/button>/g,'')}<p class="note">コピー先の記録は残ります。1日分の記録は「途中」に戻ります。</p>${button('copy-confirm','この内容を追加','primary full',`data-date="${source}"`)}`);
  }
 }catch(e){const out=form.querySelector('.form-error');if(out)out.textContent=e.message;else errorMessage(e);}
});
document.addEventListener('input',event=>{
 const t=event.target;
 if(t.id==='food-search'){clearTimeout(searchTimer);searchTimer=setTimeout(()=>runLocalSearch(t.value),120);}
 if(t.closest('#portion-form')&&t.name==='amount'&&picked)$('#portion-preview').innerHTML=portionText(picked,t.value);
 if(t.closest('#plan-form'))$('#plan-preview').innerHTML=planPreview(t.form);
 if(t.closest('#set-form')&&$('#e1rm-preview')){const f=t.form;$('#e1rm-preview').innerHTML=e1rmPreview(f.elements.kg.value,f.elements.reps.value);}
});
document.addEventListener('keydown',event=>{if(event.target.id==='food-search'&&event.key==='Enter'){event.preventDefault();$('#off-search')?.click();}});
document.addEventListener('change',async event=>{
 if(event.target.id==='selected-date'&&event.target.value){date=event.target.value;render();}
 if(event.target.id==='backup-file'){
  pendingRestore=null;const out=$('#restore-preview');out.textContent='ファイルを確認しています…';
  try{const file=event.target.files[0];if(!file){out.textContent='';return;}if(file.size>20*1024*1024)throw new Error('ファイルが大きすぎます（上限20MB）。');const parsed=JSON.parse(await file.text());const candidate=validateBackup(parsed);pendingRestore=parsed;const dates=[...candidate.meals,...candidate.weights,...candidate.sessions].map(x=>x.date).sort();out.innerHTML=`<div class="restore-summary"><h3>復元内容</h3><p>食品 ${candidate.foods.length}件 · 食事 ${candidate.meals.length}件<br>体重 ${candidate.weights.length}件 · 筋トレ ${candidate.sessions.length}件<br>サプリ ${candidate.supplements.length}種 · 服用記録 ${candidate.supplementLogs.length}件</p><p class="note">期間：${dates.length?`${dates[0]} ～ ${dates.at(-1)}`:'記録なし'}</p></div><p>現在の全記録を、このファイルの内容で置き換えます。</p>${button('restore-backup','1. 現在の記録を退避する','secondary full')}<label class="check-field"><input id="restore-check" type="checkbox" disabled>バックアップを手元に保存し、全件置換を確認しました</label>${button('restore-confirm','2. 確認した内容で復元','primary full','id="restore-confirm" disabled')}`;}catch(e){out.textContent=e instanceof SyntaxError?'JSONファイルを読み取れませんでした。記録は変更していません。':e.message;}
 }
});
window.addEventListener('online',render);window.addEventListener('offline',render);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;if(state&&page==='settings')render();});
$('#modal').addEventListener('close',stopScan);
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=$('#modal').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}});
try {await openStore();const saved=await loadState();state=saved?validateBackup(makeBackup(migrate(saved))):emptyState();render();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('Offline registration',e));}
catch(e){$('#app').innerHTML=`<div class="startup-error"><h1>記録を開けませんでした</h1><p>端末の保存機能を利用できるブラウザで開き直してください。保存済みの記録は削除していません。</p><p>${esc(e.message)}</p><button class="primary" onclick="location.reload()">もう一度開く</button></div>`;}
