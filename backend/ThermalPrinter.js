/**
 * ThermalPrinter.js
 *
 * High-level receipt builder using @point-of-sale/receipt-printer-encoder.
 * Inspired by the Syntax YouTube video "Receipt Printer with JavaScript".
 *
 * Supports two output modes:
 *   1. buildBuffer(lines) → returns a Buffer of raw ESC/POS bytes (for TCP / LPT / USB)
 *   2. buildNetworkPrint(lines, ip, port) → opens TCP socket and sends directly to printer
 *
 * Receipt "lines" format — each line is an object:
 *   { type: 'text', text: '...', align: 'left'|'center'|'right', bold: bool, size: 'small'|'normal'|'large' }
 *   { type: 'rule' }          → prints a dashed rule line
 *   { type: 'newline' }       → blank line
 *   { type: 'cut' }           → paper cut
 *   { type: 'qrcode', value } → QR code
 *   { type: 'table', columns } → two-column key/value row
 */

'use strict';

const net = require('net');

// Gracefully load the encoder — it's an ES module wrapped for CJS
let ReceiptPrinterEncoder;
try {
    ReceiptPrinterEncoder = require('@point-of-sale/receipt-printer-encoder').default
        || require('@point-of-sale/receipt-printer-encoder').ReceiptPrinterEncoder
        || require('@point-of-sale/receipt-printer-encoder');
} catch (e) {
    console.warn('[ThermalPrinter] @point-of-sale/receipt-printer-encoder not found, using fallback ESC/POS builder.');
    ReceiptPrinterEncoder = null;
}

// ── Fallback: simple hand-rolled ESC/POS buffer builder ─────────────────────
// Used when the npm library is not installed (e.g. inside the pkg .exe).
function buildFallbackBuffer(lines) {
    const parts = [];
    const ESC = 0x1B;
    const GS = 0x1D;

    const cmd = (...bytes) => parts.push(Buffer.from(bytes));
    const txt = (t) => parts.push(Buffer.from(t + '\n', 'binary'));

    cmd(ESC, 0x40); // init

    for (const line of lines) {
        switch (line.type) {
            case 'text': {
                const align = line.align === 'center' ? 1 : line.align === 'right' ? 2 : 0;
                cmd(ESC, 0x61, align);
                if (line.bold) cmd(ESC, 0x45, 1);
                if (line.size === 'large') cmd(GS, 0x21, 0x11);
                else if (line.size === 'small') cmd(GS, 0x21, 0x00);
                txt(line.text || '');
                if (line.bold) cmd(ESC, 0x45, 0);
                if (line.size === 'large' || line.size === 'small') cmd(GS, 0x21, 0x00);
                break;
            }
            case 'rule':
                cmd(ESC, 0x61, 0);
                txt('--------------------------------');
                break;
            case 'newline':
                txt('');
                break;
            case 'table': {
                cmd(ESC, 0x61, 0);
                const key = String(line.key || '');
                const val = String(line.value || '');
                const pad = Math.max(1, 32 - key.length - val.length);
                txt(key + ' '.repeat(pad) + val);
                break;
            }
            case 'cut':
                cmd(ESC, 0x64, 4); // feed 4 lines
                cmd(GS, 0x56, 0x42, 0x14); // partial cut
                break;
        }
    }

    return Buffer.concat(parts);
}

// ── Primary: build buffer using the encoder library ──────────────────────────
function buildBuffer(lines) {
    if (!ReceiptPrinterEncoder) {
        return buildFallbackBuffer(lines);
    }

    try {
        const encoder = new ReceiptPrinterEncoder();
        let enc = encoder.initialize();

        for (const line of lines) {
            switch (line.type) {
                case 'text': {
                    const size = line.size === 'large' ? { width: 2, height: 2 } : { width: 1, height: 1 };
                    enc = enc.align(line.align || 'left');
                    if (line.bold) enc = enc.bold(true);
                    enc = enc.size(size.width, size.height);
                    enc = enc.line(line.text || '');
                    if (line.bold) enc = enc.bold(false);
                    enc = enc.size(1, 1);
                    break;
                }
                case 'rule':
                    enc = enc.align('left').line('--------------------------------');
                    break;
                case 'newline':
                    enc = enc.newline();
                    break;
                case 'table':
                    enc = enc.align('left');
                    const key = String(line.key || '');
                    const val = String(line.value || '');
                    const pad = Math.max(1, 32 - key.length - val.length);
                    enc = enc.line(key + ' '.repeat(pad) + val);
                    break;
                case 'cut':
                    enc = enc.newline().newline().newline().newline().cut('partial');
                    break;
                case 'qrcode':
                    enc = enc.align('center').qrcode(line.value, 1, 8, 'h');
                    break;
            }
        }

        const result = enc.encode();
        return Buffer.from(result.buffer || result);
    } catch (err) {
        console.warn('[ThermalPrinter] Encoder failed, using fallback:', err.message);
        return buildFallbackBuffer(lines);
    }
}

// ── Build a structured lines array from a plain-text receipt string ──────────
function receiptTextToLines(text) {
    const lines = [];
    for (const rawLine of text.split('\n')) {
        const t = rawLine.trimEnd();
        if (!t) {
            lines.push({ type: 'newline' });
        } else if (t.startsWith('---') || t.startsWith('===')) {
            lines.push({ type: 'rule' });
        } else {
            lines.push({ type: 'text', text: t, align: 'left' });
        }
    }
    lines.push({ type: 'cut' });
    return lines;
}

// ── Build a fully structured receipt from POS data ───────────────────────────
function buildReceiptLines(data) {
    const lines = [];

    if (data.brand) lines.push({ type: 'text', text: data.brand, align: 'center', bold: true, size: 'large' });
    if (data.address) lines.push({ type: 'text', text: data.address, align: 'center' });
    if (data.contact) lines.push({ type: 'text', text: data.contact, align: 'center' });

    lines.push({ type: 'newline' });
    lines.push({ type: 'rule' });

    if (data.receiptNo) lines.push({ type: 'text', text: data.receiptNo, align: 'left' });
    if (data.date) lines.push({ type: 'text', text: data.date, align: 'left' });
    if (data.cashier) lines.push({ type: 'text', text: data.cashier, align: 'left' });

    lines.push({ type: 'rule' });
    lines.push({ type: 'text', text: 'QTY  ITEM                  TOTAL', align: 'left' });
    lines.push({ type: 'rule' });

    if (Array.isArray(data.items)) {
        for (const item of data.items) {
            const key = String(item.description || '');
            const val = String(item.total || '');
            lines.push({ type: 'table', key, value: val });
        }
    }

    lines.push({ type: 'rule' });

    if (data.subtotal) lines.push({ type: 'table', key: 'Subtotal:', value: data.subtotal });
    if (data.tax) lines.push({ type: 'table', key: 'Tax:', value: data.tax });
    if (data.total) lines.push({ type: 'table', key: 'TOTAL:', value: data.total });
    lines.push({ type: 'newline' });
    if (data.method) lines.push({ type: 'table', key: 'Payment:', value: data.method });
    if (data.paid) lines.push({ type: 'table', key: 'Amount Paid:', value: data.paid });
    if (data.change) lines.push({ type: 'table', key: 'Change:', value: data.change });
    if (data.balance) lines.push({ type: 'table', key: 'Balance:', value: data.balance });

    if (data.buyer) lines.push({ type: 'table', key: 'Buyer:', value: data.buyer });

    if (data.deliveryClient) {
        lines.push({ type: 'rule' });
        lines.push({ type: 'text', text: 'DELIVERY DETAILS:', align: 'left', bold: true });
        lines.push({ type: 'table', key: 'Client:', value: data.deliveryClient });
        if (data.deliveryLoc) lines.push({ type: 'table', key: 'Location:', value: data.deliveryLoc });
    }

    lines.push({ type: 'rule' });
    lines.push({ type: 'text', text: 'Thank you for your business!', align: 'center' });
    lines.push({ type: 'newline' });
    lines.push({ type: 'cut' });

    return lines;
}

// ── TCP Network Print: opens socket to printer IP:port and sends raw bytes ───
function printViaNetwork(buffer, ip, port = 9100, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        let done = false;

        const finish = (err) => {
            if (done) return;
            done = true;
            socket.destroy();
            if (err) reject(err);
            else resolve();
        };

        socket.setTimeout(timeoutMs);
        socket.on('timeout', () => finish(new Error(`TCP connection to ${ip}:${port} timed out after ${timeoutMs}ms`)));
        socket.on('error', (err) => finish(err));
        socket.on('close', () => finish());

        socket.connect(port, ip, () => {
            socket.write(buffer, (err) => {
                if (err) return finish(err);
                // Give the printer a moment to receive all data before closing
                setTimeout(() => socket.end(), 3000);
            });
        });
    });
}

module.exports = {
    buildBuffer,
    buildReceiptLines,
    receiptTextToLines,
    printViaNetwork,
};
