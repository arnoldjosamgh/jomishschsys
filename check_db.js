const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"](.*)['"]$/, '$1');
        if (key && !(key in process.env)) process.env[key] = val;
    }
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
    const client = await pool.connect();
    try {
        const schema = 't_tsch';
        await client.query(`SET search_path TO "${schema}"`);

        // Check system_info version
        const ver = await client.query("SELECT value FROM system_info WHERE key = 'version'");
        console.log('DB version in t_tsch:', ver.rows[0]?.value || 'NOT SET');

        // Check tables
        const tables = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = '${schema}' ORDER BY tablename`);
        console.log('Tables in t_tsch:', tables.rows.map(r => r.tablename));

        // Check columns on students
        const cols = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = 'students' ORDER BY ordinal_position`);
        console.log('Students columns:', cols.rows.map(r => r.column_name));

        // Check columns on users
        const ucols = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = 'users' ORDER BY ordinal_position`);
        console.log('Users columns:', ucols.rows.map(r => r.column_name));

        // Check classes
        const classes = await client.query('SELECT * FROM classes LIMIT 5');
        console.log('Classes:', classes.rows);

        // Check subjects
        const subjects = await client.query('SELECT * FROM subjects LIMIT 10');
        console.log('Subjects:', subjects.rows);

        // Try an actual student insert test
        console.log('\n--- Testing student insert ---');
        const test = await client.query(
            `INSERT INTO students (first_name, last_name, student_id, status) VALUES ('Test', 'Student', 'TEST001', 'ACTIVE') ON CONFLICT (student_id) DO NOTHING RETURNING id`
        );
        console.log('Insert result:', test.rows);

        const students = await client.query('SELECT * FROM students');
        console.log('All students after test:', students.rows);

    } catch(e) {
        console.error('Error:', e.message);
    } finally {
        client.release();
        pool.end();
    }
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
