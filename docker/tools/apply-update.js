/**
 * Jomish Business Suite — Update Engine
 * 
 * Run this script to apply updates without clearing the database.
 * Usage: node tools/apply-update.js [update-file.js]
 * 
 * If no file specified, applies ALL pending updates in /updates/ folder.
 */

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, '..', 'data', 'jomish.db');
const UPDATES_DIR = path.join(__dirname, '..', 'updates');
const VERSION = '1.0';
const CODENAME = 'Genesis';

console.log(`\n╔══════════════════════════════════════════╗`);
console.log(`║   JOMISH SUITE — UPDATE ENGINE           ║`);
console.log(`║   Version: ${VERSION} ${CODENAME}                  ║`);
console.log(`╚══════════════════════════════════════════╝\n`);

// Ensure updates directory exists
if (!fs.existsSync(UPDATES_DIR)) {
    fs.mkdirSync(UPDATES_DIR, { recursive: true });
    console.log('[+] Created updates/ directory');
}

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('[ERROR] Cannot open database:', err.message);
        process.exit(1);
    }
    console.log('[[OK]] Database connected:', DB_PATH);
});

// Create system_meta table if not exists
db.run(`CREATE TABLE IF NOT EXISTS system_meta (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
)`, () => {

    // Set initial version if not set
    db.run(`INSERT OR IGNORE INTO system_meta (key, value) VALUES ('version', ?)`, [`${VERSION} ${CODENAME}`]);
    db.run(`INSERT OR IGNORE INTO system_meta (key, value) VALUES ('installed_at', ?)`, [new Date().toISOString()]);

    // Get list of already applied updates
    db.all(`SELECT value FROM system_meta WHERE key LIKE 'update_%' ORDER BY key`, [], (err, rows) => {
        const applied = new Set((rows || []).map(r => r.value));

        // Get target update file or scan all
        const targetFile = process.argv[2];
        let updateFiles = [];

        if (targetFile) {
            const fullPath = path.resolve(targetFile);
            if (fs.existsSync(fullPath)) {
                updateFiles = [fullPath];
            } else {
                console.error(`[ERROR] Update file not found: ${targetFile}`);
                process.exit(1);
            }
        } else {
            // Scan updates/ folder
            if (fs.existsSync(UPDATES_DIR)) {
                updateFiles = fs.readdirSync(UPDATES_DIR)
                    .filter(f => f.endsWith('.js') && f.startsWith('update_'))
                    .sort()
                    .map(f => path.join(UPDATES_DIR, f));
            }
        }

        if (updateFiles.length === 0) {
            console.log('\n[OK] System is up to date. No pending updates.\n');
            db.close();
            return;
        }

        // Apply updates sequentially
        let pending = updateFiles.filter(f => !applied.has(path.basename(f)));
        
        if (pending.length === 0) {
            console.log('\n[OK] All updates already applied.\n');
            db.close();
            return;
        }

        console.log(`\n[PACKAGE] Found ${pending.length} update(s) to apply:\n`);
        pending.forEach(f => console.log(`   • ${path.basename(f)}`));
        console.log('');

        let idx = 0;
        function applyNext() {
            if (idx >= pending.length) {
                console.log(`\n[OK] All ${pending.length} update(s) applied successfully!`);
                db.run(`UPDATE system_meta SET value = ?, updated_at = datetime('now') WHERE key = 'version'`, 
                    [`${VERSION} ${CODENAME}`]);
                db.close();
                return;
            }

            const file = pending[idx];
            const name = path.basename(file);
            console.log(`\n[${idx + 1}/${pending.length}] Applying: ${name}...`);

            try {
                const update = require(file);
                update(db, (err) => {
                    if (err) {
                        console.error(`   [ERROR] FAILED: ${err.message}`);
                        console.error('   Stopping. Fix the issue and re-run.');
                        db.close();
                        process.exit(1);
                    }
                    // Mark as applied
                    db.run(`INSERT OR REPLACE INTO system_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
                        [`update_${name}`, name]);
                    console.log(`   [OK] ${name} applied`);
                    idx++;
                    applyNext();
                });
            } catch (e) {
                console.error(`   [ERROR] Error loading ${name}:`, e.message);
                db.close();
                process.exit(1);
            }
        }

        applyNext();
    });
});
