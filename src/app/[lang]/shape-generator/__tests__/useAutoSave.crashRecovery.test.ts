/**
 * Crash recovery flag (Q5) — heuristic semantics test.
 *
 * The hook can't be unit-tested directly without a React harness, so we
 * verify the localStorage protocol the hook implements: a session flag
 * that's set on mount and cleared on pagehide. If the flag survives across
 * loads, the previous session crashed.
 *
 * This is the contract the UI banner relies on. Behavioral coverage of
 * the React side belongs in an E2E (Q8).
 */

import { describe, it, expect, beforeEach } from 'vitest';

const SESSION_FLAG_KEY = 'nexyfab-autosave-session-active';

class LocalStorageStub {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}

describe('Crash recovery session flag (Q5)', () => {
  let ls: LocalStorageStub;

  beforeEach(() => {
    ls = new LocalStorageStub();
  });

  // The hook does this on mount:
  //   const crashed = ls.getItem(KEY) === '1';
  //   ls.setItem(KEY, '1');
  //   ... (returns crashed boolean to the UI)
  // And on pagehide:
  //   ls.removeItem(KEY);

  it('clean exit: flag cleared on pagehide → next mount sees no crash', () => {
    // Session 1
    let crashed = ls.getItem(SESSION_FLAG_KEY) === '1';
    ls.setItem(SESSION_FLAG_KEY, '1');
    expect(crashed).toBe(false);

    // pagehide cleanup runs
    ls.removeItem(SESSION_FLAG_KEY);

    // Session 2
    crashed = ls.getItem(SESSION_FLAG_KEY) === '1';
    ls.setItem(SESSION_FLAG_KEY, '1');
    expect(crashed).toBe(false);
  });

  it('crash: pagehide does not run → next mount detects crash', () => {
    // Session 1
    let crashed = ls.getItem(SESSION_FLAG_KEY) === '1';
    ls.setItem(SESSION_FLAG_KEY, '1');
    expect(crashed).toBe(false);

    // Tab killed — pagehide never fires; flag persists.

    // Session 2
    crashed = ls.getItem(SESSION_FLAG_KEY) === '1';
    expect(crashed).toBe(true);
    // After detection, this session marks itself live:
    ls.setItem(SESSION_FLAG_KEY, '1');
  });

  it('two crashes in a row both detected', () => {
    // Crash 1
    ls.setItem(SESSION_FLAG_KEY, '1');
    let crashed = ls.getItem(SESSION_FLAG_KEY) === '1';
    expect(crashed).toBe(true);
    ls.setItem(SESSION_FLAG_KEY, '1');
    // Crash 2 — flag still set from session 2's setItem
    crashed = ls.getItem(SESSION_FLAG_KEY) === '1';
    expect(crashed).toBe(true);
  });

  it('first-ever load (no flag, no prior session) → not flagged as crash', () => {
    expect(ls.getItem(SESSION_FLAG_KEY)).toBeNull();
    const crashed = ls.getItem(SESSION_FLAG_KEY) === '1';
    expect(crashed).toBe(false);
  });
});
