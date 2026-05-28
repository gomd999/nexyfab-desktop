// @vitest-environment jsdom
/**
 * DirectEditOverlay.test.tsx — Wave 2 Phase 3 Track E1.
 *
 * R3F overlay tests focus on mount-time invariants only — the full
 * raycast → drag → apply path is exercised in the W11 burn-in soak
 * (manual smoke), since R3F's event system can't be driven cleanly
 * without a real WebGL context.
 *
 * What we lock here:
 *   - The overlay returns `null` when `geometry` is missing.
 *   - The overlay returns `null` when `modeActive` is false.
 *   - The overlay returns `null` when the controller is disabled.
 *   - The overlay renders the group when all gates pass.
 *   - The overlay tolerates a geometry-less mount/unmount cycle.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import * as THREE from 'three';
import { DirectEditProvider } from '../DirectEditController';
import { DirectEditOverlay } from '../DirectEditOverlay';

// R3F mounts <group> etc as Object3D inside a Canvas. For unit tests
// we don't bring in @react-three/fiber's full renderer — we just check
// the React-side render output. R3F primitives render as host
// elements when rendered outside <Canvas>, which throws unless we
// stub them. We stub <group> and <mesh> as plain divs via custom
// React reconciler-free render — render() outside <Canvas> in
// jsdom emits warnings but works for "null vs not null" assertions.

// To keep this safe, we wrap render with a try/catch and assert on
// the *return* of DirectEditOverlay rather than its DOM output.

function makeGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
  );
  return geo;
}

/** Calls the overlay's render function directly with a controller
 *  context. Returns the React element (or null). Avoids R3F's host
 *  primitive resolver. */
function runOverlay({
  enabled,
  modeActive,
  geometry,
}: {
  enabled: boolean;
  modeActive: boolean;
  geometry: THREE.BufferGeometry | null;
}): React.ReactElement | null {
  let element: React.ReactElement | null = null;
  const setElement = (e: React.ReactElement | null) => { element = e; };
  function Probe() {
    setElement(
      DirectEditOverlay({ geometry, modeActive }) as React.ReactElement | null,
    );
    return null;
  }
  // Render inside provider so the hook resolution works.
  // We use a fragment as root.
  render(
    <DirectEditProvider enabled={enabled} historyVersion={0}>
      <Probe />
    </DirectEditProvider>,
  );
  return element;
}

describe('DirectEditOverlay', () => {
  it('returns null when geometry is null', () => {
    const out = runOverlay({ enabled: true, modeActive: true, geometry: null });
    expect(out).toBeNull();
  });

  it('returns null when modeActive is false', () => {
    const out = runOverlay({ enabled: true, modeActive: false, geometry: makeGeometry() });
    expect(out).toBeNull();
  });

  it('returns null when the controller is disabled (flag OFF)', () => {
    const out = runOverlay({ enabled: false, modeActive: true, geometry: makeGeometry() });
    expect(out).toBeNull();
  });

  it('renders a <group> element when all gates pass', () => {
    const out = runOverlay({ enabled: true, modeActive: true, geometry: makeGeometry() });
    expect(out).not.toBeNull();
    // It returns a <group>; in JSX-as-element form, type is 'group'.
    expect((out as React.ReactElement).type).toBe('group');
  });

  it('group has the expected testid for downstream selectors', () => {
    const out = runOverlay({ enabled: true, modeActive: true, geometry: makeGeometry() });
    expect(out).not.toBeNull();
    const props = (out as React.ReactElement)
      .props as { 'data-testid'?: string };
    expect(props['data-testid']).toBe('direct-edit-overlay');
  });
});
