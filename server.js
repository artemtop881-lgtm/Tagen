const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'database.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(express.json({ limit: '8mb' }));
app.use(express.static(PUBLIC_DIR));

const CASES = {
  starter: { id: 'starter', name: 'Стартовый', price: 100 },
  pro:     { id: 'pro',     name: 'Про',        price: 1000 },
  magic:   { id: 'magic',   name: 'Магический', price: 2500 },
  winter:  { id: 'winter',  name: 'Зимний',     price: 3000 },
  legend:  { id: 'legend',  name: 'Легенда',    price: 5000 },
  inferno: { id: 'inferno', name: 'Адский',     price: 7500 }
};

const DEFAULT_ITEMS = [
  { id: 'bear_mini',   name: 'Мишка',       icon: '/items/bear/1.png',      fallbackEmoji: '🧸', price: 35,   rarity: 'common', is_nft: false },
  { id: 'cap_mini',    name: 'Кепка',       icon: '/items/cap/1.png',       fallbackEmoji: '🧢', price: 70,   rarity: 'common', is_nft: false },
  { id: 'cig_pack',    name: 'Сигарета',    icon: '/items/cigarette/1.png', fallbackEmoji: '🚬', price: 180,  rarity: 'rare',   is_nft: false },
  { id: 'heart_gift',  name: 'Сердце',      icon: '/items/heart/1.png',     fallbackEmoji: '💖', price: 650,  rarity: 'rare',   is_nft: false },
  { id: 'rose_gift',   name: 'Роза',        icon: '/items/rose/1.png',      fallbackEmoji: '🌹', price: 1800, rarity: 'epic',   is_nft: false },
  { id: 'skull_royal', name: 'Череп NFT',   icon: '/items/skull/1.png',     fallbackEmoji: '💀', price: 4200, rarity: 'nft',    is_nft: true },
  { id: 'dragon_myth', name: 'Дракон NFT',  icon: '/items/bear/2.png',      fallbackEmoji: '🐉', price: 9500, rarity: 'nft',    is_nft: true }
];

const activeMines = new Map();
const activeRockets = new Map();

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function createInitialDB() {
  const superSalt = crypto.randomBytes(16).toString('hex');
  return {
    users: {
      admin: {
        login: 'admin',
        salt: superSalt,
        passwordHash: hashPassword('admin123', superSalt),
        balance: 5000,
        inventory: [],
        is_admin: true,
        is_super_admin: true,
        created_at: Date.now()
      }
    },
    sessions: {},
    items: DEFAULT_ITEMS.slice(),
    drops: [],
    chat: [],
    deposits: [],
    withdraws: [],
    promos: {},
    logs: []
  };
}

function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const init = createInitialDB();
      writeDB(init);
      return init;
    }
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return {
      users: parsed.users || {},
      sessions: parsed.sessions || {},
      items: Array.isArray(parsed.items) && parsed.items.length > 0 ? parsed.items : DEFAULT_ITEMS.slice(),
      drops: Array.isArray(parsed.drops) ? parsed.drops : [],
      chat: Array.isArray(parsed.chat) ? parsed.chat : [],
      deposits: Array.isArray(parsed.deposits) ? parsed.deposits : [],
      withdraws: Array.isArray(parsed.withdraws) ? parsed.withdraws : [],
      promos: parsed.promos || {},
      logs: Array.isArray(parsed.logs) ? parsed.logs : []
    };
  } catch (err) {
    console.error('readDB error:', err);
    return createInitialDB();
  }
}

function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function addLog(db, adminLogin, action, details) {
  db.logs.unshift({
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    admin_login: adminLogin,
    action,
    details: String(details || ''),
    created_at: Date.now()
  });
  if (db.logs.length > 200) db.logs.length = 200;
}

function pushDrop(db, userLogin, itemName, itemIcon, isWin = true) {
  db.drops.unshift({
    id: `drop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    user_login: userLogin,
    item_name: itemName,
    item_icon: itemIcon || '🎁',
    is_win: Boolean(isWin),
    created_at: Date.now()
  });
  if (db.drops.length > 30) db.drops.length = 30;
}

function getSessionUser(db, req) {
  const token = req.headers['x-auth-token'] || req.body?.token;
  if (!token || !db.sessions || !db.sessions[token]) return null;
  const sess = db.sessions[token];
  const login = typeof sess === 'string' ? sess : sess.login;
  if (!login) return null;
  const user = db.users[login] || Object.values(db.users).find((u) => u && u.login === login);
  return user || null;
}

function requireAuth(req, res, next) {
  const db = readDB();
  const user = getSessionUser(db, req);
  if (!user) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  req.db = db;
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || (!req.user.is_admin && !req.user.is_super_admin)) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || !req.user.is_super_admin) {
    return res.status(403).json({ error: 'Доступно только главному администратору' });
  }
  next();
}

/* ============================================================
   AUTH & USER
   ============================================================ */
app.post('/api/register', (req, res) => {
  try {
    const login = String(req.body?.login || '').trim();
    const password = String(req.body?.password || '');
    if (!login || login.length < 2 || password.length < 6) {
      return res.status(400).json({ error: 'Укажите логин и пароль (от 6 символов)' });
    }
    const db = readDB();
    if (db.users[login]) {
      return res.status(400).json({ error: 'Такой логин уже занят' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    db.users[login] = {
      login,
      salt,
      passwordHash: hashPassword(password, salt),
      balance: 500,
      inventory: [],
      is_admin: false,
      is_super_admin: false,
      created_at: Date.now()
    };
    const token = crypto.randomBytes(24).toString('hex');
    db.sessions[token] = { login, created_at: Date.now() };
    writeDB(db);
    return res.json({ ok: true, token, user: { login, balance: 500 } });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Ошибка регистрации' });
  }
});

app.post('/api/login', (req, res) => {
  try {
    const login = String(req.body?.login || '').trim();
    const password = String(req.body?.password || '');
    const db = readDB();
    const user = db.users[login];
    if (!user) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    const computed = hashPassword(password, user.salt || '');
    if (computed !== user.passwordHash) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    db.sessions[token] = { login: user.login, created_at: Date.now() };
    writeDB(db);
    return res.json({
      ok: true,
      token,
      user: {
        login: user.login,
        balance: Number(user.balance) || 0,
        is_admin: Boolean(user.is_admin),
        is_super_admin: Boolean(user.is_super_admin)
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Ошибка входа' });
  }
});

app.get('/api/user/:login', requireAuth, (req, res) => {
  const targetLogin = String(req.params.login || '').trim();
  const target = req.db.users[targetLogin];
  if (!target) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  return res.json({
    login: target.login,
    balance: Number(target.balance) || 0,
    inventory: Array.isArray(target.inventory) ? target.inventory : [],
    is_admin: Boolean(target.is_admin),
    is_super_admin: Boolean(target.is_super_admin)
  });
});

app.get('/api/items', (req, res) => {
  const db = readDB();
  return res.json(db.items);
});

app.get('/api/drops', (req, res) => {
  const db = readDB();
  return res.json(db.drops.slice(0, 20));
});

/* ============================================================
   INVENTORY SELL
   ============================================================ */
app.post('/api/inventory/sell', requireAuth, (req, res) => {
  try {
    const uid = req.body?.uid || req.body?.itemUid || req.body?.id;
    if (!uid) {
      return res.status(400).json({ error: 'Не указан uid предмета' });
    }
    const user = req.user;
    if (!Array.isArray(user.inventory)) user.inventory = [];
    const idx = user.inventory.findIndex((it) => String(it.uid) === String(uid));
    if (idx === -1) {
      return res.status(404).json({ error: 'Предмет не найден в инвентаре' });
    }
    const [soldItem] = user.inventory.splice(idx, 1);
    const sellPrice = Math.max(0, Number(soldItem.price) || 0);
    user.balance = (Number(user.balance) || 0) + sellPrice;
    writeDB(req.db);
    return res.json({
      ok: true,
      balance: user.balance,
      soldPrice,
      inventory: user.inventory
    });
  } catch (err) {
    console.error('Sell error:', err);
    return res.status(500).json({ error: 'Ошибка при продаже предмета' });
  }
});

/* ============================================================
   CASES (90% дешевле цены кейса, ~10% дороже цены кейса)
   ============================================================ */
app.post('/api/cases/open', requireAuth, (req, res) => {
  try {
    const caseId = String(req.body?.caseId || '');
    const caseInfo = CASES[caseId];
    if (!caseInfo) {
      return res.status(400).json({ error: 'Неизвестный кейс' });
    }

    const db = req.db;
    const user = req.user;
    const price = Number(caseInfo.price);
    const currentBalance = Number(user.balance) || 0;
    if (currentBalance < price) {
      return res.status(400).json({ error: 'Недостаточно звёзд' });
    }

    const catalog = Array.isArray(db.items) && db.items.length > 0 ? db.items : DEFAULT_ITEMS;
    const cheapPool = catalog.filter((it) => Number(it.price) > 0 && Number(it.price) < price);
    const profitPool = catalog.filter((it) => Number(it.price) >= price);

    const pickWeighted = (list) => {
      if (!list || list.length === 0) return null;
      const weights = list.map((it) => {
        const p = Math.max(1, Number(it.price) || 1);
        return Math.max(1, Math.round(10000 / p));
      });
      const total = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * total;
      for (let i = 0; i < list.length; i++) {
        r -= weights[i];
        if (r <= 0) return list[i];
      }
      return list[list.length - 1];
    };

    const isProfitRoll = Math.random() < 0.10 && profitPool.length > 0;
    let template = isProfitRoll ? pickWeighted(profitPool) : pickWeighted(cheapPool);

    if (!template) {
      const cheapPrice = Math.max(10, Math.round(price * (0.3 + Math.random() * 0.5)));
      template = {
        id: `cheap_${caseInfo.id}_${cheapPrice}`,
        name: `Подарок (${cheapPrice}★)`,
        icon: '/items/bear/1.png',
        fallbackEmoji: '🎁',
        price: cheapPrice,
        rarity: 'common',
        is_nft: false
      };
    }

    user.balance = currentBalance - price;
    if (!Array.isArray(user.inventory)) user.inventory = [];

    const wonItem = {
      uid: `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      id: template.id,
      name: template.name,
      icon: template.icon,
      fallbackEmoji: template.fallbackEmoji || '🎁',
      price: Number(template.price) || 0,
      rarity: template.rarity || 'common',
      is_nft: Boolean(template.is_nft)
    };

    user.inventory.push(wonItem);
    pushDrop(db, user.login, `выбил ${wonItem.name} (${caseInfo.name})`, wonItem.icon, true);
    writeDB(db);

    const pool = [...cheapPool, ...profitPool];
    return res.json({
      ok: true,
      balance: user.balance,
      item: wonItem,
      pool: pool.length > 0 ? pool : [wonItem]
    });
  } catch (err) {
    console.error('Case open error:', err);
    return res.status(500).json({ error: 'Ошибка при открытии кейса' });
  }
});

/* ============================================================
   MINES (сетка зависит от количества мин)
   ============================================================ */
function getGridSizeByMines(minesCount) {
  const m = Math.max(1, Number(minesCount) || 1);
  if (m <= 2) return 3;
  if (m <= 5) return 4;
  if (m <= 9) return 5;
  return 6;
}

app.post('/api/games/mines', requireAuth, (req, res) => {
  try {
    const action = String(req.body?.action || '');
    const db = req.db;
    const user = req.user;
    const sessionKey = user.login;

    if (action === 'start') {
      const bet = Math.floor(Number(req.body?.bet) || 0);
      let minesCount = Math.floor(Number(req.body?.minesCount) || 3);
      if (bet < 10) return res.status(400).json({ error: 'Мин. ставка 10 ★' });
      if ((Number(user.balance) || 0) < bet) return res.status(400).json({ error: 'Недостаточно звёзд' });

      const gridSize = getGridSizeByMines(minesCount);
      const totalCells = gridSize * gridSize;
      if (minesCount < 1) minesCount = 1;
      if (minesCount > totalCells - 1) minesCount = totalCells - 1;

      const indices = Array.from({ length: totalCells }, (_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      const bombs = indices.slice(0, minesCount);

      user.balance = (Number(user.balance) || 0) - bet;
      activeMines.set(sessionKey, {
        bet,
        minesCount,
        gridSize,
        totalCells,
        bombs,
        opened: []
      });
      writeDB(db);

      return res.json({
        ok: true,
        balance: user.balance,
        gridSize,
        totalCells,
        minesCount
      });
    }

    const game = activeMines.get(sessionKey);
    if (!game) {
      return res.status(400).json({ error: 'Активная игра не найдена' });
    }

    if (action === 'click') {
      const cell = Number(req.body?.cell);
      if (!Number.isInteger(cell) || cell < 0 || cell >= game.totalCells) {
        return res.status(400).json({ error: 'Некорректная клетка' });
      }
      if (game.opened.includes(cell)) {
        return res.status(400).json({ error: 'Клетка уже открыта' });
      }
      if (game.bombs.includes(cell)) {
        activeMines.delete(sessionKey);
        pushDrop(db, user.login, `подорвался на мине (${game.bet} ★)`, '💣', false);
        writeDB(db);
        return res.json({ ok: true, bomb: true, bombs: game.bombs });
      }

      game.opened.push(cell);
      const openedCount = game.opened.length;
      const safeTotal = game.totalCells - game.minesCount;
      const multiplier = Number((1 + openedCount * (game.minesCount / Math.max(1, safeTotal)) * 1.35).toFixed(2));
      const potentialWin = Math.floor(game.bet * multiplier);

      return res.json({
        ok: true,
        bomb: false,
        openedCount,
        multiplier,
        potentialWin
      });
    }

    if (action === 'cashout') {
      const openedCount = game.opened.length;
      if (openedCount < 1) {
        return res.status(400).json({ error: 'Откройте хотя бы одну клетку' });
      }
      const safeTotal = game.totalCells - game.minesCount;
      const multiplier = Number((1 + openedCount * (game.minesCount / Math.max(1, safeTotal)) * 1.35).toFixed(2));
      const win = Math.floor(game.bet * multiplier);
      user.balance = (Number(user.balance) || 0) + win;
      const bombs = game.bombs;
      activeMines.delete(sessionKey);
      pushDrop(db, user.login, `забрал ${win} ★ (${multiplier.toFixed(2)}x)`, '💎', true);
      writeDB(db);
      return res.json({ ok: true, win, balance: user.balance, bombs });
    }

    return res.status(400).json({ error: 'Неизвестное действие' });
  } catch (err) {
    console.error('Mines error:', err);
    return res.status(500).json({ error: 'Ошибка в игре Мины' });
  }
});

/* ============================================================
   ROCKET
   ============================================================ */
app.post('/api/games/rocket', requireAuth, (req, res) => {
  try {
    const action = String(req.body?.action || '');
    const db = req.db;
    const user = req.user;
    const key = user.login;

    if (action === 'start') {
      const bet = Math.floor(Number(req.body?.bet) || 0);
      if (bet < 10) return res.status(400).json({ error: 'Мин. ставка 10 ★' });
      if ((Number(user.balance) || 0) < bet) return res.status(400).json({ error: 'Недостаточно звёзд' });

      const r = Math.random();
      const crashPoint = Number(Math.min(5.0, Math.max(1.02, 1 + Math.pow(r, 2.2) * 4.0)).toFixed(2));
      user.balance = (Number(user.balance) || 0) - bet;
      activeRockets.set(key, { bet, crashPoint, settled: false });
      writeDB(db);
      return res.json({ ok: true, balance: user.balance, crashPoint });
    }

    const round = activeRockets.get(key);
    if (!round || round.settled) {
      return res.status(400).json({ error: 'Раунд ракетки не активен' });
    }

    if (action === 'crash') {
      round.settled = true;
      activeRockets.delete(key);
      pushDrop(db, user.login, `проиграл на ${round.crashPoint.toFixed(2)}x`, '🚀', false);
      writeDB(db);
      return res.json({ ok: true, crashPoint: round.crashPoint });
    }

    if (action === 'cashout') {
      const requestedMult = Math.max(1.0, Math.min(5.0, Number(req.body?.multiplier) || 1.0));
      round.settled = true;
      activeRockets.delete(key);
      if (requestedMult >= round.crashPoint) {
        pushDrop(db, user.login, `проиграл на ${round.crashPoint.toFixed(2)}x`, '🚀', false);
        writeDB(db);
        return res.json({ ok: true, crashed: true, crashPoint: round.crashPoint });
      }
      const win = Math.floor(round.bet * requestedMult);
      user.balance = (Number(user.balance) || 0) + win;
      pushDrop(db, user.login, `забрал ${win} ★ на ${requestedMult.toFixed(2)}x`, '🚀', true);
      writeDB(db);
      return res.json({
        ok: true,
        crashed: false,
        multiplier: requestedMult,
        crashPoint: round.crashPoint,
        win,
        balance: user.balance
      });
    }

    return res.status(400).json({ error: 'Неизвестное действие' });
  } catch (err) {
    console.error('Rocket error:', err);
    return res.status(500).json({ error: 'Ошибка в игре Ракетка' });
  }
});

/* ============================================================
   UPGRADE
   ============================================================ */
app.post('/api/upgrade', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const user = req.user;
    const targetItemId = String(req.body?.targetItemId || '');
    const customTarget = req.body?.targetItem;
    const target = (customTarget && customTarget.price)
      ? customTarget
      : (db.items.find((it) => String(it.id) === targetItemId) || DEFAULT_ITEMS.find((it) => String(it.id) === targetItemId));

    if (!target || !Number(target.price)) {
      return res.status(400).json({ error: 'Не выбран целевой предмет' });
    }

    let betPrice = 0;
    let invIndex = -1;

    if (req.body?.betStars) {
      betPrice = Math.floor(Number(req.body.betStars) || 0);
      if (betPrice < 10 || (Number(user.balance) || 0) < betPrice) {
        return res.status(400).json({ error: 'Недостаточно звёзд для ставки' });
      }
      user.balance = (Number(user.balance) || 0) - betPrice;
    } else if (req.body?.myUid) {
      if (!Array.isArray(user.inventory)) user.inventory = [];
      invIndex = user.inventory.findIndex((it) => String(it.uid) === String(req.body.myUid));
      if (invIndex === -1) {
        return res.status(404).json({ error: 'Предмет ставки не найден' });
      }
      betPrice = Number(user.inventory[invIndex].price) || 0;
      user.inventory.splice(invIndex, 1);
    } else {
      return res.status(400).json({ error: 'Укажите ставку' });
    }

    const targetPrice = Number(target.price);
    if (betPrice <= 0 || betPrice >= targetPrice) {
      return res.status(400).json({ error: 'Цель должна быть дороже ставки' });
    }

    const chance = Number(Math.min(50, Math.max(1, (betPrice / targetPrice) * 50)).toFixed(1));
    const win = Math.random() * 100 < chance;

    let wonItem = null;
    if (win) {
      wonItem = {
        uid: `upg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        id: target.id || `target_${Date.now()}`,
        name: target.name,
        icon: target.icon,
        fallbackEmoji: target.fallbackEmoji || '⚡',
        price: targetPrice,
        rarity: target.rarity || 'epic',
        is_nft: Boolean(target.is_nft)
      };
      if (!Array.isArray(user.inventory)) user.inventory = [];
      user.inventory.push(wonItem);
      pushDrop(db, user.login, `апнул ${wonItem.name} (${chance}%)`, wonItem.icon, true);
    } else {
      pushDrop(db, user.login, `не апнул ${target.name} (${chance}%)`, '⚡', false);
    }

    writeDB(db);
    return res.json({ ok: true, win, chance, item: wonItem, balance: user.balance });
  } catch (err) {
    console.error('Upgrade error:', err);
    return res.status(500).json({ error: 'Ошибка апгрейда' });
  }
});

/* ============================================================
   WALLET, CHAT, EXPORT & ADMIN
   ============================================================ */
app.post('/api/wallet/deposit', requireAuth, (req, res) => {
  const amount = Math.floor(Number(req.body?.amount) || 0);
  if (amount <= 0) return res.status(400).json({ error: 'Неверная сумма' });
  req.db.deposits.unshift({
    id: `dep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    user_login: req.user.login,
    amount_stars: amount,
    status: 'pending',
    created_at: Date.now()
  });
  writeDB(req.db);
  return res.json({ ok: true });
});

app.post('/api/wallet/withdraw', requireAuth, (req, res) => {
  const amount = Math.floor(Number(req.body?.amount) || 0);
  if (amount <= 0) return res.status(400).json({ error: 'Неверная сумма' });
  if ((Number(req.user.balance) || 0) < amount) return res.status(400).json({ error: 'Недостаточно средств' });
  req.user.balance = (Number(req.user.balance) || 0) - amount;
  req.db.withdraws.unshift({
    id: `wd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    user_login: req.user.login,
    amount_stars: amount,
    status: 'pending',
    created_at: Date.now()
  });
  writeDB(req.db);
  return res.json({ ok: true, balance: req.user.balance });
});

app.get('/api/chat', requireAuth, (req, res) => {
  return res.json(req.db.chat.slice(-60));
});

app.post('/api/chat/send', requireAuth, (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 500);
  const file = req.body?.file || null;
  if (!text && !file) return res.status(400).json({ error: 'Пустое сообщение' });
  req.db.chat.push({
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    login: req.user.login,
    is_admin: Boolean(req.user.is_admin || req.user.is_super_admin),
    text,
    file,
    created_at: Date.now()
  });
  if (req.db.chat.length > 150) req.db.chat.splice(0, req.db.chat.length - 150);
  writeDB(req.db);
  return res.json({ ok: true });
});

app.post('/api/chat/admin', requireAuth, requireAdmin, (req, res) => {
  const action = String(req.body?.action || '');
  if (action === 'clear') {
    req.db.chat = [];
    addLog(req.db, req.user.login, 'CLEAR_CHAT', 'Очистил чат');
    writeDB(req.db);
    return res.json({ ok: true });
  }
  if (action === 'delete') {
    const msgId = String(req.body?.msgId || '');
    req.db.chat = req.db.chat.filter((m) => String(m.id) !== msgId);
    writeDB(req.db);
    return res.json({ ok: true });
  }
  return res.status(400).json({ error: 'Неизвестное действие' });
});

app.get('/api/export/my-data', requireAuth, (req, res) => {
  const u = req.user;
  return res.json({
    login: u.login,
    balance: u.balance,
    inventory: u.inventory || [],
    exported_at: new Date().toISOString()
  });
});

app.get('/api/admin/download-db', requireAuth, requireSuperAdmin, (req, res) => {
  return res.json(req.db);
});

app.get('/api/admin/players', requireAuth, requireAdmin, (req, res) => {
  const list = Object.values(req.db.users).map((u) => ({
    login: u.login,
    balance: Number(u.balance) || 0,
    is_admin: Boolean(u.is_admin),
    is_super_admin: Boolean(u.is_super_admin),
    nft_count: (u.inventory || []).filter((i) => i.is_nft || i.rarity === 'nft').length
  }));
  return res.json(list);
});

app.post('/api/admin/give-stars', requireAuth, requireAdmin, (req, res) => {
  const target = req.db.users[String(req.body?.targetLogin || '').trim()];
  const amount = Math.floor(Number(req.body?.amount) || 0);
  if (!target || !amount) return res.status(400).json({ error: 'Проверьте логин и сумму' });
  target.balance = (Number(target.balance) || 0) + amount;
  addLog(req.db, req.user.login, 'GIVE_STARS', `${target.login}: +${amount}`);
  writeDB(req.db);
  return res.json({ ok: true });
});

app.post('/api/admin/take-stars', requireAuth, requireSuperAdmin, (req, res) => {
  const target = req.db.users[String(req.body?.targetLogin || '').trim()];
  const amount = Math.floor(Number(req.body?.amount) || 0);
  if (!target || !amount) return res.status(400).json({ error: 'Проверьте логин и сумму' });
  target.balance = Math.max(0, (Number(target.balance) || 0) - amount);
  addLog(req.db, req.user.login, 'TAKE_STARS', `${target.login}: -${amount}`);
  writeDB(req.db);
  return res.json({ ok: true });
});

app.post('/api/admin/give-nft', requireAuth, requireAdmin, (req, res) => {
  const target = req.db.users[String(req.body?.targetLogin || '').trim()];
  const item = req.body?.item;
  if (!target || !item || !item.name) return res.status(400).json({ error: 'Проверьте данные NFT' });
  if (!Array.isArray(target.inventory)) target.inventory = [];
  target.inventory.push({
    uid: `nft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    id: item.id || `nft_${Date.now()}`,
    name: item.name,
    icon: item.icon || '💎',
    price: Number(item.price) || 100,
    rarity: 'nft',
    is_nft: true
  });
  addLog(req.db, req.user.login, 'GIVE_NFT', `${target.login}: ${item.name}`);
  writeDB(req.db);
  return res.json({ ok: true });
});

app.get('/api/admin/deposits', requireAuth, requireSuperAdmin, (req, res) => {
  return res.json(req.db.deposits.filter((d) => d.status === 'pending'));
});

app.post('/api/admin/deposit/accept', requireAuth, requireSuperAdmin, (req, res) => {
  const dep = req.db.deposits.find((d) => String(d.id) === String(req.body?.id));
  if (!dep || dep.status !== 'pending') return res.status(404).json({ error: 'Заявка не найдена' });
  const user = req.db.users[dep.user_login];
  if (user) user.balance = (Number(user.balance) || 0) + Number(dep.amount_stars || 0);
  dep.status = 'accepted';
  addLog(req.db, req.user.login, 'ACCEPT_DEPOSIT', `${dep.user_login}: +${dep.amount_stars}`);
  writeDB(req.db);
  return res.json({ ok: true });
});

app.get('/api/admin/withdraws', requireAuth, requireSuperAdmin, (req, res) => {
  return res.json(req.db.withdraws.filter((w) => w.status === 'pending'));
});

app.post('/api/admin/withdraws/accept', requireAuth, requireSuperAdmin, (req, res) => {
  const wd = req.db.withdraws.find((w) => String(w.id) === String(req.body?.id));
  if (!wd || wd.status !== 'pending') return res.status(404).json({ error: 'Заявка не найдена' });
  wd.status = 'accepted';
  addLog(req.db, req.user.login, 'ACCEPT_WITHDRAW', `${wd.user_login}: ${wd.amount_stars}`);
  writeDB(req.db);
  return res.json({ ok: true });
});

app.post('/api/admin/create-promo', requireAuth, requireSuperAdmin, (req, res) => {
  const code = String(req.body?.code || '').trim();
  const stars = Math.floor(Number(req.body?.stars) || 0);
  const limit = Math.floor(Number(req.body?.limit) || 1);
  if (!code || stars <= 0) return res.status(400).json({ error: 'Неверные данные промокода' });
  req.db.promos[code] = { stars, limit, used: 0 };
  addLog(req.db, req.user.login, 'CREATE_PROMO', `${code} (${stars}★ x${limit})`);
  writeDB(req.db);
  return res.json({ ok: true });
});

app.post('/api/admin/make-admin', requireAuth, requireSuperAdmin, (req, res) => {
  const target = req.db.users[String(req.body?.targetLogin || '').trim()];
  if (!target) return res.status(404).json({ error: 'Игрок не найден' });
  target.is_admin = true;
  addLog(req.db, req.user.login, 'MAKE_ADMIN', target.login);
  writeDB(req.db);
  return res.json({ ok: true });
});

app.post('/api/admin/remove-admin', requireAuth, requireSuperAdmin, (req, res) => {
  const target = req.db.users[String(req.body?.targetLogin || '').trim()];
  if (!target) return res.status(404).json({ error: 'Игрок не найден' });
  target.is_admin = false;
  addLog(req.db, req.user.login, 'REMOVE_ADMIN', target.login);
  writeDB(req.db);
  return res.json({ ok: true });
});

app.get('/api/admin/logs', requireAuth, requireSuperAdmin, (req, res) => {
  return res.json(req.db.logs.slice(0, 60));
});

app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return res.status(404).send('index.html not found');
});

app.listen(PORT, () => {
  console.log(`TagenGame server running on port ${PORT}`);
});
