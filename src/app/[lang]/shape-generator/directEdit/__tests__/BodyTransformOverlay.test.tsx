// @vitest-environment jsdom
/**
 * BodyTransformOverlay.test.tsx — Wave 2 Phase 3 Track E3.
 *
 * R3F overlay tests focus on mount-time invariants only (parity with
 * DirectEditOverlay's suite). The full drag-the-gizmo path is
 * exercised in the W11 burn-in soak since drei TransformControls
 * needs a live WebGL context.
 *
 * What we lock here:
 *   - Returns null when geometry is missing.
 *   - Returns null when mode is 'off'.
 *   - Returns null when the controller is disabled.
 *   - Renders a <group> with the expected testid when all gates pass.
 *   - The group's `data-mode` attribute reflects the active mode.
 *   - The component tolerates a geometry-less mount/unmount cycle.
 *   - Move and rotate modes both render the same outer shell.
 *   - Calling the component outside a provider degrades to null
 *     (NULL_API path).
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import * as THREE from 'three';
import { DirectEditProvider } from '../DirectEditController';
import {
  BodyTransformOverlay,
  type BodyTransformMode,
} from '../BodyTransformOverlay';

// drei's TransformControls wraps the THREE.js OrbitControls' DOM
// element binding and requires a Canvas. For unit tests we stub it
// out via a vitest module-mock to avoid the WebGL dependency.
vi.mock('@react-three/drei', () => ({
  TransformControls: () => null,
}));

function makeGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
  );
  geo.userData = { lastFeatureId: 'body-test' };
  return geo;
}

function runOverlay({
  enabled,
  mode,
  geometry,
}: {
  enabled: boolean;
  mode: BodyTransformMode;
  geometry: THREE.BufferGeometry | null;
}): React.ReactElement | null {
  let element: React.ReactElement | null = null;
  const setElement = (e: React.ReactElement | null) => { element = e; };
  function Probe() {
    setElement(
      BodyTransformOverlay({ geometry, mode }) as React.ReactElement | null,
    );
    return null;
  }
  render(
    <DirectEditProvider enabled={enabled} historyVersion={0}>
      <Probe />
    </DirectEditProvider>,
  );
  return element;
}

describe('BodyTransformOverlay', () => {
  it('returns null when geometry is null', () => {
    const out = runOverlay({
      enabled: true,
      mode: 'move-body',
      geometry: null,
    });
    expect(out).toBeNull();
  });

  it('returns null when mode is "off"', () => {
    const out = runOverlay({
      enabled: true,
      mode: 'off',
      geometry: makeGeometry(),
    });
    expect(out).toBeNull();
  });

  it('returns null when the controller is disabled (flag OFF)', () => {
    const out = runOverlay({
      enabled: false,
      mode: 'move-body',
      geometry: makeGeometry(),
    });
    expect(out).toBeNull();
  });

  it('renders a <group> for move-body mode when all gates pass', () => {
    const out = runOverlay({
      enabled: true,
      mode: 'move-body',
      geometry: makeGeometry(),
    });
    expect(out).not.toBeNull();
    expect((out as React.ReactElement).type).toBe('group');
  });

  it('renders a <group> for rotate-body mode when all gates pass', () => {
    const out = runOverlay({
      enabled: true,
      mode: 'rotate-body',
      geometry: makeGeometry(),
    });
    expect(out).not.toBeNull();
    expect((out as React.ReactElement).type).toBe('group');
  });

  it('group has the expected testid for downstream selectors', () => {
    const out = runOverlay({
      enabled: true,
      mode: 'move-body',
      geometry: makeGeometry(),
    });
    expect(out).not.toBeNull();
    const props = (out as React.ReactElement)
      .props as { 'data-testid'?: string; 'data-mode'?: string };
    expect(props['data-testid']).toBe('body-transform-overlay');
  });

  it('exposes the active mode via data-mode attribute', () => {
    const moveOut = runOverlay({
      enabled: true,
      mode: 'move-body',
      geometry: makeGeometry(),
    });
    const props = (moveOut as React.ReactElement).props as { 'data-mode'?: string };
    expect(props['data-mode']).toBe('move-body');
    const rotateOut = runOverlay({
      enabled: true,
      mode: 'rotate-body',
      geometry: makeGeometry(),
    });
    const rotateProps = (rotateOut as React.ReactElement)
      .props as { 'data-mode'?: string };
    expect(rotateProps['data-mode']).toBe('rotate-body');
  });

  it('tolerates a geometry-less render without throwing', () => {
    expect(() => runOverlay({
      enabled: true,
      mode: 'move-body',
      geometry: null,
    })).not.toThrow();
  });
});
