const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db');

db.all("PRAGMA table_info(calendar_events)", [], (err, columns) => {
    console.log("Columns:", columns);
    db.all("SELECT rowid, id, title FROM calendar_events", [], (err, rows) => {
        console.log("Rows:", rows);
        db.close();
    });
});
