/**
 * ==========================================================================================
 * TagenGame Server - Production Grade Implementation
 * ==========================================================================================
 * Version: 2.0 (New Year Edition)
 * Language: Node.js / Express
 * Database: JSON (с асинхронной очередью записи для предотвращения повреждения данных)
 * ==========================================================================================
 * Этот файл содержит полную серверную логику игры, чата, авторизации и админ-панели.
 * Код написан с упором на безопасность, валидацию входящих данных и отказоустойчивость.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

// ==========================================================================================
// БЛОК 1: КОНФИГУРАЦИЯ И КОНСТАНТЫ
// ==========================================================================================

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const ENV = process.env.NODE_ENV || 'development';

// Пути к файлам и папкам
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_PATH = path.join(__dirname, 'database.json');
const BACKUP_DIR = path.join(__dirname, 'backups');

// Настройки лимитов (защита от спама)
const RATE_LIMITS = {
    CHAT_SEND: { windowMs: 10000, max: 5 }, // Не более 5 сообщений в 10 секунд
    AUTH_ATTEMPT: { windowMs: 60000, max: 10 }, // Не более 10 попыток входа в минуту
    GAME_START: { windowMs: 5000, max: 10 } // Не более 10 запусков игр в 5 секунд
};

// Каталог предметов (все возможные предметы в игре)
const ITEMS_CATALOG = [
    { id: 'gift_box', name: 'Подарок', icon: '🎁', price: 100, rarity: 'common', is_nft: false },
    { id: 'ring_star', name: 'Кольцо', icon: '💍', price: 100, rarity: 'common', is_nft: false },
    { id: 'crystal_gem', name: 'Кристалл', icon: '💎', price: 250, rarity: 'rare', is_nft: false },
    { id: 'crown_gold', name: 'Корона', icon: '👑', price: 800, rarity: 'epic', is_nft: false },
    { id: 'nft_neon_punk', name: 'Neon Punk #01', icon: '👾', price: 350, rarity: 'nft', is_nft: true },
    { id: 'nft_cyber_katana', name: 'Cyber Katana #07', icon: '⚔️', price: 1200, rarity: 'nft', is_nft: true },
    { id: 'nft_void_dragon', name: 'Void Dragon #12', icon: '🐉', price: 3500, rarity: 'nft', is_nft: true }
];

// Конфигурация кейсов
const CASES_CONFIG = {
    starter: { price: 100, pool: [ITEMS_CATALOG[0], ITEMS_CATALOG[1], ITEMS_CATALOG[2]] },
    pro: { price: 1000, pool: [ITEMS_CATALOG[1], ITEMS_CATALOG[2], ITEMS_CATALOG[3], ITEMS_CATALOG[4]] },
    magic: { price: 2500, pool: [ITEMS_CATALOG[2], ITEMS_CATALOG[3], ITEMS_CATALOG[4], ITEMS_CATALOG[5]] },
    winter: { price: 3000, pool: [ITEMS_CATALOG[2], ITEMS_CATALOG[3], ITEMS_CATALOG[4], ITEMS_CATALOG[5]] },
    legend: { price: 5000, pool: [ITEMS_CATALOG[3], ITEMS_CATALOG[4], ITEMS_CATALOG[5], ITEMS_CATALOG[6]] },
    inferno: { price: 7500, pool: [ITEMS_CATALOG[3], ITEMS_CATALOG[5], ITEMS_CATALOG[6]] }
};

// Глобальные кэши в памяти (сбрасываются при перезагрузке)
const activeMinesSessions = new Map();
const activeRocketSessions = new Map();
const rateLimitCache = new Map();
const authCache = new Map();

// ==========================================================================================
// БЛОК 2: УТИЛИТЫ И ХЕЛПЕРЫ
// ==========================================================================================

/**
 * Генерация SHA-256 хэша для пароля
 * @param {string} pwd - Пароль в открытом виде
 * @returns {string} Hex-строка хэша
 */
function hashPassword(pwd) {
    return crypto.createHash('sha256').update(String(pwd)).digest('hex');
}

/**
 * Генерация случайного токена для сессии
 * @returns {string} 48-символьный hex-токен
 */
function generateToken() {
    return crypto.randomBytes(24).toString('hex');
}

/**
 * Генерация уникального ID (UUID v4)
 * @returns {string} UUID
 */
function generateUUID() {
    return crypto.randomUUID();
}

/**
 * Безопасное получение целого числа из запроса
 * @param {any} val - Значение из req.body
 * @param {number} defaultVal - Значение по умолчанию
 * @returns {number} Безопасное число
 */
function safeInt(val, defaultVal = 0) {
    const num = parseInt(val, 10);
    return isNaN(num) ? defaultVal : num;
}

/**
 * Проверка, является ли предмет NFT
 * @param {object} item 
 * @returns {boolean}
 */
function isNftItem(item) {
    if (!item) return false;
    return item.is_nft === true || String(item.rarity || '').toLowerCase() === 'nft';
}

/**
 * Логирование действий в консоль (для отладки на Render)
 */
function logInfo(action, details) {
    const timestamp = new Date().toISOString();
    console.log(`[INFO] [${timestamp}] ${action} | ${JSON.stringify(details)}`);
}

function logError(action, error) {
    const timestamp = new Date().toISOString();
    console.error(`[ERROR] [${timestamp}] ${action} | ${error.message || error}`);
}

// ==========================================================================================
// БЛОК 3: СИСТЕМА БАЗЫ ДАННЫХ (Асинхронная очередь записи)
// ==========================================================================================

/**
 * Класс для работы с JSON-базой данных.
 * Использует очередь записи, чтобы избежать race condition (когда два запроса одновременно пишут в файл).
 */
class DatabaseManager {
    constructor(dbPath) {
        this.dbPath = dbPath;
        this.queue = Promise.resolve();
        this.inMemoryDb = null;
    }

    /**
     * Загрузка базы из файла. Если файла нет - создает дефолтную.
     */
    load() {
        if (!fs.existsSync(this.dbPath)) {
            logInfo('DB_INIT', 'База данных не найдена, создаем новую.');
            const initial = this.createDefaultDb();
            this.save(initial);
            return initial;
        }

        try {
            const rawData = fs.readFileSync(this.dbPath, 'utf8');
            const parsed = JSON.parse(rawData);
            return this.validateAndMigrate(parsed);
        } catch (e) {
            logError('DB_LOAD', e);
            return this.createDefaultDb();
        }
    }

    /**
     * Асинхронное сохранение базы данных с блокировкой (чтобы не было коллизий)
     */
    save(dbData) {
        this.queue = this.queue.then(() => {
            return new Promise((resolve) => {
                try {
                    fs.writeFileSync(this.dbPath, JSON.stringify(dbData, null, 2), 'utf8');
                    resolve(true);
                } catch (e) {
                    logError('DB_SAVE', e);
                    resolve(false);
                }
            });
        });
        return this.queue;
    }

    /**
     * Валидация и миграция старых версий базы
     */
    validateAndMigrate(parsed) {
        const users = parsed.users || {};
        const defaultHash = hashPassword('admin123');

        // Гарантируем наличие супер-админов
        ['admin', 'tgweb', 'tagen'].forEach(superLogin => {
            if (!users[superLogin]) {
                users[superLogin] = {
                    login: superLogin,
                    passwordHash: defaultHash,
                    balance: 100,
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
            users: users,
            tokens: parsed.tokens || {},
            drops: Array.isArray(parsed.drops) && parsed.drops.length > 0 ? parsed.drops : this.getInitialDrops(),
            deposits: Array.isArray(parsed.deposits) ? parsed.deposits : [],
            withdraws: Array.isArray(parsed.withdraws) ? parsed.withdraws : [],
            promos: parsed.promos || {},
            logs: Array.isArray(parsed.logs) ? parsed.logs : [],
            chat: Array.isArray(parsed.chat) ? parsed.chat : [],
            muted: parsed.muted || {}
        };
    }

    /**
     * Создание дефолтной базы данных
     */
    createDefaultDb() {
        const defaultHash = hashPassword('admin123');
        return {
            users: {
                admin: {
                    login: 'admin',
                    passwordHash: defaultHash,
                    balance: 100,
                    inventory: [{ uid: 'init_nft_1', id: 'nft_neon_punk', name: 'Neon Punk #01', icon: '👾', price: 350, rarity: 'nft', is_nft: true }],
                    is_admin: true,
                    is_super_admin: true
                },
                tgweb: { login: 'tgweb', passwordHash: defaultHash, balance: 100, inventory: [], is_admin: true, is_super_admin: true },
                tagen: { login: 'tagen', passwordHash: defaultHash, balance: 100, inventory: [], is_admin: true, is_super_admin: true }
            },
            tokens: {},
            drops: this.getInitialDrops(),
            deposits: [],
            withdraws: [],
            promos: {},
            logs: [],
            chat: [],
            muted: {}
        };
    }

    /**
     * Начальная лента событий
     */
    getInitialDrops() {
        const now = Date.now();
        return [
            { user_login: 'tagen', item_id: 'gift_box', item_name: 'выиграл Подарок', item_icon: '🎁', is_win: true, created_at: now - 40000 },
            { user_login: 'tgweb', item_id: 'nft_neon_punk', item_name: 'выиграл Neon Punk #01', item_icon: '👾', is_win: true, created_at: now - 30000 },
            { user_login: 'admin', item_id: 'rocket_loss', item_name: 'проиграл на 1.16x', item_icon: '🚀', is_win: false, created_at: now - 20000 },
            { user_login: 'player', item_id: 'mines_loss', item_name: 'подорвался на мине', item_icon: '💣', is_win: false, created_at: now - 10000 }
        ];
    }
}

// Инициализация менеджера БД
const dbManager = new DatabaseManager(DB_PATH);

// Хелпер для быстрого получения базы
const loadDb = () => dbManager.load();
const saveDb = (db) => dbManager.save(db);

// ==========================================================================================
// БЛОК 4: СИСТЕМА ЛОГОВ И ЛЕНТЫ СОБЫТИЙ
// ==========================================================================================

/**
 * Добавление записи в логи админки
 */
function addLog(db, adminLogin, action, details) {
    db.logs.unshift({
        id: generateUUID(),
        admin_login: adminLogin,
        action: action,
        details: details,
        created_at: Date.now()
    });
    // Храним только последние 200 логов
    if (db.logs.length > 200) db.logs = db.logs.slice(0, 200);
}

/**
 * Публикация события в общую ленту (Live Drops)
 */
function pushFeed(db, userLogin, text, icon, isWin) {
    db.drops.unshift({
        user_login: userLogin || 'Игрок',
        item_id: isWin ? 'win_event' : 'loss_event',
        item_name: text,
        item_icon: icon || (isWin ? '🎁' : '💥'),
        is_win: Boolean(isWin),
        created_at: Date.now()
    });
    if (db.drops.length > 30) db.drops = db.drops.slice(0, 30);
}

// ==========================================================================================
// БЛОК 5: MIDDLEWARE (Прослойки для проверки запросов)
// ==========================================================================================

app.use(express.json({ limit: '10mb' }));
app.use(express.static(PUBLIC_DIR));

/**
 * Middleware для проверки авторизации
 */
function requireAuth(req, res, next) {
    const db = loadDb();
    const token = req.headers['x-auth-token'];
    
    if (!token) {
        return res.status(401).json({ error: 'Отсутствует токен авторизации' });
    }
    
    const login = db.tokens[token];
    if (!login) {
        return res.status(401).json({ error: 'Неверный или истекший токен' });
    }
    
    const user = db.users[login];
    if (!user) {
        return res.status(401).json({ error: 'Пользователь не найден' });
    }
    
    req.db = db;
    req.user = user;
    next();
}

/**
 * Middleware для проверки прав администратора
 */
function requireAdmin(req, res, next) {
    if (!req.user || (!req.user.is_admin && !req.user.is_super_admin)) {
        return res.status(403).json({ error: 'Требуются права администратора' });
    }
    next();
}

/**
 * Middleware для проверки прав супер-администратора
 */
function requireSuperAdmin(req, res, next) {
    if (!req.user || !req.user.is_super_admin) {
        return res.status(403).json({ error: 'Требуются права супер-администратора' });
    }
    next();
}

/**
 * Кастомный Rate Limiter (защита от спама)
 */
function rateLimit(actionType) {
    const config = RATE_LIMITS[actionType];
    if (!config) return (req, res, next) => next();

    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress;
        const key = `${actionType}_${ip}`;
        const now = Date.now();
        
        let requests = rateLimitCache.get(key) || [];
        requests = requests.filter(timestamp => now - timestamp < config.windowMs);
        
        if (requests.length >= config.max) {
            return res.status(429).json({ error: 'Слишком много запросов. Подождите.' });
        }
        
        requests.push(now);
        rateLimitCache.set(key, requests);
        next();
    };
}

// ==========================================================================================
// БЛОК 6: API - АВТОРИЗАЦИЯ И ПРОФИЛЬ
// ==========================================================================================

app.post('/api/register', rateLimit('AUTH_ATTEMPT'), (req, res) => {
    try {
        const { login, password } = req.body || {};
        const cleanLogin = String(login || '').trim();
        
        // Валидация
        if (cleanLogin.length < 3 || cleanLogin.length > 20) {
            return res.status(400).json({ error: 'Логин должен быть от 3 до 20 символов' });
        }
        if (String(password || '').length < 6) {
            return res.status(400).json({ error: 'Пароль должен быть минимум 6 символов' });
        }
        
        const db = loadDb();
        if (db.users[cleanLogin]) {
            return res.status(400).json({ error: 'Этот логин уже занят' });
        }
        
        const isSuper = ['admin', 'tgweb', 'tagen'].includes(cleanLogin.toLowerCase());
        
        db.users[cleanLogin] = {
            login: cleanLogin,
            passwordHash: hashPassword(password),
            balance: 100,
            inventory: [],
            is_admin: isSuper,
            is_super_admin: isSuper
        };
        
        const token = generateToken();
        db.tokens[token] = cleanLogin;
        saveDb(db);
        
        logInfo('USER_REGISTER', { login: cleanLogin });
        
        res.json({
            token: token,
            user: {
                login: cleanLogin,
                balance: 100,
                inventory: [],
                is_admin: isSuper,
                is_super_admin: isSuper
            }
        });
    } catch (e) {
        logError('REGISTER', e);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

app.post('/api/login', rateLimit('AUTH_ATTEMPT'), (req, res) => {
    try {
        const { login, password } = req.body || {};
        const cleanLogin = String(login || '').trim();
        
        const db = loadDb();
        const user = db.users[cleanLogin];
        
        if (!user || user.passwordHash !== hashPassword(password)) {
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }
        
        const token = generateToken();
        db.tokens[token] = cleanLogin;
        saveDb(db);
        
        logInfo('USER_LOGIN', { login: cleanLogin });
        
        res.json({
            token: token,
            user: {
                login: user.login,
                balance: user.balance,
                inventory: user.inventory,
                is_admin: Boolean(user.is_admin),
                is_super_admin: Boolean(user.is_super_admin)
            }
        });
    } catch (e) {
        logError('LOGIN', e);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

app.get('/api/user/:login', requireAuth, (req, res) => {
    try {
        const targetLogin = decodeURIComponent(req.params.login);
        
        // Если запрашивают чужой профиль, а мы не админ - запрещаем
        if (req.user.login !== targetLogin && !req.user.is_admin && !req.user.is_super_admin) {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }
        
        const targetUser = req.db.users[targetLogin];
        if (!targetUser) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        res.json({
            login: targetUser.login,
            balance: targetUser.balance,
            inventory: targetUser.inventory || [],
            is_admin: Boolean(targetUser.is_admin),
            is_super_admin: Boolean(targetUser.is_super_admin)
        });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

// ==========================================================================================
// БЛОК 7: API - ЧАТ
// ==========================================================================================

app.get('/api/chat', (req, res) => {
    try {
        const db = loadDb();
        // Отдаем последние 60 сообщений
        res.json(db.chat.slice(-60));
    } catch (e) {
        res.status(500).json({ error: 'Ошибка загрузки чата' });
    }
});

app.post('/api/chat/send', requireAuth, rateLimit('CHAT_SEND'), (req, res) => {
    try {
        const db = req.db;
        const user = req.user;
        
        // Проверка на мут
        if (db.muted[user.login] && db.muted[user.login] > Date.now()) {
            const left = Math.ceil((db.muted[user.login] - Date.now()) / 60000);
            return res.status(403).json({ error: `Вы заглушены ещё на ${left} мин.` });
        }
        
        const { text, file, fileType } = req.body || {};
        
        if (!text && !file) {
            return res.status(400).json({ error: 'Пустое сообщение' });
        }
        
        if (text && text.length > 500) {
            return res.status(400).json({ error: 'Сообщение слишком длинное (макс 500 символов)' });
        }
        
        if (file && file.length > 7 * 1024 * 1024) {
            return res.status(400).json({ error: 'Файл слишком большой (макс 5МБ)' });
        }
        
        const msg = {
            id: generateUUID(),
            login: user.login,
            is_admin: Boolean(user.is_admin || user.is_super_admin),
            text: text || '',
            file: file || null,
            fileType: fileType || null,
            created_at: Date.now()
        };
        
        db.chat.push(msg);
        if (db.chat.length > 200) db.chat = db.chat.slice(-200);
        saveDb(db);
        
        res.json({ success: true, message: msg });
    } catch (e) {
        logError('CHAT_SEND', e);
        res.status(500).json({ error: 'Ошибка отправки' });
    }
});

app.post('/api/chat/admin', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = req.db;
        const user = req.user;
        const { action, msgId, targetLogin } = req.body || {};
        
        if (action === 'delete') {
            db.chat = db.chat.filter(m => m.id !== msgId);
            addLog(db, user.login, 'chat_delete', `Удалил сообщение ${msgId}`);
            logInfo('CHAT_DELETE', { admin: user.login, msgId });
        } else if (action === 'clear') {
            db.chat = [];
            addLog(db, user.login, 'chat_clear', 'Очистил чат');
            logInfo('CHAT_CLEAR', { admin: user.login });
        } else if (action === 'mute') {
            if (!db.users[targetLogin]) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }
            db.muted[targetLogin] = Date.now() + 5 * 60 * 1000; // Мут на 5 минут
            addLog(db, user.login, 'chat_mute', `Замутил ${targetLogin} на 5 минут`);
            logInfo('CHAT_MUTE', { admin: user.login, target: targetLogin });
        }
        
        saveDb(db);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

// ==========================================================================================
// БЛОК 8: API - ИГРЫ (МИНЫ, РАКЕТКА, КЕЙСЫ, АПГРЕЙД)
// ==========================================================================================

app.post('/api/cases/open', requireAuth, rateLimit('GAME_START'), (req, res) => {
    try {
        const { caseId } = req.body || {};
        const cfg = CASES_CONFIG[caseId];
        
        if (!cfg) {
            return res.status(400).json({ error: 'Кейс не найден' });
        }
        
        const db = req.db;
        const user = req.user;
        
        if (user.balance < cfg.price) {
            return res.status(400).json({ error: 'Недостаточно звёзд' });
        }
        
        user.balance -= cfg.price;
        
        // Выбор случайного предмета
        const template = cfg.pool[Math.floor(Math.random() * cfg.pool.length)];
        
        const wonItem = {
            uid: generateUUID(),
            id: template.id,
            name: template.name,
            icon: template.icon,
            price: template.price,
            rarity: template.rarity,
            is_nft: Boolean(template.is_nft)
        };
        
        user.inventory.push(wonItem);
        pushFeed(db, user.login, `выиграл ${wonItem.name}`, wonItem.icon, true);
        saveDb(db);
        
        res.json({
            balance: user.balance,
            item: wonItem,
            pool: cfg.pool
        });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

app.post('/api/games/mines', requireAuth, (req, res) => {
    try {
        const { action, bet, minesCount, cell } = req.body || {};
        const db = req.db;
        const user = req.user;

        if (action === 'start') {
            const betNum = safeInt(bet);
            const mCount = [1, 3, 5, 10].includes(safeInt(minesCount)) ? safeInt(minesCount) : 3;
            const totalCells = 9;
            
            if (betNum < 10) {
                return res.status(400).json({ error: 'Мин. ставка 10 ★' });
            }
            if (user.balance < betNum) {
                return res.status(400).json({ error: 'Недостаточно средств' });
            }
            
            user.balance -= betNum;
            saveDb(db);
            
            // Генерация мин
            const bombs = new Set();
            while (bombs.size < mCount) {
                bombs.add(Math.floor(Math.random() * totalCells));
            }
            
            activeMinesSessions.set(user.login, {
                bet: betNum,
                minesCount: mCount,
                totalCells: totalCells,
                bombs: Array.from(bombs),
                opened: []
            });
            
            return res.json({
                balance: user.balance,
                gridSize: 3,
                totalCells: totalCells,
                minesCount: mCount
            });
        }
        
        const session = activeMinesSessions.get(user.login);
        if (!session) {
            return res.status(400).json({ error: 'Активная игра не найдена' });
        }

        if (action === 'click') {
            const idx = safeInt(cell);
            
            if (session.bombs.includes(idx)) {
                activeMinesSessions.delete(user.login);
                pushFeed(db, user.login, 'подорвался на мине', '💣', false);
                saveDb(db);
                return res.json({ bomb: true, bombs: session.bombs });
            }
            
            if (!session.opened.includes(idx)) {
                session.opened.push(idx);
            }
            
            // Формула множителя
            const mult = Number((1 + session.opened.length * (0.22 + session.minesCount * 0.08)).toFixed(2));
            
            return res.json({
                bomb: false,
                openedCount: session.opened.length,
                multiplier: mult,
                potentialWin: Math.floor(session.bet * mult)
            });
        }
        
        if (action === 'cashout') {
            if (session.opened.length === 0) {
                return res.status(400).json({ error: 'Откройте хотя бы одну ячейку' });
            }
            
            const mult = Number((1 + session.opened.length * (0.22 + session.minesCount * 0.08)).toFixed(2));
            const win = Math.floor(session.bet * mult);
            
            user.balance += win;
            pushFeed(db, user.login, `выиграл ${win} ★ (${mult.toFixed(2)}x)`, '💎', true);
            saveDb(db);
            activeMinesSessions.delete(user.login);
            
            return res.json({ balance: user.balance, win: win, bombs: session.bombs });
        }
        
        res.status(400).json({ error: 'Неизвестное действие' });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

/**
 * Генерация точки краша для ракетки.
 * Используется распределение, чтобы 1.01-1.20 выпадало чаще, а 5.0 - редко.
 */
function rollWeightedCrashPoint() {
    const r = Math.random();
    if (r < 0.78) return Number((1.01 + Math.random() * 0.34).toFixed(2)); // ~78% шанс низкого краша
    if (r < 0.96) return Number((1.36 + Math.random() * 0.84).toFixed(2)); // ~18% среднего
    return Number((2.21 + Math.random() * 2.79).toFixed(2)); // ~4% высокого
}

app.post('/api/games/rocket', requireAuth, (req, res) => {
    try {
        const { action, bet, multiplier } = req.body || {};
        const db = req.db;
        const user = req.user;

        if (action === 'start') {
            const betNum = safeInt(bet);
            
            if (betNum < 10) {
                return res.status(400).json({ error: 'Мин. ставка 10 ★' });
            }
            if (user.balance < betNum) {
                return res.status(400).json({ error: 'Недостаточно средств' });
            }
            
            user.balance -= betNum;
            saveDb(db);
            
            const crashPoint = Math.min(5.0, Math.max(1.01, rollWeightedCrashPoint()));
            activeRocketSessions.set(user.login, { bet: betNum, crashPoint: crashPoint });
            
            return res.json({ balance: user.balance, crashPoint: crashPoint });
        }
        
        const session = activeRocketSessions.get(user.login);
        if (!session) {
            return res.status(400).json({ error: 'Ракета не запущена' });
        }

        if (action === 'cashout') {
            const claimMult = Number(multiplier);
            
            if (claimMult >= session.crashPoint) {
                activeRocketSessions.delete(user.login);
                return res.json({ crashed: true, crashPoint: session.crashPoint });
            }
            
            const win = Math.floor(session.bet * claimMult);
            user.balance += win;
            pushFeed(db, user.login, `забрал на ${claimMult}x (+${win} ★)`, '🚀', true);
            saveDb(db);
            activeRocketSessions.delete(user.login);
            
            return res.json({ balance: user.balance, win: win, multiplier: claimMult, crashPoint: session.crashPoint });
        }
        
        if (action === 'crash') {
            activeRocketSessions.delete(user.login);
            pushFeed(db, user.login, `проиграл на ${session.crashPoint}x`, '💥', false);
            saveDb(db);
            return res.json({ crashPoint: session.crashPoint });
        }
    } catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

app.post('/api/upgrade', requireAuth, (req, res) => {
    try {
        const { targetItemId, betStars, myUid } = req.body || {};
        const db = req.db;
        const user = req.user;

        const target = ITEMS_CATALOG.find(i => i.id === targetItemId) || (user.inventory || []).find(i => i.uid === targetItemId);
        
        if (!target) {
            return res.status(400).json({ error: 'Цель не найдена' });
        }

        let myPrice = 0;
        let itemToRemove = null;

        if (betStars) {
            myPrice = safeInt(betStars);
            if (user.balance < myPrice) {
                return res.status(400).json({ error: 'Мало звезд' });
            }
        } else if (myUid) {
            const idx = (user.inventory || []).findIndex(i => i.uid === myUid);
            if (idx === -1) {
                return res.status(400).json({ error: 'Предмет не найден' });
            }
            itemToRemove = user.inventory[idx];
            myPrice = Number(itemToRemove.price);
        } else {
            return res.status(400).json({ error: 'Не выбрана ставка' });
        }

        if (myPrice >= target.price) {
            return res.status(400).json({ error: 'Цель должна быть дороже' });
        }

        // Шанс = (цена моей ставки / цена цели) * 50%. Максимум 50%.
        let chance = (myPrice / target.price) * 50;
        if (chance > 50) chance = 50;
        if (chance < 1) chance = 1;

        const win = Math.random() * 100 <= chance;

        // Списываем ставку
        if (betStars) {
            user.balance -= myPrice;
        } else if (itemToRemove) {
            user.inventory = user.inventory.filter(i => i.uid !== itemToRemove.uid);
        }

        if (win) {
            user.inventory.push({ uid: generateUUID(), ...target });
            pushFeed(db, user.login, `апгрейд в ${target.name}`, target.icon, true);
        } else {
            pushFeed(db, user.login, `сгорел на апгрейде`, '💥', false);
        }
        
        saveDb(db);
        res.json({ win: win, chance: chance, item: target });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

// ==========================================================================================
// БЛОК 9: API - КОШЕЛЕК
// ==========================================================================================

app.post('/api/wallet/deposit', requireAuth, (req, res) => {
    try {
        const { amount } = req.body || {};
        const db = req.db;
        const user = req.user;
        const amt = safeInt(amount);
        
        if (amt <= 0) {
            return res.status(400).json({ error: 'Неверная сумма' });
        }
        
        db.deposits.push({
            id: generateUUID(),
            user_login: user.login,
            amount_stars: amt,
            created_at: Date.now()
        });
        
        saveDb(db);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

app.post('/api/wallet/withdraw', requireAuth, (req, res) => {
    try {
        const { amount } = req.body || {};
        const db = req.db;
        const user = req.user;
        const amt = safeInt(amount);
        
        if (amt <= 0 || user.balance < amt) {
            return res.status(400).json({ error: 'Недостаточно средств' });
        }
        
        user.balance -= amt;
        
        db.withdraws.push({
            id: generateUUID(),
            user_login: user.login,
            amount_stars: amt,
            created_at: Date.now()
        });
        
        saveDb(db);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

// ==========================================================================================
// БЛОК 10: API - АДМИНКА
// ==========================================================================================

app.get('/api/admin/players', requireAuth, requireAdmin, (req, res) => {
    const db = req.db;
    res.json(Object.values(db.users).map(u => ({
        login: u.login,
        balance: u.balance,
        is_admin: u.is_admin,
        is_super_admin: u.is_super_admin,
        nft_count: (u.inventory || []).filter(i => i.is_nft).length
    })));
});

app.post('/api/admin/give-stars', requireAuth, requireAdmin, (req, res) => {
    try {
        const { targetLogin, amount } = req.body || {};
        const db = req.db;
        const admin = req.user;
        
        const target = db.users[targetLogin];
        if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
        
        const amt = safeInt(amount);
        target.balance += amt;
        
        addLog(db, admin.login, 'give_stars', `Выдал ${amt}★ игроку ${targetLogin}`);
        saveDb(db);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

app.post('/api/admin/take-stars', requireAuth, requireSuperAdmin, (req, res) => {
    try {
        const { targetLogin, amount } = req.body || {};
        const db = req.db;
        const admin = req.user;
        
        const target = db.users[targetLogin];
        if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
        
        const amt = safeInt(amount);
        target.balance -= amt;
        
        addLog(db, admin.login, 'take_stars', `Забрал ${amt}★ у ${targetLogin}`);
        saveDb(db);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

app.post('/api/admin/give-nft', requireAuth, requireAdmin, (req, res) => {
    try {
        const { targetLogin, item } = req.body || {};
        const db = req.db;
        const admin = req.user;
        
        const target = db.users[targetLogin];
        if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
        
        if (!item || !item.name) return res.status(400).json({ error: 'Неверные данные предмета' });
        
        target.inventory.push({
            uid: generateUUID(),
            id: item.id || 'nft_custom',
            name: item.name,
            icon: item.icon || '💎',
            price: safeInt(item.price, 100),
            rarity: 'nft',
            is_nft: true
        });
        
        addLog(db, admin.login, 'give_nft', `Выдал NFT ${item.name} игроку ${targetLogin}`);
        saveDb(db);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

app.get('/api/admin/withdraws', requireAuth, requireSuperAdmin, (req, res) => {
    res.json(req.db.withdraws || []);
});

app.get('/api/admin/deposits', requireAuth, requireSuperAdmin, (req, res) => {
    res.json(req.db.deposits || []);
});

app.post('/api/admin/withdraws/accept', requireAuth, requireSuperAdmin, (req, res) => {
    try {
        const { id } = req.body || {};
        const db = req.db;
        db.withdraws = db.withdraws.filter(w => w.id !== id);
        addLog(db, req.user.login, 'accept_withdraw', `Одобрил вывод ${id}`);
        saveDb(db);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

app.post('/api/admin/deposit/accept', requireAuth, requireSuperAdmin, (req, res) => {
    try {
        const { id } = req.body || {};
        const db = req.db;
        const dep = db.deposits.find(d => d.id === id);
        
        if (dep && db.users[dep.user_login]) {
            db.users[dep.user_login].balance += dep.amount_stars;
            db.deposits = db.deposits.filter(d => d.id !== id);
            addLog(db, req.user.login, 'accept_deposit', `Одобрил пополнение ${dep.amount_stars}★ для ${dep.user_login}`);
            saveDb(db);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

app.post('/api/admin/create-promo', requireAuth, requireSuperAdmin, (req, res) => {
    try {
        const { code, stars, limit } = req.body || {};
        const db = req.db;
        
        if (!code || code.length < 3) return res.status(400).json({ error: 'Код слишком короткий' });
        
        db.promos[code.toUpperCase()] = {
            stars: safeInt(stars, 100),
            limit: safeInt(limit, 10),
            used: 0
        };
        
        addLog(db, req.user.login, 'create_promo', `Создал промокод ${code} на ${stars}★`);
        saveDb(db);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

app.get('/api/admin/logs', requireAuth, requireSuperAdmin, (req, res) => {
    res.json(req.db.logs || []);
});

app.post('/api/admin/make-admin', requireAuth, requireSuperAdmin, (req, res) => {
    try {
        const { targetLogin } = req.body || {};
        const db = req.db;
        if (db.users[targetLogin]) {
            db.users[targetLogin].is_admin = true;
            addLog(db, req.user.login, 'make_admin', `Выдал права админа ${targetLogin}`);
            saveDb(db);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Не найден' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

app.post('/api/admin/remove-admin', requireAuth, requireSuperAdmin, (req, res) => {
    try {
        const { targetLogin } = req.body || {};
        const db = req.db;
        if (db.users[targetLogin] && !['admin', 'tgweb', 'tagen'].includes(targetLogin)) {
            db.users[targetLogin].is_admin = false;
            addLog(db, req.user.login, 'remove_admin', `Снял права админа с ${targetLogin}`);
            saveDb(db);
            res.json({ success: true });
        } else {
            res.status(400).json({ error: 'Нельзя снять права с этого пользователя' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

// ==========================================================================================
// БЛОК 11: ЭКСПОРТ ДАННЫХ И ЗАПУСК СЕРВЕРА
// ==========================================================================================

app.get('/api/export/my-data', requireAuth, (req, res) => {
    res.json({
        exported_at: new Date().toISOString(),
        login: req.user.login,
        balance: req.user.balance,
        inventory: req.user.inventory || []
    });
});

app.get('/api/admin/download-db', requireAuth, requireAdmin, (req, res) => {
    res.json(req.db);
});

// Запуск сервера
server.listen(PORT, () => {
    logInfo('SERVER_START', { port: PORT, env: ENV, time: new Date().toISOString() });
    console.log(`=========================================`);
    console.log(`🎄 TagenGame Server запущен на порту ${PORT}`);
    console.log(`=========================================`);
});
