/**
 * forkDoc.ts — Wave 2 Phase 3 Week 6 Track Z6.
 *
 * Document-level fork operation. The "workhorse" of branching.
 *
 * Forking a Y.Doc is just "snapshot + re-hydrate":
 *
 *     const update = Y.encodeStateAsUpdate(source);
 *     const next = new Y.Doc();
 *     Y.applyUpdate(next, update);
 *
 * The new doc starts at the source's exact state, but its history is a
 * new struct-store (no shared clientID, no shared origin). Subsequent
 * mutations on either doc are completely independent: a write on the
 * source never propagates to the fork, and vice versa — exactly the
 * branching semantic we want.
 *
 * **Cost** — O(state size). For a 1k-entity sketch the update payload is
 * single-digit-KB; the apply is a few ms. Real-world fork latency is
 * dominated by network (transferring the snapshot to the new branch's
 * collab session), not by the fork operation itself.
 *
 * **Hash determinism** — `computeForkSnapshotHash` produces a stable
 * 32-char hex digest of the doc state. Used by the registry to record
 * "this branch was forked from this exact state". Two peers with the
 * same converged state produce the same hash. We prefer SubtleCrypto's
 * SHA-256 in the browser, falling back to a deterministic JSON-based
 * hash in node test runs where SubtleCrypto isn't always wired.
 *
 * **What's NOT in this file** — branch metadata, name validation, the
 * registry. This file is pure Y.Doc plumbing; the `BranchStore` adapter
 * wraps it with the policy layer.
 */

import * as Y from 'yjs';

// ─── Fork ──────────────────────────────────────────────────────────────────

/** Create a new Y.Doc that starts at the same logical state as `sourceDoc`,
 *  with a fresh struct-store (independent history). Subsequent mutations
 *  on either doc don't propagate.
 *
 *  `newDocId` is informational only — Y.Doc doesn't carry an id of its
 *  own; we attach it as a guid so callers can verify which doc is which
 *  (Y.Doc has an optional `guid` field). The host's storage layer is
 *  responsible for routing per-doc state to per-doc storage. */
export function forkDoc(sourceDoc: Y.Doc, newDocId: string): Y.Doc {
  if (!newDocId) {
    throw new Error('[forkDoc] newDocId must be a non-empty string');
  }
  const update = Y.encodeStateAsUpdate(sourceDoc);
  const next = new Y.Doc({ guid: newDocId });
  Y.applyUpdate(next, update, ORIGIN_FORK);
  return next;
}

/** Origin tag attached to the apply-update on a fresh fork. Useful for
 *  observers that want to skip "this update came from the initial
 *  hydration" events. */
export const ORIGIN_FORK = 'fork';

// ─── Snapshot hash ─────────────────────────────────────────────────────────

/** Compute a stable hash of the doc's encoded state. Used by the registry
 *  to record the fork point. Two peers with the same converged state
 *  produce the same hash.
 *
 *  Uses SHA-256 via SubtleCrypto when available; falls back to a
 *  deterministic FNV-1a-based hash for node test environments without
 *  SubtleCrypto. The fallback is NOT cryptographic — it's an audit
 *  fingerprint, not a security primitive. */
export async function computeForkSnapshotHash(doc: Y.Doc): Promise<string> {
  const update = Y.encodeStateAsUpdate(doc);
  return hashBytes(update);
}

/** Sync variant — returns the FNV-1a-based fallback hash without ever
 *  invoking SubtleCrypto. Useful in synchronous code paths (tests,
 *  reducer-like flows). The output is a 16-char hex digest — collision
 *  resistance is fine for an audit fingerprint at workspace scale. */
export function computeForkSnapshotHashSync(doc: Y.Doc): string {
  const update = Y.encodeStateAsUpdate(doc);
  return fnv1aHex(update);
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  // Prefer SubtleCrypto (browser, Node 19+). Falls back to FNV when absent
  // or when the runtime rejects the digest call (some sandboxed contexts).
  const subtle = (typeof globalThis !== 'undefined' &&
    typeof globalThis.crypto !== 'undefined')
    ? globalThis.crypto.subtle
    : undefined;
  if (subtle && typeof subtle.digest === 'function') {
    try {
      // Copy the typed array into a fresh ArrayBuffer to satisfy strict
      // BufferSource typing on some TS lib versions (Node's typed-array
      // backing buffers are SharedArrayBuffer-incompatible).
      const ab = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(ab).set(bytes);
      const digest = await subtle.digest('SHA-256', ab);
      return bytesToHex(new Uint8Array(digest));
    } catch {
      /* fall through to FNV */
    }
  }
  return fnv1aHex(bytes);
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

/** Deterministic 64-bit FNV-1a hash (two 32-bit halves concatenated). The
 *  output is a 16-char hex digest. Stable across runs; no entropy. */
function fnv1aHex(bytes: Uint8Array): string {
  // Two 32-bit FNV-1a streams seeded differently so collisions in one
  // half are unlikely to collide in the other. This is plenty of
  // collision resistance for an audit fingerprint (workspace-scale —
  // hundreds of branches, not billions).
  const FNV_OFFSET_A = 0x811c9dc5;
  const FNV_OFFSET_B = 0xcbf29ce4;
  const FNV_PRIME = 0x01000193;
  let a = FNV_OFFSET_A >>> 0;
  let b = FNV_OFFSET_B >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i]!;
    a = Math.imul(a ^ v, FNV_PRIME) >>> 0;
    b = Math.imul(b ^ (v + 1), FNV_PRIME) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
