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

async function seedDefaultClassesAndSubjects(db, asyncLocalStorage, schemaName, isPostgres) {
    const doSeed = () => {
        const defaultClasses = [
            { name: 'Nursery Baby Class', level_category: 'Nursery' },
            { name: 'Nursery Middle', level_category: 'Nursery' },
            { name: 'Nursery Top', level_category: 'Nursery' },
            { name: 'P1', level_category: 'Primary' }, { name: 'P2', level_category: 'Primary' },
            { name: 'P3', level_category: 'Primary' }, { name: 'P4', level_category: 'Primary' },
            { name: 'P5', level_category: 'Primary' }, { name: 'P6', level_category: 'Primary' },
            { name: 'P7', level_category: 'Primary' },
            { name: 'S1 (O-Level)', level_category: 'Secondary O-Level' },
            { name: 'S2 (O-Level)', level_category: 'Secondary O-Level' },
            { name: 'S3 (O-Level)', level_category: 'Secondary O-Level' },
            { name: 'S4 (O-Level)', level_category: 'Secondary O-Level' },
            { name: 'S5 (A-Level)', level_category: 'Secondary A-Level' },
            { name: 'S6 (A-Level)', level_category: 'Secondary A-Level' },
            { name: 'University Year 1', level_category: 'University' },
        ];
        const defaultSubjects = [
            'Mathematics', 'English Language', 'Science', 'Social Studies',
            'Religious Education', 'Physical Education', 'Art', 'Music',
            'History', 'Geography', 'Biology', 'Chemistry', 'Physics',
            'Computer Science', 'Agriculture', 'Commerce', 'Luganda',
        ];
        defaultClasses.forEach(c => {
            db.run(
                `INSERT INTO classes (name, grade_level, level_category) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING`,
                [c.name, c.name, c.level_category], () => {}
            );
        });
        defaultSubjects.forEach(name => {
            const code = name.toUpperCase().replace(/\s+/g, '').substring(0, 6);
            db.run(
                `INSERT INTO subjects (name, code) VALUES (?, ?) ON CONFLICT (name) DO NOTHING`,
                [name, code], () => {}
            );
        });
        console.log('[SEED] Default classes and subjects seeded.');
    };
    if (isPostgres) asyncLocalStorage.run(schemaName, doSeed);
    else doSeed();
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

            if (v < 203) {
                tasks.push(cb => db.run("ALTER TABLE students ADD COLUMN IF NOT EXISTS class_id INTEGER", [], () => cb(null)));
                tasks.push(cb => db.run("ALTER TABLE students ADD COLUMN IF NOT EXISTS admission_number TEXT", [], () => cb(null)));
                tasks.push(cb => db.run("ALTER TABLE students ADD COLUMN IF NOT EXISTS date_of_admission DATE DEFAULT CURRENT_DATE", [], () => cb(null)));
                tasks.push(cb => db.run("ALTER TABLE students ADD COLUMN IF NOT EXISTS gender TEXT", [], () => cb(null)));
                tasks.push(cb => db.run("ALTER TABLE marks ADD COLUMN IF NOT EXISTS class_id INTEGER", [], () => cb(null)));
                tasks.push(cb => db.run("INSERT INTO system_info (key,value) VALUES ('version','203') ON CONFLICT (key) DO UPDATE SET value='203'", [], () => cb(null)));
            }

            if (v < 205) {
                tasks.push(cb => db.run("ALTER TABLE subjects ADD COLUMN IF NOT EXISTS level TEXT DEFAULT 'General'", [], (err) => {
                    if (err) console.error("[SEED ERROR] v205 subjects level:", err.message);
                    cb(null);
                }));
                tasks.push(cb => db.run("INSERT INTO system_info (key,value) VALUES ('version','205') ON CONFLICT (key) DO UPDATE SET value='205'", [], () => cb(null)));
            }

            if (v < 206) {
                tasks.push(cb => db.run(
                    `CREATE TABLE IF NOT EXISTS passkey_credentials (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, cred_id TEXT NOT NULL UNIQUE, cred_json TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
                    [], (err) => {
                        if (err) console.error("[SEED ERROR] v206 passkey_credentials:", err.message);
                        cb(null);
                    }
                ));
                tasks.push(cb => db.run("INSERT INTO system_info (key,value) VALUES ('version','206') ON CONFLICT (key) DO UPDATE SET value='206'", [], () => cb(null)));
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

module.exports = { seedSchoolTenant, seedDefaultClassesAndSubjects };

