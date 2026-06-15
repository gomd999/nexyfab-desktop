/** @vitest-environment jsdom */
/**
 * RevolveModal — standalone modal tests (Phase 2.A revolve).
 *
 * RevolveModal is a standalone component that takes the sketch state +
 * an optional axis hint as props. These tests render it directly and
 * mock the revolveFetcher; they do NOT spin up SolverSketchEditor.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import RevolveModal from '@/app/[lang]/shape-generator/sketch/RevolveModal';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';

function rectSketch(): SolverViewState {
  return {
    points: [
      { id: 'p1', x: 5, y: 0 },
      { id: 'p2', x: 20, y: 0 },
      { id: 'p3', x: 20, y: 10 },
      { id: 'p4', x: 5, y: 10 },
    ],
    lines: [
      { id: 'l1', p1: 'p1', p2: 'p2' },
      { id: 'l2', p1: 'p2', p2: 'p3' },
      { id: 'l3', p1: 'p3', p2: 'p4' },
      { id: 'l4', p1: 'p4', p2: 'p1' },
    ],
  };
}

describe('RevolveModal', () => {
  it('renders the modal with axis inputs + angle + mode + buttons', () => {
    render(
      <RevolveModal
        lang="en"
        sketch={rectSketch()}
        onClose={vi.fn()}
        revolveFetcher={vi.fn()}
      />,
    );
    expect(screen.getByTestId('solver-revolve-modal')).toBeInTheDocument();
    expect(screen.getByTestId('solver-revolve-axis-a-x-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-revolve-axis-a-y-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-revolve-axis-b-x-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-revolve-axis-b-y-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-revolve-angle-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-revolve-mode-select')).toBeInTheDocument();
    expect(screen.getByTestId('solver-revolve-submit')).toBeInTheDocument();
    expect(screen.getByTestId('solver-revolve-cancel')).toBeInTheDocument();
  });

  it('cancel button invokes onClose', () => {
    const onClose = vi.fn();
    render(
      <RevolveModal lang="en" sketch={rectSketch()} onClose={onClose} revolveFetcher={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-revolve-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the backdrop closes the modal', () => {
    const onClose = vi.fn();
    render(
      <RevolveModal lang="en" sketch={rectSketch()} onClose={onClose} revolveFetcher={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-revolve-modal'));
    expect(onClose).toHaveBeenCalled();
  });

  it('axis inputs accept numeric values', () => {
    render(
      <RevolveModal lang="en" sketch={rectSketch()} onClose={vi.fn()} revolveFetcher={vi.fn()} />,
    );
    const ax = screen.getByTestId('solver-revolve-axis-a-x-input') as HTMLInputElement;
    const by = screen.getByTestId('solver-revolve-axis-b-y-input') as HTMLInputElement;
    fireEvent.change(ax, { target: { value: '3' } });
    fireEvent.change(by, { target: { value: '7' } });
    expect(ax.value).toBe('3');
    expect(by.value).toBe('7');
  });

  it('"use selected line as axis" button populates inputs when axisHint is supplied', () => {
    render(
      <RevolveModal
        lang="en"
        sketch={rectSketch()}
        axisHint={{ a: { x: 1, y: 2 }, b: { x: 3, y: 4 } }}
        onClose={vi.fn()}
        revolveFetcher={vi.fn()}
      />,
    );
    const ax = screen.getByTestId('solver-revolve-axis-a-x-input') as HTMLInputElement;
    const ay = screen.getByTestId('solver-revolve-axis-a-y-input') as HTMLInputElement;
    // Hint is the initial default → already populated.
    expect(ax.value).toBe('1');
    expect(ay.value).toBe('2');
    // Mutate, then click "use hint" → should restore the hint.
    fireEvent.change(ax, { target: { value: '99' } });
    expect(ax.value).toBe('99');
    fireEvent.click(screen.getByTestId('solver-revolve-use-hint-button'));
    expect(ax.value).toBe('1');
  });

  it('"use hint" button is absent when no axisHint prop is supplied', () => {
    render(
      <RevolveModal lang="en" sketch={rectSketch()} onClose={vi.fn()} revolveFetcher={vi.fn()} />,
    );
    expect(screen.queryByTestId('solver-revolve-use-hint-button')).not.toBeInTheDocument();
  });

  it('submit fires revolveFetcher with axis + angle + mode + sketch', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'rotate_extrude() polygon(...);',
      pngs: [],
    });
    render(
      <RevolveModal lang="en" sketch={rectSketch()} onClose={vi.fn()} revolveFetcher={fetcher} />,
    );
    // Override axis to a known value.
    fireEvent.change(screen.getByTestId('solver-revolve-axis-a-x-input'), { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('solver-revolve-axis-a-y-input'), { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('solver-revolve-axis-b-x-input'), { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('solver-revolve-axis-b-y-input'), { target: { value: '5' } });
    fireEvent.change(screen.getByTestId('solver-revolve-angle-input'), { target: { value: '180' } });
    fireEvent.change(screen.getByTestId('solver-revolve-mode-select'), { target: { value: 'cut' } });

    fireEvent.click(screen.getByTestId('solver-revolve-submit'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const call = fetcher.mock.calls[0]![0]!;
    expect(call.axis).toEqual({ a: { x: 0, y: 0 }, b: { x: 0, y: 5 } });
    expect(call.angleDegrees).toBe(180);
    expect(call.mode).toBe('cut');
    expect(call.includeStl).toBe(true);
    expect(call.sketch.points.length).toBe(4);
  });

  it('success response renders the SCAD preview', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'rotate_extrude()\n  polygon([[5,0],[20,0],[20,10],[5,10]]);',
      pngs: [],
    });
    render(
      <RevolveModal lang="en" sketch={rectSketch()} onClose={vi.fn()} revolveFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-revolve-submit'));
    await waitFor(() => {
      const pre = screen.getByTestId('solver-revolve-scad-preview');
      expect(pre.textContent).toContain('rotate_extrude()');
    });
  });

  it('error response renders the error message', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      code: 'PIPELINE_ERROR',
      message: 'profile straddles the axis',
    });
    render(
      <RevolveModal lang="en" sketch={rectSketch()} onClose={vi.fn()} revolveFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-revolve-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-revolve-error');
      expect(err.textContent).toMatch(/straddles/);
    });
  });

  it('client-side coincident-axis check fires before the fetcher', async () => {
    const fetcher = vi.fn();
    render(
      <RevolveModal lang="en" sketch={rectSketch()} onClose={vi.fn()} revolveFetcher={fetcher} />,
    );
    // Force a=b on both axes.
    fireEvent.change(screen.getByTestId('solver-revolve-axis-a-x-input'), { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('solver-revolve-axis-a-y-input'), { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('solver-revolve-axis-b-x-input'), { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('solver-revolve-axis-b-y-input'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('solver-revolve-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-revolve-error');
      expect(err.textContent).toMatch(/coincident/i);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('renders PNG previews from base64 data', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'rotate_extrude() polygon([[5,0]]);',
      pngs: [
        { label: 'iso', base64: 'iVBORw0KGgo=' },
        { label: 'front', base64: 'iVBORw0KGgo=' },
      ],
    });
    render(
      <RevolveModal lang="en" sketch={rectSketch()} onClose={vi.fn()} revolveFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-revolve-submit'));
    await waitFor(() => {
      const img0 = screen.getByTestId('solver-revolve-png-preview-0') as HTMLImageElement;
      expect(img0.src).toContain('data:image/png;base64,iVBORw0KGgo=');
      const img1 = screen.getByTestId('solver-revolve-png-preview-1') as HTMLImageElement;
      expect(img1.src).toContain('data:image/png;base64,iVBORw0KGgo=');
    });
  });

  it('Korean lang: shows 회전 and 회전축', () => {
    render(
      <RevolveModal lang="ko" sketch={rectSketch()} onClose={vi.fn()} revolveFetcher={vi.fn()} />,
    );
    // Submit button label.
    const submit = screen.getByTestId('solver-revolve-submit');
    expect(submit.textContent).toMatch(/회전/);
    // 회전축 (axis) section header.
    expect(screen.getByText(/회전축/)).toBeInTheDocument();
  });
});
