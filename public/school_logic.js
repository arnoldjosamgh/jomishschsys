document.addEventListener("DOMContentLoaded", () => {
    const role = localStorage.getItem("jomish_role");
    const userName = localStorage.getItem("jomish_name") || role;

    const dosBtn = document.querySelector('.nav-btn.dos-only');
    const teacherBtn = document.querySelector('.nav-btn.teacher-only');
    const accBtn = document.querySelector('.nav-btn.accounts-only');


    // Single-hub roles — users who only need one focused area
    const singleHubRoles = {
        'DOS':      { btn: dosBtn,     target: 'dos-hub',      label: 'DOS Hub' },
        'Teacher':  { btn: teacherBtn, target: 'teacher-hub',  label: 'Teacher Hub' },
        'Accounts': { btn: accBtn,     target: 'accounts-hub', label: 'Accounts Hub' },
    };

    if (role === 'Secretary' || role === 'Secretary Hub') {
        // Secretary is not single hub, but they shouldn't see other main tabs 
        // We handle their nav in app.js or here
        setTimeout(() => {
            const tabsToHide = ['dashboard', 'transport-hub', 'accounts-hub', 'dos-hub', 'teacher-hub'];
            tabsToHide.forEach(tab => {
                const btn = document.querySelector(`button[data-target="${tab}"]`);
                if(btn) btn.style.display = 'none';
            });
            // Auto click secretary hub if not already there
            const secBtn = document.querySelector('button[data-target="secretary-hub"]');
            if(secBtn) secBtn.click();
        }, 400);
    }


    if (singleHubRoles[role]) {
        const { btn, target, label } = singleHubRoles[role];
        if (btn) btn.style.display = 'block';

        // After a short delay (let app.js finish its own init), perform focused redirect
        setTimeout(() => {
            // 1. Hide the main sidebar completely
            const sidebar = document.getElementById('main-sidebar');
            if (sidebar) sidebar.style.display = 'none';

            // 2. Hide the mobile topbar hamburger (no sidebar to open)
            const mobileTopbar = document.getElementById('mobile-topbar');
            if (mobileTopbar) mobileTopbar.style.display = 'none';

            // 3. Remove the sidebar margin from the main content so it fills the screen
            const appContainer = document.querySelector('.app-container');
            if (appContainer) {
                appContainer.style.gridTemplateColumns = '1fr';
                appContainer.style.marginLeft = '0';
            }
            const mainContent = document.querySelector('.main-content');
            if (mainContent) {
                mainContent.style.marginLeft = '0';
                mainContent.style.width = '100%';
            }

            // 4. Inject a minimal top bar showing the user name, role badge, and logout
            const topBar = document.createElement('div');
            topBar.id = 'focused-topbar';
            topBar.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0; z-index: 1000;
                display: flex; align-items: center; justify-content: space-between;
                padding: 12px 24px;
                background: var(--surface, #1e1e2e);
                border-bottom: 1px solid var(--border, rgba(255,255,255,0.08));
                box-shadow: 0 2px 16px rgba(0,0,0,0.3);
            `;
            topBar.innerHTML = `
                <div style="display:flex; align-items:center; gap:12px;">
                    <span style="font-size:1.2rem; font-weight:800; color:var(--primary, #6366f1);">${label}</span>
                    <span style="font-size:0.72rem; background:var(--primary,#6366f1); color:#fff; padding:3px 10px; border-radius:20px; font-weight:600; letter-spacing:0.5px;">${role.toUpperCase()}</span>
                </div>
                <div style="display:flex; align-items:center; gap:14px;">
                    <span style="font-size:0.85rem; color:var(--text-muted,#94a3b8);"><i class="fa-solid fa-circle-user"></i> ${userName}</span>
                    <button onclick="handleSchoolLogout()" style="background:rgba(239,68,68,0.12); color:#ef4444; border:1px solid rgba(239,68,68,0.3); padding:7px 16px; border-radius:8px; cursor:pointer; font-size:0.82rem; font-weight:600;">
                        <i class="fa-solid fa-right-from-bracket"></i> Logout
                    </button>
                </div>
            `;
            document.body.prepend(topBar);

            // 5. Push down main content to clear the topbar
            if (mainContent) mainContent.style.paddingTop = '70px';

            // 6. Navigate to the correct section by clicking the nav button
            const targetBtn = document.querySelector(`[data-target="${target}"]`);
            if (targetBtn) {
                targetBtn.click();
            } else {
                // Fallback: manually show section
                document.querySelectorAll('.view-section').forEach(s => {
                    s.classList.remove('active');
                    s.classList.add('hidden');
                });
                const targetSection = document.getElementById(target);
                if (targetSection) {
                    targetSection.classList.remove('hidden');
                    targetSection.classList.add('active');
                }
            }
        }, 350); // slight delay so app.js init runs first

    } else {
        // Admin / Headteacher — show all school hubs in the regular sidebar
        if (dosBtn) dosBtn.style.display = 'block';
        if (teacherBtn) teacherBtn.style.display = 'block';
        if (accBtn) accBtn.style.display = 'block';
    }
});

window.handleSchoolLogout = function() {
    if (!confirm('Are you sure you want to logout?')) return;
    localStorage.removeItem('jomish_token');
    localStorage.removeItem('jomish_role');
    localStorage.removeItem('jomish_name');
    localStorage.removeItem('jomish_offline_mode');
    window.location.replace('login.html');
};


window.switchSecretaryView = function(viewName) {
    document.querySelectorAll('.sec-sub-view').forEach(v => v.classList.add('hidden'));
    const targetView = document.getElementById('sec-' + viewName + '-view');
    if (targetView) targetView.classList.remove('hidden');
    
    document.querySelectorAll('#secretary-hub .nav-btn').forEach(b => b.classList.remove('active'));
    const targetBtn = document.getElementById('btn-sec-' + viewName);
    if (targetBtn) targetBtn.classList.add('active');

    if (viewName === 'students') {
        // Refresh students if needed
    } else if (viewName === 'timetable') {
        loadClassTimetable();
    } else if (viewName === 'calendar') {
        loadSchoolEvents();
    }
};

window.loadSchoolEvents = async function() {
    const tbody = document.getElementById('school-events-tbody');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Loading events...</td></tr>';
    
    const events = await apiGet('/events');
    tbody.innerHTML = '';
    
    if(!events || events.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No upcoming events.</td></tr>';
        return;
    }
    
    events.forEach(e => {
        let typeBadgeColor = 'var(--primary)';
        if (e.event_type === 'Holiday') typeBadgeColor = 'var(--success)';
        if (e.event_type === 'Exam Period') typeBadgeColor = 'var(--warning)';
        if (e.event_type === 'Visitation Day') typeBadgeColor = 'var(--info)';
        
        tbody.innerHTML += `
            <tr>
                <td><strong>${e.event_date}</strong></td>
                <td>${e.title}</td>
                <td><span style="background:${typeBadgeColor}; color:white; padding:4px 8px; border-radius:4px; font-size:0.75rem;">${e.event_type}</span></td>
                <td>${e.description || '-'}</td>
                <td>
                    <button class="danger-btn sm-btn" onclick="deleteSchoolEvent(${e.id})"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    });
};

window.submitSchoolEvent = async function() {
    const title = document.getElementById('ev-title').value;
    const event_date = document.getElementById('ev-date').value;
    const event_type = document.getElementById('ev-type').value;
    const description = document.getElementById('ev-desc').value;
    
    if (!title || !event_date || !event_type) return alert("Please fill the required fields.");
    
    const res = await apiPost('/events', { title, event_date, event_type, description });
    if (res.success) {
        alert("Event added!");
        document.getElementById('form-add-school-event').reset();
        loadSchoolEvents();
    } else {
        alert("Error adding event: " + res.error);
    }
};

window.deleteSchoolEvent = async function(id) {
    if (!confirm("Are you sure you want to delete this event?")) return;
    const token = localStorage.getItem('jomish_token');
    const prefix = localStorage.getItem('jomish_prefix') || '';
    const res = await fetch('/api/school/events/' + id, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token, 'x-company-prefix': prefix }
    });
    const data = await res.json();
    if (data.success) {
        loadSchoolEvents();
    } else {
        alert("Error deleting event: " + data.error);
    }
};

window.loadClassTimetable = async function() {
    const table = document.getElementById('school-timetable-table').querySelector('tbody');
    table.innerHTML = '<tr><td colspan="4" style="text-align:center;">Loading timetable...</td></tr>';
    
    // In a real app we would call /api/school/timetable
    // For now we'll mock it based on classes and assignments
    const assignments = await apiGet('/teacher-assignments');
    table.innerHTML = '';
    
    if(!assignments || assignments.length === 0) {
        table.innerHTML = '<tr><td colspan="4" style="text-align:center;">No timetable records found.</td></tr>';
        return;
    }
    
    assignments.forEach(a => {
        table.innerHTML += `
            <tr>
                <td>Any Time (Mock)</td>
                <td>${a.class_name || 'N/A'}</td>
                <td>${a.subject_name || 'N/A'}</td>
                <td>Teacher #${a.teacher_id}</td>
            </tr>
        `;
    });
};

// --- NEW TEACHER HUB LOGIC ---

window.switchTeacherView = function(viewName) {
    document.querySelectorAll('.teacher-sub-view').forEach(v => v.classList.add('hidden'));
    const targetView = document.getElementById('teacher-' + viewName + '-view');
    if (targetView) targetView.classList.remove('hidden');
    document.querySelectorAll('#teacher-hub .nav-btn').forEach(b => b.classList.remove('active'));
    
    const targetBtn = document.getElementById('btn-teacher-' + viewName);
    if (targetBtn) targetBtn.classList.add('active');

    if (viewName === 'marks') {
        loadTeacherClassesForMarks();
    } else if (viewName === 'notes') {
        loadStudentsForNotes();
    }
};

window.switchDOSView = function(viewName) {
    document.querySelectorAll('.dos-sub-view').forEach(v => v.classList.add('hidden'));
    document.getElementById('dos-' + viewName + '-view').classList.remove('hidden');
    document.querySelectorAll('#dos-hub .nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('btn-dos-' + viewName).classList.add('active');
    
    if (viewName === 'marks') loadAllMarks();
    if (viewName === 'notes') loadTeacherNotes();
    if (viewName === 'missing') loadMissingStudents();
};

// ==========================================
// Teacher - Upload Marks
// ==========================================

window.loadTeacherClassesForMarks = async function() {
    const teacher_id = localStorage.getItem('jomish_user_id') || 1;
    const assignments = await apiGet(`/teacher-assignments?teacher_id=${teacher_id}`);
    
    const classSelect = document.getElementById('t-class-id');
    classSelect.innerHTML = '<option value="">-- Select Class --</option>';
    
    // Unique classes
    const uniqueClasses = new Map();
    assignments.forEach(a => {
        if (a.class_id && !uniqueClasses.has(a.class_id)) {
            uniqueClasses.set(a.class_id, { id: a.class_id, name: a.class_name });
        }
    });

    uniqueClasses.forEach(c => {
        classSelect.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    });

    document.getElementById('t-subject-id').disabled = true;
    document.getElementById('t-student-id').disabled = true;
};

window.onTeacherClassChange = async function() {
    const class_id = document.getElementById('t-class-id').value;
    const subjectSelect = document.getElementById('t-subject-id');
    const studentSelect = document.getElementById('t-student-id');
    
    subjectSelect.innerHTML = '<option value="">-- Select Subject --</option>';
    studentSelect.innerHTML = '<option value="">-- Select Student --</option>';
    subjectSelect.disabled = true;
    studentSelect.disabled = true;

    if (!class_id) return;

    const teacher_id = localStorage.getItem('jomish_user_id') || 1;
    const assignments = await apiGet(`/teacher-assignments?teacher_id=${teacher_id}&class_id=${class_id}`);
    
    // Unique subjects for this class and teacher
    const uniqueSubjects = new Map();
    assignments.forEach(a => {
        if (a.subject_id && !uniqueSubjects.has(a.subject_id)) {
            uniqueSubjects.set(a.subject_id, { id: a.subject_id, name: a.subject_name });
        }
    });

    uniqueSubjects.forEach(s => {
        subjectSelect.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    });

    subjectSelect.disabled = false;
};

window.onTeacherSubjectChange = async function() {
    const class_id = document.getElementById('t-class-id').value;
    const studentSelect = document.getElementById('t-student-id');
    studentSelect.innerHTML = '<option value="">-- Select Student --</option>';
    studentSelect.disabled = true;

    if (!class_id) return;

    // Load students for this class
    const students = await apiGet(`/students/by-class?class_id=${class_id}`);
    students.forEach(s => {
        studentSelect.innerHTML += `<option value="${s.id}">${s.first_name} ${s.last_name} (${s.id})</option>`;
    });

    studentSelect.disabled = false;
};

// ==========================================
// Teacher - Roll Call
// ==========================================

let currentRollCall = null;

window.startAutoRollCall = async function() {
    const teacher_id = localStorage.getItem('jomish_user_id') || 1;
    const res = await apiGet(`/rollcall/active?teacher_id=${teacher_id}`);
    
    if (res.error) {
        alert(res.error);
        return;
    }

    currentRollCall = res;
    
    document.getElementById('rollcall-manual-pickers').style.display = 'none';
    document.getElementById('rollcall-session-info').style.display = 'block';
    document.getElementById('rollcall-session-text').innerHTML = `Auto-detected from Timetable: <strong>${res.class_name}</strong> - <strong>${res.subject_name}</strong>`;
    
    loadRollCallStudents(res.class_id);
};

window.startManualRollCall = async function() {
    currentRollCall = null;
    document.getElementById('rollcall-session-info').style.display = 'none';
    document.getElementById('rollcall-student-list').style.display = 'none';
    
    const pickers = document.getElementById('rollcall-manual-pickers');
    pickers.style.display = 'block';
    
    // Load classes
    const classes = await apiGet('/classes');
    const classSelect = document.getElementById('rc-class-id');
    classSelect.innerHTML = '<option value="">-- Select Class --</option>';
    classes.forEach(c => {
        classSelect.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    });
    
    // Load subjects
    const subjects = await apiGet('/subjects');
    const subjectSelect = document.getElementById('rc-subject-id');
    subjectSelect.innerHTML = '<option value="">-- Select Subject --</option>';
    subjects.forEach(s => {
        subjectSelect.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    });
};

window.loadStudentRollCallList = async function() {
    const class_id = document.getElementById('rc-class-id').value;
    const subject_id = document.getElementById('rc-subject-id').value;
    
    if (!class_id || !subject_id) return;
    
    currentRollCall = { class_id, subject_id };
    loadRollCallStudents(class_id);
};

window.loadRollCallStudents = async function(class_id) {
    const students = await apiGet(`/students/by-class?class_id=${class_id}`);
    const container = document.getElementById('rollcall-students-container');
    container.innerHTML = '';
    
    if (students.length === 0) {
        container.innerHTML = '<div style="padding:15px; color:var(--text-muted);">No students found in this class.</div>';
    } else {
        students.forEach(s => {
            container.innerHTML += `
                <div class="rollcall-row" style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid var(--border);">
                    <div style="font-weight:600; color:var(--text);">${s.first_name} ${s.last_name} <span style="color:var(--text-muted); font-size:0.8rem; font-weight:400; margin-left:8px;">ID: ${s.id}</span></div>
                    <div>
                        <label style="display:flex; align-items:center; gap:6px; cursor:pointer; color:var(--text); font-size:0.85rem;">
                            <input type="checkbox" class="rollcall-checkbox" data-student-id="${s.id}" style="width:18px; height:18px; accent-color:var(--primary);">
                            Present
                        </label>
                    </div>
                </div>
            `;
        });
    }
    
    document.getElementById('rollcall-student-list').style.display = 'block';
};

window.markAllPresent = function() {
    document.querySelectorAll('.rollcall-checkbox').forEach(cb => cb.checked = true);
};

window.submitRollCall = async function() {
    if (!currentRollCall || !currentRollCall.class_id || !currentRollCall.subject_id) {
        return alert("Missing class or subject info.");
    }
    
    const teacher_id = localStorage.getItem('jomish_user_id') || 1;
    const attendance_records = [];
    
    document.querySelectorAll('.rollcall-checkbox').forEach(cb => {
        const student_id = cb.getAttribute('data-student-id');
        const status = cb.checked ? 'PRESENT' : 'ABSENT';
        attendance_records.push({ student_id, status });
    });
    
    if (attendance_records.length === 0) return alert("No students in list.");
    
    const payload = {
        class_id: currentRollCall.class_id,
        subject_id: currentRollCall.subject_id,
        teacher_id,
        attendance_records
    };
    
    const res = await apiPost('/rollcall', payload);
    if (res.success) {
        alert("Roll call submitted successfully!");
        document.getElementById('rollcall-student-list').style.display = 'none';
        document.getElementById('rollcall-session-info').style.display = 'none';
        document.getElementById('rollcall-manual-pickers').style.display = 'none';
    } else {
        alert("Error: " + res.error);
    }
};

window.loadStudentsForNotes = async function() {
    const select = document.getElementById('t-note-student');
    const students = await apiGet('/students');
    select.innerHTML = '<option value="">-- Select Student --</option>';
    students.forEach(s => {
        select.innerHTML += `<option value="${s.id}">${s.first_name} ${s.last_name} (${s.id})</option>`;
    });
};

// ==========================================
// DOS - Missing Students
// ==========================================

window.loadMissingStudents = async function() {
    let date = document.getElementById('dos-missing-date').value;
    if (!date) {
        date = new Date().toISOString().split('T')[0];
        document.getElementById('dos-missing-date').value = date;
    }
    
    const missing = await apiGet(`/missing-students?date=${date}`);
    const summary = document.getElementById('dos-missing-summary');
    const tbody = document.querySelector('#dos-missing-table tbody');
    
    summary.innerHTML = `
        <div style="background:rgba(239,68,68,0.1); padding:10px 15px; border-radius:8px; border:1px solid rgba(239,68,68,0.2);">
            <div style="font-size:1.5rem; font-weight:800; color:#ef4444;">${missing.length}</div>
            <div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Total Missing Today</div>
        </div>
    `;
    
    tbody.innerHTML = '';
    
    if (missing.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No missing students reported.</td></tr>';
        return;
    }
    
    missing.forEach(m => {
        tbody.innerHTML += `
            <tr>
                <td><strong>${m.first_name} ${m.last_name}</strong> <span style="color:var(--text-muted); font-size:0.8rem;">(#${m.student_id})</span></td>
                <td>${m.class_name || 'N/A'}</td>
                <td>${m.subject_name || 'N/A'}</td>
                <td>${new Date(m.date).toLocaleString()}</td>
            </tr>
        `;
    });
};


// DOS Functions
window.generateReports = async function() {
    const term = document.getElementById('dos-term').value;
    const year = document.getElementById('dos-year').value;
    
    if (!term || !year) return alert("Enter term and year");
    
    const res = await apiPost('/reports/generate', { term, year });
    if (res.success) {
        alert(res.message);
        loadReports(term, year);
    } else {
        alert("Error: " + res.error);
    }
};

window.loadReports = async function(term, year) {
    if (!term) term = document.getElementById('dos-term').value;
    if (!year) year = document.getElementById('dos-year').value;
    
    if (!term || !year) return;
    
    const reports = await apiGet(`/reports?term=${term}&year=${year}`);
    const tbody = document.querySelector('#dos-reports-table tbody');
    tbody.innerHTML = '';
    
    if (reports.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">No reports found</td></tr>';
        return;
    }
    
    reports.forEach(r => {
        const tr = document.createElement('tr');
        const signature = r.signed_by_dos ? '<span style="color:green"><i class="fa-solid fa-check"></i> Signed</span>' : '<span style="color:red">Pending</span>';
        const signBtn = r.signed_by_dos ? '' : `<button class="sm-btn primary" onclick="signReport(${r.id})">Sign</button>`;
        
        tr.innerHTML = `
            <td>${r.first_name || ''} ${r.last_name || r.student_id}</td>
            <td>${r.term} ${r.year}</td>
            <td>${r.total_score}</td>
            <td>${r.average_score}</td>
            <td>${r.position}</td>
            <td>${signature}</td>
            <td>${signBtn} <button class="sm-btn secondary" onclick="downloadReport(${r.id})"><i class="fa-solid fa-download"></i></button></td>
        `;
        tbody.appendChild(tr);
    });
};

window.signReport = async function(report_id) {
    const dos_id = localStorage.getItem('jomish_user_id') || 1;
    const res = await apiPost('/reports/sign', { report_id, dos_id });
    if (res.success) {
        alert("Report signed!");
        loadReports();
    } else {
        alert("Error: " + res.error);
    }
};

window.downloadReport = function(report_id) {
    // Generate simple PDF or open in new tab (Placeholder)
    alert("Downloading report #" + report_id + "... (Feature relies on jsPDF)");
};

window.loadAllMarks = async function() {
    const marks = await apiGet('/marks');
    const tbody = document.querySelector('#dos-marks-table tbody');
    tbody.innerHTML = '';
    
    if (marks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">No marks found</td></tr>';
        return;
    }
    
    marks.forEach(m => {
        const tr = document.createElement('tr');
        const photoLink = m.exam_photo_base64 ? `<a href="${m.exam_photo_base64}" target="_blank" style="color:var(--primary); text-decoration:none;"><i class="fa-solid fa-image"></i> View</a>` : '-';
        tr.innerHTML = `
            <td>${m.student_id}</td>
            <td>${m.subject_name || m.subject_id}</td>
            <td>${m.term}</td>
            <td>${m.year}</td>
            <td>${m.score}</td>
            <td>${m.grade}</td>
            <td>${photoLink}</td>
        `;
        tbody.appendChild(tr);
    });
};

window.loadTeacherNotes = async function() {
    const notes = await apiGet('/notes');
    const list = document.getElementById('dos-notes-list');
    list.innerHTML = '';
    
    if (notes.length === 0) {
        list.innerHTML = '<p style="color:#94A3B8; text-align:center;">No notes from teachers.</p>';
        return;
    }
    
    notes.forEach(n => {
        const d = document.createElement('div');
        d.style.cssText = "padding:15px; border:1px solid var(--border); border-radius:8px; background:var(--background);";
        d.innerHTML = `
            <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:5px;">
                <strong>Student:</strong> ${n.first_name || 'ID'} ${n.last_name || n.student_id} 
                | <strong>Teacher ID:</strong> ${n.teacher_id} 
                | <strong>Date:</strong> ${new Date(n.created_at).toLocaleString()}
            </div>
            <div>${n.note_text}</div>
        `;
        list.appendChild(d);
    });
};

// ==========================================
// Accounts Hub Functions
// ==========================================

window.saveTermFees = async function() {
    const term = document.getElementById('acc-setup-term').value;
    const year = document.getElementById('acc-setup-year').value;
    const amount = document.getElementById('acc-setup-amount').value;

    if (!term || !year || !amount) return alert("Fill all fields");

    const res = await apiPost('/term-fees', { term, year, amount });
    if (res.success) {
        alert("Term fees configured successfully!");
    } else {
        alert("Error: " + res.error);
    }
};

window.parsedSchoolPayData = [];

window.previewSchoolPayData = function() {
    const rawData = document.getElementById('acc-paste-area').value.trim();
    if (!rawData) return alert("Paste some data first");

    // Very simple TSV/CSV parser assuming "Student ID" and "Amount" are in the columns
    const rows = rawData.split('\n');
    const parsed = [];
    
    rows.forEach(row => {
        // Split by tab or comma
        const cols = row.split(/\t|,/);
        // Look for something that looks like an amount (number) and a student ID
        let amount = null;
        let student_id = null;

        cols.forEach(c => {
            c = c.trim();
            // If it's purely numeric and large, likely amount
            if (/^\d{4,8}$/.test(c)) amount = c;
            // If it looks like ID (e.g. 1, JOM001)
            else if (c.length > 0) student_id = student_id || c; // first non-amount is ID fallback
        });

        if (amount && student_id) {
            parsed.push({ student_id, amount: parseFloat(amount), date: new Date().toISOString() });
        }
    });

    window.parsedSchoolPayData = parsed;
    document.getElementById('acc-preview-results').innerHTML = `
        <span style="color:var(--success)"><i class="fa-solid fa-check-circle"></i> Detected ${parsed.length} valid payment records.</span>
        <br><br>
        <div style="max-height:150px; overflow-y:auto; border:1px solid var(--border); padding:10px;">
            ${parsed.map(p => `ID: ${p.student_id} | Amount: ${p.amount}`).join('<br>')}
        </div>
    `;
};

window.importSchoolPayData = async function() {
    if (!window.parsedSchoolPayData || window.parsedSchoolPayData.length === 0) {
        return alert("Please preview valid data first");
    }
    const term = document.getElementById('acc-imp-term').value;
    const year = document.getElementById('acc-imp-year').value;
    if (!term || !year) return alert("Term and Year are required");

    const recorded_by = localStorage.getItem('jomish_user_id') || 1;

    const res = await apiPost('/payments/bulk-import', { 
        payments: window.parsedSchoolPayData, term, year, recorded_by 
    });

    if (res.success) {
        alert(`Successfully imported ${res.inserted} payments!`);
        document.getElementById('acc-paste-area').value = '';
        document.getElementById('acc-preview-results').innerHTML = '';
        window.parsedSchoolPayData = [];
    } else {
        alert("Error: " + res.error);
    }
};

window.fetchFeeReports = async function() {
    const term = document.getElementById('acc-rep-term').value;
    const year = document.getElementById('acc-rep-year').value;
    const filter = document.getElementById('acc-rep-filter').value;
    
    if (!term || !year) return alert("Enter term and year");
    
    const reports = await apiGet(`/payments/reports?term=${term}&year=${year}&filter=${filter}`);
    const tbody = document.querySelector('#acc-reports-table tbody');
    tbody.innerHTML = '';
    
    if (reports.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">No students found for this criteria</td></tr>';
        return;
    }
    
    reports.forEach(r => {
        const tr = document.createElement('tr');
        
        let statusBadge = '';
        if (r.percentage >= 100) statusBadge = '<span style="color:var(--success); font-weight:bold;">100% PAID</span>';
        else if (r.percentage === 0) statusBadge = '<span style="color:var(--danger); font-weight:bold;">UNPAID</span>';
        else statusBadge = `<span style="color:#F59E0B; font-weight:bold;">${r.percentage.toFixed(1)}% PAID</span>`;

        tr.innerHTML = `
            <td>${r.student_id}</td>
            <td>${r.first_name || ''} ${r.last_name || ''}</td>
            <td>${r.expected.toLocaleString()}</td>
            <td>${r.total_paid.toLocaleString()}</td>
            <td style="color:${r.balance > 0 ? 'var(--danger)' : 'var(--success)'}">${r.balance.toLocaleString()}</td>
            <td>${statusBadge}</td>
        `;
        tbody.appendChild(tr);
    });
};
