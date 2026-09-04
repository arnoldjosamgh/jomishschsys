/**
 * thermal-serial.js  —  WebSerial + ESC/POS for Jomish Business Suite
 * =====================================================================
 * Supports any 80mm ESC/POS thermal printer connected via USB-to-Serial
 * (virtual COM port) — including the TrackSol TIRP-80-WRU.
 *
 * Usage (all methods are async):
 *   await ThermalSerial.connect()          // opens browser port picker
 *   await ThermalSerial.disconnect()
 *   await ThermalSerial.printReceipt(data) // data = _currentReceiptData shape
 *   await ThermalSerial.testPrint()
 *   ThermalSerial.isConnected()            // → boolean
 *   ThermalSerial.getPortInfo()            // → "COM3" | "Unknown Port" | null
 *
 * ESC/POS command set used:
 *   ESC @         – Initialize printer
 *   ESC a n       – Align  (0=left, 1=center, 2=right)
 *   ESC E n       – Bold   (1=on, 0=off)
 *   GS ! n        – Character size multiplier
 *   LF            – Line feed
 *   ESC d n       – Feed n lines
 *   GS V 66 n     – Partial cut with n-line feed
 */

(function (global) {
    'use strict';

    // ── ESC/POS byte constants ──────────────────────────────────────────────
    const ESC = 0x1B;
    const GS  = 0x1D;
    const LF  = 0x0A;

    // ── LocalStorage keys ───────────────────────────────────────────────────
    const LS_BAUD = 'jomish_thermal_baud';

    // ── Module state ────────────────────────────────────────────────────────
    let _port       = null;   // SerialPort object
    let _writer     = null;   // WritableStreamDefaultWriter
    let _portLabel  = null;   // Human-readable label for the port

    // ── Low-level byte helpers ───────────────────────────────────────────────

    /** Concatenate multiple Uint8Array / number arrays into one Uint8Array. */
    function concat(...parts) {
        const all = [];
        for (const p of parts) {
            if (p instanceof Uint8Array) {
                for (const b of p) all.push(b);
            } else if (Array.isArray(p)) {
                for (const b of p) all.push(b);
            } else {
                all.push(p);
            }
        }
        return new Uint8Array(all);
    }

    function encodeText(str) {
        str = String(str); // Ensure it's a string
        const bytes = [];
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);
            bytes.push(c < 256 ? c : 0x3F); // '?' for unsupported chars
        }
        return new Uint8Array(bytes);
    }

    // ── ESC/POS command builders ─────────────────────────────────────────────

    const cmd = (...bytes) => new Uint8Array(bytes);

    const INIT        = cmd(ESC, 0x40);
    const ALIGN_LEFT  = cmd(ESC, 0x61, 0);
    const ALIGN_CTR   = cmd(ESC, 0x61, 1);
    const ALIGN_RIGHT = cmd(ESC, 0x61, 2);
    const BOLD_ON     = cmd(ESC, 0x45, 1);
    const BOLD_OFF    = cmd(ESC, 0x45, 0);
    const SIZE_NORMAL = cmd(GS,  0x21, 0x00);         // 1× width, 1× height
    const SIZE_DOUBLE = cmd(GS,  0x21, 0x11);         // 2× width, 2× height
    const SIZE_WIDE   = cmd(GS,  0x21, 0x10);         // 2× width, 1× height
    const SIZE_TALL   = cmd(GS,  0x21, 0x01);         // 1× width, 2× height

    function feedLines(n) { return cmd(ESC, 0x64, n); }

    /** Partial cut with feed. */
    function partialCut(feed = 4) {
        return concat(feedLines(feed), cmd(GS, 0x56, 0x42, feed));
    }

    /**
     * Build a line of text terminated by LF.
     * @param {string} text
     * @param {{ align?: 'left'|'center'|'right', bold?: boolean, size?: 'normal'|'double'|'wide'|'tall' }} opts
     */
    function textLine(text, opts = {}) {
        const parts = [];

        // Align
        if      (opts.align === 'center') parts.push(ALIGN_CTR);
        else if (opts.align === 'right')  parts.push(ALIGN_RIGHT);
        else                               parts.push(ALIGN_LEFT);

        // Bold
        if (opts.bold) parts.push(BOLD_ON);

        // Size
        if      (opts.size === 'double') parts.push(SIZE_DOUBLE);
        else if (opts.size === 'wide')   parts.push(SIZE_WIDE);
        else if (opts.size === 'tall')   parts.push(SIZE_TALL);
        else                              parts.push(SIZE_NORMAL);

        parts.push(encodeText(text));
        parts.push(new Uint8Array([LF]));

        // Reset
        if (opts.bold) parts.push(BOLD_OFF);
        parts.push(SIZE_NORMAL);
        parts.push(ALIGN_LEFT);

        return concat(...parts);
    }

    /** Dashed rule line (32 dashes for 80mm / ~42 char width). */
    function dashedRule() {
        return textLine('--------------------------------', { align: 'left' });
    }

    /** Solid rule (using equals signs to contrast with dashes). */
    function solidRule() {
        return textLine('================================', { align: 'left' });
    }

    /**
     * Two-column key/value row, right-aligned value.
     * Total printable columns ≈ 32 for 80mm at 12cpi.
     */
    function tableRow(key, value, totalCols = 32) {
        const k = String(key   || '');
        const v = String(value || '');
        const pad = Math.max(1, totalCols - k.length - v.length);
        return textLine(k + ' '.repeat(pad) + v);
    }

    /** Blank line. */
    function blankLine() {
        return new Uint8Array([LF]);
    }

    // ── High-level receipt encoder ───────────────────────────────────────────

    /**
     * Build a complete ESC/POS byte buffer from _currentReceiptData shape.
     *
     * Expected `data` shape:
     * {
     *   isInvoice, bizName, bizLoc, bizTel, taxRate,
     *   orderId, dateStr, cashierName,
     *   items: [{ name, qty, price }],
     *   sub, tax, total, paid, change, bal,
     *   paymentMethod, buyerName, deliveryInfo
     * }
     */
    function buildReceiptBuffer(data) {
        const parts = [];
        const fmtUGX = n => 'UGX ' + Math.round(n).toLocaleString();
        const heading = data.isInvoice ? 'INVOICE' : 'RECEIPT';

        // ── Init ─────────────────────────────────────────
        parts.push(INIT);

        // ── Business name ─────────────────────────────────
        parts.push(blankLine());
        parts.push(textLine(String(data.bizName || 'JOMISH BUSINESS').toUpperCase(),
            { align: 'center', bold: true, size: 'double' }));

        if (data.bizLoc) {
            parts.push(textLine(data.bizLoc, { align: 'center' }));
        }
        if (data.bizTel) {
            parts.push(textLine(data.bizTel, { align: 'center' }));
        }

        parts.push(blankLine());
        parts.push(dashedRule());

        // ── Receipt heading ───────────────────────────────
        parts.push(textLine(heading + ' #' + data.orderId,
            { align: 'center', bold: true }));
        parts.push(textLine('Date: ' + String(data.dateStr || '')));
        parts.push(textLine('Cashier: ' + String(data.cashierName || 'Cashier')));

        parts.push(dashedRule());

        // ── Column headers ────────────────────────────────
        parts.push(textLine('ITEM                      QTY  AMOUNT', { bold: true }));
        parts.push(dashedRule());

        // ── Items ─────────────────────────────────────────
        if (Array.isArray(data.items)) {
            for (const item of data.items) {
                const qty       = item.qty  || 1;
                const lineTotal = item.price * qty;
                const name      = String(item.name || '').substring(0, 22);
                const qtyStr    = String(qty).padStart(3);
                const totStr    = fmtUGX(lineTotal);
                // Format: name (22) + qty (4) + total (right-justified)
                const padded    = name.padEnd(22) + qtyStr + '  ';
                const remaining = 32 - padded.length;
                const totLine   = padded + totStr.substring(
                    Math.max(0, totStr.length - Math.max(0, remaining))
                );
                parts.push(textLine(totLine));
            }
        }

        parts.push(dashedRule());

        // ── Totals ────────────────────────────────────────
        if (data.taxRate > 0) {
            parts.push(tableRow('Subtotal:', fmtUGX(data.sub)));
            parts.push(tableRow('Tax (' + data.taxRate + '%):', fmtUGX(data.tax)));
        }

        parts.push(solidRule());
        parts.push(textLine(
            tableRow('TOTAL:', fmtUGX(data.total), 32), // pre-built string
        ));
        // Re-do as bold total row
        parts.push(ALIGN_LEFT);
        parts.push(BOLD_ON);
        parts.push(SIZE_WIDE);
        const totalKey = 'TOTAL:';
        const totalVal = fmtUGX(data.total);
        const totalPad = Math.max(1, 16 - totalKey.length - Math.floor(totalVal.length / 2));
        parts.push(encodeText(totalKey + ' '.repeat(totalPad) + totalVal));
        parts.push(new Uint8Array([LF]));
        parts.push(SIZE_NORMAL);
        parts.push(BOLD_OFF);
        parts.push(dashedRule());

        // ── Payment ───────────────────────────────────────
        parts.push(tableRow('Payment:', String(data.paymentMethod || 'CASH')));
        parts.push(tableRow('Paid:', fmtUGX(data.paid)));

        if (data.change > 0) {
            parts.push(tableRow('Change:', fmtUGX(data.change)));
        }
        if (data.bal > 0) {
            parts.push(tableRow('Balance Due:', fmtUGX(data.bal)));
        }
        if (data.buyerName) {
            parts.push(tableRow('Buyer:', String(data.buyerName)));
        }

        // ── Delivery ──────────────────────────────────────
        if (data.deliveryInfo) {
            parts.push(dashedRule());
            parts.push(textLine('** DELIVERY **', { align: 'center', bold: true }));
            if (typeof data.deliveryInfo === 'object') {
                const cli = [
                    data.deliveryInfo.clientName || '',
                    data.deliveryInfo.clientPhone ? '(' + data.deliveryInfo.clientPhone + ')' : ''
                ].filter(Boolean).join(' ');
                if (cli) parts.push(tableRow('Client:', cli));
                if (data.deliveryInfo.clientLocation) {
                    parts.push(tableRow('Location:', data.deliveryInfo.clientLocation));
                }
            } else {
                parts.push(textLine(String(data.deliveryInfo)));
            }
        }

        // ── Footer ────────────────────────────────────────
        parts.push(dashedRule());
        parts.push(blankLine());
        parts.push(textLine('Thank you for your business!', { align: 'center', bold: true }));
        parts.push(textLine('Powered by Jomish Business Suite', { align: 'center' }));
        parts.push(blankLine());

        // ── Cut ───────────────────────────────────────────
        parts.push(partialCut(4));

        return concat(...parts);
    }

    /** Build a simple test print banner. */
    function buildTestBuffer(bizName) {
        const parts = [];
        parts.push(INIT);
        parts.push(blankLine());
        parts.push(textLine('** PRINTER TEST **', { align: 'center', bold: true, size: 'wide' }));
        parts.push(blankLine());
        parts.push(textLine(String(bizName || 'JOMISH BUSINESS').toUpperCase(), { align: 'center', bold: true }));
        parts.push(blankLine());
        parts.push(dashedRule());
        parts.push(textLine('Jomish Business Suite', { align: 'center' }));
        parts.push(textLine('TrackSol TIRP-80-WRU', { align: 'center' }));
        parts.push(textLine('80mm ESC/POS Thermal', { align: 'center' }));
        parts.push(dashedRule());
        parts.push(blankLine());
        parts.push(textLine(new Date().toLocaleString('en-UG', { timeZone: 'Africa/Kampala' }), { align: 'center' }));
        parts.push(blankLine());
        parts.push(textLine('-- Print OK --', { align: 'center', bold: true }));
        parts.push(blankLine());
        parts.push(partialCut(4));
        return concat(...parts);
    }

    // ── Port status change callbacks ─────────────────────────────────────────
    const _listeners = [];

    function _notify() {
        _listeners.forEach(fn => { try { fn(ThermalSerial.isConnected(), _portLabel); } catch (_) {} });
    }

    // ── Public API ───────────────────────────────────────────────────────────

    const ThermalSerial = {

        /** True if a port is open and writer is ready. */
        isConnected() {
            return !!_port && !!_writer;
        },

        /** Returns a label string like "Connected" or null. */
        getPortInfo() {
            if (!this.isConnected()) return null;
            return _portLabel || 'USB Serial Port';
        },

        /**
         * Register a status-change callback: fn(connected: boolean, label: string|null)
         * Called whenever connection state changes.
         */
        onStatusChange(fn) {
            _listeners.push(fn);
        },

        /**
         * Open the browser's port picker and connect.
         * @param {number} [baudRate=9600]
         */
        async connect(baudRate) {
            if (!('serial' in navigator)) {
                throw new Error('Web Serial API is not supported in this browser. Please use Chrome or Edge.');
            }

            // Close any existing connection first
            if (_port) {
                await this.disconnect().catch(() => {});
            }

            const baud = baudRate
                || parseInt(localStorage.getItem(LS_BAUD) || '9600', 10)
                || 9600;

            // Show browser port picker
            const port = await navigator.serial.requestPort({});

            await port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });

            _port   = port;
            _writer = port.writable.getWriter();

            // Build a human-readable label from port info
            try {
                const info = port.getInfo();
                _portLabel = (info.usbVendorId || info.usbProductId)
                    ? `USB ${(info.usbVendorId || 0).toString(16).toUpperCase()}:${(info.usbProductId || 0).toString(16).toUpperCase()}`
                    : 'USB Serial Port';
            } catch (_) {
                _portLabel = 'USB Serial Port';
            }

            // Persist baud rate
            localStorage.setItem(LS_BAUD, String(baud));

            _notify();
        },

        /** Close the current port. */
        async disconnect() {
            if (_writer) {
                try { await _writer.close(); } catch (_) {}
                _writer = null;
            }
            if (_port) {
                try { await _port.close(); } catch (_) {}
                _port      = null;
                _portLabel = null;
            }
            _notify();
        },

        /**
         * Write raw bytes to the printer.
         * @param {Uint8Array} buffer
         */
        async write(buffer) {
            if (!this.isConnected()) throw new Error('Printer not connected.');
            await _writer.write(buffer);
        },

        /**
         * Print a receipt from _currentReceiptData shape.
         * @param {object} data — same shape as app.js `_currentReceiptData`
         */
        async printReceipt(data) {
            if (!data) throw new Error('No receipt data provided.');
            const buf = buildReceiptBuffer(data);
            await this.write(buf);
        },

        /** Send a short test banner to verify the connection. */
        async testPrint(bizName) {
            const buf = buildTestBuffer(bizName);
            await this.write(buf);
        },

        /**
         * Re-open the last used port automatically (no picker).
         * Call this on page load to auto-reconnect if the printer is still plugged in.
         * Silently fails if no previous port or port unavailable.
         */
        async autoReconnect() {
            if (!('serial' in navigator)) return;
            try {
                const ports = await navigator.serial.getPorts();
                if (ports.length === 0) return;
                const baud = parseInt(localStorage.getItem(LS_BAUD) || '9600', 10) || 9600;
                const port = ports[0];
                await port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
                _port   = port;
                _writer = port.writable.getWriter();
                _portLabel = 'USB Serial Port (auto)';
                _notify();
                console.info('[ThermalSerial] Auto-reconnected to printer.');
            } catch (e) {
                console.info('[ThermalSerial] Auto-reconnect skipped:', e.message);
            }
        },
    };

    // Expose globally
    global.ThermalSerial = ThermalSerial;

})(window);
