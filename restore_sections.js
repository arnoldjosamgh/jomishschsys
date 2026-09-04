const fs = require('fs');

// Read UTF-8 version (skip BOM if present)
let original = fs.readFileSync('scratch_original_index_utf8.html', 'utf8');
if (original.charCodeAt(0) === 0xFEFF) original = original.substring(1); // strip BOM

const current = fs.readFileSync('public/index.html', 'utf8');

const sectionsToRestore = ['dos-hub', 'teacher-hub', 'accounts-hub', 'secretary-hub', 'tech-hub'];

console.log('Original length:', original.length);
console.log('dos-hub found at:', original.indexOf('dos-hub'));

function extractSection(html, id) {
    const startIdx = html.indexOf(`id="${id}"`);
    if (startIdx === -1) { console.log(`id="${id}" NOT FOUND`); return null; }
    
    let tagStart = html.lastIndexOf('<section', startIdx);
    if (tagStart === -1) return null;
    
    let depth = 0;
    let i = tagStart;
    while (i < html.length) {
        if (html[i] === '<') {
            const sub = html.substring(i);
            if (/^<section[\s>]/i.test(sub)) {
                depth++;
                i++;
                continue;
            }
            if (/^<\/section/i.test(sub)) {
                depth--;
                if (depth === 0) {
                    const end = html.indexOf('>', i) + 1;
                    return html.substring(tagStart, end);
                }
            }
        }
        i++;
    }
    return null;
}

const mainEnd = current.lastIndexOf('</main>');
console.log(`Inserting at position ${mainEnd}`);

let restored = '';
for (const id of sectionsToRestore) {
    const section = extractSection(original, id);
    if (section) {
        // Remove POS/WhatsApp/Transport/HR/SME/Supervision internal references within restored sections
        restored += '\n' + section.replace(/\r\n/g, '\n') + '\n';
        console.log(`✅ Restored: ${id} (${section.length} chars)`);
    } else {
        console.log(`❌ Not found: ${id}`);
    }
}

const newHtml = current.substring(0, mainEnd) + restored + current.substring(mainEnd);
fs.writeFileSync('public/index.html', newHtml);
console.log('\nDone!');
