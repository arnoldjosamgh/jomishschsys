const fs = require('fs');
const env = fs.readFileSync('../.env', 'utf8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=')[1].trim();

const { Client } = require('pg');
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
c.connect().then(() => {
    return c.query("SELECT table_schema, table_name, column_name FROM information_schema.columns WHERE table_name='subjects'");
}).then(r => {
    console.log("SUBJECTS TABLES & COLUMNS:");
    console.log(r.rows);
    process.exit();
}).catch(e => {
    console.error(e);
    process.exit(1);
});
