const fs = require('fs');
const envPath = require('path').join(__dirname, '..', '.env');
const lines = fs.readFileSync(envPath, 'utf8').split('\n');
let dbUrl = '';
for (const line of lines) {
    if (line.startsWith('DATABASE_URL=')) dbUrl = line.split('=')[1].trim().replace(/^[\'\"]|[\'\"]$/g, '');
}
const { Pool } = require('pg');
const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function main() {
    // Show all subjects
    const all = await pool.query("SELECT * FROM t_tsch.subjects ORDER BY level, name");
    console.log('All subjects:', all.rows);

    // Show by-level counts
    const counts = await pool.query("SELECT level, COUNT(*) as count FROM t_tsch.subjects WHERE level IS NOT NULL GROUP BY level ORDER BY level");
    console.log('By level:', counts.rows);

    // Try inserting a 4th subject into Nursery - Baby Class
    const existing = await pool.query("SELECT * FROM t_tsch.subjects WHERE level = 'Nursery - Baby Class'");
    console.log('Nursery - Baby Class subjects:', existing.rows);
}
main().then(() => process.exit(0)).catch(e => { console.error('Error:', e.message); process.exit(1); });
