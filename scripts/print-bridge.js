'use strict';
const http = require('http');
const { exec } = require('child_process');
const os = require('os');
const fss = require('fs');
const path = require('path');
const PORT = 9988;
function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function getScriptPath() {
    const a = path.join(__dirname, 'raw_print.ps1');
    const b = path.join(__dirname, '..', 'scripts', 'raw_print.ps1');
    if (fss.existsSync(a)) return a;
    if (fss.existsSync(b)) return b;
    return null;
}
function printBuffer(bytes, printerName, callback) {
    const tempFile = path.join(os.tmpdir(), 'jomish_' + Date.now() + '.bin');
    fss.writeFileSync(tempFile, bytes);
    const scriptPath = getScriptPath();
    let cmd = scriptPath && printerName
        ? 'powershell -ExecutionPolicy Bypass -File "' + scriptPath + '" "' + tempFile + '" "' + printerName + '"'
        : 'cmd.exe /c copy /B "' + tempFile + '" LPT1';
    console.log('[Bridge] Printing to: ' + (printerName || 'LPT1'));
    exec(cmd, { timeout: 15000 }, (err) => {
        try { fss.unlinkSync(tempFile); } catch (e) {}
        if (err) { console.error('[Bridge] Error:', err.message); callback(err); }
        else { console.log('[Bridge] Printed OK!'); callback(null); }
    });
}
const server = http.createServer((req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
    if (req.url === '/status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', version: '1.0', bridge: 'Jomish Print Bridge' }));
        return;
    }
    if (req.url === '/printers' && req.method === 'GET') {
        exec('powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"', (err, stdout) => {
            if (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); return; }
            const printers = stdout.split('\n').map(s => s.trim()).filter(Boolean);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ printers }));
        });
        return;
    }
    if (req.url === '/print' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { rawEscPos, printerName } = JSON.parse(body);
                if (!rawEscPos) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'rawEscPos required' })); return; }
                const bytes = Buffer.from(rawEscPos, 'base64');
                printBuffer(bytes, printerName, (err) => {
                    if (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
                    else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true })); }
                });
            } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
        });
        return;
    }
    res.writeHead(404); res.end();
});
server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log('========================================');
    console.log('  Jomish Print Bridge v1.0 - RUNNING   ');
    console.log('  http://localhost:' + PORT);
    console.log('  Keep this window OPEN while using');
    console.log('  Jomish Business Suite.');
    console.log('========================================');
    console.log('');
});
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') { console.error('[ERROR] Port ' + PORT + ' already in use.'); }
    else { console.error('[ERROR]', err.message); }
    process.exit(1);
});
