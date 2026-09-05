import re

def update_logic():
    with open('public/school_logic.js', 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 1. Update DOMContentLoaded to hide other tabs for Secretary
    sec_logic = """
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
"""
    content = content.replace("""    // Single-hub roles — users who only need one focused area
    const singleHubRoles = {
        'DOS':      { btn: dosBtn,     target: 'dos-hub',      label: 'DOS Hub' },
        'Teacher':  { btn: teacherBtn, target: 'teacher-hub',  label: 'Teacher Hub' },
        'Accounts': { btn: accBtn,     target: 'accounts-hub', label: 'Accounts Hub' },
    };""", sec_logic)


    # 2. Add switchSecretaryView update and loadClassTimetable
    timetable_logic = """
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

// View switchers"""

    content = content.replace("// View switchers", timetable_logic)

    # 3. Replace lines 105 to 232 using regex
    pattern = re.compile(r"// View switchers(.*?)// DOS Functions", re.DOTALL)
    
    with open('scratch_logic.js', 'r', encoding='utf-8') as f:
        scratch = f.read()

    new_content = pattern.sub(scratch + "\n// DOS Functions", content)

    with open('public/school_logic.js', 'w', encoding='utf-8') as f:
        f.write(new_content)

update_logic()
