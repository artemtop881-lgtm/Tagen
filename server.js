const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_PATH = path.join(__dirname, 'database.json');

app.use(express.json());
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

function defaultDb() {
  const defaultHash = hashPassword('admin123');
  return {
    users: {
      admin: {
        login: 'admin',
        passwordHash: defaultHash,
        balance: 100000,
        inventory: [
          { uid: 'init_nft_1', id: 'nft_neon_punk', name: 'Neon Punk #01', icon: '👾', price: 350, rarity: 'nft', is_nft: true }
        ],
        is_admin: true,
        is_super_admin: true
      },
      tgweb: {
        login: 'tgweb',
        passwordHash: defaultHash,
        balance: 100000,
        inventory: [],
        is_admin: true,
        is_super_admin: true
      },
      tagen: {
        login: 'tagen',
        passwordHash: defaultHash,
        balance: 100000,
        inventory: [],
        is_admin: true,
        is_super_admin: true
      }
    },
    tokens: {},
    drops: [
      { user_login: 'tagen', item_id: 'gift_box', item_name: 'Подарок', item_icon: '🎁', item_price: 100, rarity: 'common', created_at: Date.now() - 40000 },
      { user_login: 'tgweb', item_id: 'nft_neon_punk', item_name: 'Neon Punk #01', item_icon: '👾', item_price: 350, rarity: 'nft', created_at: Date.now() - 25000 },
      { user_login: 'admin', item_id: 'ring_star', item_name: 'Кольцо', item_icon: '💍', item_price: 100, rarity: 'common', created_at: Date.now() - 10000 }
    ],
    deposits: [],
    withdraws: [],
    promos: {},
    logs: []
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
        users[superLogin] = {
          login: superLogin,
          passwordHash: defaultHash,
          balance: 100000,
          inventory: [],
          is_admin: true,
          is_super_admin: true
        };
      } else {
        users[superLogin].is_admin = true;
        users[superLogin].is_super_admin = true;
      }
    });

    return {
      users,
      tokens: parsed.tokens || {},
      drops: Array.isArray(parsed.drops) ? parsed.drops : [],
      deposits: Array.isArray(parsed.deposits) ? parsed.deposits : [],
      withdraws: Array.isArray(parsed.withdraws) ? parsed.withdraws : [],
      promos: parsed.promos || {},
      logs: Array.isArray(parsed.logs) ? parsed.logs : []
    };
  } catch (e) {
    return defaultDb();
  }
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function addLog(db, adminLogin, action, details) {
  db.logs.unshift({
    id: crypto.randomUUID(),
    admin_login: adminLogin,
    action,
    details,
    created_at: Date.now()
  });
  db.logs = db.logs.slice(0, 200);
}

function pushDrop(db, userLogin, item) {
  db.drops.unshift({
    user_login: userLogin,
    item_id: item.id || item.item_id || 'gift_box',
    item_name: item.name || 'Подарок',
    item_icon: item.icon || '🎁',
    item_price: Number(item.price) || 0,
    rarity: item.rarity || (item.is_nft ? 'nft' : 'common'),
    created_at: Date.now()
  });
  db.drops = db.drops.slice(0, 30);
}

function getAuthUser(req, db) {
  const token = req.headers['x-auth-token'];
  if (!token || !db.tokens[token]) return null;
  const login = db.tokens[token];
  return db.users[login] || null;
}

const activeMinesSessions = new Map();
const activeRocketSessions = new Map();

function rollWeightedCrashPoint() {
  const r = Math.random();
  if (r < 0.78) {
    return Number((1.01 + Math.random() * 0.34).toFixed(2));
  }
  if (r < 0.96) {
    return Number((1.36 + Math.random() * 0.84).toFixed(2));
  }
  return Number((2.21 + Math.random() * 2.79).toFixed(2));
}

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/api/items', (req, res) => {
  res.json(ITEMS_CATALOG);
});

app.get('/api/drops', (req, res) => {
  const db = loadDb();
  res.json(db.drops || []);
});

app.post('/api/register', (req, res) => {
  const { login, password } = req.body || {};
  const cleanLogin = String(login || '').trim();
  if (!cleanLogin || String(password || '').length < 6) {
    return res.status(400).json({ error: 'Укажите логин и пароль (от 6 символов)' });
  }
  const db = loadDb();
  if (db.users[cleanLogin]) {
    return res.status(400).json({ error: 'Такой логин уже занят' });
  }
  const isSuper = ['admin', 'tgweb', 'tagen'].includes(cleanLogin.toLowerCase());
  db.users[cleanLogin] = {
    login: cleanLogin,
    passwordHash: hashPassword(password),
    balance: isSuper ? 100000 : 1000,
    inventory: [],
    is_admin: isSuper,
    is_super_admin: isSuper
  };
  const token = crypto.randomBytes(24).toString('hex');
  db.tokens[token] = cleanLogin;
  saveDb(db);

  const u = db.users[cleanLogin];
  res.json({
    token,
    user: {
      login: u.login,
      balance: u.balance,
      inventory: u.inventory,
      is_admin: u.is_admin,
      is_super_admin: u.is_super_admin
    }
  });
});

app.post('/api/login', (req, res) => {
  const { login, password } = req.body || {};
  const cleanLogin = String(login || '').trim();
  const db = loadDb();
  const u = db.users[cleanLogin];
  if (!u || u.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  db.tokens[token] = cleanLogin;
  saveDb(db);

  res.json({
    token,
    user: {
      login: u.login,
      balance: u.balance,
      inventory: u.inventory,
      is_admin: Boolean(u.is_admin),
      is_super_admin: Boolean(u.is_super_admin)
    }
  });
});

app.get('/api/user/:login', (req, res) => {
  const db = loadDb();
  const authUser = getAuthUser(req, db);
  if (!authUser) return res.status(401).json({ error: 'Требуется авторизация' });

  const targetLogin = decodeURIComponent(req.params.login);
  if (authUser.login !== targetLogin && !authUser.is_admin && !authUser.is_super_admin) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }
  const u = db.users[targetLogin];
  if (!u) return res.status(404).json({ error: 'Пользователь не найден' });

  res.json({
    login: u.login,
    balance: u.balance,
    inventory: u.inventory || [],
    is_admin: Boolean(u.is_admin),
    is_super_admin: Boolean(u.is_super_admin)
  });
});

app.get('/api/export/my-data', (req, res) => {
  const db = loadDb();
  const authUser = getAuthUser(req, db);
  if (!authUser) return res.status(401).json({ error: 'Требуется авторизация' });
  res.json({
    exported_at: new Date().toISOString(),
    login: authUser.login,
    balance: authUser.balance,
    inventory: authUser.inventory || []
  });
});

app.post('/api/cases/open', (req, res) => {
  const { caseId } = req.body || {};
  const cfg = CASES_CONFIG[caseId];
  if (!cfg) return res.status(400).json({ error: 'Кейс не найден' });

  const db = loadDb();
  const user = getAuthUser(req, db);
  if (!user) return res.status(401).json({ error: 'Требуется авторизация' });
  if (user.balance < cfg.price) return res.status(400).json({ error: 'Недостаточно звёзд' });

  user.balance -= cfg.price;
  const template = cfg.pool[Math.floor(Math.random() * cfg.pool.length)];
  const wonItem = {
    uid: crypto.randomUUID(),
    id: template.id,
    name: template.name,
    icon: template.icon,
    price: template.price,
    rarity: template.rarity,
    is_nft: Boolean(template.is_nft)
  };
  user.inventory.push(wonItem);
  pushDrop(db, user.login, wonItem);
  saveDb(db);

  res.json({
    balance: user.balance,
    item: wonItem,
    pool: cfg.pool
  });
});

app.post('/api/games/mines', (req, res) => {
  const { action, bet, minesCount, cell } = req.body || {};
  const db = loadDb();
  const user = getAuthUser(req, db);
  if (!user) return res.status(401).json({ error: 'Требуется авторизация' });

  if (action === 'start') {
    const betNum = Number(bet) || 0;
    const mCount = [1, 3, 5, 10].includes(Number(minesCount)) ? Number(minesCount) : 3;
    const gridSize = 3;
    const totalCells = gridSize * gridSize;
    if (betNum < 10) return res.status(400).json({ error: 'Мин. ставка 10 ★' });
    if (mCount >= totalCells) return res.status(400).json({ error: 'Слишком много мин' });
    if (user.balance < betNum) return res.status(400).json({ error: 'Недостаточно средств' });

    user.balance -= betNum;
    saveDb(db);

    const bombs = new Set();
    while (bombs.size < mCount) {
      bombs.add(Math.floor(Math.random() * totalCells));
    }

    activeMinesSessions.set(user.login, {
      bet: betNum,
      minesCount: mCount,
      gridSize,
      totalCells,
      bombs: Array.from(bombs),
      opened: []
    });

    return res.json({
      balance: user.balance,
      gridSize,
      totalCells,
      minesCount: mCount
    });
  }

  const session = activeMinesSessions.get(user.login);
  if (!session) return res.status(400).json({ error: 'Активная игра не найдена' });

  if (action === 'click') {
    const idx = Number(cell);
    if (session.bombs.includes(idx)) {
      activeMinesSessions.delete(user.login);
      return res.json({ bomb: true, bombs: session.bombs });
    }
    if (!session.opened.includes(idx)) {
      session.opened.push(idx);
    }
    const mult = Number((1 + session.opened.length * (0.22 + session.minesCount * 0.08)).toFixed(2));
    const potentialWin = Math.floor(session.bet * mult);
    return res.json({
      bomb: false,
      openedCount: session.opened.length,
      multiplier: mult,
      potentialWin
    });
  }

  if (action === 'cashout') {
    if (session.opened.length === 0) {
      return res.status(400).json({ error: 'Откройте хотя бы одну ячейку' });
    }
    const mult = Number((1 + session.opened.length * (0.22 + session.minesCount * 0.08)).toFixed(2));
    const win = Math.floor(session.bet * mult);
    user.balance += win;
    saveDb(db);
    activeMinesSessions.delete(user.login);
    return res.json({ balance: user.balance, win, bombs: session.bombs });
  }

  res.status(400).json({ error: 'Неизвестное действие' });
});

app.post('/api/games/rocket', (req, res) => {
  const { action, bet, multiplier } = req.body || {};
  const db = loadDb();
  const user = getAuthUser(req, db);
  if (!user) return res.status(401).json({ error: 'Требуется авторизация' });

  if (action === 'start') {
    const betNum = Number(bet) || 0;
    if (betNum < 10) return res.status(400).json({ error: 'Мин. ставка 10 ★' });
    if (user.balance < betNum) return res.status(400).json({ error: 'Недостаточно средств' });

    user.balance -= betNum;
    saveDb(db);

    const crashPoint = Math.min(5.0, Math.max(1.01, rollWeightedCrashPoint()));
    activeRocketSessions.set(user.login, {
      bet: betNum,
      crashPoint
    });

    return res.json({ balance: user.balance, crashPoint });
  }

  const session = activeRocketSessions.get(user.login);
  if (!session) return res.status(400).json({ error: 'Раунд ракетки не найден' });

  if (action === 'cashout') {
    const claimed = Math.max(1.0, Math.min(5.0, Number(multiplier) || 1.0));
    activeRocketSessions.delete(user.login);
    if (claimed >= session.crashPoint) {
      return res.json({ crashed: true, crashPoint: session.crashPoint });
    }
    const win = Math.floor(session.bet * claimed);
    user.balance += win;
    saveDb(db);
    return res.json({
      crashed: false,
      multiplier: claimed,
      crashPoint: session.crashPoint,
      win,
      balance: user.balance
    });
  }

  if (action === 'crash') {
    const cp = session.crashPoint;
    activeRocketSessions.delete(user.login);
    return res.json({ crashPoint: cp });
  }

  res.status(400).json({ error: 'Неизвестное действие' });
});

app.post('/api/upgrade', (req, res) => {
  const { targetItemId, targetItem, betStars, myUid } = req.body || {};
  const db = loadDb();
  const user = getAuthUser(req, db);
  if (!user) return res.status(401).json({ error: 'Требуется авторизация' });

  let betPrice = 0;
  let removedItemIndex = -1;

  if (betStars !== undefined) {
    betPrice = Number(betStars) || 0;
    if (betPrice < 10) return res.status(400).json({ error: 'Мин. ставка 10 ★' });
    if (user.balance < betPrice) return res.status(400).json({ error: 'Недостаточно звёзд' });
  } else {
    removedItemIndex = (user.inventory || []).findIndex(i => i.uid === myUid);
    if (removedItemIndex === -1) return res.status(400).json({ error: 'Предмет не найден в инвентаре' });
    betPrice = Number(user.inventory[removedItemIndex].price) || 0;
  }

  const catalogTarget = ITEMS_CATALOG.find(i => i.id === targetItemId);
  const invTarget = (user.inventory || []).find(i => i.id === targetItemId || i.uid === targetItemId);
  const finalTarget = catalogTarget || invTarget || targetItem;
  if (!finalTarget) return res.status(400).json({ error: 'Цель апгрейда не найдена' });

  const targetPrice = Number(finalTarget.price) || 0;
  if (betPrice <= 0 || targetPrice <= betPrice) {
    return res.status(400).json({ error: 'Цель должна быть дороже ставки' });
  }

  if (betStars !== undefined) {
    user.balance -= betPrice;
  } else {
    user.inventory.splice(removedItemIndex, 1);
  }

  let chance = (betPrice / targetPrice) * 50;
  if (chance > 50) chance = 50;
  if (chance < 1) chance = 1;

  const win = Math.random() * 100 < chance;
  let wonItem = null;

  if (win) {
    wonItem = {
      uid: crypto.randomUUID(),
      id: finalTarget.id || crypto.randomUUID(),
      name: finalTarget.name,
      icon: finalTarget.icon || '🎁',
      price: targetPrice,
      rarity: finalTarget.rarity || (finalTarget.is_nft ? 'nft' : 'rare'),
      is_nft: Boolean(finalTarget.is_nft || String(finalTarget.rarity).toLowerCase() === 'nft')
    };
    user.inventory.push(wonItem);
    pushDrop(db, user.login, wonItem);
  }

  saveDb(db);
  res.json({ win, chance, item: wonItem, balance: user.balance });
});

app.post('/api/inventory/sell', (req, res) => {
  const { uid } = req.body || {};
  const db = loadDb();
  const user = getAuthUser(req, db);
  if (!user) return res.status(401).json({ error: 'Требуется авторизация' });

  const idx = (user.inventory || []).findIndex(i => i.uid === uid);
  if (idx === -1) return res.status(404).json({ error: 'Предмет не найден' });

  const [sold] = user.inventory.splice(idx, 1);
  const price = Number(sold.price) || 0;
  user.balance += price;
  saveDb(db);
  res.json({ balance: user.balance, soldPrice: price });
});

app.post('/api/wallet/deposit', (req, res) => {
  const amount = Number((req.body || {}).amount) || 0;
  if (amount <= 0) return res.status(400).json({ error: 'Некорректная сумма' });
  const db = loadDb();
  const user = getAuthUser(req, db);
  if (!user) return res.status(401).json({ error: 'Требуется авторизация' });

  db.deposits.push({ id: crypto.randomUUID(), user_login: user.login, amount_stars: amount, created_at: Date.now() });
  saveDb(db);
  res.json({ ok: true });
});

app.post('/api/wallet/withdraw', (req, res) => {
  const amount = Number((req.body || {}).amount) || 0;
  if (amount <= 0) return res.status(400).json({ error: 'Некорректная сумма' });
  const db = loadDb();
  const user = getAuthUser(req, db);
  if (!user) return res.status(401).json({ error: 'Требуется авторизация' });
  if (user.balance < amount) return res.status(400).json({ error: 'Недостаточно средств' });

  user.balance -= amount;
  db.withdraws.push({ id: crypto.randomUUID(), user_login: user.login, amount_stars: amount, created_at: Date.now() });
  saveDb(db);
  res.json({ ok: true, balance: user.balance });
});

app.get('/api/admin/players', (req, res) => {
  const db = loadDb();
  const user = getAuthUser(req, db);
  if (!user || (!user.is_admin && !user.is_super_admin)) return res.status(403).json({ error: 'Нет прав' });

  const list = Object.values(db.users).map(u => ({
    login: u.login,
    balance: u.balance,
    nft_count: (u.inventory || []).filter(i => i.is_nft || String(i.rarity).toLowerCase() === 'nft').length,
    is_admin: Boolean(u.is_admin),
    is_super_admin: Boolean(u.is_super_admin)
  }));
  res.json(list);
});

app.post('/api/admin/give-stars', (req, res) => {
  const { targetLogin, amount } = req.body || {};
  const db = loadDb();
  const admin = getAuthUser(req, db);
  if (!admin || (!admin.is_admin && !admin.is_super_admin)) return res.status(403).json({ error: 'Нет прав' });

  const target = db.users[String(targetLogin || '').trim()];
  const num = Number(amount) || 0;
  if (!target || num <= 0) return res.status(400).json({ error: 'Проверьте логин и сумму' });

  target.balance += num;
  addLog(db, admin.login, 'give-stars', `${target.login}: +${num}★`);
  saveDb(db);
  res.json({ ok: true });
});

app.post('/api/admin/take-stars', (req, res) => {
  const { targetLogin, amount } = req.body || {};
  const db = loadDb();
  const admin = getAuthUser(req, db);
  if (!admin || !admin.is_super_admin) return res.status(403).json({ error: 'Только для главного админа' });

  const target = db.users[String(targetLogin || '').trim()];
  const num = Number(amount) || 0;
  if (!target || num <= 0) return res.status(400).json({ error: 'Проверьте логин и сумму' });

  target.balance = Math.max(0, target.balance - num);
  addLog(db, admin.login, 'take-stars', `${target.login}: -${num}★`);
  saveDb(db);
  res.json({ ok: true });
});

app.post('/api/admin/give-nft', (req, res) => {
  const { targetLogin, item } = req.body || {};
  const db = loadDb();
  const admin = getAuthUser(req, db);
  if (!admin || (!admin.is_admin && !admin.is_super_admin)) return res.status(403).json({ error: 'Нет прав' });

  const target = db.users[String(targetLogin || '').trim()];
  if (!target || !item || !item.name) return res.status(400).json({ error: 'Неверные данные NFT' });

  const nftObj = {
    uid: crypto.randomUUID(),
    id: item.id || `nft_${Date.now()}`,
    name: item.name,
    icon: item.icon || '💎',
    price: Number(item.price) || 100,
    rarity: 'nft',
    is_nft: true
  };
  target.inventory.push(nftObj);
  pushDrop(db, target.login, nftObj);
  addLog(db, admin.login, 'give-nft', `${target.login}: ${nftObj.name}`);
  saveDb(db);
  res.json({ ok: true });
});

app.get('/api/admin/withdraws', (req, res) => {
  const db = loadDb();
  const admin = getAuthUser(req, db);
  if (!admin || !admin.is_super_admin) return res.status(403).json({ error: 'Нет прав' });
  res.json(db.withdraws);
});

app.post('/api/admin/withdraws/accept', (req, res) => {
  const { id } = req.body || {};
  const db = loadDb();
  const admin = getAuthUser(req, db);
  if (!admin || !admin.is_super_admin) return res.status(403).json({ error: 'Нет прав' });
  db.withdraws = db.withdraws.filter(w => w.id !== id);
  addLog(db, admin.login, 'withdraw-accept', id);
  saveDb(db);
  res.json({ ok: true });
});

app.get('/api/admin/deposits', (req, res) => {
  const db = loadDb();
  const admin = getAuthUser(req, db);
  if (!admin || !admin.is_super_admin) return res.status(403).json({ error: 'Нет прав' });
  res.json(db.deposits);
});

app.post('/api/admin/deposit/accept', (req, res) => {
  const { id } = req.body || {};
  const db = loadDb();
  const admin = getAuthUser(req, db);
  if (!admin || !admin.is_super_admin) return res.status(403).json({ error: 'Нет прав' });

  const idx = db.deposits.findIndex(d => d.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Заявка не найдена' });
  const [dep] = db.deposits.splice(idx, 1);
  if (db.users[dep.user_login]) {
    db.users[dep.user_login].balance += Number(dep.amount_stars) || 0;
  }
  addLog(db, admin.login, 'deposit-accept', `${dep.user_login}: +${dep.amount_stars}★`);
  saveDb(db);
  res.json({ ok: true });
});

app.post('/api/admin/create-promo', (req, res) => {
  const { code, stars, limit } = req.body || {};
  const db = loadDb();
  const admin = getAuthUser(req, db);
  if (!admin || !admin.is_super_admin) return res.status(403).json({ error: 'Нет прав' });
  if (!code) return res.status(400).json({ error: 'Укажите код' });
  db.promos[String(code).trim()] = { stars: Number(stars) || 100, limit: Number(limit) || 10 };
  addLog(db, admin.login, 'create-promo', String(code).trim());
  saveDb(db);
  res.json({ ok: true });
});

app.post('/api/admin/make-admin', (req, res) => {
  const { targetLogin } = req.body || {};
  const db = loadDb();
  const admin = getAuthUser(req, db);
  if (!admin || !admin.is_super_admin) return res.status(403).json({ error: 'Нет прав' });
  const target = db.users[String(targetLogin || '').trim()];
  if (!target) return res.status(404).json({ error: 'Игрок не найден' });
  target.is_admin = true;
  addLog(db, admin.login, 'make-admin', target.login);
  saveDb(db);
  res.json({ ok: true });
});

app.post('/api/admin/remove-admin', (req, res) => {
  const { targetLogin } = req.body || {};
  const db = loadDb();
  const admin = getAuthUser(req, db);
  if (!admin || !admin.is_super_admin) return res.status(403).json({ error: 'Нет прав' });
  const target = db.users[String(targetLogin || '').trim()];
  if (!target) return res.status(404).json({ error: 'Игрок не найден' });
  target.is_admin = false;
  addLog(db, admin.login, 'remove-admin', target.login);
  saveDb(db);
  res.json({ ok: true });
});

app.get('/api/admin/logs', (req, res) => {
  const db = loadDb();
  const admin = getAuthUser(req, db);
  if (!admin || !admin.is_super_admin) return res.status(403).json({ error: 'Нет прав' });
  res.json(db.logs);
});

app.get('/api/admin/download-db', (req, res) => {
  const db = loadDb();
  const admin = getAuthUser(req, db);
  if (!admin || !admin.is_super_admin) return res.status(403).json({ error: 'Нет прав' });
  res.json(db);
});

app.listen(PORT, () => {
  console.log(`TagenGame server running on port ${PORT}`);
});
