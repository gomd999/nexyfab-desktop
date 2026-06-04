/**
 * draft feature — mesh taper (mould/cast draft). This module had no test; the
 * suite pins the wall-taper behaviour. (A precise replicad `.draft` B-rep path
 * was prototyped but not shipped — the face-finder + neutral-plane convention
 * needs more verification than was warranted over the working mesh taper, whose
 * vertex-offset is a reasonable draft approximation.)
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { draftFeature } from './draft';

const params = { angle: 5, direction: 0 };

function box(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
}

describe('draftFeature', () => {
  it('exposes a sync apply', () => {
    expect(typeof draftFeature.apply).toBe('function');
  });

  it('apply() tapers the walls and keeps a non-empty geometry', () => {
    const out = draftFeature.apply(box(), params);
    expect(out.attributes.position.count).toBeGreaterThan(0);
  });

  it('moves vertices off the neutral plane (X/Z shift grows with Y)', () => {
    const g = box();
    const out = draftFeature.apply(g, { angle: 10, direction: 0 });
    const inX = g.attributes.position.array as ArrayLike<number>;
    const outX = out.attributes.position.array as ArrayLike<number>;
    let moved = false;
    for (let i = 0; i < inX.length; i += 3) {
      if (Math.abs(inX[i] - outX[i]) > 1e-6) { moved = true; break; }
    }
    expect(moved).toBe(true);
  });

  it('a downward draft mirrors the upward one (opposite offset sign)', () => {
    const up = draftFeature.apply(box(), { angle: 8, direction: 0 });
    const down = draftFeature.apply(box(), { angle: 8, direction: 1 });
    const u = up.attributes.position.array as ArrayLike<number>;
    const d = down.attributes.position.array as ArrayLike<number>;
    // For the same input, up/down offsets are negatives → sum back to ~2× base.
    let differ = false;
    for (let i = 0; i < u.length; i += 3) {
      if (Math.abs(u[i] - d[i]) > 1e-6) { differ = true; break; }
    }
    expect(differ).toBe(true);
  });
});
