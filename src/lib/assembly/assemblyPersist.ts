/**
 * assemblyPersist — Phase 4 (NexyFab Pro own-CAD ADR-013).
 *
 * Serialises an `AssemblyState` to JSON for round-tripping to disk /
 * localStorage / cloud blob, and provides a thin React hook for
 * editor-state autosave.
 *
 * Wire format (v1):
 *   {
 *     "version": 1,
 *     "state": { "parts": [...], "mates": [...] }
 *   }
 *
 * Versioning rule: any future breaking IR change (renaming `position` →
 * `translation`, switching quaternion convention, etc.) bumps the
 * `version` field. `deserializeAssembly` rejects unknown versions instead
 * of silently coercing — older saves stay loadable only by an explicit
 * migration step (Phase 4.1+).
 *
 * Validation: deserialisation runs `validateAssembly` on the rehydrated
 * structure. A file that parses as JSON but fails IR rules (unknown part
 * ref in a mate, duplicate id, unfixed assembly) returns an error
 * envelope — never a partially valid state.
 *
 * The React hook (`useAssemblyStorage`) is best-effort: it transparently
 * no-ops when `localStorage` is unavailable (SSR, sandboxed iframe,
 * disabled cookies). Writes are debounced 500 ms to avoid hammering
 * storage during continuous mate edits / drags.
 *
 * Out of scope for Phase 4:
 *   - Multi-revision history (Phase 4.2 — undo/redo).
 *   - Cross-tab sync via `storage` events (Phase 4.2).
 *   - Binary/CBOR wire format (Phase 4.3 if size becomes a problem).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  validateAssembly,
  AssemblyValidationError,
  type AssemblyState,
} from './assemblyState';

// ─── wire format ──────────────────────────────────────────────────────────

/** Current wire-format version. Bump when AssemblyState shape changes. */
export const ASSEMBLY_PERSIST_VERSION = 1 as const;

export interface PersistedAssembly {
  /** Wire-format version (currently always 1). */
  version: typeof ASSEMBLY_PERSIST_VERSION;
  /** Raw IR payload — round-trips through structuredClone-equivalent JSON. */
  state: AssemblyState;
}

// ─── serialize ────────────────────────────────────────────────────────────

/**
 * Serialise an AssemblyState to a JSON string wrapped in a versioned
 * envelope. Validates the input first — refuses to emit a broken save
 * file so consumers don't have to handle "partially valid" snapshots.
 *
 * Throws `AssemblyValidationError` when the input fails IR validation.
 */
export function serializeAssembly(state: AssemblyState): string {
  validateAssembly(state);
  const envelope: PersistedAssembly = {
    version: ASSEMBLY_PERSIST_VERSION,
    state,
  };
  return JSON.stringify(envelope);
}

// ─── deserialize ──────────────────────────────────────────────────────────

export type DeserializeResult =
  | { ok: true; state: AssemblyState }
  | { ok: false; error: string };

/**
 * Parse + validate a previously serialised AssemblyState. Returns an
 * envelope rather than throwing so callers (file-load UI, autosave
 * recovery flow) can branch on `result.ok` without try/catch.
 *
 * Error modes (in detection order):
 *   - non-string input
 *   - JSON.parse failure → `parse_error: <msg>`
 *   - missing or wrong `version` field → `version_mismatch: ...`
 *   - missing `state` or wrong shape → `bad_envelope: ...`
 *   - validateAssembly failure → `invalid_state: <validation msg>`
 */
export function deserializeAssembly(json: unknown): DeserializeResult {
  if (typeof json !== 'string') {
    return { ok: false, error: 'parse_error: input is not a string' };
  }
  if (json.length === 0) {
    return { ok: false, error: 'parse_error: input is empty' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: `parse_error: ${(err as Error).message}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'bad_envelope: expected JSON object' };
  }
  const envelope = parsed as Record<string, unknown>;
  if (!('version' in envelope)) {
    return { ok: false, error: 'version_mismatch: missing version field' };
  }
  if (envelope.version !== ASSEMBLY_PERSIST_VERSION) {
    return {
      ok: false,
      error: `version_mismatch: expected ${ASSEMBLY_PERSIST_VERSION}, got ${String(envelope.version)}`,
    };
  }
  if (!('state' in envelope) || !envelope.state || typeof envelope.state !== 'object') {
    return { ok: false, error: 'bad_envelope: missing or invalid state' };
  }
  const rawState = envelope.state as Record<string, unknown>;
  if (!Array.isArray(rawState.parts) || !Array.isArray(rawState.mates)) {
    return { ok: false, error: 'bad_envelope: state.parts and state.mates must be arrays' };
  }
  const candidate = rawState as unknown as AssemblyState;
  try {
    validateAssembly(candidate);
  } catch (err) {
    if (err instanceof AssemblyValidationError) {
      return { ok: false, error: `invalid_state: ${err.message}` };
    }
    return { ok: false, error: `invalid_state: ${(err as Error).message}` };
  }
  return { ok: true, state: candidate };
}

// ─── localStorage hook ────────────────────────────────────────────────────

/** Internal: SSR-safe localStorage access. Returns null when unavailable. */
function safeStorage(): Storage | null {
  try {
    if (typeof globalThis === 'undefined') return null;
    const g = globalThis as { localStorage?: Storage };
    return g.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * React hook: persists an AssemblyState to localStorage under `key`,
 * debouncing writes by 500 ms so a continuous drag / mate-tweak doesn't
 * thrash the storage API.
 *
 * Initial state: rehydrated from localStorage if a valid v1 envelope is
 * present; otherwise falls back to `initial` (default: empty assembly).
 *
 * Returns `[state, setState]` with the same shape as React's `useState`.
 * Writes are best-effort — storage exceptions (quota, disabled) are
 * swallowed and logged via `console.warn` so the editor keeps working.
 *
 * Pass `key = ''` (or omit it) to disable persistence — the hook then
 * behaves as a plain `useState`. Useful for tests that don't want
 * cross-test localStorage pollution.
 */
export function useAssemblyStorage(
  key: string,
  initial: AssemblyState = { parts: [], mates: [] },
): [AssemblyState, (next: AssemblyState) => void] {
  const [state, setStateInternal] = useState<AssemblyState>(() => {
    if (!key) return initial;
    const storage = safeStorage();
    if (!storage) return initial;
    const raw = storage.getItem(key);
    if (raw === null) return initial;
    const result = deserializeAssembly(raw);
    if (!result.ok) {
      // Don't throw on init — corrupted save shouldn't lock the user out
      // of the editor. Surface the reason so the dev can diagnose.
      console.warn(`[assemblyPersist] failed to rehydrate '${key}': ${result.error}`);
      return initial;
    }
    return result.state;
  });

  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<AssemblyState>(state);

  // Always set immediately (UI must feel snappy); schedule the write.
  const setState = useCallback(
    (next: AssemblyState) => {
      latestRef.current = next;
      setStateInternal(next);
      if (!key) return;
      const storage = safeStorage();
      if (!storage) return;
      if (pendingRef.current !== null) {
        clearTimeout(pendingRef.current);
      }
      pendingRef.current = setTimeout(() => {
        pendingRef.current = null;
        try {
          const wire = serializeAssembly(latestRef.current);
          storage.setItem(key, wire);
        } catch (err) {
          // Validation or quota — keep editor alive.
          console.warn(`[assemblyPersist] save failed for '${key}': ${(err as Error).message}`);
        }
      }, 500);
    },
    [key],
  );

  // Flush any pending write on unmount so we don't lose the last edit.
  useEffect(() => {
    return () => {
      if (pendingRef.current === null) return;
      clearTimeout(pendingRef.current);
      pendingRef.current = null;
      if (!key) return;
      const storage = safeStorage();
      if (!storage) return;
      try {
        const wire = serializeAssembly(latestRef.current);
        storage.setItem(key, wire);
      } catch {
        // ignore — best-effort flush
      }
    };
  }, [key]);

  return [state, setState];
}
