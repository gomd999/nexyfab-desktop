/** @vitest-environment jsdom */
/**
 * FeatureTreeView — standalone tree-view tests (Phase 2.7 UX).
 *
 * Covers:
 *   - empty state
 *   - 5-node tree render
 *   - row click → onSelect
 *   - selected row highlight via data-selected
 *   - suppress toggle → onToggleSuppress
 *   - delete button → onDelete
 *   - all 9 feature kinds icon mapping
 *   - dependencies inline display
 *   - drag-drop dragstart+drop → onReorder(from, to)
 *   - 6-lang i18n: ko/en/ja/zh/es/ar
 *   - optional control gating: no callback → no button
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import FeatureTreeView from '@/app/[lang]/shape-generator/sketch/FeatureTreeView';
import type { FeatureKind, FeatureNode, FeatureTree } from '@/lib/cad/featureTree';

// Build minimal payloads — the view only inspects `kind`, never the
// surrounding fields. Cast to bypass the discriminated-union check; this
// keeps tests independent of payload-shape drift.
function makeNode(id: string, kind: FeatureKind, opts: Partial<FeatureNode> = {}): FeatureNode {
  const payload = { kind } as unknown as FeatureNode['payload'];
  return {
    id,
    name: opts.name ?? `${kind} ${id}`,
    dependencies: opts.dependencies ?? [],
    suppressed: opts.suppressed,
    payload,
  };
}

function makeTree(nodes: FeatureNode[]): FeatureTree {
  return { nodes };
}

describe('FeatureTreeView', () => {
  // ─── empty state ────────────────────────────────────────────────────────
  it('empty tree → shows empty state', () => {
    render(
      <FeatureTreeView lang="en" tree={makeTree([])} onSelect={vi.fn()} />,
    );
    expect(screen.getByTestId('feature-tree-view')).toBeInTheDocument();
    expect(screen.getByTestId('feature-tree-empty')).toBeInTheDocument();
    expect(screen.getByTestId('feature-tree-empty').textContent).toMatch(/Add feature/i);
  });

  // ─── basic render ───────────────────────────────────────────────────────
  it('5 nodes → 5 rows rendered', () => {
    const tree = makeTree([
      makeNode('e1', 'extrude'),
      makeNode('r1', 'revolve'),
      makeNode('h1', 'hole'),
      makeNode('f1', 'fillet'),
      makeNode('c1', 'chamfer'),
    ]);
    render(<FeatureTreeView lang="en" tree={tree} onSelect={vi.fn()} />);
    expect(screen.getByTestId('feature-tree-row-e1')).toBeInTheDocument();
    expect(screen.getByTestId('feature-tree-row-r1')).toBeInTheDocument();
    expect(screen.getByTestId('feature-tree-row-h1')).toBeInTheDocument();
    expect(screen.getByTestId('feature-tree-row-f1')).toBeInTheDocument();
    expect(screen.getByTestId('feature-tree-row-c1')).toBeInTheDocument();
    expect(screen.queryByTestId('feature-tree-empty')).not.toBeInTheDocument();
  });

  it('row name comes from node.name', () => {
    const tree = makeTree([makeNode('e1', 'extrude', { name: 'Boss base 50mm' })]);
    render(<FeatureTreeView lang="en" tree={tree} onSelect={vi.fn()} />);
    expect(screen.getByTestId('feature-tree-row-e1-name').textContent).toBe('Boss base 50mm');
  });

  // ─── select ─────────────────────────────────────────────────────────────
  it('clicking a row fires onSelect with that id', () => {
    const onSelect = vi.fn();
    const tree = makeTree([
      makeNode('e1', 'extrude'),
      makeNode('e2', 'extrude'),
    ]);
    render(<FeatureTreeView lang="en" tree={tree} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('feature-tree-row-e2'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('e2');
  });

  it('selectedId row carries data-selected=true; others false', () => {
    const tree = makeTree([
      makeNode('e1', 'extrude'),
      makeNode('e2', 'extrude'),
      makeNode('e3', 'extrude'),
    ]);
    render(
      <FeatureTreeView lang="en" tree={tree} selectedId="e2" onSelect={vi.fn()} />,
    );
    expect(screen.getByTestId('feature-tree-row-e1').getAttribute('data-selected')).toBe('false');
    expect(screen.getByTestId('feature-tree-row-e2').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('feature-tree-row-e3').getAttribute('data-selected')).toBe('false');
  });

  // ─── suppress ───────────────────────────────────────────────────────────
  it('suppress toggle fires onToggleSuppress(id) and stops row click', () => {
    const onSelect = vi.fn();
    const onToggleSuppress = vi.fn();
    const tree = makeTree([makeNode('e1', 'extrude')]);
    render(
      <FeatureTreeView
        lang="en"
        tree={tree}
        onSelect={onSelect}
        onToggleSuppress={onToggleSuppress}
      />,
    );
    fireEvent.click(screen.getByTestId('feature-tree-row-e1-suppress'));
    expect(onToggleSuppress).toHaveBeenCalledWith('e1');
    // Click on the suppress button should NOT bubble to row select.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('suppressed node row carries data-suppressed=true and line-through name', () => {
    const tree = makeTree([makeNode('e1', 'extrude', { suppressed: true })]);
    render(
      <FeatureTreeView
        lang="en"
        tree={tree}
        onSelect={vi.fn()}
        onToggleSuppress={vi.fn()}
      />,
    );
    const row = screen.getByTestId('feature-tree-row-e1');
    expect(row.getAttribute('data-suppressed')).toBe('true');
    const name = screen.getByTestId('feature-tree-row-e1-name');
    expect(name.getAttribute('style') ?? '').toMatch(/line-through/);
  });

  // ─── delete ─────────────────────────────────────────────────────────────
  it('delete button fires onDelete(id) and stops row click', () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const tree = makeTree([makeNode('e1', 'extrude')]);
    render(
      <FeatureTreeView
        lang="en"
        tree={tree}
        onSelect={onSelect}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByTestId('feature-tree-row-e1-delete'));
    expect(onDelete).toHaveBeenCalledWith('e1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  // ─── 9 kind icons ───────────────────────────────────────────────────────
  it('all 9 feature kinds render with their distinct icon', () => {
    const kinds: FeatureKind[] = [
      'extrude', 'revolve', 'sweep', 'loft',
      'linear_pattern', 'circular_pattern',
      'hole', 'fillet', 'chamfer',
    ];
    const tree = makeTree(kinds.map((k, i) => makeNode(`n${i}`, k)));
    render(<FeatureTreeView lang="en" tree={tree} onSelect={vi.fn()} />);
    const expected: Record<FeatureKind, string> = {
      extrude: '⬆',
      revolve: '↻',
      sweep: '✏',
      loft: '🥯',
      linear_pattern: '↔',
      circular_pattern: '↻',
      hole: '⊙',
      fillet: '◜',
      chamfer: '◢',
      shell: '□',
      rib: '▮',
      sweep_path: '〰',
      boolean: '∪',
    };
    kinds.forEach((k, i) => {
      const icon = screen.getByTestId(`feature-tree-row-n${i}-icon`);
      expect(icon.getAttribute('data-kind')).toBe(k);
      expect(icon.textContent).toBe(expected[k]);
    });
  });

  // ─── dependencies ───────────────────────────────────────────────────────
  it('node with dependencies shows "deps: e1, e2" label', () => {
    const tree = makeTree([
      makeNode('e1', 'extrude'),
      makeNode('e2', 'extrude'),
      makeNode('p1', 'linear_pattern', { dependencies: ['e1', 'e2'] }),
    ]);
    render(<FeatureTreeView lang="en" tree={tree} onSelect={vi.fn()} />);
    const deps = screen.getByTestId('feature-tree-row-p1-deps');
    expect(deps.textContent).toContain('deps:');
    expect(deps.textContent).toContain('e1');
    expect(deps.textContent).toContain('e2');
  });

  it('node with no dependencies omits deps label', () => {
    const tree = makeTree([makeNode('e1', 'extrude')]);
    render(<FeatureTreeView lang="en" tree={tree} onSelect={vi.fn()} />);
    expect(screen.queryByTestId('feature-tree-row-e1-deps')).not.toBeInTheDocument();
  });

  // ─── drag-drop reorder ──────────────────────────────────────────────────
  it('drag from row-0, drop on row-2 fires onReorder(0, 2)', () => {
    const onReorder = vi.fn();
    const tree = makeTree([
      makeNode('a', 'extrude'),
      makeNode('b', 'extrude'),
      makeNode('c', 'extrude'),
    ]);
    render(
      <FeatureTreeView
        lang="en"
        tree={tree}
        onSelect={vi.fn()}
        onReorder={onReorder}
      />,
    );
    const src = screen.getByTestId('feature-tree-row-a');
    const dst = screen.getByTestId('feature-tree-row-c');
    // jsdom DataTransfer shim: setData / getData / dropEffect are accepted.
    const dataTransfer = {
      data: {} as Record<string, string>,
      setData(key: string, val: string) { this.data[key] = val; },
      getData(key: string) { return this.data[key] ?? ''; },
      effectAllowed: '',
      dropEffect: '',
    };
    fireEvent.dragStart(src, { dataTransfer });
    fireEvent.dragOver(dst, { dataTransfer });
    fireEvent.drop(dst, { dataTransfer });
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(0, 2);
  });

  it('dropping on same source index does NOT fire onReorder', () => {
    const onReorder = vi.fn();
    const tree = makeTree([makeNode('a', 'extrude'), makeNode('b', 'extrude')]);
    render(
      <FeatureTreeView lang="en" tree={tree} onSelect={vi.fn()} onReorder={onReorder} />,
    );
    const src = screen.getByTestId('feature-tree-row-a');
    const dataTransfer = {
      data: {} as Record<string, string>,
      setData(k: string, v: string) { this.data[k] = v; },
      getData(k: string) { return this.data[k] ?? ''; },
      effectAllowed: '', dropEffect: '',
    };
    fireEvent.dragStart(src, { dataTransfer });
    fireEvent.drop(src, { dataTransfer });
    expect(onReorder).not.toHaveBeenCalled();
  });

  // ─── optional callbacks gating ──────────────────────────────────────────
  it('no onToggleSuppress → suppress button is not rendered', () => {
    const tree = makeTree([makeNode('e1', 'extrude')]);
    render(<FeatureTreeView lang="en" tree={tree} onSelect={vi.fn()} />);
    expect(screen.queryByTestId('feature-tree-row-e1-suppress')).not.toBeInTheDocument();
  });

  it('no onDelete → delete button is not rendered', () => {
    const tree = makeTree([makeNode('e1', 'extrude')]);
    render(<FeatureTreeView lang="en" tree={tree} onSelect={vi.fn()} />);
    expect(screen.queryByTestId('feature-tree-row-e1-delete')).not.toBeInTheDocument();
  });

  it('no onReorder → drag handle is not rendered and row is not draggable', () => {
    const tree = makeTree([makeNode('e1', 'extrude')]);
    render(<FeatureTreeView lang="en" tree={tree} onSelect={vi.fn()} />);
    expect(screen.queryByTestId('feature-tree-row-e1-handle')).not.toBeInTheDocument();
    expect(screen.getByTestId('feature-tree-row-e1').getAttribute('draggable')).toBe('false');
  });

  // ─── i18n (empty-state covers all 6 lang dicts) ─────────────────────────
  it.each([
    ['ko', /피처/],
    ['en', /Add feature/i],
    ['ja', /フィーチャ/],
    ['zh', /添加特征/],
    ['es', /función/i],
    ['ar', /ميزة/],
  ] as const)('lang=%s empty state uses localized copy', (lang, pattern) => {
    render(<FeatureTreeView lang={lang} tree={makeTree([])} onSelect={vi.fn()} />);
    expect(screen.getByTestId('feature-tree-empty').textContent ?? '').toMatch(pattern);
  });
});
