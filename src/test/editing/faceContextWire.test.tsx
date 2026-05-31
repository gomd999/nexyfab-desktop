/** @vitest-environment jsdom */
/**
 * FaceContextPanel viewport wiring regression.
 *
 * Pins the contracts the host's face-edit overlay depends on:
 *
 *  1. FaceContextPanel does NOT render when no face is selected (sibling
 *     overlay marker absent → panel never mounted).
 *  2. Selecting a face mounts the panel automatically — no second click
 *     required. The sibling marker (data-testid="face-context-panel-overlay")
 *     tracks the mount lifecycle independent of the panel's internal markup.
 *  3. Clicking "Apply Offset" dispatches the offset handler with the panel's
 *     default distance (2 mm), which production wiring forwards to
 *     `offsetFace` + `onGeometryApply`.
 *  4. Clicking "Apply Shell" dispatches the shell handler with default
 *     thickness (2 mm) and the chosen open-face index.
 *  5. Closing the panel clears the face selection and unmounts the overlay.
 *
 * The full ShapePreview + R3F + OCCT stack is impractical in jsdom. This
 * harness mirrors the actual wiring (see ShapePreview.tsx selectedFaceForPanel
 * state and the conditional FaceContextPanel mount). If FaceContextPanel
 * changes its prop contract or rendering, this catches it before the host
 * breaks.
 *
 * Mirrors src/test/editing/edgeContextWire.test.tsx structure exactly.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';
import * as THREE from 'three';
import FaceContextPanel from '@/app/[lang]/shape-generator/editing/FaceContextPanel';
import type { UniqueFace } from '@/app/[lang]/shape-generator/editing/useFaceEditing';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/nexyfab/shape',
}));

/** Tiny non-indexed cube — enough vertices to clear the panel's
 *  "insufficient geometry" gate (vertexCount >= 4). */
function makeCubeGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
}

function mkFace(id: number, normal: [number, number, number] = [0, 1, 0]): UniqueFace {
  return {
    id,
    triangleIndices: [0, 1],
    normal,
    center: [0, 5, 0],
  };
}

/**
 * Minimal harness mirroring ShapePreview's face-context wiring:
 *  - `selectedFace` state (matches selectedFaceForPanel)
 *  - select-button that sets the selection → auto-mounts panel
 *  - sibling overlay marker for lifecycle tracking
 *  - offset/shell/close handlers forward to spies the test inspects
 *
 * Keep in sync with ShapePreview.tsx around the FaceContextPanel mount
 * (~line 2370 after the EdgeContextPanel block).
 */
function HostHarness({
  onOffset,
  onShell,
}: {
  onOffset?: (distance: number) => void;
  onShell?: (thickness: number, openFace: 0 | 1 | 2) => void;
}) {
  const [selectedFace, setSelectedFace] = useState<UniqueFace | null>(null);
  const geometry = React.useMemo(() => makeCubeGeometry(), []);
  return (
    <div>
      <button
        data-testid="select-face-button"
        onClick={() => setSelectedFace(mkFace(1, [0, 1, 0]))}
      >
        Select Face
      </button>
      {selectedFace && (
        <>
          <span
            data-testid="face-context-panel-overlay"
            style={{ display: 'none' }}
            aria-hidden="true"
          />
          <FaceContextPanel
            selectedFace={selectedFace}
            geometry={geometry}
            lang="en"
            onApplyOffset={(distance) => {
              onOffset?.(distance);
              setSelectedFace(null);
            }}
            onApplyShell={(thickness, openFace) => {
              onShell?.(thickness, openFace);
              setSelectedFace(null);
            }}
            onClose={() => setSelectedFace(null)}
          />
        </>
      )}
    </div>
  );
}

describe('FaceContextPanel viewport wiring', () => {
  it('does not render when no face is selected (default state)', () => {
    render(<HostHarness />);
    expect(screen.queryByTestId('face-context-panel-overlay')).toBeNull();
    expect(screen.queryByTestId('face-context-panel')).toBeNull();
  });

  it('auto-mounts the panel when a face becomes selected', () => {
    render(<HostHarness />);
    fireEvent.click(screen.getByTestId('select-face-button'));
    expect(screen.getByTestId('face-context-panel-overlay')).toBeInTheDocument();
    // FaceContextPanel renders its outer container — confirms the real
    // panel mounted, not just the marker.
    expect(screen.getByTestId('face-context-panel')).toBeInTheDocument();
    // "Face Edit" header text (en dict) is rendered too.
    expect(screen.getByText('Face Edit')).toBeInTheDocument();
  });

  it('dispatches the offset handler with the default distance (2mm) when Apply Offset is clicked', () => {
    const onOffset = vi.fn();
    render(<HostHarness onOffset={onOffset} />);
    fireEvent.click(screen.getByTestId('select-face-button'));
    fireEvent.click(screen.getByTestId('apply-face-offset-button'));

    expect(onOffset).toHaveBeenCalledTimes(1);
    const [distance] = onOffset.mock.calls[0] as [number];
    // FaceContextPanel defaults: offsetDist = 2
    expect(distance).toBe(2);
    // Apply auto-collapses the panel via the host's setSelectedFace(null).
    expect(screen.queryByTestId('face-context-panel-overlay')).toBeNull();
  });

  it('dispatches the shell handler with the default thickness (2mm) and closed open-face when Apply Shell is clicked', () => {
    const onShell = vi.fn();
    render(<HostHarness onShell={onShell} />);
    fireEvent.click(screen.getByTestId('select-face-button'));
    fireEvent.click(screen.getByTestId('apply-shell-button'));

    expect(onShell).toHaveBeenCalledTimes(1);
    const [thickness, openFace] = onShell.mock.calls[0] as [number, 0 | 1 | 2];
    // FaceContextPanel defaults: shellThickness = 2, openFace = 0 (closed)
    expect(thickness).toBe(2);
    expect(openFace).toBe(0);
    expect(screen.queryByTestId('face-context-panel-overlay')).toBeNull();
  });

  it('respects the user-chosen open-face button when dispatching shell', () => {
    const onShell = vi.fn();
    render(<HostHarness onShell={onShell} />);
    fireEvent.click(screen.getByTestId('select-face-button'));
    // Click "Top (+Y)" — open-face value 1
    fireEvent.click(screen.getByTestId('shell-open-face-1'));
    fireEvent.click(screen.getByTestId('apply-shell-button'));

    expect(onShell).toHaveBeenCalledTimes(1);
    const [, openFace] = onShell.mock.calls[0] as [number, 0 | 1 | 2];
    expect(openFace).toBe(1);
  });

  it('closing the panel (× button) clears the face selection and unmounts the overlay', () => {
    render(<HostHarness />);
    fireEvent.click(screen.getByTestId('select-face-button'));
    expect(screen.getByTestId('face-context-panel-overlay')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('face-context-panel-close'));
    expect(screen.queryByTestId('face-context-panel-overlay')).toBeNull();
    expect(screen.queryByTestId('face-context-panel')).toBeNull();
  });
});
