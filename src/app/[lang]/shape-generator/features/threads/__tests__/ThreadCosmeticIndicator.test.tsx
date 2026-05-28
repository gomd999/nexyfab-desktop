/** @vitest-environment jsdom */
/**
 * threads/__tests__/ThreadCosmeticIndicator.test.tsx — Wave 2 Phase 2 Track D6.
 *
 * The R3F component itself can't render directly in jsdom (no WebGL), so we
 * exercise the **imperative helpers** that build the geometry / material.
 * The end-to-end mount happens in the burn-in suite where a real WebGL
 * context is available; here we lock the contract of the helpers so unit
 * tests catch regressions without needing GPU.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildDashedCircleGeometry,
  makeDashedMaterial,
  makeLineForVisual,
  buildThreadCosmeticPolyline,
  THREAD_COSMETIC_COLOR,
  THREAD_COSMETIC_DASH_SIZE,
  THREAD_COSMETIC_GAP_SIZE,
  THREAD_COSMETIC_SEGMENTS,
} from '../ThreadCosmeticIndicator';
import { makeThreadFeature } from '../threadFeature';

describe('ThreadCosmeticIndicator — colour & dash constants', () => {
  it('uses magenta #ff00ff per spec §8', () => {
    expect(THREAD_COSMETIC_COLOR).toBe('#ff00ff');
  });

  it('uses 1.5 mm dash / 0.75 mm gap (2:1 ratio)', () => {
    expect(THREAD_COSMETIC_DASH_SIZE).toBe(1.5);
    expect(THREAD_COSMETIC_GAP_SIZE).toBe(0.75);
  });

  it('uses 36 segments around the axis (10° per segment)', () => {
    expect(THREAD_COSMETIC_SEGMENTS).toBe(36);
  });
});

describe('buildDashedCircleGeometry', () => {
  it('produces 36+1 vertices (closed loop)', () => {
    const geom = buildDashedCircleGeometry([0, 0, 0], [0, 0, 1], 4);
    const pos = geom.getAttribute('position');
    expect(pos.count).toBe(THREAD_COSMETIC_SEGMENTS + 1);
  });

  it('first and last vertex are coincident (closed loop)', () => {
    const geom = buildDashedCircleGeometry([0, 0, 0], [0, 0, 1], 4);
    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    const f = [pos.getX(0), pos.getY(0), pos.getZ(0)];
    const l = [pos.getX(pos.count - 1), pos.getY(pos.count - 1), pos.getZ(pos.count - 1)];
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(f[i] - l[i])).toBeLessThan(1e-6);
    }
  });

  it('all vertices sit on the radius from the center (for +Z axis circle)', () => {
    const radius = 4;
    const geom = buildDashedCircleGeometry([0, 0, 0], [0, 0, 1], radius);
    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      expect(Math.abs(r - radius)).toBeLessThan(1e-4);
      expect(Math.abs(pos.getZ(i))).toBeLessThan(1e-6); // in xy plane
    }
  });

  it('returns an empty geometry for non-positive radius', () => {
    const geom = buildDashedCircleGeometry([0, 0, 0], [0, 0, 1], 0);
    expect(geom.getAttribute('position')).toBeUndefined();
  });
});

describe('makeDashedMaterial', () => {
  it('returns a LineDashedMaterial in the spec colours', () => {
    const mat = makeDashedMaterial();
    expect(mat).toBeInstanceOf(THREE.LineDashedMaterial);
    expect(mat.dashSize).toBe(THREAD_COSMETIC_DASH_SIZE);
    expect(mat.gapSize).toBe(THREAD_COSMETIC_GAP_SIZE);
    // THREE Color.getHexString returns lower-case without "#".
    expect(`#${mat.color.getHexString()}`).toBe(THREAD_COSMETIC_COLOR);
  });
});

describe('makeLineForVisual', () => {
  it('builds a Line and computes line-distances (required for dashing)', () => {
    const geometry = buildDashedCircleGeometry([0, 0, 0], [0, 0, 1], 4);
    const material = makeDashedMaterial();
    const line = makeLineForVisual({ geometry, material });
    expect(line).toBeInstanceOf(THREE.Line);
    // computeLineDistances writes a 'lineDistance' attribute on the geometry.
    expect(line.geometry.getAttribute('lineDistance')).toBeDefined();
  });
});

describe('buildThreadCosmeticPolyline', () => {
  it('returns null for geometric-mode threads (W7)', () => {
    const f = makeThreadFeature({
      id: 'feat_geom',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      mode: 'geometric',
    });
    expect(buildThreadCosmeticPolyline(f)).toBeNull();
  });

  it('returns a polyline for cosmetic threads', () => {
    const f = makeThreadFeature({
      id: 'feat_cos',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
    });
    const geom = buildThreadCosmeticPolyline(f);
    expect(geom).not.toBeNull();
    const pos = geom!.getAttribute('position') as THREE.BufferAttribute;
    // M8 → radius = 4mm
    const r = Math.hypot(pos.getX(0), pos.getY(0));
    expect(Math.abs(r - 4)).toBeLessThan(1e-4);
  });

  it('honours the anchor.startOffset by translating along the axis', () => {
    const f = makeThreadFeature({
      id: 'feat_off',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      startOffset: 5,
    });
    const geom = buildThreadCosmeticPolyline(f);
    const pos = geom!.getAttribute('position') as THREE.BufferAttribute;
    // axis = +Z (default), startOffset = 5 → all z coords = 5.
    for (let i = 0; i < pos.count; i++) {
      expect(Math.abs(pos.getZ(i) - 5)).toBeLessThan(1e-4);
    }
  });

  it('uses the host-supplied axis when provided', () => {
    const f = makeThreadFeature({
      id: 'feat_axis_y',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      startOffset: 3,
    });
    const geom = buildThreadCosmeticPolyline(f, {
      axis: [0, 1, 0],
      origin: [0, 0, 0],
    });
    const pos = geom!.getAttribute('position') as THREE.BufferAttribute;
    // axis = +Y, startOffset = 3 → all y coords = 3.
    for (let i = 0; i < pos.count; i++) {
      expect(Math.abs(pos.getY(i) - 3)).toBeLessThan(1e-4);
    }
  });
});

// ─── Component render — only when @react-three/fiber is available ─────────
// We import the default export lazily so the imperative-helper tests above
// run even in environments where R3F's Canvas hook tree throws. The
// component itself is tested for the "renders nothing when threads is empty"
// no-op contract by inspecting its return value via a stub mount.

import React from 'react';
import { render } from '@testing-library/react';
import ThreadCosmeticIndicator from '../ThreadCosmeticIndicator';

describe('ThreadCosmeticIndicator — empty-threads no-op', () => {
  it('returns null when threads array is empty (no DOM children)', () => {
    const { container } = render(
      // jsdom can't render <primitive>/<group> from R3F outside a Canvas, but
      // when the component returns `null` (empty array path) the render works
      // because no R3F children are emitted.
      <ThreadCosmeticIndicator threads={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null when all threads are geometric (W7 placeholder)', () => {
    const geom = makeThreadFeature({
      id: 'feat_g1',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      mode: 'geometric',
    });
    const { container } = render(<ThreadCosmeticIndicator threads={[geom]} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when hidden=true regardless of threads', () => {
    const cos = makeThreadFeature({
      id: 'feat_c1',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
    });
    const { container } = render(
      <ThreadCosmeticIndicator threads={[cos]} hidden />,
    );
    expect(container.firstChild).toBeNull();
  });
});
