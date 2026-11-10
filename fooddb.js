// 食品データの検索：内蔵の日本食品標準成分表と、Open Food Facts（市販品・バーコード）。
// 値はすべて100gあたり。不明な栄養素は null のまま返し、0で埋めない。

export const MEXT_SOURCE = '日本食品標準成分表（八訂）増補2023年（文部科学省）';
const OFF = 'https://world.openfoodfacts.org';
const OFF_FIELDS = 'code,product_name,product_name_ja,brands,nutriments,serving_size,serving_quantity';

// 検索用に表記ゆれを畳む：全角半角・大小文字・カタカナ/ひらがな。記号と空白は区切り（keepSpaces）か削除。
export function normalize(text, keepSpaces = false) {
  const folded = String(text ?? '').normalize('NFKC').toLowerCase()
    .replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  return keepSpaces ? ` ${folded.replace(/[\s\[\]［］＜＞<>（）()「」,，.。、]+/g, ' ').trim()} ` : folded.replace(/[\s\[\]［］＜＞<>（）()「」・,，.。、]/g, '');
}

// 成分表は「にわとり」「めし」など独特の名前なので、よく使う呼び方を読み替える。
// 置き換えは1回だけ・長い語を優先して行う（「牛乳」を「牛」→「うし」と二重に読み替えないため）。
const ALIASES = new Map([
  ['鶏むね', 'にわとり むね'], ['鶏胸', 'にわとり むね'], ['鶏もも', 'にわとり もも'], ['サラダチキン', 'にわとり むね'],
  ['鶏卵', '鶏卵'], ['ゆで卵', '鶏卵 全卵 ゆで'], ['卵', '鶏卵 全卵'], ['たまご', '鶏卵 全卵'], ['玉子', '鶏卵 全卵'],
  ['鶏肉', 'にわとり'], ['鶏', 'にわとり'], ['チキン', 'にわとり'],
  ['豚肉', 'ぶた'], ['豚', 'ぶた'], ['ポーク', 'ぶた'], ['牛乳', '普通牛乳'], ['牛肉', 'うし'], ['牛', 'うし'], ['ビーフ', 'うし'],
  ['白ごはん', 'めし 精白米'], ['ごはん', 'めし 精白米'], ['ご飯', 'めし 精白米'], ['白米', 'めし 精白米'], ['ライス', 'めし 精白米'],
  ['胸', 'むね'], ['腿', 'もも'], ['鮭', 'さけ'], ['サーモン', 'さけ'], ['ツナ', 'まぐろ 缶詰'],
  // 成分表で漢字表記の食品を、ひらがなで打っても見つかるように。
  ['とりむね', 'にわとり むね'], ['とりもも', 'にわとり もも'], ['とりにく', 'にわとり'], ['ぶたにく', 'ぶた'], ['ぎゅうにく', 'うし'],
  ['なっとう', '納豆'], ['とうふ', '豆腐'], ['ぎゅうにゅう', '普通牛乳'], ['しょくぱん', '食パン'], ['とうにゅう', '豆乳'],
  ['げんまい', 'めし 玄米'], ['はくまい', 'めし 精白米'], ['ゆでたまご', '鶏卵 全卵 ゆで'], ['なまたまご', '鶏卵 全卵 生'], ['めだまやき', '鶏卵 目玉焼き'],
]);
const ALIAS_RE = new RegExp([...ALIASES.keys()].sort((a, b) => b.length - a.length).join('|'), 'g');
export function queryTokens(query) {
  const text = String(query ?? '').normalize('NFKC').replace(ALIAS_RE, m => ` ${ALIASES.get(m)} `);
  return text.split(/\s+/).map(t => normalize(t)).filter(Boolean);
}

const PREFER = ['若どり・主品目', 'うるち米', '糸引き納豆', '木綿豆腐', '普通牛乳', '全卵', '大型種肉', '乳用肥育牛肉'].map(w => normalize(w));
const AVOID = ['副品目', '親・', '陸稲', 'もち米', 'はむ類', '和牛肉'].map(w => normalize(w));

let mextPromise;
export function loadMext() {
  mextPromise ??= fetch('./foods-jp.json').then(r => { if (!r.ok) throw new Error('食品データを読み込めませんでした。'); return r.json(); })
    .then(d => d.foods.map(([code, name, kcal, p, f, c]) => ({ code, name, key: normalize(name, true), kcal, p, f, c })))
    .catch(e => { mextPromise = null; throw e; });
  return mextPromise;
}

// 成分表の名前「＜鳥肉類＞ にわとり ［若どり・主品目］ むね 皮なし 生」を読みやすく整える。
export const displayName = name => name.replace(/＜[^＞]*＞\s*/g, '').replace(/[［］]/g, ' ').replace(/\s+/g, ' ').trim();

export async function searchMext(query, limit = 30) {
  // 「150g」のような分量の数字は名前の検索には使わない。
  const tokens = queryTokens(query).filter(t => !/^[\d.]+(g|kg|ml|個|杯|枚|本)?$/.test(t));
  if (!tokens.length) return [];
  const rows = (await loadMext()).filter(x => tokens.every(t => x.key.includes(t)));
  // 先頭近くで一致し、名前が短い（基本の食品）ほど上に。よく食べる種類は上げ、珍しい種類は検索語に含まれない限り下げる。
  const q = tokens.join(' ');
  const adjust = x => PREFER.reduce((s, w) => s - (x.key.includes(w) ? 20 : 0), 0) + AVOID.reduce((s, w) => s + (x.key.includes(w) && !q.includes(w) ? 15 : 0), 0);
  const score = x => tokens.reduce((s, t) => s + x.key.indexOf(t), 0) + x.key.length * 0.5 + adjust(x);
  return rows.sort((a, b) => score(a) - score(b)).slice(0, limit).map(x => ({
    source: 'mext', ref: x.code, name: displayName(x.name), base: 100, unit: 'g', kcal: x.kcal, p: x.p, f: x.f, c: x.c,
  }));
}

const n = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : null);
export function fromOff(product) {
  const m = product?.nutriments ?? {};
  const kcal = n(m['energy-kcal_100g']) ?? (n(m.energy_100g) == null ? null : Math.round(m.energy_100g / 4.184));
  const food = {
    source: 'off', ref: String(product.code ?? ''),
    name: String(product.product_name_ja || product.product_name || '').trim(),
    brand: String(Array.isArray(product.brands) ? product.brands.join(', ') : product.brands ?? '').trim(),
    base: 100, unit: 'g', kcal, p: n(m.proteins_100g), f: n(m.fat_100g), c: n(m.carbohydrates_100g),
    serving: n(Number(product.serving_quantity)) || null, servingLabel: String(product.serving_size ?? '').trim(),
  };
  if (!food.name) food.name = food.brand || `商品 ${food.ref}`;
  return food;
}
const hasNutrition = f => ['kcal', 'p', 'f', 'c'].some(k => f[k] != null);

async function offFetch(url) {
  if (!navigator.onLine) throw new Error('オフラインのため検索できません。内蔵の食品データか手入力を使ってください。');
  let res;
  try { res = await fetch(url, { headers: { Accept: 'application/json' } }); }
  catch { throw new Error('市販品データベースに接続できませんでした。時間をおいて試してください。'); }
  if (res.status === 404) return null;
  if (res.status === 429) throw new Error('検索が混み合っています。1分ほど待ってから試してください。');
  if (!res.ok) throw new Error('市販品データベースからの応答に問題がありました。');
  return res.json();
}

// Open Food Facts の検索は1分あたりの回数制限があるため、入力のたびではなく検索ボタンで呼ぶ。
export async function searchOff(query) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const data = await offFetch(`${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=24&fields=${OFF_FIELDS}`);
  return (data?.products ?? []).map(fromOff).filter(hasNutrition);
}

export const barcodeOK = code => /^\d{8}$|^\d{12,14}$/.test(String(code));
export async function lookupBarcode(code) {
  if (!barcodeOK(code)) throw new Error('バーコードの数字（8桁または13桁）を確認してください。');
  const data = await offFetch(`${OFF}/api/v2/product/${code}.json?fields=${OFF_FIELDS}`);
  if (!data || data.status === 0 || !data.product) return null;
  const food = fromOff({ ...data.product, code });
  return hasNutrition(food) ? food : { ...food, empty: true };
}
