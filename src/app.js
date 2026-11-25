'use strict';
const KEY = 'clothing_pos_v2';
const DESK = !!window.posDB;
const COLORS = { 'أسود': '#111', 'أبيض': '#fff', 'أزرق': '#2a5db0', 'أحمر': '#c0392b', 'بيج': '#d9c7a3', 'رمادي': '#888', 'أخضر': '#2e7d52', 'كحلي': '#1b2a4a', 'بني': '#6b4a2f' };
const METH = { cash: 'نقدي', visa: 'فيزا', wallet: 'فودافون كاش', credit: 'آجل', note: 'رصيد مرتجع', mixed: 'مختلط' };
const PERMS = {
  admin: ['sell', 'products', 'stock', 'returns', 'customers', 'debts', 'reports', 'settings'],
  manager: ['sell', 'products', 'stock', 'returns', 'customers', 'debts', 'reports'],
  cashier: ['sell', 'customers', 'debts']
};
const ROLES = { admin: 'مدير', manager: 'مشرف', cashier: 'كاشير' };
const TABS = [['sell', 'البيع'], ['products', 'المنتجات'], ['stock', 'المخزون'], ['returns', 'المرتجع'], ['customers', 'العملاء'], ['debts', 'الديون'], ['reports', 'التقارير'], ['settings', 'الإعدادات']];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round((+n || 0) * 100) / 100;
const pad = n => String(n).padStart(2, '0');
const ymd = d => { d = new Date(d); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) };
const ym = d => ymd(d).slice(0, 7);
const today = () => ymd(new Date());
const fmtT = d => new Date(d).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
let S = null;
const money = n => r2(n).toLocaleString('ar-EG') + ' ' + (S ? S.settings.cur : '');
function uid() { return (S ? S.deviceNo : 0) + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }
function hashPin(p) { let h1 = 0xdeadbeef ^ 7, h2 = 0x41c6ce57 ^ 7; const s = 'pos|' + p; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677) } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) }

// ---------- state ----------
let U = null, tab = 'sell', cart = [], cartDisc = { type: 'pct', val: 0 }, cartCust = '', usePts = 0, exch = null, payRows = [{ m: 'cash', amt: '' }], tender = '', q = '', lastScan = '';
let syncState = { t: '', ok: null };

function defaultSettings() { return { shop: 'محل الأناقة للملابس', cur: 'ج.م', low: 3, vat: 0, phone: '', address: '', slogan: '', logo: '', footer: 'شكراً لزيارتكم - الاستبدال خلال 14 يوم بالفاتورة', ptsPer: 10, ptsVal: 0.5, syncDir: '', backupDir: '', silentPrint: false } }
function migrate(s) {
  s.settings = { ...defaultSettings(), ...(s.settings || {}) };
  s.deviceNo = s.deviceNo || 1;
  for (const k of ['products', 'sales', 'moves', 'ledger', 'customers', 'shifts', 'purchases', 'users']) if (!Array.isArray(s[k])) s[k] = [];
  if (!s.locs || !s.locs.length) s.locs = [{ id: 'main', name: 'الفرع الرئيسي', type: 'branch' }];
  if (!s.loc || !s.locs.some(l => l.id === s.loc)) s.loc = s.locs[0].id;
  s.nextBc = s.nextBc || 1000001; s.nextNo = s.nextNo || 1001; s.nextPid = s.nextPid || (s.products.length + 1); s.nextShift = s.nextShift || (s.shifts.length + 1);
  if (!s.shift) s.shift = { open: false };
  s.products.forEach(p => { p.upd = p.upd || 0; p.variants.forEach(v => { if (!v.st) { v.st = { [s.locs[0].id]: v.qty || 0 }; } delete v.qty }) });
  s.sales.forEach((x, i) => { x.no = String(x.no); x.id = x.id || ('s' + x.no); if (!x.payments) x.payments = [{ m: x.method || 'cash', amt: x.total }]; if (x.loc === undefined) x.loc = s.locs[0].id; });
  s.shifts.forEach((x, i) => { if (!x.id) x.id = s.deviceNo + '-h' + i });
  if (!s.users.length) s.users = [{ id: 'u1', name: 'المدير', role: 'admin', pin: hashPin('1234'), upd: 1, maxDisc: 100, canReturn: true, active: true, defPin: true }];
  return s;
}
function seed() {
  const P = []; let bc = 1000001; const L = 'main';
  const add = (name, cat, cost, price, sizes, cols, qty, min) => { const v = []; sizes.forEach(s => cols.forEach(c => v.push({ barcode: String(bc++), size: s, color: c, st: { [L]: qty(s, c) } }))); P.push({ id: 'p' + (P.length + 1), name, cat, cost, price, min, upd: 1, variants: v }) };
  let k = 0; const r = () => { k = (k * 7 + 5) % 11; return k };
  add('تيشيرت قطن بولو', 'تيشيرتات', 120, 250, ['S', 'M', 'L', 'XL'], ['أسود', 'أبيض', 'كحلي'], () => r() + 1);
  add('بنطلون جينز سليم', 'بناطيل', 280, 550, ['30', '32', '34', '36'], ['أزرق', 'أسود'], () => r());
  add('هودي شتوي', 'هوديز', 320, 650, ['M', 'L', 'XL'], ['رمادي', 'أسود', 'بيج'], () => r() % 6);
  add('قميص كلاسيك', 'قمصان', 200, 420, ['M', 'L', 'XL'], ['أبيض', 'أزرق'], () => r() % 7 + 1);
  add('جاكيت جلد صناعي', 'جاكيتات', 600, 1200, ['M', 'L'], ['أسود', 'بني'], () => r() % 4);
  add('شورت رياضي', 'شورتات', 90, 190, ['S', 'M', 'L'], ['أسود', 'رمادي'], () => r() + 2);
  const sales = [], now = Date.now(); let no = 1001;
  const mk = (daysAgo, picks, method, disc) => {
    const items = picks.map(([pi, vi, qty]) => { const p = P[pi], v = p.variants[vi]; return { barcode: v.barcode, name: p.name, size: v.size, color: v.color, qty, price: p.price, cost: p.cost } });
    const sub = items.reduce((a, i) => a + i.qty * i.price, 0); const d = disc ? Math.round(sub * disc / 100) : 0;
    sales.push({ id: 's' + no, no: String(no++), date: new Date(now - daysAgo * 864e5 - Math.random() * 3e7).toISOString(), type: 'sale', items, subtotal: sub, discount: d, total: sub - d, method, payments: [{ m: method, amt: sub - d }], cashier: 'أحمد', loc: L })
  };
  mk(6, [[0, 1, 2], [1, 0, 1]], 'cash', 0); mk(5, [[2, 2, 1]], 'visa', 10); mk(5, [[3, 1, 2], [5, 0, 1]], 'cash', 0); mk(4, [[0, 4, 1], [1, 3, 1]], 'wallet', 0); mk(3, [[4, 1, 1]], 'visa', 0); mk(3, [[0, 0, 3]], 'cash', 5); mk(2, [[1, 2, 2], [3, 3, 1]], 'cash', 0); mk(1, [[2, 0, 1], [5, 2, 2]], 'wallet', 0); mk(1, [[0, 2, 1]], 'cash', 0); mk(0, [[1, 1, 1], [0, 3, 2]], 'cash', 0);
  return migrate({ settings: defaultSettings(), products: P, sales, nextBc: bc, nextNo: no, shift: { open: false }, shifts: [], nextPid: P.length + 1, purchases: [] });
}
function load() {
  try {
    let s;
    if (DESK) {
      s = window.posDB.load();
      if (!s) { const demo = confirm('أول تشغيل: موافق = بيانات تجريبية للتجربة، إلغاء = محل فاضي (ابدأ بإضافة منتجاتك)'); const d = seed(); if (!demo) { d.products = []; d.sales = []; d.nextNo = 1001 } window.posDB.save(d); return d }
    } else s = JSON.parse(localStorage.getItem(KEY));
    if (s) return migrate(s);
  } catch (e) { console.error(e); alert('خطأ في قراءة البيانات: ' + e) }
  return seed();
}
let saveErr = false;
function save() {
  try {
    if (DESK) { const r = window.posDB.save(S); if (r !== true) { alert('تعذر الحفظ في قاعدة البيانات: ' + r) } }
    else localStorage.setItem(KEY, JSON.stringify(S));
  } catch (e) { if (!saveErr) { saveErr = true; alert('تعذر الحفظ: ' + e) } }
  syncSoon();
}
if (DESK) { window.print = () => window.posDB.print(!!(S && S.settings.silentPrint)) }

// ---------- auth ----------
const can = p => !!U && PERMS[U.role].includes(p);
const isAdmin = () => !!U && U.role === 'admin';
function maxDisc() { return U ? (U.role === 'admin' ? 100 : (U.maxDisc ?? (U.role === 'manager' ? 100 : 10))) : 0 }
function canReturn() { return U && (U.role !== 'cashier' || U.canReturn) }
function loginView() {
  U = null; $('#nav').innerHTML = ''; $('#who').innerHTML = ''; $('#shiftInfo').textContent = ''; $('#syncInfo').textContent = '';
  const us = S.users.filter(u => u.active !== false);
  $('#app').innerHTML = `<div class="card login"><h2>تسجيل الدخول</h2><div id="ulist">${us.map(u => `<button class="b gh u" onclick="pickUser('${u.id}')">${esc(u.name)} <small class="m">(${ROLES[u.role]})</small></button>`).join('')}</div><div id="pinbox" style="display:none"><div style="margin:8px 0" id="pn"></div><input type="password" id="pin" inputmode="numeric" class="ctrl" placeholder="الرقم السري" autocomplete="off"><div class="row" style="margin-top:8px"><button class="b ok grow" onclick="doLogin()">دخول</button><button class="b gh" onclick="loginView()">رجوع</button></div><div id="lerr" style="color:var(--acc);margin-top:6px"></div></div></div>`;
  if (us.length === 1) pickUser(us[0].id);
}
let loginId = '';
function pickUser(id) { loginId = id; $('#ulist').style.display = 'none'; $('#pinbox').style.display = 'block'; $('#pn').innerHTML = '<b>' + esc(S.users.find(u => u.id === id).name) + '</b>'; const p = $('#pin'); p.focus(); p.onkeydown = e => { if (e.key === 'Enter') doLogin() } }
function doLogin() {
  const u = S.users.find(x => x.id === loginId);
  if (!u || u.pin !== hashPin($('#pin').value)) { $('#lerr').textContent = 'الرقم السري غلط'; $('#pin').value = ''; return }
  U = u; tab = 'sell'; render();
  if (u.defPin) modal(`<h2>غيّر الرقم السري</h2><p>الرقم السري الحالي هو الافتراضي (1234). اختار رقم سري جديد.</p><input type="password" id="np" class="ctrl" placeholder="رقم سري جديد (4 أرقام على الأقل)"><div class="row" style="margin-top:10px"><button class="b ok" onclick="setOwnPin()">حفظ</button><button class="b gh" onclick="closeModal()">لاحقاً</button></div>`);
}
function setOwnPin() { const p = $('#np').value; if (p.length < 4) { alert('4 أرقام على الأقل'); return } U.pin = hashPin(p); U.defPin = false; U.upd = Date.now(); save(); closeModal() }
function logout() { cart = []; cartDisc = { type: 'pct', val: 0 }; cartCust = ''; usePts = 0; exch = null; payRows = [{ m: 'cash', amt: '' }]; loginView() }

// ---------- data helpers ----------
const P = () => S.products.filter(p => !p.del);
const locName = id => (S.locs.find(l => l.id === id) || { name: id }).name;
function findVar(bc) { for (const p of S.products) { if (p.del) continue; for (const v of p.variants) if (v.barcode === bc) return [p, v] } }
const qtyAt = (v, loc) => (v.st && v.st[loc || S.loc]) || 0;
const qtyAll = v => Object.values(v.st || {}).reduce((a, b) => a + b, 0);
const stockOf = (p, loc) => p.variants.reduce((a, v) => a + (loc === 'all' ? qtyAll(v) : qtyAt(v, loc)), 0);
const lowOf = p => (p.min !== undefined && p.min !== null && p.min !== '') ? +p.min : S.settings.low;
function adj(v, delta, ref, loc) { loc = loc || S.loc; v.st[loc] = (v.st[loc] || 0) + delta; S.moves.push({ id: uid(), ts: new Date().toISOString(), loc, bc: v.barcode, d: delta, ref: ref || '', u: U ? U.id : '' }) }
function lowList(loc) { const out = []; P().forEach(p => p.variants.forEach(v => { if (qtyAt(v, loc) <= lowOf(p)) out.push([p, v]) })); return out }
function newBarcode() { return String(S.deviceNo) + String(S.nextBc++).padStart(7, '0') }
const sg = s => s.type === 'return' ? -1 : 1;
function custBal(id) { return r2(S.ledger.filter(l => l.cid === id).reduce((a, l) => a + (l.debt || 0), 0)) }
function custPts(id) { return Math.round(S.ledger.filter(l => l.cid === id).reduce((a, l) => a + (l.pts || 0), 0)) }
const custOf = id => S.customers.find(c => c.id === id);
function shiftCash() {
  const sh = S.shift; if (!sh.open) return null;
  let c = sh.openCash || 0;
  S.sales.forEach(s => { if (s.date >= sh.start && s.loc === S.loc) (s.payments || []).forEach(p => { if (p.m === 'cash') c += sg(s) * p.amt }) });
  S.ledger.forEach(l => { if (l.kind === 'pay' && l.method === 'cash' && l.ts >= sh.start && l.loc === S.loc) c += -l.debt });
  (sh.moves || []).forEach(m => { c += m.type === 'in' ? m.amt : -m.amt });
  return r2(c);
}

// ---------- Code39 ----------
const C39 = { '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', '*': 'nwnnwnwnn', '-': 'nwnnnnwnw' };
function barcodeSVG(code) {
  let x = 0, out = ''; const s = '*' + code + '*';
  for (const ch of s) { const pat = C39[ch]; if (!pat) continue; for (let i = 0; i < 9; i++) { const w = pat[i] === 'w' ? 3 : 1; if (i % 2 === 0) out += `<rect x="${x}" y="0" width="${w}" height="40" fill="#000"/>`; x += w } x += 1 }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} 40" preserveAspectRatio="none">${out}</svg>`
}

// ---------- modal ----------
function modal(h) { $('#modal').innerHTML = `<div class="modal"><div>${h}</div></div>` }
function closeModal() { $('#modal').innerHTML = '' }

// ---------- sync (shared folder) ----------
let syncTimer = null, syncBusy = false;
function syncSoon() { if (!DESK || !S || !S.settings.syncDir) return; clearTimeout(syncTimer); syncTimer = setTimeout(runSync, 4000) }
function syncPayload() {
  return JSON.stringify({
    v: 2, dev: S.deviceNo, ts: Date.now(), locs: S.locs, users: S.users, customers: S.customers, sales: S.sales, moves: S.moves, ledger: S.ledger,
    products: S.products.map(p => ({ id: p.id, name: p.name, cat: p.cat, cost: p.cost, price: p.price, min: p.min, upd: p.upd || 0, del: !!p.del, variants: p.variants.map(v => ({ barcode: v.barcode, size: v.size, color: v.color })) }))
  });
}
function mergeOthers(others) {
  let ch = 0;
  const byId = (arr) => new Map(arr.map(x => [x.id, x]));
  for (const o of others) {
    if (!o || o.v !== 2 || o.dev === S.deviceNo) continue;
    for (const l of o.locs || []) if (!S.locs.some(x => x.id === l.id)) { S.locs.push(l); ch++ }
    const um = byId(S.users); for (const u of o.users || []) { const m = um.get(u.id); if (!m) { S.users.push(u); ch++ } else if ((u.upd || 0) > (m.upd || 0)) { Object.assign(m, u); ch++ } }
    const pm = byId(S.products);
    for (const p of o.products || []) {
      const m = pm.get(p.id);
      if (!m) { S.products.push({ ...p, variants: p.variants.map(v => ({ ...v, st: {} })) }); ch++; continue }
      if ((p.upd || 0) > (m.upd || 0)) { Object.assign(m, { name: p.name, cat: p.cat, cost: p.cost, price: p.price, min: p.min, upd: p.upd, del: p.del }); ch++ }
      for (const v of p.variants) if (!m.variants.some(x => x.barcode === v.barcode)) { m.variants.push({ ...v, st: {} }); ch++ }
    }
    const cm = byId(S.customers); for (const c of o.customers || []) { const m = cm.get(c.id); if (!m) { S.customers.push(c); ch++ } else if ((c.upd || 0) > (m.upd || 0)) { Object.assign(m, c); ch++ } }
    const sm = new Set(S.sales.map(x => x.id)); for (const s of o.sales || []) if (!sm.has(s.id)) { S.sales.push(s); sm.add(s.id); ch++ }
    const lm = new Set(S.ledger.map(x => x.id)); for (const l of o.ledger || []) if (!lm.has(l.id)) { S.ledger.push(l); lm.add(l.id); ch++ }
    const mm = new Set(S.moves.map(x => x.id));
    const vm = new Map(); S.products.forEach(p => p.variants.forEach(v => vm.set(v.barcode, v)));
    for (const m of o.moves || []) if (!mm.has(m.id)) { const v = vm.get(m.bc); if (!v) continue; v.st[m.loc] = (v.st[m.loc] || 0) + m.d; S.moves.push(m); mm.add(m.id); ch++ }
  }
  return ch;
}
async function runSync() {
  if (!DESK || !S || !S.settings.syncDir || syncBusy) return;
  syncBusy = true;
  try {
    const r = await window.posDB.sync({ dir: S.settings.syncDir, name: 'sync-dev' + S.deviceNo + '.json', data: syncPayload() });
    if (r.ok) {
      const ch = mergeOthers(r.others);
      syncState = { ok: true, t: new Date().toLocaleTimeString('ar-EG', { timeStyle: 'short' }) };
      if (ch) { save0(); if (U && !$('#modal').innerHTML) render(); else renderHeader() }
    } else syncState = { ok: false, t: '' };
  } catch (e) { syncState = { ok: false, t: '' } }
  syncBusy = false; renderHeader();
}
function save0() { try { if (DESK) window.posDB.save(S); else localStorage.setItem(KEY, JSON.stringify(S)) } catch (e) { } }
setInterval(() => { if (S && S.settings.syncDir) runSync() }, 60000);
window.addEventListener('online', () => runSync());
// ---------- shell ----------
function renderHeader() {
  if (!S) return;
  $('#shopTitle').innerHTML = (S.settings.logo ? `<img src="${S.settings.logo}" style="height:34px;vertical-align:middle;margin-left:8px;border-radius:4px;background:#fff">` : '') + esc(S.settings.shop);
  if (!U) return;
  const low = lowList().length;
  $('#nav').innerHTML = TABS.filter(([k]) => can(k)).map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" onclick="go('${k}')">${l}${k === 'stock' && low ? `<span class="badge">${low}</span>` : ''}</button>`).join('');
  $('#shiftInfo').innerHTML = (S.locs.length > 1 ? esc(locName(S.loc)) + ' | ' : '') + (S.shift.open ? `وردية: ${esc(S.shift.cashier)}` : 'لا توجد وردية مفتوحة');
  $('#syncInfo').innerHTML = S.settings.syncDir ? (syncState.ok === null ? '<span style="color:#cdd7e6">مزامنة...</span>' : syncState.ok ? `<span style="color:#9be3b5">✓ متزامن ${syncState.t}</span>` : '<span style="color:#ffd27a">⚠ المزامنة غير متاحة (شغال أوفلاين)</span>') : '';
  $('#who').innerHTML = `${esc(U.name)} <button onclick="logout()">خروج</button>`;
}
function go(t) { if (!can(t)) return; tab = t; render() }
function render() {
  if (!U) { loginView(); return }
  if (!can(tab)) tab = 'sell';
  renderHeader();
  ({ sell: vSell, products: vProducts, stock: vStock, returns: vReturns, customers: vCustomers, debts: vDebts, reports: vReports, settings: vSettings })[tab]();
}

// ---------- SELL ----------
function cartCalc() {
  let sub = 0, ld = 0;
  const lines = cart.map(i => { const g = i.qty * i.price; let d = i.dt === 'pct' ? g * (i.dv || 0) / 100 : (i.dv || 0); d = r2(Math.min(Math.max(d, 0), g)); sub += g; ld += d; return { g, d } });
  const base = sub - ld; let cd = cartDisc.type === 'pct' ? base * cartDisc.val / 100 : cartDisc.val; cd = r2(Math.min(Math.max(cd, 0), base));
  const c = cartCust ? custOf(cartCust) : null; const avail = c ? custPts(c.id) : 0;
  const pts = Math.min(Math.max(Math.floor(usePts) || 0, 0), avail); let pv = r2(Math.min(pts * S.settings.ptsVal, base - cd));
  const total = r2(base - cd - pv);
  const exAmt = exch ? exch.amt : 0;
  return { sub, ld, cd, pv, pts: pv > 0 ? pts : 0, total, lines, pct: sub ? (ld + cd) / sub * 100 : 0, due: r2(total - exAmt), exAmt }
}
function vSell() {
  const t = cartCalc();
  const list = P(); const matches = q ? list.filter(p => p.name.includes(q) || p.cat.includes(q) || p.variants.some(v => v.barcode.includes(q))) : list;
  const c = cartCust ? custOf(cartCust) : null;
  const low = lowList();
  $('#app').innerHTML = `${S.shift.open ? '' : `<div class="warn">مفيش وردية مفتوحة. افتح وردية علشان تقدر تبيع. <button class="b sm ok" onclick="openShiftModal()">فتح وردية</button></div>`}
  ${low.length ? `<div class="warn bad">تنبيه: ${low.length} صنف قرب يخلص أو خلص. <a href="#" onclick="go('stock');return false">شوف المخزون</a></div>` : ''}
  <div class="pos"><div>
  <div class="card"><div class="row"><input id="scan" class="grow" placeholder="امسح الباركود أو اكتب الاسم ثم Enter" value="${esc(q)}" autofocus>
  <button class="b" onclick="doScan()">إضافة</button></div><div id="scanMsg" style="min-height:20px;margin-top:6px;color:var(--acc);font-size:13px">${esc(lastScan)}</div></div>
  <div class="card"><h2>الأصناف</h2><div class="grid">${matches.map(p => `<button class="tile" onclick="pickProduct('${p.id}')"><b>${esc(p.name)}</b><span>${money(p.price)}</span><br><span>${stockOf(p, S.loc)} قطعة</span></button>`).join('') || '<div class="empty">لا نتائج</div>'}</div></div>
  </div><div>
  <div class="card"><h2>الفاتورة</h2>
  ${cart.length ? `<table><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>خصم الصنف</th><th></th></tr>${cart.map((i, ix) => `<tr><td>${esc(i.name)}<br><small class="m">${esc(i.size)} - ${esc(i.color)}</small></td>
  <td style="white-space:nowrap"><button class="b gh sm" onclick="qty(${ix},-1)">-</button> <b>${i.qty}</b> <button class="b gh sm" onclick="qty(${ix},1)">+</button></td><td>${money(t.lines[ix].g - t.lines[ix].d)}${t.lines[ix].d ? `<br><small class="m"><s>${money(t.lines[ix].g)}</s></small>` : ''}</td>
  <td style="white-space:nowrap"><input type="number" min="0" value="${i.dv || 0}" style="width:62px;padding:4px" onchange="cart[${ix}].dv=+this.value;render()"> <select style="padding:4px" onchange="cart[${ix}].dt=this.value;render()"><option value="pct" ${i.dt === 'pct' ? 'selected' : ''}>%</option><option value="amt" ${i.dt === 'amt' ? 'selected' : ''}>مبلغ</option></select></td>
  <td><button class="b gh sm" onclick="cart.splice(${ix},1);render()">x</button></td></tr>`).join('')}</table>` : '<div class="empty">الفاتورة فاضية، امسح باركود قطعة</div>'}
  <div class="row" style="margin-top:10px"><label>خصم على الفاتورة</label><input type="number" id="dv" min="0" value="${cartDisc.val}" style="width:90px" onchange="cartDisc.val=+this.value;render()">
  <select onchange="cartDisc.type=this.value;render()"><option value="pct" ${cartDisc.type === 'pct' ? 'selected' : ''}>%</option><option value="amt" ${cartDisc.type === 'amt' ? 'selected' : ''}>مبلغ</option></select>
  <button class="b gh sm" onclick="cartDisc={type:'pct',val:50};render()">نص السعر</button><button class="b gh sm" onclick="buy2()">2 بسعر 1</button></div>
  <div class="row" style="margin-top:10px"><label>العميل</label><input id="custIn" list="custList" class="grow" placeholder="اسم أو تليفون العميل" value="${c ? esc(c.name + ' - ' + c.phone) : ''}" onchange="pickCust(this.value)"><datalist id="custList">${S.customers.map(x => `<option value="${esc(x.name + ' - ' + x.phone)}">`).join('')}</datalist><button class="b gh sm" onclick="editCustomer(null,true)">+ جديد</button></div>
  ${c ? `<div style="margin-top:6px;font-size:13px">نقاطه: <b>${custPts(c.id)}</b> (قيمة ${money(custPts(c.id) * S.settings.ptsVal)}) | مديونيته: <b>${money(custBal(c.id))}</b></div>${custPts(c.id) > 0 ? `<div class="row" style="margin-top:6px"><label>استخدام نقاط</label><input type="number" min="0" max="${custPts(c.id)}" value="${usePts || ''}" style="width:90px" onchange="usePts=+this.value;render()"> <small class="m">${t.pts ? 'خصم ' + money(t.pv) : ''}</small></div>` : ''}` : ''}
  <div style="margin-top:10px">المجموع: ${money(t.sub)}${t.ld ? `<br>خصم الأصناف: ${money(t.ld)}` : ''}${t.cd ? `<br>خصم الفاتورة: ${money(t.cd)}` : ''}${t.pv ? `<br>خصم النقاط: ${money(t.pv)}` : ''}${exch ? `<br>رصيد المرتجع: ${money(t.exAmt)} <a href="#" onclick="exch=null;render();return false">إلغاء</a>` : ''}</div>
  <div class="total">${money(t.due > 0 ? t.due : 0)}</div>
  ${t.due <= 0 && exch ? '<div class="warn bad">قيمة المرتجع أكبر من أو تساوي الفاتورة. أضف قطع أو نفذ مرتجع عادي.</div>' : ''}
  <div id="payBox" style="margin-top:8px">${payHTML(t)}</div>
  <div class="row" style="margin-top:10px"><button class="b ok grow" onclick="checkout()" ${cart.length && S.shift.open ? '' : 'disabled'}>إتمام البيع</button><button class="b gh" onclick="resetCart();render()">إلغاء</button></div></div>
  </div></div>`;
  const sc = $('#scan'); if (sc) { sc.focus(); sc.setSelectionRange(sc.value.length, sc.value.length); sc.oninput = () => { q = sc.value; clearTimeout(window._t); window._t = setTimeout(() => { if (!/^\d+$/.test(q) || q.length < 7) vSell() }, 250) }; sc.onkeydown = e => { if (e.key === 'Enter') doScan() } }
}
function payHTML(t) {
  const single = payRows.length === 1;
  const opts = cur => ['cash', 'visa', 'wallet', 'credit'].map(m => `<option value="${m}" ${cur === m ? 'selected' : ''}>${METH[m]}</option>`).join('');
  return payRows.map((r, i) => `<div class="row" style="margin-bottom:6px"><select onchange="payRows[${i}].m=this.value;render()">${opts(r.m)}</select><input type="number" min="0" placeholder="${single ? 'كل المبلغ' : 'المبلغ'}" value="${r.amt}" style="width:110px" onchange="payRows[${i}].amt=this.value;render()">${payRows.length > 1 ? `<button class="b gh sm" onclick="payRows.splice(${i},1);render()">x</button>` : ''}</div>`).join('')
    + `<div class="row"><button class="b gh sm" onclick="payRows.push({m:'visa',amt:''});render()">+ دفع مختلط (طريقة تانية)</button>${single && payRows[0].m === 'cash' ? `<label>المستلم</label><input type="number" min="0" value="${tender}" style="width:100px" onchange="tender=this.value;render()"> ${tender && +tender >= t.due ? `<b>الباقي ${money(+tender - t.due)}</b>` : ''}` : ''}</div>`;
}
function resetCart() { cart = []; cartDisc = { type: 'pct', val: 0 }; cartCust = ''; usePts = 0; exch = null; payRows = [{ m: 'cash', amt: '' }]; tender = '' }
function pickCust(v) { const c = S.customers.find(x => (x.name + ' - ' + x.phone) === v) || S.customers.find(x => x.phone === v.trim() || x.name === v.trim()); cartCust = c ? c.id : ''; usePts = 0; render() }
function doScan() {
  const v = q.trim(); if (!v) return; const f = findVar(v);
  if (f) { addToCart(f[0], f[1]); q = ''; render(); return }
  const m = P().filter(p => p.name.includes(v)); if (m.length === 1) { pickProduct(m[0].id); return }
  lastScan = 'الباركود غير موجود: ' + v; q = ''; render()
}
function addToCart(p, v) {
  lastScan = '';
  if (qtyAt(v) <= 0) { lastScan = 'نفذت الكمية: ' + p.name + ' ' + v.size + ' ' + v.color; return }
  const ex = cart.find(i => i.barcode === v.barcode); const cur = ex ? ex.qty : 0; if (cur + 1 > qtyAt(v)) { lastScan = 'الكمية المتاحة ' + qtyAt(v) + ' فقط'; return }
  if (ex) ex.qty++; else cart.push({ barcode: v.barcode, name: p.name, size: v.size, color: v.color, qty: 1, price: p.price, cost: p.cost, dt: 'pct', dv: 0 })
}
function qty(ix, d) { const i = cart[ix], f = findVar(i.barcode)[1]; i.qty += d; if (i.qty > qtyAt(f)) i.qty = qtyAt(f); if (i.qty <= 0) cart.splice(ix, 1); render() }
function buy2() { const units = []; cart.forEach(i => { for (let k = 0; k < i.qty; k++) units.push(i.price) }); units.sort((a, b) => a - b); const free = units.slice(0, Math.floor(units.length / 2)).reduce((a, b) => a + b, 0); cartDisc = { type: 'amt', val: free }; render() }
function pickProduct(id) {
  const p = S.products.find(x => x.id === id);
  modal(`<h2>${esc(p.name)} - ${money(p.price)}</h2><table><tr><th>المقاس</th><th>اللون</th><th>المتاح</th><th></th></tr>${p.variants.map(v => `<tr><td>${esc(v.size)}</td><td><span class="dot" style="background:${COLORS[v.color] || '#ccc'}"></span>${esc(v.color)}</td><td><span class="pill ${qtyAt(v) <= lowOf(p) ? 'low' : 'ok'}">${qtyAt(v)}</span></td><td><button class="b sm" ${qtyAt(v) ? '' : 'disabled'} onclick="addToCart(S.products.find(x=>x.id=='${p.id}'),findVar('${v.barcode}')[1]);closeModal();render()">إضافة</button></td></tr>`).join('')}</table><div style="margin-top:10px"><button class="b gh" onclick="closeModal()">إغلاق</button></div>`)
}
function getPayments(due) {
  const rows = payRows.map(r => ({ m: r.m, a: r.amt === '' ? null : r2(r.amt) }));
  if (rows.length === 1) return [{ m: rows[0].m, amt: due }];
  const blanks = rows.filter(r => r.a === null); const known = rows.reduce((a, r) => a + (r.a || 0), 0);
  if (blanks.length > 1) return null; if (blanks.length === 1) blanks[0].a = r2(due - known);
  if (rows.some(r => r.a < 0)) return null;
  const sum = r2(rows.reduce((a, r) => a + r.a, 0)); if (Math.abs(sum - due) > 0.009) return null;
  return rows.filter(r => r.a > 0).map(r => ({ m: r.m, amt: r.a }));
}
function checkout() {
  if (!S.shift.open) { alert('افتح وردية الأول'); return }
  const t = cartCalc();
  if (!cart.length) return;
  for (const i of cart) { const f = findVar(i.barcode); if (!f || qtyAt(f[1]) < i.qty) { alert('الكمية غير متاحة: ' + i.name); return } }
  if (!isAdmin() && t.pct > maxDisc() + 0.001) { alert('الخصم (' + r2(t.pct) + '%) أكبر من المسموح لك (' + maxDisc() + '%). اطلب من المدير.'); return }
  if (exch && t.due <= 0) { alert('قيمة المرتجع أكبر من الفاتورة'); return }
  const due = t.due;
  const pays = getPayments(due);
  if (!pays) { alert('مجموع الدفع لازم يساوي ' + money(due)); return }
  const creditAmt = r2(pays.filter(p => p.m === 'credit').reduce((a, p) => a + p.amt, 0));
  if (creditAmt > 0 && !cartCust) { alert('اختار العميل (أو أضف عميل جديد) للبيع الآجل'); return }
  const allPays = exch ? [{ m: 'note', amt: t.exAmt }, ...pays] : pays;
  const no = (S.deviceNo === 1 ? '' : S.deviceNo + '-') + (S.nextNo++);
  const c = cartCust ? custOf(cartCust) : null;
  const items = cart.map((i, ix) => ({ barcode: i.barcode, name: i.name, size: i.size, color: i.color, qty: i.qty, price: i.price, cost: i.cost, disc: t.lines[ix].d }));
  const sale = { id: 's' + no, no, date: new Date().toISOString(), type: 'sale', items, subtotal: t.sub, discount: r2(t.ld + t.cd + t.pv), discLine: t.ld, discCart: t.cd, ptsUsed: t.pts, ptsValue: t.pv, total: t.total, payments: allPays, method: allPays.length === 1 ? allPays[0].m : 'mixed', customerId: c ? c.id : '', customer: c ? c.name : '', custPhone: c ? c.phone : '', cashier: U.name, cashierId: U.id, loc: S.loc };
  if (exch) sale.exchangeRef = exch.ref;
  const tend = +tender; if (allPays.length === 1 && allPays[0].m === 'cash' && tend >= due) sale.change = r2(tend - due);
  cart.forEach(i => { adj(findVar(i.barcode)[1], -i.qty, sale.id) });
  if (c) { const earned = Math.floor(t.total / S.settings.ptsPer); sale.ptsEarned = earned; S.ledger.push({ id: uid(), cid: c.id, ts: sale.date, kind: 'sale', ref: sale.no, pts: earned - t.pts, debt: creditAmt, loc: S.loc, u: U.id }) }
  S.sales.push(sale); save(); resetCart(); render(); showReceipt(sale);
}

// ---------- receipt / whatsapp ----------
function showReceipt(s) {
  const k = s.type === 'return' ? -1 : 1; const c = s.customerId ? custOf(s.customerId) : null;
  modal(`<div id="rcp" class="receipt"><div style="text-align:center">${S.settings.logo ? `<img src="${S.settings.logo}" style="max-width:140px;max-height:70px;display:block;margin:0 auto 4px">` : ''}<b style="font-size:15px">${esc(S.settings.shop)}</b><br>${S.settings.slogan ? esc(S.settings.slogan) + '<br>' : ''}${S.settings.address ? esc(S.settings.address) + '<br>' : ''}${S.settings.phone ? 'ت: ' + esc(S.settings.phone) + '<br>' : ''}${s.type === 'return' ? 'إيصال مرتجع' : 'فاتورة'} رقم ${esc(s.no)}<br>${fmtT(s.date)}${s.cashier ? '<br>الكاشير: ' + esc(s.cashier) : ''}${s.customer ? '<br>العميل: ' + esc(s.customer) : ''}</div><hr>
  ${s.items.map(i => `<div>${esc(i.name)} (${esc(i.size)}/${esc(i.color)})</div><div class="r"><span>${i.qty} x ${i.price}${i.disc ? ' (خصم ' + r2(i.disc) + ')' : ''}</span><span>${r2(i.qty * i.price * k - (i.disc || 0) * k)}</span></div>`).join('')}<hr>
  <div class="r"><span>المجموع</span><span>${r2(s.subtotal * k)}</span></div>${s.discount ? `<div class="r"><span>الخصم</span><span>${r2(s.discount)}</span></div>` : ''}
  <div class="r"><b>الإجمالي</b><b>${money(s.total * k)}</b></div>${(s.payments || []).map(p => `<div class="r"><span>${METH[p.m] || p.m}</span><span>${r2(p.amt)}</span></div>`).join('')}${s.change ? `<div class="r"><span>الباقي للعميل</span><span>${s.change}</span></div>` : ''}${c && s.type === 'sale' ? `<div class="r"><span>نقاط مكتسبة</span><span>${s.ptsEarned || 0}</span></div><div class="r"><span>رصيد النقاط</span><span>${custPts(c.id)}</span></div>` : ''}<hr><div style="text-align:center">${esc(S.settings.footer)}<br>${barcodeSVG(String(s.no))}</div></div>
  <div class="row noprint" style="margin-top:12px;justify-content:center"><button class="b" onclick="window.print()">طباعة</button><button class="b ok" onclick="waModal('${esc(s.id)}')">إرسال على واتساب</button><button class="b gh" onclick="closeModal()">إغلاق</button></div>`)
}
function waText(s) {
  const k = s.type === 'return' ? -1 : 1; const L = [];
  L.push(S.settings.shop); L.push((s.type === 'return' ? 'إيصال مرتجع' : 'فاتورة') + ' رقم ' + s.no + ' - ' + fmtT(s.date)); L.push('');
  s.items.forEach(i => L.push(`${i.name} (${i.size}/${i.color}) ${i.qty} x ${i.price} = ${r2(i.qty * i.price - (i.disc || 0))}`));
  L.push(''); if (s.discount) L.push('الخصم: ' + r2(s.discount));
  L.push('الإجمالي: ' + money(s.total * k)); L.push('الدفع: ' + (s.payments || []).map(p => (METH[p.m] || p.m) + ' ' + r2(p.amt)).join(' + '));
  if (s.customerId && s.type === 'sale') L.push('رصيد نقاطك: ' + custPts(s.customerId));
  L.push(''); L.push(S.settings.footer); if (S.settings.phone) L.push('ت: ' + S.settings.phone);
  return L.join('\n');
}
function waNumber(raw) { let d = String(raw || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); else if (d.startsWith('0')) d = '20' + d.slice(1); return d }
function waModal(id) {
  const s = S.sales.find(x => x.id === id); const c = s.customerId ? custOf(s.customerId) : null;
  modal(`<h2>إرسال الفاتورة على واتساب</h2><div class="row"><input id="waNum" class="grow" placeholder="رقم العميل مثال 01012345678" value="${esc(c ? c.phone : (s.custPhone || ''))}"></div><p><small class="m">هيفتح واتساب برسالة جاهزة فيها تفاصيل الفاتورة وانت تدوس إرسال. الرقم المصري بيتحول لصيغة دولية تلقائي.</small></p><pre style="white-space:pre-wrap;background:#f4f1ec;padding:8px;border-radius:8px;font-family:inherit;max-height:200px;overflow:auto">${esc(waText(s))}</pre><div class="row"><button class="b ok" onclick="waSend('${esc(s.id)}')">فتح واتساب</button><button class="b gh" onclick="showReceipt(S.sales.find(x=>x.id=='${esc(s.id)}'))">رجوع</button></div>`)
}
function waSend(id) {
  const s = S.sales.find(x => x.id === id); const n = waNumber($('#waNum').value);
  if (n.length < 10) { alert('اكتب رقم صحيح'); return }
  const url = 'https://wa.me/' + n + '?text=' + encodeURIComponent(waText(s));
  if (DESK) window.posDB.openWA(url).then(ok => { if (!ok) alert('تعذر فتح واتساب') }); else window.open(url, '_blank');
}

// ---------- shifts ----------
function openShiftModal() { modal(`<h2>فتح وردية</h2><p>الكاشير: <b>${esc(U.name)}</b></p><div class="row"><label>عهدة الدرج</label><input id="oc" type="number" min="0" value="0" style="width:120px"></div><div class="row" style="margin-top:10px"><button class="b ok" onclick="openShift()">فتح</button><button class="b gh" onclick="closeModal()">إلغاء</button></div>`) }
function openShift() { S.shift = { open: true, start: new Date().toISOString(), cashier: U.name, cashierId: U.id, openCash: +$('#oc').value || 0, moves: [] }; save(); closeModal(); render() }
function drawerMove(type) { modal(`<h2>${type === 'in' ? 'إيداع في الدرج' : 'مصروف من الدرج'}</h2><div class="row"><input id="dm" type="number" min="0" placeholder="المبلغ" style="width:120px"><input id="dn" class="grow" placeholder="السبب"></div><div class="row" style="margin-top:10px"><button class="b ok" onclick="addDrawer('${type}')">حفظ</button><button class="b gh" onclick="closeModal()">إلغاء</button></div>`) }
function addDrawer(type) { const a = r2($('#dm').value); if (a <= 0) return; S.shift.moves = S.shift.moves || []; S.shift.moves.push({ type, amt: a, note: $('#dn').value, ts: new Date().toISOString(), by: U.name }); save(); closeModal(); render() }
function closeShiftModal() {
  const exp = shiftCash();
  modal(`<h2>تقفيل الوردية وجرد الدرج</h2><p>النقدية المتوقعة في الدرج: <b>${money(exp)}</b></p><div class="row"><label>النقدية الفعلية (عد الدرج)</label><input id="cnt" type="number" min="0" style="width:140px" oninput="$('#cdiff').textContent=($('#cnt').value===''?'':'الفرق: '+r2(+$('#cnt').value-${exp}))"></div><div id="cdiff" style="margin:8px 0;font-weight:700"></div><div class="row"><button class="b acc" onclick="closeShift()">تقفيل</button><button class="b gh" onclick="closeModal()">إلغاء</button></div>`)
}
function closeShift() {
  const cnt = $('#cnt').value; if (cnt === '') { alert('اكتب النقدية الفعلية'); return }
  const sh = S.shift, exp = shiftCash(); const ss = S.sales.filter(s => s.date >= sh.start && s.loc === S.loc);
  const rec = { ...sh, id: S.deviceNo + '-h' + (S.nextShift++), end: new Date().toISOString(), total: r2(ss.reduce((a, s) => a + sg(s) * s.total, 0)), count: ss.length, expected: exp, counted: r2(cnt), diff: r2(cnt - exp), loc: S.loc, closedBy: U.name };
  S.shifts.push(rec); S.shift = { open: false }; save(); closeModal(); render();
  modal(`<h2>تم تقفيل الوردية</h2><table><tr><td>الكاشير</td><td>${esc(rec.cashier)}</td></tr><tr><td>إجمالي المبيعات</td><td>${money(rec.total)}</td></tr><tr><td>المتوقع بالدرج</td><td>${money(rec.expected)}</td></tr><tr><td>الفعلي</td><td>${money(rec.counted)}</td></tr><tr><td><b>الفرق</b></td><td><b style="color:${rec.diff < 0 ? 'var(--acc)' : 'var(--ok)'}">${money(rec.diff)}</b></td></tr></table><div class="row" style="margin-top:10px"><button class="b" onclick="window.print()">طباعة</button><button class="b gh" onclick="closeModal()">إغلاق</button></div>`);
}

// ---------- PRODUCTS ----------
function vProducts() {
  const f = window._pf || '';
  const list = P().filter(p => !f || p.name.includes(f) || p.cat.includes(f) || p.variants.some(v => v.barcode.includes(f)));
  $('#app').innerHTML = `<div class="card"><div class="row"><h2 class="grow">المنتجات (${list.length})</h2><input id="pf" placeholder="بحث" value="${esc(f)}" style="width:180px"><button class="b" onclick="editProduct()">+ منتج جديد</button><button class="b gh" onclick="printLabels()">طباعة ملصقات الكل</button></div>
  <table><tr><th>المنتج</th><th>القسم</th><th>التكلفة</th><th>السعر</th><th>المتغيرات</th><th>المخزون هنا</th><th></th></tr>
  ${list.map(p => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.cat)}</td><td>${money(p.cost)}</td><td>${money(p.price)}</td><td>${p.variants.length}</td><td>${stockOf(p, S.loc)}</td><td style="white-space:nowrap"><button class="b gh sm" onclick="editProduct('${p.id}')">تعديل</button> <button class="b gh sm" onclick="printLabels('${p.id}')">باركود</button></td></tr>`).join('')}</table></div>`;
  $('#pf').onchange = e => { window._pf = e.target.value; vProducts() };
}
function editProduct(id) {
  const p = id ? S.products.find(x => x.id === id) : { name: '', cat: '', cost: 0, price: 0, min: '', variants: [] };
  window._ep = JSON.parse(JSON.stringify(p)); window._ep.id = id || null; window._ep.variants.forEach(v => { v.q = qtyAt(v) }); drawEP()
}
function drawEP() {
  const p = window._ep;
  modal(`<h2>${p.id ? 'تعديل منتج' : 'منتج جديد'}</h2><div class="row"><input id="en" class="grow" placeholder="اسم المنتج" value="${esc(p.name)}"><input id="ec" placeholder="القسم" value="${esc(p.cat)}" style="width:130px"></div>
  <div class="row" style="margin-top:8px"><label>التكلفة</label><input id="eco" type="number" value="${p.cost}" style="width:100px"><label>سعر البيع</label><input id="epr" type="number" value="${p.price}" style="width:100px"><label>حد التنبيه</label><input id="emn" type="number" min="0" placeholder="عام" value="${p.min ?? ''}" style="width:70px"></div>
  <h2 style="margin-top:14px">المقاسات والألوان <small class="m">(الكمية في ${esc(locName(S.loc))})</small></h2>
  <table>${p.variants.map((v, i) => `<tr><td>${esc(v.size)}</td><td>${esc(v.color)}</td><td>${v.barcode}</td><td><input type="number" min="0" value="${v.q}" style="width:70px" onchange="_ep.variants[${i}].q=+this.value"></td><td><button class="b gh sm" onclick="syncEP();_ep.variants.splice(${i},1);drawEP()">x</button></td></tr>`).join('')}</table>
  <div class="row" style="margin-top:8px"><input id="vs" placeholder="المقاسات: S,M,L" style="width:130px"><input id="vc" placeholder="الألوان: أسود,أبيض" class="grow"><input id="vq" type="number" placeholder="كمية" style="width:70px"><button class="b" onclick="genVariants()">توليد</button></div>
  <div class="row" style="margin-top:14px"><button class="b ok" onclick="saveEP()">حفظ</button><button class="b gh" onclick="closeModal()">إلغاء</button>${p.id ? `<button class="b acc" onclick="delProd('${p.id}')">حذف</button>` : ''}</div>`)
}
function syncEP() { const p = window._ep; p.name = $('#en').value; p.cat = $('#ec').value; p.cost = +$('#eco').value; p.price = +$('#epr').value; p.min = $('#emn').value === '' ? '' : +$('#emn').value }
function genVariants() {
  syncEP(); const sz = $('#vs').value.split(/[,،]/).map(x => x.trim()).filter(Boolean), cl = $('#vc').value.split(/[,،]/).map(x => x.trim()).filter(Boolean), qn = +$('#vq').value || 0;
  (sz.length ? sz : ['فري']).forEach(s => (cl.length ? cl : ['-']).forEach(c => { if (!_ep.variants.some(v => v.size === s && v.color === c)) _ep.variants.push({ barcode: newBarcode(), size: s, color: c, q: qn, fresh: true }) })); drawEP()
}
function saveEP() {
  syncEP(); const e = _ep; if (!e.name) { alert('اكتب الاسم'); return } if (!e.variants.length) { alert('أضف مقاس ولون واحد على الأقل'); return }
  let p = e.id ? S.products.find(x => x.id === e.id) : null; const isNew = !p;
  if (isNew) { p = { id: 'p' + S.deviceNo + '-' + (S.nextPid++), variants: [] }; S.products.push(p) }
  Object.assign(p, { name: e.name, cat: e.cat, cost: e.cost, price: e.price, min: e.min, upd: Date.now(), del: false });
  const keep = [];
  for (const ev of e.variants) {
    let v = p.variants.find(x => x.barcode === ev.barcode);
    if (!v) { v = { barcode: ev.barcode, size: ev.size, color: ev.color, st: {} }; p.variants.push(v) }
    const d = (ev.q || 0) - qtyAt(v); if (d) adj(v, d, 'edit'); keep.push(v.barcode)
  }
  p.variants = p.variants.filter(v => keep.includes(v.barcode));
  save(); closeModal(); render()
}
function delProd(id) { if (confirm('حذف المنتج؟')) { const p = S.products.find(x => x.id === id); p.del = true; p.upd = Date.now(); save(); closeModal(); render() } }
function printLabels(id) {
  const ps = id ? P().filter(p => p.id === id) : P();
  modal(`<div class="noprint row"><label>عدد النسخ</label><select id="lc" onchange="drawLabels('${id || ''}')"><option value="1">نسخة لكل قطعة</option><option value="stock">بعدد الكمية الموجودة</option></select><button class="b" onclick="window.print()">طباعة</button><button class="b gh" onclick="closeModal()">إغلاق</button></div><div id="rcp"></div>`); drawLabels(id || '')
}
function drawLabels(id) {
  const ps = id ? P().filter(p => p.id === id) : P(); const mode = $('#lc').value;
  $('#rcp').innerHTML = ps.flatMap(p => p.variants.flatMap(v => { const n = mode === 'stock' ? qtyAt(v) : 1; return Array.from({ length: n }, () => `<div class="lbl"><b>${esc(p.name)}</b><br>${esc(v.size)} / ${esc(v.color)} - ${p.price}<br>${barcodeSVG(v.barcode)}${v.barcode}</div>`) })).join('') || '<div class="empty">لا يوجد</div>'
}

// ---------- STOCK ----------
function vStock() {
  const low = lowList(); const v0 = window._sloc || S.loc; const showLoc = S.locs.some(l => l.id === v0) ? v0 : 'all';
  $('#app').innerHTML = `<div class="kpis"><div class="kpi"><small>إجمالي القطع</small><div>${P().reduce((a, p) => a + stockOf(p, 'all'), 0)}</div></div><div class="kpi"><small>قيمة المخزون (تكلفة)</small><div>${money(P().reduce((a, p) => a + stockOf(p, 'all') * p.cost, 0))}</div></div><div class="kpi"><small>أصناف قاربت تخلص (${esc(locName(S.loc))})</small><div style="color:var(--acc)">${low.length}</div></div></div>
  ${can('stock') ? `<div class="card"><h2>استلام بضاعة / جرد / تحويل (في ${esc(locName(S.loc))})</h2><div class="row"><input id="rb" placeholder="باركود القطعة" class="grow"><input id="rq" type="number" placeholder="الكمية" style="width:90px"><input id="rs" placeholder="المورد (اختياري)" style="width:140px"><button class="b ok" onclick="receive()">استلام (+)</button><button class="b gh" onclick="setCount()">ضبط الجرد (=)</button></div>
  ${S.locs.length > 1 ? `<div class="row" style="margin-top:8px"><label>تحويل لـ</label><select id="tl">${S.locs.filter(l => l.id !== S.loc).map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select><button class="b" onclick="transfer()">تحويل (من الباركود والكمية فوق)</button></div>` : ''}<div id="stMsg" style="margin-top:6px;color:var(--ok)"></div></div>` : ''}
  <div class="card"><h2>تنبيه نقص المخزون (${esc(locName(S.loc))})</h2>${low.length ? `<table><tr><th>المنتج</th><th>المقاس</th><th>اللون</th><th>المتبقي</th><th>حد التنبيه</th></tr>${low.map(([p, v]) => `<tr><td>${esc(p.name)}</td><td>${esc(v.size)}</td><td>${esc(v.color)}</td><td><span class="pill low">${qtyAt(v)}</span></td><td>${lowOf(p)}</td></tr>`).join('')}</table>` : '<div class="empty">كله تمام</div>'}</div>
  <div class="card"><h2>كل المخزون</h2><div style="overflow:auto"><table><tr><th>المنتج</th><th>المقاس</th><th>اللون</th><th>الباركود</th>${S.locs.map(l => `<th>${esc(l.name)}</th>`).join('')}${S.locs.length > 1 ? '<th>الإجمالي</th>' : ''}</tr>${P().flatMap(p => p.variants.map(v => `<tr><td>${esc(p.name)}</td><td>${esc(v.size)}</td><td>${esc(v.color)}</td><td>${v.barcode}</td>${S.locs.map(l => `<td><span class="pill ${qtyAt(v, l.id) <= lowOf(p) ? 'low' : 'ok'}">${qtyAt(v, l.id)}</span></td>`).join('')}${S.locs.length > 1 ? `<td><b>${qtyAll(v)}</b></td>` : ''}</tr>`)).join('')}</table></div></div>`
}
function receive() { const f = findVar($('#rb').value.trim()), n = +$('#rq').value; if (!f || !n) { $('#stMsg').textContent = 'باركود غير صحيح أو كمية ناقصة'; return } adj(f[1], n, 'recv'); S.purchases.push({ date: new Date().toISOString(), barcode: f[1].barcode, qty: n, supplier: $('#rs').value, loc: S.loc }); save(); vStock(); $('#stMsg').textContent = `تم استلام ${n} من ${f[0].name} ${f[1].size} ${f[1].color}` }
function setCount() { const f = findVar($('#rb').value.trim()), n = $('#rq').value; if (!f || n === '') { $('#stMsg').textContent = 'باركود غير صحيح أو كمية ناقصة'; return } const d = +n - qtyAt(f[1]); if (d) adj(f[1], d, 'count'); save(); vStock(); $('#stMsg').textContent = 'تم ضبط الكمية' }
function transfer() {
  const f = findVar($('#rb').value.trim()), n = +$('#rq').value, to = $('#tl').value; if (!f || !(n > 0)) { $('#stMsg').textContent = 'باركود غير صحيح أو كمية ناقصة'; return }
  if (qtyAt(f[1]) < n) { $('#stMsg').textContent = 'الكمية المتاحة هنا ' + qtyAt(f[1]) + ' فقط'; return }
  const ref = 'tr-' + uid(); adj(f[1], -n, ref, S.loc); adj(f[1], n, ref, to); save(); vStock(); $('#stMsg').textContent = `تم تحويل ${n} من ${f[0].name} إلى ${locName(to)}`
}

// ---------- RETURNS ----------
function vReturns() {
  if (!canReturn()) { $('#app').innerHTML = '<div class="card"><div class="empty">المرتجع مش مسموح لحسابك. اطلب من المدير.</div></div>'; return }
  $('#app').innerHTML = `<div class="card"><h2>مرتجع / استبدال</h2><div class="row"><input id="rno" placeholder="رقم الفاتورة" style="width:200px"><button class="b" onclick="findSale()">بحث</button></div><div id="rres"></div></div>
  <div class="card"><h2>آخر الفواتير</h2><table><tr><th>رقم</th><th>التاريخ</th><th>النوع</th><th>الإجمالي</th><th>الدفع</th><th>الكاشير</th><th></th></tr>${S.sales.slice().reverse().slice(0, 15).map(s => `<tr><td>${esc(s.no)}</td><td>${fmtT(s.date)}</td><td>${s.type === 'return' ? '<span class="pill low">مرتجع</span>' : 'بيع'}</td><td>${money(s.total * sg(s))}</td><td>${METH[s.method] || ''}</td><td>${esc(s.cashier || '')}</td><td><button class="b gh sm" onclick="showReceipt(S.sales.find(x=>x.id=='${esc(s.id)}'))">عرض</button></td></tr>`).join('')}</table></div>`
}
function returnedQty(no, bc) { return S.sales.filter(s => s.type === 'return' && s.ref === no).reduce((a, s) => a + s.items.filter(i => i.barcode === bc).reduce((x, i) => x + i.qty, 0), 0) }
function findSale() {
  const no = $('#rno').value.trim(); const s = S.sales.find(x => String(x.no) === no && x.type === 'sale');
  if (!s) { $('#rres').innerHTML = '<div class="empty">الفاتورة غير موجودة</div>'; return }
  $('#rres').innerHTML = `<p>فاتورة ${esc(s.no)} - ${fmtT(s.date)} - ${money(s.total)}${s.customer ? ' - ' + esc(s.customer) : ''}</p><table><tr><th>الصنف</th><th>اشترى</th><th>رجّع سابقاً</th><th>كمية المرتجع</th></tr>${s.items.map((i, ix) => { const rq = returnedQty(s.no, i.barcode), mx = i.qty - rq; return `<tr><td>${esc(i.name)} ${esc(i.size)}/${esc(i.color)}</td><td>${i.qty}</td><td>${rq}</td><td><input type="number" min="0" max="${mx}" value="0" id="rq${ix}" style="width:70px" ${mx ? '' : 'disabled'}></td></tr>` }).join('')}</table>
  <div class="row" style="margin-top:8px"><input id="rrs" class="grow" placeholder="سبب المرتجع (اختياري)"></div>
  <div class="row" style="margin-top:10px"><button class="b acc" onclick="doReturn('${esc(s.no)}',false)">تنفيذ المرتجع واسترداد المبلغ</button><button class="b gh" onclick="doReturn('${esc(s.no)}',true)">استبدال (مرتجع ثم بيع جديد)</button></div>`
}
function collectReturn(no, asNote) {
  const s = S.sales.find(x => String(x.no) === String(no) && x.type === 'sale'); const items = [];
  s.items.forEach((i, ix) => { const el = $('#rq' + ix); const n = Math.min(+el.value || 0, i.qty - returnedQty(s.no, i.barcode)); if (n > 0) items.push({ ...i, qty: n, disc: r2((i.disc || 0) * n / i.qty) }) });
  if (!items.length) { alert('حدد كمية'); return null }
  const sub = items.reduce((a, i) => a + i.qty * i.price, 0), lineD = items.reduce((a, i) => a + i.disc, 0);
  const rest = s.subtotal - (s.discLine || 0); const ratio = rest > 0 ? (s.total / rest) : 1; // share of extra (invoice/points) discounts
  const refund = r2(Math.min(((sub - lineD) * (rest > 0 ? ratio : 1)), s.total));
  const no2 = (S.deviceNo === 1 ? '' : S.deviceNo + '-') + (S.nextNo++);
  let pays;
  if (asNote) pays = [{ m: 'note', amt: refund }];
  else { pays = []; let left = refund; const sp = (s.payments || []).filter(p => p.m !== 'note'); const tot = sp.reduce((a, p) => a + p.amt, 0) || 1; sp.forEach((p, i) => { const a = i === sp.length - 1 ? left : r2(refund * p.amt / tot); left = r2(left - a); if (a > 0) pays.push({ m: p.m, amt: a }) }); if (!pays.length) pays = [{ m: 'cash', amt: refund }] }
  const r = { id: 's' + no2, no: no2, date: new Date().toISOString(), type: 'return', ref: s.no, items, subtotal: sub, discount: r2(sub - refund), total: refund, payments: pays, method: pays.length === 1 ? pays[0].m : 'mixed', reason: ($('#rrs') || {}).value || '', customerId: s.customerId || '', customer: s.customer || '', cashier: U.name, cashierId: U.id, loc: S.loc };
  items.forEach(i => { const f = findVar(i.barcode); if (f) adj(f[1], i.qty, r.id) });
  if (s.customerId) { const credit = r2(pays.filter(p => p.m === 'credit').reduce((a, p) => a + p.amt, 0)); S.ledger.push({ id: uid(), cid: s.customerId, ts: r.date, kind: 'return', ref: r.no, pts: -Math.floor(refund / S.settings.ptsPer), debt: -credit, loc: S.loc, u: U.id }) }
  S.sales.push(r); save(); return r
}
function doReturn(no, note) {
  const r = collectReturn(no, note); if (!r) return;
  if (note) { const s = S.sales.find(x => String(x.no) === String(no)); resetCart(); exch = { ref: r.no, amt: r.total }; if (s.customerId) cartCust = s.customerId; lastScan = `رصيد المرتجع ${money(r.total)}. امسح القطعة الجديدة.`; tab = 'sell'; render() }
  else { render(); showReceipt(r) }
}

// ---------- CUSTOMERS / DEBTS ----------
function vCustomers() {
  const f = window._cf || ''; const list = S.customers.filter(c => !f || c.name.includes(f) || (c.phone || '').includes(f));
  $('#app').innerHTML = `<div class="card"><div class="row"><h2 class="grow">العملاء (${list.length})</h2><input id="cf" placeholder="بحث بالاسم أو التليفون" value="${esc(f)}" style="width:200px"><button class="b" onclick="editCustomer()">+ عميل جديد</button></div>
  <p><small class="m">كل ${S.settings.ptsPer} ${esc(S.settings.cur)} مشتريات = نقطة. كل نقطة تخصم ${S.settings.ptsVal} ${esc(S.settings.cur)} (تتغير من الإعدادات).</small></p>
  ${list.length ? `<table><tr><th>الاسم</th><th>التليفون</th><th>النقاط</th><th>المديونية</th><th>إجمالي مشترياته</th><th></th></tr>${list.map(c => { const spent = S.sales.filter(s => s.customerId === c.id).reduce((a, s) => a + sg(s) * s.total, 0); return `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.phone || '')}</td><td>${custPts(c.id)}</td><td>${custBal(c.id) ? `<span class="pill low">${money(custBal(c.id))}</span>` : '-'}</td><td>${money(spent)}</td><td style="white-space:nowrap"><button class="b gh sm" onclick="custHistory('${c.id}')">السجل</button> <button class="b gh sm" onclick="editCustomer('${c.id}')">تعديل</button></td></tr>` }).join('')}</table>` : '<div class="empty">لا يوجد عملاء</div>'}</div>`;
  $('#cf').onchange = e => { window._cf = e.target.value; vCustomers() };
}
function editCustomer(id, fromSell) {
  const c = id ? custOf(id) : { name: '', phone: '', note: '' };
  modal(`<h2>${id ? 'تعديل عميل' : 'عميل جديد'}</h2><div class="row"><input id="cn" class="grow" placeholder="الاسم" value="${esc(c.name)}"></div><div class="row" style="margin-top:8px"><input id="cp" class="grow" placeholder="التليفون" value="${esc(c.phone || '')}"></div><div class="row" style="margin-top:8px"><input id="cno" class="grow" placeholder="ملاحظات" value="${esc(c.note || '')}"></div><div class="row" style="margin-top:10px"><button class="b ok" onclick="saveCustomer('${id || ''}',${!!fromSell})">حفظ</button><button class="b gh" onclick="closeModal()">إلغاء</button></div>`)
}
function saveCustomer(id, fromSell) {
  const name = $('#cn').value.trim(), phone = $('#cp').value.trim(); if (!name) { alert('اكتب الاسم'); return }
  if (phone && S.customers.some(c => c.phone === phone && c.id !== id)) { alert('التليفون ده متسجل لعميل تاني'); return }
  let c = id ? custOf(id) : null; if (!c) { c = { id: 'c' + uid() }; S.customers.push(c) }
  Object.assign(c, { name, phone, note: $('#cno').value, upd: Date.now() }); if (fromSell) cartCust = c.id; save(); closeModal(); render()
}
function custHistory(id) {
  const c = custOf(id); const sales = S.sales.filter(s => s.customerId === id).slice().reverse();
  modal(`<h2>${esc(c.name)}</h2><p>${esc(c.phone || '')} | نقاط: <b>${custPts(id)}</b> | مديونية: <b>${money(custBal(id))}</b></p><h2>المشتريات</h2>${sales.length ? `<table><tr><th>فاتورة</th><th>التاريخ</th><th>الإجمالي</th><th></th></tr>${sales.map(s => `<tr><td>${esc(s.no)}${s.type === 'return' ? ' <span class="pill low">مرتجع</span>' : ''}</td><td>${fmtT(s.date)}</td><td>${money(s.total * sg(s))}</td><td><button class="b gh sm" onclick="showReceipt(S.sales.find(x=>x.id=='${esc(s.id)}'))">عرض</button></td></tr>`).join('')}</table>` : '<div class="empty">لا مشتريات</div>'}<div style="margin-top:10px"><button class="b gh" onclick="closeModal()">إغلاق</button></div>`)
}
function vDebts() {
  const list = S.customers.filter(c => custBal(c.id) !== 0).sort((a, b) => custBal(b.id) - custBal(a.id)); const tot = list.reduce((a, c) => a + custBal(c.id), 0);
  $('#app').innerHTML = `<div class="kpis"><div class="kpi"><small>إجمالي الديون عند العملاء</small><div style="color:var(--acc)">${money(tot)}</div></div><div class="kpi"><small>عدد المدينين</small><div>${list.length}</div></div></div><div class="card"><h2>الديون (البيع الآجل)</h2>${list.length ? `<table><tr><th>العميل</th><th>التليفون</th><th>المديونية</th><th></th></tr>${list.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.phone || '')}</td><td>${money(custBal(c.id))}</td><td><button class="b ok sm" onclick="collectModal('${c.id}')">تحصيل</button> <button class="b gh sm" onclick="debtLog('${c.id}')">الحركات</button></td></tr>`).join('')}</table>` : '<div class="empty">مفيش ديون</div>'}</div>`
}
function collectModal(id) {
  const c = custOf(id);
  modal(`<h2>تحصيل من ${esc(c.name)}</h2><p>المديونية: <b>${money(custBal(id))}</b></p><div class="row"><input id="ca" type="number" min="0" placeholder="المبلغ" value="${custBal(id)}" style="width:130px"><select id="cm"><option value="cash">نقدي</option><option value="visa">فيزا</option><option value="wallet">فودافون كاش</option></select></div><div class="row" style="margin-top:10px"><button class="b ok" onclick="collect('${id}')">تحصيل</button><button class="b gh" onclick="closeModal()">إلغاء</button></div>`)
}
function collect(id) {
  const a = r2($('#ca').value); if (a <= 0) { alert('اكتب مبلغ'); return }
  if (a > custBal(id) + 0.001 && !confirm('المبلغ أكبر من المديونية. تكمل؟')) return;
  S.ledger.push({ id: uid(), cid: id, ts: new Date().toISOString(), kind: 'pay', method: $('#cm').value, debt: -a, pts: 0, loc: S.loc, u: U.id, by: U.name }); save(); closeModal(); render();
  modal(`<h2>تم التحصيل</h2><p>${money(a)} من ${esc(custOf(id).name)}. المتبقي: <b>${money(custBal(id))}</b></p><button class="b gh" onclick="closeModal()">إغلاق</button>`)
}
function debtLog(id) {
  const ls = S.ledger.filter(l => l.cid === id && l.debt).slice().reverse();
  modal(`<h2>حركات مديونية ${esc(custOf(id).name)}</h2><table><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th></tr>${ls.map(l => `<tr><td>${fmtT(l.ts)}</td><td>${l.kind === 'pay' ? 'تحصيل (' + (METH[l.method] || '') + ')' : l.kind === 'return' ? 'مرتجع فاتورة ' + esc(l.ref) : 'فاتورة آجل ' + esc(l.ref)}</td><td>${money(l.debt)}</td></tr>`).join('')}</table><div style="margin-top:10px"><button class="b gh" onclick="closeModal()">إغلاق</button></div>`)
}
// ---------- REPORTS ----------
let rep = null;
function repInit() { if (!rep) { const t = today(); rep = { from: t, to: t, loc: 'all', cashier: 'all' } } }
function setRange(k) {
  const d = new Date(), t = ymd(d);
  if (k === 'today') rep.from = rep.to = t;
  else if (k === 'week') { rep.from = ymd(Date.now() - 6 * 864e5); rep.to = t }
  else if (k === 'month') { rep.from = t.slice(0, 8) + '01'; rep.to = t }
  else if (k === 'lastmonth') { const a = new Date(d.getFullYear(), d.getMonth() - 1, 1), b = new Date(d.getFullYear(), d.getMonth(), 0); rep.from = ymd(a); rep.to = ymd(b) }
  else if (k === 'year') { rep.from = t.slice(0, 4) + '-01-01'; rep.to = t }
  vReports()
}
const profOf = s => s.items.reduce((a, i) => a + i.qty * (i.price - i.cost), 0) - s.discount;
function vReports() {
  repInit();
  const inR = s => { const d = ymd(s.date); return d >= rep.from && d <= rep.to && (rep.loc === 'all' || s.loc === rep.loc) && (rep.cashier === 'all' || s.cashier === rep.cashier) };
  const ss = S.sales.filter(inR);
  const rev = ss.reduce((a, s) => a + sg(s) * s.total, 0), prof = ss.reduce((a, s) => a + sg(s) * profOf(s), 0);
  const nSales = ss.filter(s => s.type === 'sale').length, rets = ss.filter(s => s.type === 'return').reduce((a, s) => a + s.total, 0);
  const disc = ss.reduce((a, s) => a + sg(s) * s.discount, 0);
  const days = {}; ss.forEach(s => { const d = ymd(s.date); const o = days[d] || (days[d] = { rev: 0, prof: 0, n: 0 }); o.rev += sg(s) * s.total; o.prof += sg(s) * profOf(s); if (s.type === 'sale') o.n++ });
  const dk = Object.keys(days).sort(); const mx = Math.max(...dk.map(k => days[k].rev), 1);
  // months (last 12, ignoring date range, respecting branch/cashier filter)
  const months = {}; S.sales.filter(s => (rep.loc === 'all' || s.loc === rep.loc) && (rep.cashier === 'all' || s.cashier === rep.cashier)).forEach(s => { const m = ym(s.date); const o = months[m] || (months[m] = { rev: 0, prof: 0, n: 0 }); o.rev += sg(s) * s.total; o.prof += sg(s) * profOf(s); if (s.type === 'sale') o.n++ });
  const mk = Object.keys(months).sort().slice(-12).reverse();
  const byCash = {}; ss.forEach(s => { const k = s.cashier || '-'; const o = byCash[k] || (byCash[k] = { rev: 0, n: 0, prof: 0 }); o.rev += sg(s) * s.total; o.prof += sg(s) * profOf(s); if (s.type === 'sale') o.n++ });
  const byM = {}; ss.forEach(s => (s.payments || []).forEach(p => byM[p.m] = (byM[p.m] || 0) + sg(s) * p.amt));
  const catOf = {}; S.products.forEach(p => catOf[p.name] = p.cat);
  const byCat = {}, sold = {}; ss.forEach(s => s.items.forEach(i => { const c = catOf[i.name] || '-'; const net = i.qty * i.price - (i.disc || 0); byCat[c] = (byCat[c] || 0) + sg(s) * net; const o = sold[i.name] || (sold[i.name] = { q: 0, p: 0 }); o.q += sg(s) * i.qty; o.p += sg(s) * i.qty * (i.price - i.cost) }));
  const top = Object.entries(sold).sort((a, b) => b[1].q - a[1].q).slice(0, 10);
  const sold30 = new Set(); S.sales.filter(s => Date.now() - new Date(s.date) < 30 * 864e5 && s.type === 'sale').forEach(s => s.items.forEach(i => sold30.add(i.barcode)));
  const dead = []; P().forEach(p => p.variants.forEach(v => { if (qtyAt(v) > 0 && !sold30.has(v.barcode)) dead.push([p, v]) }));
  const cashiers = [...new Set(S.sales.map(s => s.cashier).filter(Boolean))];
  const sh = S.shift;
  $('#app').innerHTML = `<div class="card"><div class="row"><b>الفترة</b><input type="date" id="rf1" value="${rep.from}"><input type="date" id="rf2" value="${rep.to}">
  <button class="b gh sm" onclick="setRange('today')">اليوم</button><button class="b gh sm" onclick="setRange('week')">7 أيام</button><button class="b gh sm" onclick="setRange('month')">الشهر ده</button><button class="b gh sm" onclick="setRange('lastmonth')">الشهر اللي فات</button><button class="b gh sm" onclick="setRange('year')">السنة</button>
  <select id="rfl"><option value="all">كل الفروع</option>${S.locs.map(l => `<option value="${l.id}" ${rep.loc === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
  <select id="rfc"><option value="all">كل الكاشيرية</option>${cashiers.map(c => `<option ${rep.cashier === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select><button class="b sm" onclick="exportCSV()">تصدير Excel/CSV</button></div></div>
  <div class="kpis"><div class="kpi"><small>صافي المبيعات</small><div>${money(rev)}</div></div><div class="kpi"><small>الربح</small><div style="color:var(--ok)">${money(prof)}</div></div><div class="kpi"><small>عدد الفواتير</small><div>${nSales}</div></div><div class="kpi"><small>متوسط الفاتورة</small><div>${money(nSales ? rev / nSales : 0)}</div></div><div class="kpi"><small>مرتجعات</small><div>${money(rets)}</div></div><div class="kpi"><small>إجمالي الخصومات</small><div>${money(disc)}</div></div></div>
  ${dk.length > 1 && dk.length <= 62 ? `<div class="card"><h2>المبيعات اليومية</h2><div class="bars" style="margin-bottom:22px">${dk.map(k => `<div style="height:${Math.max(days[k].rev / mx * 100, 2)}%" title="${k}: ${money(days[k].rev)}"><span>${k.slice(5)}</span></div>`).join('')}</div></div>` : ''}
  <div class="pos"><div class="card"><h2>تقرير يومي</h2><div style="max-height:260px;overflow:auto"><table><tr><th>اليوم</th><th>فواتير</th><th>مبيعات</th><th>ربح</th></tr>${dk.slice().reverse().map(k => `<tr><td>${k}</td><td>${days[k].n}</td><td>${money(days[k].rev)}</td><td>${money(days[k].prof)}</td></tr>`).join('') || '<tr><td>لا مبيعات</td></tr>'}</table></div></div>
  <div class="card"><h2>تقرير شهري (آخر 12 شهر)</h2><div style="max-height:260px;overflow:auto"><table><tr><th>الشهر</th><th>فواتير</th><th>مبيعات</th><th>ربح</th></tr>${mk.map(k => `<tr><td>${k}</td><td>${months[k].n}</td><td>${money(months[k].rev)}</td><td>${money(months[k].prof)}</td></tr>`).join('') || '<tr><td>لا مبيعات</td></tr>'}</table></div></div></div>
  <div class="pos"><div class="card"><h2>مبيعات كل كاشير</h2><table><tr><th>الكاشير</th><th>فواتير</th><th>مبيعات</th><th>ربح</th></tr>${Object.entries(byCash).map(([k, o]) => `<tr><td>${esc(k)}</td><td>${o.n}</td><td>${money(o.rev)}</td><td>${money(o.prof)}</td></tr>`).join('') || '<tr><td>لا مبيعات</td></tr>'}</table></div>
  <div class="card"><h2>حسب طريقة الدفع</h2><table>${Object.entries(byM).map(([m, v]) => `<tr><td>${METH[m] || m}</td><td>${money(v)}</td></tr>`).join('') || '<tr><td>لا مبيعات</td></tr>'}</table><h2 style="margin-top:12px">حسب القسم</h2><table>${Object.entries(byCat).map(([m, v]) => `<tr><td>${esc(m)}</td><td>${money(v)}</td></tr>`).join('')}</table></div></div>
  <div class="pos"><div class="card"><h2>الأكثر مبيعاً</h2><table><tr><th></th><th>الصنف</th><th>قطع</th><th>ربح</th></tr>${top.map(([n, o], i) => `<tr><td>${i + 1}</td><td>${esc(n)}</td><td><b>${o.q}</b></td><td>${money(o.p)}</td></tr>`).join('') || '<tr><td>-</td></tr>'}</table></div>
  <div class="card"><h2>مخزون راكد (لم يُبع من 30 يوم)</h2>${dead.length ? `<table>${dead.slice(0, 8).map(([p, v]) => `<tr><td>${esc(p.name)}</td><td>${esc(v.size)}/${esc(v.color)}</td><td>${qtyAt(v)}</td></tr>`).join('')}</table>${dead.length > 8 ? `<small>و ${dead.length - 8} غيرهم</small>` : ''}` : '<div class="empty">لا يوجد</div>'}</div></div>
  <div class="card"><h2>الوردية والدرج</h2>${sh.open ? `<p>الكاشير: ${esc(sh.cashier)} | بدأت ${fmtT(sh.start)} | عهدة الدرج ${money(sh.openCash)}</p><p>النقدية المتوقعة بالدرج الآن: <b>${money(shiftCash())}</b></p>${(sh.moves || []).length ? `<table>${sh.moves.map(m => `<tr><td>${m.type === 'in' ? 'إيداع' : 'مصروف'}</td><td>${money(m.amt)}</td><td>${esc(m.note || '')}</td><td>${esc(m.by || '')}</td></tr>`).join('')}</table>` : ''}<div class="row"><button class="b gh" onclick="drawerMove('out')">مصروف من الدرج</button><button class="b gh" onclick="drawerMove('in')">إيداع في الدرج</button><button class="b acc" onclick="closeShiftModal()">تقفيل الوردية</button></div>` : `<div class="row"><b>لا توجد وردية مفتوحة</b><button class="b ok" onclick="openShiftModal()">فتح وردية</button></div>`}
  <h2 style="margin-top:14px">سجل الورديات</h2><div style="max-height:240px;overflow:auto"><table><tr><th>الكاشير</th><th>من</th><th>إلى</th><th>مبيعات</th><th>متوقع</th><th>فعلي</th><th>الفرق</th></tr>${S.shifts.slice().reverse().slice(0, 30).map(x => `<tr><td>${esc(x.cashier || '')}</td><td>${fmtT(x.start)}</td><td>${fmtT(x.end)}</td><td>${money(x.total || 0)}</td><td>${x.expected === undefined ? '-' : money(x.expected)}</td><td>${x.counted === undefined ? '-' : money(x.counted)}</td><td>${x.diff === undefined ? '-' : `<b style="color:${x.diff < 0 ? 'var(--acc)' : 'var(--ok)'}">${money(x.diff)}</b>`}</td></tr>`).join('')}</table></div></div>`;
  $('#rf1').onchange = e => { rep.from = e.target.value; vReports() }; $('#rf2').onchange = e => { rep.to = e.target.value; vReports() };
  $('#rfl').onchange = e => { rep.loc = e.target.value; vReports() }; $('#rfc').onchange = e => { rep.cashier = e.target.value; vReports() };
}
function exportCSV() {
  const inR = s => { const d = ymd(s.date); return d >= rep.from && d <= rep.to && (rep.loc === 'all' || s.loc === rep.loc) && (rep.cashier === 'all' || s.cashier === rep.cashier) };
  const rows = [['رقم', 'التاريخ', 'النوع', 'الفرع', 'الكاشير', 'العميل', 'الإجمالي', 'الخصم', 'الربح', 'الدفع']];
  S.sales.filter(inR).forEach(s => rows.push([s.no, fmtT(s.date), s.type === 'return' ? 'مرتجع' : 'بيع', locName(s.loc), s.cashier || '', s.customer || '', r2(sg(s) * s.total), r2(s.discount), r2(sg(s) * profOf(s)), (s.payments || []).map(p => (METH[p.m] || p.m) + ':' + r2(p.amt)).join(' + ')]));
  const csv = '\ufeff' + rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `sales-${rep.from}_${rep.to}.csv`; a.click()
}

// ---------- SETTINGS ----------
function vSettings() {
  const s = S.settings;
  $('#app').innerHTML = `<div class="card"><h2>بيانات المحل (بتظهر على الفاتورة)</h2>
  <div class="row"><div id="logoBox">${s.logo ? `<img src="${s.logo}" style="height:70px;border:1px solid var(--line);border-radius:8px;background:#fff">` : '<div class="pill">لا يوجد لوجو</div>'}</div><input type="file" id="lg" accept="image/*" onchange="setLogo(this)"><button class="b gh sm" onclick="S.settings.logo='';save();render()">حذف اللوجو</button></div>
  <div class="row" style="margin-top:8px"><input id="sn" value="${esc(s.shop)}" class="grow" placeholder="اسم المحل"><input id="sp" value="${esc(s.phone)}" placeholder="تليفون"></div>
  <div class="row" style="margin-top:8px"><input id="sa" value="${esc(s.address)}" class="grow" placeholder="العنوان"></div>
  <div class="row" style="margin-top:8px"><input id="ss" value="${esc(s.slogan)}" class="grow" placeholder="الشعار / السلوجان"></div>
  <div class="row" style="margin-top:8px"><input id="sf" class="grow" value="${esc(s.footer)}" placeholder="جملة ختام الفاتورة"></div>
  ${DESK ? `<div class="row" style="margin-top:8px"><label><input type="checkbox" id="ssp" ${s.silentPrint ? 'checked' : ''}> طباعة مباشرة على الطابعة الافتراضية (بدون نافذة اختيار)</label></div>` : ''}
  <div class="row" style="margin-top:8px"><label>حد تنبيه المخزون</label><input id="sl" type="number" value="${s.low}" style="width:80px"><label>العملة</label><input id="sc" value="${esc(s.cur)}" style="width:80px"></div>
  <div class="row" style="margin-top:8px"><label>نقاط الولاء: كل</label><input id="spp" type="number" min="1" value="${s.ptsPer}" style="width:80px"><label>${esc(s.cur)} = نقطة، وقيمة النقطة</label><input id="spv" type="number" min="0" step="0.1" value="${s.ptsVal}" style="width:80px"><label>${esc(s.cur)}</label></div>
  <div class="row" style="margin-top:10px"><button class="b ok" onclick="saveSet()">حفظ</button><button class="b gh" onclick="saveSet();previewReceipt()">معاينة الفاتورة</button></div></div>

  <div class="card"><h2>المستخدمين والصلاحيات</h2><table><tr><th>الاسم</th><th>الدور</th><th>أقصى خصم</th><th>مرتجع</th><th>الحالة</th><th></th></tr>${S.users.map(u => `<tr><td><b>${esc(u.name)}</b></td><td>${ROLES[u.role]}</td><td>${u.role === 'admin' ? '-' : (u.maxDisc ?? (u.role === 'manager' ? 100 : 10)) + '%'}</td><td>${u.role !== 'cashier' || u.canReturn ? 'نعم' : 'لا'}</td><td>${u.active === false ? 'موقوف' : 'شغال'}</td><td><button class="b gh sm" onclick="editUser('${u.id}')">تعديل</button></td></tr>`).join('')}</table>
  <div class="row" style="margin-top:8px"><button class="b" onclick="editUser()">+ مستخدم جديد</button></div><p><small class="m">المدير: كل حاجة. المشرف: كل حاجة ما عدا الإعدادات. الكاشير: البيع والعملاء والديون فقط (والمرتجع لو سمحت له) وبحد أقصى للخصم.</small></p></div>

  <div class="card"><h2>الفروع والمخازن</h2><table><tr><th>الاسم</th><th>النوع</th><th></th></tr>${S.locs.map(l => `<tr><td>${esc(l.name)} ${l.id === S.loc ? '<span class="pill ok">الجهاز ده</span>' : ''}</td><td>${l.type === 'warehouse' ? 'مخزن' : 'فرع'}</td><td>${l.id !== S.loc ? `<button class="b gh sm" onclick="setLoc('${l.id}')">اجعل الجهاز ده عليه</button>` : ''}</td></tr>`).join('')}</table>
  <div class="row" style="margin-top:8px"><input id="ln" placeholder="اسم فرع أو مخزن جديد" class="grow"><select id="lt"><option value="branch">فرع</option><option value="warehouse">مخزن</option></select><button class="b" onclick="addLoc()">إضافة</button></div>
  <div class="row" style="margin-top:8px"><label>رقم الجهاز</label><input id="dn" type="number" min="1" max="99" value="${S.deviceNo}" style="width:80px" onchange="setDevNo(+this.value)"><small class="m">لازم يكون رقم مختلف لكل جهاز (1، 2، 3...) علشان أرقام الفواتير والباركود ما تتكررش.</small></div></div>

  <div class="card"><h2>المزامنة بين الفروع (أوفلاين / أونلاين)</h2>
  <p><small class="m">البرنامج شغال أوفلاين دايماً. للمزامنة اختار فولدر مشترك (Google Drive أو Dropbox أو OneDrive أو فولدر شبكة) على كل الأجهزة. كل جهاز بيكتب ملفه ويقرا ملفات الباقي ويدمج المبيعات والمخزون والعملاء. لو النت قطع بيكمل شغل عادي ويزامن لما يرجع.</small></p>
  <div class="row"><input id="sd" value="${esc(s.syncDir)}" class="grow" readonly placeholder="لم يتم اختيار فولدر"><button class="b" onclick="pickSync()">اختيار فولدر</button><button class="b gh" onclick="S.settings.syncDir='';save();render()">إيقاف</button><button class="b ok" onclick="runSync().then(()=>render())">مزامنة الآن</button></div></div>

  <div class="card"><h2>نسخ احتياطي</h2><div class="row"><button class="b ok" onclick="backupNow()">نسخة احتياطية الآن</button><button class="b gh" onclick="window.posDB&&window.posDB.backupOpen()">فتح فولدر النسخ</button><button class="b" onclick="backup()">تحميل نسخة ملف</button><input type="file" id="rf" accept=".json" onchange="restore(this)"></div>
  ${DESK ? `<div class="row" style="margin-top:8px"><input value="${esc(s.backupDir)}" class="grow" readonly placeholder="نسخة إضافية على فلاشة أو درايف (اختياري)"><button class="b gh" onclick="pickBackupDir()">اختيار فولدر إضافي</button><button class="b gh sm" onclick="S.settings.backupDir='';save();render()">حذف</button></div><p><small class="m">نسخة احتياطية تلقائية: كل تغيير بعد دقيقتين، وكل 10 دقايق، وعند إغلاق البرنامج، في Documents\\ClothingPOS-Backups (آخر 60 يوم). البيانات الأصلية: ${esc(window.posDB.path())}</small></p><div class="row"><button class="b gh sm" onclick="listBackups()">استرجاع من نسخة سابقة</button></div><div id="bkList"></div>` : '<p><small class="m">حمّل نسخة احتياطية بشكل دوري.</small></p>'}
  <div class="row" style="margin-top:10px"><button class="b acc" onclick="if(confirm('مسح كل البيانات والرجوع لبيانات تجريبية؟')){resetData(true)}">إعادة بيانات تجريبية</button><button class="b acc" onclick="if(confirm('مسح كل المنتجات والمبيعات وبدء محل فاضي؟ (المستخدمين بيفضلوا)')){resetData(false)}">بدء محل فاضي</button></div></div>
  <div class="card"><small class="m">الإصدار ${DESK ? window.posDB.version() : 'متصفح'}</small></div>`;
}
function saveSet() {
  const s = S.settings; s.shop = $('#sn').value; s.phone = $('#sp').value; s.address = $('#sa').value; s.slogan = $('#ss').value; s.low = +$('#sl').value; s.cur = $('#sc').value; s.footer = $('#sf').value;
  s.ptsPer = Math.max(1, +$('#spp').value || 10); s.ptsVal = Math.max(0, +$('#spv').value || 0); if ($('#ssp')) s.silentPrint = $('#ssp').checked; save(); render()
}
function setLogo(el) { const f = el.files[0]; if (!f) return; const img = new Image(), u = URL.createObjectURL(f); img.onload = () => { const m = 400, k = Math.min(1, m / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); S.settings.logo = c.toDataURL('image/png'); save(); render() }; img.src = u }
function previewReceipt() { const it = P()[0]; if (!it) return; const v = it.variants[0]; showReceipt({ id: 'prev', no: 'معاينة', date: new Date().toISOString(), type: 'sale', items: [{ name: it.name, size: v.size, color: v.color, qty: 1, price: it.price, cost: it.cost }], subtotal: it.price, discount: 0, total: it.price, payments: [{ m: 'cash', amt: it.price }], cashier: U.name }) }
function editUser(id) {
  const u = id ? S.users.find(x => x.id === id) : { name: '', role: 'cashier', maxDisc: 10, canReturn: false, active: true };
  modal(`<h2>${id ? 'تعديل مستخدم' : 'مستخدم جديد'}</h2><div class="row"><input id="un" class="grow" placeholder="الاسم" value="${esc(u.name)}"></div><div class="row" style="margin-top:8px"><select id="ur" onchange="">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select><input id="up" type="password" placeholder="${id ? 'رقم سري جديد (اتركه فاضي لو مش هتغيره)' : 'الرقم السري (4 أرقام على الأقل)'}" class="grow"></div>
  <div class="row" style="margin-top:8px"><label>أقصى خصم %</label><input id="ud" type="number" min="0" max="100" value="${u.maxDisc ?? 10}" style="width:80px"><label><input type="checkbox" id="uc" ${u.canReturn ? 'checked' : ''}> يسمح بالمرتجع (للكاشير)</label><label><input type="checkbox" id="ua" ${u.active !== false ? 'checked' : ''}> شغال</label></div>
  <div class="row" style="margin-top:10px"><button class="b ok" onclick="saveUser('${id || ''}')">حفظ</button><button class="b gh" onclick="closeModal()">إلغاء</button></div>`)
}
function saveUser(id) {
  const name = $('#un').value.trim(), pin = $('#up').value; if (!name) { alert('اكتب الاسم'); return }
  if (!id && pin.length < 4) { alert('الرقم السري 4 أرقام على الأقل'); return } if (pin && pin.length < 4) { alert('الرقم السري 4 أرقام على الأقل'); return }
  if (S.users.some(x => x.name === name && x.id !== id)) { alert('الاسم متكرر'); return }
  let u = id ? S.users.find(x => x.id === id) : null; if (!u) { u = { id: 'u' + uid() }; S.users.push(u) }
  const role = $('#ur').value, active = $('#ua').checked;
  if (u.role === 'admin' && (role !== 'admin' || !active) && S.users.filter(x => x.role === 'admin' && x.active !== false && x.id !== u.id).length === 0) { alert('لازم يفضل مدير واحد شغال على الأقل'); return }
  Object.assign(u, { name, role, maxDisc: +$('#ud').value, canReturn: $('#uc').checked, active, upd: Date.now() }); if (pin) { u.pin = hashPin(pin); u.defPin = false }
  if (U && u.id === U.id) U = u; save(); closeModal(); render()
}
function setLoc(id) { S.loc = id; save(); render() }
function addLoc() { const n = $('#ln').value.trim(); if (!n) return; S.locs.push({ id: 'l' + uid(), name: n, type: $('#lt').value }); save(); render() }
function setDevNo(n) { if (!(n >= 1 && n <= 99)) return; if (!confirm('تغيير رقم الجهاز بيأثر على أرقام الفواتير والباركود الجديدة بس. تكمل؟')) { render(); return } S.deviceNo = n; save(); render() }
async function pickSync() { if (!DESK) { alert('المزامنة في نسخة الويندوز فقط'); return } const f = await window.posDB.pickFolder(); if (f) { S.settings.syncDir = f; save(); await runSync(); render() } }
async function pickBackupDir() { const f = await window.posDB.pickFolder(); if (f) { S.settings.backupDir = f; save(); render() } }
async function backupNow() { if (!DESK) { backup(); return } save(); const r = await window.posDB.backupNow(); alert(r.length ? 'تم حفظ نسخة احتياطية في:\n' + r.join('\n') : 'تعذر عمل النسخة') }
async function listBackups() { const l = await window.posDB.backupList(); $('#bkList').innerHTML = l.length ? `<table>${l.map(f => `<tr><td>${esc(f.name)}</td><td>${Math.round(f.size / 1024)} KB</td><td><button class="b gh sm" onclick="restoreFile('${esc(f.name)}')">استرجاع</button></td></tr>`).join('')}</table>` : '<div class="empty">لا نسخ</div>' }
async function restoreFile(n) { if (!confirm('هيتم استبدال كل البيانات الحالية بالنسخة دي. تكمل؟')) return; const t = await window.posDB.backupRead(n); if (t) applyRestore(t) }
function applyRestore(t) { try { const n = migrate(JSON.parse(t)); n.deviceNo = S.deviceNo; n.loc = S.locs.some(l => l.id === S.loc) && n.locs.some(l => l.id === S.loc) ? S.loc : n.loc; S = n; U = S.users.find(u => U && u.id === U.id) || null; save(); render(); alert('تم الاسترجاع') } catch (e) { alert('ملف غير صالح: ' + e) } }
function resetData(demo) { const users = S.users, dn = S.deviceNo, st = S.settings; const n = seed(); if (!demo) { n.products = []; n.sales = []; n.nextNo = 1001; n.shifts = [] } n.users = users; n.deviceNo = dn; n.settings = { ...n.settings, ...st }; S = n; save(); render() }
function backup() { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S)], { type: 'application/json' })); a.download = 'pos-backup-' + today() + '.json'; a.click() }
function restore(el) { const f = el.files[0]; if (!f) return; if (!confirm('هيتم استبدال كل البيانات الحالية بالملف ده. تكمل؟')) { el.value = ''; return } f.text().then(applyRestore) }

// ---------- boot ----------
S = load();
save0(); loginView(); renderHeader();
if (S.settings.syncDir) setTimeout(runSync, 1500);
