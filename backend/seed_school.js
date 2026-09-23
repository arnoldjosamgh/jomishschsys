/**
 * seed_school.js
 * Ensures the school tenant schema exists and is migrated on every startup.
 * SCHOOL_PREFIX env var controls the tenant prefix (default: TSCH).
 */
const bcrypt = require("bcryptjs");

async function seedSchoolTenant(db, asyncLocalStorage) {
    const isPostgres = !!db.createCompanySchema;
    const prefix = (process.env.SCHOOL_PREFIX || "TSCH").toUpperCase();
    const schemaName = isPostgres ? "t_" + prefix.toLowerCase() : "public";

    console.log(`[SEED] Checking school tenant "${prefix}" (schema: ${schemaName})...`);

    if (isPostgres) {
        try {
            await db.createCompanySchema(prefix);
            console.log(`[SEED] Schema "${schemaName}" ready.`);
        } catch (err) {
            if (!err.message || !err.message.includes("already exists")) {
                console.error("[SEED] Error creating school schema:", err.message);
            }
        }
    }

    await new Promise((resolve) => {
        const run = () => {
            db.get(
                "SELECT id FROM users WHERE username = ?",
                [prefix + "00001"],
                async (err, row) => {
                    if (row) {
                        console.log("[SEED] School admin already exists. Running migrations...");
                        return runSchemaMigrations(db, asyncLocalStorage, schemaName, isPostgres, resolve);
                    }
                    try {
                        const hash = await bcrypt.hash("Admin", 10);
                        const username = prefix + "00001";
                        db.run(
                            "INSERT INTO users (first_name, last_name, email, password, role, username, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)",
                            ["School", "Admin", "admin@school.com", hash, "Admin", username],
                            function(err2) {
                                if (err2) console.error("[SEED] Admin seed error:", err2.message);
                                else console.log(`[SEED] Admin created: ${username} / Admin`);
                                runSchemaMigrations(db, asyncLocalStorage, schemaName, isPostgres, resolve);
                            }
                        );
                    } catch (e) {
                        console.error("[SEED] bcrypt error:", e.message);
                        resolve();
                    }
                }
            );
        };
        if (isPostgres) asyncLocalStorage.run(schemaName, run);
        else run();
    });

    console.log(`[SEED] School tenant "${prefix}" done.`);
}

function runSchemaMigrations(db, asyncLocalStorage, schemaName, isPostgres, resolve) {
    const doIt = () => {
        db.get("SELECT value FROM system_info WHERE key = 'version'", (err, row) => {
            const v = row ? parseInt(row.value) : 0;
            console.log(`[SEED] Schema "${schemaName}" at migration v${v}`);
            const tasks = [];

            if (v < 201) {
                ["can_see_admin","can_see_headteacher","can_see_teacher","can_see_accounts","can_see_dos"].forEach(col => {
                    tasks.push(cb => db.run(`ALTER TABLE roles_config ADD COLUMN IF NOT EXISTS ${col} INTEGER DEFAULT 0`, [], () => cb(null)));
                });
                ["term","year","source"].forEach(col => {
                    tasks.push(cb => db.run(`ALTER TABLE fees ADD COLUMN IF NOT EXISTS ${col} TEXT`, [], () => cb(null)));
                });
                tasks.push(cb => db.run(`ALTER TABLE marks ADD COLUMN IF NOT EXISTS exam_photo_base64 TEXT`, [], () => cb(null)));
                tasks.push(cb => db.run("INSERT INTO system_info (key,value) VALUES ('version','201') ON CONFLICT (key) DO UPDATE SET value='201'", [], () => cb(null)));
            }

            if (v < 202) {
                tasks.push(cb => db.run("ALTER TABLE users ADD COLUMN IF NOT EXISTS levels_in_charge TEXT", [], () => cb(null)));
                tasks.push(cb => db.run("ALTER TABLE onboarding_tokens ADD COLUMN IF NOT EXISTS levels_in_charge TEXT", [], () => cb(null)));
                tasks.push(cb => db.run("ALTER TABLE classes ADD COLUMN IF NOT EXISTS level_category TEXT", [], () => cb(null)));
                tasks.push(cb => db.run("INSERT INTO system_info (key,value) VALUES ('version','202') ON CONFLICT (key) DO UPDATE SET value='202'", [], () => cb(null)));
            }

            if (tasks.length === 0) {
                console.log(`[SEED] "${schemaName}" is fully migrated.`);
                return resolve();
            }

            let i = 0;
            function next() { if (i >= tasks.length) { console.log("[SEED] Migrations done."); return resolve(); } tasks[i++](next); }
            next();
        });
    };
    if (isPostgres) asyncLocalStorage.run(schemaName, doIt);
    else doIt();
}

module.exports = { seedSchoolTenant };
