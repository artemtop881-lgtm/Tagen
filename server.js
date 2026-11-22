const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ================== АВТОПОИСК КАРТИНОК ================== */
let FOUND_IMAGES = {};
const ITEMS_DIR = path.join(__dirname, 'public', 'items');

function scanImages() {
  FOUND_IMAGES = {};
  if (!fs.existsSync(ITEMS_DIR)) return;
  
  const entries = fs.readdirSync(ITEMS_DIR, { withFileTypes: true });
  
  entries.forEach(entry => {
    const fullPath = path.join(ITEMS_DIR, entry.name);
    if (entry.isFile() && /\.(png|jpe?g|webp|gif)$/i.test(entry.name)) {
      const baseName = path.parse(entry.name).name.toLowerCase().replace(/\s+/g, '_');
      FOUND_IMAGES[baseName] = '/items/' + encodeURIComponent(entry.name);
    }
    if (entry.isDirectory()) {
      const folderName = entry.name.toLowerCase().replace(/\s+/g, '_');
      const filesInFolder = fs.readdirSync(fullPath);
      const imageFile = filesInFolder.find(f => /\.(png|jpe?g|webp|gif)$/i.test(f));
      if (imageFile) {
        FOUND_IMAGES[folderName] = '/items/' + encodeURIComponent(entry.name) + '/' + encodeURIComponent(imageFile);
      }
    }
  });
}
scanImages();

function getIconPath(id, fallbackEmoji) {
  if (FOUND_IMAGES[id]) return FOUND_IMAGES[id];
  return fallbackEmoji;
}

/* ================== ХРАНИЛИЩЕ ================== */
const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'database.json');
const EMPTY_DB = () => ({
  users: [], inventory: [], user_customization: [], drop_history: [], // <-- ДОБАВИЛ drop_history
  withdraw_requests: [], deposit_requests: [], promocodes: [], promo_history: [],
  admin_logs: [], admin_notes: [], broadcasts: []
});

function loadDB() {
  if (!fs.existsSync(DB_FILE)) return EMPTY_DB();
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) { return EMPTY_DB(); }
}

function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

let db = loadDB();
if (!db.users.find(u => u.is_super_admin)) {
  db.users.push({ login: 'admin', password: 'admin123', balance: 999999, is_admin: true, is_super_admin: true, last_seen: Date.now(), last_bonus: null });
  db.user_customization.push({ user_login: 'admin', avatar: '👤', frame: 'none' });
  saveDB(db);
  console.log('👑 Создан админ: admin / admin123');
}

const now = () => Date.now();
const uid = () => now() + '_' + Math.random().toString(36).slice(2);

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

function addBalance(login, amount) {
  db = loadDB();
  const u = db.users.find(u => u.login === login);
  if (!u) return { error: 'Пользователь не найден' };
  u.balance = Number(u.balance) + Number(amount);
  saveDB(db);
  return { balance: u.balance };
}

/* ================== ПРЕДМЕТЫ ================== */
const GAME_CASES = [
  { id:'starter', name:'Стартовый', icon:'📦', price:100, items:[
    {id:'heart',name:'Сердечко',icon:'💖',rarity:'common',price:15,chance:54},
    {id:'rose',name:'Роза',icon:'🌹',rarity:'common',price:25,chance:30},
    {id:'bear',name:'Мишка',icon:'🧸',rarity:'common',price:15,chance:10},
    {id:'skull',name:'Череп',icon:'💀',rarity:'rare',price:50,chance:5},
    {id:'ring',name:'Кольцо',icon:'💍',rarity:'rare',price:100,chance:1}
  ]},
  { id:'pro', name:'Про', icon:'🎁', price:1000, items:[
    {id:'gift',name:'Подарок',icon:'🎁',rarity:'common',price:25,chance:50},
    {id:'cake',name:'Торт',icon:'🎂',rarity:'common',price:50,chance:30},
    {id:'bouquet',name:'Букет',icon:'💐',rarity:'common',price:50,chance:19.99},
    {id:'dragon',name:'Дракон',icon:'🐉',rarity:'legendary',price:250000,chance:0.01}
  ]},
  { id:'legend', name:'Легенда', icon:'⚡', price:5000, items:[
    {id:'ring',name:'Кольцо',icon:'💍',rarity:'rare',price:100,chance:60},
    {id:'golden_cup',name:'Золотой Кубок',icon:'🏆',rarity:'legendary',price:100000,chance:5},
    {id:'dragon',name:'Дракон',icon:'🐉',rarity:'legendary',price:250000,chance:1},
    {id:'crown',name:'Корона',icon:'👑',rarity:'legendary',price:500000,chance:0.1},
    {id:'galaxy',name:'Галактика',icon:'🌌',rarity:'legendary',price:2000000,chance:0.001}
  ]},
  { id:'magic', name:'Магический', icon:'🔮', price:2500, items:[
    {id:'heart',name:'Сердечко',icon:'💖',rarity:'common',price:15,chance:40},
    {id:'skull',name:'Череп',icon:'💀',rarity:'rare',price:50,chance:30},
    {id:'ring',name:'Кольцо',icon:'💍',rarity:'rare',price:100,chance:20},
    {id:'dragon',name:'Дракон',icon:'🐉',rarity:'legendary',price:250000,chance:0.05}
  ]},
  { id:'winter', name:'Зимний', icon:'❄️', price:3000, items:[
    {id:'bear',name:'Мишка',icon:'🧸',rarity:'common',price:15,chance:40},
    {id:'cake',name:'Торт',icon:'🎂',rarity:'common',price:50,chance:35},
    {id:'golden_cup',name:'Золотой Кубок',icon:'🏆',rarity:'legendary',price:100000,chance:3},
    {id:'crown',name:'Корона',icon:'👑',rarity:'legendary',price:500000,chance:0.1},
    {id:'galaxy',name:'Галактика',icon:'🌌',rarity:'legendary',price:2000000,chance:0.01}
  ]},
  { id:'inferno', name:'Адский', icon:'🔥', price:7500, items:[
    {id:'skull',name:'Череп',icon:'💀',rarity:'rare',price:50,chance:50},
    {id:'ring',name:'Кольцо',icon:'💍',rarity:'rare',price:100,chance:25},
    {id:'golden_cup',name:'Золотой Кубок',icon:'🏆',rarity:'legendary',price:100000,chance:8},
    {id:'dragon',name:'Дракон',icon:'🐉',rarity:'legendary',price:250000,chance:2},
    {id:'crown',name:'Корона',icon:'👑',rarity:'legendary',price:500000,chance:0.1},
    {id:'galaxy',name:'Галактика',icon:'🌌',rarity:'legendary',price:2000000,chance:0.001}
  ]}
];

GAME_CASES.forEach(box => {
  box.icon = getIconPath(box.id, box.icon);
  box.icon = getIconPath('case_' + box.id, box.icon);
  box.items.forEach(item => { item.icon = getIconPath(item.id, item.icon); });
});

function buildItemCatalog() {
  const map = new Map();
  for (const box of GAME_CASES) {
    for (const it of box.items) {
      if (!map.has(it.id)) map.set(it.id, { ...it });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.price - b.price);
}
const ITEM_CATALOG = buildItemCatalog();
const ITEM_BY_ID = new Map(ITEM_CATALOG.map(i => [i.id, i]));

/* ================== АВТОРИЗАЦИЯ ================== */
app.post('/api/register', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password || password.length < 6) return res.status(400).json({ error: 'Логин и пароль (мин. 6 символов)' });
  db = loadDB();
  if (db.users.find(u => u.login === login)) return res.status(400).json({ error: 'Логин уже занят' });
  
  db.users.push({ login, password, balance: 100, is_admin: false, is_super_admin: false, last_seen: now(), last_bonus: null });
  db.user_customization.push({ user_login: login, avatar: '👤', frame: 'none' });
  saveDB(db);
  
  res.json({ success: true, user: { login, balance: 100 } });
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
  const totalValue = inventory.reduce((s, i) => s + (Number(i.price) || 0), 0);
  res.json({ balance: Number(user.balance), inventory, is_admin: !!user.is_admin, is_super_admin: !!user.is_super_admin, stats: { totalItems: inventory.length, totalValue }, avatar: custom ? custom.avatar : '👤', frame: custom ? custom.frame : 'none' });
});

app.get('/api/items', (req, res) => res.json(ITEM_CATALOG));
app.get('/api/cases', (req, res) => res.json(GAME_CASES));

app.post('/api/cases/open', (req, res) => {
  const { login, caseId } = req.body;
  const box = GAME_CASES.find(c => c.id === caseId);
  if (!box) return res.status(400).json({ error: 'Кейс не найден' });
  db = loadDB();
  const user = db.users.find(u => u.login === login);
  if (!user) return res.status(404).json({ error: 'Юзер не найден' });
  if (Number(user.balance) < box.price) return res.status(400).json({ error: 'Недостаточно звёзд!' });
  
  user.balance -= box.price;
  const totalChance = box.items.reduce((s, i) => s + Number(i.chance), 0);
  let roll = Math.random() * totalChance;
  let dropped = box.items[0];
  for (const it of box.items) {
    if (roll < Number(it.chance)) { dropped = it; break; }
    roll -= Number(it.chance);
  }
  const itemUid = uid();
  db.inventory.push({ uid: itemUid, user_login: login, item_id: dropped.id, name: dropped.name, icon: dropped.icon, rarity: dropped.rarity, price: dropped.price, status: 'inventory', created_at: now() });
  
  // ДОБАВЛЯЕМ В ИСТОРИЮ ДРОПОВ
  db.drop_history.push({ user_login: login, item_name: dropped.name, item_icon: dropped.icon, item_price: dropped.price, rarity: dropped.rarity, created_at: now() });
  saveDB(db);
  
  res.json({ success: true, balance: user.balance, item: { ...dropped, uid: itemUid }, pool: box.items });
});

/* ================== ИГРА "МИНЫ" ================== */
app.post('/api/games/mines', (req, res) => {
  const { login, action, bet, opened, minesCount, totalCells } = req.body;
  db = loadDB();
  const user = db.users.find(u => u.login === login);
  if (!user) return res.status(404).json({ error: 'Юзер не найден' });
  
  if (action === 'start') {
    if (Number(user.balance) < Number(bet)) return res.status(400).json({ error: 'Мало звезд!' });
    user.balance = Number(user.balance) - Number(bet);
    saveDB(db);
    return res.json({ success: true, balance: user.balance });
  }
  
  if (action === 'cashout') {
    const mult = 1 + (opened * (minesCount / totalCells) * 2);
    const winAmount = Math.floor(bet * mult);
    user.balance = Number(user.balance) + winAmount;
    saveDB(db);
    return res.json({ success: true, balance: user.balance, win: winAmount });
  }
});

/* ================== ИНВЕНТАРЬ / АПГРЕЙД ================== */
app.post('/api/inventory/sell', (req, res) => {
  const { login, uid: itemUid } = req.body;
  db = loadDB();
  const idx = db.inventory.findIndex(i => i.user_login === login && i.uid === itemUid);
  if (idx === -1) return res.status(410).json({ error: 'Уже продано' });
  const item = db.inventory[idx];
  db.inventory.splice(idx, 1);
  const user = db.users.find(u => u.login === login);
  user.balance = Number(user.balance) + Number(item.price);
  saveDB(db);
  res.json({ success: true, balance: user.balance });
});

app.post('/api/upgrade', (req, res) => {
  const { login, myUid, targetItemId } = req.body;
  db = loadDB();
  const myIdx = db.inventory.findIndex(i => i.user_login === login && i.uid === myUid);
  if (myIdx === -1) return res.status(404).json({ error: 'Предмет не найден' });
  const target = ITEM_BY_ID.get(targetItemId);
  if (!target) return res.status(400).json({ error: 'Цель не найдена' });
  const myItem = db.inventory[myIdx];
  if (Number(myItem.price) >= Number(target.price)) return res.status(400).json({ error: 'Целевой предмет должен быть дороже' });
  
  let chance = (Number(myItem.price) / Number(target.price)) * 50;
  if (!isFinite(chance)) chance = 1;
  if (chance > 50) chance = 50;
  if (chance < 1) chance = 1;
  chance = Math.round(chance * 100) / 100;
  
  db.inventory.splice(myIdx, 1);
  const win = Math.random() * 100 < chance;
  let newItem = null;
  if (win) {
    const itemUid = uid();
    newItem = { uid: itemUid, user_login: login, item_id: target.id, name: target.name, icon: target.icon, rarity: target.rarity, price: target.price, status: 'inventory', created_at: now() };
    db.inventory.push(newItem);
    
    // ДОБАВЛЯЕМ В ИСТОРИЮ ДРОПОВ (ЕСЛИ ВЫИГРАЛ)
    db.drop_history.push({ user_login: login, item_name: target.name, item_icon: target.icon, item_price: target.price, rarity: target.rarity, created_at: now() });
  }
  saveDB(db);
  res.json({ success: true, win, chance, item: win ? { ...target, uid: newItem.uid } : target, myItem });
});

// НОВЫЙ ЭНДПОИНТ ДЛЯ ПОЛУЧЕНИЯ ПОСЛЕДНИХ ДРОПОВ
app.get('/api/drops', (req, res) => {
  db = loadDB();
  // Берем последние 20 дропов, сортируем по времени (новые сверху)
  const recent = db.drop_history.slice(-20).reverse();
  res.json(recent);
});

/* ================== КОШЕЛЕК (ЗАЯВКИ) ================== */
app.post('/api/wallet/deposit', (req, res) => {
  const { login, amount } = req.body;
  if (!login || !amount || Number(amount) <= 0) return res.status(400).json({ error: 'Введите сумму' });
  db = loadDB();
  db.deposit_requests.push({ id: uid(), user_login: login, amount_stars: Number(amount), status: 'pending', created_at: now() });
  saveDB(db);
  res.json({ success: true, message: 'Заявка на пополнение создана. Ожидайте подтверждения.' });
});

app.post('/api/wallet/withdraw', (req, res) => {
  const { login, amount } = req.body;
  if (!login || !amount || Number(amount) <= 0) return res.status(400).json({ error: 'Введите сумму' });
  db = loadDB();
  const user = db.users.find(u => u.login === login);
  if (!user) return res.status(404).json({ error: 'Юзер не найден' });
  if (Number(user.balance) < Number(amount)) return res.status(400).json({ error: 'Мало звезд' });

  user.balance = Number(user.balance) - Number(amount);
  db.withdraw_requests.push({ id: uid(), user_login: login, amount_stars: Number(amount), status: 'pending', created_at: now() });
  saveDB(db);
  res.json({ success: true, message: 'Заявка на вывод создана. Ожидайте.' });
});

/* ================== АДМИНКА ================== */
app.get('/api/admin/players', (req, res) => {
  db = loadDB();
  res.json(db.users.map(u => ({ login: u.login, balance: u.balance, is_admin: u.is_admin, is_super_admin: u.is_super_admin, nft_count: db.inventory.filter(i => i.user_login === u.login).length })));
});

app.get('/api/admin/withdraws', (req, res) => { db = loadDB(); res.json(db.withdraw_requests.filter(w => w.status === 'pending')); });
app.get('/api/admin/deposits', (req, res) => { db = loadDB(); res.json(db.deposit_requests.filter(d => d.status === 'pending')); });
app.get('/api/admin/logs', (req, res) => { db = loadDB(); res.json(db.admin_logs.slice(-50).reverse()); });

app.post('/api/admin/deposit/accept', (req, res) => {
  const { adminLogin, id } = req.body;
  if (!checkAdmin(adminLogin).is_super_admin) return res.status(403).json({ error: 'Только главный админ' });
  db = loadDB();
  const dep = db.deposit_requests.find(d => d.id === id);
  if (!dep || dep.status !== 'pending') return res.status(400).json({ error: 'Не найдено или обработано' });
  const user = db.users.find(u => u.login === dep.user_login);
  if (user) user.balance = Number(user.balance) + Number(dep.amount_stars);
  dep.status = 'accepted';
  saveDB(db);
  logAction(adminLogin, 'deposit_accept', `${dep.user_login} +${dep.amount_stars}`);
  res.json({ success: true });
});

app.post('/api/admin/withdraws/accept', (req, res) => {
  const { adminLogin, id } = req.body;
  if (!checkAdmin(adminLogin).is_super_admin) return res.status(403).json({ error: 'Только главный админ' });
  db = loadDB();
  const idx = db.withdraw_requests.findIndex(w => w.id === id && w.status === 'pending');
  if (idx === -1) return res.status(400).json({ error: 'Нет заявки' });
  db.withdraw_requests.splice(idx, 1);
  saveDB(db);
  logAction(adminLogin, 'withdraw_accept', `Выплата`);
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
  db.inventory.push({ uid: uid(), user_login: targetLogin, item_id: item.id, name: item.name, icon: item.icon || '🎁', rarity: item.rarity || 'common', price: Number(item.price) || 0, status: 'inventory', created_at: now() });
  saveDB(db);
  logAction(adminLogin, 'give_nft', `${targetLogin} → ${item.name}`);
  res.json({ success: true });
});

app.post('/api/admin/create-promo', (req, res) => {
  const { adminLogin, code, stars, limit } = req.body;
  if (!checkAdmin(adminLogin).is_super_admin) return res.status(403).json({ error: 'Только главный админ' });
  if (!code || !stars || !limit) return res.status(400).json({ error: 'Заполните поля' });
  db = loadDB();
  const up = String(code).toUpperCase();
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

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.type('html').send('<h1>Положи index.html в public/</h1>');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('✅ Сервер: http://localhost:' + PORT));
