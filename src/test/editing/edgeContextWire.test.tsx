/** @vitest-environment jsdom */
/**
 * EdgeContextPanel viewport wiring regression.
 *
 * Pins the contracts the host's edge-edit overlay depends on:
 *
 *  1. EdgeContextPanel does NOT render when no edge is selected (the panel
 *     auto-closes when the selection set is empty).
 *  2. Selecting one or more edges auto-opens the panel — no second click
 *     required. The sibling overlay marker (data-testid="edge-context-panel-
 *     overlay") tracks the mount lifecycle independent of the panel's
 *     internal markup.
 *  3. Clicking "Apply Fillet" with a valid radius dispatches the fillet
 *     handler (which the production wiring forwards to filletFeature.apply
 *     and onGeometryApply).
 *  4. Clicking "Apply Chamfer" dispatches the chamfer handler.
 *  5. Closing the panel clears the edge selection (panel auto-closes).
 *
 * The full ShapeGeneratorInner + ShapePreview pull in Three.js, R3F, OCCT,
 * three-bvh-csg and a dozen contexts — impractical in jsdom. Instead this
 * mirrors the actual wiring (selectedEdgesForPanel state in ShapePreview at
 * lines 1691-1702 and the conditional EdgeContextPanel mount at lines
 * 2199-2225). If EdgeContextPanel changes its prop contract or rendering,
 * this catches it before the host breaks.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';
import * as THREE from 'three';
import EdgeContextPanel from '@/app/[lang]/shape-generator/editing/EdgeContextPanel';
import type { UniqueEdge } from '@/app/[lang]/shape-generator/editing/types';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/nexyfab/shape',
}));

/** Tiny indexed cube geometry — enough vertices to clear the panel's
 *  "insufficient geometry" gate (vertexCount >= 4). */
function makeCubeGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(10, 10, 10);
  // BoxGeometry is already indexed and has plenty of vertices.
  return g;
}

function mkEdge(id: number, midpoint: [number, number, number] = [0, 0, 0]): UniqueEdge {
  return { id, vertexA: id * 2, vertexB: id * 2 + 1, midpoint };
}

/**
 * Minimal harness mirroring ShapePreview's edge-context wiring:
 *  - `selectedEdges` state (matches selectedEdgesForPanel)
 *  - select-button that adds an edge → auto-opens panel
 *  - conditional EdgeContextPanel mount + sibling overlay marker
 *  - fillet/chamfer/close handlers forward to spies the test inspects
 *
 * Keep in sync with ShapePreview.tsx around lines 2198-2330.
 */
function HostHarness({
  onFillet,
  onChamfer,
}: {
  onFillet?: (radius: number, segments: number, edgeCount: number) => void;
  onChamfer?: (distance: number, edgeCount: number) => void;
}) {
  const [selectedEdges, setSelectedEdges] = useState<UniqueEdge[]>([]);
  const geometry = React.useMemo(() => makeCubeGeometry(), []);
  return (
    <div>
      <button
        data-testid="select-edge-button"
        onClick={() => setSelectedEdges([mkEdge(1, [5, 0, 0])])}
      >
        Select Edge
      </button>
      {selectedEdges.length > 0 && (
        <>
          <span
            data-testid="edge-context-panel-overlay"
            style={{ display: 'none' }}
            aria-hidden="true"
          />
          <EdgeContextPanel
            selectedEdges={selectedEdges}
            geometry={geometry}
            lang="en"
            onApplyFillet={(radius, segments) => {
              onFillet?.(radius, segments, selectedEdges.length);
              setSelectedEdges([]);
            }}
            onApplyChamfer={(distance) => {
              onChamfer?.(distance, selectedEdges.length);
              setSelectedEdges([]);
            }}
            onClose={() => setSelectedEdges([])}
            onClearSelection={() => setSelectedEdges([])}
          />
        </>
      )}
    </div>
  );
}

describe('EdgeContextPanel viewport wiring', () => {
  it('does not render when no edge is selected (default state)', () => {
    render(<HostHarness />);
    expect(screen.queryByTestId('edge-context-panel-overlay')).toBeNull();
    expect(screen.queryByText('Edge Edit')).toBeNull();
  });

  it('auto-opens the panel when an edge becomes selected', () => {
    render(<HostHarness />);
    fireEvent.click(screen.getByTestId('select-edge-button'));
    expect(screen.getByTestId('edge-context-panel-overlay')).toBeInTheDocument();
    // EdgeContextPanel renders its "Edge Edit" header — confirms the real
    // panel mounted, not just the marker.
    expect(screen.getByText('Edge Edit')).toBeInTheDocument();
  });

  it('dispatches the fillet handler with the panel default radius (3) when Apply Fillet is clicked', () => {
    const onFillet = vi.fn();
    render(<HostHarness onFillet={onFillet} />);
    fireEvent.click(screen.getByTestId('select-edge-button'));
    fireEvent.click(screen.getByText('Apply Fillet'));

    expect(onFillet).toHaveBeenCalledTimes(1);
    const [radius, segments, edgeCount] = onFillet.mock.calls[0] as [number, number, number];
    // EdgeContextPanel defaults: filletRadius=3, filletSegments=3
    expect(radius).toBe(3);
    expect(segments).toBe(3);
    expect(edgeCount).toBe(1);
    // Closing the selection on apply auto-collapses the panel.
    expect(screen.queryByTestId('edge-context-panel-overlay')).toBeNull();
  });

  it('dispatches the chamfer handler with the panel default distance (2) when Apply Chamfer is clicked', () => {
    const onChamfer = vi.fn();
    render(<HostHarness onChamfer={onChamfer} />);
    fireEvent.click(screen.getByTestId('select-edge-button'));
    fireEvent.click(screen.getByText('Apply Chamfer'));

    expect(onChamfer).toHaveBeenCalledTimes(1);
    const [distance, edgeCount] = onChamfer.mock.calls[0] as [number, number];
    // EdgeContextPanel default: chamferDist=2
    expect(distance).toBe(2);
    expect(edgeCount).toBe(1);
    expect(screen.queryByTestId('edge-context-panel-overlay')).toBeNull();
  });

  it('closing the panel (× button) clears the edge selection and unmounts the overlay', () => {
    render(<HostHarness />);
    fireEvent.click(screen.getByTestId('select-edge-button'));
    expect(screen.getByTestId('edge-context-panel-overlay')).toBeInTheDocument();

    // EdgeContextPanel's close button is the "×" with title="Close".
    fireEvent.click(screen.getByTitle('Close'));
    expect(screen.queryByTestId('edge-context-panel-overlay')).toBeNull();
    expect(screen.queryByText('Edge Edit')).toBeNull();
  });
});
