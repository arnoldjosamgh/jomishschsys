const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./database.js');

const router = express.Router();

// Middleware to authenticate
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    const jwt = require('jsonwebtoken');
    jwt.verify(token, process.env.JWT_SECRET || 'CHANGE_ME_TO_A_LONG_RANDOM_SECRET', (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// 1. Generate DOS Invite Link (Admin only)
router.post('/invite-link', authenticateToken, (req, res) => {
    if (req.user.role !== 'Admin' && req.user.role !== 'Headteacher') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const { levels_in_charge, email } = req.body;
    if (!levels_in_charge || !email) return res.status(400).json({ error: 'Missing fields' });

    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    
    const levelsStr = Array.isArray(levels_in_charge) ? levels_in_charge.join(',') : levels_in_charge;

    db.run(
        `INSERT INTO onboarding_tokens (token, company_prefix, company_name, business_email, expires_at, used, levels_in_charge)
         VALUES (?, 'dos_invite', 'DOS Invite', ?, ?, 0, ?)`,
        [token, email, expiresAt, levelsStr],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            const baseUrl = req.protocol + "://" + req.get("host");
            res.json({ token, link: `${baseUrl}/dos-register.html?token=${token}` });
        }
    );
});

// 2. Register DOS with Token
router.post('/register', async (req, res) => {
    const { token, first_name, last_name, password } = req.body;
    
    db.get(`SELECT * FROM onboarding_tokens WHERE token = ? AND company_prefix = 'dos_invite' AND used = 0`, [token], async (err, row) => {
        if (err || !row) return res.status(400).json({ error: 'Invalid or expired token' });
        if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'Token expired' });

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);
        const username = 'DOS' + Math.floor(Math.random() * 10000);

        db.run(
            `INSERT INTO users (first_name, last_name, email, password, role, username, levels_in_charge)
             VALUES (?, ?, ?, ?, 'DOS', ?, ?)`,
            [first_name, last_name, row.business_email, hash, username, row.levels_in_charge],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                db.run(`UPDATE onboarding_tokens SET used = 1 WHERE token = ?`, [token]);
                res.json({ success: true, message: 'DOS registered successfully', username });
            }
        );
    });
});

// 3. Add Teacher (DOS Portal)
router.post('/teachers', authenticateToken, async (req, res) => {
    if (req.user.role !== 'DOS') return res.status(403).json({ error: 'Forbidden' });
    const { first_name, last_name, email, phone, password } = req.body;

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    const username = 'TR' + Math.floor(Math.random() * 10000);

    db.run(
        `INSERT INTO users (first_name, last_name, email, phone, password, role, username)
         VALUES (?, ?, ?, ?, ?, 'Teacher', ?)`,
        [first_name, last_name, email, phone, hash, username],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, teacher_id: this.lastID, username });
        }
    );
});

// 4. Assign Class and Subject to Teacher
router.post('/teachers/:id/assignments', authenticateToken, (req, res) => {
    if (req.user.role !== 'DOS') return res.status(403).json({ error: 'Forbidden' });
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
