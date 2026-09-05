module.exports = function(app, db, io, asyncLocalStorage) {
    function getSchema() {
        return asyncLocalStorage.getStore() || "public";
    }

    // =====================================================
    // STUDENTS
    // =====================================================

    app.post("/api/school/students/apply", (req, res) => {
        const { first_name, last_name, email, phone, grade, parent_name, parent_phone } = req.body;
        const query = `INSERT INTO students (first_name, last_name, email, phone, grade, parent_name, parent_phone, status) VALUES (?,?,?,?,?,?,?,'PENDING')`;
        db.run(query, [first_name, last_name, email, phone, grade, parent_name, parent_phone], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            const student_id = this.lastID;
            db.run(`INSERT INTO applications (student_id) VALUES (?)`, [student_id], function(err2) {
                if (err2) return res.status(500).json({ error: err2.message });
                res.json({ success: true, message: "Application submitted successfully", student_id });
            });
        });
    });

    app.get("/api/school/applications", (req, res) => {
        db.all(`SELECT a.id as app_id, a.application_date, a.status, a.fee_paid, s.* FROM applications a JOIN students s ON a.student_id = s.id ORDER BY a.application_date DESC`, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    app.post("/api/school/applications/approve", (req, res) => {
        const { app_id, fee_amount, recorded_by } = req.body;
        db.get(`SELECT student_id FROM applications WHERE id = ?`, [app_id], (err, row) => {
            if (err || !row) return res.status(500).json({ error: err ? err.message : "Not found" });
            db.serialize(() => {
                db.run(`UPDATE applications SET status = 'APPROVED', fee_paid = 1 WHERE id = ?`, [app_id]);
                db.run(`UPDATE students SET status = 'ACTIVE' WHERE id = ?`, [row.student_id]);
                db.run(`INSERT INTO fees (student_id, amount, fee_type, status, paid_at, recorded_by) VALUES (?, ?, 'REGISTRATION', 'PAID', CURRENT_TIMESTAMP, ?)`, [row.student_id, fee_amount, recorded_by], (err2) => {
                    if (err2) return res.status(500).json({ error: err2.message });
                    res.json({ success: true });
                });
            });
        });
    });

    app.get("/api/school/students", (req, res) => {
        const { class_id, status } = req.query;
        let sql = `SELECT * FROM students WHERE 1=1`;
        const params = [];
        if (status) { sql += ` AND status = ?`; params.push(status); }
        if (class_id) { sql += ` AND class_id = ?`; params.push(class_id); }
        sql += ` ORDER BY last_name, first_name`;
        db.all(sql, params, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    app.post("/api/school/attendance/clock", (req, res) => {
        const { barcode, type } = req.body;
        db.get(`SELECT id FROM students WHERE barcode = ? OR student_id = ?`, [barcode, barcode], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: "Student not found" });
            db.run(`INSERT INTO attendance_logs (user_type, user_id, scan_type, status) VALUES ('STUDENT', ?, ?, 'PRESENT')`, [row.id, type], function(err2) {
                if (err2) return res.status(500).json({ error: err2.message });
                res.json({ success: true, message: `Clocked ${type}` });
            });
        });
    });

    // =====================================================
    // CLASSES
    // =====================================================

    app.get("/api/school/classes", (req, res) => {
        db.all(`SELECT * FROM classes ORDER BY grade_level, name`, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    app.post("/api/school/classes", (req, res) => {
        const { name, grade_level } = req.body;
        if (!name) return res.status(400).json({ error: "Class name required" });
        db.run(`INSERT INTO classes (name, grade_level) VALUES (?, ?)`, [name, grade_level || name], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, class_id: this.lastID });
        });
    });

    app.delete("/api/school/classes/:id", (req, res) => {
        db.run(`DELETE FROM classes WHERE id = ?`, [req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });

    // =====================================================
    // SUBJECTS
    // =====================================================

    app.get("/api/school/subjects", (req, res) => {
        db.all(`SELECT * FROM subjects ORDER BY name`, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    app.post("/api/school/subjects", (req, res) => {
        const { name, code } = req.body;
        db.run(`INSERT INTO subjects (name, code) VALUES (?, ?)`, [name, code], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, subject_id: this.lastID });
        });
    });

    // =====================================================
    // TEACHER ASSIGNMENTS
    // =====================================================

    app.get("/api/school/teacher-assignments", (req, res) => {
        const { teacher_id } = req.query;
        let sql = `SELECT ta.id, ta.teacher_id, ta.class_id, ta.subject_id,
                   c.name as class_name, c.grade_level, s.name as subject_name
                   FROM teacher_assignments ta
                   LEFT JOIN classes c ON ta.class_id = c.id
                   LEFT JOIN subjects s ON ta.subject_id = s.id WHERE 1=1`;
        const params = [];
        if (teacher_id) { sql += ` AND ta.teacher_id = ?`; params.push(teacher_id); }
        sql += ` ORDER BY c.grade_level, c.name, s.name`;
        db.all(sql, params, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    app.post("/api/school/teacher-assignments", (req, res) => {
        const { teacher_id, class_id, subject_id } = req.body;
        db.run(
            `INSERT INTO teacher_assignments (teacher_id, class_id, subject_id) VALUES (?,?,?) ON CONFLICT(teacher_id, class_id, subject_id) DO NOTHING`,
            [teacher_id, class_id, subject_id],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, assignment_id: this.lastID });
            }
        );
    });

    app.delete("/api/school/teacher-assignments/:id", (req, res) => {
        db.run(`DELETE FROM teacher_assignments WHERE id = ?`, [req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });

    // =====================================================
    // TIMETABLE CURRENT SLOT
    // =====================================================

    app.get("/api/school/timetable/current-slot", (req, res) => {
        const { teacher_id } = req.query;
        if (!teacher_id) return res.status(400).json({ error: "teacher_id required" });
        const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
        const now = new Date();
        const dayName = days[now.getDay()];
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        db.all(`
            SELECT sta.*, c.name as class_name, s.name as subject_name, c.id as class_id, s.id as subject_id
            FROM school_timetable sta
            LEFT JOIN classes c ON sta.class_id = c.id
            LEFT JOIN subjects s ON sta.subject_id = s.id
            WHERE sta.teacher_id = ? AND sta.day_of_week = ?
        `, [teacher_id, dayName], (err, rows) => {
            if (err) return res.json({ slot: null, message: "No school timetable configured yet." });
            const active = (rows || []).find(r => nowMinutes >= r.start_minutes && nowMinutes < r.end_minutes);
            res.json({ slot: active || null });
        });
    });

    // =====================================================
    // CLASS ATTENDANCE (ROLL CALL)
    // =====================================================

    app.post("/api/school/class-attendance", (req, res) => {
        const { class_id, subject_id, teacher_id, date, attendance } = req.body;
        if (!class_id || !subject_id || !teacher_id || !attendance) {
            return res.status(400).json({ error: "Missing required fields" });
        }
        const today = date || new Date().toISOString().split('T')[0];
        if (attendance.length === 0) return res.json({ success: true, inserted: 0 });
        let completed = 0, errors = 0;
        attendance.forEach(a => {
            db.run(
                `INSERT INTO class_attendance (student_id, class_id, subject_id, teacher_id, date, status)
                 VALUES (?,?,?,?,?,?)
                 ON CONFLICT(student_id, class_id, subject_id, date) DO UPDATE SET status = excluded.status, teacher_id = excluded.teacher_id`,
                [a.student_id, class_id, subject_id, teacher_id, today, a.status],
                function(err) {
                    if (err) errors++;
                    completed++;
                    if (completed === attendance.length) {
                        if (io) io.emit("db_updated", { module: "class_attendance" });
                        res.json({ success: true, inserted: completed - errors, errors });
                    }
                }
            );
        });
    });

    app.get("/api/school/class-attendance/missing", (req, res) => {
        const date = req.query.date || new Date().toISOString().split('T')[0];
        db.all(`
            SELECT ca.date, ca.status,
                   s.first_name, s.last_name, s.id as student_id,
                   c.name as class_name, sub.name as subject_name
            FROM class_attendance ca
            LEFT JOIN students s ON ca.student_id = s.id
            LEFT JOIN classes c ON ca.class_id = c.id
            LEFT JOIN subjects sub ON ca.subject_id = sub.id
            WHERE ca.date = ? AND ca.status = 'ABSENT'
            ORDER BY c.name, sub.name, s.last_name
        `, [date], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    // =====================================================
    // MARKS
    // =====================================================

    app.post("/api/school/marks", (req, res) => {
        const { student_id, subject_id, teacher_id, term, year, score, grade, exam_photo_base64 } = req.body;
        db.run(
            `INSERT INTO marks (student_id, subject_id, teacher_id, term, year, score, grade, exam_photo_base64) VALUES (?,?,?,?,?,?,?,?)`,
            [student_id, subject_id, teacher_id, term, year, score, grade, exam_photo_base64],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, mark_id: this.lastID });
            }
        );
    });

    app.get("/api/school/marks", (req, res) => {
        const { student_id, term, year } = req.query;
        let query = `SELECT m.*, s.name as subject_name FROM marks m LEFT JOIN subjects s ON m.subject_id = s.id WHERE 1=1`;
        let params = [];
        if (student_id) { query += ` AND m.student_id = ?`; params.push(student_id); }
        if (term) { query += ` AND m.term = ?`; params.push(term); }
        if (year) { query += ` AND m.year = ?`; params.push(year); }
        db.all(query, params, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    // =====================================================
    // NOTES
    // =====================================================

    app.post("/api/school/notes", (req, res) => {
        const { student_id, teacher_id, note_text } = req.body;
        db.run(`INSERT INTO student_notes (student_id, teacher_id, note_text) VALUES (?,?,?)`, [student_id, teacher_id, note_text], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (io) io.emit("dos_notification", { type: "new_note", student_id, note_id: this.lastID });
            res.json({ success: true, note_id: this.lastID });
        });
    });

    app.get("/api/school/notes", (req, res) => {
        db.all(`SELECT n.*, s.first_name, s.last_name FROM student_notes n LEFT JOIN students s ON n.student_id = s.id ORDER BY n.created_at DESC`, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    // =====================================================
    // REPORTS
    // =====================================================

    app.post("/api/school/reports/generate", (req, res) => {
        const { term, year } = req.body;
        db.all(`SELECT student_id, SUM(score) as total_score, AVG(score) as average_score FROM marks WHERE term = ? AND year = ? GROUP BY student_id ORDER BY total_score DESC`, [term, year], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            let pos = 1;
            db.serialize(() => {
                rows.forEach(r => {
                    db.run(`INSERT INTO reports (student_id, term, year, total_score, average_score, position) VALUES (?,?,?,?,?,?)`, [r.student_id, term, year, r.total_score, r.average_score, pos]);
                    pos++;
                });
                res.json({ success: true, message: `Generated reports for ${rows.length} students.` });
            });
        });
    });

    app.get("/api/school/reports", (req, res) => {
        const { term, year } = req.query;
        db.all(`SELECT r.*, s.first_name, s.last_name FROM reports r LEFT JOIN students s ON r.student_id = s.id WHERE r.term = ? AND r.year = ? ORDER BY r.position ASC`, [term, year], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    app.post("/api/school/reports/sign", (req, res) => {
        const { report_id, dos_id } = req.body;
        db.run(`UPDATE reports SET signed_by_dos = ? WHERE id = ?`, [dos_id, report_id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });

    // =====================================================
    // FINANCE
    // =====================================================

    app.post("/api/school/term-fees", (req, res) => {
        const { term, year, amount } = req.body;
        db.run(`INSERT INTO term_fees (term, year, amount) VALUES (?, ?, ?) ON CONFLICT(term, year) DO UPDATE SET amount = excluded.amount`, [term, year, amount], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });

    app.get("/api/school/term-fees", (req, res) => {
        const { term, year } = req.query;
        db.get(`SELECT amount FROM term_fees WHERE term = ? AND year = ?`, [term, year], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ amount: row ? row.amount : 0 });
        });
    });

    app.post("/api/school/payments/bulk-import", (req, res) => {
        const { payments, term, year, recorded_by } = req.body;
        if (!payments || !Array.isArray(payments)) return res.status(400).json({ error: 'Invalid payments data' });
        if (payments.length === 0) return res.json({ success: true, inserted: 0 });
        let insertedCount = 0, processedCount = 0;
        const checkDone = () => { processedCount++; if (processedCount === payments.length) res.json({ success: true, inserted: insertedCount }); };
        payments.forEach(p => {
            db.get(`SELECT id FROM students WHERE student_id = ? OR id = ?`, [p.student_id, p.student_id], (err, student) => {
                if (student) {
                    db.run(`INSERT INTO fees (student_id, amount, fee_type, status, paid_at, recorded_by, term, year, source) VALUES (?, ?, 'Tuition', 'PAID', ?, ?, ?, ?, 'SchoolPay')`, [student.id, p.amount, p.date || new Date().toISOString(), recorded_by, term, year], (err2) => { if (!err2) insertedCount++; checkDone(); });
                } else { checkDone(); }
            });
        });
    });

    app.get("/api/school/payments/reports", (req, res) => {
        const { term, year, filter } = req.query;
        db.get(`SELECT amount FROM term_fees WHERE term = ? AND year = ?`, [term, year], (err, tf) => {
            if (err) return res.status(500).json({ error: err.message });
            const expectedAmount = tf ? tf.amount : 0;
            db.all(`SELECT s.id, s.first_name, s.last_name, s.student_id, COALESCE(SUM(f.amount), 0) as total_paid FROM students s LEFT JOIN fees f ON s.id = f.student_id AND f.term = ? AND f.year = ? AND f.status = 'PAID' GROUP BY s.id`, [term, year], (err2, students) => {
                if (err2) return res.status(500).json({ error: err2.message });
                const report = students.map(s => { const pct = expectedAmount > 0 ? (s.total_paid / expectedAmount) * 100 : 0; return { ...s, expected: expectedAmount, balance: expectedAmount - s.total_paid, percentage: pct }; });
                let filtered = report;
                if (filter === '100') filtered = report.filter(s => s.percentage >= 100);
                else if (filter === '50') filtered = report.filter(s => s.percentage < 100 && s.percentage > 0);
                else if (filter === 'unpaid') filtered = report.filter(s => s.percentage === 0);
                res.json(filtered);
            });
        });
    });
    // ==========================================
    // School Calendar Events
    // ==========================================

    app.get("/api/school/events", (req, res) => {
        db.all(`SELECT * FROM school_events ORDER BY event_date ASC`, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    app.post("/api/school/events", (req, res) => {
        const { title, event_date, event_type, description } = req.body;
        db.run(
            `INSERT INTO school_events (title, event_date, event_type, description) VALUES (?, ?, ?, ?)`,
            [title, event_date, event_type, description],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, id: this.lastID });
            }
        );
    });

    app.delete("/api/school/events/:id", (req, res) => {
        db.run(`DELETE FROM school_events WHERE id = ?`, [req.params.id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });
};
