const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path'), fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

let db, win;
const cache = { products: new Map(), sales: new Map(), shifts: new Map(), meta: new Map() };

function openDb() {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(path.join(dir, 'pos.db'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
  CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sales(no TEXT PRIMARY KEY, ts TEXT, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS shifts(id INTEGER PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
}

function loadState() {
  const meta = db.prepare('SELECT key,value FROM meta').all();
  if (!meta.length) return null; // first run: renderer seeds demo
  const S = {};
  for (const m of meta) { S[m.key] = JSON.parse(m.value); cache.meta.set(m.key, m.value); }
  S.products = db.prepare('SELECT id,data FROM products ORDER BY rowid').all().map(r => { cache.products.set(r.id, r.data); return JSON.parse(r.data); });
  S.sales = db.prepare('SELECT no,data FROM sales ORDER BY rowid').all().map(r => { cache.sales.set(r.no, r.data); return JSON.parse(r.data); });
  S.shifts = db.prepare('SELECT id,data FROM shifts ORDER BY id').all().map(r => { cache.shifts.set(String(r.id), r.data); return JSON.parse(r.data); });
  return S;
}

function syncTable(name, items, keyOf, upsertSql, params) {
  const c = cache[name], seen = new Set();
  const up = db.prepare(upsertSql);
  for (const it of items) {
    const k = String(keyOf(it)), j = JSON.stringify(it);
    seen.add(k);
    if (c.get(k) !== j) { up.run(...params(it, k, j)); c.set(k, j); }
  }
  const del = db.prepare(`DELETE FROM ${name} WHERE ${name === 'sales' ? 'no' : 'id'}=?`);
  for (const k of [...c.keys()]) if (!seen.has(k)) { del.run(name === 'shifts' ? Number(k) : k); c.delete(k); }
}

function saveState(S) {
  db.exec('BEGIN');
  try {
    const { products = [], sales = [], shifts = [], ...rest } = S;
    syncTable('products', products, p => p.id, 'INSERT INTO products(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', (p, k, j) => [k, j]);
    syncTable('sales', sales, s => s.id, 'INSERT INTO sales(no,ts,data) VALUES(?,?,?) ON CONFLICT(no) DO UPDATE SET ts=excluded.ts,data=excluded.data', (s, k, j) => [k, String(s.date || ''), j]);
    const sh = shifts.map((s, i) => ({ s, i }));
    syncTable('shifts', sh, (x) => x.i, 'INSERT INTO shifts(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', (x, k) => [Number(k), JSON.stringify(x.s)]);
    const up = db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    for (const [k, v] of Object.entries(rest)) {
      const j = JSON.stringify(v === undefined ? null : v);
      if (cache.meta.get(k) !== j) { up.run(k, j); cache.meta.set(k, j); }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function autoBackup() {
  try {
    const dir = path.join(app.getPath('documents'), 'ClothingPOS-Backups');
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date().toISOString().slice(0, 10);
    const f = path.join(dir, `pos-${d}.json`);
    const S = loadStateForBackup();
    if (S) fs.writeFileSync(f, JSON.stringify(S));
    const files = fs.readdirSync(dir).filter(x => /^pos-.*\.json$/.test(x)).sort();
    while (files.length > 30) fs.unlinkSync(path.join(dir, files.shift()));
  } catch (e) { console.error('backup failed', e); }
}
function loadStateForBackup() {
  const saveCache = {}; for (const k in cache) saveCache[k] = new Map(cache[k]);
  const S = loadState(); for (const k in cache) cache[k] = saveCache[k]; return S;
}

ipcMain.on('db:load', e => { try { e.returnValue = loadState(); } catch (err) { console.error(err); e.returnValue = null; } });
ipcMain.on('db:save', (e, S) => { try { saveState(S); e.returnValue = true; } catch (err) { console.error(err); e.returnValue = String(err); } });
ipcMain.on('db:path', e => { e.returnValue = path.join(app.getPath('userData'), 'pos.db'); });
ipcMain.handle('print', (e, silent) => new Promise(res => {
  e.sender.print({ silent: !!silent, printBackground: true }, (ok, why) => res({ ok, why }));
}));

function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 800, show: false, autoHideMenuBar: true, title: 'Clothing POS',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false } });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => { openDb(); createWindow(); });
  app.on('before-quit', () => { try { autoBackup(); } catch {} });
  app.on('window-all-closed', () => app.quit());
}
