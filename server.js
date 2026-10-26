const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'bi_mat_mac_dinh_123';

const db = new Database('farm.db');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, is_admin INTEGER DEFAULT 0, is_banned INTEGER DEFAULT 0, coins INTEGER DEFAULT 100, created_at INTEGER NOT NULL, last_login INTEGER);
CREATE TABLE IF NOT EXISTS plots (user_id INTEGER NOT NULL, slot INTEGER NOT NULL, crop TEXT, planted_at INTEGER, ready_at INTEGER, PRIMARY KEY (user_id, slot));
CREATE TABLE IF NOT EXISTS stats (key TEXT PRIMARY KEY, value INTEGER DEFAULT 0);
INSERT OR IGNORE INTO stats(key,value) VALUES ('total_plant',0),('total_harvest',0);
`);

// Thêm cột total_harvested (tổng số cây đã trồng) vào bảng users nếu chưa có
try { db.exec(`ALTER TABLE users ADD COLUMN total_harvested INTEGER DEFAULT 0;`); } catch(e) {}

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
if (!db.prepare('SELECT 1 FROM users WHERE username=?').get(ADMIN_USER)) {
  db.prepare(`INSERT INTO users(username,password_hash,is_admin,created_at) VALUES (?,?,1,?)`).run(ADMIN_USER, bcrypt.hashSync(ADMIN_PASS, 10), Date.now());
  console.log(`[seed] admin: ${ADMIN_USER} / ${ADMIN_PASS}`);
}

const CROPS = { carrot: { cost: 10, sell: 25, grow: 30000 }, corn: { cost: 25, sell: 60, grow: 90000 }, tomato: { cost: 50, sell: 130, grow: 180000 } };
const SLOTS = 9;
const sign = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: '30d' });
const verify = t => { try { return jwt.verify(t, SECRET); } catch { return null; } };

function getState(userId) {
  const u = db.prepare('SELECT coins FROM users WHERE id=?').get(userId);
  const plots = db.prepare('SELECT slot,crop,ready_at FROM plots WHERE user_id=?').all(userId);
  const arr = Array.from({ length: SLOTS }, (_, i) => {
    const p = plots.find(x => x.slot === i);
    return p && p.crop ? { slot: i, crop: p.crop, ready_at: p.ready_at } : { slot: i, crop: null };
  });
  return { coins: u.coins, plots: arr };
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || username.length < 3 || password.length < 4) return res.status(400).json({ error: 'Tên ≥3 ký tự, mật khẩu ≥4 ký tự' });
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) return res.status(409).json({ error: 'Tên đã tồn tại' });
  const info = db.prepare(`INSERT INTO users(username,password_hash,created_at,last_login) VALUES (?,?,?,?)`).run(username, bcrypt.hashSync(password, 10), Date.now(), Date.now());
  const uid = info.lastInsertRowid;
  const ins = db.prepare('INSERT INTO plots(user_id,slot) VALUES (?,?)');
  db.transaction(() => { for (let i = 0; i < SLOTS; i++) ins.run(uid, i); })();
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  res.json({ token: sign(user), username: user.username, isAdmin: false });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username || '');
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) return res.status(401).json({ error: 'Sai tên hoặc mật khẩu' });
  if (user.is_banned) return res.status(403).json({ error: 'Tài khoản đã bị khoá' });
  db.prepare('UPDATE users SET last_login=? WHERE id=?').run(Date.now(), user.id);
  res.json({ token: sign(user), username: user.username, isAdmin: !!user.is_admin });
});

function adminOnly(req, res, next) {
  const payload = verify((req.headers.authorization || '').replace('Bearer ', ''));
  const user = payload && db.prepare('SELECT * FROM users WHERE id=?').get(payload.id);
  if (!user || !user.is_admin) return res.status(403).json({ error: 'Không có quyền' });
  req.admin = user; next();
}

app.get('/api/admin/stats', adminOnly, (req, res) => {
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  res.json({
    accounts: db.prepare('SELECT COUNT(*) c FROM users WHERE is_admin=0').get().c,
    online: online.size,
    newToday: db.prepare('SELECT COUNT(*) c FROM users WHERE created_at>=?').get(dayStart.getTime()).c,
    banned: db.prepare('SELECT COUNT(*) c FROM users WHERE is_banned=1').get().c,
    totalPlant: db.prepare("SELECT value v FROM stats WHERE key='total_plant'").get().v,
    totalHarvest: db.prepare("SELECT value v FROM stats WHERE key='total_harvest'").get().v
  });
});

app.get('/api/admin/users', adminOnly, (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 50, offset = (page - 1) * limit;
  const rows = db.prepare(`SELECT id,username,coins,is_admin,is_banned,created_at,last_login,total_harvested FROM users WHERE username LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?`).all(q, limit, offset);
  const total = db.prepare('SELECT COUNT(*) c FROM users WHERE username LIKE ?').get(q).c;
  
  // Tính Level dựa trên số cây đã thu hoạch (10 cây = 1 cấp)
  const rowsWithLevel = rows.map(r => ({
    ...r,
    level: Math.floor((r.total_harvested || 0) / 10) + 1,
    online: online.has(r.id)
  }));

  res.json({ total, page, limit, rows: rowsWithLevel });
});

app.post('/api/admin/users/:id/ban', adminOnly, (req, res) => {
  const id = +req.params.id;
  if (id === req.admin.id) return res.status(400).json({ error: 'Không tự khoá mình' });
  const banned = req.body.banned ? 1 : 0;
  db.prepare('UPDATE users SET is_banned=? WHERE id=?').run(banned, id);
  if (banned) {
    const sockets = online.get(id);
    if (sockets) sockets.forEach(sid => io.sockets.sockets.get(sid)?.disconnect(true));
  }
  res.json({ ok: true, banned: !!banned });
});

// ADMIN TẶNG XU (Cộng thêm tiền)
app.post('/api/admin/users/:id/addcoins', adminOnly, (req, res) => {
  const id = +req.params.id;
  const amount = parseInt(req.body.amount);
  if (isNaN(amount)) return res.status(400).json({ error: 'Số xu không hợp lệ' });

  db.prepare('UPDATE users SET coins = coins + ? WHERE id=?').run(amount, id);
  io.to(`u:${id}`).emit('state', getState(id));
  res.json({ ok: true });
});

// ADMIN SỬA XU (Ghi đè số tiền)
app.post('/api/admin/users/:id/setcoins', adminOnly, (req, res) => {
  const id = +req.params.id;
  const coins = parseInt(req.body.coins);
  if (isNaN(coins) || coins < 0) return res.status(400).json({ error: 'Số xu không hợp lệ' });

  db.prepare('UPDATE users SET coins = ? WHERE id=?').run(coins, id);
  io.to(`u:${id}`).emit('state', getState(id));
  res.json({ ok: true });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const online = new Map();

io.use((socket, next) => {
  const payload = verify(socket.handshake.auth?.token);
  if (!payload) return next(new Error('unauth'));
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(payload.id);
  if (!user) return next(new Error('unauth'));
  if (user.is_banned) return next(new Error('banned'));
  socket.data.userId = user.id;
  socket.data.isAdmin = !!user.is_admin;
  next();
});

io.on('connection', socket => {
  const uid = socket.data.userId;
  socket.join(`u:${uid}`);
  if (!online.has(uid)) online.set(uid, new Set());
  online.get(uid).add(socket.id);

  socket.emit('state', getState(uid));

  socket.on('plant', ({ slot, crop }) => {
    const cfg = CROPS[crop];
    if (!cfg || !Number.isInteger(slot) || slot < 0 || slot >= SLOTS) return;
    const u = db.prepare('SELECT coins FROM users WHERE id=?').get(uid);
    const p = db.prepare('SELECT crop FROM plots WHERE user_id=? AND slot=?').get(uid, slot);
    if (p && p.crop) return socket.emit('toast', 'Ô này đã có cây!');
    if (u.coins < cfg.cost) return socket.emit('toast', 'Không đủ xu!');
    const now = Date.now();
    db.transaction(() => {
      db.prepare('UPDATE users SET coins=coins-? WHERE id=?').run(cfg.cost, uid);
      db.prepare(`INSERT INTO plots(user_id,slot,crop,planted_at,ready_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id,slot) DO UPDATE SET crop=excluded.crop, planted_at=excluded.planted_at, ready_at=excluded.ready_at`).run(uid, slot, crop, now, now + cfg.grow);
      db.prepare("UPDATE stats SET value=value+1 WHERE key='total_plant'").run();
    })();
    io.to(`u:${uid}`).emit('state', getState(uid));
  });

  socket.on('harvest', ({ slot }) => {
    if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS) return;
    const p = db.prepare('SELECT * FROM plots WHERE user_id=? AND slot=?').get(uid, slot);
    if (!p || !p.crop) return;
    if (Date.now() < p.ready_at) return socket.emit('toast', 'Chưa chín!');
    const cfg = CROPS[p.crop];
    db.transaction(() => {
      // Cập nhật: Cộng xu + Tăng số cây đã thu hoạch (total_harvested)
      db.prepare('UPDATE users SET coins=coins+?, total_harvested=total_harvested+1 WHERE id=?').run(cfg.sell, uid);
      db.prepare('UPDATE plots SET crop=NULL,planted_at=NULL,ready_at=NULL WHERE user_id=? AND slot=?').run(uid, slot);
      db.prepare("UPDATE stats SET value=value+1 WHERE key='total_harvest'").run();
    })();
    io.to(`u:${uid}`).emit('state', getState(uid));
    socket.emit('toast', `Thu hoạch +${cfg.sell} xu`);
  });

  socket.on('disconnect', () => {
    const set = online.get(uid);
    if (set) { set.delete(socket.id); if (!set.size) online.delete(uid); }
  });
});

server.listen(PORT, () => console.log('Server chạy tại port ' + PORT));
