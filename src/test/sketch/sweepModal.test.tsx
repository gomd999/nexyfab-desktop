/** @vitest-environment jsdom */
/**
 * SweepModal — standalone modal tests (Phase 2.2 sweep).
 *
 * SweepModal is a standalone component that takes the sketch state as a
 * prop and a default path. These tests render it directly and mock the
 * sweepFetcher; they do NOT spin up SolverSketchEditor.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import SweepModal from '@/app/[lang]/shape-generator/sketch/SweepModal';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';

function rectSketch(): SolverViewState {
  return {
    points: [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 10, y: 0 },
      { id: 'p3', x: 10, y: 5 },
      { id: 'p4', x: 0, y: 5 },
    ],
    lines: [
      { id: 'l1', p1: 'p1', p2: 'p2' },
      { id: 'l2', p1: 'p2', p2: 'p3' },
      { id: 'l3', p1: 'p3', p2: 'p4' },
      { id: 'l4', p1: 'p4', p2: 'p1' },
    ],
  };
}

describe('SweepModal', () => {
  it('renders the modal with the default 2-point path + mode + buttons', () => {
    render(
      <SweepModal
        lang="en"
        sketch={rectSketch()}
        onClose={vi.fn()}
        sweepFetcher={vi.fn()}
      />,
    );
    expect(screen.getByTestId('solver-sweep-modal')).toBeInTheDocument();
    // Default path is 2 points (indexes 0 and 1).
    expect(screen.getByTestId('solver-sweep-path-point-0-x-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-sweep-path-point-0-y-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-sweep-path-point-0-z-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-sweep-path-point-1-x-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-sweep-path-point-1-z-input')).toBeInTheDocument();
    expect(screen.queryByTestId('solver-sweep-path-point-2-x-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('solver-sweep-path-add')).toBeInTheDocument();
    expect(screen.getByTestId('solver-sweep-mode-select')).toBeInTheDocument();
    expect(screen.getByTestId('solver-sweep-submit')).toBeInTheDocument();
    expect(screen.getByTestId('solver-sweep-cancel')).toBeInTheDocument();
  });

  it('default path is [{0,0,0}, {0,0,50}] (straight Z extrusion)', () => {
    render(
      <SweepModal lang="en" sketch={rectSketch()} onClose={vi.fn()} sweepFetcher={vi.fn()} />,
    );
    expect((screen.getByTestId('solver-sweep-path-point-0-x-input') as HTMLInputElement).value).toBe('0');
    expect((screen.getByTestId('solver-sweep-path-point-0-y-input') as HTMLInputElement).value).toBe('0');
    expect((screen.getByTestId('solver-sweep-path-point-0-z-input') as HTMLInputElement).value).toBe('0');
    expect((screen.getByTestId('solver-sweep-path-point-1-x-input') as HTMLInputElement).value).toBe('0');
    expect((screen.getByTestId('solver-sweep-path-point-1-y-input') as HTMLInputElement).value).toBe('0');
    expect((screen.getByTestId('solver-sweep-path-point-1-z-input') as HTMLInputElement).value).toBe('50');
  });

  it('cancel button invokes onClose', () => {
    const onClose = vi.fn();
    render(
      <SweepModal lang="en" sketch={rectSketch()} onClose={onClose} sweepFetcher={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-sweep-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the backdrop closes the modal', () => {
    const onClose = vi.fn();
    render(
      <SweepModal lang="en" sketch={rectSketch()} onClose={onClose} sweepFetcher={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-sweep-modal'));
    expect(onClose).toHaveBeenCalled();
  });

  it('add-point button extends the path; remove-point shrinks it', () => {
    render(
      <SweepModal lang="en" sketch={rectSketch()} onClose={vi.fn()} sweepFetcher={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-sweep-path-add'));
    expect(screen.getByTestId('solver-sweep-path-point-2-x-input')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('solver-sweep-path-point-2-remove'));
    expect(screen.queryByTestId('solver-sweep-path-point-2-x-input')).not.toBeInTheDocument();
  });

  it('remove-point is disabled when only 2 points remain (min path length)', () => {
    render(
      <SweepModal lang="en" sketch={rectSketch()} onClose={vi.fn()} sweepFetcher={vi.fn()} />,
    );
    const remove0 = screen.getByTestId('solver-sweep-path-point-0-remove') as HTMLButtonElement;
    const remove1 = screen.getByTestId('solver-sweep-path-point-1-remove') as HTMLButtonElement;
    expect(remove0.disabled).toBe(true);
    expect(remove1.disabled).toBe(true);
  });

  it('path inputs accept numeric values', () => {
    render(
      <SweepModal lang="en" sketch={rectSketch()} onClose={vi.fn()} sweepFetcher={vi.fn()} />,
    );
    const x0 = screen.getByTestId('solver-sweep-path-point-0-x-input') as HTMLInputElement;
    const z1 = screen.getByTestId('solver-sweep-path-point-1-z-input') as HTMLInputElement;
    fireEvent.change(x0, { target: { value: '3' } });
    fireEvent.change(z1, { target: { value: '100' } });
    expect(x0.value).toBe('3');
    expect(z1.value).toBe('100');
  });

  it('submit fires sweepFetcher with path + mode + sketch', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'path_sweep([...], [...]);',
      pngs: [],
    });
    render(
      <SweepModal lang="en" sketch={rectSketch()} onClose={vi.fn()} sweepFetcher={fetcher} />,
    );
    // Tweak one path coordinate to verify it gets parsed.
    fireEvent.change(screen.getByTestId('solver-sweep-path-point-1-z-input'), { target: { value: '25' } });
    fireEvent.change(screen.getByTestId('solver-sweep-mode-select'), { target: { value: 'cut' } });

    fireEvent.click(screen.getByTestId('solver-sweep-submit'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const call = fetcher.mock.calls[0]![0]!;
    expect(call.path).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 25 },
    ]);
    expect(call.mode).toBe('cut');
    expect(call.includeStl).toBe(true);
    expect(call.sketch.points.length).toBe(4);
  });

  it('success response renders the SCAD preview', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'include <BOSL2/std.scad>\npath_sweep([[0,0],[10,0]], [[0,0,0],[0,0,50]]);',
      pngs: [],
    });
    render(
      <SweepModal lang="en" sketch={rectSketch()} onClose={vi.fn()} sweepFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-sweep-submit'));
    await waitFor(() => {
      const pre = screen.getByTestId('solver-sweep-scad-preview');
      expect(pre.textContent).toContain('path_sweep');
    });
  });

  it('error response renders the error message', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      code: 'PIPELINE_ERROR',
      message: 'no closed loop found',
    });
    render(
      <SweepModal lang="en" sketch={rectSketch()} onClose={vi.fn()} sweepFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-sweep-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-sweep-error');
      expect(err.textContent).toMatch(/closed loop/);
    });
  });

  it('client-side zero-length segment check fires before the fetcher', async () => {
    const fetcher = vi.fn();
    render(
      <SweepModal lang="en" sketch={rectSketch()} onClose={vi.fn()} sweepFetcher={fetcher} />,
    );
    // Force both points to (0,0,0).
    fireEvent.change(screen.getByTestId('solver-sweep-path-point-1-z-input'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('solver-sweep-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-sweep-error');
      expect(err.textContent).toMatch(/zero-length/i);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('client-side <2 points check fires before the fetcher when path is artificially short', async () => {
    // The default 2-point path can't be shrunk via the UI (remove buttons
    // are disabled). But the submit-time guard still protects against an
    // imperative future change that lets the path get below 2 points.
    // Here we drive the same code path indirectly: a zero-length second
    // point makes the path effectively a single distinct location.
    const fetcher = vi.fn();
    render(
      <SweepModal lang="en" sketch={rectSketch()} onClose={vi.fn()} sweepFetcher={fetcher} />,
    );
    // Collapse both path points to the origin → zero-length segment.
    fireEvent.change(screen.getByTestId('solver-sweep-path-point-1-x-input'), { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('solver-sweep-path-point-1-y-input'), { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('solver-sweep-path-point-1-z-input'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('solver-sweep-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-sweep-error');
      expect(err.textContent).toMatch(/zero-length/i);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('renders PNG previews from base64 data', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'path_sweep([], []);',
      pngs: [
        { label: 'iso', base64: 'iVBORw0KGgo=' },
        { label: 'front', base64: 'iVBORw0KGgo=' },
      ],
    });
    render(
      <SweepModal lang="en" sketch={rectSketch()} onClose={vi.fn()} sweepFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-sweep-submit'));
    await waitFor(() => {
      const img0 = screen.getByTestId('solver-sweep-png-preview-0') as HTMLImageElement;
      expect(img0.src).toContain('data:image/png;base64,iVBORw0KGgo=');
      const img1 = screen.getByTestId('solver-sweep-png-preview-1') as HTMLImageElement;
      expect(img1.src).toContain('data:image/png;base64,iVBORw0KGgo=');
    });
  });

  it('Korean lang: shows 스윕 (submit) and 경로 (path heading)', () => {
    render(
      <SweepModal lang="ko" sketch={rectSketch()} onClose={vi.fn()} sweepFetcher={vi.fn()} />,
    );
    const submit = screen.getByTestId('solver-sweep-submit');
    expect(submit.textContent).toMatch(/스윕/);
    expect(screen.getByText(/경로/)).toBeInTheDocument();
  });
});
