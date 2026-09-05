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

