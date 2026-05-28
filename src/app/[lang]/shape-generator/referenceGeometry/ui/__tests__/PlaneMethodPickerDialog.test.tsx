// @vitest-environment jsdom
/**
 * PlaneMethodPickerDialog.test.tsx — render + onConfirm payload smoke.
 *
 * The dialog is heavy on per-method form state; the regression we care
 * most about is the `buildParams()` switch returning the *right* shape
 * for each method (the discriminated union is wide and easy to break
 * silently on copy-paste). We click through three methods and assert
 * the emitted `ReferencePlaneNode`:
 *
 *   1. `standard` — emits `{ method: 'standard', id: <pick> }`
 *   2. `offset` — emits `{ method: 'offset', parent, distanceMm, direction }`
 *   3. `through3Points` — emits `{ method, points: [...] }`
 *
 * We also smoke-import the other three method-picker dialogs to make
 * sure their modules don't blow up at import time (sanity check on the
 * mirror copies of the Plane dialog).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlaneMethodPickerDialog from '../PlaneMethodPickerDialog';

// Smoke-import siblings so the test file fails if any dialog has a
// module-level syntax error or a bad import. (No render needed — the
// import itself is the assertion.)
import AxisMethodPickerDialog from '../AxisMethodPickerDialog';
import PointMethodPickerDialog from '../PointMethodPickerDialog';
import CsysMethodPickerDialog from '../CsysMethodPickerDialog';

describe('PlaneMethodPickerDialog — smoke imports', () => {
  it('all four method-picker dialogs import as React components', () => {
    expect(typeof PlaneMethodPickerDialog).toBe('function');
    expect(typeof AxisMethodPickerDialog).toBe('function');
    expect(typeof PointMethodPickerDialog).toBe('function');
    expect(typeof CsysMethodPickerDialog).toBe('function');
  });
});

describe('PlaneMethodPickerDialog — render', () => {
  it('renders the dialog with default Standard method selected', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<PlaneMethodPickerDialog onConfirm={onConfirm} onClose={onClose} />);
    expect(screen.getByText('New Reference Plane')).toBeInTheDocument();
    // Standard select should be in the params area.
    expect(screen.getByTestId('plane-standard-select')).toBeInTheDocument();
  });

  it('emits a standard-method node on confirm', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<PlaneMethodPickerDialog onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('method-picker-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const node = onConfirm.mock.calls[0][0];
    expect(node.kind).toBe('plane');
    expect(node.method).toBe('standard');
    expect(node.params).toEqual({ method: 'standard', id: 'front' });
    expect(node.dependsOn).toEqual([]);
  });

  it('emits an offset-method node when switched and confirmed', () => {
    const onConfirm = vi.fn();
    render(
      <PlaneMethodPickerDialog
        initialMethod="offset"
        onConfirm={onConfirm}
        onClose={() => undefined}
      />,
    );
    // Change distance to 25mm and confirm.
    fireEvent.change(screen.getByTestId('plane-offset-distance'), {
      target: { value: '25' },
    });
    fireEvent.click(screen.getByTestId('method-picker-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const node = onConfirm.mock.calls[0][0];
    expect(node.method).toBe('offset');
    expect(node.params).toMatchObject({
      method: 'offset',
      distanceMm: 25,
      direction: 1,
      parent: { kind: 'standard', id: 'front' },
    });
  });

  it('emits a through3Points-method node with three point refs', () => {
    const onConfirm = vi.fn();
    render(
      <PlaneMethodPickerDialog
        initialMethod="through3Points"
        onConfirm={onConfirm}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId('method-picker-confirm'));
    const node = onConfirm.mock.calls[0][0];
    expect(node.method).toBe('through3Points');
    expect(node.params.method).toBe('through3Points');
    expect(node.params.points).toHaveLength(3);
  });

  it('disables Insert when offset distance is zero', () => {
    const onConfirm = vi.fn();
    render(
      <PlaneMethodPickerDialog
        initialMethod="offset"
        onConfirm={onConfirm}
        onClose={() => undefined}
      />,
    );
    fireEvent.change(screen.getByTestId('plane-offset-distance'), {
      target: { value: '0' },
    });
    const btn = screen.getByTestId('method-picker-confirm') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('Cancel button fires onClose', () => {
    const onClose = vi.fn();
    render(
      <PlaneMethodPickerDialog onConfirm={() => undefined} onClose={onClose} />,
    );
    fireEvent.click(screen.getByTestId('method-picker-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
