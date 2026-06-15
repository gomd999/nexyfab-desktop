// @vitest-environment jsdom
/**
 * CurvatureCombOverlay.test.tsx — mount-time invariants for the R3F comb
 * overlay. Like DirectEditOverlay's tests, we assert on the React-side return
 * (null vs <group>) without a real Canvas/WebGL context; the geometry math is
 * covered exhaustively by buildCombScene in nurbsSurfaceCurvature.test.ts.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import * as THREE from 'three';
import { CurvatureCombOverlay, type CurvatureCombOverlayProps } from './CurvatureCombOverlay';
import type { NurbsSurface } from './nurbsSurface';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const w = Math.SQRT1_2;

function cylinder(): NurbsSurface {
  return {
    controlPoints: [
      [V(0, 10, 0), V(0, 10, 10), V(0, 0, 10)],
      [V(20, 10, 0), V(20, 10, 10), V(20, 0, 10)],
    ],
    weights: [[1, w, 1], [1, w, 1]],
    degreeU: 1, degreeV: 2, knotsU: [0, 0, 1, 1], knotsV: [0, 0, 0, 1, 1, 1],
  };
}

/** Calls the overlay's render function inside a render context so its useMemo
 *  hook resolves, and captures the returned element. */
function runOverlay(props: CurvatureCombOverlayProps): React.ReactElement | null {
  let element: React.ReactElement | null = null;
  function Probe() {
    element = CurvatureCombOverlay(props) as React.ReactElement | null;
    return null;
  }
  render(<Probe />);
  return element;
}

describe('CurvatureCombOverlay', () => {
  it('returns null when surface is null', () => {
    expect(runOverlay({ surface: null })).toBeNull();
  });

  it('returns null when visible is false', () => {
    expect(runOverlay({ surface: cylinder(), visible: false })).toBeNull();
  });

  it('renders a <group> with the comb testid when a surface is supplied', () => {
    const out = runOverlay({ surface: cylinder() });
    expect(out).not.toBeNull();
    expect((out as React.ReactElement).type).toBe('group');
    const props = (out as React.ReactElement).props as { 'data-testid'?: string };
    expect(props['data-testid']).toBe('curvature-comb-overlay');
  });

  it('renders two lineSegments children (spikes + envelope) when there is no inflection', () => {
    const out = runOverlay({ surface: cylinder(), isoParams: [0.5], sampleCount: 8 });
    const rootProps = (out as React.ReactElement).props as { children?: React.ReactNode };
    const children = (React.Children.toArray(rootProps.children) as React.ReactElement[]).filter(Boolean);
    expect(children).toHaveLength(2);
    for (const c of children) expect(c.type).toBe('lineSegments');
    // Both carry a BufferGeometry with a position attribute.
    for (const c of children) {
      const geo = (c.props as { geometry: THREE.BufferGeometry }).geometry;
      expect(geo.getAttribute('position')).toBeTruthy();
    }
  });

  it('adds an inflection-marker lineSegments for an S-profile surface', () => {
    const V0 = (y: number, z: number, x: number) => new THREE.Vector3(x, y, z);
    const sCurve: NurbsSurface = {
      controlPoints: [
        [V0(0, 0, 0), V0(1, 1, 0), V0(2, -1, 0), V0(3, 0, 0)],
        [V0(0, 0, 10), V0(1, 1, 10), V0(2, -1, 10), V0(3, 0, 10)],
      ],
      degreeU: 1, degreeV: 3, knotsU: [0, 0, 1, 1], knotsV: [0, 0, 0, 0, 1, 1, 1, 1],
    };
    const out = runOverlay({ surface: sCurve, isoDirection: 'u', isoParams: [0.5], sampleCount: 16 });
    const rootProps = (out as React.ReactElement).props as { children?: React.ReactNode };
    const children = (React.Children.toArray(rootProps.children) as React.ReactElement[]).filter(Boolean);
    expect(children).toHaveLength(3); // spikes + envelope + inflection crosses
    const infl = children.find(c => (c.props as { userData?: { inflectionMarkers?: boolean } }).userData?.inflectionMarkers);
    expect(infl).toBeTruthy();
  });
});
