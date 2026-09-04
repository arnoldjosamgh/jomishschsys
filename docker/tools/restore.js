/**
 * Jomish Suite — Restore Engine
 * 
 * Restores a backup database file.
 * Usage: node tools/restore.js <backup-file.db>
 * 
 * The current database is preserved as a safety copy.
 * After restore, the system warns about potential data loss.
 */

const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'jomish.db');
const backupFile = process.argv[2];

console.log(`\n╔══════════════════════════════════════════╗`);
console.log(`║   JOMISH SUITE — RESTORE ENGINE          ║`);
console.log(`╚══════════════════════════════════════════╝\n`);

if (!backupFile) {
    console.error('[ERROR] Usage: node tools/restore.js <path-to-backup.db>');
    console.error('   Example: node tools/restore.js E:\\jomish_backup_2026-05-09_20-00.db');
    process.exit(1);
}

const fullBackupPath = path.resolve(backupFile);

if (!fs.existsSync(fullBackupPath)) {
    console.error('[ERROR] Backup file not found:', fullBackupPath);
    process.exit(1);
}

// Check if it's a valid SQLite file (starts with "SQLite format 3")
const header = Buffer.alloc(16);
const fd = fs.openSync(fullBackupPath, 'r');
fs.readSync(fd, header, 0, 16, 0);
fs.closeSync(fd);
if (!header.toString().startsWith('SQLite format 3')) {
    console.error('[ERROR] This does not appear to be a valid SQLite database file.');
    process.exit(1);
}

const backupStats = fs.statSync(fullBackupPath);
const backupSizeMB = (backupStats.size / (1024 * 1024)).toFixed(2);

// Check for metadata
const metaFile = fullBackupPath.replace('.db', '.json');
let backupDate = 'Unknown';
if (fs.existsSync(metaFile)) {
    try {
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        backupDate = meta.backup_date || 'Unknown';
        console.log(`[LOG] Backup info:`);
        console.log(`   Version:  ${meta.version || 'Unknown'}`);
        console.log(`   Date:     ${new Date(meta.backup_date).toLocaleString()}`);
        console.log(`   Size:     ${meta.database_size_mb} MB`);
        console.log(`   From:     ${meta.hostname || 'Unknown'}\n`);
    } catch(e) {}
}

// Safety: save current database before overwriting
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;

if (fs.existsSync(DB_PATH)) {
    const safetyPath = DB_PATH.replace('.db', `_pre_restore_${ts}.db`);
    fs.copyFileSync(DB_PATH, safetyPath);
    console.log(`[SECURE] Current database saved as safety copy:`);
    console.log(`   ${safetyPath}\n`);
}

// Delete WAL and SHM files (they're tied to the old database)
const walPath = DB_PATH + '-wal';
const shmPath = DB_PATH + '-shm';
if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

// Restore
try {
    fs.copyFileSync(fullBackupPath, DB_PATH);
    
    // Restore WAL/SHM if they came with the backup
    const bkWal = fullBackupPath + '-wal';
    const bkShm = fullBackupPath + '-shm';
    if (fs.existsSync(bkWal)) fs.copyFileSync(bkWal, walPath);
    if (fs.existsSync(bkShm)) fs.copyFileSync(bkShm, shmPath);

    console.log(`[OK] Database restored successfully!`);
    console.log(`   Restored from: ${path.basename(fullBackupPath)}`);
    console.log(`   Size: ${backupSizeMB} MB\n`);

    // Mark the restore in the database
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(DB_PATH);
    
    db.run(`CREATE TABLE IF NOT EXISTS system_meta (
        key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now'))
    )`);
    
    db.run(`INSERT OR REPLACE INTO system_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
        ['last_restore', new Date().toISOString()]);
    db.run(`INSERT OR REPLACE INTO system_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
        ['restore_from_backup', backupDate]);
    db.run(`INSERT OR REPLACE INTO system_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
        ['data_loss_warning', `Data between ${backupDate} and ${now.toISOString()} may be lost due to system restore.`]);
    
    db.close(() => {
        console.log(`[WARN]  WARNING: Any data entered AFTER the backup date`);
        console.log(`   (${new Date(backupDate).toLocaleString()}) is LOST.`);
        console.log(`   The system will show a data-loss notice on next login.\n`);
        console.log(`   Start the server to continue working.\n`);
    });

} catch (err) {
    console.error('[ERROR] Restore failed:', err.message);
    process.exit(1);
}
