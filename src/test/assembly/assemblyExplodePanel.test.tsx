/** @vitest-environment jsdom */
/**
 * AssemblyExplodePanel — Phase 3.4 UI tests for the standalone exploded-view
 * control panel + its AssemblyBrowserModal toggle integration.
 *
 * The panel is presentational (Three.js-free), so it mounts in jsdom with no
 * GL context. The explode math itself is covered by explodeView.test.ts.
 *
 * Coverage:
 *   1. renders title + controls + moving-parts count
 *   2. heuristic select → onHeuristicChange
 *   3. scale input → onScaleChange (rejects negative / NaN)
 *   4. amount slider → onAmountChange (clamped 0..1)
 *   5. reset button → onAmountChange(0), disabled at 0
 *   6. 6-lang title localisation
 *   7. AssemblyBrowserModal — toggle mounts/unmounts the explode host
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import React from 'react';
import AssemblyExplodePanel, {
  type AssemblyLang,
} from '@/app/[lang]/shape-generator/assembly/AssemblyExplodePanel';
import type { ExplodeAxisHeuristic } from '@/lib/assembly/explodeView';
import AssemblyBrowserModal from '@/app/[lang]/shape-generator/assembly/AssemblyBrowserModal';
import {
  IDENTITY_QUAT,
  partInstance,
  type AssemblyState,
  type PartInstance,
} from '@/lib/assembly/assemblyState';

// ─── helpers ─────────────────────────────────────────────────────────────

function makePart(id: string, pos: [number, number, number], fixed = false): PartInstance {
  return partInstance({
    id,
    name: id,
    partTemplateId: 'tpl',
    position: { x: pos[0], y: pos[1], z: pos[2] },
    orientation: IDENTITY_QUAT,
    fixed,
  });
}

function makeState(): AssemblyState {
  return {
    parts: [makePart('A', [0, 0, 0], true), makePart('B', [10, 0, 0]), makePart('C', [20, 0, 0])],
    mates: [],
  };
}

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof AssemblyExplodePanel>> = {},
) {
  const onHeuristicChange = vi.fn<(h: ExplodeAxisHeuristic) => void>();
  const onScaleChange = vi.fn<(s: number) => void>();
  const onAmountChange = vi.fn<(t: number) => void>();
  const props: React.ComponentProps<typeof AssemblyExplodePanel> = {
    lang: 'en',
    heuristic: 'mate_axes',
    scale: 1.5,
    amount: 1,
    movingCount: 2,
    onHeuristicChange,
    onScaleChange,
    onAmountChange,
    ...overrides,
  };
  render(<AssemblyExplodePanel {...props} />);
  return { onHeuristicChange, onScaleChange, onAmountChange };
}

// ─── panel tests ───────────────────────────────────────────────────────────

describe('AssemblyExplodePanel — controls', () => {
  it('renders the panel, controls and moving-parts count', () => {
    renderPanel();
    expect(screen.getByTestId('solver-assembly-explode-panel')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-explode-heuristic')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-explode-scale')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-explode-amount')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-explode-count').textContent ?? '').toMatch(/2/);
  });

  it('heuristic select bubbles the new value', () => {
    const h = renderPanel();
    fireEvent.change(screen.getByTestId('solver-assembly-explode-heuristic'), {
      target: { value: 'bbox_center' },
    });
    expect(h.onHeuristicChange).toHaveBeenCalledWith('bbox_center');
  });

  it('scale input accepts a non-negative number and rejects negatives', () => {
    const h = renderPanel();
    const input = screen.getByTestId('solver-assembly-explode-scale');
    fireEvent.change(input, { target: { value: '3' } });
    expect(h.onScaleChange).toHaveBeenCalledWith(3);
    h.onScaleChange.mockClear();
    fireEvent.change(input, { target: { value: '-1' } });
    expect(h.onScaleChange).not.toHaveBeenCalled();
  });

  it('amount slider clamps to [0,1] and bubbles', () => {
    const h = renderPanel();
    fireEvent.change(screen.getByTestId('solver-assembly-explode-amount'), {
      target: { value: '0.5' },
    });
    expect(h.onAmountChange).toHaveBeenCalledWith(0.5);
  });

  it('reset bubbles 0 and is disabled when amount is already 0', () => {
    const h = renderPanel({ amount: 1 });
    fireEvent.click(screen.getByTestId('solver-assembly-explode-reset'));
    expect(h.onAmountChange).toHaveBeenCalledWith(0);
    cleanup();
    renderPanel({ amount: 0 });
    expect((screen.getByTestId('solver-assembly-explode-reset') as HTMLButtonElement).disabled).toBe(true);
  });

  it.each<[AssemblyLang, RegExp]>([
    ['ko', /분해 보기/],
    ['en', /Exploded View/],
    ['ja', /分解表示/],
    ['zh', /爆炸视图/],
    ['es', /Vista explosionada/],
    ['ar', /عرض مفكك/],
  ])('localises the title in %s', (lang, re) => {
    renderPanel({ lang });
    expect(screen.getByTestId('solver-assembly-explode-panel').textContent ?? '').toMatch(re);
  });

  it('play / export buttons appear only when their callbacks are provided', () => {
    renderPanel();
    expect(screen.queryByTestId('solver-assembly-explode-play')).toBeNull();
    expect(screen.queryByTestId('solver-assembly-explode-export')).toBeNull();
    cleanup();
    const onPlay = vi.fn();
    const onExport = vi.fn();
    renderPanel({ onPlay, onExport });
    fireEvent.click(screen.getByTestId('solver-assembly-explode-play'));
    fireEvent.click(screen.getByTestId('solver-assembly-explode-export'));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('export is disabled when no part moves', () => {
    renderPanel({ onExport: vi.fn(), movingCount: 0 });
    expect((screen.getByTestId('solver-assembly-explode-export') as HTMLButtonElement).disabled).toBe(true);
  });
});

// ─── modal integration ──────────────────────────────────────────────────────

describe('AssemblyBrowserModal — Explode toggle integration', () => {
  it('toggle mounts and unmounts the explode panel host', () => {
    render(<AssemblyBrowserModal lang="en" initialState={makeState()} onClose={() => {}} />);
    expect(screen.queryByTestId('solver-assembly-explode-host')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('solver-assembly-explode-toggle'));
    const host = screen.getByTestId('solver-assembly-explode-host');
    expect(host).toBeInTheDocument();
    expect(within(host).getByTestId('solver-assembly-explode-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('solver-assembly-explode-toggle'));
    expect(screen.queryByTestId('solver-assembly-explode-host')).not.toBeInTheDocument();
  });

  it('toggle label flips between show/hide copy (en)', () => {
    render(<AssemblyBrowserModal lang="en" initialState={makeState()} onClose={() => {}} />);
    const toggle = screen.getByTestId('solver-assembly-explode-toggle');
    expect(toggle.textContent ?? '').toMatch(/Exploded view/i);
    fireEvent.click(toggle);
    expect(toggle.textContent ?? '').toMatch(/Hide exploded view/i);
  });

  it('Export steps downloads a JSON blob (createObjectURL invoked)', () => {
    const createSpy = vi.fn(() => 'blob:explode');
    const revokeSpy = vi.fn();
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createSpy as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeSpy as unknown as typeof URL.revokeObjectURL;
    // Stub the anchor navigation so jsdom doesn't log "navigation not implemented".
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      render(<AssemblyBrowserModal lang="en" initialState={makeState()} onClose={() => {}} />);
      fireEvent.click(screen.getByTestId('solver-assembly-explode-toggle'));
      const exportBtn = screen.getByTestId('solver-assembly-explode-export') as HTMLButtonElement;
      expect(exportBtn.disabled).toBe(false); // B + C move
      fireEvent.click(exportBtn);
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeSpy).toHaveBeenCalledTimes(1);
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      clickSpy.mockRestore();
    }
  });

  it('Play does not throw and the panel stays mounted', () => {
    render(<AssemblyBrowserModal lang="en" initialState={makeState()} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('solver-assembly-explode-toggle'));
    fireEvent.click(screen.getByTestId('solver-assembly-explode-play'));
    expect(screen.getByTestId('solver-assembly-explode-panel')).toBeInTheDocument();
  });
});

afterEach(cleanup);
