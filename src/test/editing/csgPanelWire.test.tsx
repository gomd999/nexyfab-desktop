/** @vitest-environment jsdom */
/**
 * CSGPanel wiring regression.
 *
 * Pins three contracts the host's "⊕ Boolean" toolbar button depends on:
 *
 *  1. CSGPanel does NOT render when the host hasn't requested it (default state).
 *  2. The toolbar-button → setShowCSGPanel pattern surfaces the panel marker
 *     (data-testid="csg-panel-overlay"), and the CSGPanel itself renders.
 *  3. Re-clicking the toolbar button closes the overlay (toggle semantics —
 *     fixes the prior open-only behaviour where the button could only show the
 *     panel, never hide it).
 *  4. Clicking the panel's Apply button forwards the operation + tool params
 *     through to the host's onApply callback (which in production wraps
 *     applyCSG()).
 *
 * The full ShapeGeneratorInner host is 10K+ LoC and pulls in three-bvh-csg,
 * Three.js, dynamic next/dynamic imports and a dozen contexts — mounting it
 * in jsdom is impractical and brittle. Instead we reproduce the exact wiring
 * shape the host uses: a `showCSGPanel` state, a toggle button, and a
 * conditionally-rendered CSGPanel + overlay marker. If CSGPanel changes its
 * props or rendering contract this test will catch it before the host breaks.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';
import CSGPanel from '@/app/[lang]/shape-generator/editing/CSGPanel';
import type { CSGOperation, CSGToolParams } from '@/app/[lang]/shape-generator/editing/CSGOperations';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/nexyfab/shape',
}));

/**
 * Minimal host harness mirroring the ShapeGeneratorInner toolbar + overlay
 * mount pattern. Keep this in sync with the actual host wiring around
 * ShapeGeneratorInner.tsx lines 8076-8104 (toolbar button) and 7644-7666
 * (BodyCsgDock + overlay marker).
 */
function HostHarness({ onApply }: { onApply?: (op: CSGOperation, p: CSGToolParams) => void }) {
  const [showCSGPanel, setShowCSGPanel] = useState(false);
  return (
    <div>
      <button
        data-testid="toolbar-boolean-button"
        onClick={() => setShowCSGPanel((v) => !v)}
      >
        Boolean
      </button>
      {showCSGPanel && (
        <span data-testid="csg-panel-overlay" style={{ display: 'none' }} aria-hidden="true" />
      )}
      {showCSGPanel && (
        <CSGPanel
          lang="en"
          onApply={(op, params) => {
            onApply?.(op, params);
            setShowCSGPanel(false);
          }}
          onClose={() => setShowCSGPanel(false)}
        />
      )}
    </div>
  );
}

describe('CSGPanel wiring (toolbar → overlay → applyCSG)', () => {
  it('does not render the panel overlay when showCSGPanel is false (default host state)', () => {
    render(<HostHarness />);
    expect(screen.queryByTestId('csg-panel-overlay')).toBeNull();
    expect(screen.queryByText(/Boolean Operations/i)).toBeNull();
  });

  it('opens the panel overlay when the Boolean toolbar button is clicked', () => {
    render(<HostHarness />);
    fireEvent.click(screen.getByTestId('toolbar-boolean-button'));
    expect(screen.getByTestId('csg-panel-overlay')).toBeInTheDocument();
    // CSGPanel renders its header — verifies the dynamic component mounted, not just the marker.
    expect(screen.getByText(/Boolean Operations/i)).toBeInTheDocument();
  });

  it('toggles closed when the Boolean toolbar button is re-clicked while open', () => {
    render(<HostHarness />);
    const btn = screen.getByTestId('toolbar-boolean-button');
    fireEvent.click(btn);
    expect(screen.getByTestId('csg-panel-overlay')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByTestId('csg-panel-overlay')).toBeNull();
    expect(screen.queryByText(/Boolean Operations/i)).toBeNull();
  });

  it('forwards op + tool params to onApply and closes the overlay when the panel Apply is clicked', () => {
    const onApply = vi.fn();
    render(<HostHarness onApply={onApply} />);
    fireEvent.click(screen.getByTestId('toolbar-boolean-button'));
    expect(screen.getByTestId('csg-panel-overlay')).toBeInTheDocument();

    // CSGPanel's primary action button is labelled "Apply" in the en dict.
    fireEvent.click(screen.getByText('Apply'));

    expect(onApply).toHaveBeenCalledTimes(1);
    const [op, params] = onApply.mock.calls[0] as [CSGOperation, CSGToolParams];
    // Defaults inside CSGPanel: subtract / box / 30x30x30 / no offset.
    expect(op).toBe('subtract');
    expect(params.shape).toBe('box');
    expect(typeof params.width).toBe('number');
    expect(typeof params.height).toBe('number');
    expect(typeof params.depth).toBe('number');

    // Apply must close the overlay (mirroring host's setShowCSGPanel(false) in handleCSGApply).
    expect(screen.queryByTestId('csg-panel-overlay')).toBeNull();
  });
});
