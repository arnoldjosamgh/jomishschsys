// ============================================================
// Jomish Business Suite — Service Worker
// Handles: Offline caching + Push Notifications
// ============================================================

const CACHE_NAME = 'jomish-v39';
const STATIC_ASSETS = [
    '/login.html',
    '/index.html',
    '/offline-db.js',
    '/manifest.json',
    '/favicon.png',
    '/app.js',
    '/style.css',
    '/kiosk-lock.js',
    '/lib/socket.io.js',
    '/lib/jspdf.umd.min.js',
    '/lib/jspdf.plugin.autotable.min.js',
    '/lib/qrious.min.js',
    '/lib/JsBarcode.all.min.js',
    '/lib/thermal-serial.js',
    '/lib/html5-qrcode.min.js',
    '/lib/qr-code-styling.js'
];

// ─── INSTALL: Pre-cache core assets ──────────────────────────
self.addEventListener('install', (event) => {
    console.log('[SW] Installing and pre-caching assets...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch((err) => {
                console.warn('[SW] Pre-cache partial failure (ok):', err.message);
            });
        })
    );
    self.skipWaiting();
});

// ─── ACTIVATE: Clean up old caches ───────────────────────────
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        })
    );
    self.clients.claim();
});

// ─── FETCH: Network-first with cache fallback ─────────────────
self.addEventListener('fetch', (event) => {
    // Only handle GET requests
    if (event.request.method !== 'GET') return;
    
    const url = new URL(event.request.url);
    
    // Skip API calls
    if (url.pathname.startsWith('/api/')) return;
    
    // Skip external URLs EXCEPT our required UI CDNs
    const allowedOrigins = [
        self.location.origin,
        'https://fonts.googleapis.com',
        'https://fonts.gstatic.com',
        'https://cdnjs.cloudflare.com'
    ];
    if (!allowedOrigins.includes(url.origin)) return;

    // Never cache sw.js itself to ensure updates can be fetched
    if (url.pathname.endsWith('/sw.js')) {
        event.respondWith(fetch(event.request, { cache: 'no-store' }));
        return;
    }

    event.respondWith(
        // Network-first approach: Always try to get the latest file
        fetch(event.request)
            .then((response) => {
                // If we get a valid response, clone it and put it in the cache
                if (response && response.status === 200) {
                    const cloned = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
                }
                return response;
            })
            .catch(() => {
                // Offline fallback: serve from cache if available
                return caches.match(event.request).then((cached) => {
                    if (cached) return cached;
                    // If it's a navigation request and we're offline without it, fallback to login
                    if (event.request.mode === 'navigate') {
                        return caches.match('/login.html');
                    }
                });
            })
    );
});

// ═══ BACKGROUND SYNC: Offline Sales Queue ═══════════════════════════════════
// Fired by the browser when network is restored after a sync.register() call.
// We message all open clients to trigger syncOfflineSales() in app.js.
// This covers the scenario where the user had the app open but in the background.
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-offline-sales') {
        console.log('[SW] Background Sync triggered: sync-offline-sales');
        event.waitUntil(
            clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
                if (clientList.length > 0) {
                    // Tell each open client to run its sync function
                    clientList.forEach(client => {
                        client.postMessage({ type: 'TRIGGER_SYNC' });
                    });
                }
                // If no client is open, the user will sync manually next time they open the app
            })
        );
    }
});
// ─── PUSH: Receive push notifications from server ─────────────
self.addEventListener('push', (event) => {
    let data = {
        title: 'Jomish Business Suite',
        body: 'You have a new notification.',
        icon: '/favicon.png',
        badge: '/favicon.png',
        tag: 'jomish-notification',
        type: 'general',
        url: '/',
        requireInteraction: false
    };

    try {
        if (event.data) data = { ...data, ...event.data.json() };
    } catch (e) {}

    console.log('[SW] Push received:', data);

    // Build action buttons based on notification type
    const actions = [];
    if (data.type === 'delivery') {
        actions.push({ action: 'view_transport', title: '🚗 View Job' });
        actions.push({ action: 'dismiss', title: 'Dismiss' });
    } else if (data.type === 'meeting') {
        actions.push({ action: 'view_calendar', title: '📅 View Meeting' });
        actions.push({ action: 'dismiss', title: 'Dismiss' });
    } else if (data.type === 'message') {
        actions.push({ action: 'view_messages', title: '✉️ Open Message' });
        actions.push({ action: 'dismiss', title: 'Dismiss' });
    } else if (data.type === 'notice') {
        actions.push({ action: 'view_notices', title: '📢 View Notice' });
        actions.push({ action: 'dismiss', title: 'Dismiss' });
    }

    const options = {
        body: data.body,
        icon: data.icon || '/favicon.png',
        badge: data.badge || '/favicon.png',
        tag: data.tag || 'jomish-notification',
        requireInteraction: data.requireInteraction !== undefined ? data.requireInteraction : true,
        data: { url: data.url || '/', type: data.type || 'general' },
        vibrate: [200, 100, 200, 100, 200],
        actions: actions
    };

    event.waitUntil(self.registration.showNotification(data.title, options));
});

// ─── NOTIFICATION CLICK: Open correct tab or focus app ────────
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const notifData = event.notification.data || {};
    const notifType = notifData.type || 'general';
    const action = event.action;

    // Map action/type to URL hash
    let targetUrl = '/';
    if (action === 'dismiss') return;

    if (action === 'view_transport' || notifType === 'delivery') {
        targetUrl = '/#transport';
    } else if (action === 'view_calendar' || notifType === 'meeting') {
        targetUrl = '/#secretary';
    } else if (action === 'view_messages' || notifType === 'message') {
        targetUrl = '/#messages';
    } else if (action === 'view_notices' || notifType === 'notice') {
        targetUrl = '/#notices';
    } else if (notifData.url && notifData.url !== '/') {
        targetUrl = notifData.url;
    }

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // Find an already-open Jomish window and navigate it
            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    client.postMessage({ type: 'NAVIGATE_TO', url: targetUrl, notifType });
                    return client.focus();
                }
            }
            // Otherwise open a new window
            if (clients.openWindow) {
                return clients.openWindow(self.location.origin + targetUrl);
            }
        })
    );
});
