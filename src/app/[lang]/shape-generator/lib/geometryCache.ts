'use client';

/**
 * IndexedDB-backed cache for computed BufferGeometry blobs.
 *
 * Key: arbitrary string (typically a hash of { shapeId, params, features }).
 * Value: serialized geometry (positions/normals/index as typed-array bytes).
 *
 * Entries older than `TTL_MS` are lazily evicted on read. LRU eviction trims
 * the DB to `MAX_ENTRIES` when the limit is crossed.
 */

import * as THREE from 'three';

const DB_NAME = 'nexyfab-geom-cache';
const DB_VERSION = 1;
const STORE = 'geometries';
const TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const MAX_ENTRIES = 200;

export interface CachedEntry {
  key: string;
  positions: ArrayBuffer;       // Float32
  normals?: ArrayBuffer;        // Float32
  uvs?: ArrayBuffer;            // Float32
  index?: ArrayBuffer;          // Uint32
  triCount: number;
  createdAt: number;
  lastUsed: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB not available'));
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('lastUsed', 'lastUsed');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function toBuffer(attr: THREE.BufferAttribute | undefined): ArrayBuffer | undefined {
  if (!attr) return undefined;
  const arr = attr.array as Float32Array | Uint32Array | Uint16Array;
  // Copy so the backing buffer matches the attribute's view window.
  const copy = new Uint8Array(arr.byteLength);
  copy.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
  return copy.buffer;
}

export async function cacheGet(key: string): Promise<THREE.BufferGeometry | null> {
  try {
    const db = await openDB();
    return await new Promise<THREE.BufferGeometry | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        const entry = req.result as CachedEntry | undefined;
        if (!entry) return resolve(null);
        if (Date.now() - entry.createdAt > TTL_MS) {
          store.delete(key);
          return resolve(null);
        }
        // Touch lastUsed for LRU
        entry.lastUsed = Date.now();
        store.put(entry);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(entry.positions), 3));
        if (entry.normals) {
          geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(entry.normals), 3));
        } else {
          geo.computeVertexNormals();
        }
        if (entry.uvs) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(entry.uvs), 2));
        if (entry.index) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(entry.index), 1));
        resolve(geo);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function cachePut(key: string, geo: THREE.BufferGeometry): Promise<boolean> {
  try {
    const db = await openDB();
    const positions = toBuffer(geo.getAttribute('position') as THREE.BufferAttribute);
    if (!positions) return false;
    const normals = toBuffer(geo.getAttribute('normal') as THREE.BufferAttribute | undefined);
    const uvs = toBuffer(geo.getAttribute('uv') as THREE.BufferAttribute | undefined);
    const idx = geo.getIndex();
    const index = idx ? toBuffer(idx) : undefined;
    const triCount = idx ? Math.floor(idx.count / 3) : Math.floor((geo.getAttribute('position') as THREE.BufferAttribute).count / 3);

    const entry: CachedEntry = {
      key, positions, normals, uvs, index, triCount,
      createdAt: Date.now(), lastUsed: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // Fire-and-forget LRU trim
    void trimLRU(db);
    return true;
  } catch {
    return false;
  }
}

async function trimLRU(db: IDBDatabase): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const countReq = store.count();
    countReq.onsuccess = () => {
      const count = countReq.result;
      if (count <= MAX_ENTRIES) return resolve();
      const toRemove = count - MAX_ENTRIES;
      const cursorReq = store.index('lastUsed').openCursor();
      let removed = 0;
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || removed >= toRemove) return resolve();
        cursor.delete();
        removed++;
        cursor.continue();
      };
      cursorReq.onerror = () => resolve();
    };
    countReq.onerror = () => resolve();
  });
}

export async function cacheClear(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* ignore */ }
}

export async function cacheStats(): Promise<{ count: number; approxBytes: number }> {
  try {
    const db = await openDB();
    return await new Promise<{ count: number; approxBytes: number }>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      let count = 0;
      let bytes = 0;
      store.openCursor().onsuccess = (ev) => {
        const cursor = (ev.target as IDBRequest<IDBCursorWithValue>).result;
        if (!cursor) return resolve({ count, approxBytes: bytes });
        const entry = cursor.value as CachedEntry;
        count++;
        bytes += entry.positions.byteLength + (entry.normals?.byteLength ?? 0)
          + (entry.uvs?.byteLength ?? 0) + (entry.index?.byteLength ?? 0);
        cursor.continue();
      };
    });
  } catch {
    return { count: 0, approxBytes: 0 };
  }
}

/** Stable hash for a cache key from shapeId + params + (optional) features. */
export function hashKey(shapeId: string, params: Record<string, number>, extra?: unknown): string {
  const entries = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  const payload = JSON.stringify({ shapeId, params: entries, extra });
  let h = 5381;
  for (let i = 0; i < payload.length; i++) {
    h = ((h << 5) + h) ^ payload.charCodeAt(i);
  }
  return `v1-${shapeId}-${(h >>> 0).toString(36)}-${payload.length}`;
}
