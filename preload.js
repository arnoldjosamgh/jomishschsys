const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    openExternal: (url) => ipcRenderer.send('open-external', url),
    forceFocus: () => ipcRenderer.send('force-focus'),
    printRawLocal: (text, printerName) => ipcRenderer.invoke('print-raw-local', text, printerName),
    printNetworkLocal: (text, printerIp, printerPort) => ipcRenderer.invoke('print-network-local', text, printerIp, printerPort),
    printSilent: (html, deviceName) => ipcRenderer.invoke('print-silent', html, deviceName),
    printToPdf: (html) => ipcRenderer.invoke('print-to-pdf', html),
    getPrinters: () => ipcRenderer.invoke('get-printers'),
    openMinutesEditor: (eventId) => ipcRenderer.send('open-minutes-editor', eventId),
    showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body })
});
