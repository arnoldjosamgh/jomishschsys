const db = require('./backend/database.js');
const bcrypt = require('bcryptjs');

// Check jomish.db (the main/public db) for companies
db.asyncLocalStorage.run('public', () => {
    db.all('SELECT * FROM companies', [], (err, companies) => {
        console.log('Companies in jomish.db:', err ? err.message : JSON.stringify(companies));
    });
    db.all('SELECT id, username, role, email FROM users LIMIT 10', [], (err, users) => {
        console.log('Users in jomish.db:', err ? err.message : JSON.stringify(users));
    });
});

// Check jomish_demo.db (demo prefix)
setTimeout(() => {
    db.asyncLocalStorage.run('demo', () => {
        db.all('SELECT id, username, role FROM users LIMIT 5', [], (err, users) => {
            console.log('Users in demo db:', err ? err.message : JSON.stringify(users));
        });
        db.all('SELECT * FROM companies LIMIT 3', [], (err, rows) => {
            console.log('Companies in demo db:', err ? err.message : JSON.stringify(rows));
        });
    });
}, 1000);

setTimeout(() => process.exit(0), 6000);
