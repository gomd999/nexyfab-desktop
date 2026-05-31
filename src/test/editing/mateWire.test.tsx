/** @vitest-environment jsdom */
/**
 * MatePickerOverlay viewport wiring regression.
 *
 * Pins the contracts the host's click-to-mate flow depends on:
 *
 *  1. Overlay does NOT render when there is no pending mate (default state),
 *     i.e. 0 faces picked AND 1 face picked (mateFaceA armed but second
 *     face not yet chosen) — the picker is gated entirely on `pendingMate`,
 *     not on `mateFaceA`.
 *  2. Overlay renders (and the data-testid="mate-picker-overlay" marker
 *     mounts) the moment two faces on different parts are paired into a
 *     `pendingMate`.
 *  3. Each mate-type button (coincident/concentric/distance/parallel) is
 *     individually clickable and selectable; the Apply button fires
 *     onApply with the chosen type.
 *  4. Cancel button fires onCancel and unmounts the picker (overlay marker
 *     disappears).
 *  5. Apply round-trips through the host's onApply with the suggested
 *     default when the user clicks Apply without picking a different type.
 *
 * Mirrors the host wiring in ShapeGeneratorInner.tsx around the
 * MatePickerOverlay mount and useCanvasSelectionHandlers.commitPendingMate
 * — if MatePickerOverlay changes its prop contract or rendering, this
 * catches it before the host breaks.
 *
 * Per the established pattern (csgPanelWire, edgeContextWire) the full
 * 10K-line host is impractical in jsdom — instead we reproduce the exact
 * wiring shape: a `pendingMate` state, conditional mount, apply / cancel
 * forwarders.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';
import MatePickerOverlay from '@/app/[lang]/shape-generator/editing/MatePickerOverlay';
import type { PendingMate, ClickMateType } from '@/app/[lang]/shape-generator/store/selectionStore';
import type { FaceSelectionInfo } from '@/app/[lang]/shape-generator/editing/selectionInfo';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/nexyfab/shape',
}));

function mkFace(partName: string, triIdx: number, normal: [number, number, number] = [0, 0, 1]): FaceSelectionInfo {
  return {
    type: 'face',
    partName,
    triangleIndices: [triIdx],
    triangleCount: 1,
    area: 100,
    normal,
    normalLabel: '+Z',
    position: [0, 0, 0],
  } as FaceSelectionInfo;
}

function mkPending(suggestedType: ClickMateType = 'coincident', parallelHint = false): PendingMate {
  return {
    faceA: mkFace('partA', 1),
    faceB: mkFace('partB', 2),
    suggestedType,
    parallelHint,
  };
}

const LABELS = {
  title: 'Choose Mate Type',
  apply: 'Apply',
  cancel: 'Cancel',
  suggested: 'Suggested',
  flipHint: 'Both faces point the same way',
  type: {
    coincident: 'Coincident',
    concentric: 'Concentric',
    distance: 'Distance',
    parallel: 'Parallel',
  },
} as const;

/**
 * Minimal harness mirroring the ShapeGeneratorInner wiring around the
 * MatePickerOverlay mount + useCanvasSelectionHandlers.commitPendingMate.
 * Keep in sync with ShapeGeneratorInner.tsx around the overlay mount and
 * useCanvasSelectionHandlers.ts commitPendingMate/cancelPendingMate.
 */
function HostHarness({
  initialPending = null,
  onApply,
  onCancel,
}: {
  initialPending?: PendingMate | null;
  onApply?: (type: ClickMateType) => void;
  onCancel?: () => void;
}) {
  const [pending, setPending] = useState<PendingMate | null>(initialPending);
  // mateFaceA simulates the "armed but no second pick yet" state — the
  // picker is gated on pendingMate, so this should NOT show the picker.
  const [armed, setArmed] = useState(false);
  return (
    <div>
      <button data-testid="arm-mate-button" onClick={() => setArmed(true)}>
        Arm Mate
      </button>
      <button
        data-testid="pair-faces-button"
        onClick={() => {
          setArmed(false);
          setPending(mkPending('coincident', false));
        }}
      >
        Pair Faces
      </button>
      <button
        data-testid="pair-faces-concentric-button"
        onClick={() => {
          setArmed(false);
          setPending(mkPending('concentric', false));
        }}
      >
        Pair Faces (Concentric)
      </button>
      <span data-testid="armed-state">{armed ? 'armed' : 'idle'}</span>
      <MatePickerOverlay
        pending={pending}
        labels={LABELS}
        onApply={(type) => {
          onApply?.(type);
          setPending(null);
        }}
        onCancel={() => {
          onCancel?.();
          setPending(null);
        }}
      />
    </div>
  );
}

describe('MatePickerOverlay viewport wiring (click-to-mate)', () => {
  it('does not render with 0 faces paired (default state)', () => {
    render(<HostHarness />);
    expect(screen.queryByTestId('mate-picker-overlay')).toBeNull();
  });

  it('does not render with 1 face armed (mateFaceA set, no pendingMate yet)', () => {
    render(<HostHarness />);
    fireEvent.click(screen.getByTestId('arm-mate-button'));
    // Sanity check: we are in the "armed" intermediate state.
    expect(screen.getByTestId('armed-state').textContent).toBe('armed');
    // But the picker must stay hidden until pendingMate is set.
    expect(screen.queryByTestId('mate-picker-overlay')).toBeNull();
  });

  it('renders the picker when 2 faces on different parts are paired', () => {
    render(<HostHarness />);
    fireEvent.click(screen.getByTestId('pair-faces-button'));
    expect(screen.getByTestId('mate-picker-overlay')).toBeInTheDocument();
    // All four mate-type buttons mount.
    expect(screen.getByTestId('mate-type-coincident')).toBeInTheDocument();
    expect(screen.getByTestId('mate-type-concentric')).toBeInTheDocument();
    expect(screen.getByTestId('mate-type-distance')).toBeInTheDocument();
    expect(screen.getByTestId('mate-type-parallel')).toBeInTheDocument();
    // Apply + Cancel buttons mount.
    expect(screen.getByTestId('mate-apply-button')).toBeInTheDocument();
    expect(screen.getByTestId('mate-cancel-button')).toBeInTheDocument();
  });

  it('fires onApply with the user-chosen type and unmounts the picker', () => {
    const onApply = vi.fn();
    render(<HostHarness onApply={onApply} />);
    fireEvent.click(screen.getByTestId('pair-faces-button')); // suggests coincident
    // User overrides to concentric, then clicks Apply.
    fireEvent.click(screen.getByTestId('mate-type-concentric'));
    fireEvent.click(screen.getByTestId('mate-apply-button'));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith('concentric');
    // Picker auto-collapses on apply.
    expect(screen.queryByTestId('mate-picker-overlay')).toBeNull();
  });

  it('fires onCancel and clears the pending mate when Cancel is clicked', () => {
    const onCancel = vi.fn();
    render(<HostHarness onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('pair-faces-button'));
    expect(screen.getByTestId('mate-picker-overlay')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mate-cancel-button'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('mate-picker-overlay')).toBeNull();
  });

  it('Apply with no user override commits the heuristic-suggested type (round-trip)', () => {
    const onApply = vi.fn();
    render(<HostHarness onApply={onApply} />);
    // Concentric suggestion path (cylinder caps).
    fireEvent.click(screen.getByTestId('pair-faces-concentric-button'));
    // User clicks Apply WITHOUT overriding — should commit 'concentric'.
    fireEvent.click(screen.getByTestId('mate-apply-button'));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith('concentric');
  });
});
