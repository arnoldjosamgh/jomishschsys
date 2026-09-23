new_js = """
// =============================================
// TECH: Emergency DOS/Admin Password Reset
// =============================================
async function techResetDosPassword() {
  const prefix = (document.getElementById('reset-school-prefix')?.value || '').trim().toUpperCase();
  const username = (document.getElementById('reset-dos-username')?.value || '').trim();
  const newPass = (document.getElementById('reset-dos-newpass')?.value || '').trim();
  const resultEl = document.getElementById('dos-reset-result');
  const btn = document.getElementById('btn-tech-reset-dos');

  if (!prefix || !username || !newPass) {
    resultEl.style.display = 'block';
    resultEl.style.background = 'rgba(239,68,68,0.1)';
    resultEl.style.border = '1px solid #EF4444';
    resultEl.style.color = '#EF4444';
    resultEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Please fill in all fields.';
    return;
  }
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Resetting...';
  try {
    const res = await fetchAuth(`${API_URL}/system/reset-dos-password`, {
      method: 'POST',
      body: JSON.stringify({ school_prefix: prefix, username, new_password: newPass })
    });
    const data = await res.json();
    resultEl.style.display = 'block';
    if (res.ok) {
      resultEl.style.background = 'rgba(16,185,129,0.1)';
      resultEl.style.border = '1px solid #10B981';
      resultEl.style.color = '#10B981';
      resultEl.innerHTML = `<i class="fa-solid fa-check-circle"></i> ${data.message}`;
      document.getElementById('reset-dos-username').value = '';
      document.getElementById('reset-dos-newpass').value = '';
    } else {
      resultEl.style.background = 'rgba(239,68,68,0.1)';
      resultEl.style.border = '1px solid #EF4444';
      resultEl.style.color = '#EF4444';
      resultEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${data.error}`;
    }
  } catch(e) {
    resultEl.style.display = 'block';
    resultEl.style.color = '#EF4444';
    resultEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-lock-open"></i> Reset';
  }
}

// =============================================
// TECH: Provision / Reset Demo School Tenant
// =============================================
async function provisionDemoSchool() {
  const btn = document.getElementById('btn-provision-demo');
  const credsDiv = document.getElementById('demo-school-creds');
  const credsBody = document.getElementById('demo-creds-body');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Provisioning Demo School...';
  credsDiv.style.display = 'none';

  try {
    const res = await fetchAuth(`${API_URL}/system/provision-demo-school`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Provision failed');

    const { credentials } = data;
    const rows = [
      { role: 'Admin', username: credentials.admin.username, password: credentials.admin.password },
      { role: 'DOS', username: credentials.dos.username, password: credentials.dos.password },
      ...credentials.teachers.map((t, i) => ({ role: `Teacher ${i+1}`, username: t.username, password: t.password }))
    ];
    credsBody.innerHTML = rows.map(r => `
      <tr>
        <td style="padding:6px 10px; border-bottom:1px solid var(--border); font-weight:bold;">${r.role}</td>
        <td style="padding:6px 10px; border-bottom:1px solid var(--border); font-family:monospace; color:#4F46E5;">${r.username}</td>
        <td style="padding:6px 10px; border-bottom:1px solid var(--border); font-family:monospace;">${r.password}</td>
      </tr>
    `).join('');
    credsDiv.style.display = 'block';
    showToast('Demo school provisioned successfully!', 'success');
  } catch(e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rocket"></i> Provision / Reset Demo School';
  }
}

"""

marker = '// =============================================\n// TECH SUPPORT ACCOUNTS MANAGEMENT (Tech Hub)\n// =============================================\n'

with open('public/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

if marker in content:
    content = content.replace(marker, new_js + marker, 1)
    with open('public/app.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Patched app.js OK')
else:
    print('MARKER NOT FOUND in app.js')
