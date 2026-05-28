/**
 * selectThreadRenderMode.test.ts — Wave 2 Phase 2 Track D7 (W7).
 *
 * Verifies the live-drag demotion + hysteresis selector (spec §8.1, §11.2).
 */

import { describe, it, expect } from 'vitest';
import {
  selectThreadRenderMode,
  dragStateStart,
  dragStateEnd,
  recordGeometricFrame,
  SLOW_FRAME_THRESHOLD_MS,
  HYSTERESIS_COOLDOWN_MS,
  INITIAL_DRAG_STATE,
  INITIAL_FRAME_STATS,
} from '../selectThreadRenderMode';
import type { ThreadFeature } from '../threadFeature';

function feature(mode: 'cosmetic' | 'geometric'): Pick<ThreadFeature, 'mode'> {
  return { mode };
}

describe('selectThreadRenderMode — drag overrides everything', () => {
  it('demotes geometric → cosmetic during active drag', () => {
    expect(
      selectThreadRenderMode({
        feature: feature('geometric'),
        dragState: { isDragging: true },
        frameStats: {},
        now: 0,
      }),
    ).toBe('cosmetic');
  });

  it('cosmetic stays cosmetic during drag', () => {
    expect(
      selectThreadRenderMode({
        feature: feature('cosmetic'),
        dragState: { isDragging: true },
        frameStats: {},
        now: 0,
      }),
    ).toBe('cosmetic');
  });
});

describe('selectThreadRenderMode — stored mode passthrough', () => {
  it('feature.mode=cosmetic always returns cosmetic (never promotes)', () => {
    expect(
      selectThreadRenderMode({
        feature: feature('cosmetic'),
        dragState: INITIAL_DRAG_STATE,
        frameStats: INITIAL_FRAME_STATS,
        now: 1000,
      }),
    ).toBe('cosmetic');
  });

  it('feature.mode=geometric without drag/cooldown returns geometric', () => {
    expect(
      selectThreadRenderMode({
        feature: feature('geometric'),
        dragState: INITIAL_DRAG_STATE,
        frameStats: { lastGeometricFrameMs: 20 },
        now: 5000,
      }),
    ).toBe('geometric');
  });
});

describe('selectThreadRenderMode — hysteresis cooldown', () => {
  it('slow frame + recent drag end → stays cosmetic', () => {
    const now = 10_000;
    const out = selectThreadRenderMode({
      feature: feature('geometric'),
      dragState: { isDragging: false, lastDragEndMs: now - 100 }, // 100ms ago
      frameStats: { lastGeometricFrameMs: SLOW_FRAME_THRESHOLD_MS + 10 },
      now,
    });
    expect(out).toBe('cosmetic');
  });

  it('slow frame + drag ended LONG ago (>500ms) → returns geometric', () => {
    const now = 10_000;
    const out = selectThreadRenderMode({
      feature: feature('geometric'),
      dragState: { isDragging: false, lastDragEndMs: now - 1000 },
      frameStats: { lastGeometricFrameMs: SLOW_FRAME_THRESHOLD_MS + 10 },
      now,
    });
    expect(out).toBe('geometric');
  });

  it('fast frame + recent drag end → returns geometric (no cooldown triggered)', () => {
    const now = 10_000;
    const out = selectThreadRenderMode({
      feature: feature('geometric'),
      dragState: { isDragging: false, lastDragEndMs: now - 100 },
      frameStats: { lastGeometricFrameMs: 10 }, // fast
      now,
    });
    expect(out).toBe('geometric');
  });

  it('exactly at the threshold (50ms) is NOT slow (uses strict >)', () => {
    const now = 10_000;
    const out = selectThreadRenderMode({
      feature: feature('geometric'),
      dragState: { isDragging: false, lastDragEndMs: now - 100 },
      frameStats: { lastGeometricFrameMs: SLOW_FRAME_THRESHOLD_MS },
      now,
    });
    expect(out).toBe('geometric');
  });

  it('cooldown lasts exactly HYSTERESIS_COOLDOWN_MS', () => {
    const now = 10_000;
    // 1ms before cooldown expiry → still cosmetic
    const beforeOut = selectThreadRenderMode({
      feature: feature('geometric'),
      dragState: { isDragging: false, lastDragEndMs: now - (HYSTERESIS_COOLDOWN_MS - 1) },
      frameStats: { lastGeometricFrameMs: 100 },
      now,
    });
    expect(beforeOut).toBe('cosmetic');
    // exactly at expiry → uses strict <, so geometric again
    const afterOut = selectThreadRenderMode({
      feature: feature('geometric'),
      dragState: { isDragging: false, lastDragEndMs: now - HYSTERESIS_COOLDOWN_MS },
      frameStats: { lastGeometricFrameMs: 100 },
      now,
    });
    expect(afterOut).toBe('geometric');
  });
});

describe('drag-state lifecycle helpers', () => {
  it('dragStateStart preserves the previous lastDragEndMs', () => {
    const prev = { isDragging: false, lastDragEndMs: 1234 };
    const next = dragStateStart(prev);
    expect(next.isDragging).toBe(true);
    expect(next.lastDragEndMs).toBe(1234);
  });

  it('dragStateEnd stamps current time and clears dragging flag', () => {
    const next = dragStateEnd(5000);
    expect(next.isDragging).toBe(false);
    expect(next.lastDragEndMs).toBe(5000);
  });

  it('recordGeometricFrame is identity-stable on equal durations', () => {
    const prev = { lastGeometricFrameMs: 42 };
    expect(recordGeometricFrame(prev, 42)).toBe(prev);
  });

  it('recordGeometricFrame creates new object on different duration', () => {
    const prev = { lastGeometricFrameMs: 42 };
    const next = recordGeometricFrame(prev, 50);
    expect(next).not.toBe(prev);
    expect(next.lastGeometricFrameMs).toBe(50);
  });
});
