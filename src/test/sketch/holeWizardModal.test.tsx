/** @vitest-environment jsdom */
/**
 * HoleWizardModal — standalone modal tests (Phase 2.7 holes).
 *
 * Renders the modal directly and mocks the holeFetcher; does NOT spin up
 * SolverSketchEditor.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import HoleWizardModal from '@/app/[lang]/shape-generator/sketch/HoleWizardModal';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';

function rectWithCenter(): SolverViewState {
  return {
    points: [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 20, y: 0 },
      { id: 'p3', x: 20, y: 10 },
      { id: 'p4', x: 0, y: 10 },
      { id: 'h1', x: 5, y: 5 },
      { id: 'h2', x: 15, y: 5 },
    ],
    lines: [
      { id: 'l1', p1: 'p1', p2: 'p2' },
      { id: 'l2', p1: 'p2', p2: 'p3' },
      { id: 'l3', p1: 'p3', p2: 'p4' },
      { id: 'l4', p1: 'p4', p2: 'p1' },
    ],
  };
}

describe('HoleWizardModal', () => {
  it('renders modal with default row + extrudeDepth input + buttons', () => {
    render(
      <HoleWizardModal
        lang="en"
        sketch={rectWithCenter()}
        onClose={vi.fn()}
        holeFetcher={vi.fn()}
      />,
    );
    expect(screen.getByTestId('solver-hole-modal')).toBeInTheDocument();
    expect(screen.getByTestId('solver-hole-extrude-depth-input')).toBeInTheDocument();
    // Default 1 row (index 0) and no row 1.
    expect(screen.getByTestId('solver-hole-row-0-point-select')).toBeInTheDocument();
    expect(screen.getByTestId('solver-hole-row-0-type-select')).toBeInTheDocument();
    expect(screen.getByTestId('solver-hole-row-0-diameter-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-hole-row-0-depth-input')).toBeInTheDocument();
    expect(screen.queryByTestId('solver-hole-row-1-point-select')).not.toBeInTheDocument();
    expect(screen.getByTestId('solver-hole-add')).toBeInTheDocument();
    expect(screen.getByTestId('solver-hole-submit')).toBeInTheDocument();
    expect(screen.getByTestId('solver-hole-cancel')).toBeInTheDocument();
  });

  it('cancel button invokes onClose', () => {
    const onClose = vi.fn();
    render(
      <HoleWizardModal lang="en" sketch={rectWithCenter()} onClose={onClose} holeFetcher={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-hole-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('add-hole appends a new row; remove shrinks back', () => {
    render(
      <HoleWizardModal lang="en" sketch={rectWithCenter()} onClose={vi.fn()} holeFetcher={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-hole-add'));
    expect(screen.getByTestId('solver-hole-row-1-point-select')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('solver-hole-row-1-remove'));
    expect(screen.queryByTestId('solver-hole-row-1-point-select')).not.toBeInTheDocument();
  });

  it('remove-hole is disabled when only 1 row remains', () => {
    render(
      <HoleWizardModal lang="en" sketch={rectWithCenter()} onClose={vi.fn()} holeFetcher={vi.fn()} />,
    );
    const remove0 = screen.getByTestId('solver-hole-row-0-remove') as HTMLButtonElement;
    expect(remove0.disabled).toBe(true);
  });

  it('hole-type switch reveals/hides type-specific inputs', () => {
    render(
      <HoleWizardModal lang="en" sketch={rectWithCenter()} onClose={vi.fn()} holeFetcher={vi.fn()} />,
    );
    // Initially drilled — no cbore/csink inputs.
    expect(screen.queryByTestId('solver-hole-row-0-cbore-diameter-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('solver-hole-row-0-csink-angle-input')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('solver-hole-row-0-type-select'), {
      target: { value: 'counterbore' },
    });
    expect(screen.getByTestId('solver-hole-row-0-cbore-diameter-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-hole-row-0-cbore-depth-input')).toBeInTheDocument();
    expect(screen.queryByTestId('solver-hole-row-0-csink-angle-input')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('solver-hole-row-0-type-select'), {
      target: { value: 'countersink' },
    });
    expect(screen.getByTestId('solver-hole-row-0-csink-angle-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-hole-row-0-csink-depth-input')).toBeInTheDocument();
    expect(screen.queryByTestId('solver-hole-row-0-cbore-diameter-input')).not.toBeInTheDocument();
  });

  it('standard dropdown auto-fills diameter from tap-drill table (M5 → 4.2)', () => {
    render(
      <HoleWizardModal lang="en" sketch={rectWithCenter()} onClose={vi.fn()} holeFetcher={vi.fn()} />,
    );
    fireEvent.change(screen.getByTestId('solver-hole-row-0-standard-select'), {
      target: { value: 'M5' },
    });
    const dia = screen.getByTestId('solver-hole-row-0-diameter-input') as HTMLInputElement;
    expect(dia.value).toBe('4.2');
  });

  it('standard dropdown offers M3..M12 + UNC specs', () => {
    render(
      <HoleWizardModal lang="en" sketch={rectWithCenter()} onClose={vi.fn()} holeFetcher={vi.fn()} />,
    );
    const select = screen.getByTestId('solver-hole-row-0-standard-select') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain('M3');
    expect(optionValues).toContain('M10');
    expect(optionValues).toContain('1/4-20');
  });

  it('submit fires holeFetcher with parsed body (sketch + extrudeDepth + holes)', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'difference() { /* ... */ }',
      pngs: [],
      holeCount: 1,
    });
    render(
      <HoleWizardModal
        lang="en"
        sketch={rectWithCenter()}
        defaultExtrudeDepth={15}
        onClose={vi.fn()}
        holeFetcher={fetcher}
      />,
    );
    fireEvent.change(screen.getByTestId('solver-hole-row-0-point-select'), {
      target: { value: 'h2' },
    });
    fireEvent.change(screen.getByTestId('solver-hole-row-0-diameter-input'), {
      target: { value: '6.5' },
    });
    fireEvent.click(screen.getByTestId('solver-hole-submit'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const call = fetcher.mock.calls[0]![0]!;
    expect(call.extrudeDepth).toBe(15);
    expect(call.holes.length).toBe(1);
    expect(call.holes[0].pointId).toBe('h2');
    expect(call.holes[0].diameter).toBe(6.5);
    expect(call.holes[0].holeType).toBe('drilled');
    expect(call.includeStl).toBe(true);
  });

  it('client-side validation rejects non-positive diameter before fetch', async () => {
    const fetcher = vi.fn();
    render(
      <HoleWizardModal lang="en" sketch={rectWithCenter()} onClose={vi.fn()} holeFetcher={fetcher} />,
    );
    fireEvent.change(screen.getByTestId('solver-hole-row-0-diameter-input'), {
      target: { value: '-1' },
    });
    fireEvent.click(screen.getByTestId('solver-hole-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('solver-hole-error')).toBeInTheDocument();
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('success response renders SCAD preview', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'difference() { cube([20,10,5]); cylinder(d=4, h=5); }',
      pngs: [],
    });
    render(
      <HoleWizardModal lang="en" sketch={rectWithCenter()} onClose={vi.fn()} holeFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-hole-submit'));
    await waitFor(() => {
      const pre = screen.getByTestId('solver-hole-scad-preview');
      expect(pre.textContent).toContain('difference');
    });
  });

  it('error response surfaces the error message', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      code: 'PIPELINE_ERROR',
      message: 'no closed loop found',
    });
    render(
      <HoleWizardModal lang="en" sketch={rectWithCenter()} onClose={vi.fn()} holeFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-hole-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-hole-error');
      expect(err.textContent).toMatch(/closed loop/);
    });
  });

  it('renders PNG previews from base64', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'difference() {}',
      pngs: [
        { label: 'iso', base64: 'iVBORw0KGgo=' },
        { label: 'front', base64: 'iVBORw0KGgo=' },
      ],
    });
    render(
      <HoleWizardModal lang="en" sketch={rectWithCenter()} onClose={vi.fn()} holeFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-hole-submit'));
    await waitFor(() => {
      const img0 = screen.getByTestId('solver-hole-png-preview-0') as HTMLImageElement;
      expect(img0.src).toContain('data:image/png;base64,iVBORw0KGgo=');
      const img1 = screen.getByTestId('solver-hole-png-preview-1') as HTMLImageElement;
      expect(img1.src).toContain('data:image/png;base64,iVBORw0KGgo=');
    });
  });

  it('Korean lang shows 구멍 (hole) and 표준 적용 (use standard)', () => {
    render(
      <HoleWizardModal lang="ko" sketch={rectWithCenter()} onClose={vi.fn()} holeFetcher={vi.fn()} />,
    );
    const submit = screen.getByTestId('solver-hole-submit');
    expect(submit.textContent).toMatch(/구멍/);
    expect(screen.getByText(/표준/)).toBeInTheDocument();
  });
});
