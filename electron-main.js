const { app, BrowserWindow, ipcMain, shell, session, globalShortcut, clipboard, dialog, Notification } = require('electron');
const path = require('path');

// Fix for Google Meet / WebRTC black screen issues in Electron
app.commandLine.appendSwitch('enable-webgl');
app.commandLine.appendSwitch('enable-webrtc-pipewire-capturer');
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('disable-http-cache');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        autoHideMenuBar: true,
        webPreferences: {
            webviewTag: true,
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.maximize();

    const chromeUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    app.userAgentFallback = chromeUserAgent;

    // Apply permissions and headers to EVERY session (including webview partitions)
    const configureSession = (sess) => {
        sess.setPermissionRequestHandler((webContents, permission, callback) => {
            const allowed = ['media', 'camera', 'microphone', 'display-capture', 'audioCapture', 'videoCapture', 'geolocation', 'notifications'];
            callback(allowed.includes(permission));
        });

        sess.setPermissionCheckHandler((webContents, permission) => {
            const allowed = ['media', 'camera', 'microphone', 'display-capture', 'audioCapture', 'videoCapture', 'geolocation', 'notifications'];
            return allowed.includes(permission);
        });

        sess.webRequest.onBeforeSendHeaders((details, callback) => {
            // Force no-cache for ALL requests
            details.requestHeaders['Cache-Control'] = 'no-cache, no-store, must-revalidate';
            details.requestHeaders['Pragma'] = 'no-cache';
            
            // Globally spoof Chrome user-agent for all requests to bypass Electron blocks
            details.requestHeaders['User-Agent'] = chromeUserAgent;
            callback({ requestHeaders: details.requestHeaders });
        });
    };

    // Configure the default session and any future partitioned sessions
    configureSession(session.defaultSession);
    app.on('session-created', configureSession);


    // Wait for the local server to start before loading
    // Poll every 500ms up to 30 seconds — shows loading title while waiting
    mainWindow.setTitle('Jomish Suite — Starting server...');

    async function waitForServer(url, maxAttempts = 60, intervalMs = 500) {
        for (let i = 0; i < maxAttempts; i++) {
            try {
                await new Promise((resolve, reject) => {
                    const http = require('http');
                    const req = http.get(url, (res) => { resolve(res); });
                    req.on('error', reject);
                    req.setTimeout(400, () => { req.destroy(); reject(new Error('timeout')); });
                });
                return true; // server is up
            } catch (e) {
                await new Promise(r => setTimeout(r, intervalMs));
            }
        }
        return false; // timed out
    }

    waitForServer('http://localhost:3005/api/discover').then((ready) => {
        if (!ready) {
            console.error('[Electron] Server did not start in time — loading anyway');
        }
        // Check if a login token already exists in the session's localStorage.
        // If so, load the main app directly to skip the login page.
        mainWindow.loadURL('http://localhost:3005/login.html').then(() => {
            mainWindow.webContents.executeJavaScript(`localStorage.getItem('jomish_token')`)
                .then(token => {
                    if (token) {
                        console.log('[Electron] Saved session found — loading main app directly.');
                        mainWindow.loadURL('http://localhost:3005/index.html');
                    }
                })
                .catch(() => {});
        });
        mainWindow.setTitle('Jomish Business Suite');
    });

    // F12 opens DevTools for debugging
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12' && input.type === 'keyDown') {
            mainWindow.webContents.toggleDevTools();
        }
    });

    // Open external links (e.g. Google Maps) in the system browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://localhost') || url.startsWith('file://')) {
            return { action: 'allow' };
        }
        shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

// IPC: renderer asks to open a URL externally
ipcMain.on('open-external', (event, url) => {
    shell.openExternal(url);
});

// IPC: force focus back to the main window from a webview
ipcMain.on('force-focus', () => {
    if (mainWindow) {
        mainWindow.webContents.focus();
    }
});

const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const { buildBuffer, receiptTextToLines, printViaNetwork } = require('./backend/ThermalPrinter');

// IPC: Direct Raw Print (For Parallel Adapters / LPT1)
// Uses the receipt-printer-encoder library to build proper ESC/POS bytes.
ipcMain.handle('print-raw-local', async (event, text, printerName) => {
    return new Promise((resolve) => {
        try {
            // Build proper ESC/POS binary buffer using the encoder library
            const lines = receiptTextToLines(text);
            const printBuffer = buildBuffer(lines);

            const tempFile = path.join(os.tmpdir(), `jomish_receipt_${Date.now()}.bin`);
            fs.writeFileSync(tempFile, printBuffer);

            let printCmd;
            if (os.platform() === 'win32') {
                if (printerName && printerName !== 'LPT1' && printerName.trim() !== '') {
                    const scriptPath = path.join(__dirname, 'scripts', 'raw_print.ps1');
                    printCmd = `powershell -ExecutionPolicy Bypass -File "${scriptPath}" "${tempFile}" "${printerName}"`;
                } else {
                    // Standard hardware parallel port fallback
                    printCmd = `cmd.exe /c copy /B "${tempFile}" LPT1`;
                }
            } else {
                const usbPrinter = '/dev/usb/lp0';
                printCmd = `cat "${tempFile}" > ${usbPrinter}`;
            }

            exec(printCmd, (error) => {
                setTimeout(() => { try { fs.unlinkSync(tempFile); } catch(e){} }, 2000);
                if (error) {
                    resolve({ success: false, error: error.message });
                } else {
                    resolve({ success: true });
                }
            });
        } catch (err) {
            resolve({ success: false, error: err.message });
        }
    });
});

// IPC: TCP Network Print — sends ESC/POS bytes directly to printer IP:port
// This is the approach from the Syntax "Receipt Printer with JavaScript" video.
ipcMain.handle('print-network-local', async (event, text, printerIp, printerPort) => {
    try {
        const lines = receiptTextToLines(text);
        const buffer = buildBuffer(lines);
        await printViaNetwork(buffer, printerIp, Number(printerPort) || 9100);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});


// IPC: Silent HTML Print (For standard installed system printers)
// Automatically falls back to PDF export when NO_LOCAL_PRINTER is encountered
ipcMain.handle('print-silent', async (event, htmlContent, deviceName) => {
    return new Promise(async (resolve) => {
        // Pre-check: if no deviceName given, verify at least one printer exists
        if (!deviceName) {
            try {
                const printers = await mainWindow.webContents.getPrintersAsync();
                if (!printers || printers.length === 0) {
                    console.warn('[Print] No printers found — falling back to PDF export');
                    return resolve({ success: false, error: 'NO_LOCAL_PRINTER', fallback: 'pdf' });
                }
            } catch (e) {
                console.warn('[Print] Could not enumerate printers:', e.message);
            }
        }

        let printWin = new BrowserWindow({ 
            show: false,
            webPreferences: { nodeIntegration: false, contextIsolation: true }
        });
        
        printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
        
        printWin.webContents.on('did-finish-load', () => {
            const printOptions = { silent: true, printBackground: true };
            if (deviceName) {
                printOptions.deviceName = deviceName;
            }
            printWin.webContents.print(printOptions, (success, failureReason) => {
                if (!success) {
                    console.error('[Print] Silent print failed:', failureReason);
                    // Signal the renderer to fall back to PDF if no printer available
                    const isPrinterError = failureReason === 'NO_LOCAL_PRINTER' || 
                                          failureReason === 'failed' ||
                                          (failureReason && failureReason.includes('printer'));
                    resolve({
                        success: false,
                        error: failureReason,
                        fallback: isPrinterError ? 'pdf' : null
                    });
                } else {
                    resolve({ success: true });
                }
                setTimeout(() => { if (printWin) { printWin.close(); printWin = null; } }, 1000);
            });
        });

        printWin.on('closed', () => { printWin = null; });
    });
});

// IPC: Print to PDF — used as fallback when no printer is available
ipcMain.handle('print-to-pdf', async (event, htmlContent) => {
    return new Promise((resolve) => {
        let pdfWin = new BrowserWindow({
            show: false,
            webPreferences: { nodeIntegration: false, contextIsolation: true }
        });

        pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

        pdfWin.webContents.on('did-finish-load', async () => {
            try {
                const pdfBuffer = await pdfWin.webContents.printToPDF({
                    printBackground: true,
                    pageSize: 'A4'
                });

                const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
                    title: 'Save Receipt as PDF',
                    defaultPath: `receipt_${Date.now()}.pdf`,
                    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
                });

                if (canceled || !filePath) {
                    resolve({ success: false, error: 'User cancelled PDF save' });
                } else {
                    fs.writeFileSync(filePath, pdfBuffer);
                    console.log('[Print] PDF saved to:', filePath);
                    shell.openPath(filePath); // Open PDF after saving
                    resolve({ success: true, filePath });
                }
            } catch (err) {
                console.error('[Print] PDF generation failed:', err.message);
                resolve({ success: false, error: err.message });
            } finally {
                if (pdfWin) { pdfWin.close(); pdfWin = null; }
            }
        });

        pdfWin.on('closed', () => { pdfWin = null; });
    });
});

ipcMain.handle('get-printers', async () => {
    try {
        if (mainWindow) {
            return await mainWindow.webContents.getPrintersAsync();
        }
        return [];
    } catch (e) {
        return [];
    }
});

// IPC: open standalone minutes editor
let minutesWindow = null;
ipcMain.on('open-minutes-editor', (event, eventId) => {
    if (minutesWindow) {
        minutesWindow.focus();
        return;
    }

    minutesWindow = new BrowserWindow({
        width: 450,
        height: 600,
        alwaysOnTop: true,
        autoHideMenuBar: true,
        title: 'Meeting Minutes',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    minutesWindow.loadURL(`http://localhost:3005/minutes.html?eventId=${eventId}`);

    minutesWindow.on('closed', () => {
        minutesWindow = null;
    });
});

// Google Meet popup handler (intercepts webview popups for authentication)
app.on('web-contents-created', (event, contents) => {
    if (contents.getType() === 'webview') {
        contents.setWindowOpenHandler(({ url }) => {
            if (url.includes('accounts.google.com') || url.includes('meet.google.com')) {
                return { action: 'allow' };
            }
            shell.openExternal(url);
            return { action: 'deny' };
        });
    }
});

app.on('ready', () => {
    // Clear only HTTP cache. Do NOT clear service workers — they hold push subscriptions
    // and must persist between restarts for Web Push to work.
    session.defaultSession.clearCache()
        .catch(() => {})
        .finally(() => {
            createWindow();
        });

    ipcMain.on('show-notification', (event, { title, body }) => {
        if (Notification.isSupported()) {
            new Notification({
                title: title || 'Jomish Suite',
                body: body || 'You have a new notification',
                icon: path.join(__dirname, 'public/favicon.png')
            }).show();
        }
    });
});

app.on('ready', () => {
    // Register Auto-Typer global shortcut natively via Electron
    globalShortcut.register('F8', () => {
        console.log('F8 pressed: Triggering Native Auto-Typer');
        const text = clipboard.readText();
        if (!text) return;
        
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (!focusedWindow) return;
        
        let i = 0;
        function typeNext() {
            if (i >= text.length) return;
            const char = text[i];
            
            if (char === '\t') {
                // Type 4 spaces instead of tab
                focusedWindow.webContents.sendInputEvent({ type: 'char', keyCode: ' ' });
                focusedWindow.webContents.sendInputEvent({ type: 'char', keyCode: ' ' });
                focusedWindow.webContents.sendInputEvent({ type: 'char', keyCode: ' ' });
                focusedWindow.webContents.sendInputEvent({ type: 'char', keyCode: ' ' });
            } else if (char === '\n') {
                focusedWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
                focusedWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
            } else if (char !== '\r') {
                focusedWindow.webContents.sendInputEvent({ type: 'char', keyCode: char });
            }
            
            i++;
            setTimeout(typeNext, 20); // 20ms human delay
        }
        typeNext();
    });
});


app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
