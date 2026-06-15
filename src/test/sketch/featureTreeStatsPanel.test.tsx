/** @vitest-environment jsdom */
/**
 * FeatureTreeStatsPanel — Phase 2.9 UX standalone panel tests.
 *
 * Covers:
 *   - empty tree → empty state (0/0/empty bbox surrogate)
 *   - 1 extrude box → volume / surface area / bbox / node count
 *   - bbox formatting (min → max with unit suffix)
 *   - centerOfMass formatting matches bbox center
 *   - default density-less render does NOT show mass row
 *   - material steel selection → mass surfaces using DEFAULT_DENSITIES.steel
 *   - material aluminum selection → mass updates
 *   - material none selection → mass hidden again
 *   - density prop + 'custom' material → mass derived from prop
 *   - unit mm → cm divides volume by 1000, area by 100, lengths by 10
 *   - unit mm → inch divides by mm³→in³ factor
 *   - selectedNodeId set → "Selected feature" sub-section + per-node stats
 *   - selectedNodeId unset → no sub-section
 *   - selectedNodeId pointing at non-existent node → no sub-section
 *   - 6-lang i18n title rendering (ko/en/ja/zh/es/ar)
 *   - ar lang sets dir=rtl
 *   - re-render with a new tree updates the displayed numbers
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import FeatureTreeStatsPanel from '@/app/[lang]/shape-generator/sketch/FeatureTreeStatsPanel';
import type { FeatureNode, FeatureTree } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import { DEFAULT_DENSITIES } from '@/lib/assembly/bomExport';

// ─── fixtures ─────────────────────────────────────────────────────────────

function boxLoop(w: number, h: number): { x: number; y: number }[] {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

function extrudeBoxNode(
  id: string,
  w: number,
  h: number,
  d: number,
): FeatureNode {
  const payload: ExtrudeFeature = {
    kind: 'extrude',
    loop: boxLoop(w, h),
    depth: d,
    direction: 'one_sided',
    mode: 'add',
  };
  return { id, name: id, dependencies: [], payload };
}

function makeTree(nodes: FeatureNode[]): FeatureTree {
  return { nodes };
}

function textOf(testid: string): string {
  return screen.getByTestId(testid).textContent ?? '';
}

// ─── tests ────────────────────────────────────────────────────────────────

describe('FeatureTreeStatsPanel — empty state', () => {
  it('empty tree renders panel + empty state', () => {
    render(<FeatureTreeStatsPanel lang="en" tree={makeTree([])} />);
    expect(screen.getByTestId('feature-tree-stats-panel')).toBeInTheDocument();
    expect(screen.getByTestId('feature-tree-stats-empty')).toBeInTheDocument();
    expect(screen.getByTestId('feature-tree-stats-empty').textContent).toMatch(
      /Add a feature/i,
    );
    // Aggregate rows must NOT appear when the tree is empty.
    expect(screen.queryByTestId('feature-tree-stats-total-volume')).not.toBeInTheDocument();
    expect(screen.queryByTestId('feature-tree-stats-bbox')).not.toBeInTheDocument();
  });
});

describe('FeatureTreeStatsPanel — single extrude box (10×10×10)', () => {
  function setup() {
    return render(
      <FeatureTreeStatsPanel
        lang="en"
        tree={makeTree([extrudeBoxNode('e1', 10, 10, 10)])}
      />,
    );
  }

  it('total volume = 1000 mm³', () => {
    setup();
    const txt = textOf('feature-tree-stats-total-volume');
    expect(txt).toMatch(/1000/);
    expect(txt).toMatch(/mm³/);
  });

  it('surface area = 6 × 100 = 600 mm²', () => {
    setup();
    const txt = textOf('feature-tree-stats-surface-area');
    expect(txt).toMatch(/600/);
    expect(txt).toMatch(/mm²/);
  });

  it('bbox shows 0,0,0 → 10,10,10 with mm suffix', () => {
    setup();
    const txt = textOf('feature-tree-stats-bbox');
    expect(txt).toMatch(/0,\s*0,\s*0/);
    expect(txt).toMatch(/10,\s*10,\s*10/);
    expect(txt).toMatch(/→/);
    expect(txt).toMatch(/mm/);
  });

  it('center of mass = (5, 5, 5)', () => {
    setup();
    const txt = textOf('feature-tree-stats-center-of-mass');
    expect(txt).toMatch(/5/);
    expect(txt).toMatch(/\(/);
    expect(txt).toMatch(/\)/);
  });

  it('node count = 1', () => {
    setup();
    expect(textOf('feature-tree-stats-node-count')).toMatch(/1/);
  });

  it('mass row hidden by default (material=none, no density prop)', () => {
    setup();
    expect(screen.queryByTestId('feature-tree-stats-mass')).not.toBeInTheDocument();
  });
});

describe('FeatureTreeStatsPanel — material selection', () => {
  it('selecting steel surfaces mass row using DEFAULT_DENSITIES.steel', () => {
    render(
      <FeatureTreeStatsPanel
        lang="en"
        tree={makeTree([extrudeBoxNode('e1', 10, 10, 10)])}
      />,
    );
    const select = screen.getByTestId(
      'feature-tree-stats-material-select',
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'steel' } });
    const massRow = screen.getByTestId('feature-tree-stats-mass');
    // 1000 mm³ * 0.00785 g/mm³ = 7.85 g
    const expected = 1000 * DEFAULT_DENSITIES.steel!;
    expect(massRow.textContent).toMatch(
      new RegExp(expected.toFixed(2).replace(/\.?0+$/, '')),
    );
    expect(massRow.textContent).toMatch(/g/);
  });

  it('switching steel → aluminum updates mass', () => {
    render(
      <FeatureTreeStatsPanel
        lang="en"
        tree={makeTree([extrudeBoxNode('e1', 10, 10, 10)])}
      />,
    );
    const select = screen.getByTestId(
      'feature-tree-stats-material-select',
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'aluminum' } });
    const txt = textOf('feature-tree-stats-mass');
    const expected = 1000 * DEFAULT_DENSITIES.aluminum!; // 2.7
    expect(txt).toMatch(new RegExp(expected.toFixed(2).replace(/\.?0+$/, '')));
  });

  it('switching aluminum → none hides the mass row', () => {
    render(
      <FeatureTreeStatsPanel
        lang="en"
        tree={makeTree([extrudeBoxNode('e1', 10, 10, 10)])}
      />,
    );
    const select = screen.getByTestId(
      'feature-tree-stats-material-select',
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'aluminum' } });
    expect(screen.getByTestId('feature-tree-stats-mass')).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'none' } });
    expect(screen.queryByTestId('feature-tree-stats-mass')).not.toBeInTheDocument();
  });

  it('density prop + default material=custom → mass derived from prop', () => {
    // density 0.001 g/mm³ → 1000 mm³ × 0.001 = 1 g
    render(
      <FeatureTreeStatsPanel
        lang="en"
        tree={makeTree([extrudeBoxNode('e1', 10, 10, 10)])}
        density={0.001}
      />,
    );
    expect(screen.getByTestId('feature-tree-stats-mass').textContent).toMatch(/1\s*g/);
  });
});

describe('FeatureTreeStatsPanel — unit conversion', () => {
  it('mm → cm divides volume by 1000 (1000 mm³ → 1 cm³)', () => {
    render(
      <FeatureTreeStatsPanel
        lang="en"
        tree={makeTree([extrudeBoxNode('e1', 10, 10, 10)])}
      />,
    );
    fireEvent.click(screen.getByTestId('feature-tree-stats-unit-toggle-cm'));
    const txt = textOf('feature-tree-stats-total-volume');
    expect(txt).toMatch(/1\s*cm³/);
    expect(txt).not.toMatch(/mm³/);
  });

  it('mm → cm divides surface area by 100 (600 mm² → 6 cm²)', () => {
    render(
      <FeatureTreeStatsPanel
        lang="en"
        tree={makeTree([extrudeBoxNode('e1', 10, 10, 10)])}
      />,
    );
    fireEvent.click(screen.getByTestId('feature-tree-stats-unit-toggle-cm'));
    const txt = textOf('feature-tree-stats-surface-area');
    expect(txt).toMatch(/6\s*cm²/);
  });

  it('mm → cm divides bbox lengths by 10 (10 mm → 1 cm)', () => {
    render(
      <FeatureTreeStatsPanel
        lang="en"
        tree={makeTree([extrudeBoxNode('e1', 10, 10, 10)])}
      />,
    );
    fireEvent.click(screen.getByTestId('feature-tree-stats-unit-toggle-cm'));
    const txt = textOf('feature-tree-stats-bbox');
    // After /10: min stays 0,0,0; max becomes 1,1,1
    expect(txt).toMatch(/1,\s*1,\s*1/);
    expect(txt).toMatch(/cm/);
  });

  it('mm → inch divides volume by 16387.064', () => {
    render(
      <FeatureTreeStatsPanel
        lang="en"
        tree={makeTree([extrudeBoxNode('e1', 100, 100, 100)])}
      />,
    );
    fireEvent.click(screen.getByTestId('feature-tree-stats-unit-toggle-inch'));
    const txt = textOf('feature-tree-stats-total-volume');
    // 1_000_000 mm³ / 16387.064 ≈ 61.024 in³
    expect(txt).toMatch(/61\./);
    expect(txt).toMatch(/in³/);
  });

  it('unit toggle marks the active button via aria-pressed', () => {
    render(
      <FeatureTreeStatsPanel
        lang="en"
        tree={makeTree([extrudeBoxNode('e1', 10, 10, 10)])}
      />,
    );
    expect(
      screen.getByTestId('feature-tree-stats-unit-toggle-mm').getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(screen.getByTestId('feature-tree-stats-unit-toggle-cm'));
    expect(
      screen.getByTestId('feature-tree-stats-unit-toggle-cm').getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByTestId('feature-tree-stats-unit-toggle-mm').getAttribute('aria-pressed'),
    ).toBe('false');
  });
});

describe('FeatureTreeStatsPanel — selected node sub-section', () => {
  it('selectedNodeId set → "Selected feature" sub-section appears', () => {
    render(
      <FeatureTreeStatsPanel
        lang="en"
        tree={makeTree([
          extrudeBoxNode('e1', 10, 10, 10),
          extrudeBoxNode('e2', 5, 5, 5),
        ])}
        selectedNodeId="e2"
      />,
    );
    expect(screen.getByTestId('feature-tree-stats-selected')).toBeInTheDocument();
    expect(textOf('feature-tree-stats-selected-kind')).toMatch(/extrude/);
    // e2 volume: 5*5*5 = 125
    expect(textOf('feature-tree-stats-selected-volume')).toMatch(/125/);
    // e2 surface area: 2*25 + 4*5*5 = 50 + 100 = 150
    expect(textOf('feature-tree-stats-selected-surface-area')).toMatch(/150/);
    // bbox: 0,0,0 → 5,5,5
    expect(textOf('feature-tree-stats-selected-bbox')).toMatch(/5,\s*5,\s*5/);
  });

  it('selectedNodeId omitted → sub-section absent', () => {
    render(
      <FeatureTreeStatsPanel
        lang="en"
        tree={makeTree([extrudeBoxNode('e1', 10, 10, 10)])}
      />,
    );
    expect(screen.queryByTestId('feature-tree-stats-selected')).not.toBeInTheDocument();
  });

  it('selectedNodeId pointing at non-existent node → sub-section absent', () => {
    render(
      <FeatureTreeStatsPanel
        lang="en"
        tree={makeTree([extrudeBoxNode('e1', 10, 10, 10)])}
        selectedNodeId="missing"
      />,
    );
    expect(screen.queryByTestId('feature-tree-stats-selected')).not.toBeInTheDocument();
  });
});

describe('FeatureTreeStatsPanel — i18n', () => {
  it.each([
    ['ko', /통계/],
    ['en', /Statistics/],
    ['ja', /統計/],
    ['zh', /统计/],
    ['es', /Estadísticas/],
    ['ar', /إحصائيات/],
  ] as const)('lang=%s renders localized title', (lang, pattern) => {
    cleanup();
    render(
      <FeatureTreeStatsPanel
        lang={lang}
        tree={makeTree([extrudeBoxNode('e1', 10, 10, 10)])}
      />,
    );
    const panel = screen.getByTestId('feature-tree-stats-panel');
    expect(panel.textContent ?? '').toMatch(pattern);
  });

  it('ar lang sets dir=rtl on root', () => {
    render(
      <FeatureTreeStatsPanel lang="ar" tree={makeTree([])} />,
    );
    expect(screen.getByTestId('feature-tree-stats-panel').getAttribute('dir')).toBe('rtl');
  });

  it('en lang sets dir=ltr on root', () => {
    render(<FeatureTreeStatsPanel lang="en" tree={makeTree([])} />);
    expect(screen.getByTestId('feature-tree-stats-panel').getAttribute('dir')).toBe('ltr');
  });
});

describe('FeatureTreeStatsPanel — reactive updates', () => {
  it('changing the tree prop updates the displayed numbers', () => {
    const { rerender } = render(
      <FeatureTreeStatsPanel
        lang="en"
        tree={makeTree([extrudeBoxNode('e1', 10, 10, 10)])}
      />,
    );
    expect(textOf('feature-tree-stats-total-volume')).toMatch(/1000/);
    rerender(
      <FeatureTreeStatsPanel
        lang="en"
        tree={makeTree([
          extrudeBoxNode('e1', 10, 10, 10),
          extrudeBoxNode('e2', 10, 10, 10),
        ])}
      />,
    );
    expect(textOf('feature-tree-stats-total-volume')).toMatch(/2000/);
    expect(textOf('feature-tree-stats-node-count')).toMatch(/2/);
  });

  it('omitting a custom density does not crash when material=custom', () => {
    // Guard against undefined density × custom: mass row should hide.
    render(<FeatureTreeStatsPanel lang="en" tree={makeTree([extrudeBoxNode('e1', 10, 10, 10)])} />);
    const select = screen.getByTestId(
      'feature-tree-stats-material-select',
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'custom' } });
    expect(screen.queryByTestId('feature-tree-stats-mass')).not.toBeInTheDocument();
  });
});

describe('FeatureTreeStatsPanel — material catalogue', () => {
  it('dropdown lists all DEFAULT_DENSITIES materials plus none + custom', () => {
    render(<FeatureTreeStatsPanel lang="en" tree={makeTree([])} />);
    const select = screen.getByTestId(
      'feature-tree-stats-material-select',
    ) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain('none');
    expect(optionValues).toContain('custom');
    for (const mat of Object.keys(DEFAULT_DENSITIES)) {
      expect(optionValues).toContain(mat);
    }
  });
});
