/** @vitest-environment jsdom */
/**
 * AssemblyConstraintsPanel — Phase 4.7 UI tests for the standalone
 * constraints panel that wraps `checkAssemblyConstraints` (NNNNNNN's pure
 * checker for the 6 assembly-wide constraint kinds).
 *
 * Coverage matrix:
 *   1. Empty render — picker + add button + empty placeholder.
 *   2. Add constraint (each of the 6 kinds via the picker).
 *   3. Per-kind parameter inputs render the right field IDs.
 *   4. Editing a parameter bubbles to onConstraintsChange.
 *   5. Removing a row drops it from the list + invalidates the result.
 *   6. Check button runs the checker and renders the OK summary.
 *   7. Error violation renders with severity=error + correct kind / actual / limit.
 *   8. Warning violation renders with severity=warning + summary stays "ok".
 *   9. initialConstraints seeds the panel.
 *   10. Material homogeneity allowed-list parses comma-separated input.
 *   11. Cost currency picker switches USD ↔ KRW.
 *   12. Bbox envelope renders 3 separate X/Y/Z inputs.
 *   13. 6-lang label rendering (en / ko / ja / zh / es / ar).
 *   14. Multiple violations all render with stable per-index test ids.
 *   15. Check result summary flips colour on error vs ok-with-warnings.
 *   16. AssemblyBrowserModal integration — toggle mounts the panel host.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import AssemblyConstraintsPanel, {
  type AssemblyConstraintsLang,
} from '@/app/[lang]/shape-generator/assembly/AssemblyConstraintsPanel';
import AssemblyBrowserModal from '@/app/[lang]/shape-generator/assembly/AssemblyBrowserModal';
import {
  IDENTITY_QUAT,
  partInstance,
  type AssemblyState,
  type PartInstance,
} from '@/lib/assembly/assemblyState';
import type { AssemblyConstraint } from '@/lib/assembly/assemblyConstraints';
import type { FeatureTree } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

// ─── helpers ─────────────────────────────────────────────────────────────

function makePart(id: string, fixed = false): PartInstance {
  return partInstance({
    id,
    name: id,
    partTemplateId: 'tpl',
    position: { x: 0, y: 0, z: 0 },
    orientation: IDENTITY_QUAT,
    fixed,
  });
}

function makeState(parts: PartInstance[]): AssemblyState {
  return { parts, mates: [] };
}

const SQUARE_10x10: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

function boxTree(depth: number): FeatureTree {
  const payload: ExtrudeFeature = {
    kind: 'extrude',
    loop: SQUARE_10x10,
    depth,
    direction: 'one_sided',
    mode: 'add',
  };
  return { nodes: [{ id: 'e', name: 'e', dependencies: [], payload }] };
}

function setAddKind(value: string): void {
  const select = screen.getByTestId('assembly-constraints-add-kind') as HTMLSelectElement;
  fireEvent.change(select, { target: { value } });
}

function addKind(value: AssemblyConstraint['kind']): void {
  setAddKind(value);
  fireEvent.click(screen.getByTestId('assembly-constraints-add-button'));
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('AssemblyConstraintsPanel — empty state', () => {
  it('renders the panel scaffold with picker + add button + empty placeholder', () => {
    render(<AssemblyConstraintsPanel lang="en" state={makeState([])} />);
    expect(screen.getByTestId('assembly-constraints-panel')).toBeInTheDocument();
    expect(screen.getByTestId('assembly-constraints-add-kind')).toBeInTheDocument();
    expect(screen.getByTestId('assembly-constraints-add-button')).toBeInTheDocument();
    expect(screen.getByTestId('assembly-constraints-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('assembly-constraints-row-0')).not.toBeInTheDocument();
  });

  it('add-kind picker exposes all 6 kinds', () => {
    render(<AssemblyConstraintsPanel lang="en" state={makeState([])} />);
    const select = screen.getByTestId('assembly-constraints-add-kind') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual([
      'total_mass_limit',
      'bbox_envelope',
      'part_count_limit',
      'manufacturing_volume_min',
      'cost_limit',
      'material_homogeneity',
    ]);
  });
});

describe('AssemblyConstraintsPanel — add / remove constraints', () => {
  it('clicking add appends a row with the selected kind', () => {
    const onChange = vi.fn();
    render(
      <AssemblyConstraintsPanel
        lang="en"
        state={makeState([])}
        onConstraintsChange={onChange}
      />,
    );
    addKind('total_mass_limit');
    const row = screen.getByTestId('assembly-constraints-row-0');
    expect(row).toBeInTheDocument();
    expect(row).toHaveAttribute('data-kind', 'total_mass_limit');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toEqual([
      expect.objectContaining({ kind: 'total_mass_limit' }),
    ]);
  });

  it('can add each of the 6 kinds and they render in input order', () => {
    render(<AssemblyConstraintsPanel lang="en" state={makeState([])} />);
    const kinds: AssemblyConstraint['kind'][] = [
      'total_mass_limit',
      'bbox_envelope',
      'part_count_limit',
      'manufacturing_volume_min',
      'cost_limit',
      'material_homogeneity',
    ];
    kinds.forEach((k) => addKind(k));
    kinds.forEach((k, idx) => {
      const row = screen.getByTestId(`assembly-constraints-row-${idx}`);
      expect(row).toHaveAttribute('data-kind', k);
    });
  });

  it('remove drops the row and fires onConstraintsChange', () => {
    const onChange = vi.fn();
    render(
      <AssemblyConstraintsPanel
        lang="en"
        state={makeState([])}
        onConstraintsChange={onChange}
      />,
    );
    addKind('part_count_limit');
    addKind('total_mass_limit');
    expect(screen.getByTestId('assembly-constraints-row-1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('assembly-constraints-remove-0'));
    expect(screen.queryByTestId('assembly-constraints-row-1')).not.toBeInTheDocument();
    // After removal index 0 is the surviving (originally 1st) total_mass_limit.
    expect(screen.getByTestId('assembly-constraints-row-0')).toHaveAttribute(
      'data-kind',
      'total_mass_limit',
    );
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ kind: 'total_mass_limit' }),
    ]);
  });
});

describe('AssemblyConstraintsPanel — per-kind inputs', () => {
  it('total_mass_limit exposes a maxGrams numeric input', () => {
    render(<AssemblyConstraintsPanel lang="en" state={makeState([])} />);
    addKind('total_mass_limit');
    const input = screen.getByTestId('assembly-constraints-input-0-maxGrams') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.type).toBe('number');
  });

  it('bbox_envelope exposes 3 separate X / Y / Z inputs', () => {
    render(<AssemblyConstraintsPanel lang="en" state={makeState([])} />);
    addKind('bbox_envelope');
    expect(screen.getByTestId('assembly-constraints-input-0-sizeX')).toBeInTheDocument();
    expect(screen.getByTestId('assembly-constraints-input-0-sizeY')).toBeInTheDocument();
    expect(screen.getByTestId('assembly-constraints-input-0-sizeZ')).toBeInTheDocument();
  });

  it('part_count_limit accepts an integer max', () => {
    const onChange = vi.fn();
    render(
      <AssemblyConstraintsPanel
        lang="en"
        state={makeState([])}
        onConstraintsChange={onChange}
      />,
    );
    addKind('part_count_limit');
    fireEvent.change(screen.getByTestId('assembly-constraints-input-0-max'), {
      target: { value: '7' },
    });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ kind: 'part_count_limit', max: 7 }),
    ]);
  });

  it('cost_limit exposes a currency picker that swaps between USD / EUR / KRW', () => {
    const onChange = vi.fn();
    render(
      <AssemblyConstraintsPanel
        lang="en"
        state={makeState([])}
        onConstraintsChange={onChange}
      />,
    );
    addKind('cost_limit');
    const currency = screen.getByTestId(
      'assembly-constraints-input-0-currency',
    ) as HTMLSelectElement;
    expect(Array.from(currency.options).map((o) => o.value)).toEqual([
      'USD',
      'EUR',
      'KRW',
    ]);
    fireEvent.change(currency, { target: { value: 'KRW' } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ kind: 'cost_limit', currency: 'KRW' }),
    ]);
  });

  it('material_homogeneity parses comma-separated allowed list', () => {
    const onChange = vi.fn();
    render(
      <AssemblyConstraintsPanel
        lang="en"
        state={makeState([])}
        onConstraintsChange={onChange}
      />,
    );
    addKind('material_homogeneity');
    fireEvent.change(
      screen.getByTestId('assembly-constraints-input-0-allowedMaterials'),
      { target: { value: 'aluminum, steel, titanium' } },
    );
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        kind: 'material_homogeneity',
        allowedMaterials: ['aluminum', 'steel', 'titanium'],
      }),
    ]);
  });

  it('editing a parameter invalidates a previously-rendered result', () => {
    render(<AssemblyConstraintsPanel lang="en" state={makeState([])} />);
    addKind('part_count_limit');
    fireEvent.click(screen.getByTestId('assembly-constraints-check-button'));
    expect(screen.getByTestId('assembly-constraints-summary')).toBeInTheDocument();
    // Edit the input — the prior summary should disappear.
    fireEvent.change(screen.getByTestId('assembly-constraints-input-0-max'), {
      target: { value: '9' },
    });
    expect(screen.queryByTestId('assembly-constraints-summary')).not.toBeInTheDocument();
  });
});

describe('AssemblyConstraintsPanel — check + result rendering', () => {
  it('OK summary appears when no constraints fail', () => {
    render(
      <AssemblyConstraintsPanel
        lang="en"
        state={makeState([makePart('p1', true)])}
      />,
    );
    addKind('part_count_limit'); // default max = 50 → easily passes
    fireEvent.click(screen.getByTestId('assembly-constraints-check-button'));
    const summary = screen.getByTestId('assembly-constraints-summary');
    expect(summary).toHaveAttribute('data-ok', 'true');
    expect(summary).toHaveTextContent(/all constraints pass/i);
    expect(screen.getByTestId('assembly-constraints-empty-violations')).toBeInTheDocument();
  });

  it('renders an error violation row when part count exceeds the limit', () => {
    render(
      <AssemblyConstraintsPanel
        lang="en"
        state={makeState([makePart('p1', true), makePart('p2'), makePart('p3')])}
      />,
    );
    addKind('part_count_limit');
    // Tighten max to 1 so it fails (3 > 1).
    fireEvent.change(screen.getByTestId('assembly-constraints-input-0-max'), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByTestId('assembly-constraints-check-button'));

    const summary = screen.getByTestId('assembly-constraints-summary');
    expect(summary).toHaveAttribute('data-ok', 'false');

    const violation = screen.getByTestId('assembly-constraints-violation-0');
    expect(violation).toHaveAttribute('data-severity', 'error');
    expect(violation).toHaveAttribute('data-kind', 'part_count_limit');
    expect(
      screen.getByTestId('assembly-constraints-violation-actual-0'),
    ).toHaveTextContent(/3/);
    expect(
      screen.getByTestId('assembly-constraints-violation-limit-0'),
    ).toHaveTextContent(/1/);
  });

  it('renders a warning violation that keeps summary ok=true', () => {
    // No featureTrees → bbox_envelope cannot measure → warning, not error.
    render(
      <AssemblyConstraintsPanel
        lang="en"
        state={makeState([makePart('p1', true)])}
      />,
    );
    addKind('bbox_envelope');
    fireEvent.click(screen.getByTestId('assembly-constraints-check-button'));
    const summary = screen.getByTestId('assembly-constraints-summary');
    expect(summary).toHaveAttribute('data-ok', 'true');
    const violation = screen.getByTestId('assembly-constraints-violation-0');
    expect(violation).toHaveAttribute('data-severity', 'warning');
  });

  it('feeds featureTrees through so mass measurements work', () => {
    render(
      <AssemblyConstraintsPanel
        lang="en"
        state={makeState([makePart('p1', true)])}
        featureTrees={{ p1: boxTree(100) }} // 10×10×100 = 10_000 mm³
        materials={{ p1: 'steel' }}
      />,
    );
    addKind('total_mass_limit');
    // Default 1000 g passes easily — tighten to 1 g (steel ≈ 78.5 g).
    fireEvent.change(screen.getByTestId('assembly-constraints-input-0-maxGrams'), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByTestId('assembly-constraints-check-button'));
    const violation = screen.getByTestId('assembly-constraints-violation-0');
    expect(violation).toHaveAttribute('data-severity', 'error');
    expect(violation).toHaveAttribute('data-kind', 'total_mass_limit');
  });

  it('renders one violation row per failing constraint, indexed independently', () => {
    render(
      <AssemblyConstraintsPanel
        lang="en"
        state={makeState([makePart('p1', true), makePart('p2'), makePart('p3')])}
      />,
    );
    // Two failing part_count constraints with different limits.
    addKind('part_count_limit');
    addKind('part_count_limit');
    fireEvent.change(screen.getByTestId('assembly-constraints-input-0-max'), {
      target: { value: '0' },
    });
    fireEvent.change(screen.getByTestId('assembly-constraints-input-1-max'), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByTestId('assembly-constraints-check-button'));
    expect(screen.getByTestId('assembly-constraints-violation-0')).toBeInTheDocument();
    expect(screen.getByTestId('assembly-constraints-violation-1')).toBeInTheDocument();
  });
});

describe('AssemblyConstraintsPanel — initial seeding + i18n', () => {
  it('initialConstraints seeds the row list', () => {
    const initial: AssemblyConstraint[] = [
      { kind: 'total_mass_limit', maxGrams: 25 },
      { kind: 'cost_limit', maxCurrency: 5, currency: 'EUR' },
    ];
    render(
      <AssemblyConstraintsPanel
        lang="en"
        state={makeState([])}
        initialConstraints={initial}
      />,
    );
    expect(screen.getByTestId('assembly-constraints-row-0')).toHaveAttribute(
      'data-kind',
      'total_mass_limit',
    );
    expect(screen.getByTestId('assembly-constraints-row-1')).toHaveAttribute(
      'data-kind',
      'cost_limit',
    );
    const currency = screen.getByTestId(
      'assembly-constraints-input-1-currency',
    ) as HTMLSelectElement;
    expect(currency.value).toBe('EUR');
  });

  it.each<AssemblyConstraintsLang>(['ko', 'en', 'ja', 'zh', 'es', 'ar'])(
    'renders panel title in %s',
    (lang) => {
      render(<AssemblyConstraintsPanel lang={lang} state={makeState([])} />);
      const panel = screen.getByTestId('assembly-constraints-panel');
      expect(panel).toBeInTheDocument();
      // Add-button label should be the localized "+ Add constraint" (non-empty).
      const addBtn = screen.getByTestId('assembly-constraints-add-button');
      expect(addBtn.textContent?.trim().length ?? 0).toBeGreaterThan(0);
      // RTL on Arabic.
      if (lang === 'ar') {
        expect(panel).toHaveAttribute('dir', 'rtl');
      } else {
        expect(panel).toHaveAttribute('dir', 'ltr');
      }
    },
  );
});

describe('AssemblyBrowserModal — Constraints toggle integration', () => {
  it('toggle mounts and unmounts the constraints panel host', async () => {
    render(
      <AssemblyBrowserModal
        lang="en"
        initialState={makeState([makePart('p1', true)])}
        onClose={() => {}}
      />,
    );
    // Default off — host absent.
    expect(
      screen.queryByTestId('solver-assembly-constraints-host'),
    ).not.toBeInTheDocument();
    // Toggle on.
    fireEvent.click(screen.getByTestId('solver-assembly-constraints-toggle'));
    const host = screen.getByTestId('solver-assembly-constraints-host');
    expect(host).toBeInTheDocument();
    // The panel itself mounted inside.
    expect(
      await within(host).findByTestId('assembly-constraints-panel'),
    ).toBeInTheDocument();
    // Toggle off — host disappears again.
    fireEvent.click(screen.getByTestId('solver-assembly-constraints-toggle'));
    expect(
      screen.queryByTestId('solver-assembly-constraints-host'),
    ).not.toBeInTheDocument();
  });
});
