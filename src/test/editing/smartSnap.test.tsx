/** @vitest-environment jsdom */
/**
 * smartSnap regression — pins the contract that the SCAD viewport's smart
 * snap (edge-to-edge) feature relies on:
 *
 *  1. findEdgeSnapCandidates returns empty when no edge is within maxDistMm.
 *  2. With one near edge, it returns a single candidate snapped to the
 *     closest point on that edge.
 *  3. Multiple candidates sort by distance ascending (closer first).
 *  4. maxCandidates caps the result length.
 *  5. The StatusBar exposes data-testid="smart-snap-toggle" when wired
 *     and the click toggles the parent state.
 *
 * Pure helper tests don't need jsdom but vitest config uses node by default
 * and the toggle test does need it — so the whole file lives in jsdom.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';
import * as THREE from 'three';
import {
  findEdgeSnapCandidates,
  findBestEdgeSnap,
} from '@/app/[lang]/shape-generator/editing/smartSnap';
import StatusBar from '@/app/[lang]/shape-generator/StatusBar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/nexyfab/shape',
}));

/**
 * Build a tiny non-indexed geometry holding a single triangle with vertices
 * at (0,0,0), (10,0,0), (0,10,0). Its three edges lie along the X axis, the
 * Y axis, and the hypotenuse — perfect for distance-checks.
 */
function makeTriangleGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const positions = new Float32Array([
    0, 0, 0,
    10, 0, 0,
    0, 10, 0,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return g;
}

describe('findEdgeSnapCandidates', () => {
  it('returns empty when no edge is within maxDistMm', () => {
    const geo = makeTriangleGeometry();
    // Query point 50 mm away from any edge; default tolerance is 2 mm.
    const candidates = findEdgeSnapCandidates([50, 50, 50], geo);
    expect(candidates).toEqual([]);
    geo.dispose();
  });

  it('returns 1 candidate snapping to the nearest edge', () => {
    const geo = makeTriangleGeometry();
    // Pointer is 1 mm above the X-axis edge at x=5 → should snap onto (5,0,0).
    const candidates = findEdgeSnapCandidates([5, 1, 0], geo, { maxDistMm: 2 });
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const best = candidates[0];
    expect(best.kind).toBe('edge');
    expect(best.point[0]).toBeCloseTo(5, 5);
    expect(best.point[1]).toBeCloseTo(0, 5);
    expect(best.point[2]).toBeCloseTo(0, 5);
    expect(best.distMm).toBeCloseTo(1, 5);
    geo.dispose();
  });

  it('sorts candidates by distance ascending (closer first)', () => {
    const geo = makeTriangleGeometry();
    // Point near the corner (0,0,0) — within reach of BOTH the X-axis edge
    // and the Y-axis edge. The closer one must come first.
    const candidates = findEdgeSnapCandidates([0.5, 0.1, 0], geo, {
      maxDistMm: 5,
      maxCandidates: 8,
    });
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i].distMm).toBeGreaterThanOrEqual(candidates[i - 1].distMm);
    }
    geo.dispose();
  });

  it('respects maxCandidates limit', () => {
    const geo = makeTriangleGeometry();
    // Centre of the triangle — reachable from all three edges within 5 mm.
    const candidates = findEdgeSnapCandidates([3, 3, 0], geo, {
      maxDistMm: 50,
      maxCandidates: 1,
    });
    expect(candidates).toHaveLength(1);
    geo.dispose();
  });

  it('findBestEdgeSnap returns null when nothing in range', () => {
    const geo = makeTriangleGeometry();
    expect(findBestEdgeSnap([500, 500, 500], geo)).toBeNull();
    geo.dispose();
  });

  it('findBestEdgeSnap returns the single closest hit', () => {
    const geo = makeTriangleGeometry();
    const hit = findBestEdgeSnap([5, 0.5, 0], geo, { maxDistMm: 2 });
    expect(hit).not.toBeNull();
    expect(hit?.point[0]).toBeCloseTo(5, 5);
    expect(hit?.point[1]).toBeCloseTo(0, 5);
    expect(hit?.distMm).toBeCloseTo(0.5, 5);
    geo.dispose();
  });

  it('handles geometry with no position attribute (returns empty)', () => {
    const geo = new THREE.BufferGeometry();
    expect(findEdgeSnapCandidates([0, 0, 0], geo)).toEqual([]);
    geo.dispose();
  });
});

/** Minimal harness that mirrors how ShapeGeneratorInner wires the toggle. */
function StatusBarHarness() {
  const [smartSnapEnabled, setSmartSnap] = useState(false);
  return (
    <StatusBar
      lang="en"
      cursor3D={null}
      unitSystem="mm"
      onToggleUnit={() => undefined}
      selectionCount={0}
      activeTool={null}
      isSketchMode={false}
      editMode="none"
      featureCount={0}
      triangleCount={0}
      snapEnabled={false}
      onToggleSnap={() => undefined}
      smartSnapEnabled={smartSnapEnabled}
      onToggleSmartSnap={() => setSmartSnap((v) => !v)}
      sectionActive={false}
      sectionAxis="y"
      sectionOffset={0.5}
      onSectionAxisChange={() => undefined}
      onSectionOffsetChange={() => undefined}
      isOptimizing={false}
      progress={null}
      onShowShortcuts={() => undefined}
    />
  );
}

describe('StatusBar smart-snap toggle', () => {
  it('exposes data-testid="smart-snap-toggle" and flips OFF → ON on click', () => {
    render(<StatusBarHarness />);
    const btn = screen.getByTestId('smart-snap-toggle');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent(/Smart: OFF/);
    fireEvent.click(btn);
    expect(btn).toHaveTextContent(/Smart: ON/);
  });

  it('hides the toggle when onToggleSmartSnap is not provided', () => {
    render(
      <StatusBar
        lang="en"
        cursor3D={null}
        unitSystem="mm"
        onToggleUnit={() => undefined}
        selectionCount={0}
        activeTool={null}
        isSketchMode={false}
        editMode="none"
        featureCount={0}
        triangleCount={0}
        snapEnabled={false}
        onToggleSnap={() => undefined}
        sectionActive={false}
        sectionAxis="y"
        sectionOffset={0.5}
        onSectionAxisChange={() => undefined}
        onSectionOffsetChange={() => undefined}
        isOptimizing={false}
        progress={null}
        onShowShortcuts={() => undefined}
      />,
    );
    expect(screen.queryByTestId('smart-snap-toggle')).toBeNull();
  });
});
