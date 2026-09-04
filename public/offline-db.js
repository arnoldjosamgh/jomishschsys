// ============================================================
// Jomish Business Suite — Offline Database Engine (IndexedDB)
// Handles: Offline sales queue with UUID-based idempotency
// ============================================================

const DB_NAME    = 'JomishOfflineDB';
const DB_VERSION = 3;          // bumped to add mutationsQueue store
const STORE_SALES      = 'salesQueue';       // offline POS sales queue
const STORE_CACHE      = 'api_cache';        // legacy API cache (retained)
const STORE_MUTATIONS  = 'mutationsQueue';   // offline generic mutations (transport, etc.)

let _dbPromise = null;

// ── DB Initialisation ────────────────────────────────────────────────────────
function getDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Legacy api_cache store — keep if it exists
            if (!db.objectStoreNames.contains(STORE_CACHE)) {
                db.createObjectStore(STORE_CACHE, { keyPath: 'url' });
            }

            // Offline sales queue — keyed by client_uuid for targeted eviction
            if (!db.objectStoreNames.contains(STORE_SALES)) {
                const store = db.createObjectStore(STORE_SALES, { keyPath: 'client_uuid' });
                store.createIndex('queued_at', 'queued_at', { unique: false });
            }

            // Generic offline mutations queue (POST/PATCH/DELETE for transport, etc.)
            if (!db.objectStoreNames.contains(STORE_MUTATIONS)) {
                const mStore = db.createObjectStore(STORE_MUTATIONS, { keyPath: 'id', autoIncrement: true });
                mStore.createIndex('queued_at', 'queued_at', { unique: false });
            }
        };

        req.onsuccess  = (e) => resolve(e.target.result);
        req.onerror    = (e) => reject(e.target.error);
    });
    return _dbPromise;
}

// ── initOfflineDB ─────────────────────────────────────────────────────────────
// Call once on app startup. Also requests Persistent Storage to protect the DB
// from browser eviction under low-disk conditions.
async function initOfflineDB() {
    await getDB(); // triggers onupgradeneeded / opens the DB
    if (navigator.storage && navigator.storage.persist) {
        const granted = await navigator.storage.persist();
        console.log('[OfflineDB] Persistent storage granted:', granted);
    }
    console.log('[OfflineDB] IndexedDB initialised:', DB_NAME, 'v' + DB_VERSION);
}

// ── queueOfflineSale ──────────────────────────────────────────────────────────
// Saves a sale to IndexedDB. client_uuid is the key — safe to call multiple
// times with the same uuid (put() will overwrite, keeping the queue clean).
async function queueOfflineSale(client_uuid, payload) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx    = db.transaction(STORE_SALES, 'readwrite');
            const store = tx.objectStore(STORE_SALES);
            store.put({ client_uuid, payload, queued_at: Date.now() });
            tx.oncomplete = () => {
                console.log('[OfflineDB] Sale queued:', client_uuid);
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.error('[OfflineDB] Failed to queue sale:', e);
    }
}

// ── getPendingOfflineSales ────────────────────────────────────────────────────
// Returns all queued sales, oldest first.
async function getPendingOfflineSales() {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx    = db.transaction(STORE_SALES, 'readonly');
            const store = tx.objectStore(STORE_SALES);
            const req   = store.index('queued_at').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror   = () => reject(req.error);
        });
    } catch (e) {
        console.error('[OfflineDB] Failed to get pending sales:', e);
        return [];
    }
}

// ── removeSyncedSales ─────────────────────────────────────────────────────────
// Targeted eviction: deletes ONLY the UUIDs the server confirmed. Any sale
// the server didn't acknowledge stays in the queue for the next sync attempt.
async function removeSyncedSales(uuids = []) {
    if (!uuids.length) return;
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx    = db.transaction(STORE_SALES, 'readwrite');
            const store = tx.objectStore(STORE_SALES);
            uuids.forEach(uuid => store.delete(uuid));
            tx.oncomplete = () => {
                console.log('[OfflineDB] Evicted confirmed sales:', uuids);
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.error('[OfflineDB] Failed to evict sales:', e);
    }
}

// ── getPendingCount ───────────────────────────────────────────────────────────
// Utility for the UI badge — returns how many sales are waiting to sync.
async function getPendingCount() {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const tx    = db.transaction(STORE_SALES, 'readonly');
            const store = tx.objectStore(STORE_SALES);
            const req   = store.count();
            req.onsuccess = () => resolve(req.result);
            req.onerror   = () => resolve(0);
        });
    } catch { return 0; }
}

// ── queueMutation ────────────────────────────────────────────────────────────
// Saves a generic API mutation (POST/PATCH/DELETE) for offline replay.
async function queueMutation(method, url, headers, body) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx    = db.transaction(STORE_MUTATIONS, 'readwrite');
            const store = tx.objectStore(STORE_MUTATIONS);
            store.add({ method, url, headers, body, queued_at: Date.now() });
            tx.oncomplete = () => {
                console.log('[OfflineDB] Mutation queued:', method, url);
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.error('[OfflineDB] Failed to queue mutation:', e);
    }
}

// ── getQueuedMutations ────────────────────────────────────────────────────────
// Returns all queued mutations, oldest first.
async function getQueuedMutations() {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx    = db.transaction(STORE_MUTATIONS, 'readonly');
            const store = tx.objectStore(STORE_MUTATIONS);
            const req   = store.index('queued_at').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror   = () => reject(req.error);
        });
    } catch (e) {
        console.error('[OfflineDB] Failed to get queued mutations:', e);
        return [];
    }
}

// ── removeQueuedMutation ──────────────────────────────────────────────────────
// Removes a single mutation by its auto-increment id after successful sync.
async function removeQueuedMutation(id) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx    = db.transaction(STORE_MUTATIONS, 'readwrite');
            const store = tx.objectStore(STORE_MUTATIONS);
            store.delete(id);
            tx.oncomplete = () => {
                console.log('[OfflineDB] Mutation removed:', id);
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.error('[OfflineDB] Failed to remove mutation:', e);
    }
}

// ── Legacy API cache methods (kept for backwards compatibility) ───────────────
async function cacheApiResponse(url, data) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx    = db.transaction(STORE_CACHE, 'readwrite');
            const store = tx.objectStore(STORE_CACHE);
            store.put({ url, data, timestamp: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror    = () => reject(tx.error);
        });
    } catch (e) { console.warn('[OfflineDB] cacheApiResponse failed:', e); }
}

async function getCachedApiResponse(url) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx    = db.transaction(STORE_CACHE, 'readonly');
            const store = tx.objectStore(STORE_CACHE);
            const req   = store.get(url);
            req.onsuccess = () => resolve(req.result ? req.result.data : null);
            req.onerror   = () => reject(req.error);
        });
    } catch (e) { console.warn('[OfflineDB] getCachedApiResponse failed:', e); return null; }
}

// ── Global Exposure ───────────────────────────────────────────────────────────
window.OfflineDB = {
    initOfflineDB,
    queueOfflineSale,
    getPendingOfflineSales,
    removeSyncedSales,
    getPendingCount,
    // Generic mutations queue
    queueMutation,
    getQueuedMutations,
    removeQueuedMutation,
    // Legacy
    cacheApiResponse,
    getCachedApiResponse
};
