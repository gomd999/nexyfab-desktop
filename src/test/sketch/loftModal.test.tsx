/** @vitest-environment jsdom */
/**
 * LoftModal — standalone modal tests (Phase 2.2 loft).
 *
 * LoftModal is a standalone component that takes the sketch state as a
 * prop. These tests render it directly and mock the loftFetcher; they do
 * NOT spin up SolverSketchEditor.
 *
 * Phase 1: 2 sections of the same sketch at user-specified z values.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import LoftModal from '@/app/[lang]/shape-generator/sketch/LoftModal';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';

function rectSketch(): SolverViewState {
  return {
    points: [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 10, y: 0 },
      { id: 'p3', x: 10, y: 10 },
      { id: 'p4', x: 0, y: 10 },
    ],
    lines: [
      { id: 'l1', p1: 'p1', p2: 'p2' },
      { id: 'l2', p1: 'p2', p2: 'p3' },
      { id: 'l3', p1: 'p3', p2: 'p4' },
      { id: 'l4', p1: 'p4', p2: 'p1' },
    ],
  };
}

describe('LoftModal', () => {
  it('renders the modal with 2 default sections + mode + buttons', () => {
    render(
      <LoftModal
        lang="en"
        sketch={rectSketch()}
        onClose={vi.fn()}
        loftFetcher={vi.fn()}
      />,
    );
    expect(screen.getByTestId('solver-loft-modal')).toBeInTheDocument();
    expect(screen.getByTestId('solver-loft-section-0-z-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-loft-section-1-z-input')).toBeInTheDocument();
    expect(screen.getByTestId('solver-loft-section-0-source-select')).toBeInTheDocument();
    expect(screen.getByTestId('solver-loft-section-1-source-select')).toBeInTheDocument();
    expect(screen.getByTestId('solver-loft-mode-select')).toBeInTheDocument();
    expect(screen.getByTestId('solver-loft-add-section')).toBeInTheDocument();
    expect(screen.getByTestId('solver-loft-submit')).toBeInTheDocument();
    expect(screen.getByTestId('solver-loft-cancel')).toBeInTheDocument();
  });

  it('renders the Phase 1 note', () => {
    render(
      <LoftModal lang="en" sketch={rectSketch()} onClose={vi.fn()} loftFetcher={vi.fn()} />,
    );
    expect(screen.getByTestId('solver-loft-phase1-note')).toBeInTheDocument();
    expect(screen.getByTestId('solver-loft-phase1-note').textContent).toMatch(/Phase 1/);
  });

  it('cancel button invokes onClose', () => {
    const onClose = vi.fn();
    render(
      <LoftModal lang="en" sketch={rectSketch()} onClose={onClose} loftFetcher={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-loft-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the backdrop closes the modal', () => {
    const onClose = vi.fn();
    render(
      <LoftModal lang="en" sketch={rectSketch()} onClose={onClose} loftFetcher={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-loft-modal'));
    expect(onClose).toHaveBeenCalled();
  });

  it('z inputs accept numeric values', () => {
    render(
      <LoftModal lang="en" sketch={rectSketch()} onClose={vi.fn()} loftFetcher={vi.fn()} />,
    );
    const z0 = screen.getByTestId('solver-loft-section-0-z-input') as HTMLInputElement;
    const z1 = screen.getByTestId('solver-loft-section-1-z-input') as HTMLInputElement;
    fireEvent.change(z0, { target: { value: '2' } });
    fireEvent.change(z1, { target: { value: '15' } });
    expect(z0.value).toBe('2');
    expect(z1.value).toBe('15');
  });

  it('add-section button adds a third row', () => {
    render(
      <LoftModal lang="en" sketch={rectSketch()} onClose={vi.fn()} loftFetcher={vi.fn()} />,
    );
    expect(screen.queryByTestId('solver-loft-section-2-z-input')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('solver-loft-add-section'));
    expect(screen.getByTestId('solver-loft-section-2-z-input')).toBeInTheDocument();
  });

  it('remove-section button is disabled when only 2 sections remain', () => {
    render(
      <LoftModal lang="en" sketch={rectSketch()} onClose={vi.fn()} loftFetcher={vi.fn()} />,
    );
    const btn = screen.getByTestId('solver-loft-remove-section-0') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('remove-section removes a row when >2 sections', () => {
    render(
      <LoftModal lang="en" sketch={rectSketch()} onClose={vi.fn()} loftFetcher={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-loft-add-section'));
    expect(screen.getByTestId('solver-loft-section-2-z-input')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('solver-loft-remove-section-2'));
    expect(screen.queryByTestId('solver-loft-section-2-z-input')).not.toBeInTheDocument();
  });

  it('submit fires loftFetcher with sections + mode + sketch (Phase 1: all sections use sketch prop)', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'include <BOSL2/std.scad>\nskin([...]);',
      pngs: [],
    });
    render(
      <LoftModal lang="en" sketch={rectSketch()} onClose={vi.fn()} loftFetcher={fetcher} />,
    );
    fireEvent.change(screen.getByTestId('solver-loft-section-0-z-input'), { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('solver-loft-section-1-z-input'), { target: { value: '20' } });
    fireEvent.change(screen.getByTestId('solver-loft-mode-select'), { target: { value: 'cut' } });

    fireEvent.click(screen.getByTestId('solver-loft-submit'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const call = fetcher.mock.calls[0]![0]!;
    expect(call.sections.length).toBe(2);
    expect(call.sections[0]!.z).toBe(0);
    expect(call.sections[1]!.z).toBe(20);
    // Phase 1: both sections reference the same sketch prop.
    expect(call.sections[0]!.sketch.points.length).toBe(4);
    expect(call.sections[1]!.sketch.points.length).toBe(4);
    expect(call.mode).toBe('cut');
    expect(call.includeStl).toBe(true);
  });

  it('client-side non-monotonic-z check fires before the fetcher', async () => {
    const fetcher = vi.fn();
    render(
      <LoftModal lang="en" sketch={rectSketch()} onClose={vi.fn()} loftFetcher={fetcher} />,
    );
    // Force z1 < z0.
    fireEvent.change(screen.getByTestId('solver-loft-section-0-z-input'), { target: { value: '10' } });
    fireEvent.change(screen.getByTestId('solver-loft-section-1-z-input'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('solver-loft-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-loft-error');
      expect(err.textContent).toMatch(/monotonically/);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('client-side empty-z check fires before the fetcher', async () => {
    const fetcher = vi.fn();
    render(
      <LoftModal lang="en" sketch={rectSketch()} onClose={vi.fn()} loftFetcher={fetcher} />,
    );
    // Clearing the input → empty string → modal rejects before fetch.
    fireEvent.change(screen.getByTestId('solver-loft-section-1-z-input'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('solver-loft-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('solver-loft-error').textContent).toMatch(/number/);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('success response renders the SCAD preview', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'include <BOSL2/std.scad>\nskin([[[0,0,0],[10,0,0]]]);',
      pngs: [],
    });
    render(
      <LoftModal lang="en" sketch={rectSketch()} onClose={vi.fn()} loftFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-loft-submit'));
    await waitFor(() => {
      const pre = screen.getByTestId('solver-loft-scad-preview');
      expect(pre.textContent).toContain('skin');
    });
  });

  it('error response renders the error message', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      code: 'PIPELINE_ERROR',
      message: 'sections must be monotonically ascending in z',
    });
    render(
      <LoftModal lang="en" sketch={rectSketch()} onClose={vi.fn()} loftFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-loft-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('solver-loft-error');
      expect(err.textContent).toMatch(/monotonically/);
    });
  });

  it('renders PNG previews from base64 data', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      scad: 'skin([])',
      pngs: [
        { label: 'iso', base64: 'iVBORw0KGgo=' },
        { label: 'front', base64: 'iVBORw0KGgo=' },
      ],
    });
    render(
      <LoftModal lang="en" sketch={rectSketch()} onClose={vi.fn()} loftFetcher={fetcher} />,
    );
    fireEvent.click(screen.getByTestId('solver-loft-submit'));
    await waitFor(() => {
      const img0 = screen.getByTestId('solver-loft-png-preview-0') as HTMLImageElement;
      expect(img0.src).toContain('data:image/png;base64,iVBORw0KGgo=');
      const img1 = screen.getByTestId('solver-loft-png-preview-1') as HTMLImageElement;
      expect(img1.src).toContain('data:image/png;base64,iVBORw0KGgo=');
    });
  });

  it('Korean lang: shows 로프트 and 단면', () => {
    render(
      <LoftModal lang="ko" sketch={rectSketch()} onClose={vi.fn()} loftFetcher={vi.fn()} />,
    );
    const submit = screen.getByTestId('solver-loft-submit');
    expect(submit.textContent).toMatch(/로프트/);
    // "단면" appears in multiple labels — assert at least one match.
    expect(screen.getAllByText(/단면/).length).toBeGreaterThan(0);
  });
});
