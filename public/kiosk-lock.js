/* ============================================================
   Jomish Kiosk Lock — Safe version for Electron
   
   NOTE: requestFullscreen() is intentionally REMOVED.
   When running inside Electron, calling requestFullscreen()
   repeatedly causes the browser to drop keyboard focus from
   active text inputs, breaking typing system-wide.
   
   Electron already manages fullscreen/maximize at the OS level
   via mainWindow.maximize() in electron-main.js. The HTML5
   Fullscreen API is not needed and causes input failures.
   ============================================================ */

(function () {
    // Only block F11 to prevent accidental exits — no requestFullscreen calls.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F11') {
            e.preventDefault();
        }
    });
})();
