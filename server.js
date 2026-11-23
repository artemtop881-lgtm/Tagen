const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_PATH = path.join(__dirname, 'database.json');

// Лимит увеличен для чата (файлы)
app.use(express.json({ limit: '10mb' }));
app.use(express.static(PUBLIC_DIR));

const ITEMS_CATALOG = [
  { id: 'gift_box', name: 'Подарок', icon: '🎁', price: 100, rarity: 'common', is_nft: false },
  { id: 'ring_star', name: 'Кольцо', icon: '💍', price: 100, rarity: 'common', is_nft: false },
  { id: 'crystal_gem', name: 'Кристалл', icon: '💎', price: 250, rarity: 'rare', is_nft: false },
  { id: 'crown_gold', name: 'Корона', icon: '👑', price: 800, rarity: 'epic', is_nft: false },
  { id: 'nft_neon_punk', name: 'Neon Punk #01', icon: '👾', price: 350, rarity: 'nft', is_nft: true },
  { id: 'nft_cyber_katana', name: 'Cyber Katana #07', icon: '⚔️', price: 1200, rarity: 'nft', is_nft: true },
  { id: 'nft_void_dragon', name: 'Void Dragon #12', icon: '🐉', price: 3500, rarity: 'nft', is_nft: true }
];

const CASES_CONFIG = {
  starter: { price: 100, pool: [ITEMS_CATALOG[0], ITEMS_CATALOG[1], ITEMS_CATALOG[2]] },
  pro: { price: 1000, pool: [ITEMS_CATALOG[1], ITEMS_CATALOG[2], ITEMS_CATALOG[3], ITEMS_CATALOG[4]] },
  magic: { price: 2500, pool: [ITEMS_CATALOG[2], ITEMS_CATALOG[3], ITEMS_CATALOG[4], ITEMS_CATALOG[5]] },
  winter: { price: 3000, pool: [ITEMS_CATALOG[2], ITEMS_CATALOG[3], ITEMS_CATALOG[4], ITEMS_CATALOG[5]] },
  legend: { price: 5000, pool: [ITEMS_CATALOG[3], ITEMS_CATALOG[4], ITEMS_CATALOG[5], ITEMS_CATALOG[6]] },
  inferno: { price: 7500, pool: [ITEMS_CATALOG[3], ITEMS_CATALOG[5], ITEMS_CATALOG[6]] }
};

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(String(pwd)).digest('hex');
}

function initialFeedEvents() {
  const now = Date.now();
  return [
    { user_login: 'tagen', item_id: 'gift_box', item_name: 'выиграл Подарок', item_icon: '🎁', is_win: true, created_at: now - 40000 },
    { user_login: 'tgweb', item_id: 'nft_neon_punk', item_name: 'выиграл Neon Punk #01', item_icon: '👾', is_win: true, created_at: now - 30000 },
    { user_login: 'admin', item_id: 'rocket_loss', item_name: 'проиграл на 1.16x', item_icon: '🚀', is_win: false, created_at: now - 20000 },
    { user_login: 'player', item_id: 'mines_loss', item_name: 'подорвался на мине', item_icon: '💣', is_win: false, created_at: now - 10000 }
  ];
}

function defaultDb() {
  const defaultHash = hashPassword('admin123');
  return {
    users: {
      admin: { login: 'admin', passwordHash: defaultHash, balance: 100, inventory: [{ uid: 'init_nft_1', id: 'nft_neon_punk', name: 'Neon Punk #01', icon: '👾', price: 350, rarity: 'nft', is_nft: true }], is_admin: true, is_super_admin: true },
      tgweb: { login: 'tgweb', passwordHash: defaultHash, balance: 100, inventory: [], is_admin: true, is_super_admin: true },
      tagen: { login: 'tagen', passwordHash: defaultHash, balance: 100, inventory: [], is_admin: true, is_super_admin: true }
    },
    tokens: {}, drops: initialFeedEvents(), deposits: [], withdraws: [], promos: {}, logs: [],
    chat: [], muted: {}
  };
}

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = defaultDb();
    saveDb(initial);
    return initial;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    const users = parsed.users || {};
    const defaultHash = hashPassword('admin123');

    ['admin', 'tgweb', 'tagen'].forEach(superLogin => {
      if (!users[superLogin]) {
        users[superLogin] = { login: superLogin, passwordHash: defaultHash, balance: 100, inventory: [], is_admin: true, is_super_admin: true };
      } else {
        users[superLogin].is_admin = true;
        users[superLogin].is_super_admin = true;
      }
    });

    return {
      users,
      tokens: parsed.tokens || {},
      drops: Array.isArray(parsed.drops) && parsed.drops.length > 0 ? parsed.drops : initialFeedEvents(),
      deposits: Array.isArray(parsed.deposits) ? parsed.deposits : [],
      withdraws: Array.isArray(parsed.withdraws) ? parsed.withdraws : [],
      promos: parsed.promos || {},
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      chat: Array.isArray(parsed.chat) ? parsed.chat : [],
      muted: parsed.muted || {}
    };
  } catch (e) {
    return defaultDb();
  }
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function addLog(db, adminLogin, action, details) {
  db.logs.unshift({ id: crypto.randomUUID(), admin_login: adminLogin, action, details, created_at: Date.now() });
  db.logs = db.logs.slice(0, 200);
}

function pushFeed(db, userLogin, text, icon, isWin) {
  db.drops.unshift({ user_login: userLogin || 'Игрок', item_id: isWin ? 'win_event' : 'loss_event', item_name: text, item_icon: icon || (isWin ? '🎁' : '💥'), is_win: Boolean(isWin), created_at: Date.now() });
  db.drops = db.drops.slice(0, 30);
}

function getAuthUser(req, db) {
  const token = req.headers['x-auth-token'];
  if (!token || !db.tokens[token]) return null;
  return db.users[db.tokens[token]] || null;
}

const activeMinesSessions = new Map();
const activeRocketSessions = new Map();

function rollWeightedCrashPoint() {
  const r = Math.random();
  if (r < 0.78) return Number((1.01 + Math.random() * 0.34).toFixed(2));
  if (r < 0.96) return Number((1.36 + Math.random() * 0.84).toFixed(2));
  return Number((2.21 + Math.random() * 2.79).toFixed(2));
}

// ---------------- ЧАТ API ----------------
app.get('/api/chat', (req, res) => {
  const db = loadDb();
  res.json(db.chat.slice(-60));
});

app.post('/api/chat/send', (req, res) => {
  const db = loadDb();
  const user = getAuthUser(req, db);
  if (!user) return res.status(401).json({ error: 'Требуется авторизация' });
  if (db.muted[user.login] && db.muted[user.login] > Date.now()) {
    const left = Math.ceil((db.muted[user.login] - Date.now()) / 60000);
    return res.status(403).json({ error: `Вы заглушены ещё на ${left} мин.` });
  }
  const { text, file, fileType } = req.body || {};
  if (!text && !file) return res.status(400).json({ error: 'Пустое сообщение' });
  if (file && file.length > 7 * 1024 * 1024) return res.status(400).json({ error: 'Файл слишком большой' });

  const msg = { id: crypto.randomUUID(), login: user.login, is_admin: Boolean(user.is_admin || user.is_super_admin), text: text || '', file: file || null, fileType: fileType || null, created_at: Date.now() };
  db.chat.push(msg);
  if (db.chat.length > 200) db.chat = db.chat.slice(-200);
  saveDb(db);
  res.json({ success: true, message: msg });
});

app.post('/api/chat/admin', (req, res) => {
  const db = loadDb();
  const user = getAuthUser(req, db);
  if (!user || (!user.is_admin && !user.is_super_admin)) return res.status(403).json({ error: 'Нет прав' });
  const { action, msgId, targetLogin } = req.body || {};

  if (action === 'delete') { db.chat = db.chat.filter(m => m.id !== msgId); addLog(db, user.login, 'chat_delete', `Удалил сообщение ${msgId}`); }
  else if (action === 'clear') { db.chat = []; addLog(db, user.login, 'chat_clear', 'Очистил чат'); }
  else if (action === 'mute') {
    if (!db.users[targetLogin]) return res.status(404).json({ error: 'Юзер не найден' });
    db.muted[targetLogin] = Date.now() + 5 * 60 * 1000;
    addLog(db, user.login, 'chat_mute', `Замутил ${targetLogin}`);
  }
  saveDb(db);
  res.json({ success: true });
});

// ---------------- БАЗОВЫЕ API ----------------
app.get('/api/items', (req, res) => res.json(ITEMS_CATALOG));
app.get('/api/drops', (req, res) => { const db = loadDb(); res.json(db.drops || []); });
app.get('/api/user/:login', (req, res) => {
  const db = loadDb(); const authUser = getAuthUser(req, db);
  if (!authUser) return res.status(401).json({ error: 'Требуется авторизация' });
  const u = db.users[decodeURIComponent(req.params.login)];
  if (!u || (authUser.login !== u.login && !authUser.is_admin && !authUser.is_super_admin)) return res.status(403).json({ error: 'Доступ запрещён' });
  res.json({ login: u.login, balance: u.balance, inventory: u.inventory || [], is_admin: Boolean(u.is_admin), is_super_admin: Boolean(u.is_super_admin) });
});

app.post('/api/register', (req, res) => {
  const { login, password } = req.body || {}; const cleanLogin = String(login || '').trim();
  if (!cleanLogin || String(password || '').length < 6) return res.status(400).json({ error: 'Логин и пароль (мин. 6 символов)' });
  const db = loadDb(); if (db.users[cleanLogin]) return res.status(400).json({ error: 'Логин занят' });
  const isSuper = ['admin', 'tgweb', 'tagen'].includes(cleanLogin.toLowerCase());
  db.users[cleanLogin] = { login: cleanLogin, passwordHash: hashPassword(password), balance: 100, inventory: [], is_admin: isSuper, is_super_admin: isSuper };
  const token = crypto.randomBytes(24).toString('hex'); db.tokens[token] = cleanLogin; saveDb(db);
  const u = db.users[cleanLogin];
  res.json({ token, user: { login: u.login, balance: u.balance, inventory: u.inventory, is_admin: u.is_admin, is_super_admin: u.is_super_admin } });
});

app.post('/api/login', (req, res) => {
  const { login, password } = req.body || {}; const db = loadDb();
  const u = db.users[String(login || '').trim()];
  if (!u || u.passwordHash !== hashPassword(password)) return res.status(401).json({ error: 'Неверный логин или пароль' });
  const token = crypto.randomBytes(24).toString('hex'); db.tokens[token] = u.login; saveDb(db);
  res.json({ token, user: { login: u.login, balance: u.balance, inventory: u.inventory, is_admin: Boolean(u.is_admin), is_super_admin: Boolean(u.is_super_admin) } });
});

// ---------------- ИГРЫ ----------------
app.post('/api/cases/open', (req, res) => {
  const { caseId } = req.body || {}; const cfg = CASES_CONFIG[caseId];
  const db = loadDb(); const user = getAuthUser(req, db);
  if (!user || !cfg || user.balance < cfg.price) return res.status(400).json({ error: 'Ошибка' });
  user.balance -= cfg.price;
  const template = cfg.pool[Math.floor(Math.random() * cfg.pool.length)];
  const wonItem = { uid: crypto.randomUUID(), id: template.id, name: template.name, icon: template.icon, price: template.price, rarity: template.rarity, is_nft: Boolean(template.is_nft) };
  user.inventory.push(wonItem); pushFeed(db, user.login, `выиграл ${wonItem.name}`, wonItem.icon, true); saveDb(db);
  res.json({ balance: user.balance, item: wonItem, pool: cfg.pool });
});

app.post('/api/games/mines', (req, res) => {
  const { action, bet, minesCount, cell } = req.body || {}; const db = loadDb(); const user = getAuthUser(req, db);
  if (!user) return res.status(401).json({ error: 'Требуется авторизация' });

  if (action === 'start') {
    const betNum = Number(bet) || 0; const mCount = [1, 3, 5, 10].includes(Number(minesCount)) ? Number(minesCount) : 3;
    if (betNum < 10 || user.balance < betNum) return res.status(400).json({ error: 'Ставка от 10★, недостаточно средств' });
    user.balance -= betNum; saveDb(db);
    const bombs = new Set(); while (bombs.size < mCount) bombs.add(Math.floor(Math.random() * 9));
    activeMinesSessions.set(user.login, { bet: betNum, minesCount: mCount, bombs: Array.from(bombs), opened: [] });
    return res.json({ balance: user.balance, gridSize: 3, totalCells: 9, minesCount: mCount });
  }
  const session = activeMinesSessions.get(user.login); if (!session) return res.status(400).json({ error: 'Игра не найдена' });
  if (action === 'click') {
    const idx = Number(cell);
    if (session.bombs.includes(idx)) { activeMinesSessions.delete(user.login); pushFeed(db, user.login, 'подорвался на мине', '💣', false); saveDb(db); return res.json({ bomb: true, bombs: session.bombs }); }
    if (!session.opened.includes(idx)) session.opened.push(idx);
    const mult = Number((1 + session.opened.length * (0.22 + session.minesCount * 0.08)).toFixed(2));
    return res.json({ bomb: false, openedCount: session.opened.length, multiplier: mult, potentialWin: Math.floor(session.bet * mult) });
  }
  if (action === 'cashout') {
    if (!session.opened.length) return res.status(400).json({ error: 'Откройте ячейку' });
    const mult = Number((1 + session.opened.length * (0.22 + session.minesCount * 0.08)).toFixed(2));
    const win = Math.floor(session.bet * mult); user.balance += win;
    pushFeed(db, user.login, `выиграл ${win} ★`, '💎', true); saveDb(db); activeMinesSessions.delete(user.login);
    return res.json({ balance: user.balance, win, bombs: session.bombs });
  }
});

app.post('/api/games/rocket', (req, res) => {
  const { action, bet, multiplier } = req.body || {}; const db = loadDb(); const user = getAuthUser(req, db);
  if (!user) return res.status(401).json({ error: 'Требуется авторизация' });
  if (action === 'start') {
    const betNum = Number(bet) || 0; if (betNum < 10 || user.balance < betNum) return res.status(400).json({ error: 'Ошибка ставки' });
    user.balance -= betNum; saveDb(db);
    const crashPoint = Math.min(5.0, Math.max(1.01, rollWeightedCrashPoint()));
    activeRocketSessions.set(user.login, { bet: betNum, crashPoint });
    return res.json({ balance: user.balance, crashPoint });
  }
  const session = activeRocketSessions.get(user.login); if (!session) return res.status(400).json({ error: 'Ракета не запущена' });
  if (action === 'cashout') {
    const claimMult = Number(multiplier);
    if (claimMult >= session.crashPoint) { activeRocketSessions.delete(user.login); return res.json({ crashed: true, crashPoint: session.crashPoint }); }
    const win = Math.floor(session.bet * claimMult); user.balance += win;
    pushFeed(db, user.login, `забрал на ${claimMult}x (+${win} ★)`, '🚀', true); saveDb(db); activeRocketSessions.delete(user.login);
    return res.json({ balance: user.balance, win, multiplier: claimMult, crashPoint: session.crashPoint });
  }
  if (action === 'crash') { activeRocketSessions.delete(user.login); pushFeed(db, user.login, `проиграл на ${session.crashPoint}x`, '💥', false); saveDb(db); return res.json({ crashPoint: session.crashPoint }); }
});

app.post('/api/upgrade', (req, res) => {
  const { targetItemId, betStars, myUid } = req.body || {}; const db = loadDb(); const user = getAuthUser(req, db);
  if (!user) return res.status(401).json({ error: 'Требуется авторизация' });
  const target = ITEMS_CATALOG.find(i => i.id === targetItemId) || (user.inventory || []).find(i => i.uid === targetItemId);
  if (!target) return res.status(400).json({ error: 'Цель не найдена' });
  let myPrice = 0; let itemToRemove = null;
  if (betStars) { myPrice = Number(betStars); if (user.balance < myPrice) return res.status(400).json({ error: 'Мало звезд' }); }
  else if (myUid) { const idx = (user.inventory || []).findIndex(i => i.uid === myUid); if (idx === -1) return res.status(400).json({ error: 'Нет предмета' }); itemToRemove = user.inventory[idx]; myPrice = Number(itemToRemove.price); }
  if (myPrice >= target.price) return res.status(400).json({ error: 'Цель должна быть дороже' });
  let chance = (myPrice / target.price) * 50; if (chance > 50) chance = 50; if (chance < 1) chance = 1;
  const win = Math.random() * 100 <= chance;
  if (betStars) user.balance -= myPrice; else if (itemToRemove) user.inventory = user.inventory.filter(i => i.uid !== itemToRemove.uid);
  if (win) { user.inventory.push({ uid: crypto.randomUUID(), ...target }); pushFeed(db, user.login, `апгрейд в ${target.name}`, target.icon, true); }
  else { pushFeed(db, user.login, `сгорел на апгрейде`, '💥', false); }
  saveDb(db);
  res.json({ win, chance, item: target });
});

// ---------------- КОШЕЛЕК ----------------
app.post('/api/wallet/deposit', (req, res) => {
  const { amount } = req.body || {}; const db = loadDb(); const user = getAuthUser(req, db);
  if (!user || !amount) return res.status(400).json({ error: 'Ошибка' });
  db.deposits.push({ id: crypto.randomUUID(), user_login: user.login, amount_stars: Number(amount), created_at: Date.now() });
  saveDb(db); res.json({ success: true });
});

app.post('/api/wallet/withdraw', (req, res) => {
  const { amount } = req.body || {}; const db = loadDb(); const user = getAuthUser(req, db);
  if (!user || !amount || user.balance < Number(amount)) return res.status(400).json({ error: 'Недостаточно средств' });
  user.balance -= Number(amount);
  db.withdraws.push({ id: crypto.randomUUID(), user_login: user.login, amount_stars: Number(amount), created_at: Date.now() });
  saveDb(db); res.json({ success: true });
});

// ---------------- СКАЧИВАНИЕ ----------------
app.get('/api/export/my-data', (req, res) => {
  const db = loadDb(); const authUser = getAuthUser(req, db);
  if (!authUser) return res.status(401).json({ error: 'Требуется авторизация' });
  res.json({ exported_at: new Date().toISOString(), login: authUser.login, balance: authUser.balance, inventory: authUser.inventory || [] });
});

app.get('/api/admin/download-db', (req, res) => {
  const db = loadDb(); const authUser = getAuthUser(req, db);
  if (!authUser || (!authUser.is_admin && !authUser.is_super_admin)) return res.status(403).json({ error: 'Нет прав' });
  res.json(db);
});

// ---------------- АДМИНКА ----------------
app.get('/api/admin/players', (req, res) => {
  const db = loadDb(); const user = getAuthUser(req, db);
  if (!user || (!user.is_admin && !user.is_super_admin)) return res.status(403).json({ error: 'Нет прав' });
  res.json(Object.values(db.users).map(u => ({ login: u.login, balance: u.balance, is_admin: u.is_admin, is_super_admin: u.is_super_admin, nft_count: (u.inventory || []).filter(i => i.is_nft).length })));
});

app.post('/api/admin/give-stars', (req, res) => {
  const db = loadDb(); const user = getAuthUser(req, db);
  if (!user || (!user.is_admin && !user.is_super_admin)) return res.status(403).json({ error: 'Нет прав' });
  const { targetLogin, amount } = req.body;
  if (db.users[targetLogin]) { db.users[targetLogin].balance += Number(amount); addLog(db, user.login, 'give_stars', `${amount}★ для ${targetLogin}`); saveDb(db); res.json({ success: true }); } else res.status(404).json({ error: 'Не найден' });
});

app.post('/api/admin/take-stars', (req, res) => {
  const db = loadDb(); const user = getAuthUser(req, db);
  if (!user || !user.is_super_admin) return res.status(403).json({ error: 'Только супер-админ' });
  const { targetLogin, amount } = req.body;
  if (db.users[targetLogin]) { db.users[targetLogin].balance -= Number(amount); addLog(db, user.login, 'take_stars', `${amount}★ у ${targetLogin}`); saveDb(db); res.json({ success: true }); } else res.status(404).json({ error: 'Не найден' });
});

app.post('/api/admin/give-nft', (req, res) => {
  const db = loadDb(); const user = getAuthUser(req, db);
  if (!user || (!user.is_admin && !user.is_super_admin)) return res.status(403).json({ error: 'Нет прав' });
  const { targetLogin, item } = req.body;
  if (db.users[targetLogin]) { db.users[targetLogin].inventory.push({ uid: crypto.randomUUID(), ...item }); addLog(db, user.login, 'give_nft', `NFT ${item.name} для ${targetLogin}`); saveDb(db); res.json({ success: true }); } else res.status(404).json({ error: 'Не найден' });
});

app.get('/api/admin/withdraws', (req, res) => {
  const db = loadDb(); const user = getAuthUser(req, db);
  if (!user || !user.is_super_admin) return res.status(403).json({ error: 'Нет прав' });
  res.json(db.withdraws || []);
});

app.get('/api/admin/deposits', (req, res) => {
  const db = loadDb(); const user = getAuthUser(req, db);
  if (!user || !user.is_super_admin) return res.status(403).json({ error: 'Нет прав' });
  res.json(db.deposits || []);
});

app.post('/api/admin/withdraws/accept', (req, res) => {
  const db = loadDb(); const user = getAuthUser(req, db);
  if (!user || !user.is_super_admin) return res.status(403).json({ error: 'Нет прав' });
  const { id } = req.body;
  db.withdraws = db.withdraws.filter(w => w.id !== id);
  addLog(db, user.login, 'accept_withdraw', `Выплата ${id}`);
  saveDb(db); res.json({ success: true });
});

app.post('/api/admin/deposit/accept', (req, res) => {
  const db = loadDb(); const user = getAuthUser(req, db);
  if (!user || !user.is_super_admin) return res.status(403).json({ error: 'Нет прав' });
  const { id } = req.body;
  const dep = db.deposits.find(d => d.id === id);
  if (dep && db.users[dep.user_login]) {
    db.users[dep.user_login].balance += dep.amount_stars;
    db.deposits = db.deposits.filter(d => d.id !== id);
    addLog(db, user.login, 'accept_deposit', `Пополнение ${dep.amount_stars}★ для ${dep.user_login}`);
    saveDb(db);
  }
  res.json({ success: true });
});

app.post('/api/admin/create-promo', (req, res) => {
  const db = loadDb(); const user = getAuthUser(req, db);
  if (!user || !user.is_super_admin) return res.status(403).json({ error: 'Нет прав' });
  const { code, stars, limit } = req.body;
  db.promos[code.toUpperCase()] = { stars: Number(stars), limit: Number(limit), used: 0 };
  addLog(db, user.login, 'create_promo', `Промокод ${code} на ${stars}★`);
  saveDb(db); res.json({ success: true });
});

app.get('/api/admin/logs', (req, res) => {
  const db = loadDb(); const user = getAuthUser(req, db);
  if (!user || !user.is_super_admin) return res.status(403).json({ error: 'Нет прав' });
  res.json(db.logs || []);
});

app.post('/api/admin/make-admin', (req, res) => {
  const db = loadDb(); const user = getAuthUser(req, db);
  if (!user || !user.is_super_admin) return res.status(403).json({ error: 'Нет прав' });
  const { targetLogin } = req.body;
  if (db.users[targetLogin]) { db.users[targetLogin].is_admin = true; addLog(db, user.login, 'make_admin', `Выдал права ${targetLogin}`); saveDb(db); res.json({ success: true }); }
});
app.post('/api/admin/remove-admin', (req, res) => {
  const db = loadDb(); const user = getAuthUser(req, db);
  if (!user || !user.is_super_admin) return res.status(403).json({ error: 'Нет прав' });
  const { targetLogin } = req.body;
  if (db.users[targetLogin] && !['admin', 'tgweb', 'tagen'].includes(targetLogin)) { db.users[targetLogin].is_admin = false; addLog(db, user.login, 'remove_admin', `Снял права ${targetLogin}`); saveDb(db); res.json({ success: true }); }
});

app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
