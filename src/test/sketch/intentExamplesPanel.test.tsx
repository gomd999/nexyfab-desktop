/** @vitest-environment jsdom */
/**
 * IntentExamplesPanel — Phase 3.AI.UI tests.
 *
 * Covers:
 *   - 4 category headings render (Box / Cylinder / Patterns / Modify).
 *   - Each category exposes at least one clickable example chip.
 *   - Click → onSelectExample is invoked with the literal example `in` string.
 *   - 6-lang category label rendering (ko / en / ja / zh / es / ar).
 *   - All 12 INTENT_KINDS appear as a chip somewhere — guarantees the
 *     `INTENT_EXAMPLES` Record stays exhaustive vs. INTENT_KINDS.
 *   - Category-to-kind mapping is exhaustive (`INTENT_CATEGORY_MAP` covers
 *     every INTENT_KIND with no extras and no missing entries).
 *   - RTL `dir` attribute is set for ar.
 *   - testid format: planner-intent-example-{kind}-{idx}.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import IntentExamplesPanel, {
  INTENT_CATEGORY_MAP,
} from '@/app/[lang]/shape-generator/sketch/IntentExamplesPanel';
import { INTENT_KINDS } from '@/lib/ai/featureTreeIntentDetector';
import { INTENT_EXAMPLES } from '@/lib/ai/llmPrompt';

const CATEGORIES = ['Box', 'Cylinder', 'Patterns', 'Modify'] as const;

describe('IntentExamplesPanel', () => {
  it('renders the panel root with the expected testid', () => {
    render(<IntentExamplesPanel lang="en" onSelectExample={vi.fn()} />);
    expect(screen.getByTestId('planner-intent-examples-panel')).toBeInTheDocument();
  });

  it('renders all 4 categories (Box / Cylinder / Patterns / Modify)', () => {
    render(<IntentExamplesPanel lang="en" onSelectExample={vi.fn()} />);
    for (const cat of CATEGORIES) {
      expect(screen.getByTestId(`planner-intent-category-${cat}`)).toBeInTheDocument();
    }
  });

  it('every INTENT_KIND has at least one rendered example chip', () => {
    render(<IntentExamplesPanel lang="en" onSelectExample={vi.fn()} />);
    for (const kind of INTENT_KINDS) {
      const chip = screen.queryByTestId(`planner-intent-example-${kind}-0`);
      expect(chip).not.toBeNull();
    }
  });

  it('INTENT_CATEGORY_MAP covers all 12 INTENT_KINDS (no missing entries)', () => {
    for (const kind of INTENT_KINDS) {
      expect(INTENT_CATEGORY_MAP[kind]).toBeDefined();
      expect(CATEGORIES).toContain(INTENT_CATEGORY_MAP[kind]);
    }
    expect(Object.keys(INTENT_CATEGORY_MAP).sort()).toEqual([...INTENT_KINDS].sort());
  });

  it('total chip count equals total INTENT_EXAMPLES entries across kinds', () => {
    render(<IntentExamplesPanel lang="en" onSelectExample={vi.fn()} />);
    let expected = 0;
    for (const kind of INTENT_KINDS) {
      expected += INTENT_EXAMPLES[kind].length;
    }
    // Count rendered chips by querying for every (kind, idx) pair.
    let actual = 0;
    for (const kind of INTENT_KINDS) {
      const examples = INTENT_EXAMPLES[kind];
      for (let i = 0; i < examples.length; i++) {
        if (screen.queryByTestId(`planner-intent-example-${kind}-${i}`)) actual++;
      }
    }
    expect(actual).toBe(expected);
  });

  it('clicking an example chip invokes onSelectExample with the literal `in` text', () => {
    const onSelect = vi.fn();
    render(<IntentExamplesPanel lang="en" onSelectExample={onSelect} />);
    const firstCylinderExample = INTENT_EXAMPLES.create_cylinder[0]!;
    const chip = screen.getByTestId('planner-intent-example-create_cylinder-0');
    fireEvent.click(chip);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(firstCylinderExample.in);
  });

  it('clicking a Box chip invokes onSelectExample with that example text', () => {
    const onSelect = vi.fn();
    render(<IntentExamplesPanel lang="en" onSelectExample={onSelect} />);
    const boxExample = INTENT_EXAMPLES.create_box_with_holes[0]!;
    fireEvent.click(screen.getByTestId('planner-intent-example-create_box_with_holes-0'));
    expect(onSelect).toHaveBeenCalledWith(boxExample.in);
  });

  it('clicking multiple chips invokes onSelectExample for each click', () => {
    const onSelect = vi.fn();
    render(<IntentExamplesPanel lang="en" onSelectExample={onSelect} />);
    fireEvent.click(screen.getByTestId('planner-intent-example-create_cylinder-0'));
    fireEvent.click(screen.getByTestId('planner-intent-example-add_fillet_to_last-0'));
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect.mock.calls[0]![0]).toBe(INTENT_EXAMPLES.create_cylinder[0]!.in);
    expect(onSelect.mock.calls[1]![0]).toBe(INTENT_EXAMPLES.add_fillet_to_last[0]!.in);
  });

  it('renders Korean category labels when lang="ko"', () => {
    render(<IntentExamplesPanel lang="ko" onSelectExample={vi.fn()} />);
    const box = screen.getByTestId('planner-intent-category-Box');
    const cyl = screen.getByTestId('planner-intent-category-Cylinder');
    const pat = screen.getByTestId('planner-intent-category-Patterns');
    const mod = screen.getByTestId('planner-intent-category-Modify');
    expect(box.textContent).toContain('박스');
    expect(cyl.textContent).toContain('원기둥');
    expect(pat.textContent).toContain('패턴');
    expect(mod.textContent).toContain('수정');
  });

  it('renders Japanese category labels when lang="ja"', () => {
    render(<IntentExamplesPanel lang="ja" onSelectExample={vi.fn()} />);
    expect(screen.getByTestId('planner-intent-category-Box').textContent).toContain('ボックス');
    expect(screen.getByTestId('planner-intent-category-Cylinder').textContent).toContain('シリンダー');
    expect(screen.getByTestId('planner-intent-category-Patterns').textContent).toContain('パターン');
    expect(screen.getByTestId('planner-intent-category-Modify').textContent).toContain('修正');
  });

  it('renders Chinese category labels when lang="zh"', () => {
    render(<IntentExamplesPanel lang="zh" onSelectExample={vi.fn()} />);
    expect(screen.getByTestId('planner-intent-category-Box').textContent).toContain('盒子');
    expect(screen.getByTestId('planner-intent-category-Cylinder').textContent).toContain('圆柱');
    expect(screen.getByTestId('planner-intent-category-Patterns').textContent).toContain('阵列');
    expect(screen.getByTestId('planner-intent-category-Modify').textContent).toContain('修改');
  });

  it('renders Spanish category labels when lang="es"', () => {
    render(<IntentExamplesPanel lang="es" onSelectExample={vi.fn()} />);
    expect(screen.getByTestId('planner-intent-category-Box').textContent).toContain('Caja');
    expect(screen.getByTestId('planner-intent-category-Cylinder').textContent).toContain('Cilindro');
    expect(screen.getByTestId('planner-intent-category-Patterns').textContent).toContain('Patrones');
    expect(screen.getByTestId('planner-intent-category-Modify').textContent).toContain('Modificar');
  });

  it('renders Arabic category labels and RTL dir when lang="ar"', () => {
    render(<IntentExamplesPanel lang="ar" onSelectExample={vi.fn()} />);
    expect(screen.getByTestId('planner-intent-category-Box').textContent).toContain('صندوق');
    expect(screen.getByTestId('planner-intent-examples-panel').getAttribute('dir')).toBe('rtl');
  });

  it('non-ar languages render LTR dir', () => {
    render(<IntentExamplesPanel lang="en" onSelectExample={vi.fn()} />);
    expect(screen.getByTestId('planner-intent-examples-panel').getAttribute('dir')).toBe('ltr');
  });

  it('Box category contains the create_box_with_* kinds plus the freeform-solid kinds', () => {
    const boxKinds = INTENT_KINDS.filter((k) => INTENT_CATEGORY_MAP[k] === 'Box');
    expect(boxKinds.sort()).toEqual(
      [
        'create_box_with_chamfer',
        'create_box_with_fillet',
        'create_box_with_holes',
        'create_box_with_pocket',
        'create_sketch_extrude',
        'build_part',
      ].sort(),
    );
  });

  it('Modify category contains the last-feature operations', () => {
    const modKinds = INTENT_KINDS.filter((k) => INTENT_CATEGORY_MAP[k] === 'Modify');
    expect(modKinds.sort()).toEqual(
      ['add_chamfer_to_last', 'add_fillet_to_last', 'add_feature_to_last', 'update_last_param', 'remove_last'].sort(),
    );
  });

  it('chip text equals the INTENT_EXAMPLES `in` value verbatim', () => {
    render(<IntentExamplesPanel lang="en" onSelectExample={vi.fn()} />);
    const expected = INTENT_EXAMPLES.create_box_with_holes[0]!.in;
    const chip = screen.getByTestId('planner-intent-example-create_box_with_holes-0');
    expect(chip.textContent).toBe(expected);
  });
});
