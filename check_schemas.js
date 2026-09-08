const db = require('./backend/database.js');

setTimeout(() => {
    db.asyncLocalStorage.run('public', () => {
        db.all(
            `SELECT schema_name FROM information_schema.schemata 
             WHERE schema_name LIKE 't_%' OR schema_name = 'public' 
             ORDER BY schema_name`,
            [],
            (err, rows) => {
                if (err) console.error('Error listing schemas:', err.message);
                else console.log('Existing schemas:', JSON.stringify(rows, null, 2));
            }
        );
        db.all(`SELECT id, prefix, name, status FROM companies`, [], (err, rows) => {
            if (err) console.error('Companies error:', err.message);
            else console.log('Companies in public schema:', JSON.stringify(rows, null, 2));
        });
    });
}, 1000);

setTimeout(() => process.exit(0), 6000);
