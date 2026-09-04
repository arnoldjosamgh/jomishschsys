const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');

let client;
let isReady = false;
let currentQr = null;

function initWhatsApp(io) {
    client = new Client({
        authStrategy: new LocalAuth({ dataPath: './whatsapp-session' }),
        puppeteer: { 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            headless: true
        }
    });

    client.on('qr', async (qr) => {
        currentQr = qr;
        isReady = false;
        try {
            const qrDataUrl = await qrcode.toDataURL(qr);
            io.emit('whatsapp_qr', qrDataUrl);
        } catch (err) {
            console.error('Error generating QR code data URL', err);
        }
    });

    client.on('ready', () => {
        console.log('WhatsApp Client is ready!');
        isReady = true;
        currentQr = null;
        io.emit('whatsapp_ready');
    });

    client.on('message', async msg => {
        io.emit('whatsapp_message', {
            from: msg.from,
            body: msg.body,
            timestamp: msg.timestamp
        });
    });

    client.on('disconnected', (reason) => {
        console.log('WhatsApp disconnected:', reason);
        isReady = false;
        currentQr = null;
        io.emit('whatsapp_disconnected');
    });

    client.initialize().catch(err => {
        console.error('Failed to initialize WhatsApp client', err);
    });
}

function getWhatsAppStatus() {
    return {
        ready: isReady,
        qr: currentQr
    };
}

async function sendWhatsAppMessage(to, message) {
    if (!isReady || !client) {
        throw new Error('WhatsApp client is not ready');
    }
    // ensure 'to' has @c.us suffix
    const chatId = to.includes('@c.us') ? to : `${to}@c.us`;
    await client.sendMessage(chatId, message);
}

async function getWhatsAppQR() {
    if (!currentQr) return null;
    try {
        const qrDataUrl = await qrcode.toDataURL(currentQr);
        return qrDataUrl;
    } catch (err) {
        console.error('Error generating QR data URL', err);
        return null;
    }
}

module.exports = { initWhatsApp, getWhatsAppStatus, getWhatsAppQR, sendWhatsAppMessage };
