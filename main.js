const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const path = require('path'), fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

let db, win;
// collections stored one row per item (fast incremental saves). key = field used as id
const COLS = {
  products: p => p.id,
  sales: s => s.id,
  moves: m => m.id,
  ledger: l => l.id,
  customers: c => c.id,
  shifts: (s, i) => s.id || ('i' + i),
};
const cache = {}; for (const k in COLS) cache[k] = new Map(); cache.meta = new Map();

function openDb() {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(path.join(dir, 'pos.db'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  db.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  for (const k in COLS) db.exec(`CREATE TABLE IF NOT EXISTS c_${k}(id TEXT PRIMARY KEY, ord INTEGER, data TEXT NOT NULL);`);
  migrateOld(); // v1.0 tables
}
function migrateOld() {
  try {
    const has = n => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(n);
    if (has('products') && !db.prepare('SELECT 1 FROM c_products LIMIT 1').get()) {
      db.exec('BEGIN');
      let i = 0;
      for (const r of db.prepare('SELECT id,data FROM products ORDER BY rowid').all()) db.prepare('INSERT OR IGNORE INTO c_products(id,ord,data) VALUES(?,?,?)').run(r.id, i++, r.data);
      i = 0;
      for (const r of db.prepare('SELECT no,data FROM sales ORDER BY rowid').all()) { const s = JSON.parse(r.data); db.prepare('INSERT OR IGNORE INTO c_sales(id,ord,data) VALUES(?,?,?)').run(s.id || ('s' + r.no), i++, r.data); }
      i = 0;
      for (const r of db.prepare('SELECT id,data FROM shifts ORDER BY id').all()) db.prepare('INSERT OR IGNORE INTO c_shifts(id,ord,data) VALUES(?,?,?)').run('i' + (i), i++, r.data);
      db.exec('COMMIT');
    }
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} console.error('migrate', e); }
}

function loadState() {
  const meta = db.prepare('SELECT key,value FROM meta').all();
  const hasProducts = db.prepare('SELECT 1 FROM c_products LIMIT 1').get();
  if (!meta.length && !hasProducts) return null;
  const S = {};
  for (const m of meta) { S[m.key] = JSON.parse(m.value); cache.meta.set(m.key, m.value); }
  for (const k in COLS) {
    S[k] = db.prepare(`SELECT id,data FROM c_${k} ORDER BY ord`).all().map(r => { cache[k].set(r.id, r.data); return JSON.parse(r.data); });
  }
  return S;
}

function saveState(S) {
  db.exec('BEGIN');
  try {
    for (const k in COLS) {
      const items = S[k] || [], c = cache[k], seen = new Set();
      const up = db.prepare(`INSERT INTO c_${k}(id,ord,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET ord=excluded.ord,data=excluded.data`);
      items.forEach((it, i) => {
        const id = String(COLS[k](it, i)), j = JSON.stringify(it), sig = i + '|' + j;
        seen.add(id);
        if (c.get(id) !== sig) { up.run(id, i, j); c.set(id, sig); }
      });
      const del = db.prepare(`DELETE FROM c_${k} WHERE id=?`);
      for (const id of [...c.keys()]) if (!seen.has(id)) { del.run(id); c.delete(id); }
    }
    const up = db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    for (const [k, v] of Object.entries(S)) {
      if (k in COLS) continue;
      const j = JSON.stringify(v === undefined ? null : v);
      if (cache.meta.get(k) !== j) { up.run(k, j); cache.meta.set(k, j); }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  scheduleBackup();
}
// cache stores "idx|json" for collections; loadState stores bare json -> normalise
function fixCacheAfterLoad() { for (const k in COLS) { let i = 0; for (const [id, j] of cache[k]) { cache[k].set(id, (i++) + '|' + j); } } }

// ---------- backups ----------
function backupDirs() {
  const dirs = [path.join(app.getPath('documents'), 'ClothingPOS-Backups')];
  try { const x = metaGet('settings'); if (x && x.backupDir) dirs.push(x.backupDir); } catch {}
  return dirs;
}
function metaGet(k) { const r = db.prepare('SELECT value FROM meta WHERE key=?').get(k); return r ? JSON.parse(r.value) : null; }
function snapshot() {
  // read directly from db without touching the cache
  const S = {};
  for (const m of db.prepare('SELECT key,value FROM meta').all()) S[m.key] = JSON.parse(m.value);
  for (const k in COLS) S[k] = db.prepare(`SELECT data FROM c_${k} ORDER BY ord`).all().map(r => JSON.parse(r.data));
  return S;
}
let lastBackupAt = 0, backupTimer = null;
function doBackup(tag) {
  const out = [];
  try {
    if (!db.prepare('SELECT 1 FROM meta LIMIT 1').get()) return out;
    const json = JSON.stringify(snapshot());
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    const hm = `${p2(d.getHours())}${p2(d.getMinutes())}`;
    for (const dir of backupDirs()) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `pos-${day}.json`), json); // daily file, refreshed all day
        if (tag === 'manual' || tag === 'quit') fs.writeFileSync(path.join(dir, `pos-${day}-${hm}-${tag}.json`), json);
        const files = fs.readdirSync(dir).filter(x => /^pos-\d{4}-\d\d-\d\d(-\d{4}-\w+)?\.json$/.test(x)).sort();
        const daily = files.filter(f => /^pos-\d{4}-\d\d-\d\d\.json$/.test(f)), extra = files.filter(f => !daily.includes(f));
        while (daily.length > 60) fs.unlinkSync(path.join(dir, daily.shift()));
        while (extra.length > 20) fs.unlinkSync(path.join(dir, extra.shift()));
        out.push(dir);
      } catch (e) { console.error('backup dir failed', dir, e.message); }
    }
    lastBackupAt = Date.now();
  } catch (e) { console.error('backup failed', e); }
  return out;
}
function scheduleBackup() { // debounce: backup 2 minutes after the last change, at most one per 2 minutes
  if (backupTimer) return;
  backupTimer = setTimeout(() => { backupTimer = null; doBackup('auto'); }, 120000);
}

// ---------- sync (shared folder: Google Drive / Dropbox / OneDrive / network share) ----------
function syncFiles(dir) { return fs.readdirSync(dir).filter(f => /^sync-.*\.json$/.test(f)); }

ipcMain.on('db:load', e => { try { const S = loadState(); fixCacheAfterLoad(); e.returnValue = S; } catch (err) { console.error(err); e.returnValue = null; } });
ipcMain.on('db:save', (e, S) => { try { saveState(S); e.returnValue = true; } catch (err) { console.error(err); e.returnValue = String(err); } });
ipcMain.on('db:path', e => { e.returnValue = path.join(app.getPath('userData'), 'pos.db'); });
ipcMain.on('app:version', e => { e.returnValue = app.getVersion(); });
ipcMain.handle('print', (e, silent) => new Promise(res => {
  e.sender.print({ silent: !!silent, printBackground: true }, (ok, why) => res({ ok, why }));
}));
ipcMain.handle('open:wa', (e, url) => {
  if (typeof url === 'string' && /^https:\/\/wa\.me\/\d{8,15}(\?text=.*)?$/.test(url) && url.length < 6000) { shell.openExternal(url); return true; }
  return false;
});
ipcMain.handle('backup:now', () => doBackup('manual'));
ipcMain.handle('backup:open', () => { const d = backupDirs()[0]; fs.mkdirSync(d, { recursive: true }); return shell.openPath(d); });
ipcMain.handle('backup:list', () => {
  const d = backupDirs()[0]; try { return fs.readdirSync(d).filter(f => /^pos-.*\.json$/.test(f)).sort().reverse().map(f => ({ name: f, size: fs.statSync(path.join(d, f)).size })); } catch { return []; }
});
ipcMain.handle('backup:read', (e, name) => {
  if (!/^pos-[\w-]+\.json$/.test(name)) return null;
  const f = path.join(backupDirs()[0], name); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
});
ipcMain.handle('dialog:folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('sync:run', (e, { dir, name, data }) => {
  try {
    if (!dir || !fs.existsSync(dir)) return { ok: false, why: 'folder-missing' };
    const others = [];
    for (const f of syncFiles(dir)) {
      if (f === name) continue;
      try { others.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch {}
    }
    const tmp = path.join(dir, name + '.tmp');
    fs.writeFileSync(tmp, data); fs.renameSync(tmp, path.join(dir, name));
    return { ok: true, others };
  } catch (err) { return { ok: false, why: String(err.message || err) }; }
});

function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 800, show: false, autoHideMenuBar: true, title: 'Clothing POS',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false } });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
}

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => { openDb(); createWindow(); setInterval(() => { if (Date.now() - lastBackupAt > 10 * 60 * 1000) doBackup('auto'); }, 5 * 60 * 1000); });
  app.on('before-quit', () => { try { doBackup('quit'); } catch {} });
  app.on('window-all-closed', () => app.quit());
}
