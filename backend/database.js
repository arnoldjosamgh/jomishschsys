let sqlite3;
try {
    sqlite3 = require('sqlite3').verbose();
} catch (e) {
    console.log('[DB] sqlite3 module not found or failed to load. This is fine if using Postgres.');
}
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');

const asyncLocalStorage = new AsyncLocalStorage();

// Load Config
let config = { dbType: 'sqlite' };
try {
    const baseDir = process.pkg ? process.cwd() : path.join(__dirname, '..');
    const configData = fs.readFileSync(path.join(baseDir, 'config/config.json'));
    config = JSON.parse(configData);
} catch (e) { 
    console.log('Config file not found or invalid, checking environment variables...');
}

// ---- Environment Variable Overrides (Neon / Render / Docker) ----
// DATABASE_URL takes top priority (Neon standard connection string)
if (process.env.DATABASE_URL) {
    config.dbType = 'postgres';
    config.postgres = { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } };
    console.log('[DB] Using DATABASE_URL (Neon/Render Postgres mode).');
} else if (process.env.DB_TYPE) {
    config.dbType = process.env.DB_TYPE;
    if (config.dbType === 'postgres' && config.postgres) {
        config.postgres.host = process.env.PGHOST || config.postgres.host;
        config.postgres.user = process.env.PGUSER || config.postgres.user;
        config.postgres.password = process.env.PGPASSWORD || config.postgres.password;
        config.postgres.database = process.env.PGDATABASE || config.postgres.database;
        config.postgres.port = process.env.PGPORT || config.postgres.port;
    }
}

let db;
const CURRENT_VERSION = 201;

if (config.dbType === 'postgres') {
    const poolConfig = { ...config.postgres, max: 100, idleTimeoutMillis: 30000 };
    const pool = new Pool(poolConfig);
    
    // Compatibility Wrapper for Postgres to mimic sqlite3 API
    db = {
        pool: pool,
        run: function(sql, params, callback) {
            if (typeof params === 'function') { callback = params; params = []; }
            const pgSql = translateSql(sql);
            const schema = asyncLocalStorage.getStore() || 'public';
            
            pool.connect().then(client => {
                client.query(`SET search_path TO "${schema}", public`)
                    .then(() => client.query(pgSql, params))
                    .then(res => {
                        client.release();
                        const ctx = { 
                            lastID: res.rows.length > 0 ? res.rows[0].id : null, 
                            changes: res.rowCount 
                        };
                        if (callback) callback.call(ctx, null);
                    })
                    .catch(err => {
                        client.release();
                        if (callback) callback(err);
                    });
            }).catch(err => { if (callback) callback(err); });
        },
        get: function(sql, params, callback) {
            if (typeof params === 'function') { callback = params; params = []; }
            const schema = asyncLocalStorage.getStore() || 'public';
            
            pool.connect().then(client => {
                client.query(`SET search_path TO "${schema}", public`)
                    .then(() => client.query(translateSql(sql), params))
                    .then(res => {
                        client.release();
                        if (callback) callback(null, res.rows[0]);
                    })
                    .catch(err => {
                        client.release();
                        if (callback) callback(err);
                    });
            }).catch(err => { if (callback) callback(err); });
        },
        all: function(sql, params, callback) {
            if (typeof params === 'function') { callback = params; params = []; }
            const schema = asyncLocalStorage.getStore() || 'public';
            
            pool.connect().then(client => {
                client.query(`SET search_path TO "${schema}", public`)
                    .then(() => client.query(translateSql(sql), params))
                    .then(res => {
                        client.release();
                        if (callback) callback(null, res.rows);
                    })
                    .catch(err => {
                        client.release();
                        if (callback) callback(err);
                    });
            }).catch(err => { if (callback) callback(err); });
        },
        serialize: function(fn) { fn(); }, // Postgres is pool-based, serialize is dummy
        prepare: function(sql) {
            // Basic mimic for mt.run
            return {
                run: (params) => {
                    const schema = asyncLocalStorage.getStore() || 'public';
                    return pool.connect().then(client => {
                        return client.query(`SET search_path TO "${schema}", public`)
                            .then(() => client.query(translateSql(sql), params))
                            .finally(() => client.release());
                    });
                },
                finalize: () => {}
            };
        }
    };
    
    // Add create schema helper
    db.createCompanySchema = async function(prefix) {
        if (!prefix || !/^[A-Za-z0-9]+$/.test(prefix)) throw new Error('Invalid prefix format');
        const schemaName = 't_' + prefix.toLowerCase();
        
        const client = await pool.connect();
        try {
            await client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
            // Run initialization in this new schema
            await new Promise((resolve) => {
                asyncLocalStorage.run(schemaName, () => {
                    initDb();
                    resolve();
                });
            });
        } finally {
            client.release();
        }
        return schemaName;
    };
    const _pgHost = (() => { try { return new URL(config.postgres.connectionString).hostname; } catch(e) { return config.postgres.host || 'neon'; } })();
    console.log('[DB] Using PostgreSQL database at', _pgHost);
    // Initialise tables on startup (function is hoisted, db is already assigned)
    setImmediate(() => initDb());
} else {
    // Guard: if sqlite3 failed to load (e.g. native compile error on Linux/Railway),
    // throw a clear error instead of crashing with a confusing TypeError.
    if (!sqlite3) {
        console.error('[DB] FATAL: sqlite3 native module is not available and no DATABASE_URL is set.');
        console.error('[DB] If you are deploying to a cloud host (Railway, Render, etc.), please set the DATABASE_URL environment variable to a PostgreSQL connection string (e.g. from Neon.tech).');
        process.exit(1);
    }
    const baseDir = process.pkg ? process.cwd() : path.join(__dirname, '..');
    const dataDir = path.join(baseDir, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    // ===== PER-COMPANY SQLite DATABASE FACTORY =====
    // Each company prefix gets its own isolated .db file.
    // e.g. prefix 'JOM' -> data/jomish_jom.db
    //      prefix 'public' -> data/jomish.db (legacy / default)
    const sqliteDbCache = new Map(); // prefix -> sqlite3.Database

    function openSqliteDb(prefix) {
        const safePrefix = (prefix || 'public').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (sqliteDbCache.has(safePrefix)) return sqliteDbCache.get(safePrefix);

        // Use legacy filename for 'public' so existing data is not lost
        const dbFileName = (safePrefix === 'public')
            ? (config.sqlite?.dbName || 'jomish.db')
            : `jomish_${safePrefix}.db`;
        const dbPath = path.join(dataDir, dbFileName);

        // Bulletproof restore: apply staged restore file if present
        const restorePath = dbPath + '.restore';
        if (fs.existsSync(restorePath)) {
            try {
                console.log(`[STARTUP] Applying database restore for '${safePrefix}'...`);
                fs.copyFileSync(restorePath, dbPath);
                if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
                if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');
                fs.unlinkSync(restorePath);
                console.log(`[STARTUP] Restore for '${safePrefix}' successful.`);
            } catch (e) {
                console.error(`[STARTUP] Failed to apply restore for '${safePrefix}':`, e.message);
            }
        }

        const sqliteInstance = new sqlite3.Database(dbPath, (err) => {
            if (err) { console.error(`FATAL: Could not open SQLite db for '${safePrefix}':`, err.message); process.exit(1); }
            console.log(`[DB] Opened SQLite database for '${safePrefix}' at ${dbPath}`);
        });

        // Performance & reliability PRAGMAs
        sqliteInstance.serialize(() => {
            sqliteInstance.run('PRAGMA journal_mode = WAL');
            sqliteInstance.run('PRAGMA busy_timeout = 15000');
            sqliteInstance.run('PRAGMA synchronous = NORMAL');
            sqliteInstance.run('PRAGMA cache_size = -32000');
            sqliteInstance.run('PRAGMA foreign_keys = ON');
            sqliteInstance.run('PRAGMA wal_autocheckpoint = 500');
            sqliteInstance.run('PRAGMA temp_store = MEMORY');
            sqliteInstance.run('PRAGMA mmap_size = 268435456');
            sqliteInstance.run('PRAGMA wal_checkpoint(TRUNCATE)', (err) => {
                if (!err) console.log(`[DB] WAL checkpoint complete for '${safePrefix}'.`);
            });
        });

        // Periodic WAL checkpoint
        setInterval(() => { sqliteInstance.run('PRAGMA wal_checkpoint(PASSIVE)'); }, 5 * 60 * 1000);

        sqliteInstance.dbPath = dbPath;
        sqliteDbCache.set(safePrefix, sqliteInstance);
        
        // Initialize/update schema for this database
        setImmediate(() => {
            asyncLocalStorage.run(safePrefix, () => initDb());
        });
        
        return sqliteInstance;
    }

    // Open the public/default db immediately so initDb() runs at startup
    openSqliteDb('public');

    // ===== PROXY: routes all db calls to the correct per-prefix SQLite =====
    // The active prefix comes from asyncLocalStorage (set by the middleware in server.js)
    db = new Proxy({}, {
        get(_, method) {
            if (method === 'asyncLocalStorage') return asyncLocalStorage;
            if (method === 'dbPath') {
                const prefix = asyncLocalStorage.getStore() || 'public';
                return openSqliteDb(prefix).dbPath;
            }
            if (method === '_sqliteDbCache') return sqliteDbCache;
            if (method === '_openSqliteDb') return openSqliteDb;
            if (method === 'createCompanySchema') {
                // Return the SQLite company provisioner function
                return async function(prefix) {
                    if (!prefix || !/^[A-Za-z0-9]+$/.test(prefix)) throw new Error('Invalid prefix format');
                    const safePrefix = prefix.toLowerCase();
                    const schemaName = 't_' + safePrefix;

                    // Open (or create) the company .db file — this registers it in sqliteDbCache
                    openSqliteDb(schemaName);

                    // Run initDb() and checkMigrations() within the context of the new company db
                    await new Promise((resolve, reject) => {
                        asyncLocalStorage.run(schemaName, () => {
                            try {
                                initDb();
                                // Give SQLite a moment to finish the serialize queue before resolving
                                setTimeout(resolve, 800);
                            } catch (e) {
                                reject(e);
                            }
                        });
                    });

                    console.log('[DB] SQLite schema provisioned for company prefix ' + prefix + ' -> data/jomish_t' + safePrefix + '.db');
                    return schemaName;
                };
            }
            return (...args) => {
                const prefix = asyncLocalStorage.getStore() || 'public';
                const activeDb = openSqliteDb(prefix);
                if (typeof activeDb[method] !== 'function') return undefined;
                return activeDb[method](...args);
            };
        }
    });

    console.log(`[DB] SQLite multi-tenant mode active. Databases in: ${dataDir}/`);
}

// Convert '?' to '$1, $2' for Postgres
function translateSql(sql) {
    if (config.dbType !== 'postgres') return sql;
    let index = 1;
    let newSql = sql.replace(/\?/g, () => `$${index++}`);
    
    // Convert SQLite datetime functions to PostgreSQL equivalents
    // datetime('now') -> NOW()
    newSql = newSql.replace(/datetime\('now'\)/gi, 'NOW()');
    // datetime('now', '-N seconds/minutes/hours/days') -> NOW() - INTERVAL 'N seconds'
    newSql = newSql.replace(/datetime\('now',\s*'(-?\d+)\s+(\w+)'\)/gi, (_, n, unit) => `NOW() - INTERVAL '${Math.abs(parseInt(n))} ${unit}'`);
    // strftime('%Y-%m', col) -> TO_CHAR(col, 'YYYY-MM')
    newSql = newSql.replace(/strftime\('%Y-%m',\s*([^)]+)\)/gi, "TO_CHAR($1, 'YYYY-MM')");
    // strftime('%Y-%m-%d', col) -> TO_CHAR(col, 'YYYY-MM-DD')
    newSql = newSql.replace(/strftime\('%Y-%m-%d',\s*([^)]+)\)/gi, "TO_CHAR($1, 'YYYY-MM-DD')");
    // date('now') -> CURRENT_DATE
    newSql = newSql.replace(/date\('now'\)/gi, 'CURRENT_DATE');
    
    // Only append RETURNING id for tables that actually have a SERIAL id column
    // Tables WITHOUT id: roles_config, devices, app_settings, system_info
    const noIdTables = ['roles_config', 'devices', 'app_settings', 'system_info', 'onboarding_tokens'];
    const isInsert = newSql.trim().toUpperCase().startsWith('INSERT');
    const hasReturning = newSql.toUpperCase().includes('RETURNING');
    const targetsNoIdTable = noIdTables.some(t => newSql.toLowerCase().includes(t));
    
    if (isInsert && !hasReturning && !targetsNoIdTable) {
        newSql += ' RETURNING id';
    }
    return newSql;
}

// Unified Table Initialization
const schema = [
    `CREATE TABLE IF NOT EXISTS system_info (key TEXT PRIMARY KEY, value TEXT)`,
    `CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        first_name TEXT, last_name TEXT, email TEXT UNIQUE, phone TEXT, password TEXT,
        role TEXT, department TEXT, qr_hash TEXT,
        is_active INTEGER DEFAULT 1, user_code TEXT, username TEXT UNIQUE,
        photo_base64 TEXT, profile_color TEXT DEFAULT '#4F46E5',
        session_token TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        first_name TEXT, last_name TEXT, email TEXT UNIQUE, phone TEXT,
        grade TEXT, student_id TEXT UNIQUE, qr_hash TEXT, barcode TEXT,
        photo_base64 TEXT, parent_name TEXT, parent_phone TEXT,
        status TEXT DEFAULT 'PENDING',  -- 'PENDING', 'ACTIVE', 'GRADUATED'
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS applications (
        id SERIAL PRIMARY KEY,
        student_id INTEGER,
        application_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'REJECTED'
        reviewed_by INTEGER,
        fee_paid INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS fees (
        id SERIAL PRIMARY KEY,
        student_id INTEGER,
        amount REAL,
        fee_type TEXT,
        status TEXT DEFAULT 'UNPAID', -- 'UNPAID', 'PAID'
        paid_at TIMESTAMP,
        recorded_by INTEGER,
        term TEXT,
        year TEXT,
        source TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS term_fees (
        id SERIAL PRIMARY KEY,
        term TEXT,
        year TEXT,
        amount REAL,
        UNIQUE(term, year)
    )`,
    `CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY, 
        user_type TEXT, -- 'STUDENT' or 'STAFF'
        user_id INTEGER, 
        scan_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
        scan_type TEXT, -- 'IN', 'OUT'
        status TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS roles_config (
        role_name TEXT PRIMARY KEY, 
        can_see_admin INTEGER DEFAULT 0,
        can_see_headteacher INTEGER DEFAULT 0,
        can_see_teacher INTEGER DEFAULT 0,
        can_see_accounts INTEGER DEFAULT 0,
        can_see_dos INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY, device_name TEXT, device_type TEXT,
        ip_address TEXT, last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP, status TEXT DEFAULT 'ONLINE',
        company_schema TEXT DEFAULT 'public'
    )`,
    `CREATE TABLE IF NOT EXISTS app_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT)`,
    `CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY, prefix TEXT UNIQUE, name TEXT,
        status TEXT DEFAULT 'ACTIVE', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS onboarding_tokens (
        token TEXT PRIMARY KEY, company_prefix TEXT, company_name TEXT,
        business_email TEXT, expires_at TIMESTAMP, used INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS subjects (
        id SERIAL PRIMARY KEY, name TEXT UNIQUE, code TEXT UNIQUE
    )`,
    `CREATE TABLE IF NOT EXISTS marks (
        id SERIAL PRIMARY KEY, student_id INTEGER, subject_id INTEGER, teacher_id INTEGER,
        term TEXT, year TEXT, score REAL, grade TEXT, exam_photo_base64 TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS student_notes (
        id SERIAL PRIMARY KEY, student_id INTEGER, teacher_id INTEGER,
        note_text TEXT, status TEXT DEFAULT 'UNREAD',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY, student_id INTEGER, term TEXT, year TEXT,
        total_score REAL, average_score REAL, position INTEGER,
        pdf_path TEXT, signed_by_dos INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
];

function initDb() {
    const currentSchema = (typeof asyncLocalStorage !== 'undefined' ? asyncLocalStorage.getStore() : null) || 'public';
    
    if (config.dbType === 'postgres') {
        let i = 0;
        function nextTable() {
            if (i >= schema.length) {
                checkMigrations();
                return;
            }
            db.run(schema[i++], [], (err) => {
                if (err) console.error(`[DB Init Error]`, err.message);
                nextTable();
            });
        }
        nextTable();
    } else {
        db.serialize(() => {
            schema.forEach(sql => {
                let execSql = sql;
                execSql = execSql.replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT');
                execSql = execSql.replace(/TIMESTAMP/g, 'DATETIME');
                db.run(execSql);
            });
            checkMigrations();
        });
    }
}

function checkMigrations() {
    db.get(`SELECT value FROM system_info WHERE key = 'version'`, (err, row) => {
        const v = row ? parseInt(row.value) : 0;
        if (v < CURRENT_VERSION) {
            console.log(`Migrating database from ${v} to ${CURRENT_VERSION}...`);
            runMigrations(v);
        }
    });
}

function runMigrations(fromVersion) {
    if (fromVersion < 201) {
        const seedRoles = [
            ['Admin', 1, 1, 1, 1, 1],
            ['Headteacher', 0, 1, 1, 0, 1],
            ['Teacher', 0, 0, 1, 0, 1],
            ['Accounts', 0, 0, 0, 1, 0],
            ['DOS', 0, 0, 1, 0, 1]
        ];
        db.run('ALTER TABLE roles_config ADD COLUMN can_see_admin INTEGER DEFAULT 0', [], () => {});
        db.run('ALTER TABLE roles_config ADD COLUMN can_see_headteacher INTEGER DEFAULT 0', [], () => {});
        db.run('ALTER TABLE roles_config ADD COLUMN can_see_teacher INTEGER DEFAULT 0', [], () => {});
        db.run('ALTER TABLE roles_config ADD COLUMN can_see_accounts INTEGER DEFAULT 0', [], () => {});
        db.run('ALTER TABLE roles_config ADD COLUMN can_see_dos INTEGER DEFAULT 0', [], (err) => {
            // Ignore error if column already exists
            seedRoles.forEach(r => db.run('INSERT INTO roles_config (role_name, can_see_admin, can_see_headteacher, can_see_teacher, can_see_accounts, can_see_dos) VALUES (?,?,?,?,?,?) ON CONFLICT(role_name) DO UPDATE SET can_see_dos = excluded.can_see_dos, can_see_admin = excluded.can_see_admin, can_see_headteacher = excluded.can_see_headteacher, can_see_teacher = excluded.can_see_teacher, can_see_accounts = excluded.can_see_accounts', r));
        });
        db.run('ALTER TABLE marks ADD COLUMN exam_photo_base64 TEXT', [], () => {}); // Safe addition
        db.run('ALTER TABLE fees ADD COLUMN term TEXT', [], () => {});
        db.run('ALTER TABLE fees ADD COLUMN year TEXT', [], () => {});
        db.run('ALTER TABLE fees ADD COLUMN source TEXT', [], () => {});
        db.run('INSERT OR REPLACE INTO system_info (key, value) VALUES (?, ?)', ["version", "201"]);
    }
}

module.exports = db;
module.exports.asyncLocalStorage = asyncLocalStorage;
