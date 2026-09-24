with open('public/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Remove the DOS button
html = html.replace('<button class="nav-btn dos-invite-btn" id="btn-dos-invite" onclick="switchDOSView(\'invite\')"><i class="fa-solid fa-link"></i> Invite Link</button>', '')

# Change the dos-invite-view class so it shows up in tech hub normally
html = html.replace('<div id="dos-invite-view" class="dos-sub-view hidden">', '<div id="dos-invite-view" class="scheduler-section" style="margin-bottom: 30px;">')

# Save
with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print('UI Cleaned.')
