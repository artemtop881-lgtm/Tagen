const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ================== БАЗА ДАННЫХ (SQLite) ================== */
const db = new Database(path.join(__dirname, 'game.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  login TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  balance INTEGER DEFAULT 30,
  is_admin INTEGER DEFAULT 0,
  is_super_admin INTEGER DEFAULT 0,
  last_seen INTEGER DEFAULT 0,
  last_bonus INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS inventory (
  uid TEXT PRIMARY KEY,
  user_login TEXT NOT NULL,
  item_id TEXT, name TEXT, icon TEXT,
  rarity TEXT DEFAULT 'common',
  price INTEGER DEFAULT 0,
  status TEXT DEFAULT 'inventory',
  created_at INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS user_customization (
  user_login TEXT PRIMARY KEY,
  avatar TEXT DEFAULT '👤',
  frame TEXT DEFAULT 'none'
);
CREATE TABLE IF NOT EXISTS drop_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_login TEXT, item_name TEXT, item_icon TEXT,
  created_at INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS withdraw_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_login TEXT, item_id TEXT, item_name TEXT, item_price INTEGER,
  status TEXT DEFAULT 'pending', created_at INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS deposit_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_login TEXT, amount_stars INTEGER,
  status TEXT DEFAULT 'pending', created_at INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS promocodes (
  code TEXT PRIMARY KEY, stars INTEGER, max_uses INTEGER, uses INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS promo_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_login TEXT, code TEXT, created_at INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_login TEXT, action TEXT, details TEXT, created_at INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS admin_notes (
  user_login TEXT PRIMARY KEY, note TEXT, updated_at INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_login TEXT, message TEXT, created_at INTEGER DEFAULT 0
);
`);

/* ================== СОЗДАНИЕ АДМИНА ================== */
const adminExists = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_super_admin = 1').get();
if (!adminExists.c) {
  db.prepare(`INSERT INTO users (login, password, balance, is_admin, is_super_admin)
              VALUES (?, ?, ?, 1, 1)`).run('admin', 'admin123', 999999);
  db.prepare('INSERT OR IGNORE INTO user_customization (user_login) VALUES (?)').run('admin');
  console.log('👑 Создан главный админ — логин: admin  пароль: admin123');
  console.log('⚠️  Смените пароль после первого входа!');
}

/* ================== ХЕЛПЕРЫ ================== */
const now = () => Date.now();

function logAction(admin, action, details) {
  try {
    db.prepare('INSERT INTO admin_logs (admin_login, action, details, created_at) VALUES (?, ?, ?, ?)')
      .run(admin, action, String(details || ''), now());
  } catch (e) {}
}

function checkAdmin(login) {
  const u = db.prepare('SELECT is_admin, is_super_admin FROM users WHERE login = ?').get(login);
  return u || { is_admin: 0, is_super_admin: 0 };
}

function getBalance(login) {
  const u = db.prepare('SELECT balance FROM users WHERE login = ?').get(login);
  return u ? Number(u.balance) : null;
}

function addBalance(login, amount) {
  const cur = getBalance(login);
  if (cur === null) return { error: 'Пользователь не найден' };
  const nb = cur + Number(amount);
  db.prepare('UPDATE users SET balance = ? WHERE login = ?').run(nb, login);
  return { balance: nb };
}

function spendBalance(login, amount) {
  const cur = getBalance(login);
  if (cur === null) return { error: 'Пользователь не найден' };
  if (cur < Number(amount)) return { error: 'Недостаточно звёзд!' };
  const nb = cur - Number(amount);
  db.prepare('UPDATE users SET balance = ? WHERE login = ?').run(nb, login);
  return { balance: nb };
}

/* ================== КЕЙСЫ ================== */
const GAME_CASES = [
  { id:'starter', name:'Стартовый', icon:'📦', price:100, items:[
    {id:'heart',name:'Сердечко',icon:'💖',rarity:'common',price:15,chance:60},
    {id:'rose',name:'Роза',icon:'🌹',rarity:'common',price:25,chance:25},
    {id:'bear',name:'Мишка',icon:'🧸',rarity:'common',price:15,chance:10},
    {id:'skull',name:'Череп',icon:'💀',rarity:'rare',price:50,chance:4},
    {id:'cigarette',name:'Сигарета',icon:'🚬',rarity:'rare',price:500,chance:1}
  ]},
  { id:'pro', name:'Про', icon:'🎁', price:1000, items:[
    {id:'gift',name:'Подарок',icon:'🎁',rarity:'common',price:25,chance:60},
    {id:'cake',name:'Торт',icon:'🎂',rarity:'common',price:50,chance:20},
    {id:'bouquet',name:'Букет',icon:'💐',rarity:'common',price:50,chance:10},
    {id:'rocket',name:'Ракета',icon:'🚀',rarity:'common',price:50,chance:5},
    {id:'cigarette',name:'Сигарета',icon:'🚬',rarity:'rare',price:500,chance:4},
    {id:'socks',name:'Носки',icon:'🧦',rarity:'rare',price:1000,chance:0.9},
    {id:'music_box',name:'Шкатулка',icon:'🎵',rarity:'rare',price:1000,chance:0.1}
  ]},
  { id:'elite', name:'Элитный', icon:'💎', price:5000, items:[
    {id:'cup',name:'Кубок',icon:'🏆',rarity:'common',price:100,chance:50},
    {id:'ring',name:'Кольцо',icon:'💍',rarity:'common',price:100,chance:20},
    {id:'calendar',name:'Календарь',icon:'📅',rarity:'rare',price:1500,chance:20},
    {id:'potion',name:'Зелье',icon:'🧪',rarity:'rare',price:1000,chance:8},
    {id:'car',name:'Машина',icon:'🚗',rarity:'legendary',price:5000,chance:1.9},
    {id:'cap',name:'Кепка',icon:'🧢',rarity:'legendary',price:10000,chance:0.1}
  ]},
  { id:'premium', name:'Премиум', icon:'🔥', price:15000, items:[
    {id:'button',name:'Кнопка',icon:'🔘',rarity:'rare',price:500,chance:60},
    {id:'calendar',name:'Календарь',icon:'📅',rarity:'rare',price:1500,chance:20},
    {id:'car',name:'Машина',icon:'🚗',rarity:'legendary',price:5000,chance:15},
    {id:'cap',name:'Кепка',icon:'🧢',rarity:'legendary',price:10000,chance:4.9},
    {id:'pepe',name:'Плюш Пепе',icon:'🐸',rarity:'legendary',price:50000,chance:0.1}
  ]},
  { id:'legend', name:'Легенда', icon:'⚡', price:30000, items:[
    {id:'car',name:'Машина',icon:'🚗',rarity:'legendary',price:5000,chance:50},
    {id:'cap',name:'Кепка',icon:'🧢',rarity:'legendary',price:10000,chance:30},
    {id:'pepe',name:'Плюш Пепе',icon:'🐸',rarity:'legendary',price:50000,chance:18},
    {id:'golden_cup',name:'Золотой Кубок',icon:'🏆',rarity:'legendary',price:100000,chance:2}
  ]},
  { id:'mythic', name:'Мифический', icon:'🔮', price:50000, items:[
    {id:'calendar',name:'Календарь',icon:'📅',rarity:'rare',price:1500,chance:60},
    {id:'car',name:'Машина',icon:'🚗',rarity:'legendary',price:5000,chance:25},
    {id:'cap',name:'Кепка',icon:'🧢',rarity:'legendary',price:10000,chance:10},
    {id:'golden_cup',name:'Золотой Кубок',icon:'🏆',rarity:'legendary',price:100000,chance:4.9},
    {id:'dragon',name:'Дракон',icon:'🐉',rarity:'legendary',price:250000,chance:0.1}
  ]},
  { id:'exotic', name:'Экзотический', icon:'🌴', price:75000, items:[
    {id:'car',name:'Машина',icon:'🚗',rarity:'legendary',price:5000,chance:70},
    {id:'cap',name:'Кепка',icon:'🧢',rarity:'legendary',price:10000,chance:20},
    {id:'golden_cup',name:'Золотой Кубок',icon:'🏆',rarity:'legendary',price:100000,chance:9},
    {id:'dragon',name:'Дракон',icon:'🐉',rarity:'legendary',price:250000,chance:1}
  ]},
  { id:'royal', name:'Королевский', icon:'♔', price:100000, items:[
    {id:'cap',name:'Кепка',icon:'🧢',rarity:'legendary',price:10000,chance:65},
    {id:'golden_cup',name:'Золотой Кубок',icon:'🏆',rarity:'legendary',price:100000,chance:25},
    {id:'dragon',name:'Дракон',icon:'🐉',rarity:'legendary',price:250000,chance:9.9},
    {id:'crown',name:'Корона',icon:'👑',rarity:'legendary',price:500000,chance:0.1}
  ]},
  { id:'cosmic', name:'Космический', icon:'🌌', price:250000, items:[
    {id:'golden_cup',name:'Золотой Кубок',icon:'🏆',rarity:'legendary',price:100000,chance:80},
    {id:'dragon',name:'Дракон',icon:'🐉',rarity:'legendary',price:250000,chance:15},
    {id:'crown',name:'Корона',icon:'👑',rarity:'legendary',price:500000,chance:4.9},
    {id:'alien',name:'Пришелец',icon:'👽',rarity:'legendary',price:1000000,chance:0.1}
  ]},
  { id:'infinity', name:'Бесконечность', icon:'♾️', price:500000, items:[
    {id:'dragon',name:'Дракон',icon:'🐉',rarity:'legendary',price:250000,chance:75},
    {id:'crown',name:'Корона',icon:'👑',rarity:'legendary',price:500000,chance:20},
    {id:'alien',name:'Пришелец',icon:'👽',rarity:'legendary',price:1000000,chance:4.9},
    {id:'galaxy',name:'Галактика',icon:'🌌',rarity:'legendary',price:2000000,chance:0.1}
  ]},
  { id:'admin_secret', name:'👑 Кейс Владельца', icon:'👑', price:10, items:[
    {id:'pepe',name:'Плюш Пепе',icon:'🐸',rarity:'legendary',price:50000,chance:50},
    {id:'car',name:'Машина',icon:'🚗',rarity:'legendary',price:5000,chance:30},
    {id:'calendar',name:'Календарь',icon:'📅',rarity:'rare',price:1500,chance:20}
  ]}
];

/* ================== РЕГИСТРАЦИЯ / ВХОД ================== */
app.post('/api/register', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password || password.length < 6)
    return res.status(400).json({ error: 'Логин и пароль (мин. 6 символов)' });

  const existing = db.prepare('SELECT login FROM users WHERE login = ?').get(login);
  if (existing) return res.status(400).json({ error: 'Логин уже занят' });

  try {
    db.prepare('INSERT INTO users (login, password, balance, last_seen) VALUES (?, ?, 30, ?)')
      .run(login, password, now());
    db.prepare('INSERT OR IGNORE INTO user_customization (user_login) VALUES (?)').run(login);
    res.json({ success: true, user: { login, balance: 30 } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/login', (req, res) => {
  const { login, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE login = ? AND password = ?').get(login, password);
  if (!user) return res.status(400).json({ error: 'Неверный логин или пароль' });
  res.json({ success: true, user: { login: user.login, balance: user.balance } });
});

app.get('/api/online', (req, res) => {
  const fiveMinsAgo = Date.now() - 5 * 60000;
  const row = db.prepare('SELECT COUNT(*) as c FROM users WHERE last_seen >= ?').get(fiveMinsAgo);
  res.json({ online: Math.max(row.c, 1) });
});

app.get('/api/user/:login', (req, res) => {
  const { login } = req.params;
  const user = db.prepare('SELECT * FROM users WHERE login = ?').get(login);
  if (!user) return res.status(404).json({ error: 'Юзер не найден' });

  db.prepare('UPDATE users SET last_seen = ? WHERE login = ?').run(now(), login);

  const inventory = db.prepare('SELECT * FROM inventory WHERE user_login = ?').all(login) || [];
  const custom = db.prepare('SELECT * FROM user_customization WHERE user_login = ?').get(login);
  const totalItems = inventory.length;
  const totalValue = inventory.reduce((s, i) => s + (Number(i.price) || 0), 0);

  res.json({
    balance: Number(user.balance),
    inventory,
    is_admin: !!user.is_admin,
    is_super_admin: !!user.is_super_admin,
    stats: { totalItems, totalValue },
    avatar: custom ? custom.avatar : '👤',
    frame: custom ? custom.frame : 'none'
  });
});

/* ================== КЕЙСЫ ================== */
app.get('/api/cases', (req, res) => {
  const { login } = req.query;
  let cases = GAME_CASES.filter(c => c.id !== 'admin_secret');
  if (login) {
    const u = db.prepare('SELECT is_super_admin FROM users WHERE login = ?').get(login);
    if (u && u.is_super_admin) cases = GAME_CASES;
  }
  res.json(cases);
});

app.post('/api/cases/open', (req, res) => {
  const { login, caseId } = req.body;
  const box = GAME_CASES.find(c => c.id === caseId);
  if (!box) return res.status(400).json({ error: 'Кейс не найден' });

  if (caseId === 'admin_secret') {
    const u = db.prepare('SELECT is_super_admin FROM users WHERE login = ?').get(login);
    if (!u || !u.is_super_admin) return res.status(403).json({ error: 'Доступ запрещён' });
  }

  const spend = spendBalance(login, box.price);
  if (spend.error) return res.status(400).json({ error: spend.error });

  const totalChance = box.items.reduce((s, i) => s + Number(i.chance), 0);
  let roll = Math.random() * totalChance;
  let dropped = box.items[0];
  for (const it of box.items) {
    if (roll < Number(it.chance)) { dropped = it; break; }
    roll -= Number(it.chance);
  }

  const uid = now() + '_' + Math.random().toString(36).slice(2);
  db.prepare(`INSERT INTO inventory (uid, user_login, item_id, name, icon, rarity, price, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'inventory', ?)`)
    .run(uid, login, dropped.id, dropped.name, dropped.icon, dropped.rarity, dropped.price, now());
  db.prepare('INSERT INTO drop_history (user_login, item_name, item_icon, created_at) VALUES (?, ?, ?, ?)')
    .run(login, dropped.name, dropped.icon, now());

  res.json({ success: true, balance: spend.balance, item: { ...dropped, uid }, pool: box.items });
});

app.get('/api/cases/drops', (req, res) => {
  const data = db.prepare('SELECT * FROM drop_history ORDER BY created_at DESC LIMIT 15').all();
  res.json(data);
});

/* ================== ИНВЕНТАРЬ ================== */
app.post('/api/inventory/sell', (req, res) => {
  const { login, uid } = req.body;
  const item = db.prepare('SELECT * FROM inventory WHERE user_login = ? AND uid = ?').get(login, uid);
  if (!item) return res.status(410).json({ error: 'Уже продано' });

  db.prepare('DELETE FROM inventory WHERE uid = ?').run(uid);
  const price = Number(item.price) || 0;
  const r = addBalance(login, price);
  res.json({ success: true, balance: r.balance });
});

app.post('/api/inventory/sell-junk', (req, res) => {
  const { login } = req.body;
  const inv = db.prepare('SELECT * FROM inventory WHERE user_login = ?').all(login);
  if (!inv.length) return res.status(400).json({ error: 'Инвентарь пуст' });

  const junk = inv.filter(i => Number(i.price) <= 50);
  if (!junk.length) return res.status(400).json({ error: 'Нет мусора' });

  const total = junk.reduce((s, i) => s + Number(i.price), 0);
  const del = db.prepare('DELETE FROM inventory WHERE uid = ?');
  const tx = db.transaction((items) => { items.forEach(i => del.run(i.uid)); });
  tx(junk);

  addBalance(login, total);
  res.json({ success: true, earned: total, count: junk.length });
});

app.post('/api/inventory/sell-all', (req, res) => {
  const { login } = req.body;
  const inv = db.prepare('SELECT * FROM inventory WHERE user_login = ?').all(login);
  if (!inv.length) return res.status(400).json({ error: 'Инвентарь пуст' });

  const total = inv.reduce((s, i) => s + Number(i.price || 0), 0);
  db.prepare('DELETE FROM inventory WHERE user_login = ?').run(login);
  addBalance(login, total);
  res.json({ success: true, earned: total });
});

app.post('/api/inventory/withdraw', (req, res) => {
  const { login, uid } = req.body;
  const item = db.prepare('SELECT * FROM inventory WHERE user_login = ? AND uid = ?').get(login, uid);
  if (!item) return res.status(404).json({ error: 'Не найден' });

  db.prepare('DELETE FROM inventory WHERE uid = ?').run(uid);
  db.prepare(`INSERT INTO withdraw_requests (user_login, item_id, item_name, item_price, created_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run(login, item.item_id, item.name, item.price, now());
  res.json({ success: true });
});

/* ================== АПГРЕЙД ================== */
app.post('/api/upgrade', (req, res) => {
  const { login, myUid, targetItemId } = req.body;
  const myItem = db.prepare('SELECT * FROM inventory WHERE user_login = ? AND uid = ?').get(login, myUid);
  if (!myItem) return res.status(404).json({ error: 'Предмет не найден' });

  let target = null;
  for (const box of GAME_CASES) {
    target = box.items.find(i => i.id === targetItemId);
    if (target) break;
  }
  if (!target) return res.status(400).json({ error: 'Цель не найдена' });

  let chance = (Number(myItem.price) / Number(target.price)) * 50;
  if (chance > 50) chance = 50;
  if (chance < 1) chance = 1;

  db.prepare('DELETE FROM inventory WHERE uid = ?').run(myUid);
  const win = Math.random() * 100 < chance;

  if (win) {
    const uid = now() + '_' + Math.random().toString(36).slice(2);
    db.prepare(`INSERT INTO inventory (uid, user_login, item_id, name, icon, rarity, price, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'inventory', ?)`)
      .run(uid, login, target.id, target.name, target.icon, target.rarity, target.price, now());
    return res.json({ success: true, win: true, item: target, chance });
  }
  res.json({ success: true, win: false, item: myItem, chance });
});

/* ================== БАТЛ (заглушка) ================== */
app.post('/api/battle/create', (req, res) => {
  const { login, caseId } = req.body;
  const box = GAME_CASES.find(c => c.id === caseId);
  if (!box) return res.status(400).json({ error: 'Кейс не найден' });

  const spend = spendBalance(login, box.price);
  if (spend.error) return res.status(400).json({ error: spend.error });
  res.json({ success: true, message: 'Батл создан (ожидание соперника)' });
});

/* ================== БОНУС / ПРОМО / ДЕПОЗИТ ================== */
app.post('/api/bonus/claim', (req, res) => {
  const { login } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE login = ?').get(login);
  if (!user) return res.status(404).json({ error: 'Не найден' });

  if (user.last_bonus) {
    const hours = (now() - user.last_bonus) / 3600000;
    if (hours < 24) return res.status(400).json({ error: 'Через ' + Math.ceil(24 - hours) + ' ч.' });
  }

  const nb = Number(user.balance) + 50;
  db.prepare('UPDATE users SET balance = ?, last_bonus = ? WHERE login = ?').run(nb, now(), login);
  res.json({ success: true, balance: nb });
});

app.post('/api/promo/activate', (req, res) => {
  const { login, code } = req.body;
  const promo = db.prepare('SELECT * FROM promocodes WHERE code = ?').get(code.toUpperCase());
  if (!promo) return res.status(404).json({ error: 'Промокод не найден' });
  if (promo.uses >= promo.max_uses) return res.status(400).json({ error: 'Лимит исчерпан' });

  const used = db.prepare('SELECT id FROM promo_history WHERE user_login = ? AND code = ?').get(login, code.toUpperCase());
  if (used) return res.status(400).json({ error: 'Вы уже активировали' });

  addBalance(login, promo.stars);
  db.prepare('INSERT INTO promo_history (user_login, code, created_at) VALUES (?, ?, ?)').run(login, code.toUpperCase(), now());
  db.prepare('UPDATE promocodes SET uses = uses + 1 WHERE code = ?').run(code.toUpperCase());
  res.json({ success: true, stars: promo.stars });
});

app.post('/api/deposit/request', (req, res) => {
  const { login, amount } = req.body;
  if (!login || !amount || Number(amount) <= 0) return res.status(400).json({ error: 'Введите сумму' });
  db.prepare('INSERT INTO deposit_requests (user_login, amount_stars, created_at) VALUES (?, ?, ?)')
    .run(login, Number(amount), now());
  res.json({ success: true });
});

/* ================== КАСТОМИЗАЦИЯ ================== */
app.post('/api/customization/buy', (req, res) => {
  const { login, type, item } = req.body;
  if (!['avatar', 'frame'].includes(type)) return res.status(400).json({ error: 'Неверный тип' });

  const price = type === 'avatar' ? 500 : 1000;
  const spend = spendBalance(login, price);
  if (spend.error) return res.status(400).json({ error: spend.error });

  const field = type === 'avatar' ? 'avatar' : 'frame';
  const exists = db.prepare('SELECT user_login FROM user_customization WHERE user_login = ?').get(login);
  if (exists) {
    db.prepare(`UPDATE user_customization SET ${field} = ? WHERE user_login = ?`).run(item, login);
  } else {
    db.prepare(`INSERT INTO user_customization (user_login, ${field}) VALUES (?, ?)`).run(login, item);
  }
  res.json({ success: true });
});

/* ================== АДМИНКА ================== */
app.get('/api/admin/players', (req, res) => {
  const users = db.prepare('SELECT login, balance, is_admin, is_super_admin FROM users').all();
  const inv = db.prepare('SELECT user_login FROM inventory').all();
  const players = users.map(u => ({
    ...u,
    nft_count: inv.filter(i => i.user_login === u.login).length
  }));
  res.json(players);
});

app.get('/api/admin/withdraws', (req, res) => {
  res.json(db.prepare("SELECT * FROM withdraw_requests WHERE status = 'pending'").all());
});

app.get('/api/admin/deposits', (req, res) => {
  res.json(db.prepare("SELECT * FROM deposit_requests WHERE status = 'pending'").all());
});

app.get('/api/admin/logs', (req, res) => {
  res.json(db.prepare('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 50').all());
});

app.post('/api/admin/deposit/accept', (req, res) => {
  const { adminLogin, id } = req.body;
  if (!checkAdmin(adminLogin).is_super_admin) return res.status(403).json({ error: 'Только главный админ' });

  const dep = db.prepare('SELECT * FROM deposit_requests WHERE id = ?').get(id);
  if (!dep) return res.status(404).json({ error: 'Не найдено' });

  addBalance(dep.user_login, dep.amount_stars);
  db.prepare("UPDATE deposit_requests SET status = 'accepted' WHERE id = ?").run(id);
  logAction(adminLogin, 'deposit_accept', `${dep.user_login} +${dep.amount_stars}`);
  res.json({ success: true });
});

app.post('/api/admin/withdraws/accept', (req, res) => {
  const { adminLogin, id } = req.body;
  if (!checkAdmin(adminLogin).is_super_admin) return res.status(403).json({ error: 'Только главный админ' });

  const w = db.prepare('SELECT * FROM withdraw_requests WHERE id = ?').get(id);
  if (!w) return res.status(404).json({ error: 'Нет заявки' });

  addBalance(w.user_login, w.item_price);
  db.prepare('DELETE FROM withdraw_requests WHERE id = ?').run(id);
  logAction(adminLogin, 'withdraw_accept', `${w.user_login} ${w.item_name}`);
  res.json({ success: true });
});

app.post('/api/admin/give-stars', (req, res) => {
  const { adminLogin, targetLogin, amount } = req.body;
  if (!checkAdmin(adminLogin).is_admin) return res.status(403).json({ error: 'Нет доступа' });

  const r = addBalance(targetLogin, amount);
  if (r.error) return res.status(404).json({ error: r.error });
  logAction(adminLogin, 'give_stars', `${targetLogin} +${amount}`);
  res.json({ success: true });
});

app.post('/api/admin/take-stars', (req, res) => {
  const { adminLogin, targetLogin, amount } = req.body;
  if (!checkAdmin(adminLogin).is_super_admin) return res.status(403).json({ error: 'Только главный админ' });

  addBalance(targetLogin, -Math.abs(Number(amount)));
  logAction(adminLogin, 'take_stars', `${targetLogin} -${amount}`);
  res.json({ success: true });
});

app.post('/api/admin/give-nft', (req, res) => {
  const { adminLogin, targetLogin, item } = req.body;
  if (!checkAdmin(adminLogin).is_admin) return res.status(403).json({ error: 'Нет доступа' });

  const uid = now() + '_' + Math.random().toString(36).slice(2);
  db.prepare(`INSERT INTO inventory (uid, user_login, item_id, name, icon, rarity, price, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'inventory', ?)`)
    .run(uid, targetLogin, item.id, item.name, item.icon || '🎁', item.rarity || 'common', Number(item.price) || 0, now());
  logAction(adminLogin, 'give_nft', `${targetLogin} → ${item.name}`);
  res.json({ success: true });
});

app.post('/api/admin/create-promo', (req, res) => {
  const { adminLogin, code, stars, limit } = req.body;
  if (!checkAdmin(adminLogin).is_super_admin) return res.status(403).json({ error: 'Только главный админ' });
  if (!code || !stars || !limit) return res.status(400).json({ error: 'Заполните поля' });

  const up = code.toUpperCase();
  const ex = db.prepare('SELECT code FROM promocodes WHERE code = ?').get(up);
  if (ex) return res.status(400).json({ error: 'Код уже есть' });

  db.prepare('INSERT INTO promocodes (code, stars, max_uses, uses) VALUES (?, ?, ?, 0)')
    .run(up, Number(stars), Number(limit));
  logAction(adminLogin, 'create_promo', up);
  res.json({ success: true });
});

app.post('/api/admin/make-admin', (req, res) => {
  const { adminLogin, targetLogin } = req.body;
  if (!checkAdmin(adminLogin).is_super_admin) return res.status(403).json({ error: 'Только главный админ' });

  db.prepare('UPDATE users SET is_admin = 1 WHERE login = ?').run(targetLogin);
  logAction(adminLogin, 'make_admin', targetLogin);
  res.json({ success: true });
});

app.post('/api/admin/remove-admin', (req, res) => {
  const { adminLogin, targetLogin } = req.body;
  if (!checkAdmin(adminLogin).is_super_admin) return res.status(403).json({ error: 'Только главный админ' });

  db.prepare('UPDATE users SET is_admin = 0 WHERE login = ?').run(targetLogin);
  logAction(adminLogin, 'remove_admin', targetLogin);
  res.json({ success: true });
});

app.get('/api/admin/note/:login', (req, res) => {
  const note = db.prepare('SELECT note FROM admin_notes WHERE user_login = ?').get(req.params.login);
  res.json({ note: note ? note.note : '' });
});

app.post('/api/admin/note', (req, res) => {
  const { adminLogin, targetLogin, note } = req.body;
  if (!checkAdmin(adminLogin).is_admin) return res.status(403).json({ error: 'Нет доступа' });

  const ex = db.prepare('SELECT user_login FROM admin_notes WHERE user_login = ?').get(targetLogin);
  if (ex) {
    db.prepare('UPDATE admin_notes SET note = ?, updated_at = ? WHERE user_login = ?').run(note, now(), targetLogin);
  } else {
    db.prepare('INSERT INTO admin_notes (user_login, note, updated_at) VALUES (?, ?, ?)').run(targetLogin, note, now());
  }
  logAction(adminLogin, 'note', `${targetLogin}: ${note}`);
  res.json({ success: true });
});

app.post('/api/admin/broadcast', (req, res) => {
  const { adminLogin, message } = req.body;
  if (!checkAdmin(adminLogin).is_super_admin) return res.status(403).json({ error: 'Только главный админ' });
  if (!message) return res.status(400).json({ error: 'Пусто' });

  db.prepare('INSERT INTO broadcasts (admin_login, message, created_at) VALUES (?, ?, ?)')
    .run(adminLogin, message, now());
  logAction(adminLogin, 'broadcast', message);
  res.json({ success: true });
});

/* ================== ФРОНТЕНД ================== */
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });

  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.type('html').send(`
      <html><head><meta charset="utf-8"><title>Положите index.html</title></head>
      <body style="background:#0a0a12;color:#fff;font-family:sans-serif;padding:40px;text-align:center">
        <h1>📁 Положите index.html в папку <code style="color:#a855f7">public/</code></h1>
        <p style="color:#888">Скопируйте ваш HTML-файл в папку <b>public</b> рядом с server.js и перезагрузите страницу.</p>
      </body></html>
    `);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
  console.log(`📁 База данных: ${path.join(__dirname, 'game.db')}`);
});