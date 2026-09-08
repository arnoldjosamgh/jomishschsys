const db = require('./backend/database.js');

setTimeout(() => {
    db.asyncLocalStorage.run('t_tsch', () => {
        db.all('SELECT id, username, role, email, is_active FROM users', [], (err, users) => {
            console.log('\n=== Users in t_tsch schema ===');
            if (err) console.error(err.message);
            else users.forEach(u => console.log(`  [${u.id}] ${u.username} | ${u.role} | ${u.email} | active=${u.is_active}`));
        });
    });
}, 1000);

setTimeout(() => process.exit(0), 5000);
