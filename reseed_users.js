// Full clean reseed — wipes ALL users in t_tsch and creates fresh TSCH-prefixed ones
const db = require('./backend/database.js');
const bcrypt = require('bcryptjs');

async function fullReseed() {
    const prefix = 't_tsch';

    // Step 1: Wipe all users
    await new Promise((resolve) => {
        db.asyncLocalStorage.run(prefix, () => {
            db.run(`DELETE FROM users`, [], (err) => {
                if (err) console.error('Error wiping users:', err.message);
                else console.log('Wiped all users from t_tsch');
                resolve();
            });
        });
    });

    await new Promise(resolve => setTimeout(resolve, 800));

    // Step 2: Reset the ID sequence (Postgres)
    await new Promise((resolve) => {
        db.asyncLocalStorage.run(prefix, () => {
            db.run(`ALTER SEQUENCE users_id_seq RESTART WITH 1`, [], (err) => {
                if (err) console.log('(sequence reset skipped or already clean)');
                else console.log('ID sequence reset');
                resolve();
            });
        });
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    // Step 3: Insert fresh users
    const users = [
        { first_name: 'School', last_name: 'Admin',      email: 'admin@school.edu',      username: 'TSCH00001', role: 'Admin',       department: 'Administration', user_code: 'TSCH00001' },
        { first_name: 'School', last_name: 'Secretary',  email: 'secretary@school.edu',  username: 'TSCH00002', role: 'Secretary',   department: 'Administration', user_code: 'TSCH00002' },
        { first_name: 'School', last_name: 'DOS',        email: 'dos@school.edu',        username: 'TSCH00003', role: 'DOS',         department: 'Academic',       user_code: 'TSCH00003' },
        { first_name: 'School', last_name: 'Teacher',    email: 'teacher@school.edu',    username: 'TSCH00004', role: 'Teacher',     department: 'Academic',       user_code: 'TSCH00004' },
        { first_name: 'School', last_name: 'Headteacher',email: 'head@school.edu',       username: 'TSCH00005', role: 'Headteacher', department: 'Administration', user_code: 'TSCH00005' },
    ];

    for (const u of users) {
        const hash = await bcrypt.hash('Admin', 10);
        await new Promise((resolve) => {
            db.asyncLocalStorage.run(prefix, () => {
                db.run(
                    `INSERT INTO users (first_name, last_name, email, username, role, department, password, is_active, user_code)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8)`,
                    [u.first_name, u.last_name, u.email, u.username, u.role, u.department, hash, u.user_code],
                    (err) => {
                        if (err) console.error(`Error creating ${u.role}:`, err.message);
                        else console.log(`✓ Created ${u.role}: ${u.username}`);
                        resolve();
                    }
                );
            });
        });
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 4: Verify
    await new Promise((resolve) => {
        db.asyncLocalStorage.run(prefix, () => {
            db.all('SELECT id, username, role, email FROM users ORDER BY id', [], (err, users) => {
                console.log('\n=== Final Users in t_tsch ===');
                if (err) { console.error(err.message); resolve(); return; }
                users.forEach(u => console.log(`  [${u.id}] ${u.username} | ${u.role} | ${u.email}`));
                console.log('\nAll passwords: Admin');
                console.log('Login credentials:');
                console.log('  TSCH00001 / Admin  (Admin)');
                console.log('  TSCH00005 / Admin  (Headteacher)');
                console.log('==============================\n');
                resolve();
            });
        });
    });

    process.exit(0);
}

fullReseed().catch(console.error);
