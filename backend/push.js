const webpush = require('web-push');
const db = require('./database');
const { asyncLocalStorage } = require('./database');

const PUBLIC_VAPID_KEY = 'BDpy4RrJ8ch4fFlX6BeLYhXzFXhOvldEnzIsAvFW_vDqAloZ87zcLynHJvy9qrk6n17MJy8dpMhfAD-gAsZ4FbY';
const PRIVATE_VAPID_KEY = process.env.VAPID_PRIVATE_KEY || 'LDM5uJIa4znYcj4bTzDGWduXcmKcvhzGc9WmHcJcRfk';

// Configure Web Push
webpush.setVapidDetails(
    'mailto:support@jomish.com',
    PUBLIC_VAPID_KEY,
    PRIVATE_VAPID_KEY
);

// Helper: send a push to a subscription row, clean up on failure
async function trySend(sub, payload, schema) {
    try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
        return true;
    } catch (e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
            // Expired / invalid — remove silently
            asyncLocalStorage.run(schema, () => {
                db.run('DELETE FROM push_subscriptions WHERE subscription = ?', [JSON.stringify(sub)]);
            });
        } else {
            console.error('[PUSH] Send error:', e.message || e);
        }
        return false;
    }
}

// ── saveSubscription ──────────────────────────────────────────────────────────
// Upsert a subscription, tracking device_hint and refreshing last_used_at.
// device_hint is 'mobile' if the user agent contains Android/iPhone/iPad, else 'browser'.
async function saveSubscription(employeeId, subscription, schema, deviceHint = 'browser') {
    return new Promise((resolve) => {
        asyncLocalStorage.run(schema, () => {
            const subStr = typeof subscription === 'string' ? subscription : JSON.stringify(subscription);
            const endpoint = typeof subscription === 'string' ? JSON.parse(subscription).endpoint : subscription.endpoint;

            // Delete old rows for this exact endpoint to avoid duplicates across different users on the same device
            db.run(
                `DELETE FROM push_subscriptions WHERE subscription LIKE ?`,
                [`%${endpoint}%`],
                () => {
                    db.run(
                        `INSERT INTO push_subscriptions (employee_id, subscription, device_hint, last_used_at)
                         VALUES (?, ?, ?, datetime('now'))`,
                        [employeeId, subStr, deviceHint],
                        function(err) {
                            if (err) console.warn('[PUSH] Subscription save note:', err.message);
                            resolve();
                        }
                    );
                }
            );
        });
    });
}

// ── touchLastUsed ─────────────────────────────────────────────────────────────
// Called on every authenticated request from the frontend so we always know
// which device was most recently active.
async function touchLastUsed(employeeId, endpoint, schema) {
    asyncLocalStorage.run(schema, () => {
        db.run(
            `UPDATE push_subscriptions SET last_used_at = datetime('now')
             WHERE subscription LIKE ?`,
            [`%${endpoint}%`]
        );
    });
}

// Remove a subscription for a given employee + endpoint
async function removeSubscription(employeeId, endpoint, schema) {
    return new Promise((resolve) => {
        asyncLocalStorage.run(schema, () => {
            db.run(
                `DELETE FROM push_subscriptions WHERE subscription LIKE ?`,
                [`%${endpoint}%`],
                resolve
            );
        });
    });
}

// ── sendPushToEmployee ────────────────────────────────────────────────────────
// Send to the LAST USED device of a specific employee (by employee_id).
// Falls back to all devices if last_used_at is not available.
async function sendPushToEmployee(employeeId, payload, schema) {
    return new Promise((resolve) => {
        asyncLocalStorage.run(schema, () => {
            // Get all subscriptions for this employee
            db.all(
                `SELECT subscription FROM push_subscriptions
                 WHERE employee_id = ?`,
                [employeeId],
                async (err, rows) => {
                    if (err || !rows || rows.length === 0) return resolve(0);
                    let sentCount = 0;
                    for (const row of rows) {
                        try {
                            const sub = JSON.parse(row.subscription);
                            if (await trySend(sub, payload, schema)) sentCount++;
                        } catch (e) {
                            console.error('[PUSH] Parse error:', e.message);
                        }
                    }
                    resolve(sentCount);
                }
            );
        });
    });
}

// ── sendPushToRole ────────────────────────────────────────────────────────────
// Send to the LAST USED device for each employee who has the specified role.
// Each employee receives it only once, on their most recently active device.
async function sendPushToRole(role, payload, schema) {
    return new Promise((resolve) => {
        asyncLocalStorage.run(schema, () => {
            // For each active employee with this role, get all their subscriptions
            db.all(
                `SELECT p.subscription
                 FROM push_subscriptions p
                 JOIN employees e ON p.employee_id = e.id
                 WHERE e.role = ? AND e.is_active = 1`,
                [role],
                async (err, rows) => {
                    if (err || !rows) return resolve(0);
                    let sentCount = 0;
                    for (const row of rows) {
                        try {
                            const sub = JSON.parse(row.subscription);
                            if (await trySend(sub, payload, schema)) sentCount++;
                        } catch (e) {}
                    }
                    resolve(sentCount);
                }
            );
        });
    });
}

// ── sendPushToAll ─────────────────────────────────────────────────────────────
// Broadcast to all active employees — one notification per employee,
// sent to their most recently used device.
async function sendPushToAll(payload, schema) {
    return new Promise((resolve) => {
        asyncLocalStorage.run(schema, () => {
            db.all(
                `SELECT p.subscription
                 FROM push_subscriptions p
                 JOIN employees e ON p.employee_id = e.id
                 WHERE e.is_active = 1`,
                [],
                async (err, rows) => {
                    if (err || !rows) return resolve(0);
                    let sentCount = 0;
                    for (const row of rows) {
                        try {
                            const sub = JSON.parse(row.subscription);
                            if (await trySend(sub, payload, schema)) sentCount++;
                        } catch (e) {}
                    }
                    resolve(sentCount);
                }
            );
        });
    });
}

// ── sendPushToPermission ──────────────────────────────────────────────────────
// Send to all employees who have a specific UI permission (e.g. can_see_hr).
// Each employee receives it only once, on their most recently used device.
async function sendPushToPermission(permissionCol, payload, schema) {
    return new Promise((resolve) => {
        asyncLocalStorage.run(schema, () => {
            const validCols = ['can_see_dashboard', 'can_see_hr', 'can_see_attendance', 'can_see_sme', 'can_see_pos', 'can_see_secretary', 'can_see_transport', 'can_see_hardware', 'can_see_system_users', 'can_see_schedules'];
            if (!validCols.includes(permissionCol)) return resolve(0);

            db.all(
                `SELECT p.subscription
                 FROM push_subscriptions p
                 JOIN employees e ON p.employee_id = e.id
                 JOIN roles_config r ON e.role = r.role_name
                 WHERE e.is_active = 1 AND r.${permissionCol} = 1`,
                [],
                async (err, rows) => {
                    if (err || !rows) return resolve(0);
                    let sentCount = 0;
                    for (const row of rows) {
                        try {
                            const sub = JSON.parse(row.subscription);
                            if (await trySend(sub, payload, schema)) sentCount++;
                        } catch (e) {}
                    }
                    resolve(sentCount);
                }
            );
        });
    });
}

// ── sendPushToLastDeviceOfRole ────────────────────────────────────────────────
// Alias for sendPushToRole — explicitly named so it's clear what is happening.
const sendPushToLastDeviceOfRole = sendPushToRole;

// ── sendPushToLastDeviceOfEmployee ────────────────────────────────────────────
// Alias for sendPushToEmployee — sends only to the most recently used device.
const sendPushToLastDeviceOfEmployee = sendPushToEmployee;

module.exports = {
    PUBLIC_VAPID_KEY,
    saveSubscription,
    removeSubscription,
    touchLastUsed,
    sendPushToEmployee,
    sendPushToRole,
    sendPushToPermission,
    sendPushToAll,
    sendPushToLastDeviceOfRole,
    sendPushToLastDeviceOfEmployee
};
