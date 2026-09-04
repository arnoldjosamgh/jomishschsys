/**
 * Jomish Suite — Backup Engine
 * 
 * Copies the database to a backup location (e.g. flash drive).
 * Usage: node tools/backup.js [destination-folder]
 * 
 * If no destination, saves to data/backups/ inside the app.
 */

const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'jomish.db');
const DEFAULT_BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');

const destArg = process.argv[2];
const backupDir = destArg ? path.resolve(destArg) : DEFAULT_BACKUP_DIR;

console.log(`\n╔══════════════════════════════════════════╗`);
console.log(`║   JOMISH SUITE — BACKUP ENGINE           ║`);
console.log(`╚══════════════════════════════════════════╝\n`);

// Check DB exists
if (!fs.existsSync(DB_PATH)) {
    console.error('[ERROR] Database not found:', DB_PATH);
    process.exit(1);
}

// Create backup directory
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

// Generate backup filename with timestamp
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const timestamp = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
const backupName = `jomish_backup_${timestamp}.db`;
const backupPath = path.join(backupDir, backupName);

// Also create a metadata file
const metaName = `jomish_backup_${timestamp}.json`;
const metaPath = path.join(backupDir, metaName);

try {
    // Copy database file
    fs.copyFileSync(DB_PATH, backupPath);
    
    // Copy WAL and SHM files if they exist (for consistency)
    const walPath = DB_PATH + '-wal';
    const shmPath = DB_PATH + '-shm';
    if (fs.existsSync(walPath)) fs.copyFileSync(walPath, backupPath + '-wal');
    if (fs.existsSync(shmPath)) fs.copyFileSync(shmPath, backupPath + '-shm');

    // Get file size
    const stats = fs.statSync(backupPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    // Write metadata
    const meta = {
        version: '1.0 Genesis',
        backup_date: now.toISOString(),
        backup_file: backupName,
        database_size_mb: parseFloat(sizeMB),
        hostname: require('os').hostname(),
        note: 'Monthly backup — restore with Restore_Backup.vbs'
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    console.log(`[OK] Backup created successfully!\n`);
    console.log(`   File: ${backupPath}`);
    console.log(`   Size: ${sizeMB} MB`);
    console.log(`   Date: ${now.toLocaleString()}\n`);
    console.log(`   Copy the .db and .json files to your flash drive.\n`);

} catch (err) {
    console.error('[ERROR] Backup failed:', err.message);
    process.exit(1);
}
