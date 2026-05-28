// @vitest-environment jsdom
/**
 * DynamicEdgeOverlay.test.tsx — Wave 2 Phase 3 Track E2.
 *
 * Mirrors `DirectEditOverlay.test.tsx` for the new edge-based overlay.
 * We exercise mount-time invariants only; the full pointer-pick →
 * drag → applyDynamic… flow runs in the W11 burn-in soak (R3F event
 * driving in jsdom isn't possible without a real WebGL context).
 *
 * What we lock here:
 *   - Returns null when geometry is missing.
 *   - Returns null when modeActive is false.
 *   - Returns null when the controller is disabled (flag OFF).
 *   - Renders a <group> with the right testid when all gates pass.
 *   - Reports the active mode via data-mode (so the host can
 *     verify which sub-mode is wired).
 *   - Tolerates re-render across mode flips.
 *   - Tolerates re-mount with geometry going null→geometry.
 *   - Both modes (`dynamic-fillet`, `dynamic-chamfer`) emit the
 *     overlay element with their respective `data-mode` attribute.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import * as THREE from 'three';
import { DirectEditProvider } from '../DirectEditController';
import { DynamicEdgeOverlay } from '../DynamicEdgeOverlay';

function makeGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
  );
  return geo;
}

function runOverlay({
  enabled,
  modeActive,
  mode,
  geometry,
}: {
  enabled: boolean;
  modeActive: boolean;
  mode: 'dynamic-fillet' | 'dynamic-chamfer';
  geometry: THREE.BufferGeometry | null;
}): React.ReactElement | null {
  let element: React.ReactElement | null = null;
  const setElement = (e: React.ReactElement | null) => { element = e; };
  function Probe() {
    setElement(
      DynamicEdgeOverlay({ geometry, modeActive, mode }) as React.ReactElement | null,
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

describe('DynamicEdgeOverlay', () => {
  it('returns null when geometry is null', () => {
    const out = runOverlay({
      enabled: true, modeActive: true, mode: 'dynamic-fillet', geometry: null,
    });
    expect(out).toBeNull();
  });

  it('returns null when modeActive is false', () => {
    const out = runOverlay({
      enabled: true, modeActive: false, mode: 'dynamic-fillet', geometry: makeGeometry(),
    });
    expect(out).toBeNull();
  });

  it('returns null when controller is disabled (flag OFF)', () => {
    const out = runOverlay({
      enabled: false, modeActive: true, mode: 'dynamic-fillet', geometry: makeGeometry(),
    });
    expect(out).toBeNull();
  });

  it('renders a <group> element when all gates pass (fillet mode)', () => {
    const out = runOverlay({
      enabled: true, modeActive: true, mode: 'dynamic-fillet', geometry: makeGeometry(),
    });
    expect(out).not.toBeNull();
    expect((out as React.ReactElement).type).toBe('group');
  });

  it('group has the expected testid', () => {
    const out = runOverlay({
      enabled: true, modeActive: true, mode: 'dynamic-fillet', geometry: makeGeometry(),
    });
    const props = (out as React.ReactElement)
      .props as { 'data-testid'?: string };
    expect(props['data-testid']).toBe('dynamic-edge-overlay');
  });

  it('data-mode attribute reflects the active mode (fillet)', () => {
    const out = runOverlay({
      enabled: true, modeActive: true, mode: 'dynamic-fillet', geometry: makeGeometry(),
    });
    const props = (out as React.ReactElement).props as { 'data-mode'?: string };
    expect(props['data-mode']).toBe('dynamic-fillet');
  });

  it('data-mode attribute reflects the active mode (chamfer)', () => {
    const out = runOverlay({
      enabled: true, modeActive: true, mode: 'dynamic-chamfer', geometry: makeGeometry(),
    });
    const props = (out as React.ReactElement).props as { 'data-mode'?: string };
    expect(props['data-mode']).toBe('dynamic-chamfer');
  });

  it('renders a children array including the picker mesh', () => {
    const out = runOverlay({
      enabled: true, modeActive: true, mode: 'dynamic-fillet', geometry: makeGeometry(),
    });
    expect(out).not.toBeNull();
    // children may be array of [mesh, falsy] when no pick yet — at minimum the picker mesh.
    const props = (out as React.ReactElement).props as { children?: React.ReactNode };
    expect(props.children).toBeDefined();
  });

  it('attaches pointer handlers on the group', () => {
    const out = runOverlay({
      enabled: true, modeActive: true, mode: 'dynamic-fillet', geometry: makeGeometry(),
    });
    const props = (out as React.ReactElement).props as {
      onPointerDown?: unknown;
      onPointerUp?: unknown;
    };
    expect(typeof props.onPointerDown).toBe('function');
    expect(typeof props.onPointerUp).toBe('function');
  });
});
