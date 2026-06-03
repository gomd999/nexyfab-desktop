/** @vitest-environment jsdom */
/**
 * FeatureTreeMergePanel — standalone semantic-merge UX panel tests.
 *
 * Covers:
 *   - panel renders with both selectors + 5 strategy radios
 *   - default strategy is semantic_dedup
 *   - all 5 strategies reachable via radio clicks
 *   - merge button populates result table
 *   - result table surfaces count/added/removed/merged/deduped/replaced/warnings
 *   - accept button fires onMerged with the merged tree
 *   - accept disabled when onMerged absent
 *   - error surfaces when trees catalogue is empty
 *   - semantic_dedup of two identical boxes shows deduped=1, count=1
 *   - structural merge of two distinct nodes shows added=1, count=2
 *   - last_wins on shared id shows merged=1, count=1
 *   - composite suffix-renamed collision surfaces warnings>=1
 *   - changing base/other selection re-runs merge with new inputs
 *   - 6-lang i18n title rendering (ko/en/ja/zh/es/ar)
 *   - ar lang sets dir=rtl
 *   - base/other props prepended to catalogue when not in trees
 *   - 5 radio strategies render with correct testids
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import FeatureTreeMergePanel from '@/app/[lang]/shape-generator/sketch/FeatureTreeMergePanel';
import type { FeatureNode, FeatureTree } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

// ─── fixtures ─────────────────────────────────────────────────────────────

function extrudeNode(id: string, depth = 3, w = 10, h = 5): FeatureNode {
  const payload: ExtrudeFeature = {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
    depth,
    direction: 'one_sided',
    mode: 'add',
  };
  return { id, name: id, dependencies: [], payload };
}

function tree(nodes: FeatureNode[]): FeatureTree {
  return { nodes };
}

const TREE_A = tree([extrudeNode('a', 3)]);
const TREE_B = tree([extrudeNode('b', 5)]);
const TREE_A_DUP = tree([extrudeNode('a2', 3, 10, 5)]); // identical payload to TREE_A
const TREE_SHARED_ID = tree([extrudeNode('a', 7)]); // same id as TREE_A, diff payload

// ─── tests ────────────────────────────────────────────────────────────────

describe('FeatureTreeMergePanel — render', () => {
  it('renders the panel with base/other selectors and 5 strategy radios', () => {
    render(
      <FeatureTreeMergePanel lang="en" base={TREE_A} other={TREE_B} trees={[TREE_A, TREE_B]} />,
    );
    expect(screen.getByTestId('solver-tree-merge-panel')).toBeInTheDocument();
    expect(screen.getByTestId('solver-tree-merge-base-select')).toBeInTheDocument();
    expect(screen.getByTestId('solver-tree-merge-other-select')).toBeInTheDocument();
    for (const s of ['structural', 'semantic_dedup', 'last_wins', 'first_wins', 'composite']) {
      expect(screen.getByTestId(`solver-tree-merge-strategy-${s}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('solver-tree-merge-merge-button')).toBeInTheDocument();
  });

  it('default strategy is semantic_dedup', () => {
    render(
      <FeatureTreeMergePanel lang="en" base={TREE_A} other={TREE_B} trees={[TREE_A, TREE_B]} />,
    );
    const radio = screen.getByTestId(
      'solver-tree-merge-strategy-semantic_dedup',
    ) as HTMLInputElement;
    expect(radio.checked).toBe(true);
  });
});

describe('FeatureTreeMergePanel — strategy reachability', () => {
  it.each(['structural', 'semantic_dedup', 'last_wins', 'first_wins', 'composite'] as const)(
    'radio %s can be selected and is checked',
    (strat) => {
      cleanup();
      render(
        <FeatureTreeMergePanel lang="en" base={TREE_A} other={TREE_B} trees={[TREE_A, TREE_B]} />,
      );
      const radio = screen.getByTestId(
        `solver-tree-merge-strategy-${strat}`,
      ) as HTMLInputElement;
      fireEvent.click(radio);
      expect(radio.checked).toBe(true);
    },
  );
});

describe('FeatureTreeMergePanel — merge execution', () => {
  it('merge button populates the result table', () => {
    render(
      <FeatureTreeMergePanel lang="en" base={TREE_A} other={TREE_B} trees={[TREE_A, TREE_B]} />,
    );
    expect(screen.queryByTestId('solver-tree-merge-result')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('solver-tree-merge-merge-button'));
    expect(screen.getByTestId('solver-tree-merge-result')).toBeInTheDocument();
    expect(screen.getByTestId('solver-tree-merge-result-count')).toBeInTheDocument();
    expect(screen.getByTestId('solver-tree-merge-result-added')).toBeInTheDocument();
    expect(screen.getByTestId('solver-tree-merge-result-removed')).toBeInTheDocument();
    expect(screen.getByTestId('solver-tree-merge-result-merged')).toBeInTheDocument();
    expect(screen.getByTestId('solver-tree-merge-result-deduped')).toBeInTheDocument();
    expect(screen.getByTestId('solver-tree-merge-result-replaced')).toBeInTheDocument();
    expect(screen.getByTestId('solver-tree-merge-result-warnings')).toBeInTheDocument();
  });

  it('semantic_dedup of two identical boxes → deduped=1, count=1', () => {
    render(
      <FeatureTreeMergePanel
        lang="en"
        base={TREE_A}
        other={TREE_A_DUP}
        trees={[TREE_A, TREE_A_DUP]}
      />,
    );
    fireEvent.click(screen.getByTestId('solver-tree-merge-merge-button'));
    expect(screen.getByTestId('solver-tree-merge-result-count-value').textContent).toBe('1');
    expect(screen.getByTestId('solver-tree-merge-result-deduped-value').textContent).toBe('1');
    expect(screen.getByTestId('solver-tree-merge-result-removed-value').textContent).toBe('1');
  });

  it('structural merge of two distinct nodes → added=1, count=2', () => {
    render(
      <FeatureTreeMergePanel lang="en" base={TREE_A} other={TREE_B} trees={[TREE_A, TREE_B]} />,
    );
    fireEvent.click(screen.getByTestId('solver-tree-merge-strategy-structural'));
    fireEvent.click(screen.getByTestId('solver-tree-merge-merge-button'));
    expect(screen.getByTestId('solver-tree-merge-result-count-value').textContent).toBe('2');
    expect(screen.getByTestId('solver-tree-merge-result-added-value').textContent).toBe('1');
    expect(screen.getByTestId('solver-tree-merge-result-merged-value').textContent).toBe('0');
  });

  it('last_wins on shared id → merged=1, count=1', () => {
    render(
      <FeatureTreeMergePanel
        lang="en"
        base={TREE_A}
        other={TREE_SHARED_ID}
        trees={[TREE_A, TREE_SHARED_ID]}
      />,
    );
    fireEvent.click(screen.getByTestId('solver-tree-merge-strategy-last_wins'));
    fireEvent.click(screen.getByTestId('solver-tree-merge-merge-button'));
    expect(screen.getByTestId('solver-tree-merge-result-count-value').textContent).toBe('1');
    expect(screen.getByTestId('solver-tree-merge-result-merged-value').textContent).toBe('1');
    expect(screen.getByTestId('solver-tree-merge-result-replaced-value').textContent).toBe('1');
  });

  it('composite suffix-renames id collision and surfaces a warning', () => {
    render(
      <FeatureTreeMergePanel
        lang="en"
        base={TREE_A}
        other={TREE_SHARED_ID}
        trees={[TREE_A, TREE_SHARED_ID]}
      />,
    );
    fireEvent.click(screen.getByTestId('solver-tree-merge-strategy-composite'));
    fireEvent.click(screen.getByTestId('solver-tree-merge-merge-button'));
    // composite keeps both, suffix-renaming the second 'a' → count = 2
    expect(screen.getByTestId('solver-tree-merge-result-count-value').textContent).toBe('2');
    expect(
      Number(screen.getByTestId('solver-tree-merge-result-warnings-value').textContent ?? '0'),
    ).toBeGreaterThanOrEqual(1);
  });

  it('first_wins keeps base for shared id, no replacement of base by other', () => {
    render(
      <FeatureTreeMergePanel
        lang="en"
        base={TREE_A}
        other={TREE_SHARED_ID}
        trees={[TREE_A, TREE_SHARED_ID]}
      />,
    );
    fireEvent.click(screen.getByTestId('solver-tree-merge-strategy-first_wins'));
    fireEvent.click(screen.getByTestId('solver-tree-merge-merge-button'));
    expect(screen.getByTestId('solver-tree-merge-result-count-value').textContent).toBe('1');
    expect(screen.getByTestId('solver-tree-merge-result-replaced-value').textContent).toBe('1');
  });
});

describe('FeatureTreeMergePanel — accept callback', () => {
  it('accept button fires onMerged with the merged tree', () => {
    const onMerged = vi.fn();
    render(
      <FeatureTreeMergePanel
        lang="en"
        base={TREE_A}
        other={TREE_B}
        trees={[TREE_A, TREE_B]}
        onMerged={onMerged}
      />,
    );
    fireEvent.click(screen.getByTestId('solver-tree-merge-strategy-structural'));
    fireEvent.click(screen.getByTestId('solver-tree-merge-merge-button'));
    fireEvent.click(screen.getByTestId('solver-tree-merge-accept-button'));
    expect(onMerged).toHaveBeenCalledTimes(1);
    const arg = onMerged.mock.calls[0]?.[0] as FeatureTree;
    expect(arg.nodes).toHaveLength(2);
    expect(arg.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });

  it('accept button disabled when onMerged absent', () => {
    render(
      <FeatureTreeMergePanel lang="en" base={TREE_A} other={TREE_B} trees={[TREE_A, TREE_B]} />,
    );
    fireEvent.click(screen.getByTestId('solver-tree-merge-merge-button'));
    const btn = screen.getByTestId('solver-tree-merge-accept-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('accept does nothing before a successful merge', () => {
    // Accept button doesn't exist until result is set, so just verify the
    // result section is absent on initial render.
    const onMerged = vi.fn();
    render(
      <FeatureTreeMergePanel
        lang="en"
        base={TREE_A}
        other={TREE_B}
        trees={[TREE_A, TREE_B]}
        onMerged={onMerged}
      />,
    );
    expect(screen.queryByTestId('solver-tree-merge-accept-button')).not.toBeInTheDocument();
    expect(onMerged).not.toHaveBeenCalled();
  });
});

describe('FeatureTreeMergePanel — selection changes', () => {
  it('changing base index re-runs merge with the new base', () => {
    render(
      <FeatureTreeMergePanel lang="en" trees={[TREE_A, TREE_B, TREE_SHARED_ID]} />,
    );
    // Initial: base=A (index 0), other=B (index 1) — distinct, semantic_dedup
    // leaves both because payloads differ.
    fireEvent.click(screen.getByTestId('solver-tree-merge-merge-button'));
    expect(screen.getByTestId('solver-tree-merge-result-count-value').textContent).toBe('2');
    // Switch base to index 2 (TREE_SHARED_ID, id='a' depth=7) — distinct from
    // TREE_B's id='b' depth=5 → still no dedup, count still 2.
    fireEvent.change(screen.getByTestId('solver-tree-merge-base-select'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByTestId('solver-tree-merge-merge-button'));
    expect(screen.getByTestId('solver-tree-merge-result-count-value').textContent).toBe('2');
  });

  it('changing other index updates the merge result', () => {
    render(<FeatureTreeMergePanel lang="en" trees={[TREE_A, TREE_B, TREE_A_DUP]} />);
    // base=A, other=B distinct → count 2
    fireEvent.click(screen.getByTestId('solver-tree-merge-merge-button'));
    expect(screen.getByTestId('solver-tree-merge-result-count-value').textContent).toBe('2');
    // switch other to TREE_A_DUP (index 2), identical payload to A → dedup to 1
    fireEvent.change(screen.getByTestId('solver-tree-merge-other-select'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByTestId('solver-tree-merge-merge-button'));
    expect(screen.getByTestId('solver-tree-merge-result-count-value').textContent).toBe('1');
  });
});

describe('FeatureTreeMergePanel — catalogue assembly', () => {
  it('base/other props are prepended to catalogue when missing from trees[]', () => {
    render(<FeatureTreeMergePanel lang="en" base={TREE_A} other={TREE_B} />);
    const sel = screen.getByTestId('solver-tree-merge-base-select') as HTMLSelectElement;
    // Two trees should be selectable even though trees prop was undefined.
    expect(sel.options.length).toBe(2);
  });

  it('empty catalogue → merge surfaces error message', () => {
    render(<FeatureTreeMergePanel lang="en" />);
    fireEvent.click(screen.getByTestId('solver-tree-merge-merge-button'));
    expect(screen.getByTestId('solver-tree-merge-error')).toBeInTheDocument();
  });
});

describe('FeatureTreeMergePanel — i18n', () => {
  it.each([
    ['ko', /트리 병합/],
    ['en', /Merge trees/],
    ['ja', /ツリーの統合/],
    ['zh', /合并树/],
    ['es', /Fusionar árboles/],
    ['ar', /دمج الأشجار/],
  ] as const)('lang=%s renders localized title', (lang, pattern) => {
    cleanup();
    render(
      <FeatureTreeMergePanel
        lang={lang}
        base={TREE_A}
        other={TREE_B}
        trees={[TREE_A, TREE_B]}
      />,
    );
    expect(screen.getByTestId('solver-tree-merge-panel').textContent ?? '').toMatch(pattern);
  });

  it('ar lang sets dir=rtl on root', () => {
    render(<FeatureTreeMergePanel lang="ar" trees={[TREE_A]} />);
    expect(screen.getByTestId('solver-tree-merge-panel').getAttribute('dir')).toBe('rtl');
  });

  it('en lang sets dir=ltr on root', () => {
    render(<FeatureTreeMergePanel lang="en" trees={[TREE_A]} />);
    expect(screen.getByTestId('solver-tree-merge-panel').getAttribute('dir')).toBe('ltr');
  });
});
