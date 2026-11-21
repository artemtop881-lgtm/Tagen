const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ================== ХРАНИЛИЩЕ (JSON) ================== */
const DB_FILE = path.join(__dirname, 'database.json');

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    return {
      users: [],
      inventory: [],
      user_customization: [],
      drop_history: [],
      withdraw_requests: [],
      deposit_requests: [],
      promocodes: [],
      promo_history: [],
      admin_logs: [],
      admin_notes: [],
      broadcasts: []
    };
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return { users: [], inventory: [], user_customization: [], drop_history: [], withdraw_requests: [], deposit_requests: [], promocodes: [], promo_history: [], admin_logs: [], admin_notes: [], broadcasts: [] };
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// Инициализация админа при первом запуске
let db = loadDB();
if (!db.users.find(u => u.is_super_admin)) {
  db.users.push({
    login: 'admin',
    password: 'admin123',
    balance: 999999,
    is_admin: true,
    is_super_admin: true,
    last_seen: Date.now(),
    last_bonus: null
  });
  db.user_customization.push({ user_login: 'admin', avatar: '👤', frame: 'none' });
  saveDB(db);
  console.log('👑 Создан админ: admin / admin123');
}

const now = () => Date.now();

function logAction(admin, action, details) {
  db = loadDB();
  db.admin_logs.push({ admin_login: admin, action, details: String(details || ''), created_at: now() });
  saveDB(db);
}

function checkAdmin(login) {
  db = loadDB();
  const u = db.users.find(u => u.login === login);
  return u || { is_admin: false, is_super_admin: false };
}

function getBalance(login) {
  db = loadDB();
  const u = db.users.find(u => u.login === login);
  return u ? Number(u.balance) : null;
}

function addBalance(login, amount) {
  db = loadDB();
  const u = db.users.find(u => u.login === login);
  if (!u) return { error: 'Пользователь не найден' };
  u.balance = Number(u.balance) + Number(amount);
  saveDB(db);
  return { balance: u.balance };
}

function spendBalance(login, amount) {
  db = loadDB();
  const u = db.users.find(u => u.login === login);
  if (!u) return { error: 'Пользователь не найден' };
  if (Number(u.balance) < Number(amount)) return { error: 'Недостаточно звёзд!' };
  u.balance = Number(u.balance) - Number(amount);
  saveDB(db);
  return { balance: u.balance };
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

  db = loadDB();
  if (db.users.find(u => u.login === login)) return res.status(400).json({ error: 'Логин уже занят' });

  db.users.push({ login, password, balance: 30, is_admin: false, is_super_admin: false, last_seen: now(), last_bonus: null });
  db.user_customization.push({ user_login: login, avatar: '👤', frame: 'none' });
  saveDB(db);

  res.json({ success: true, user: { login, balance: 30 } });
});

app.post('/api/login', (req, res) => {
  const { login, password } = req.body;
  db = loadDB();
  const user = db.users.find(u => u.login === login && u.password === password);
  if (!user) return res.status(400).json({ error: 'Неверный логин или пароль' });
  res.json({ success: true, user: { login: user.login, balance: user.balance } });
});

app.get('/api/online', (req, res) => {
  db = loadDB();
  const fiveMinAgo = now() - 5 * 60000;
  const online = db.users.filter(u => u.last_seen >= fiveMinAgo).length;
  res.json({ online: Math.max(online, 1) });
});

app.get('/api/user/:login', (req, res) => {
  const { login } = req.params;
  db = loadDB();
  const user = db.users.find(u => u.login === login);
  if (!user) return res.status(404).json({ error: 'Юзер не найден' });

  user.last_seen = now();
  saveDB(db);

  const inventory = db.inventory.filter(i => i.user_login === login);
  const custom = db.user_customization.find(c => c.user_login === login);
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
    db = loadDB();
    const u = db.users.find(u => u.login === login);
    if (u && u.is_super_admin) cases = GAME_CASES;
  }
  res.json(cases);
});

app.post('/api/cases/open', (req, res) => {
  const { login, caseId } = req.body;
  const box = GAME_CASES.find(c => c.id === caseId);
  if (!box) return res.status(400).json({ error: 'Кейс не найден' });

  db = loadDB();
  const user = db.users.find(u => u.login === login);
  if (!user) return res.status(404).json({ error: 'Юзер не найден' });

  if (caseId === 'admin_secret' && !user.is_super_admin) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  if (Number(user.balance) < box.price) return res.status(400).json({ error: 'Недостаточно звёзд!' });
  user.balance -= box.price;

  const totalChance = box.items.reduce((s, i) => s + Number(i.chance), 0);
  let roll = Math.random() * totalChance;
  let dropped = box.items[0];
  for (const it of box.items) {
    if (roll < Number(it.chance)) { dropped = it; break; }
    roll -= Number(it.chance);
  }

  const uid = now() + '_' + Math.random().toString(36).slice(2);
  const newItem = {
    uid, user_login: login, item_id: dropped.id, name: dropped.name,
    icon: dropped.icon, rarity: dropped.rarity, price: dropped.price, status: 'inventory', created_at: now()
  };
  db.inventory.push(newItem);
  db.drop_history.push({ user_login: login, item_name: dropped.name, item_icon: dropped.icon, created_at: now() });
  saveDB(db);

  res.json({ success: true, balance: user.balance, item: { ...dropped, uid }, pool: box.items });
});

app.get('/api/cases/drops', (req, res) => {
  db = loadDB();
  const drops = db.drop_history.slice(-15).reverse();
  res.json(drops);
});

/* ================== ИНВЕНТАРЬ ================== */
app.post('/api/inventory/sell', (req, res) => {
  const { login, uid } = req.body;
  db = loadDB();
  const idx = db.inventory.findIndex(i => i.user_login === login && i.uid === uid);
  if (idx === -1) return res.status(410).json({ error: 'Уже продано' });

  const item = db.inventory[idx];
  db.inventory.splice(idx, 1);
  const user = db.users.find(u => u.login === login);
  user.balance = Number(user.balance) + Number(item.price);
  saveDB(db);

  res.json({ success: true, balance: user.balance });
});

app.post('/api/inventory/sell-junk', (req, res) => {
  const { login } = req.body;
  db = loadDB();
  const inv = db.inventory.filter(i => i.user_login === login);
  if (!inv.length) return res.status(400).json({ error: 'Инвентарь пуст' });

  const junk = inv.filter(i => Number(i.price) <= 50);
  if (!junk.length) return res.status(400).json({ error: 'Нет мусора' });

  const total = junk.reduce((s, i) => s + Number(i.price), 0);
  const junkUids = junk.map(i => i.uid);
  db.inventory = db.inventory.filter(i => !junkUids.includes(i.uid));
  const user = db.users.find(u => u.login === login);
  user.balance = Number(user.balance) + total;
  saveDB(db);

  res.json({ success: true, earned: total, count: junk.length });
});

app.post('/api/inventory/sell-all', (req, res) => {
  const { login } = req.body;
  db = loadDB();
  const inv = db.inventory.filter(i => i.user_login === login);
  if (!inv.length) return res.status(400).json({ error: 'Инвентарь пуст' });

  const total = inv.reduce((s, i) => s + Number(i.price || 0), 0);
  db.inventory = db.inventory.filter(i => i.user_login !== login);
  const user = db.users.find(u => u.login === login);
  user.balance = Number(user.balance) + total;
  saveDB(db);

  res.json({ success: true, earned: total });
});

app.post('/api/inventory/withdraw', (req, res) => {
  const { login, uid } = req.body;
  db = loadDB();
  const idx = db.inventory.findIndex(i => i.user_login === login && i.uid === uid);
  if (idx === -1) return res.status(404).json({ error: 'Не найден' });

  const item = db.inventory[idx];
  db.inventory.splice(idx, 1);
  db.withdraw_requests.push({
    user_login: login, item_id: item.item_id, item_name: item.name, item_price: item.price,
    status: 'pending', created_at: now()
  });
  saveDB(db);

  res.json({ success: true });
});

/* ================== АПГРЕЙД ================== */
app.post('/api/upgrade', (req, res) => {
  const { login, myUid, targetItemId } = req.body;
  db = loadDB();
  const myIdx = db.inventory.findIndex(i => i.user_login === login && i.uid === myUid);
  if (myIdx === -1) return res.status(404).json({ error: 'Предмет не найден' });

  let target = null;
  for (const box of GAME_CASES) { target = box.items.find(i => i.id === targetItemId); if (target) break; }
  if (!target) return res.status(400).json({ error: 'Цель не найдена' });

  const myItem = db.inventory[myIdx];
  let chance = (Number(myItem.price) / Number(target.price)) * 50;
  if (chance > 50) chance = 50;
  if (chance < 1) chance = 1;

  db.inventory.splice(myIdx, 1);
  const win = Math.random() * 100 < chance;

  if (win) {
    const uid = now() + '_' + Math.random().toString(36).slice(2);
    db.inventory.push({
      uid, user_login: login, item_id: target.id, name: target.name,
      icon: target.icon, rarity: target.rarity, price: target.price, status: 'inventory', created_at: now()
    });
    saveDB(db);
    return res.json({ success: true, win: true, item: target, chance });
  }
  saveDB(db);
  res.json({ success: true, win: false, item: myItem, chance });
});

/* ================== БАТЛ (заглушка) ================== */
app.post('/api/battle/create', (req, res) => {
  const { login, caseId } = req.body;
  const box = GAME_CASES.find(c => c.id === caseId);
  if (!box) return res.status(400).json({ error: 'Кейс не найден' });

  db = loadDB();
  const user = db.users.find(u => u.login === login);
  if (!user) return res.status(404).json({ error: 'Юзер не найден' });

  if (Number(user.balance) < box.price) return res.status(400).json({ error: 'Недостаточно звёзд!' });
  user.balance -= box.price;
  saveDB(db);

  res.json({ success: true, message: 'Батл создан (ожидание соперника)' });
});

/* ================== БОНУС / ПРОМО / ДЕПОЗИТ ================== */
app.post('/api/bonus/claim', (req, res) => {
  const { login } = req.body;
  db = loadDB();
  const user = db.users.find(u => u.login === login);
  if (!user) return res.status(404).json({ error: 'Не найден' });

  if (user.last_bonus) {
    const hours = (now() - user.last_bonus) / 3600000;
    if (hours < 24) return res.status(400).json({ error: 'Через ' + Math.ceil(24 - hours) + ' ч.' });
  }

  user.balance = Number(user.balance) + 50;
  user.last_bonus = now();
  saveDB(db);

  res.json({ success: true, balance: user.balance });
});

app.post('/api/promo/activate', (req, res) => {
  const { login, code } = req.body;
  db = loadDB();
  const up = code.toUpperCase();
  const promo = db.promocodes.find(p => p.code === up);
  if (!promo) return res.status(404).json({ error: 'Промокод не найден' });
  if (promo.uses >= promo.max_uses) return res.status(400).json({ error: 'Лимит исчерпан' });
  if (db.promo_history.find(h => h.user_login === login && h.code === up)) {
    return res.status(400).json({ error: 'Вы уже активировали' });
  }

  const user = db.users.find(u => u.login === login);
  user.balance = Number(user.balance) + promo.stars;
  promo.uses += 1;
  db.promo_history.push({ user_login: login, code: up, created_at: now() });
  saveDB(db);

  res.json({ success: true, stars: promo.stars });
});

app.post('/api/deposit/request', (req, res) => {
  const { login, amount } = req.body;
  if (!login || !amount || Number(amount) <= 0) return res.status(400).json({ error: 'Введите сумму' });
  db = loadDB();
  db.deposit_requests.push({ user_login: login, amount_stars: Number(amount), status: 'pending', created_at: now() });
  saveDB(db);
  res.json({ success: true });
});

/* ================== КАСТОМИЗАЦИЯ ================== */
app.post('/api/customization/buy', (req, res) => {
  const { login, type, item } = req.body;
  if (!['avatar', 'frame'].includes(type)) return res.status(400).json({ error: 'Неверный тип' });

  db = loadDB();
  const user = db.users.find(u => u.login === login);
  if (!user) return res.status(404).json({ error: 'Юзер не найден' });

  const price = type === 'avatar' ? 500 : 1000;
  if (Number(user.balance) < price) return res.status(400).json({ error: 'Недостаточно звёзд!' });
  user.balance -= price;

  const field = type === 'avatar' ? 'avatar' : 'frame';
  let custom = db.user_customization.find(c => c.user_login === login);
  if (custom) {
    custom[field] = item;
  } else {
    db.user_customization.push({ user_login: login, avatar: '👤', frame: 'none', [field]: item });
  }
  saveDB(db);

  res.json({ success: true });
});

/* ================== АДМИНКА ================== */
app.get('/api/admin/players', (req, res) => {
  db = loadDB();
  const players = db.users.map(u => ({
    login: u.login,
    balance: u.balance,
    is_admin: u.is_admin,
    is_super_admin: u.is_super_admin,
    nft_count: db.inventory.filter(i => i.user_login === u.login).length
  }));
  res.json(players);
});

app.get('/api/admin/withdraws', (req, res) => {
  db = loadDB();
  res.json(db.withdraw_requests.filter(w => w.status === 'pending'));
});

app.get('/api/admin/deposits', (req, res) => {
  db = loadDB();
  res.json(db.deposit_requests.filter(d => d.status === 'pending'));
});

app.get('/api/admin/logs', (req, res) => {
  db = loadDB();
  res.json(db.admin_logs.slice(-50).reverse());
});

app.post('/api/admin/deposit/accept', (req, res) => {
  const { adminLogin, id } = req.body;
  if (!checkAdmin(adminLogin).is_super_admin) return res.status(403).json({ error: 'Только главный админ' });

  db = loadDB();
  const dep = db.deposit_requests.find(d => d.id === id);
  if (!dep) return res.status(404).json({ error: 'Не найдено' });

  const user = db.users.find(u => u.login === dep.user_login);
  user.balance = Number(user.balance) + Number(dep.amount_stars);
  dep.status = 'accepted';
  saveDB(db);

  logAction(adminLogin, 'deposit_accept', `${dep.user_login} +${dep.amount_stars}`);
  res.json({ success: true });
});

app.post('/api/admin/withdraws/accept', (req, res) => {
  const { adminLogin, id } = req.body;
  if (!checkAdmin(adminLogin).is_super_admin) return res.status(403).json({ error: 'Только главный админ' });

  db = loadDB();
  const idx = db.withdraw_requests.findIndex(w => w.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Нет заявки' });

  const w = db.withdraw_requests[idx];
  const user = db.users.find(u => u.login === w.user_login);
  user.balance = Number(user.balance) + Number(w.item_price);
  db.withdraw_requests.splice(idx, 1);
  saveDB(db);

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

  db = loadDB();
  const uid = now() + '_' + Math.random().toString(36).slice(2);
  db.inventory.push({
    uid, user_login: targetLogin, item_id: item.id, name: item.name,
    icon: item.icon || '🎁', rarity: item.rarity || 'common',
    price: Number(item.price) || 0, status: 'inventory', created_at: now()
  });
  saveDB(db);

  logAction(adminLogin, 'give_nft', `${targetLogin} → ${item.name}`);
  res.json({ success: true });
});

app.post('/api/admin/create-promo', (req, res) => {
  const { adminLogin, code, stars, limit } = req.body;
  if (!checkAdmin(adminLogin).is_super_admin) return res.status(403).json({ error: 'Только главный админ' });
  if (!code || !stars || !limit) return res.status(400).json({ error: 'Заполните поля' });

  db = loadDB();
  const up = code.toUpperCase();
  if (db.promocodes.find(p => p.code === up)) return res.status(400).json({ error: 'Код уже есть' });

  db.promocodes.push({ code: up, stars: Number(stars), max_uses: Number(limit), uses: 0 });
  saveDB(db);

  logAction(adminLogin, 'create_promo', up);
  res.json({ success: true });
});

app.post('/api/admin/make-admin', (req, res) => {
  const { adminLogin, targetLogin } = req.body;
  if (!checkAdmin(adminLogin).is_super_admin) return res.status(403).json({ error: 'Только главный админ' });

  db = loadDB();
  const user = db.users.find(u => u.login === targetLogin);
  if (user) user.is_admin = true;
  saveDB(db);

  logAction(adminLogin, 'make_admin', targetLogin);
  res.json({ success: true });
});

app.post('/api/admin/remove-admin', (req, res) => {
  const { adminLogin, targetLogin } = req.body;
  if (!checkAdmin(adminLogin).is_super_admin) return res.status(403).json({ error: 'Только главный админ' });

  db = loadDB();
  const user = db.users.find(u => u.login === targetLogin);
  if (user) user.is_admin = false;
  saveDB(db);

  logAction(adminLogin, 'remove_admin', targetLogin);
  res.json({ success: true });
});

app.get('/api/admin/note/:login', (req, res) => {
  db = loadDB();
  const note = db.admin_notes.find(n => n.user_login === req.params.login);
  res.json({ note: note ? note.note : '' });
});

app.post('/api/admin/note', (req, res) => {
  const { adminLogin, targetLogin, note } = req.body;
  if (!checkAdmin(adminLogin).is_admin) return res.status(403).json({ error: 'Нет доступа' });

  db = loadDB();
  let existing = db.admin_notes.find(n => n.user_login === targetLogin);
  if (existing) {
    existing.note = note;
    existing.updated_at = now();
  } else {
    db.admin_notes.push({ user_login: targetLogin, note, updated_at: now() });
  }
  saveDB(db);

  logAction(adminLogin, 'note', `${targetLogin}: ${note}`);
  res.json({ success: true });
});

app.post('/api/admin/broadcast', (req, res) => {
  const { adminLogin, message } = req.body;
  if (!checkAdmin(adminLogin).is_super_admin) return res.status(403).json({ error: 'Только главный админ' });
  if (!message) return res.status(400).json({ error: 'Пусто' });

  db = loadDB();
  db.broadcasts.push({ admin_login: adminLogin, message, created_at: now() });
  saveDB(db);

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
    res.type('html').send('<h1 style="color:#fff;background:#000;padding:40px;font-family:sans-serif">Положи index.html в папку public/</h1>');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('✅ Сервер: http://localhost:' + PORT));