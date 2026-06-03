/** @vitest-environment jsdom */
/**
 * FeatureTreeOptimizerPanel — standalone panel tests.
 *
 * Coverage matrix (~16 tests):
 *   - mount: panel + 3 toggles all default ON
 *   - optimize click → before / after counts populate
 *   - removed list shows one row per removed node (id + reason)
 *   - removed-{id} testid present for cascade-removed node
 *   - apply forwards optimized tree via onOptimized callback
 *   - apply disabled until optimize runs
 *   - apply button absent when onOptimized not provided
 *   - toggle off removeSuppressed → suppressed survives
 *   - toggle off removeOrphans → orphan survives
 *   - toggle off mergePatterns → mergePatterns warning absent (no-op)
 *   - empty tree → optimize is a no-op (before=0, after=0)
 *   - empty tree → removed-list shows "no removals" placeholder
 *   - re-run after toggle change updates counts
 *   - 6-lang button label rendering
 *   - ar lang → dir=rtl
 *   - kind histogram surfaces extrude/linear_pattern lines
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import FeatureTreeOptimizerPanel from '@/app/[lang]/shape-generator/sketch/FeatureTreeOptimizerPanel';
import type { FeatureNode, FeatureTree } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { LinearPatternFeature } from '@/lib/cad/pattern';

// ─── fixtures ─────────────────────────────────────────────────────────────

function extrudeNode(
  id: string,
  deps: string[] = [],
  opts: { suppressed?: boolean } = {},
): FeatureNode {
  const payload: ExtrudeFeature = {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ],
    depth: 3,
    direction: 'one_sided',
    mode: 'add',
  };
  return {
    id,
    name: id,
    dependencies: deps,
    ...(opts.suppressed !== undefined ? { suppressed: opts.suppressed } : {}),
    payload,
  };
}

function patternNode(id: string, deps: string[]): FeatureNode {
  const payload: LinearPatternFeature = {
    kind: 'linear_pattern',
    childScad: 'cube([1,1,1]);',
    count: 3,
    direction: { x: 1, y: 0, z: 0 },
    spacing: 5,
  };
  return { id, name: id, dependencies: deps, payload };
}

/**
 * Tree shape used by most tests:
 *   a (extrude, terminal)
 *   b (extrude, suppressed, no deps)
 *   c (extrude, depends on b — cascade-removed when b drops)
 *   d (extrude, orphan — no dependents, before terminal)
 *
 * Expected after default optimize:
 *   - b drops (suppressed)
 *   - c drops (cascade)
 *   - d drops (orphan)
 *   - a survives (terminal)
 */
function complexTree(): FeatureTree {
  return {
    nodes: [
      extrudeNode('d'),
      extrudeNode('b', [], { suppressed: true }),
      extrudeNode('c', ['b']),
      extrudeNode('a'),
    ],
  };
}

function singleTerminalTree(): FeatureTree {
  return { nodes: [extrudeNode('a')] };
}

function emptyTree(): FeatureTree {
  return { nodes: [] };
}

afterEach(() => {
  cleanup();
});

// ─── tests ────────────────────────────────────────────────────────────────

describe('FeatureTreeOptimizerPanel — mount + defaults', () => {
  it('renders the panel + 3 toggles, all default ON', () => {
    render(<FeatureTreeOptimizerPanel lang="en" tree={emptyTree()} />);
    expect(screen.getByTestId('solver-tree-optimize-panel')).toBeInTheDocument();
    const sup = screen.getByTestId('solver-tree-optimize-toggle-removeSuppressed') as HTMLInputElement;
    const orp = screen.getByTestId('solver-tree-optimize-toggle-removeOrphans') as HTMLInputElement;
    const mp = screen.getByTestId('solver-tree-optimize-toggle-mergePatterns') as HTMLInputElement;
    expect(sup.checked).toBe(true);
    expect(orp.checked).toBe(true);
    expect(mp.checked).toBe(true);
  });

  it('shows "Run optimize to see results" before first run', () => {
    render(<FeatureTreeOptimizerPanel lang="en" tree={singleTerminalTree()} />);
    const panel = screen.getByTestId('solver-tree-optimize-panel');
    expect(panel.textContent).toMatch(/Run optimize/i);
    // No before/after rows yet.
    expect(screen.queryByTestId('solver-tree-optimize-before-count')).not.toBeInTheDocument();
    expect(screen.queryByTestId('solver-tree-optimize-after-count')).not.toBeInTheDocument();
  });
});

describe('FeatureTreeOptimizerPanel — optimize + counts', () => {
  it('optimize click populates before/after counts', () => {
    render(<FeatureTreeOptimizerPanel lang="en" tree={complexTree()} />);
    fireEvent.click(screen.getByTestId('solver-tree-optimize-optimize-button'));
    expect(screen.getByTestId('solver-tree-optimize-before-count').textContent).toMatch(/4/);
    expect(screen.getByTestId('solver-tree-optimize-after-count').textContent).toMatch(/1/);
  });

  it('empty tree → before=0 / after=0 / no removals', () => {
    render(<FeatureTreeOptimizerPanel lang="en" tree={emptyTree()} />);
    fireEvent.click(screen.getByTestId('solver-tree-optimize-optimize-button'));
    expect(screen.getByTestId('solver-tree-optimize-before-count').textContent).toMatch(/0/);
    expect(screen.getByTestId('solver-tree-optimize-after-count').textContent).toMatch(/0/);
    const list = screen.getByTestId('solver-tree-optimize-removed-list');
    expect(list.textContent).toMatch(/No features removed/i);
  });

  it('re-run after toggling off updates counts', () => {
    render(<FeatureTreeOptimizerPanel lang="en" tree={complexTree()} />);
    fireEvent.click(screen.getByTestId('solver-tree-optimize-optimize-button'));
    expect(screen.getByTestId('solver-tree-optimize-after-count').textContent).toMatch(/1/);
    // Disable both pruning passes; everything but the validation should survive.
    fireEvent.click(screen.getByTestId('solver-tree-optimize-toggle-removeSuppressed'));
    fireEvent.click(screen.getByTestId('solver-tree-optimize-toggle-removeOrphans'));
    fireEvent.click(screen.getByTestId('solver-tree-optimize-optimize-button'));
    expect(screen.getByTestId('solver-tree-optimize-after-count').textContent).toMatch(/4/);
  });
});

describe('FeatureTreeOptimizerPanel — removed list', () => {
  it('renders one row per removed node with id testid', () => {
    render(<FeatureTreeOptimizerPanel lang="en" tree={complexTree()} />);
    fireEvent.click(screen.getByTestId('solver-tree-optimize-optimize-button'));
    expect(screen.getByTestId('solver-tree-optimize-removed-b')).toBeInTheDocument();
    expect(screen.getByTestId('solver-tree-optimize-removed-c')).toBeInTheDocument();
    expect(screen.getByTestId('solver-tree-optimize-removed-d')).toBeInTheDocument();
    // Terminal must NOT appear.
    expect(screen.queryByTestId('solver-tree-optimize-removed-a')).not.toBeInTheDocument();
  });

  it('cascade-removed node row surfaces the cascade reason', () => {
    render(<FeatureTreeOptimizerPanel lang="en" tree={complexTree()} />);
    fireEvent.click(screen.getByTestId('solver-tree-optimize-optimize-button'));
    const row = screen.getByTestId('solver-tree-optimize-removed-c');
    expect(row.textContent).toMatch(/extrude/);
    expect(row.textContent).toMatch(/c/);
    expect(row.textContent).toMatch(/cascade/i);
  });

  it('orphan row surfaces the orphan reason', () => {
    render(<FeatureTreeOptimizerPanel lang="en" tree={complexTree()} />);
    fireEvent.click(screen.getByTestId('solver-tree-optimize-optimize-button'));
    const row = screen.getByTestId('solver-tree-optimize-removed-d');
    expect(row.textContent).toMatch(/orphan/i);
  });

  it('suppressed-root row surfaces the suppressed reason (no warning emitted for seed)', () => {
    render(<FeatureTreeOptimizerPanel lang="en" tree={complexTree()} />);
    fireEvent.click(screen.getByTestId('solver-tree-optimize-optimize-button'));
    const row = screen.getByTestId('solver-tree-optimize-removed-b');
    expect(row.textContent).toMatch(/suppressed/i);
  });
});

describe('FeatureTreeOptimizerPanel — apply callback', () => {
  it('apply fires onOptimized with optimized tree', () => {
    const cb = vi.fn();
    render(
      <FeatureTreeOptimizerPanel lang="en" tree={complexTree()} onOptimized={cb} />,
    );
    fireEvent.click(screen.getByTestId('solver-tree-optimize-optimize-button'));
    fireEvent.click(screen.getByTestId('solver-tree-optimize-apply-button'));
    expect(cb).toHaveBeenCalledTimes(1);
    const arg = cb.mock.calls[0]![0] as FeatureTree;
    expect(arg.nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('apply disabled before any optimize run', () => {
    const cb = vi.fn();
    render(
      <FeatureTreeOptimizerPanel lang="en" tree={complexTree()} onOptimized={cb} />,
    );
    const apply = screen.getByTestId('solver-tree-optimize-apply-button') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.click(apply);
    expect(cb).not.toHaveBeenCalled();
  });

  it('apply button absent when onOptimized prop omitted', () => {
    render(<FeatureTreeOptimizerPanel lang="en" tree={complexTree()} />);
    expect(screen.queryByTestId('solver-tree-optimize-apply-button')).not.toBeInTheDocument();
  });
});

describe('FeatureTreeOptimizerPanel — toggle granularity', () => {
  it('toggle off removeSuppressed → suppressed node survives', () => {
    const cb = vi.fn();
    render(
      <FeatureTreeOptimizerPanel lang="en" tree={complexTree()} onOptimized={cb} />,
    );
    fireEvent.click(screen.getByTestId('solver-tree-optimize-toggle-removeSuppressed'));
    // Also turn off orphans so the only thing the run could touch is suppressed.
    fireEvent.click(screen.getByTestId('solver-tree-optimize-toggle-removeOrphans'));
    fireEvent.click(screen.getByTestId('solver-tree-optimize-optimize-button'));
    fireEvent.click(screen.getByTestId('solver-tree-optimize-apply-button'));
    const arg = cb.mock.calls[0]![0] as FeatureTree;
    expect(arg.nodes.map((n) => n.id)).toContain('b'); // suppressed survived
  });

  it('toggle off removeOrphans → orphan node survives', () => {
    const cb = vi.fn();
    render(
      <FeatureTreeOptimizerPanel lang="en" tree={complexTree()} onOptimized={cb} />,
    );
    fireEvent.click(screen.getByTestId('solver-tree-optimize-toggle-removeOrphans'));
    fireEvent.click(screen.getByTestId('solver-tree-optimize-optimize-button'));
    fireEvent.click(screen.getByTestId('solver-tree-optimize-apply-button'));
    const arg = cb.mock.calls[0]![0] as FeatureTree;
    // suppressed b + cascade c still drop; orphan d stays.
    expect(arg.nodes.map((n) => n.id)).toContain('d');
    expect(arg.nodes.map((n) => n.id)).not.toContain('b');
  });

  it('toggle off mergePatterns → no node-count change vs ON (still Phase 2 no-op)', () => {
    // Tree with a pattern node to exercise the histogram diff regardless.
    const tree: FeatureTree = {
      nodes: [extrudeNode('a'), patternNode('p', ['a'])],
    };
    render(<FeatureTreeOptimizerPanel lang="en" tree={tree} />);
    // Toggle ON merge run.
    fireEvent.click(screen.getByTestId('solver-tree-optimize-optimize-button'));
    const after1 = screen.getByTestId('solver-tree-optimize-after-count').textContent ?? '';
    // Turn off mergePatterns + re-run.
    fireEvent.click(screen.getByTestId('solver-tree-optimize-toggle-mergePatterns'));
    fireEvent.click(screen.getByTestId('solver-tree-optimize-optimize-button'));
    const after2 = screen.getByTestId('solver-tree-optimize-after-count').textContent ?? '';
    expect(after1).toBe(after2);
  });
});

describe('FeatureTreeOptimizerPanel — histogram diff', () => {
  it('shows kind rows for both extrude and linear_pattern when both are present', () => {
    const tree: FeatureTree = {
      nodes: [extrudeNode('a'), patternNode('p', ['a'])],
    };
    render(<FeatureTreeOptimizerPanel lang="en" tree={tree} />);
    fireEvent.click(screen.getByTestId('solver-tree-optimize-optimize-button'));
    const panel = screen.getByTestId('solver-tree-optimize-panel');
    expect(panel.textContent).toMatch(/extrude/);
    expect(panel.textContent).toMatch(/linear_pattern/);
  });

  it('histogram delta reflects removed nodes for the complex tree', () => {
    render(<FeatureTreeOptimizerPanel lang="en" tree={complexTree()} />);
    fireEvent.click(screen.getByTestId('solver-tree-optimize-optimize-button'));
    const panel = screen.getByTestId('solver-tree-optimize-panel');
    // 4 extrudes → 1 extrude = -3 delta on extrude row.
    expect(panel.textContent).toMatch(/-3/);
  });
});

describe('FeatureTreeOptimizerPanel — i18n', () => {
  it.each([
    ['ko', /최적화 실행/],
    ['en', /Run optimize/],
    ['ja', /最適化を実行/],
    ['zh', /执行优化/],
    ['es', /Ejecutar optimización/],
    ['ar', /شغّل|تشغيل/],
  ] as const)('lang=%s renders localized optimize button label', (lang, pattern) => {
    render(<FeatureTreeOptimizerPanel lang={lang} tree={emptyTree()} />);
    const btn = screen.getByTestId('solver-tree-optimize-optimize-button');
    expect(btn.textContent ?? '').toMatch(pattern);
  });

  it('ar lang sets dir=rtl on the panel root', () => {
    render(<FeatureTreeOptimizerPanel lang="ar" tree={emptyTree()} />);
    expect(screen.getByTestId('solver-tree-optimize-panel').getAttribute('dir')).toBe('rtl');
  });

  it('en lang sets dir=ltr on the panel root', () => {
    render(<FeatureTreeOptimizerPanel lang="en" tree={emptyTree()} />);
    expect(screen.getByTestId('solver-tree-optimize-panel').getAttribute('dir')).toBe('ltr');
  });
});
