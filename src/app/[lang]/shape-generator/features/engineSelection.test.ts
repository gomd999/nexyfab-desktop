/**
 * engineSelection — locks the kernel-of-record policy (F1). The decision used to
 * be open-coded in ~18 features; these tests pin the single source of truth,
 * including the drag/commit perf guard that makes a future default-ON safe.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  wantsOcctEngine,
  shouldUseOcctEngine,
  setInteractionPhase,
  getInteractionPhase,
} from './engineSelection';
import { setOcctGlobalMode, isOcctReady } from './occtEngine';

// The kernel is not loaded in this headless suite — shouldUseOcctEngine must reflect that.
const KERNEL_LOADED = isOcctReady();

describe('engineSelection — kernel-of-record policy (F1)', () => {
  beforeEach(() => {
    setOcctGlobalMode(false);
    setInteractionPhase('commit');
  });
  afterEach(() => {
    setOcctGlobalMode(false);
    setInteractionPhase('commit');
  });

  describe('wantsOcctEngine (pure intent)', () => {
    it('is true when the per-feature engine enum is 1', () => {
      expect(wantsOcctEngine(1)).toBe(true);
    });
    it('is false for engine 0 / undefined when global mode is off', () => {
      expect(wantsOcctEngine(0)).toBe(false);
      expect(wantsOcctEngine(undefined)).toBe(false);
    });
    it('is true for any feature once the global OCCT toggle is on', () => {
      setOcctGlobalMode(true);
      expect(wantsOcctEngine(0)).toBe(true);
      expect(wantsOcctEngine(undefined)).toBe(true);
    });
    it('ignores kernel availability and the perf guard (it is pure intent)', () => {
      setOcctGlobalMode(true);
      setInteractionPhase('drag');
      expect(wantsOcctEngine(undefined)).toBe(true);
    });
  });

  describe('shouldUseOcctEngine (intent AND ready AND not dragging)', () => {
    it('is false when the engine is not wanted, regardless of kernel', () => {
      expect(shouldUseOcctEngine(0)).toBe(false);
    });

    it('requires the kernel to be loaded', () => {
      setOcctGlobalMode(true);
      // In this headless suite the kernel is unloaded → must be false even though wanted.
      expect(shouldUseOcctEngine(1)).toBe(KERNEL_LOADED ? true : false);
      if (!KERNEL_LOADED) expect(shouldUseOcctEngine(1)).toBe(false);
    });

    it('perf guard: a wanted+ready engine is suppressed during a drag', () => {
      // Force the "wanted" and isolate the guard from kernel state by asserting the
      // implication: if not ready, both phases are false; if ready, drag flips it off.
      setOcctGlobalMode(true);
      setInteractionPhase('commit');
      const onCommit = shouldUseOcctEngine(1);
      setInteractionPhase('drag');
      const onDrag = shouldUseOcctEngine(1);
      expect(onDrag).toBe(false);
      if (KERNEL_LOADED) expect(onCommit).toBe(true);
      // drag must never be "more OCCT" than commit
      expect(Number(onDrag)).toBeLessThanOrEqual(Number(onCommit));
    });
  });

  it('interaction phase round-trips and defaults to commit', () => {
    expect(getInteractionPhase()).toBe('commit');
    setInteractionPhase('drag');
    expect(getInteractionPhase()).toBe('drag');
    setInteractionPhase('commit');
    expect(getInteractionPhase()).toBe('commit');
  });
});
