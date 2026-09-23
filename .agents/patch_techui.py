new_panels = """
                    <!-- ====== DOS / Admin Password Reset ====== -->
                    <div class="scheduler-section" id="tech-dos-reset-container" style="margin-bottom: 30px;">
                        <header>
                            <h2><i class="fa-solid fa-key"></i> Emergency Password Reset</h2>
                            <p style="font-size: 0.85rem; color: #94A3B8;">Reset any school user password (DOS, Admin, Teacher) when a security breach is reported. Runs directly on the tenant schema.</p>
                        </header>
                        <div style="margin-top: 16px; display: flex; flex-direction: column; gap: 14px;">
                            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 10px; align-items: end;">
                                <div>
                                    <label style="display:block; font-size:0.8rem; font-weight:bold; margin-bottom:5px;">School Prefix</label>
                                    <input type="text" id="reset-school-prefix" placeholder="e.g. TSCH" style="width:100%; padding:10px; border-radius:6px; border:1px solid var(--border); background:var(--background); color:var(--text); text-transform:uppercase; font-weight:bold; letter-spacing:2px;">
                                </div>
                                <div>
                                    <label style="display:block; font-size:0.8rem; font-weight:bold; margin-bottom:5px;">Username (Login ID)</label>
                                    <input type="text" id="reset-dos-username" placeholder="e.g. TSCH002" style="width:100%; padding:10px; border-radius:6px; border:1px solid var(--border); background:var(--background); color:var(--text);">
                                </div>
                                <div>
                                    <label style="display:block; font-size:0.8rem; font-weight:bold; margin-bottom:5px;">New Password</label>
                                    <input type="password" id="reset-dos-newpass" placeholder="New secure password" style="width:100%; padding:10px; border-radius:6px; border:1px solid var(--border); background:var(--background); color:var(--text);">
                                </div>
                                <button class="primary-btn" onclick="techResetDosPassword()" id="btn-tech-reset-dos" style="background:#EF4444; border:none; white-space:nowrap; padding:10px 18px;">
                                    <i class="fa-solid fa-lock-open"></i> Reset
                                </button>
                            </div>
                            <div id="dos-reset-result" style="display:none; padding:12px; border-radius:8px; font-size:0.85rem;"></div>
                        </div>
                    </div>

                    <!-- ====== Demo School for Testing ====== -->
                    <div class="scheduler-section" id="tech-demo-school-container" style="margin-bottom: 30px; border: 1px dashed #4F46E5;">
                        <header>
                            <h2><i class="fa-solid fa-flask"></i> Demo School (Testing Environment)</h2>
                            <p style="font-size: 0.85rem; color: #94A3B8;">Provision a fully loaded <strong>DEMO</strong> school tenant for testing all features. Re-provision anytime to reset demo data.</p>
                        </header>
                        <div style="margin-top: 16px;">
                            <div id="demo-school-creds" style="display:none; background:rgba(79,70,229,0.08); border:1px solid #4F46E5; border-radius:8px; padding:16px; margin-bottom:16px;">
                                <p style="font-size:0.85rem; font-weight:bold; margin-bottom:10px; color:#4F46E5;"><i class="fa-solid fa-circle-check"></i> Demo school provisioned! Credentials:</p>
                                <table style="width:100%; font-size:0.82rem; border-collapse:collapse;">
                                    <thead><tr>
                                        <th style="text-align:left; padding:6px 10px; border-bottom:1px solid var(--border);">Role</th>
                                        <th style="text-align:left; padding:6px 10px; border-bottom:1px solid var(--border);">Username</th>
                                        <th style="text-align:left; padding:6px 10px; border-bottom:1px solid var(--border);">Password</th>
                                    </tr></thead>
                                    <tbody id="demo-creds-body"></tbody>
                                </table>
                                <p style="font-size:0.75rem; color:#94A3B8; margin-top:10px;"><i class="fa-solid fa-circle-info"></i> Log in from the login page with any of these credentials to test each role.</p>
                            </div>
                            <button class="primary-btn" onclick="provisionDemoSchool()" id="btn-provision-demo" style="background:#4F46E5; border:none; width:100%; padding:12px;">
                                <i class="fa-solid fa-rocket"></i> Provision / Reset Demo School
                            </button>
                        </div>
                    </div>

"""

with open('public/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

marker = '                    <!-- Global Role Permission Matrix -->'
if marker in content:
    content = content.replace(marker, new_panels + marker, 1)
    with open('public/index.html', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Patched OK')
else:
    print('MARKER NOT FOUND')
