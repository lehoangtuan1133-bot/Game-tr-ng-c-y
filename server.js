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
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, is_admin INTEGER DEFAULT 0, is_banned INTEGER DEFAULT 0, coins INTEGER DEFAULT 50, water INTEGER DEFAULT 5, fertilizer INTEGER DEFAULT 0, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 1, plot_count INTEGER DEFAULT 1, created_at INTEGER NOT NULL, last_login INTEGER);
CREATE TABLE IF NOT EXISTS plots (user_id INTEGER NOT NULL, slot INTEGER NOT NULL, crop TEXT, planted_at INTEGER, ready_at INTEGER, bonus INTEGER DEFAULT 0, PRIMARY KEY (user_id, slot));
`);

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
if (!db.prepare('SELECT 1 FROM users WHERE username=?').get(ADMIN_USER)) {
  db.prepare(`INSERT INTO users(username,password_hash,is_admin,created_at) VALUES (?,?,1,?)`).run(ADMIN_USER, bcrypt.hashSync(ADMIN_PASS, 10), Date.now());
}

// Toàn bộ 100 loại cây (Server cần biết để chống hack)
const CROPS = {
  carrot:{time:8000,price:3,sell:7}, potato:{time:9000,price:4,sell:9}, corn:{time:10000,price:5,sell:11}, tomato:{time:11000,price:6,sell:13}, cabbage:{time:12000,price:6,sell:14}, cucumber:{time:10000,price:5,sell:12}, eggplant:{time:13000,price:7,sell:16}, pepper:{time:12000,price:7,sell:15}, onion:{time:11000,price:6,sell:13}, garlic:{time:10000,price:5,sell:12}, broccoli:{time:13000,price:8,sell:17}, mushroom:{time:9000,price:4,sell:10}, peanut:{time:11000,price:6,sell:13}, rice:{time:12000,price:6,sell:14}, wheat:{time:11000,price:5,sell:12}, lettuce:{time:10000,price:5,sell:11}, radish:{time:9000,price:4,sell:9}, pumpkin:{time:14000,price:8,sell:18}, melon:{time:13000,price:7,sell:16}, banana:{time:12000,price:6,sell:14},
  strawberry:{time:18000,price:10,sell:25}, grape:{time:20000,price:12,sell:28}, apple:{time:22000,price:14,sell:32}, orange:{time:21000,price:13,sell:30}, lemon:{time:19000,price:11,sell:26}, pear:{time:20000,price:12,sell:28}, peach:{time:21000,price:13,sell:30}, cherry:{time:19000,price:11,sell:26}, pineapple:{time:23000,price:15,sell:34}, watermelon:{time:24000,price:16,sell:36}, kiwi:{time:22000,price:14,sell:32}, coconut:{time:23000,price:15,sell:34}, avocado:{time:20000,price:12,sell:28}, mango:{time:22000,price:14,sell:32}, blueberry:{time:21000,price:13,sell:30}, olives:{time:20000,price:12,sell:28}, sweetpotato:{time:19000,price:11,sell:26}, chili:{time:18000,price:10,sell:24}, bean:{time:20000,price:12,sell:28}, chestnut:{time:21000,price:13,sell:30},
  diamond:{time:40000,price:50,sell:150}, rose:{time:35000,price:40,sell:120}, tulip:{time:34000,price:38,sell:115}, sunflower:{time:36000,price:42,sell:125}, hibiscus:{time:37000,price:44,sell:130}, cherryblossom:{time:38000,price:46,sell:135}, lotus:{time:39000,price:48,sell:140}, cactus:{time:42000,price:52,sell:155}, palm:{time:41000,price:50,sell:150}, evergreen:{time:40000,price:48,sell:145}, leaf:{time:33000,price:36,sell:110}, maple:{time:37000,price:44,sell:130}, clover:{time:35000,price:40,sell:120}, herb:{time:34000,price:38,sell:115}, bamboo:{time:39000,price:46,sell:140}, pine:{time:38000,price:45,sell:135}, shell:{time:36000,price:42,sell:125}, coral:{time:41000,price:50,sell:150}, moonflower:{time:43000,price:54,sell:160}, starflower:{time:44000,price:56,sell:165},
  crystal:{time:60000,price:100,sell:320}, rainbow:{time:65000,price:120,sell:380}, comet:{time:70000,price:140,sell:440}, meteor:{time:72000,price:150,sell:470}, planet:{time:75000,price:160,sell:500}, galaxy:{time:80000,price:180,sell:560}, sun:{time:78000,price:170,sell:530}, moon:{time:76000,price:165,sell:515}, star:{time:74000,price:155,sell:485}, lightning:{time:68000,price:135,sell:420}, fire:{time:66000,price:125,sell:390}, ice:{time:67000,price:130,sell:405}, tornado:{time:71000,price:145,sell:455}, volcano:{time:73000,price:152,sell:478}, ocean:{time:69000,price:138,sell:432}, earth:{time:77000,price:168,sell:522}, aurora:{time:79000,price:175,sell:545}, crystalball:{time:62000,price:110,sell:350}, magicwand:{time:63000,price:115,sell:365}, hourglass:{time:64000,price:118,sell:372},
  dragon:{time:120000,price:300,sell:1100}, phoenix:{time:125000,price:320,sell:1180}, unicorn:{time:118000,price:290,sell:1060}, mermaid:{time:115000,price:280,sell:1020}, fairy:{time:112000,price:270,sell:980}, genie:{time:116000,price:285,sell:1030}, angel:{time:122000,price:310,sell:1120}, demon:{time:123000,price:315,sell:1130}, ghost:{time:110000,price:265,sell:950}, alien:{time:114000,price:278,sell:1000}, robot:{time:117000,price:288,sell:1040}, crown:{time:126000,price:330,sell:1200}, sword:{time:124000,price:322,sell:1160}, shield:{time:121000,price:305,sell:1100}, orb:{time:119000,price:295,sell:1070}, key:{time:113000,price:272,sell:990}, potion:{time:111000,price:268,sell:970}, scroll:{time:108000,price:258,sell:930}, book:{time:109000,price:262,sell:940}, map:{time:107000,price:255,sell:920}
};

const LUCK_TABLE = [{chance:0.03,mult:2},{chance:0.13,mult:1.5},{chance:0.33,mult:1.2}];
const XP_PER_LEVEL = 100;
const PLOT_UNLOCK_XP = 50;
const WATER_BOOST = 5000;
const FERT_BOOST = 10000;
const FERT_COST = 15;

const sign = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: '30d' });
const verify = t => { try { return jwt.verify(t, SECRET); } catch { return null; } };

function getState(userId) {
  const u = db.prepare('SELECT coins, water, fertilizer, xp, level, plot_count FROM users WHERE id=?').get(userId);
  const p = db.prepare('SELECT * FROM plots WHERE user_id=?').all(userId);
  
  // Khởi tạo mảng đất trống dựa trên số đất đã mua
  const plots = Array(u.plot_count).fill(null);
  p.forEach(row => {
    if(row.slot < u.plot_count) {
      plots[row.slot] = { key: row.crop, start: row.planted_at, time: CROPS[row.crop].time, sell: CROPS[row.crop].sell, bonus: row.bonus, ready: Date.now() >= row.ready_at };
    }
  });
  return { coins: u.coins, water: u.water, fertilizer: u.fertilizer, xp: u.xp, level: u.level, plot_count: u.plot_count, plots };
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || username.length < 3 || password.length < 4) return res.status(400).json({ error: 'Tên ≥3 ký tự, MK ≥4 ký tự' });
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) return res.status(409).json({ error: 'Tên đã tồn tại' });
  const info = db.prepare(`INSERT INTO users(username,password_hash,created_at,last_login) VALUES (?,?,?,?)`).run(username, bcrypt.hashSync(password, 10), Date.now(), Date.now());
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
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
  res.json({
    accounts: db.prepare('SELECT COUNT(*) c FROM users WHERE is_admin=0').get().c,
    online: online.size,
    banned: db.prepare('SELECT COUNT(*) c FROM users WHERE is_banned=1').get().c
  });
});

app.get('/api/admin/users', adminOnly, (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  const rows = db.prepare(`SELECT id,username,coins,water,xp,level,is_admin,is_banned FROM users WHERE username LIKE ? ORDER BY id DESC`).all(q);
  res.json({ rows: rows.map(r => ({ ...r, online: online.has(r.id) })) });
});

app.post('/api/admin/users/:id/ban', adminOnly, (req, res) => {
  const id = +req.params.id; const banned = req.body.banned ? 1 : 0;
  db.prepare('UPDATE users SET is_banned=? WHERE id=?').run(banned, id);
  if (banned) { const s = online.get(id); if (s) s.forEach(sid => io.sockets.sockets.get(sid)?.disconnect(true)); }
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/setcoins', adminOnly, (req, res) => {
  const id = +req.params.id; const coins = parseInt(req.body.coins);
  db.prepare('UPDATE users SET coins=? WHERE id=?').run(coins, id);
  io.to(`u:${id}`).emit('state', getState(id)); res.json({ ok: true });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const online = new Map();

io.use((socket, next) => {
  const payload = verify(socket.handshake.auth?.token);
  if (!payload) return next(new Error('unauth'));
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(payload.id);
  if (!user || user.is_banned) return next(new Error('banned'));
  socket.data.userId = user.id; next();
});

io.on('connection', socket => {
  const uid = socket.data.userId;
  socket.join(`u:${uid}`);
  if (!online.has(uid)) online.set(uid, new Set());
  online.get(uid).add(socket.id);
  socket.emit('state', getState(uid));

  socket.on('plant', ({ slot, crop }) => {
    const cfg = CROPS[crop];
    if (!cfg) return;
    const u = db.prepare('SELECT coins, plot_count FROM users WHERE id=?').get(uid);
    if (slot >= u.plot_count) return;
    if (u.coins < cfg.price) return socket.emit('toast', 'Không đủ xu!', 'error');
    
    const now = Date.now();
    db.transaction(() => {
      db.prepare('UPDATE users SET coins = coins - ? WHERE id=?').run(cfg.price, uid);
      db.prepare(`INSERT INTO plots(user_id,slot,crop,planted_at,ready_at,bonus) VALUES (?,?,?,?,?,0) ON CONFLICT(user_id,slot) DO UPDATE SET crop=excluded.crop, planted_at=excluded.planted_at, ready_at=excluded.ready_at, bonus=0`).run(uid, slot, crop, now, now + cfg.time);
    })();
    io.to(`u:${uid}`).emit('state', getState(uid));
  });

  socket.on('care', ({ slot, type }) => {
    const p = db.prepare('SELECT * FROM plots WHERE user_id=? AND slot=?').get(uid, slot);
    if (!p || !p.crop) return;
    const u = db.prepare('SELECT coins, water, fertilizer FROM users WHERE id=?').get(uid);
    const boost = type === 'water' ? WATER_BOOST : FERT_BOOST;

    if (type === 'water') {
      if (u.water <= 0) return socket.emit('toast', 'Hết nước!', 'error');
      db.prepare('UPDATE users SET water = water - 1 WHERE id=?').run(uid);
    } else {
      if (u.fertilizer > 0) db.prepare('UPDATE users SET fertilizer = fertilizer - 1 WHERE id=?').run(uid);
      else if (u.coins >= FERT_COST) db.prepare('UPDATE users SET coins = coins - ? WHERE id=?').run(FERT_COST, uid);
      else return socket.emit('toast', 'Không đủ xu mua phân!', 'error');
    }

    db.prepare('UPDATE plots SET ready_at = ready_at - ?, bonus = bonus + ? WHERE user_id=? AND slot=?').run(boost, boost, uid, slot);
    io.to(`u:${uid}`).emit('state', getState(uid));
    socket.emit('toast', type === 'water' ? '💧 Đã tưới nước (-5s)' : '💩 Đã bón phân (-10s)', 'success');
  });

  socket.on('harvest', ({ slot }) => {
    const p = db.prepare('SELECT * FROM plots WHERE user_id=? AND slot=?').get(uid, slot);
    if (!p || !p.crop || Date.now() < p.ready_at) return;
    
    const cfg = CROPS[p.crop];
    let luckMult = 1, luckLabel = "x1";
    const r = Math.random(); let acc = 0;
    for (const row of LUCK_TABLE) { acc += row.chance; if (r < acc) { luckMult = row.mult; luckLabel = `x${row.mult}`; break; } }

    const reward = Math.floor(cfg.sell * luckMult);
    const xpGain = 10;
    
    db.transaction(() => {
      db.prepare('UPDATE users SET coins = coins + ?, xp = xp + ? WHERE id=?').run(reward, xpGain, uid);
      db.prepare('DELETE FROM plots WHERE user_id=? AND slot=?').run(uid, slot);
    })();

    const u = db.prepare('SELECT xp, level, plot_count FROM users WHERE id=?').get(uid);
    const newLevel = 1 + Math.floor(u.xp / XP_PER_LEVEL);
    let newPlotCount = u.plot_count;
    if (u.xp >= PLOT_UNLOCK_XP && u.plot_count === 1) newPlotCount = 4;

    if (newLevel > u.level || newPlotCount > u.plot_count) {
      db.prepare('UPDATE users SET level=?, plot_count=? WHERE id=?').run(newLevel, newPlotCount, uid);
      if (newLevel > u.level) socket.emit('toast', `⭐ LÊN CẤP ${newLevel}!`, 'success');
      if (newPlotCount > u.plot_count) socket.emit('toast', `🎉 Mở khoá thêm ô đất!`, 'success');
    }

    io.to(`u:${uid}`).emit('state', getState(uid));
    socket.emit('harvestResult', { reward, luckLabel, xpGain });
  });

  socket.on('buyWater', () => {
    const u = db.prepare('SELECT coins FROM users WHERE id=?').get(uid);
    if (u.coins < 10) return socket.emit('toast', 'Không đủ xu!', 'error');
    db.prepare('UPDATE users SET coins = coins - 10, water = water + 5 WHERE id=?').run(uid);
    io.to(`u:${uid}`).emit('state', getState(uid));
    socket.emit('toast', 'Đã mua 5 nước!', 'success');
  });

  socket.on('buyPlot', () => {
    const u = db.prepare('SELECT coins, xp, plot_count FROM users WHERE id=?').get(uid);
    if (u.xp < 1000) return socket.emit('toast', 'Cần 1000 EXP!', 'error');
    if (u.coins < 100) return socket.emit('toast', 'Không đủ xu!', 'error');
    db.prepare('UPDATE users SET coins = coins - 100, plot_count = plot_count + 1 WHERE id=?').run(uid);
    io.to(`u:${uid}`).emit('state', getState(uid));
    socket.emit('toast', '🏡 Đã mở thêm 1 ô đất!', 'success');
  });

  socket.on('disconnect', () => {
    const set = online.get(uid); if (set) { set.delete(socket.id); if (!set.size) online.delete(uid); }
  });
});

server.listen(PORT, () => console.log('Server chạy tại port ' + PORT));
