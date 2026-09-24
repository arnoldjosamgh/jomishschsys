const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./database.js');

const router = express.Router();

// authenticateToken is injected from server.js to use the SAME JWT_SECRET
// This avoids the fallback-string mismatch that was causing 403 Forbidden
let authenticateToken;

router.setAuth = function(fn) { authenticateToken = fn; };

// Helper middleware that defers to the injected auth
const auth = (req, res, next) => {
    if (!authenticateToken) return res.status(500).json({ error: 'Auth not configured' });
    authenticateToken(req, res, next);
};

// 1. Generate DOS Invite Link (Admin, Tech, or System Technician only)
router.post('/invite-link', auth, (req, res) => {
    const allowed = ['Admin', 'Headteacher', 'System Technician', 'Tech'];
    if (!allowed.includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const { levels_in_charge, email } = req.body;
    if (!levels_in_charge || !email) return res.status(400).json({ error: 'Missing fields' });

    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    
    const levelsStr = Array.isArray(levels_in_charge) ? levels_in_charge.join(',') : levels_in_charge;

    db.asyncLocalStorage.run("public", () => {
        db.run(
            `INSERT INTO onboarding_tokens (token, company_prefix, company_name, business_email, expires_at, used, levels_in_charge)
             VALUES (?, ?, 'dos_invite', ?, ?, 0, ?)`,
            [token, req.user.prefix || 'TSCH', email, expiresAt, levelsStr],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                const baseUrl = req.protocol + "://" + req.get("host");
                res.json({ token, link: `${baseUrl}/dos-register.html?token=${token}` });
            }
        );
    });
});

// 2. Register DOS with Token (no auth — uses invite token)
router.post('/register', async (req, res) => {
    const { token, first_name, last_name, password } = req.body;
    
    db.asyncLocalStorage.run("public", () => {
        db.get(`SELECT * FROM onboarding_tokens WHERE token = ? AND company_name = 'dos_invite' AND used = 0`, [token], async (err, row) => {
            if (err || !row) return res.status(400).json({ error: 'Invalid or expired token' });
            if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'Token expired' });

            const salt = await bcrypt.genSalt(10);
            const hash = await bcrypt.hash(password, salt);
            const companySchema = row.company_prefix === "public" ? "public" : "t_" + row.company_prefix.toLowerCase();
            const prefix = row.company_prefix.toUpperCase();

            db.asyncLocalStorage.run(companySchema, () => {
                db.get(`SELECT username FROM users WHERE username LIKE ? ORDER BY id DESC LIMIT 1`, [`${prefix}%`], (err, lastUser) => {
                    let nextNum = 2;
                    if (lastUser && lastUser.username) {
                        const match = lastUser.username.match(/\d+$/);
                        if (match) nextNum = parseInt(match[0]) + 1;
                    }
                    const username = prefix + String(nextNum).padStart(3, '0');

                    db.run(
                        `INSERT INTO users (first_name, last_name, email, password, role, username, levels_in_charge)
                         VALUES (?, ?, ?, ?, 'DOS', ?, ?)`,
                        [first_name, last_name, row.business_email, hash, username, row.levels_in_charge],
                        function(err) {
                            if (err) return res.status(500).json({ error: err.message });
                            db.asyncLocalStorage.run("public", () => {
                                db.run(`UPDATE onboarding_tokens SET used = 1 WHERE token = ?`, [token]);
                            });
                            res.json({ success: true, message: 'DOS registered successfully', username, prefix });
                        }
                    );
                });
            });
        });
    });
});

// 3. Add Teacher (DOS or Admin)
router.post('/teachers', auth, async (req, res) => {
    const allowed = ['DOS', 'Admin', 'Headteacher', 'Tech', 'System Technician'];
    if (!allowed.includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const { first_name, last_name, email, phone, password } = req.body;
    if (!first_name || !last_name || !password)
        return res.status(400).json({ error: 'Missing required fields' });

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    
    const prefix = req.user.prefix ? req.user.prefix.toUpperCase() : 'TSCH';
    
    db.get(`SELECT username FROM users WHERE username LIKE ? ORDER BY id DESC LIMIT 1`, [`${prefix}%`], (err, lastUser) => {
        let nextNum = 2;
        if (lastUser && lastUser.username) {
            const match = lastUser.username.match(/\d+$/);
            if (match) nextNum = parseInt(match[0]) + 1;
        }
        const username = prefix + String(nextNum).padStart(3, '0');

        db.run(
            `INSERT INTO users (first_name, last_name, email, phone, password, role, username)
             VALUES (?, ?, ?, ?, ?, 'Teacher', ?)`,
            [first_name, last_name, email || null, phone || null, hash, username],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, teacher_id: this.lastID, username });
            }
        );
    });
});

// 4. Assign Class and Subject to Teacher
router.post('/teachers/:id/assignments', auth, (req, res) => {
    const allowed = ['DOS', 'Admin', 'Headteacher', 'Tech', 'System Technician'];
    if (!allowed.includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const teacher_id = req.params.id;
    const { class_id, subject_id } = req.body;

    db.run(
        `INSERT INTO teacher_assignments (teacher_id, class_id, subject_id) VALUES (?, ?, ?)`,
        [teacher_id, class_id, subject_id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

module.exports = router;
