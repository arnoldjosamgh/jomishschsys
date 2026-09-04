const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('../data/jomish.db');

db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", (e,r) => {
    if (e) { console.error('Tables error:', e.message); return; }
    console.log('=== ALL TABLES ===');
    console.log(r.map(t=>t.name).join(', '));

    db.all("PRAGMA table_info(deliveries)", (e2, r2) => {
        console.log('\n=== DELIVERIES COLUMNS ===');
        if (e2) { console.error(e2.message); } 
        else { r2.forEach(c => console.log(' ', c.cid, c.name, '|', c.type, '| dflt:', c.dflt_value)); }
    });
    db.all("PRAGMA table_info(pos_orders)", (e2, r2) => {
        console.log('\n=== POS_ORDERS COLUMNS ===');
        if (e2) { console.error(e2.message); } 
        else { r2.forEach(c => console.log(' ', c.cid, c.name, '|', c.type, '| dflt:', c.dflt_value)); }
    });

    setTimeout(() => db.close(), 1000);
});
