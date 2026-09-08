// Seed admin user with correct column names
const db = require('./backend/database.js');
const bcrypt = require('bcryptjs');

// Helper: upsert a user (works for both SQLite and PostgreSQL)
function upsertUser(db, prefix, fields, callback) {
    const { first_name, last_name, email, username, role, department, password, user_code } = fields;
    const isPostgres = !!db.createCompanySchema;

    let sql, params;
    if (isPostgres) {
        // PostgreSQL: use ON CONFLICT ... DO UPDATE
        sql = `INSERT INTO users (first_name, last_name, email, username, role, department, password, is_active, user_code)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8)
               ON CONFLICT (username) DO UPDATE SET
                 first_name = EXCLUDED.first_name,
                 last_name = EXCLUDED.last_name,
                 email = EXCLUDED.email,
                 role = EXCLUDED.role,
                 department = EXCLUDED.department,
                 password = EXCLUDED.password,
                 is_active = 1,
                 user_code = EXCLUDED.user_code`;
        params = [first_name, last_name, email, username, role, department, password, user_code];
    } else {
        // SQLite: use INSERT OR REPLACE
        sql = `INSERT OR REPLACE INTO users 
               (first_name, last_name, email, username, role, department, password, is_active, user_code)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`;
        params = [first_name, last_name, email, username, role, department, password, user_code];
    }

    db.asyncLocalStorage.run(prefix, () => {
        db.run(sql, params, callback);
    });
}

async function seedAdmin() {
    const prefix = 't_tsch'; // Postgres schema for TSCH company

    const users = [
        { first_name: 'School', last_name: 'Admin',      email: 'admin@school.edu',     username: 'TSCH00001', role: 'Admin',       department: 'Administration', user_code: 'TSCH00001' },
        { first_name: 'School', last_name: 'Secretary',  email: 'secretary@school.edu', username: 'TSCH00002', role: 'Secretary',   department: 'Administration', user_code: 'TSCH00002' },
        { first_name: 'School', last_name: 'DOS',        email: 'dos@school.edu',       username: 'TSCH00003', role: 'DOS',         department: 'Academic',       user_code: 'TSCH00003' },
        { first_name: 'School', last_name: 'Teacher',   email: 'teacher@school.edu',   username: 'TSCH00004', role: 'Teacher',     department: 'Academic',       user_code: 'TSCH00004' },
        { first_name: 'School', last_name: 'Headteacher',email: 'head@school.edu',      username: 'TSCH00005', role: 'Headteacher', department: 'Administration', user_code: 'TSCH00005' },
    ];

    for (const u of users) {
        const hash = await bcrypt.hash('Admin', 10);
        await new Promise((resolve) => {
            upsertUser(db, prefix, { ...u, password: hash }, (err) => {
                if (err) console.error(`Error creating ${u.role}:`, err.message);
                else console.log(`Created ${u.role}: ${u.username}`);
                resolve();
            });
        });
    }

    // Verify
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await new Promise((resolve) => {
        db.asyncLocalStorage.run(prefix, () => {
            db.all('SELECT id, username, role, first_name FROM users', [], (err, users) => {
                console.log('\n=== ALL SCHOOL USERS ===');
                if (err) { console.error(err.message); resolve(); return; }
                if (!users || users.length === 0) {
                    console.log('  (no users found — check that schema t_tsch exists)');
                } else {
                    users.forEach(u => console.log(`  ${u.username} | ${u.role} | ${u.first_name}`));
                }
                console.log('\nPassword for all: Admin');
                console.log('========================\n');
                resolve();
            });
        });
    });

    process.exit(0);
}

seedAdmin().catch(console.error);
