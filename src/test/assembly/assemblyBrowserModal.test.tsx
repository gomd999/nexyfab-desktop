/** @vitest-environment jsdom */
/**
 * AssemblyBrowserModal — Phase 3.A first user-facing assembly UI tests.
 *
 * Standalone modal: takes lang + optional initialState + onClose + optional
 * onSolve. All test ids prefixed solver-assembly-*.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import AssemblyBrowserModal, {
  type AssemblyBrowserLang,
  type AssemblyBrowserSolveResult,
} from '@/app/[lang]/shape-generator/assembly/AssemblyBrowserModal';
import { IDENTITY_QUAT, type AssemblyState } from '@/lib/assembly/assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';

function seedState(): AssemblyState {
  return {
    parts: [
      {
        id: 'p_base',
        name: 'Base',
        partTemplateId: 'tpl_base',
        position: { x: 0, y: 0, z: 0 },
        orientation: IDENTITY_QUAT,
        fixed: true,
      },
      {
        id: 'p_arm',
        name: 'Arm',
        partTemplateId: 'tpl_arm',
        position: { x: 0, y: 0, z: 0 },
        orientation: IDENTITY_QUAT,
      },
    ],
    mates: [
      {
        id: 'm1',
        kind: 'coincident',
        a: { partId: 'p_base', refId: 'face_top', refKind: 'face' },
        b: { partId: 'p_arm', refId: 'face_bot', refKind: 'face' },
      },
    ],
  };
}

describe('AssemblyBrowserModal', () => {
  it('renders the modal title, parts panel, mates panel, footer buttons', () => {
    render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
    expect(screen.getByTestId('solver-assembly-modal')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-title')).toHaveTextContent(/Assembly Browser/i);
    expect(screen.getByTestId('solver-assembly-parts-panel')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-mates-panel')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-add-part')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-add-mate')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-close')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-solve')).toBeInTheDocument();
  });

  it('default state shows empty placeholders for parts and mates', () => {
    render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
    expect(screen.getByTestId('solver-assembly-parts-empty')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-mates-empty')).toBeInTheDocument();
  });

  it('renders seeded parts and mates from initialState', () => {
    render(
      <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
    );
    expect(screen.getByTestId('solver-assembly-part-row-p_base')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-part-row-p_arm')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-mate-row-m1')).toBeInTheDocument();
    expect(
      (screen.getByTestId('solver-assembly-part-fixed-p_base') as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByTestId('solver-assembly-part-fixed-p_arm') as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('+ Add part appends a new part and marks the first added one as fixed', () => {
    render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('solver-assembly-add-part'));
    expect(screen.getByTestId('solver-assembly-part-row-part_1')).toBeInTheDocument();
    expect(
      (screen.getByTestId('solver-assembly-part-fixed-part_1') as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.click(screen.getByTestId('solver-assembly-add-part'));
    expect(screen.getByTestId('solver-assembly-part-row-part_2')).toBeInTheDocument();
    expect(
      (screen.getByTestId('solver-assembly-part-fixed-part_2') as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('part name input edits the part name in place', () => {
    render(
      <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
    );
    const name = screen.getByTestId('solver-assembly-part-name-p_arm') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Crank Arm' } });
    expect(
      (screen.getByTestId('solver-assembly-part-name-p_arm') as HTMLInputElement).value,
    ).toBe('Crank Arm');
  });

  it('toggling Fixed checkbox flips the part fixed flag', () => {
    render(
      <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
    );
    const cb = screen.getByTestId('solver-assembly-part-fixed-p_arm') as HTMLInputElement;
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    expect(
      (screen.getByTestId('solver-assembly-part-fixed-p_arm') as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('removing a part drops both the part row and any mates that reference it', () => {
    render(
      <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
    );
    expect(screen.getByTestId('solver-assembly-mate-row-m1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('solver-assembly-part-remove-p_arm'));
    expect(screen.queryByTestId('solver-assembly-part-row-p_arm')).toBeNull();
    expect(screen.queryByTestId('solver-assembly-mate-row-m1')).toBeNull();
  });

  it('+ Add mate appends a new coincident mate pre-wired to first two parts', () => {
    render(
      <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-assembly-add-mate'));
    // Seed had 1 mate so the new id is mate_2 (mate_${state.mates.length + 1}).
    const row = screen.getByTestId('solver-assembly-mate-row-mate_2');
    expect(row).toBeInTheDocument();
    const kindSel = within(row).getByTestId(
      'solver-assembly-mate-kind-mate_2',
    ) as HTMLSelectElement;
    expect(kindSel.value).toBe('coincident');
    expect(
      (within(row).getByTestId('solver-assembly-mate-a-partid-mate_2') as HTMLInputElement).value,
    ).toBe('p_base');
    expect(
      (within(row).getByTestId('solver-assembly-mate-b-partid-mate_2') as HTMLInputElement).value,
    ).toBe('p_arm');
  });

  it('changing mate kind to distance reveals the numeric value input', () => {
    render(
      <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
    );
    const sel = screen.getByTestId('solver-assembly-mate-kind-m1') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'distance' } });
    expect(screen.getByTestId('solver-assembly-mate-value-m1')).toBeInTheDocument();
    expect(
      (screen.getByTestId('solver-assembly-mate-value-m1') as HTMLInputElement).value,
    ).toBe('10');
  });

  it('editing mate value updates the stored value and shows it in inputs', () => {
    render(
      <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByTestId('solver-assembly-mate-kind-m1'), {
      target: { value: 'angle' },
    });
    const val = screen.getByTestId('solver-assembly-mate-value-m1') as HTMLInputElement;
    fireEvent.change(val, { target: { value: '45' } });
    expect(
      (screen.getByTestId('solver-assembly-mate-value-m1') as HTMLInputElement).value,
    ).toBe('45');
  });

  it('editing ref A partId / refId / refKind updates the inputs', () => {
    render(
      <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
    );
    const partId = screen.getByTestId('solver-assembly-mate-a-partid-m1') as HTMLInputElement;
    fireEvent.change(partId, { target: { value: 'new_part' } });
    expect(
      (screen.getByTestId('solver-assembly-mate-a-partid-m1') as HTMLInputElement).value,
    ).toBe('new_part');

    const refId = screen.getByTestId('solver-assembly-mate-a-refid-m1') as HTMLInputElement;
    fireEvent.change(refId, { target: { value: 'new_ref' } });
    expect(
      (screen.getByTestId('solver-assembly-mate-a-refid-m1') as HTMLInputElement).value,
    ).toBe('new_ref');

    const refKind = screen.getByTestId('solver-assembly-mate-a-refkind-m1') as HTMLSelectElement;
    fireEvent.change(refKind, { target: { value: 'axis' } });
    expect(
      (screen.getByTestId('solver-assembly-mate-a-refkind-m1') as HTMLSelectElement).value,
    ).toBe('axis');
  });

  it('removing a mate drops the row but leaves parts intact', () => {
    render(
      <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('solver-assembly-mate-remove-m1'));
    expect(screen.queryByTestId('solver-assembly-mate-row-m1')).toBeNull();
    expect(screen.getByTestId('solver-assembly-part-row-p_base')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-part-row-p_arm')).toBeInTheDocument();
  });

  it('Close button invokes onClose', () => {
    const onClose = vi.fn();
    render(<AssemblyBrowserModal lang="en" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('solver-assembly-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Solve button is disabled when no onSolve is provided', () => {
    render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
    expect(
      (screen.getByTestId('solver-assembly-solve') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('clicking Solve invokes onSolve with the current state and renders the result', async () => {
    const result: AssemblyBrowserSolveResult = {
      success: true,
      iterations: 7,
      finalMaxResidual: 0.0001,
      dof: 5,
      residuals: [{ mateId: 'm1', residual: 0, supported: true }],
    };
    const onSolve = vi.fn().mockResolvedValue(result);
    render(
      <AssemblyBrowserModal
        lang="en"
        initialState={seedState()}
        onClose={vi.fn()}
        onSolve={onSolve}
      />,
    );
    fireEvent.click(screen.getByTestId('solver-assembly-solve'));
    await waitFor(() => {
      expect(screen.getByTestId('solver-assembly-solve-result')).toBeInTheDocument();
    });
    expect(onSolve).toHaveBeenCalledTimes(1);
    const callArg = onSolve.mock.calls[0][0] as AssemblyState;
    expect(callArg.parts.length).toBe(2);
    expect(callArg.mates.length).toBe(1);
    expect(screen.getByTestId('solver-assembly-solve-success')).toHaveTextContent(/success/i);
    expect(screen.getByTestId('solver-assembly-solve-dof')).toHaveTextContent(/5/);
    expect(screen.getByTestId('solver-assembly-solve-iterations')).toHaveTextContent(/7/);
    expect(screen.getByTestId('solver-assembly-solve-residual-m1')).toBeInTheDocument();
  });

  it('Solve onError surfaces the error message in the UI', async () => {
    const onSolve = vi.fn().mockRejectedValue(new Error('solver exploded'));
    render(
      <AssemblyBrowserModal
        lang="en"
        initialState={seedState()}
        onClose={vi.fn()}
        onSolve={onSolve}
      />,
    );
    fireEvent.click(screen.getByTestId('solver-assembly-solve'));
    await waitFor(() => {
      expect(screen.getByTestId('solver-assembly-solve-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('solver-assembly-solve-error').textContent).toMatch(
      /solver exploded/,
    );
  });

  it.each<[AssemblyBrowserLang, RegExp]>([
    ['ko', /어셈블리 브라우저/],
    ['en', /Assembly Browser/],
    ['ja', /アセンブリブラウザ/],
    ['zh', /装配浏览器/],
    ['es', /Navegador de Ensamblaje/],
    ['ar', /متصفح التجميع/],
  ])('i18n: lang %s renders the localized modal title', (lang, re) => {
    render(<AssemblyBrowserModal lang={lang} onClose={vi.fn()} />);
    expect(screen.getByTestId('solver-assembly-title').textContent).toMatch(re);
  });

  // ── FeatureTree editor (Phase 4 ↔ UI bridge) ───────────────────────────

  describe('FeatureTree editor', () => {
    const TINY_TREE: FeatureTree = {
      nodes: [
        {
          id: 'e1',
          name: 'Extrude',
          dependencies: [],
          payload: {
            kind: 'extrude',
            loop: [
              { x: 0, y: 0 },
              { x: 5, y: 0 },
              { x: 5, y: 5 },
              { x: 0, y: 5 },
            ],
            depth: 10,
            direction: 'one_sided',
            mode: 'add',
          },
        },
      ],
    };

    it('toggles the per-part FeatureTree textarea visibility', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      // Editor is hidden by default.
      expect(screen.queryByTestId('solver-assembly-part-p_base-tree-editor')).toBeNull();
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_base-tree-toggle'));
      expect(
        screen.getByTestId('solver-assembly-part-p_base-tree-editor'),
      ).toBeInTheDocument();
      // Toggling again hides it.
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_base-tree-toggle'));
      expect(screen.queryByTestId('solver-assembly-part-p_base-tree-editor')).toBeNull();
    });

    it('typing valid JSON in the editor surfaces the parsed tree to onSolve', async () => {
      const onSolve = vi
        .fn()
        .mockResolvedValue({
          success: true,
          residuals: [],
          dof: 0,
        } as AssemblyBrowserSolveResult);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onSolve={onSolve}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_base-tree-toggle'));
      const ta = screen.getByTestId(
        'solver-assembly-part-p_base-tree-editor',
      ) as HTMLTextAreaElement;
      fireEvent.change(ta, { target: { value: JSON.stringify(TINY_TREE) } });
      // No parse error block should be rendered.
      expect(screen.queryByTestId('solver-assembly-part-p_base-tree-error')).toBeNull();
      // Solve should pass the parsed tree as second arg.
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() => expect(onSolve).toHaveBeenCalled());
      const trees = onSolve.mock.calls[0][1] as Record<string, FeatureTree>;
      expect(trees).toHaveProperty('p_base');
      expect(trees.p_base.nodes).toHaveLength(1);
      expect(trees.p_base.nodes[0]!.id).toBe('e1');
    });

    it('invalid JSON shows a parse error message and disables Solve', () => {
      const onSolve = vi
        .fn()
        .mockResolvedValue({
          success: true,
          residuals: [],
          dof: 0,
        } as AssemblyBrowserSolveResult);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onSolve={onSolve}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_base-tree-toggle'));
      const ta = screen.getByTestId(
        'solver-assembly-part-p_base-tree-editor',
      ) as HTMLTextAreaElement;
      fireEvent.change(ta, { target: { value: '{ broken json' } });
      expect(
        screen.getByTestId('solver-assembly-part-p_base-tree-error'),
      ).toBeInTheDocument();
      expect(
        (screen.getByTestId('solver-assembly-solve') as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it('non-object / missing nodes array shows a parse error', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_base-tree-toggle'));
      const ta = screen.getByTestId(
        'solver-assembly-part-p_base-tree-editor',
      ) as HTMLTextAreaElement;
      fireEvent.change(ta, { target: { value: '[1, 2, 3]' } });
      expect(
        screen.getByTestId('solver-assembly-part-p_base-tree-error'),
      ).toBeInTheDocument();
    });

    it('clearing the textarea drops the entry from featureTrees and re-enables Solve', async () => {
      const onSolve = vi
        .fn()
        .mockResolvedValue({
          success: true,
          residuals: [],
          dof: 0,
        } as AssemblyBrowserSolveResult);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onSolve={onSolve}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_base-tree-toggle'));
      const ta = screen.getByTestId(
        'solver-assembly-part-p_base-tree-editor',
      ) as HTMLTextAreaElement;
      // First invalid → disabled
      fireEvent.change(ta, { target: { value: '{ bad' } });
      expect(
        (screen.getByTestId('solver-assembly-solve') as HTMLButtonElement).disabled,
      ).toBe(true);
      // Clear → re-enabled, entry removed
      fireEvent.change(ta, { target: { value: '' } });
      expect(screen.queryByTestId('solver-assembly-part-p_base-tree-error')).toBeNull();
      expect(
        (screen.getByTestId('solver-assembly-solve') as HTMLButtonElement).disabled,
      ).toBe(false);
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() => expect(onSolve).toHaveBeenCalled());
      const trees = onSolve.mock.calls[0][1] as Record<string, FeatureTree>;
      expect(trees).not.toHaveProperty('p_base');
    });

    it('onSolve is invoked with (state, featureTrees={}) when no trees were entered', async () => {
      const onSolve = vi
        .fn()
        .mockResolvedValue({
          success: true,
          residuals: [],
          dof: 0,
        } as AssemblyBrowserSolveResult);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onSolve={onSolve}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() => expect(onSolve).toHaveBeenCalled());
      expect(onSolve.mock.calls[0][1]).toEqual({});
    });

    it('initialFeatureTrees pre-seed the editor textareas', () => {
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          initialFeatureTrees={{ p_base: TINY_TREE }}
          onClose={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_base-tree-toggle'));
      const ta = screen.getByTestId(
        'solver-assembly-part-p_base-tree-editor',
      ) as HTMLTextAreaElement;
      // Pretty-printed JSON of TINY_TREE includes the e1 node id.
      expect(ta.value).toMatch(/"id":\s*"e1"/);
    });

    it('phase badge shows "real" when the result carries phase=real', async () => {
      const onSolve = vi.fn().mockResolvedValue({
        success: true,
        iterations: 3,
        finalMaxResidual: 1e-6,
        dof: 0,
        residuals: [],
        phase: 'real',
      } as AssemblyBrowserSolveResult);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onSolve={onSolve}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() =>
        expect(screen.getByTestId('solver-assembly-solve-phase')).toBeInTheDocument(),
      );
      expect(screen.getByTestId('solver-assembly-solve-phase').textContent).toMatch(
        /real/i,
      );
    });

    it('phase badge shows "stub" when the result carries phase=stub', async () => {
      const onSolve = vi.fn().mockResolvedValue({
        success: true,
        iterations: 0,
        finalMaxResidual: 0,
        dof: 0,
        residuals: [],
        phase: 'stub',
      } as AssemblyBrowserSolveResult);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onSolve={onSolve}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() =>
        expect(screen.getByTestId('solver-assembly-solve-phase')).toBeInTheDocument(),
      );
      expect(screen.getByTestId('solver-assembly-solve-phase').textContent).toMatch(
        /stub/i,
      );
    });

    it('phase badge is hidden when the result does not carry a phase', async () => {
      const onSolve = vi
        .fn()
        .mockResolvedValue({
          success: true,
          residuals: [],
          dof: 0,
        } as AssemblyBrowserSolveResult);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onSolve={onSolve}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() =>
        expect(screen.getByTestId('solver-assembly-solve-result')).toBeInTheDocument(),
      );
      expect(screen.queryByTestId('solver-assembly-solve-phase')).toBeNull();
    });

    it('removing a part also drops its FeatureTree entry', async () => {
      const onSolve = vi
        .fn()
        .mockResolvedValue({
          success: true,
          residuals: [],
          dof: 0,
        } as AssemblyBrowserSolveResult);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          initialFeatureTrees={{ p_arm: TINY_TREE }}
          onClose={vi.fn()}
          onSolve={onSolve}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-part-remove-p_arm'));
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() => expect(onSolve).toHaveBeenCalled());
      const trees = onSolve.mock.calls[0][1] as Record<string, FeatureTree>;
      expect(trees).not.toHaveProperty('p_arm');
    });

    it.each<[AssemblyBrowserLang, RegExp]>([
      ['ko', /FeatureTree 편집/],
      ['en', /Edit FeatureTree/],
      ['ja', /FeatureTree 編集/],
      ['zh', /编辑 FeatureTree/],
    ])('i18n: lang %s localizes the FeatureTree toggle label', (lang, re) => {
      render(
        <AssemblyBrowserModal lang={lang} initialState={seedState()} onClose={vi.fn()} />,
      );
      const btn = screen.getByTestId('solver-assembly-part-p_base-tree-toggle');
      expect(btn.textContent).toMatch(re);
    });
  });

  // ── Solver picker (Phase 3.2 — QQQQ /api/assembly-solve solver=auto UI) ──

  describe('solver picker', () => {
    it('renders the solver picker dropdown with all 4 options + Auto default', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      const sel = screen.getByTestId(
        'solver-assembly-solver-select',
      ) as HTMLSelectElement;
      expect(sel).toBeInTheDocument();
      expect(sel.value).toBe('auto');
      const values = Array.from(sel.options).map((o) => o.value);
      expect(values).toEqual(['auto', 'gauss_seidel', 'lagrangian', 'adaptive']);
    });

    it('changing the solver picker updates the controlled selection value', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      const sel = screen.getByTestId(
        'solver-assembly-solver-select',
      ) as HTMLSelectElement;
      fireEvent.change(sel, { target: { value: 'lagrangian' } });
      expect(
        (screen.getByTestId(
          'solver-assembly-solver-select',
        ) as HTMLSelectElement).value,
      ).toBe('lagrangian');
    });

    it('clicking Solve forwards the default "auto" solver as the 3rd onSolve arg', async () => {
      const onSolve = vi.fn().mockResolvedValue({
        success: true,
        residuals: [],
        dof: 0,
      } as AssemblyBrowserSolveResult);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onSolve={onSolve}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() => expect(onSolve).toHaveBeenCalled());
      // 3rd arg is the solver selection.
      expect(onSolve.mock.calls[0][2]).toBe('auto');
    });

    it('changing solver to lagrangian then Solve forwards "lagrangian"', async () => {
      const onSolve = vi.fn().mockResolvedValue({
        success: true,
        residuals: [],
        dof: 0,
      } as AssemblyBrowserSolveResult);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onSolve={onSolve}
        />,
      );
      fireEvent.change(
        screen.getByTestId('solver-assembly-solver-select'),
        { target: { value: 'lagrangian' } },
      );
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() => expect(onSolve).toHaveBeenCalled());
      expect(onSolve.mock.calls[0][2]).toBe('lagrangian');
    });

    it('changing solver to adaptive then Solve forwards "adaptive"', async () => {
      const onSolve = vi.fn().mockResolvedValue({
        success: true,
        residuals: [],
        dof: 0,
      } as AssemblyBrowserSolveResult);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onSolve={onSolve}
        />,
      );
      fireEvent.change(
        screen.getByTestId('solver-assembly-solver-select'),
        { target: { value: 'adaptive' } },
      );
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() => expect(onSolve).toHaveBeenCalled());
      expect(onSolve.mock.calls[0][2]).toBe('adaptive');
    });

    it('changing solver to gauss_seidel then Solve forwards "gauss_seidel"', async () => {
      const onSolve = vi.fn().mockResolvedValue({
        success: true,
        residuals: [],
        dof: 0,
      } as AssemblyBrowserSolveResult);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onSolve={onSolve}
        />,
      );
      fireEvent.change(
        screen.getByTestId('solver-assembly-solver-select'),
        { target: { value: 'gauss_seidel' } },
      );
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() => expect(onSolve).toHaveBeenCalled());
      expect(onSolve.mock.calls[0][2]).toBe('gauss_seidel');
    });

    it('renders the solverUsed badge when the result carries solverUsed=adaptive', async () => {
      const onSolve = vi.fn().mockResolvedValue({
        success: true,
        iterations: 4,
        finalMaxResidual: 1e-7,
        dof: 0,
        residuals: [],
        phase: 'real',
        solverUsed: 'adaptive',
      } as AssemblyBrowserSolveResult);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onSolve={onSolve}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() =>
        expect(
          screen.getByTestId('solver-assembly-solve-solver-used'),
        ).toBeInTheDocument(),
      );
      expect(
        screen.getByTestId('solver-assembly-solve-solver-used').textContent,
      ).toMatch(/adaptive/i);
    });

    it('renders the solverUsed badge when the result carries solverUsed=gauss_seidel', async () => {
      const onSolve = vi.fn().mockResolvedValue({
        success: true,
        iterations: 2,
        finalMaxResidual: 0,
        dof: 0,
        residuals: [],
        phase: 'real',
        solverUsed: 'gauss_seidel',
      } as AssemblyBrowserSolveResult);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onSolve={onSolve}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() =>
        expect(
          screen.getByTestId('solver-assembly-solve-solver-used'),
        ).toBeInTheDocument(),
      );
      expect(
        screen.getByTestId('solver-assembly-solve-solver-used').textContent,
      ).toMatch(/gauss_seidel/i);
    });

    it('renders the solverUsed badge when the result carries solverUsed=lagrangian', async () => {
      const onSolve = vi.fn().mockResolvedValue({
        success: true,
        iterations: 5,
        finalMaxResidual: 1e-6,
        dof: 0,
        residuals: [],
        phase: 'real',
        solverUsed: 'lagrangian',
      } as AssemblyBrowserSolveResult);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onSolve={onSolve}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() =>
        expect(
          screen.getByTestId('solver-assembly-solve-solver-used'),
        ).toBeInTheDocument(),
      );
      expect(
        screen.getByTestId('solver-assembly-solve-solver-used').textContent,
      ).toMatch(/lagrangian/i);
    });

    it('does NOT render the solverUsed badge when the result omits solverUsed', async () => {
      const onSolve = vi.fn().mockResolvedValue({
        success: true,
        residuals: [],
        dof: 0,
      } as AssemblyBrowserSolveResult);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onSolve={onSolve}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() =>
        expect(screen.getByTestId('solver-assembly-solve-result')).toBeInTheDocument(),
      );
      expect(screen.queryByTestId('solver-assembly-solve-solver-used')).toBeNull();
    });

    it('solverUsed badge can coexist with the phase badge in the result header', async () => {
      const onSolve = vi.fn().mockResolvedValue({
        success: true,
        iterations: 1,
        finalMaxResidual: 0,
        dof: 0,
        residuals: [],
        phase: 'real',
        solverUsed: 'adaptive',
      } as AssemblyBrowserSolveResult);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onSolve={onSolve}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() =>
        expect(screen.getByTestId('solver-assembly-solve-result')).toBeInTheDocument(),
      );
      expect(screen.getByTestId('solver-assembly-solve-phase')).toBeInTheDocument();
      expect(
        screen.getByTestId('solver-assembly-solve-solver-used'),
      ).toBeInTheDocument();
    });

    it('solver picker selection survives across multiple Solve clicks', async () => {
      const onSolve = vi.fn().mockResolvedValue({
        success: true,
        residuals: [],
        dof: 0,
      } as AssemblyBrowserSolveResult);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onSolve={onSolve}
        />,
      );
      fireEvent.change(
        screen.getByTestId('solver-assembly-solver-select'),
        { target: { value: 'adaptive' } },
      );
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() => expect(onSolve).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() => expect(onSolve).toHaveBeenCalledTimes(2));
      expect(onSolve.mock.calls[0][2]).toBe('adaptive');
      expect(onSolve.mock.calls[1][2]).toBe('adaptive');
      // Picker still reflects the chosen solver after the round-trip.
      expect(
        (screen.getByTestId(
          'solver-assembly-solver-select',
        ) as HTMLSelectElement).value,
      ).toBe('adaptive');
    });

    it.each<[AssemblyBrowserLang, RegExp]>([
      ['ko', /솔버/],
      ['en', /Solver/],
      ['ja', /ソルバー/],
      ['zh', /求解器/],
      ['es', /Solver/],
      ['ar', /الحلّال/],
    ])('i18n: lang %s localizes the solver picker label', (lang, re) => {
      render(
        <AssemblyBrowserModal lang={lang} initialState={seedState()} onClose={vi.fn()} />,
      );
      expect(
        screen.getByTestId('solver-assembly-solver-select-label').textContent,
      ).toMatch(re);
    });

    it.each<[AssemblyBrowserLang, RegExp]>([
      ['ko', /자동/],
      ['en', /Auto/],
      ['ja', /自動/],
      ['zh', /自动/],
      ['es', /Auto/],
      ['ar', /تلقائي/],
    ])('i18n: lang %s localizes the "Auto" solver option', (lang, re) => {
      render(
        <AssemblyBrowserModal lang={lang} initialState={seedState()} onClose={vi.fn()} />,
      );
      const sel = screen.getByTestId(
        'solver-assembly-solver-select',
      ) as HTMLSelectElement;
      const autoOpt = Array.from(sel.options).find((o) => o.value === 'auto')!;
      expect(autoOpt.textContent).toMatch(re);
    });
  });

  // ── Ref-selection + MateConstraintsToolbar bridge (Agent-VV ↔ Agent-X) ──

  describe('ref-selection + mate-toolbar bridge', () => {
    /** Tiny tree producing one hole → adds `hole_axis_0` / `hole_top_0`. */
    const HOLE_TREE: FeatureTree = {
      nodes: [
        {
          id: 'h1',
          name: 'Hole',
          dependencies: [],
          payload: {
            kind: 'hole',
            center: { x: 3, y: 4 },
            holeType: 'drilled',
            diameter: 5,
            depth: 10,
          },
        },
      ],
    };

    function openRefs(partId: string): void {
      fireEvent.click(screen.getByTestId(`solver-assembly-part-${partId}-refs-toggle`));
    }

    it('expanding a part row exposes the 7 canonical ref buttons', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      // Panel hidden by default.
      expect(screen.queryByTestId('solver-assembly-part-p_base-ref-origin')).toBeNull();
      openRefs('p_base');
      for (const refId of [
        'origin',
        'x_axis',
        'y_axis',
        'z_axis',
        'xy_plane',
        'yz_plane',
        'xz_plane',
      ]) {
        expect(
          screen.getByTestId(`solver-assembly-part-p_base-ref-${refId}`),
        ).toBeInTheDocument();
      }
    });

    it('clicking a ref button adds it to the selection display', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      openRefs('p_base');
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_base-ref-z_axis'));
      const slot0 = screen.getByTestId('solver-assembly-selection-0');
      expect(slot0.textContent).toMatch(/p_base:z_axis/);
    });

    it('clicking the same ref again toggles it off', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      openRefs('p_base');
      const btn = screen.getByTestId('solver-assembly-part-p_base-ref-z_axis');
      fireEvent.click(btn);
      expect(screen.getByTestId('solver-assembly-selection-0')).toBeInTheDocument();
      fireEvent.click(btn);
      expect(screen.queryByTestId('solver-assembly-selection-0')).toBeNull();
    });

    it('selecting 2 refs from different parts enables the mate toolbar concentric button', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      openRefs('p_base');
      openRefs('p_arm');
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_base-ref-z_axis'));
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_arm-ref-z_axis'));
      const concentric = screen.getByTestId(
        'solver-mate-concentric-button',
      ) as HTMLButtonElement;
      expect(concentric.disabled).toBe(false);
    });

    it('clicking concentric adds a mate to the mates list and clears the selection', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      openRefs('p_base');
      openRefs('p_arm');
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_base-ref-z_axis'));
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_arm-ref-z_axis'));
      const matesBefore = screen.getAllByTestId(/^solver-assembly-mate-row-/).length;
      fireEvent.click(screen.getByTestId('solver-mate-concentric-button'));
      const matesAfter = screen.getAllByTestId(/^solver-assembly-mate-row-/).length;
      expect(matesAfter).toBe(matesBefore + 1);
      // Selection auto-cleared after onAdd.
      expect(screen.queryByTestId('solver-assembly-selection-0')).toBeNull();
    });

    it('clicking a 3rd ref evicts the oldest entry (FIFO max-2)', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      openRefs('p_base');
      openRefs('p_arm');
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_base-ref-x_axis'));
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_base-ref-y_axis'));
      // Pre-3rd: selection is [x_axis, y_axis]
      expect(screen.getByTestId('solver-assembly-selection-0').textContent).toMatch(
        /p_base:x_axis/,
      );
      // Third click should evict x_axis (oldest) and append the new ref.
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_arm-ref-z_axis'));
      const slot0 = screen.getByTestId('solver-assembly-selection-0').textContent ?? '';
      const slot1 = screen.getByTestId('solver-assembly-selection-1').textContent ?? '';
      expect(slot0).toMatch(/p_base:y_axis/);
      expect(slot1).toMatch(/p_arm:z_axis/);
      // x_axis is gone.
      expect(`${slot0}${slot1}`).not.toMatch(/p_base:x_axis/);
    });

    it('clear-selection button empties the selection', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      openRefs('p_base');
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_base-ref-z_axis'));
      expect(screen.getByTestId('solver-assembly-selection-0')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('solver-assembly-clear-selection'));
      expect(screen.queryByTestId('solver-assembly-selection-0')).toBeNull();
    });

    it('parts with a FeatureTree expose additional refs (hole_axis_0, hole_top_0)', () => {
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          initialFeatureTrees={{ p_base: HOLE_TREE }}
          onClose={vi.fn()}
        />,
      );
      openRefs('p_base');
      expect(
        screen.getByTestId('solver-assembly-part-p_base-ref-hole_axis_0'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('solver-assembly-part-p_base-ref-hole_top_0'),
      ).toBeInTheDocument();
      // p_arm has no tree → no hole refs.
      openRefs('p_arm');
      expect(
        screen.queryByTestId('solver-assembly-part-p_arm-ref-hole_axis_0'),
      ).toBeNull();
    });

    it('2 axes across different parts enables EVERY mate-toolbar button whose canApply requires 2 axes', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      openRefs('p_base');
      openRefs('p_arm');
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_base-ref-z_axis'));
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_arm-ref-z_axis'));
      // 2-axis enabled set per MATE_DEFS: concentric, parallel, perpendicular,
      // angle, hinge, gear.
      for (const kind of [
        'concentric',
        'parallel',
        'perpendicular',
        'angle',
        'hinge',
        'gear',
      ]) {
        const btn = screen.getByTestId(`solver-mate-${kind}-button`) as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
      }
    });

    it('2 refs from the SAME part disables every mate-toolbar button (cross-part rule)', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      openRefs('p_base');
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_base-ref-x_axis'));
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_base-ref-y_axis'));
      for (const kind of [
        'concentric',
        'parallel',
        'perpendicular',
        'angle',
        'hinge',
        'gear',
        'coincident_point',
        'coincident_plane',
        'distance',
        'tangent',
        'slot',
        'rack_pinion',
      ]) {
        const btn = screen.getByTestId(`solver-mate-${kind}-button`) as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
      }
    });

    it('adding a mate via the toolbar clears the selection automatically', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      openRefs('p_base');
      openRefs('p_arm');
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_base-ref-xy_plane'));
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_arm-ref-xy_plane'));
      // coincident_plane needs 2 planes, cross-part → enabled.
      const cp = screen.getByTestId(
        'solver-mate-coincident_plane-button',
      ) as HTMLButtonElement;
      expect(cp.disabled).toBe(false);
      fireEvent.click(cp);
      expect(screen.queryByTestId('solver-assembly-selection-0')).toBeNull();
    });

    it.each<[AssemblyBrowserLang, RegExp]>([
      ['ko', /ref 선택/],
      ['en', /Select refs/],
    ])('i18n: lang %s localizes the refs-toggle label', (lang, re) => {
      render(
        <AssemblyBrowserModal lang={lang} initialState={seedState()} onClose={vi.fn()} />,
      );
      const btn = screen.getByTestId('solver-assembly-part-p_base-refs-toggle');
      expect(btn.textContent).toMatch(re);
    });
  });

  // ── Phase 4: projectId persistence ──────────────────────────────────────

  /**
   * Persistence tests live next to the in-memory suite so the back-compat
   * contract (no projectId = no localStorage touched) is auditable in one
   * file. The existing 50 in-memory tests above cover the unpersisted
   * path verbatim — this suite focuses on the persisted branch.
   */
  describe('Phase 4 projectId persistence', () => {
    beforeEach(() => {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.clear();
      }
    });
    afterEach(() => {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.clear();
      }
    });

    it('without projectId: in-memory mode does NOT touch localStorage on add-part', () => {
      // Patch the instance method on window.localStorage — vi.spyOn against
      // Storage.prototype is a no-op in jsdom because instance.setItem is
      // bound, not delegated to the prototype.
      const calls: Array<{ key: string; value: string }> = [];
      const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
      window.localStorage.setItem = (key: string, value: string) => {
        calls.push({ key, value });
        originalSetItem(key, value);
      };
      try {
        render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
        fireEvent.click(screen.getByTestId('solver-assembly-add-part'));
        const writesForKeys = calls.filter((c) => c.key.startsWith('nexyfab:assembly'));
        expect(writesForKeys.length).toBe(0);
        expect(screen.queryByTestId('solver-assembly-saved')).toBeNull();
      } finally {
        window.localStorage.setItem = originalSetItem;
      }
    });

    it('with projectId: add-part → mate → debounced write under nexyfab:assembly:${pid}', async () => {
      render(
        <AssemblyBrowserModal
          lang="en"
          projectId="proj-asm-write"
          initialState={seedState()}
          onClose={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-add-part'));
      // useAssemblyStorage debounces 500 ms — wait for the localStorage
      // entry to appear (real timers; the hook uses setTimeout natively).
      await waitFor(
        () => {
          const raw = window.localStorage.getItem('nexyfab:assembly:proj-asm-write');
          expect(raw).not.toBeNull();
        },
        { timeout: 2000 },
      );
      const raw = window.localStorage.getItem('nexyfab:assembly:proj-asm-write')!;
      const parsed = JSON.parse(raw) as {
        version: number;
        state: { parts: unknown[] };
      };
      expect(parsed.version).toBe(1);
      // Original 2 parts from seedState() + 1 from the add-part click.
      expect(parsed.state.parts.length).toBe(3);
    });

    it('with projectId: mounts with pre-populated localStorage → rehydrates the assembly', () => {
      // Hand-craft a valid v1 envelope with one fixed part.
      const persisted = {
        version: 1,
        state: {
          parts: [
            {
              id: 'persisted_part',
              name: 'Persisted Part',
              partTemplateId: 'tpl',
              position: { x: 0, y: 0, z: 0 },
              orientation: IDENTITY_QUAT,
              fixed: true,
            },
          ],
          mates: [],
        },
      };
      window.localStorage.setItem(
        'nexyfab:assembly:proj-asm-load',
        JSON.stringify(persisted),
      );
      render(
        <AssemblyBrowserModal lang="en" projectId="proj-asm-load" onClose={vi.fn()} />,
      );
      expect(screen.getByTestId('solver-assembly-part-row-persisted_part')).toBeInTheDocument();
    });

    it('with projectId: initialFeatureTrees persist under nexyfab:assembly-trees:${pid}', async () => {
      const TINY_TREE: FeatureTree = { nodes: [] };
      render(
        <AssemblyBrowserModal
          lang="en"
          projectId="proj-asm-trees"
          initialState={seedState()}
          initialFeatureTrees={{ p_base: TINY_TREE }}
          onClose={vi.fn()}
        />,
      );
      // Trigger a tree-edit so the per-part record write fires. Open the
      // editor and type the same tree back — that round-trips through
      // setFeatureTrees and enqueues the debounced write.
      fireEvent.click(screen.getByTestId('solver-assembly-part-p_base-tree-toggle'));
      const ed = screen.getByTestId(
        'solver-assembly-part-p_base-tree-editor',
      ) as HTMLTextAreaElement;
      fireEvent.change(ed, { target: { value: '{ "nodes": [] }' } });
      await waitFor(
        () => {
          const raw = window.localStorage.getItem(
            'nexyfab:assembly-trees:proj-asm-trees',
          );
          expect(raw).not.toBeNull();
        },
        { timeout: 2000 },
      );
      const raw = window.localStorage.getItem(
        'nexyfab:assembly-trees:proj-asm-trees',
      )!;
      const parsed = JSON.parse(raw) as { record: Record<string, unknown> };
      expect(parsed.record).toHaveProperty('p_base');
    });

    it('with projectId: Reset button wipes parts + mates and shows empty placeholders', async () => {
      render(
        <AssemblyBrowserModal
          lang="en"
          projectId="proj-asm-reset"
          initialState={seedState()}
          onClose={vi.fn()}
        />,
      );
      // Sanity — seeded rows present.
      expect(screen.getByTestId('solver-assembly-part-row-p_base')).toBeInTheDocument();
      expect(screen.getByTestId('solver-assembly-mate-row-m1')).toBeInTheDocument();
      // Reset.
      fireEvent.click(screen.getByTestId('solver-assembly-reset'));
      await waitFor(() => {
        expect(screen.queryByTestId('solver-assembly-part-row-p_base')).toBeNull();
        expect(screen.queryByTestId('solver-assembly-mate-row-m1')).toBeNull();
      });
      // Empty placeholders return.
      expect(screen.getByTestId('solver-assembly-parts-empty')).toBeInTheDocument();
      expect(screen.getByTestId('solver-assembly-mates-empty')).toBeInTheDocument();
    });

    it('without projectId: Reset still clears the modal (in-memory mode)', async () => {
      render(<AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />);
      expect(screen.getByTestId('solver-assembly-part-row-p_base')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('solver-assembly-reset'));
      await waitFor(() =>
        expect(screen.queryByTestId('solver-assembly-part-row-p_base')).toBeNull(),
      );
      // Saved indicator absent (in-memory mode).
      expect(screen.queryByTestId('solver-assembly-saved')).toBeNull();
    });

    it('with projectId: trees-record quota-exceeded surfaces save-error banner', async () => {
      // Patch the instance method on window.localStorage — vi.spyOn against
      // Storage.prototype doesn't intercept jsdom's bound setItem.
      const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
      window.localStorage.setItem = (key: string, value: string) => {
        if (key === 'nexyfab:assembly-trees:proj-asm-quota') {
          const err = new Error('quota');
          err.name = 'QuotaExceededError';
          throw err;
        }
        originalSetItem(key, value);
      };
      try {
        render(
          <AssemblyBrowserModal
            lang="en"
            projectId="proj-asm-quota"
            initialState={seedState()}
            onClose={vi.fn()}
          />,
        );
        fireEvent.click(screen.getByTestId('solver-assembly-part-p_base-tree-toggle'));
        const ed = screen.getByTestId(
          'solver-assembly-part-p_base-tree-editor',
        ) as HTMLTextAreaElement;
        fireEvent.change(ed, { target: { value: '{ "nodes": [] }' } });
        const banner = await screen.findByTestId('solver-assembly-save-error', undefined, {
          timeout: 2000,
        });
        expect(banner.textContent).toMatch(/quota exceeded/i);
      } finally {
        window.localStorage.setItem = originalSetItem;
      }
    });
  });

  // ── Phase 5.2.3: Infer mates + SuggestedMatesPanel integration ──────────

  /**
   * The "Infer mates" button derives partFaces/partAxes from each part's
   * FeatureTree (Phase 1 AABB approximation) and feeds the result through
   * `inferMatesFromPlacements`. Suggestions are buffered in the modal's
   * state and rendered via `SuggestedMatesPanel`. Accept pushes the mate
   * into state.mates; reject silently drops it.
   */
  describe('Phase 5.2.3 Infer mates + SuggestedMatesPanel', () => {
    /**
     * Box-extrude FeatureTree — produces 6 AABB faces in the part's local
     * frame. Used as the building block for stacked-box adjacency tests.
     */
    const BOX_TREE: FeatureTree = {
      nodes: [
        {
          id: 'e1',
          name: 'Box',
          dependencies: [],
          payload: {
            kind: 'extrude',
            loop: [
              { x: 0, y: 0 },
              { x: 5, y: 0 },
              { x: 5, y: 5 },
              { x: 0, y: 5 },
            ],
            depth: 10,
            direction: 'one_sided',
            mode: 'add',
          },
        },
      ],
    };

    /** Two boxes stacked along +Z so A.top is coplanar with B.bottom. */
    function adjacentBoxesState(): AssemblyState {
      return {
        parts: [
          {
            id: 'p_a',
            name: 'Box A',
            partTemplateId: 'tpl',
            position: { x: 0, y: 0, z: 0 },
            orientation: IDENTITY_QUAT,
            fixed: true,
          },
          {
            id: 'p_b',
            name: 'Box B',
            partTemplateId: 'tpl',
            // Stacked directly on top: B.bottom (z=0 local) world-frame =
            // A.top (z=10 local) world-frame. Coincident mate expected.
            position: { x: 0, y: 0, z: 10 },
            orientation: IDENTITY_QUAT,
          },
        ],
        mates: [],
      };
    }

    /** Two boxes placed at non-coplanar positions → no inferred mates. */
    function farApartBoxesState(): AssemblyState {
      return {
        parts: [
          {
            id: 'p_a',
            name: 'Box A',
            partTemplateId: 'tpl',
            position: { x: 0, y: 0, z: 0 },
            orientation: IDENTITY_QUAT,
            fixed: true,
          },
          {
            id: 'p_b',
            name: 'Box B',
            partTemplateId: 'tpl',
            // Translate ALL THREE axes so no AABB face plane lines up
            // (otherwise side-side faces sit on a shared world plane and
            // emit false-positive coincident suggestions).
            position: { x: 100, y: 100, z: 100 },
            orientation: IDENTITY_QUAT,
          },
        ],
        mates: [],
      };
    }

    it('renders the Infer mates button', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      const btn = screen.getByTestId('solver-assembly-infer-mates-button');
      expect(btn).toBeInTheDocument();
      expect(btn.textContent).toMatch(/Infer mates/i);
    });

    it('clicking with 2 adjacent boxes emits ≥1 suggestion + mounts the panel', () => {
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={adjacentBoxesState()}
          initialFeatureTrees={{ p_a: BOX_TREE, p_b: BOX_TREE }}
          onClose={vi.fn()}
        />,
      );
      // Panel hidden before click.
      expect(screen.queryByTestId('solver-suggested-mates-panel')).toBeNull();
      fireEvent.click(screen.getByTestId('solver-assembly-infer-mates-button'));
      // Panel mounted with ≥1 suggestion.
      const panel = screen.getByTestId('solver-suggested-mates-panel');
      expect(panel).toBeInTheDocument();
      const matches = panel.querySelectorAll('[data-testid^="solver-suggested-mate-"]');
      // Filter out accept/reject buttons (testid prefix collision).
      const rows = Array.from(matches).filter((el) => {
        const id = el.getAttribute('data-testid')!;
        return !id.endsWith('-accept') && !id.endsWith('-reject');
      });
      expect(rows.length).toBeGreaterThanOrEqual(1);
      // Status banner reflects the count.
      expect(screen.getByTestId('solver-assembly-infer-mates-status')).toBeInTheDocument();
    });

    it('clicking with 2 far-apart boxes emits 0 suggestions + shows noSuggestions banner', () => {
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={farApartBoxesState()}
          initialFeatureTrees={{ p_a: BOX_TREE, p_b: BOX_TREE }}
          onClose={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-infer-mates-button'));
      // No panel mounted (suggestions empty).
      expect(screen.queryByTestId('solver-suggested-mates-panel')).toBeNull();
      // Empty banner shown instead.
      expect(screen.getByTestId('solver-assembly-infer-mates-empty')).toBeInTheDocument();
    });

    it('accept moves the suggestion from panel into state.mates', () => {
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={adjacentBoxesState()}
          initialFeatureTrees={{ p_a: BOX_TREE, p_b: BOX_TREE }}
          onClose={vi.fn()}
        />,
      );
      // Sanity — start with 0 mates.
      expect(screen.queryAllByTestId(/^solver-assembly-mate-row-/).length).toBe(0);
      fireEvent.click(screen.getByTestId('solver-assembly-infer-mates-button'));
      // Grab the first suggestion row and accept it.
      const panel = screen.getByTestId('solver-suggested-mates-panel');
      const firstRow = panel.querySelector('[data-testid^="solver-suggested-mate-"]') as HTMLElement;
      const mateId = firstRow.getAttribute('data-testid')!.replace('solver-suggested-mate-', '');
      const matesBefore = screen.queryAllByTestId(/^solver-assembly-mate-row-/).length;
      fireEvent.click(screen.getByTestId(`solver-suggested-mate-${mateId}-accept`));
      const matesAfter = screen.queryAllByTestId(/^solver-assembly-mate-row-/).length;
      expect(matesAfter).toBe(matesBefore + 1);
      // The accepted suggestion row is gone.
      expect(screen.queryByTestId(`solver-suggested-mate-${mateId}`)).toBeNull();
    });

    it('accept all batches every suggestion into state.mates and empties the panel', () => {
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={adjacentBoxesState()}
          initialFeatureTrees={{ p_a: BOX_TREE, p_b: BOX_TREE }}
          onClose={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-infer-mates-button'));
      const panel = screen.getByTestId('solver-suggested-mates-panel');
      const rowsBefore = panel.querySelectorAll('[data-testid^="solver-suggested-mate-"]');
      const suggestionCount = Array.from(rowsBefore).filter((el) => {
        const id = el.getAttribute('data-testid')!;
        return !id.endsWith('-accept') && !id.endsWith('-reject');
      }).length;
      expect(suggestionCount).toBeGreaterThanOrEqual(1);
      const matesBefore = screen.queryAllByTestId(/^solver-assembly-mate-row-/).length;
      fireEvent.click(screen.getByTestId('solver-suggested-accept-all'));
      const matesAfter = screen.queryAllByTestId(/^solver-assembly-mate-row-/).length;
      expect(matesAfter).toBe(matesBefore + suggestionCount);
      // Panel is unmounted (suggestions empty).
      expect(screen.queryByTestId('solver-suggested-mates-panel')).toBeNull();
    });

    it('reject removes a suggestion without adding to state.mates', () => {
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={adjacentBoxesState()}
          initialFeatureTrees={{ p_a: BOX_TREE, p_b: BOX_TREE }}
          onClose={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-infer-mates-button'));
      const panel = screen.getByTestId('solver-suggested-mates-panel');
      const firstRow = panel.querySelector('[data-testid^="solver-suggested-mate-"]') as HTMLElement;
      const mateId = firstRow.getAttribute('data-testid')!.replace('solver-suggested-mate-', '');
      const matesBefore = screen.queryAllByTestId(/^solver-assembly-mate-row-/).length;
      fireEvent.click(screen.getByTestId(`solver-suggested-mate-${mateId}-reject`));
      const matesAfter = screen.queryAllByTestId(/^solver-assembly-mate-row-/).length;
      expect(matesAfter).toBe(matesBefore);
      expect(screen.queryByTestId(`solver-suggested-mate-${mateId}`)).toBeNull();
    });

    it('reject all empties the panel without adding any mates', () => {
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={adjacentBoxesState()}
          initialFeatureTrees={{ p_a: BOX_TREE, p_b: BOX_TREE }}
          onClose={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-infer-mates-button'));
      const matesBefore = screen.queryAllByTestId(/^solver-assembly-mate-row-/).length;
      fireEvent.click(screen.getByTestId('solver-suggested-reject-all'));
      const matesAfter = screen.queryAllByTestId(/^solver-assembly-mate-row-/).length;
      expect(matesAfter).toBe(matesBefore);
      expect(screen.queryByTestId('solver-suggested-mates-panel')).toBeNull();
    });

    it('part without a FeatureTree contributes no faces (no suggestions)', () => {
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={adjacentBoxesState()}
          // Only p_a has a tree → p_b contributes 0 faces → 0 suggestions.
          initialFeatureTrees={{ p_a: BOX_TREE }}
          onClose={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-infer-mates-button'));
      expect(screen.queryByTestId('solver-suggested-mates-panel')).toBeNull();
      expect(screen.getByTestId('solver-assembly-infer-mates-empty')).toBeInTheDocument();
    });

    it('partNameById resolves part names in the suggestion ref text', () => {
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={adjacentBoxesState()}
          initialFeatureTrees={{ p_a: BOX_TREE, p_b: BOX_TREE }}
          onClose={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-infer-mates-button'));
      const panel = screen.getByTestId('solver-suggested-mates-panel');
      // The friendly names "Box A" / "Box B" appear in the ref text instead
      // of the raw partIds p_a / p_b.
      expect(panel.textContent).toMatch(/Box A/);
      expect(panel.textContent).toMatch(/Box B/);
    });

    it('onInferMates override is used in place of the default pipeline', () => {
      const fake = vi.fn().mockReturnValue([
        {
          id: 'fake_1',
          kind: 'coincident',
          a: { partId: 'p_a', refId: 'face_x', refKind: 'face' },
          b: { partId: 'p_b', refId: 'face_y', refKind: 'face' },
        },
      ]);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={adjacentBoxesState()}
          onClose={vi.fn()}
          onInferMates={fake}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-infer-mates-button'));
      expect(fake).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('solver-suggested-mate-fake_1')).toBeInTheDocument();
    });

    it.each<[AssemblyBrowserLang, RegExp]>([
      ['ko', /메이트 추론/],
      ['en', /Infer mates/i],
    ])('i18n: lang %s localizes the Infer mates button label', (lang, re) => {
      render(<AssemblyBrowserModal lang={lang} onClose={vi.fn()} />);
      expect(
        screen.getByTestId('solver-assembly-infer-mates-button').textContent,
      ).toMatch(re);
    });

    it.each<[AssemblyBrowserLang, RegExp]>([
      ['ko', /추천된 메이트가 없습니다/],
      ['en', /No mate suggestions/i],
    ])('i18n: lang %s localizes the noSuggestions banner', (lang, re) => {
      render(
        <AssemblyBrowserModal
          lang={lang}
          initialState={farApartBoxesState()}
          initialFeatureTrees={{ p_a: BOX_TREE, p_b: BOX_TREE }}
          onClose={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-infer-mates-button'));
      expect(
        screen.getByTestId('solver-assembly-infer-mates-empty').textContent,
      ).toMatch(re);
    });
  });

  // ── Phase 4.2: useAssemblyHistory integration (Undo/Redo/history panel) ──
  //
  /**
   * The modal hosts a `useAssemblyHistory` instance — the 4 "structural"
   * mutations (add part / remove part / add mate / accept suggestion +
   * remove mate) push validated snapshots onto the history stack with a
   * localized description. Non-structural edits (rename, fixed toggle,
   * mate kind change, mate ref edit, mate value edit) bypass history via
   * the override layer so transient IR-invalid edits don't throw.
   *
   * Undo/Redo are exposed both as footer buttons (disabled when the stack
   * is empty) and as window-level Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z. The
   * keyboard handler intentionally ignores keystrokes inside text-editing
   * widgets so the browser's native input undo still works there.
   */
  describe('Phase 4.2 history (useAssemblyHistory integration)', () => {
    it('Undo and Redo buttons render and start disabled', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      const undo = screen.getByTestId('solver-assembly-undo') as HTMLButtonElement;
      const redo = screen.getByTestId('solver-assembly-redo') as HTMLButtonElement;
      expect(undo).toBeInTheDocument();
      expect(redo).toBeInTheDocument();
      expect(undo.disabled).toBe(true);
      expect(redo.disabled).toBe(true);
    });

    it('Add part enables Undo and shows "Add part" in the history panel', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-add-part'));
      const undo = screen.getByTestId('solver-assembly-undo') as HTMLButtonElement;
      expect(undo.disabled).toBe(false);
      // History panel shows the most recent change description.
      expect(screen.getByTestId('solver-assembly-history-current').textContent).toMatch(
        /Add part part_1/,
      );
      expect(
        screen.getByTestId('solver-assembly-history-entry-0').textContent,
      ).toMatch(/Add part part_1/);
    });

    it('Undo after Add part removes the part and enables Redo', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-add-part'));
      expect(screen.getByTestId('solver-assembly-part-row-part_1')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('solver-assembly-undo'));
      expect(screen.queryByTestId('solver-assembly-part-row-part_1')).toBeNull();
      const redo = screen.getByTestId('solver-assembly-redo') as HTMLButtonElement;
      expect(redo.disabled).toBe(false);
    });

    it('Redo after Undo replays the Add part', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-add-part'));
      fireEvent.click(screen.getByTestId('solver-assembly-undo'));
      fireEvent.click(screen.getByTestId('solver-assembly-redo'));
      expect(screen.getByTestId('solver-assembly-part-row-part_1')).toBeInTheDocument();
      const redo = screen.getByTestId('solver-assembly-redo') as HTMLButtonElement;
      expect(redo.disabled).toBe(true);
    });

    it('+ Add mate (via "+ Add mate" button) updates description with mate id', () => {
      // Seed has 2 parts + 1 mate so the new mate id is mate_2 and validates.
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-add-mate'));
      expect(screen.getByTestId('solver-assembly-history-current').textContent).toMatch(
        /Add mate mate_2/,
      );
    });

    it('Remove mate (per-row button) records "Remove mate <id>"', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-mate-remove-m1'));
      expect(screen.getByTestId('solver-assembly-history-current').textContent).toMatch(
        /Remove mate m1/,
      );
    });

    it('Accept inferred suggestion records "Accept inferred mate ..."', () => {
      // Use the onInferMates override path so we can know the suggestion id
      // up-front and avoid coupling to the default inference algorithm.
      const fake = vi.fn().mockReturnValue([
        {
          id: 'inferred_concentric_0',
          kind: 'concentric',
          a: { partId: 'p_base', refId: 'z_axis', refKind: 'axis' },
          b: { partId: 'p_arm', refId: 'z_axis', refKind: 'axis' },
        },
      ]);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onInferMates={fake}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-infer-mates-button'));
      fireEvent.click(
        screen.getByTestId('solver-suggested-mate-inferred_concentric_0-accept'),
      );
      expect(screen.getByTestId('solver-assembly-history-current').textContent).toMatch(
        /Accept inferred mate inferred_concentric_0/,
      );
    });

    it('Ctrl+Z (window keydown) undoes when canUndo is true', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-add-part'));
      expect(screen.getByTestId('solver-assembly-part-row-part_1')).toBeInTheDocument();
      // Fire on window so the modal-level keydown listener catches it.
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
      expect(screen.queryByTestId('solver-assembly-part-row-part_1')).toBeNull();
    });

    it('Ctrl+Y (window keydown) redoes when canRedo is true', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-add-part'));
      fireEvent.click(screen.getByTestId('solver-assembly-undo'));
      fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
      expect(screen.getByTestId('solver-assembly-part-row-part_1')).toBeInTheDocument();
    });

    it('Ctrl+Shift+Z (window keydown) also redoes', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-add-part'));
      fireEvent.click(screen.getByTestId('solver-assembly-undo'));
      fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true });
      expect(screen.getByTestId('solver-assembly-part-row-part_1')).toBeInTheDocument();
    });

    it('history list shows 3 entries after 3 structural changes', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-add-part'));
      fireEvent.click(screen.getByTestId('solver-assembly-add-part'));
      fireEvent.click(screen.getByTestId('solver-assembly-add-part'));
      const list = screen.getByTestId('solver-assembly-history-list');
      // Present + 2 past entries should render (Initial is also a past entry
      // so the actual count is 4 — we just assert at least 3 rows render and
      // the most-recent is the third add).
      const rows = within(list).queryAllByText(/Add part part_/);
      expect(rows.length).toBeGreaterThanOrEqual(3);
      expect(
        screen.getByTestId('solver-assembly-history-entry-0').textContent,
      ).toMatch(/Add part part_3/);
    });

    it('non-structural edits (rename) do NOT push to history', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      // Sanity — start with no recorded changes (only the synthetic Initial
      // entry, which is the present and yields canUndo=false).
      const undo = screen.getByTestId('solver-assembly-undo') as HTMLButtonElement;
      expect(undo.disabled).toBe(true);
      // Rename a part — direct edit, should NOT enable Undo.
      const name = screen.getByTestId('solver-assembly-part-name-p_arm') as HTMLInputElement;
      fireEvent.change(name, { target: { value: 'Crank Arm' } });
      expect(
        (screen.getByTestId('solver-assembly-undo') as HTMLButtonElement).disabled,
      ).toBe(true);
      // Value persists despite no history entry.
      expect(
        (screen.getByTestId('solver-assembly-part-name-p_arm') as HTMLInputElement).value,
      ).toBe('Crank Arm');
    });

    it('Undo button is disabled while Undo stack is empty even after non-tracked edits', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      fireEvent.change(screen.getByTestId('solver-assembly-mate-kind-m1'), {
        target: { value: 'distance' },
      });
      expect(
        (screen.getByTestId('solver-assembly-undo') as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it('Ctrl+Z fired with focus inside an INPUT does NOT trigger modal undo', () => {
      // Seed two parts so we can grab a stable text-input target. After the
      // add-part click the new part is `part_3` (seedState had 2 parts).
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-add-part'));
      const inp = screen.getByTestId('solver-assembly-part-name-p_arm') as HTMLInputElement;
      inp.focus();
      // Dispatch from the input element — handler should bail out.
      fireEvent.keyDown(inp, { key: 'z', ctrlKey: true, bubbles: true });
      // The newly added part row is still there (undo was suppressed).
      expect(screen.getByTestId('solver-assembly-part-row-part_3')).toBeInTheDocument();
    });

    it.each<[AssemblyBrowserLang, RegExp, RegExp]>([
      ['ko', /실행 취소/, /다시 실행/],
      ['en', /Undo/, /Redo/],
      ['ja', /元に戻す/, /やり直し/],
      ['zh', /撤销/, /重做/],
      ['es', /Deshacer/, /Rehacer/],
      ['ar', /تراجع/, /إعادة/],
    ])('i18n: lang %s localizes Undo / Redo button labels', (lang, undoRe, redoRe) => {
      render(<AssemblyBrowserModal lang={lang} onClose={vi.fn()} />);
      expect(screen.getByTestId('solver-assembly-undo').textContent).toMatch(undoRe);
      expect(screen.getByTestId('solver-assembly-redo').textContent).toMatch(redoRe);
    });
  });

  // ── STEP assembly import (Phase 4.B) ────────────────────────────────────

  describe('STEP assembly import', () => {
    /**
     * Helpers for the file-picker tests. We always inject an `onImportStepAssembly`
     * mock so the test never touches the real STEP parser — exercises the
     * UI behaviour (button click → file picker → result panel → history)
     * in isolation.
     */
    function makeFile(content: string, name = 'asm.step', size?: number): File {
      const blob = new Blob([content], { type: 'application/step' });
      const file = new File([blob], name, { type: 'application/step' });
      // Some tests need to fake a much larger size than the actual content
      // so we don't have to allocate a 5 MiB string. Object.defineProperty
      // is the standard jsdom escape hatch for this.
      if (size !== undefined) {
        Object.defineProperty(file, 'size', { value: size, configurable: true });
      }
      return file;
    }

    function pickFile(input: HTMLInputElement, file: File): void {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      fireEvent.change(input);
    }

    function fakeResult(partIds: string[], opts: {
      warnings?: string[];
      unsupported?: string[];
    } = {}) {
      return {
        state: {
          parts: partIds.map((id, i) => ({
            id,
            name: id,
            partTemplateId: `pd_${id}`,
            position: { x: 0, y: 0, z: 0 },
            orientation: IDENTITY_QUAT,
            fixed: i === 0,
          })),
          mates: [],
        },
        featureTrees: Object.fromEntries(
          partIds.map((id) => [id, { nodes: [] } as FeatureTree]),
        ),
        warnings: opts.warnings ?? [],
        unsupported: opts.unsupported ?? [],
      };
    }

    it('renders the "Import STEP assembly" footer button + hidden file input', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      const btn = screen.getByTestId('solver-assembly-import-step');
      expect(btn).toBeInTheDocument();
      expect(btn.textContent).toMatch(/Import STEP assembly/i);
      const input = screen.getByTestId(
        'solver-assembly-import-step-file-input',
      ) as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.type).toBe('file');
      expect(input.accept).toMatch(/\.step/);
    });

    it('picking a file invokes onImportStepAssembly and renders the summary', async () => {
      const onImport = vi.fn().mockResolvedValue(
        fakeResult(['box_1', 'box_2'], { warnings: ['heal:trim_ws'] }),
      );
      render(
        <AssemblyBrowserModal lang="en" onClose={vi.fn()} onImportStepAssembly={onImport} />,
      );
      const input = screen.getByTestId(
        'solver-assembly-import-step-file-input',
      ) as HTMLInputElement;
      pickFile(input, makeFile('ISO-10303-21;\nHEADER;\nENDSEC;\n', 'mini.step'));
      await waitFor(() =>
        expect(screen.getByTestId('solver-assembly-import-result')).toBeInTheDocument(),
      );
      expect(onImport).toHaveBeenCalledTimes(1);
      const [src, name] = onImport.mock.calls[0] as [string, string];
      expect(src).toContain('ISO-10303-21');
      expect(name).toBe('mini.step');
      expect(screen.getByTestId('solver-assembly-import-summary').textContent).toMatch(
        /Imported 2 parts, 1 warnings, 0 unsupported/,
      );
      // Parts row now rendered from the imported state.
      expect(screen.getByTestId('solver-assembly-part-row-box_1')).toBeInTheDocument();
      expect(screen.getByTestId('solver-assembly-part-row-box_2')).toBeInTheDocument();
    });

    it('warnings list is collapsible and reveals per-warning rows on expand', async () => {
      const onImport = vi.fn().mockResolvedValue(
        fakeResult(['p1'], { warnings: ['heal:bom_strip', 'part_p1:unsupported_face'] }),
      );
      render(
        <AssemblyBrowserModal lang="en" onClose={vi.fn()} onImportStepAssembly={onImport} />,
      );
      pickFile(
        screen.getByTestId('solver-assembly-import-step-file-input') as HTMLInputElement,
        makeFile('SRC'),
      );
      await waitFor(() =>
        expect(
          screen.getByTestId('solver-assembly-import-warnings-toggle'),
        ).toBeInTheDocument(),
      );
      // Collapsed by default.
      expect(
        screen.queryByTestId('solver-assembly-import-warnings-list'),
      ).toBeNull();
      fireEvent.click(screen.getByTestId('solver-assembly-import-warnings-toggle'));
      const list = screen.getByTestId('solver-assembly-import-warnings-list');
      expect(within(list).queryAllByRole('listitem')).toHaveLength(2);
      expect(
        screen.getByTestId('solver-assembly-import-warning-0').textContent,
      ).toMatch(/heal:bom_strip/);
      expect(
        screen.getByTestId('solver-assembly-import-warning-1').textContent,
      ).toMatch(/unsupported_face/);
    });

    it('unsupported list is collapsible and reveals per-entry rows on expand', async () => {
      const onImport = vi.fn().mockResolvedValue(
        fakeResult(['p1'], { unsupported: ['solid_42:nurbs_surface', 'solid_7:bspline'] }),
      );
      render(
        <AssemblyBrowserModal lang="en" onClose={vi.fn()} onImportStepAssembly={onImport} />,
      );
      pickFile(
        screen.getByTestId('solver-assembly-import-step-file-input') as HTMLInputElement,
        makeFile('SRC'),
      );
      await waitFor(() =>
        expect(
          screen.getByTestId('solver-assembly-import-unsupported-toggle'),
        ).toBeInTheDocument(),
      );
      expect(
        screen.queryByTestId('solver-assembly-import-unsupported-list'),
      ).toBeNull();
      fireEvent.click(screen.getByTestId('solver-assembly-import-unsupported-toggle'));
      const list = screen.getByTestId('solver-assembly-import-unsupported-list');
      expect(within(list).queryAllByRole('listitem')).toHaveLength(2);
      expect(
        screen.getByTestId('solver-assembly-import-unsupported-0').textContent,
      ).toMatch(/nurbs_surface/);
    });

    it('file > 5 MB cap surfaces the 413 error and never calls the importer', async () => {
      const onImport = vi.fn();
      render(
        <AssemblyBrowserModal
          lang="en"
          onClose={vi.fn()}
          onImportStepAssembly={onImport}
        />,
      );
      const huge = makeFile('x', 'big.step', 6 * 1024 * 1024);
      pickFile(
        screen.getByTestId('solver-assembly-import-step-file-input') as HTMLInputElement,
        huge,
      );
      await waitFor(() =>
        expect(screen.getByTestId('solver-assembly-import-error')).toBeInTheDocument(),
      );
      expect(screen.getByTestId('solver-assembly-import-error').getAttribute('data-http-status'))
        .toBe('413');
      expect(screen.getByTestId('solver-assembly-import-error').textContent).toMatch(
        /5 MB|413/,
      );
      expect(onImport).not.toHaveBeenCalled();
    });

    it('custom importStepMaxBytes lets tiny files trigger the 413 path', async () => {
      const onImport = vi.fn();
      render(
        <AssemblyBrowserModal
          lang="en"
          onClose={vi.fn()}
          onImportStepAssembly={onImport}
          importStepMaxBytes={16}
        />,
      );
      pickFile(
        screen.getByTestId('solver-assembly-import-step-file-input') as HTMLInputElement,
        makeFile('PADDED LONGER THAN 16 BYTES'),
      );
      await waitFor(() =>
        expect(screen.getByTestId('solver-assembly-import-error')).toBeInTheDocument(),
      );
      expect(
        screen.getByTestId('solver-assembly-import-error').getAttribute('data-http-status'),
      ).toBe('413');
      expect(onImport).not.toHaveBeenCalled();
    });

    it('empty file (0 bytes) surfaces the 400 error and skips the importer', async () => {
      const onImport = vi.fn();
      render(
        <AssemblyBrowserModal lang="en" onClose={vi.fn()} onImportStepAssembly={onImport} />,
      );
      pickFile(
        screen.getByTestId('solver-assembly-import-step-file-input') as HTMLInputElement,
        makeFile('', 'empty.step', 0),
      );
      await waitFor(() =>
        expect(screen.getByTestId('solver-assembly-import-error')).toBeInTheDocument(),
      );
      expect(
        screen.getByTestId('solver-assembly-import-error').getAttribute('data-http-status'),
      ).toBe('400');
      expect(onImport).not.toHaveBeenCalled();
    });

    it('whitespace-only file is treated as empty (400) without invoking importer', async () => {
      const onImport = vi.fn();
      render(
        <AssemblyBrowserModal lang="en" onClose={vi.fn()} onImportStepAssembly={onImport} />,
      );
      pickFile(
        screen.getByTestId('solver-assembly-import-step-file-input') as HTMLInputElement,
        makeFile('   \n\t  '),
      );
      await waitFor(() =>
        expect(screen.getByTestId('solver-assembly-import-error')).toBeInTheDocument(),
      );
      expect(
        screen.getByTestId('solver-assembly-import-error').getAttribute('data-http-status'),
      ).toBe('400');
      expect(onImport).not.toHaveBeenCalled();
    });

    it('successful import is recorded in history → Ctrl+Z reverts to the prior state', async () => {
      const onImport = vi.fn().mockResolvedValue(fakeResult(['imported_a', 'imported_b']));
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onImportStepAssembly={onImport}
        />,
      );
      // Pre-import: seedState parts visible.
      expect(screen.getByTestId('solver-assembly-part-row-p_base')).toBeInTheDocument();
      pickFile(
        screen.getByTestId('solver-assembly-import-step-file-input') as HTMLInputElement,
        makeFile('SRC', 'demo.step'),
      );
      await waitFor(() =>
        expect(screen.getByTestId('solver-assembly-part-row-imported_a')).toBeInTheDocument(),
      );
      // Description recorded.
      expect(screen.getByTestId('solver-assembly-history-current').textContent).toMatch(
        /Import STEP assembly demo\.step \(2 parts\)/,
      );
      // Undo button is now enabled — click it and the original parts return.
      const undo = screen.getByTestId('solver-assembly-undo') as HTMLButtonElement;
      expect(undo.disabled).toBe(false);
      fireEvent.click(undo);
      expect(screen.getByTestId('solver-assembly-part-row-p_base')).toBeInTheDocument();
      expect(screen.queryByTestId('solver-assembly-part-row-imported_a')).toBeNull();
    });

    it('importer throw surfaces as a 422 error without corrupting history', async () => {
      const onImport = vi.fn().mockRejectedValue(new Error('circular_assembly: cycle #1 → #1'));
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onImportStepAssembly={onImport}
        />,
      );
      pickFile(
        screen.getByTestId('solver-assembly-import-step-file-input') as HTMLInputElement,
        makeFile('SRC'),
      );
      await waitFor(() =>
        expect(screen.getByTestId('solver-assembly-import-error')).toBeInTheDocument(),
      );
      expect(
        screen.getByTestId('solver-assembly-import-error').getAttribute('data-http-status'),
      ).toBe('422');
      expect(screen.getByTestId('solver-assembly-import-error').textContent).toMatch(
        /circular_assembly/,
      );
      // Original parts still present — failed import did not mutate state.
      expect(screen.getByTestId('solver-assembly-part-row-p_base')).toBeInTheDocument();
      // Undo still disabled (nothing recorded).
      expect(
        (screen.getByTestId('solver-assembly-undo') as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it('Reset button clears a finished import result panel', async () => {
      const onImport = vi.fn().mockResolvedValue(
        fakeResult(['p1'], { warnings: ['w1'], unsupported: ['u1'] }),
      );
      render(
        <AssemblyBrowserModal lang="en" onClose={vi.fn()} onImportStepAssembly={onImport} />,
      );
      pickFile(
        screen.getByTestId('solver-assembly-import-step-file-input') as HTMLInputElement,
        makeFile('SRC'),
      );
      await waitFor(() =>
        expect(screen.getByTestId('solver-assembly-import-result')).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByTestId('solver-assembly-reset'));
      expect(screen.queryByTestId('solver-assembly-import-result')).toBeNull();
    });

    it.each<[AssemblyBrowserLang, RegExp]>([
      ['ko', /STEP 어셈블리 가져오기/],
      ['en', /Import STEP assembly/],
      ['ja', /STEP アセンブリ取込/],
      ['zh', /导入 STEP 装配/],
      ['es', /Importar ensamblaje STEP/],
      ['ar', /استيراد تجميع STEP/],
    ])('i18n: lang %s localizes the import button label', (lang, re) => {
      render(<AssemblyBrowserModal lang={lang} onClose={vi.fn()} />);
      expect(screen.getByTestId('solver-assembly-import-step').textContent).toMatch(re);
    });
  });

  // ── Phase 5.2.4: NAUO inference auto-prompt after STEP import ─────────────

  /**
   * "Auto-infer mates after import" UX — when the wrapping page tells the
   * modal that the seed came from a sample-load (or, in the wired path,
   * a STEP import that remounts the modal with `autoInferOnMount`), the
   * modal runs `inferMatesFromPlacements` once on mount and surfaces a
   * "Imported N parts, inferred M suggestions" toast.
   *
   * The user-pref live-toggles via a footer checkbox that persists to
   * `localStorage['nexyfab:autoInfer']` (default `true`). When unchecked
   * the auto-trigger silently bails — the existing manual "Infer mates"
   * button stays the only path.
   */
  describe('Phase 5.2.4 NAUO inference auto-prompt', () => {
    /** Same 5×5×10 box tree used by the Phase 5.2.3 suite. */
    const BOX_TREE: FeatureTree = {
      nodes: [
        {
          id: 'e1',
          name: 'Box',
          dependencies: [],
          payload: {
            kind: 'extrude',
            loop: [
              { x: 0, y: 0 },
              { x: 5, y: 0 },
              { x: 5, y: 5 },
              { x: 0, y: 5 },
            ],
            depth: 10,
            direction: 'one_sided',
            mode: 'add',
          },
        },
      ],
    };

    function adjacentBoxesState(): AssemblyState {
      return {
        parts: [
          {
            id: 'p_a',
            name: 'Box A',
            partTemplateId: 'tpl',
            position: { x: 0, y: 0, z: 0 },
            orientation: IDENTITY_QUAT,
            fixed: true,
          },
          {
            id: 'p_b',
            name: 'Box B',
            partTemplateId: 'tpl',
            position: { x: 0, y: 0, z: 10 },
            orientation: IDENTITY_QUAT,
          },
        ],
        mates: [],
      };
    }

    beforeEach(() => {
      // Reset the persistence slot before every test so we get clean
      // default-true hydration unless the test explicitly seeds 'false'.
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem('nexyfab:autoInfer');
      }
    });

    afterEach(() => {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem('nexyfab:autoInfer');
      }
    });

    it('renders the auto-infer checkbox, checked by default', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      const cb = screen.getByTestId('solver-assembly-auto-infer') as HTMLInputElement;
      expect(cb).toBeInTheDocument();
      expect(cb.type).toBe('checkbox');
      expect(cb.checked).toBe(true);
    });

    it('autoInferOnMount + autoInfer=true seeds suggestions without a click', () => {
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={adjacentBoxesState()}
          initialFeatureTrees={{ p_a: BOX_TREE, p_b: BOX_TREE }}
          onClose={vi.fn()}
          autoInferOnMount
        />,
      );
      // Suggested panel mounted automatically.
      const panel = screen.getByTestId('solver-suggested-mates-panel');
      expect(panel).toBeInTheDocument();
      const rows = panel.querySelectorAll('[data-testid^="solver-suggested-mate-"]');
      const suggestionRows = Array.from(rows).filter((el) => {
        const id = el.getAttribute('data-testid')!;
        return !id.endsWith('-accept') && !id.endsWith('-reject');
      });
      expect(suggestionRows.length).toBeGreaterThanOrEqual(1);
      // Status banner reflects auto-trigger as well.
      expect(screen.getByTestId('solver-assembly-infer-mates-status')).toBeInTheDocument();
    });

    it('autoInferOnMount=false leaves suggestions buffer empty on mount', () => {
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={adjacentBoxesState()}
          initialFeatureTrees={{ p_a: BOX_TREE, p_b: BOX_TREE }}
          onClose={vi.fn()}
        />,
      );
      // Default autoInferOnMount=false → panel never mounted.
      expect(screen.queryByTestId('solver-suggested-mates-panel')).toBeNull();
      // hasInferred is false → no banner either.
      expect(screen.queryByTestId('solver-assembly-infer-mates-status')).toBeNull();
      expect(screen.queryByTestId('solver-assembly-infer-mates-empty')).toBeNull();
    });

    it('autoInferOnMount + initialAutoInfer=false bails out (no suggestions, no toast)', () => {
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={adjacentBoxesState()}
          initialFeatureTrees={{ p_a: BOX_TREE, p_b: BOX_TREE }}
          onClose={vi.fn()}
          autoInferOnMount
          initialAutoInfer={false}
        />,
      );
      expect(screen.queryByTestId('solver-suggested-mates-panel')).toBeNull();
      expect(screen.queryByTestId('solver-assembly-import-toast')).toBeNull();
    });

    it('toast text reads "Imported N parts, inferred M mate suggestions"', () => {
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={adjacentBoxesState()}
          initialFeatureTrees={{ p_a: BOX_TREE, p_b: BOX_TREE }}
          onClose={vi.fn()}
          autoInferOnMount
        />,
      );
      const toast = screen.getByTestId('solver-assembly-import-toast-text');
      expect(toast.textContent).toMatch(/Imported 2 parts, inferred \d+ mate suggestions/);
    });

    it('clicking Dismiss removes the toast', () => {
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={adjacentBoxesState()}
          initialFeatureTrees={{ p_a: BOX_TREE, p_b: BOX_TREE }}
          onClose={vi.fn()}
          autoInferOnMount
        />,
      );
      expect(screen.getByTestId('solver-assembly-import-toast')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('solver-assembly-import-toast-dismiss'));
      expect(screen.queryByTestId('solver-assembly-import-toast')).toBeNull();
    });

    it('localStorage seeded false → checkbox reflects false', () => {
      window.localStorage.setItem('nexyfab:autoInfer', 'false');
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      const cb = screen.getByTestId('solver-assembly-auto-infer') as HTMLInputElement;
      expect(cb.checked).toBe(false);
    });

    it('toggling the checkbox writes through to localStorage', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      const cb = screen.getByTestId('solver-assembly-auto-infer') as HTMLInputElement;
      // Uncheck.
      fireEvent.click(cb);
      expect(cb.checked).toBe(false);
      expect(window.localStorage.getItem('nexyfab:autoInfer')).toBe('false');
      // Re-check.
      fireEvent.click(cb);
      expect(cb.checked).toBe(true);
      expect(window.localStorage.getItem('nexyfab:autoInfer')).toBe('true');
    });

    it('auto-trigger bails when fewer than 2 parts are present', () => {
      const onlyOne: AssemblyState = {
        parts: [
          {
            id: 'p_a',
            name: 'Box A',
            partTemplateId: 'tpl',
            position: { x: 0, y: 0, z: 0 },
            orientation: IDENTITY_QUAT,
            fixed: true,
          },
        ],
        mates: [],
      };
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={onlyOne}
          initialFeatureTrees={{ p_a: BOX_TREE }}
          onClose={vi.fn()}
          autoInferOnMount
        />,
      );
      expect(screen.queryByTestId('solver-assembly-import-toast')).toBeNull();
      expect(screen.queryByTestId('solver-suggested-mates-panel')).toBeNull();
    });

    it('auto-trigger bails when no FeatureTree is supplied', () => {
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={adjacentBoxesState()}
          onClose={vi.fn()}
          autoInferOnMount
        />,
      );
      expect(screen.queryByTestId('solver-assembly-import-toast')).toBeNull();
      expect(screen.queryByTestId('solver-suggested-mates-panel')).toBeNull();
    });

    it('autoInferOnMount fires exactly once — toggling autoInfer off later does not re-undo it', () => {
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={adjacentBoxesState()}
          initialFeatureTrees={{ p_a: BOX_TREE, p_b: BOX_TREE }}
          onClose={vi.fn()}
          autoInferOnMount
        />,
      );
      expect(screen.getByTestId('solver-suggested-mates-panel')).toBeInTheDocument();
      // Flip the checkbox off — suggestions stay (we don't retroactively
      // clear them, the user can manually reject-all).
      fireEvent.click(screen.getByTestId('solver-assembly-auto-infer'));
      expect(screen.getByTestId('solver-suggested-mates-panel')).toBeInTheDocument();
    });

    it('onInferMates override is honoured by the auto-trigger pipeline', () => {
      const fake = vi.fn().mockReturnValue([
        {
          id: 'auto_fake_1',
          kind: 'coincident',
          a: { partId: 'p_a', refId: 'face_x', refKind: 'face' },
          b: { partId: 'p_b', refId: 'face_y', refKind: 'face' },
        },
      ]);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={adjacentBoxesState()}
          initialFeatureTrees={{ p_a: BOX_TREE, p_b: BOX_TREE }}
          onClose={vi.fn()}
          autoInferOnMount
          onInferMates={fake}
        />,
      );
      expect(fake).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('solver-suggested-mate-auto_fake_1')).toBeInTheDocument();
      // Toast count reflects the fake's single return.
      expect(screen.getByTestId('solver-assembly-import-toast-text').textContent).toMatch(
        /Imported 2 parts, inferred 1 mate suggestions/,
      );
    });

    it('STEP import with autoInfer=true populates toast + suggestions in one step', async () => {
      // Build a fake importer that returns 2 parts + featureTrees that
      // produce face overlap → inferMatesFromPlacements emits ≥1
      // suggestion via the default pipeline.
      const onImport = vi.fn().mockResolvedValue({
        state: adjacentBoxesState(),
        featureTrees: { p_a: BOX_TREE, p_b: BOX_TREE },
        warnings: [],
        unsupported: [],
      });
      render(
        <AssemblyBrowserModal
          lang="en"
          onClose={vi.fn()}
          onImportStepAssembly={onImport}
        />,
      );
      const input = screen.getByTestId(
        'solver-assembly-import-step-file-input',
      ) as HTMLInputElement;
      const blob = new Blob(['SRC'], { type: 'application/step' });
      const file = new File([blob], 'auto.step', { type: 'application/step' });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      fireEvent.change(input);
      await waitFor(() =>
        expect(screen.getByTestId('solver-assembly-import-toast')).toBeInTheDocument(),
      );
      expect(screen.getByTestId('solver-assembly-import-toast-text').textContent).toMatch(
        /Imported 2 parts, inferred \d+ mate suggestions/,
      );
      // Suggested panel mounted from the auto-trigger.
      expect(screen.getByTestId('solver-suggested-mates-panel')).toBeInTheDocument();
    });

    it('STEP import with autoInfer=false skips inference but still imports', async () => {
      window.localStorage.setItem('nexyfab:autoInfer', 'false');
      const onImport = vi.fn().mockResolvedValue({
        state: adjacentBoxesState(),
        featureTrees: { p_a: BOX_TREE, p_b: BOX_TREE },
        warnings: [],
        unsupported: [],
      });
      render(
        <AssemblyBrowserModal
          lang="en"
          onClose={vi.fn()}
          onImportStepAssembly={onImport}
        />,
      );
      const input = screen.getByTestId(
        'solver-assembly-import-step-file-input',
      ) as HTMLInputElement;
      const blob = new Blob(['SRC'], { type: 'application/step' });
      const file = new File([blob], 'auto.step', { type: 'application/step' });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      fireEvent.change(input);
      // Import summary still renders (regular import path is untouched).
      await waitFor(() =>
        expect(screen.getByTestId('solver-assembly-import-result')).toBeInTheDocument(),
      );
      // …but no auto-infer side effects.
      expect(screen.queryByTestId('solver-assembly-import-toast')).toBeNull();
      expect(screen.queryByTestId('solver-suggested-mates-panel')).toBeNull();
    });

    it.each<[AssemblyBrowserLang, RegExp]>([
      ['ko', /가져오기 후 메이트 자동 추론/],
      ['en', /Auto-infer mates after import/i],
      ['ja', /取込後に合致を自動推論/],
      ['zh', /导入后自动推断配合/],
      ['es', /Inferir restricciones tras importar/i],
      ['ar', /استنتاج القيود تلقائيًا بعد الاستيراد/],
    ])('i18n: lang %s localizes the auto-infer checkbox label', (lang, re) => {
      render(<AssemblyBrowserModal lang={lang} onClose={vi.fn()} />);
      expect(
        screen.getByTestId('solver-assembly-auto-infer-label').textContent,
      ).toMatch(re);
    });

    it.each<[AssemblyBrowserLang, RegExp]>([
      ['ko', /부품을 가져오고/],
      ['en', /Imported \d+ parts, inferred \d+ mate suggestions/i],
    ])('i18n: lang %s localizes the inferred-summary toast', (lang, re) => {
      render(
        <AssemblyBrowserModal
          lang={lang}
          initialState={adjacentBoxesState()}
          initialFeatureTrees={{ p_a: BOX_TREE, p_b: BOX_TREE }}
          onClose={vi.fn()}
          autoInferOnMount
        />,
      );
      expect(
        screen.getByTestId('solver-assembly-import-toast-text').textContent,
      ).toMatch(re);
    });
  });

  // ── Phase 3.AI.Assembly: AI builder toggle + per-part planner + NL ──────
  describe('Phase 3.AI.Assembly AI builder', () => {
    /** Box-extrude tree reused as currentTree by the per-part planner. */
    const BOX_TREE: FeatureTree = {
      nodes: [
        {
          id: 'e1',
          name: 'Box',
          dependencies: [],
          payload: {
            kind: 'extrude',
            loop: [
              { x: 0, y: 0 },
              { x: 5, y: 0 },
              { x: 5, y: 5 },
              { x: 0, y: 5 },
            ],
            depth: 10,
            direction: 'one_sided',
            mode: 'add',
          },
        },
      ],
    };

    it('AI toggle is visible and defaults to off (panel and input hidden)', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      const toggle = screen.getByTestId('solver-assembly-ai-toggle') as HTMLInputElement;
      expect(toggle).toBeInTheDocument();
      expect(toggle.checked).toBe(false);
      // While off: no per-part planner, no NL input.
      expect(screen.queryByTestId('solver-assembly-ai-builder')).toBeNull();
      expect(screen.queryByTestId('solver-assembly-ai-input')).toBeNull();
    });

    it('flipping the toggle on mounts the assembly-level NL input + submit', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-ai-toggle'));
      expect(screen.getByTestId('solver-assembly-ai-builder')).toBeInTheDocument();
      expect(screen.getByTestId('solver-assembly-ai-input')).toBeInTheDocument();
      expect(screen.getByTestId('solver-assembly-ai-submit')).toBeInTheDocument();
    });

    it('flipping the toggle on mounts a per-part FeatureTreePlannerPanel for each part', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      // Pre-toggle: no planner panels.
      expect(screen.queryByTestId('solver-assembly-part-p_base-ai-planner')).toBeNull();
      expect(screen.queryByTestId('solver-assembly-part-p_arm-ai-planner')).toBeNull();
      fireEvent.click(screen.getByTestId('solver-assembly-ai-toggle'));
      // Post-toggle: each part row has a planner wrapper, and the wrapper
      // contains a real FeatureTreePlannerPanel (planner-panel testid).
      const baseWrap = screen.getByTestId('solver-assembly-part-p_base-ai-planner');
      const armWrap = screen.getByTestId('solver-assembly-part-p_arm-ai-planner');
      expect(baseWrap).toBeInTheDocument();
      expect(armWrap).toBeInTheDocument();
      // Each wrapper hosts exactly one planner-panel.
      expect(baseWrap.querySelectorAll('[data-testid="planner-panel"]').length).toBe(1);
      expect(armWrap.querySelectorAll('[data-testid="planner-panel"]').length).toBe(1);
    });

    it('per-part planner Apply pushes the produced nodes into featureTrees', async () => {
      const onSolve = vi
        .fn()
        .mockResolvedValue({
          success: true,
          residuals: [],
          dof: 0,
        } as AssemblyBrowserSolveResult);
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          onClose={vi.fn()}
          onSolve={onSolve}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-ai-toggle'));
      // Drive the per-part planner: type a regex-recognized prompt and Send.
      const baseWrap = screen.getByTestId('solver-assembly-part-p_base-ai-planner');
      const input = within(baseWrap).getByTestId('planner-input') as HTMLTextAreaElement;
      fireEvent.change(input, { target: { value: 'cylinder 25x60' } });
      fireEvent.click(within(baseWrap).getByTestId('planner-send'));
      // Wait for the plan to materialize, then Apply.
      const applyBtn = await within(baseWrap).findByTestId('planner-apply');
      fireEvent.click(applyBtn);
      // Now Solve and inspect the featureTrees argument — p_base must
      // carry at least one node now.
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() => expect(onSolve).toHaveBeenCalled());
      const trees = onSolve.mock.calls[0][1] as Record<string, FeatureTree>;
      expect(trees).toHaveProperty('p_base');
      expect(trees.p_base.nodes.length).toBeGreaterThanOrEqual(1);
    });

    it('per-part planner seeds currentTree from existing featureTrees', () => {
      render(
        <AssemblyBrowserModal
          lang="en"
          initialState={seedState()}
          initialFeatureTrees={{ p_base: BOX_TREE }}
          onClose={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-ai-toggle'));
      // The planner-panel mounts unconditionally when AI is on; the seed
      // is reflected via planner internals (not directly testable from
      // outside). Smoke-test that it mounts without throwing.
      expect(
        screen.getByTestId('solver-assembly-part-p_base-ai-planner'),
      ).toBeInTheDocument();
    });

    it('"3 stacked plates" → 3 parts + 2 concentric mates', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-ai-toggle'));
      const input = screen.getByTestId('solver-assembly-ai-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '3 stacked plates' } });
      fireEvent.click(screen.getByTestId('solver-assembly-ai-submit'));
      const partRows = screen.getAllByTestId(/^solver-assembly-part-row-/);
      expect(partRows.length).toBe(3);
      const mateRows = screen.getAllByTestId(/^solver-assembly-mate-row-/);
      expect(mateRows.length).toBe(2);
      // Status banner reports the counts.
      expect(screen.getByTestId('solver-assembly-ai-created').textContent).toMatch(
        /\+3 parts/,
      );
      expect(screen.getByTestId('solver-assembly-ai-created').textContent).toMatch(
        /\+2 mates/,
      );
    });

    it('"2 x 3 grid" → 6 parts, 0 mates', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-ai-toggle'));
      const input = screen.getByTestId('solver-assembly-ai-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '2 x 3 grid' } });
      fireEvent.click(screen.getByTestId('solver-assembly-ai-submit'));
      const partRows = screen.getAllByTestId(/^solver-assembly-part-row-/);
      expect(partRows.length).toBe(6);
      // Grid produces no mates (only positions).
      expect(screen.queryAllByTestId(/^solver-assembly-mate-row-/).length).toBe(0);
      expect(screen.getByTestId('solver-assembly-ai-created').textContent).toMatch(
        /\+6 parts/,
      );
    });

    it('unrecognized prompt → "Could not parse" banner, no state change', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-ai-toggle'));
      const input = screen.getByTestId('solver-assembly-ai-input') as HTMLInputElement;
      fireEvent.change(input, {
        target: { value: 'build me a robot with kinematic arms' },
      });
      fireEvent.click(screen.getByTestId('solver-assembly-ai-submit'));
      const banner = screen.getByTestId('solver-assembly-ai-unparsed');
      expect(banner).toBeInTheDocument();
      expect(banner.textContent).toMatch(/Could not parse/i);
      // No parts/mates added.
      expect(screen.getByTestId('solver-assembly-parts-empty')).toBeInTheDocument();
      expect(screen.getByTestId('solver-assembly-mates-empty')).toBeInTheDocument();
      // No success banner.
      expect(screen.queryByTestId('solver-assembly-ai-created')).toBeNull();
    });

    it('NL prompt with existing parts appends without clobbering', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />,
      );
      // seedState has parts p_base + p_arm. Toggle on, then "2 stacked"
      // → expect 2 new parts appended (total 4) and 1 new concentric mate.
      fireEvent.click(screen.getByTestId('solver-assembly-ai-toggle'));
      fireEvent.change(screen.getByTestId('solver-assembly-ai-input'), {
        target: { value: '2 stacked' },
      });
      fireEvent.click(screen.getByTestId('solver-assembly-ai-submit'));
      expect(screen.getAllByTestId(/^solver-assembly-part-row-/).length).toBe(4);
      // Original m1 + 1 new = 2 mate rows.
      expect(screen.getAllByTestId(/^solver-assembly-mate-row-/).length).toBe(2);
      // Original p_base / p_arm still present (no clobber).
      expect(screen.getByTestId('solver-assembly-part-row-p_base')).toBeInTheDocument();
      expect(screen.getByTestId('solver-assembly-part-row-p_arm')).toBeInTheDocument();
    });

    it('input clears after a successful submit (so a second submit starts fresh)', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-ai-toggle'));
      const input = screen.getByTestId('solver-assembly-ai-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '3 stacked' } });
      fireEvent.click(screen.getByTestId('solver-assembly-ai-submit'));
      // After success the input value is wiped.
      expect(
        (screen.getByTestId('solver-assembly-ai-input') as HTMLInputElement).value,
      ).toBe('');
    });

    it('Enter key on the NL input submits without clicking the button', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-ai-toggle'));
      const input = screen.getByTestId('solver-assembly-ai-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '3 stacked' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      expect(screen.getAllByTestId(/^solver-assembly-part-row-/).length).toBe(3);
    });

    it('flipping the toggle off after submit hides the builder (state preserved)', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-ai-toggle'));
      fireEvent.change(screen.getByTestId('solver-assembly-ai-input'), {
        target: { value: '3 stacked' },
      });
      fireEvent.click(screen.getByTestId('solver-assembly-ai-submit'));
      expect(screen.getAllByTestId(/^solver-assembly-part-row-/).length).toBe(3);
      // Toggle off — builder UI hides but the 3 parts stay.
      fireEvent.click(screen.getByTestId('solver-assembly-ai-toggle'));
      expect(screen.queryByTestId('solver-assembly-ai-builder')).toBeNull();
      expect(screen.getAllByTestId(/^solver-assembly-part-row-/).length).toBe(3);
    });

    it('"2x3 grid" (no spaces around x) is also recognised', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-ai-toggle'));
      fireEvent.change(screen.getByTestId('solver-assembly-ai-input'), {
        target: { value: '2x3 grid' },
      });
      fireEvent.click(screen.getByTestId('solver-assembly-ai-submit'));
      expect(screen.getAllByTestId(/^solver-assembly-part-row-/).length).toBe(6);
    });

    it.each<[AssemblyBrowserLang, RegExp]>([
      ['ko', /AI 어셈블리 빌더/],
      ['en', /AI assembly builder/i],
      ['ja', /AI アセンブリビルダー/],
      ['zh', /AI 装配生成器/],
      ['es', /Constructor de ensamblaje IA/i],
      ['ar', /منشئ التجميع بالذكاء الاصطناعي/],
    ])('i18n: lang %s localizes the AI toggle label', (lang, re) => {
      render(<AssemblyBrowserModal lang={lang} onClose={vi.fn()} />);
      expect(
        screen.getByTestId('solver-assembly-ai-toggle-label').textContent,
      ).toMatch(re);
    });

    it.each<[AssemblyBrowserLang, RegExp]>([
      ['ko', /입력을 이해할 수 없습니다/],
      ['en', /Could not parse/i],
      ['ja', /入力を解析できません/],
      ['zh', /无法解析输入/],
      ['es', /No se pudo analizar/i],
      ['ar', /تعذّر التحليل/],
    ])('i18n: lang %s localizes the couldNotParse banner', (lang, re) => {
      render(<AssemblyBrowserModal lang={lang} onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-ai-toggle'));
      fireEvent.change(screen.getByTestId('solver-assembly-ai-input'), {
        target: { value: 'gibberish' },
      });
      fireEvent.click(screen.getByTestId('solver-assembly-ai-submit'));
      expect(
        screen.getByTestId('solver-assembly-ai-unparsed').textContent,
      ).toMatch(re);
    });
  });

  // ── Mate-row value cell inline editing (MMMM pattern) ───────────────────
  //
  /**
   * The mate row's numeric value cell uses the same MMMM pattern as
   * `SketchConstraintOverlay`'s inline dimension editor:
   *
   *   - Double-click selects the input contents + enters edit mode.
   *   - Live keystrokes track a per-mate draft; invalid drafts (negative
   *     distance / angle, non-positive ratio / pinionRadius) flag a red
   *     border via `data-mate-value-invalid="true"`.
   *   - Enter commits the draft via `recordChange` so Undo restores the
   *     prior value; the input then returns to display mode.
   *   - Esc cancels the edit (input reverts to the stored value).
   *
   * Mate kinds without a numeric value (`coincident`, `concentric`,
   * `parallel`, `perpendicular`, `tangent`) do not render a value cell at
   * all — verified separately so the pattern stays contained.
   */
  describe('Phase 3.A mate-value inline editor (MMMM pattern)', () => {
    /**
     * Build a distance-mate seed state with the supplied initial value. We
     * use face/face refs (allowed by `validateMate`) so any `recordChange`
     * triggered by Enter passes IR validation.
     */
    function distanceState(initial: number): AssemblyState {
      return {
        parts: [
          {
            id: 'p_a',
            name: 'A',
            partTemplateId: 'tpl_a',
            position: { x: 0, y: 0, z: 0 },
            orientation: IDENTITY_QUAT,
            fixed: true,
          },
          {
            id: 'p_b',
            name: 'B',
            partTemplateId: 'tpl_b',
            position: { x: 0, y: 0, z: 0 },
            orientation: IDENTITY_QUAT,
          },
        ],
        mates: [
          {
            id: 'm_d',
            kind: 'distance',
            a: { partId: 'p_a', refId: 'face_x', refKind: 'face' },
            b: { partId: 'p_b', refId: 'face_y', refKind: 'face' },
            value: initial,
          },
        ],
      };
    }

    function gearState(initial: number): AssemblyState {
      return {
        parts: [
          {
            id: 'p_a',
            name: 'A',
            partTemplateId: 'tpl_a',
            position: { x: 0, y: 0, z: 0 },
            orientation: IDENTITY_QUAT,
            fixed: true,
          },
          {
            id: 'p_b',
            name: 'B',
            partTemplateId: 'tpl_b',
            position: { x: 0, y: 0, z: 0 },
            orientation: IDENTITY_QUAT,
          },
        ],
        mates: [
          {
            id: 'm_g',
            kind: 'gear',
            a: { partId: 'p_a', refId: 'axis_a', refKind: 'axis' },
            b: { partId: 'p_b', refId: 'axis_b', refKind: 'axis' },
            ratio: initial,
          },
        ],
      };
    }

    function rackPinionState(initial: number): AssemblyState {
      return {
        parts: [
          {
            id: 'p_a',
            name: 'A',
            partTemplateId: 'tpl_a',
            position: { x: 0, y: 0, z: 0 },
            orientation: IDENTITY_QUAT,
            fixed: true,
          },
          {
            id: 'p_b',
            name: 'B',
            partTemplateId: 'tpl_b',
            position: { x: 0, y: 0, z: 0 },
            orientation: IDENTITY_QUAT,
          },
        ],
        mates: [
          {
            id: 'm_rp',
            kind: 'rack_pinion',
            a: { partId: 'p_a', refId: 'axis_a', refKind: 'axis' },
            b: { partId: 'p_b', refId: 'edge_b', refKind: 'edge' },
            pinionRadius: initial,
          },
        ],
      };
    }

    function angleState(initial: number): AssemblyState {
      return {
        parts: [
          {
            id: 'p_a',
            name: 'A',
            partTemplateId: 'tpl_a',
            position: { x: 0, y: 0, z: 0 },
            orientation: IDENTITY_QUAT,
            fixed: true,
          },
          {
            id: 'p_b',
            name: 'B',
            partTemplateId: 'tpl_b',
            position: { x: 0, y: 0, z: 0 },
            orientation: IDENTITY_QUAT,
          },
        ],
        mates: [
          {
            id: 'm_a',
            kind: 'angle',
            a: { partId: 'p_a', refId: 'face_x', refKind: 'face' },
            b: { partId: 'p_b', refId: 'face_y', refKind: 'face' },
            value: initial,
          },
        ],
      };
    }

    it('distance mate row exposes the value input cell with the seeded value', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={distanceState(25)} onClose={vi.fn()} />,
      );
      const input = screen.getByTestId('solver-assembly-mate-value-m_d') as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.value).toBe('25');
    });

    it('valueless mates (concentric) do NOT render a value cell', () => {
      const state: AssemblyState = {
        parts: [
          {
            id: 'p_a',
            name: 'A',
            partTemplateId: 'tpl_a',
            position: { x: 0, y: 0, z: 0 },
            orientation: IDENTITY_QUAT,
            fixed: true,
          },
          {
            id: 'p_b',
            name: 'B',
            partTemplateId: 'tpl_b',
            position: { x: 0, y: 0, z: 0 },
            orientation: IDENTITY_QUAT,
          },
        ],
        mates: [
          {
            id: 'm_c',
            kind: 'concentric',
            a: { partId: 'p_a', refId: 'axis_a', refKind: 'axis' },
            b: { partId: 'p_b', refId: 'axis_b', refKind: 'axis' },
          },
        ],
      };
      render(<AssemblyBrowserModal lang="en" initialState={state} onClose={vi.fn()} />);
      expect(screen.queryByTestId('solver-assembly-mate-value-m_c')).toBeNull();
    });

    it('double-click on the value input selects its text contents (enters edit mode)', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={distanceState(10)} onClose={vi.fn()} />,
      );
      const input = screen.getByTestId('solver-assembly-mate-value-m_d') as HTMLInputElement;
      // jsdom doesn't implement input.select() side-effects, but the
      // onDoubleClick handler should at least begin the edit (draft set).
      // After dbl-click + a fireEvent.change, the input must still echo
      // the typed value (proves we're in edit mode, not snapping back).
      fireEvent.doubleClick(input);
      fireEvent.change(input, { target: { value: '15' } });
      expect(
        (screen.getByTestId('solver-assembly-mate-value-m_d') as HTMLInputElement).value,
      ).toBe('15');
    });

    it('Enter on a valid edited value commits via recordChange (Undo becomes enabled)', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={distanceState(10)} onClose={vi.fn()} />,
      );
      const undo = screen.getByTestId('solver-assembly-undo') as HTMLButtonElement;
      expect(undo.disabled).toBe(true);

      const input = screen.getByTestId('solver-assembly-mate-value-m_d') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '42' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      // After commit the input is back in display mode reflecting the
      // canonical mate value (42), and Undo is enabled.
      expect(
        (screen.getByTestId('solver-assembly-mate-value-m_d') as HTMLInputElement).value,
      ).toBe('42');
      expect(
        (screen.getByTestId('solver-assembly-undo') as HTMLButtonElement).disabled,
      ).toBe(false);
      // History panel reads "Update mate m_d value → 42".
      expect(
        screen.getByTestId('solver-assembly-history-current').textContent,
      ).toMatch(/Update mate m_d value/);
    });

    it('Ctrl+Z after a value commit restores the previous value', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={distanceState(10)} onClose={vi.fn()} />,
      );
      const input = screen.getByTestId('solver-assembly-mate-value-m_d') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '99' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      expect(
        (screen.getByTestId('solver-assembly-mate-value-m_d') as HTMLInputElement).value,
      ).toBe('99');
      // Click Undo (Ctrl+Z is also wired but the keyboard handler skips
      // events whose focus is inside an INPUT — using the button is the
      // equivalent surface that always fires).
      fireEvent.click(screen.getByTestId('solver-assembly-undo'));
      expect(
        (screen.getByTestId('solver-assembly-mate-value-m_d') as HTMLInputElement).value,
      ).toBe('10');
    });

    it('negative distance is rejected: red border + no history entry', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={distanceState(10)} onClose={vi.fn()} />,
      );
      const input = screen.getByTestId('solver-assembly-mate-value-m_d') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '-5' } });
      // Red border flagged via the data-attribute (visual style: red border).
      expect(input.getAttribute('data-mate-value-invalid')).toBe('true');
      // Enter on invalid value does NOT advance history.
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      expect(
        (screen.getByTestId('solver-assembly-undo') as HTMLButtonElement).disabled,
      ).toBe(true);
      // Red border still flagged after the rejected Enter.
      expect(
        (screen.getByTestId('solver-assembly-mate-value-m_d') as HTMLInputElement)
          .getAttribute('data-mate-value-invalid'),
      ).toBe('true');
    });

    it('Escape cancels the edit and reverts the input to the stored value', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={distanceState(10)} onClose={vi.fn()} />,
      );
      const input = screen.getByTestId('solver-assembly-mate-value-m_d') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '777' } });
      expect(
        (screen.getByTestId('solver-assembly-mate-value-m_d') as HTMLInputElement).value,
      ).toBe('777');
      fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });
      // After cancel: input snaps back to the stored 10.
      expect(
        (screen.getByTestId('solver-assembly-mate-value-m_d') as HTMLInputElement).value,
      ).toBe('10');
      // No history entry.
      expect(
        (screen.getByTestId('solver-assembly-undo') as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it('gear ratio inline edit: Enter commits and Undo restores', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={gearState(2)} onClose={vi.fn()} />,
      );
      const input = screen.getByTestId('solver-assembly-mate-value-m_g') as HTMLInputElement;
      expect(input.value).toBe('2');
      fireEvent.change(input, { target: { value: '5' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      expect(
        (screen.getByTestId('solver-assembly-mate-value-m_g') as HTMLInputElement).value,
      ).toBe('5');
      fireEvent.click(screen.getByTestId('solver-assembly-undo'));
      expect(
        (screen.getByTestId('solver-assembly-mate-value-m_g') as HTMLInputElement).value,
      ).toBe('2');
    });

    it('gear ratio = 0 is rejected (red border, no commit)', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={gearState(2)} onClose={vi.fn()} />,
      );
      const input = screen.getByTestId('solver-assembly-mate-value-m_g') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '0' } });
      expect(input.getAttribute('data-mate-value-invalid')).toBe('true');
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      expect(
        (screen.getByTestId('solver-assembly-undo') as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it('rack_pinion pinionRadius inline edit: Enter commits and Undo restores', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={rackPinionState(3)} onClose={vi.fn()} />,
      );
      const input = screen.getByTestId('solver-assembly-mate-value-m_rp') as HTMLInputElement;
      expect(input.value).toBe('3');
      fireEvent.change(input, { target: { value: '8' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      expect(
        (screen.getByTestId('solver-assembly-mate-value-m_rp') as HTMLInputElement).value,
      ).toBe('8');
      fireEvent.click(screen.getByTestId('solver-assembly-undo'));
      expect(
        (screen.getByTestId('solver-assembly-mate-value-m_rp') as HTMLInputElement).value,
      ).toBe('3');
    });

    it('rack_pinion negative pinionRadius is rejected (red border, no commit)', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={rackPinionState(3)} onClose={vi.fn()} />,
      );
      const input = screen.getByTestId('solver-assembly-mate-value-m_rp') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '-1' } });
      expect(input.getAttribute('data-mate-value-invalid')).toBe('true');
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      expect(
        (screen.getByTestId('solver-assembly-undo') as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it('angle negative input is rejected (red border, no commit)', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={angleState(45)} onClose={vi.fn()} />,
      );
      const input = screen.getByTestId('solver-assembly-mate-value-m_a') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '-30' } });
      expect(input.getAttribute('data-mate-value-invalid')).toBe('true');
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      expect(
        (screen.getByTestId('solver-assembly-undo') as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it('committing the same value as the existing one is a no-op (no history entry)', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={distanceState(10)} onClose={vi.fn()} />,
      );
      const input = screen.getByTestId('solver-assembly-mate-value-m_d') as HTMLInputElement;
      // Type the same number, Enter — the modal should treat this as no
      // actual change and skip the history push.
      fireEvent.change(input, { target: { value: '10' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      expect(
        (screen.getByTestId('solver-assembly-undo') as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it('changing mate kind clears any in-flight value draft (red border drops)', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={distanceState(10)} onClose={vi.fn()} />,
      );
      const input = screen.getByTestId('solver-assembly-mate-value-m_d') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '-5' } });
      expect(input.getAttribute('data-mate-value-invalid')).toBe('true');
      // Flip kind → distance stays valid but the draft is purged so the
      // input snaps back to the canonical 10 with no red border.
      fireEvent.change(screen.getByTestId('solver-assembly-mate-kind-m_d'), {
        target: { value: 'distance' },
      });
      const after = screen.getByTestId('solver-assembly-mate-value-m_d') as HTMLInputElement;
      expect(after.value).toBe('10');
      expect(after.getAttribute('data-mate-value-invalid')).toBeNull();
    });

    it('zero distance is accepted (≥ 0) and commits to history', () => {
      render(
        <AssemblyBrowserModal lang="en" initialState={distanceState(10)} onClose={vi.fn()} />,
      );
      const input = screen.getByTestId('solver-assembly-mate-value-m_d') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '0' } });
      // Zero is valid per IR (`distance.value ≥ 0`).
      expect(input.getAttribute('data-mate-value-invalid')).toBeNull();
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      expect(
        (screen.getByTestId('solver-assembly-undo') as HTMLButtonElement).disabled,
      ).toBe(false);
      expect(
        (screen.getByTestId('solver-assembly-mate-value-m_d') as HTMLInputElement).value,
      ).toBe('0');
    });
  });

  // ─── 3D viewer integration (Phase 3.A.viewer-integration) ───────────────
  //
  // Wires the standalone {@link Assembly3DViewer} into the modal behind a
  // user-toggleable button. Default off so the existing parts/mates layout
  // and the 194 pre-existing modal tests are untouched. The viewer mounts
  // between the parts panel and the mates panel when ON; selectedPartId
  // is shared so a click in either surface highlights the other.
  //
  // jsdom has no WebGL, so when the viewer mounts it falls back to its
  // try/catch hatches (WebGLRenderer init prints a warning and continues
  // with a null renderer). We don't mock `three` here — the viewer's own
  // defensive try/catches keep the render path alive. The visible DOM
  // surface (host div + axis legend) is what we assert on.
  describe('3D viewer toggle (Phase 3.A.viewer-integration)', () => {
    it('renders the 3D-view toggle button by default', () => {
      render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
      const toggle = screen.getByTestId('solver-assembly-3d-toggle');
      expect(toggle).toBeInTheDocument();
      // Default off — viewer panel is absent.
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      expect(screen.queryByTestId('solver-assembly-3d-panel')).toBeNull();
      expect(screen.queryByTestId('assembly-3d-viewer')).toBeNull();
    });

    it('clicking the toggle mounts the Assembly3DViewer panel + canvas host', () => {
      render(<AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-3d-toggle'));
      expect(screen.getByTestId('solver-assembly-3d-panel')).toBeInTheDocument();
      // The viewer's outer host renders even in jsdom — its inner WebGL
      // renderer init may bail (no WebGL) but the host div is unconditional.
      expect(screen.getByTestId('assembly-3d-viewer')).toBeInTheDocument();
      // aria-pressed reflects the new state.
      expect(screen.getByTestId('solver-assembly-3d-toggle')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('toggling off again unmounts the viewer panel', () => {
      render(<AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />);
      const toggle = screen.getByTestId('solver-assembly-3d-toggle');
      fireEvent.click(toggle);
      expect(screen.getByTestId('solver-assembly-3d-panel')).toBeInTheDocument();
      fireEvent.click(toggle);
      expect(screen.queryByTestId('solver-assembly-3d-panel')).toBeNull();
      expect(screen.queryByTestId('assembly-3d-viewer')).toBeNull();
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
    });

    it('clicking a part row selects it (data-selected attr) and highlights green', () => {
      render(<AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />);
      const row = screen.getByTestId('solver-assembly-part-row-p_arm');
      // Pre-click: no selection.
      expect(row.getAttribute('data-selected')).toBeNull();
      fireEvent.click(row);
      expect(
        screen.getByTestId('solver-assembly-part-row-p_arm').getAttribute('data-selected'),
      ).toBe('true');
      // The previously-unselected p_base row stays unselected.
      expect(
        screen.getByTestId('solver-assembly-part-row-p_base').getAttribute('data-selected'),
      ).toBeNull();
    });

    it('clicking the same selected part row a second time clears the selection', () => {
      render(<AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />);
      const row = screen.getByTestId('solver-assembly-part-row-p_arm');
      fireEvent.click(row);
      expect(
        screen.getByTestId('solver-assembly-part-row-p_arm').getAttribute('data-selected'),
      ).toBe('true');
      fireEvent.click(screen.getByTestId('solver-assembly-part-row-p_arm'));
      expect(
        screen.getByTestId('solver-assembly-part-row-p_arm').getAttribute('data-selected'),
      ).toBeNull();
    });

    it('clicking an inner input (e.g. part name) does NOT change the selection', () => {
      render(<AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />);
      const nameInput = screen.getByTestId('solver-assembly-part-name-p_arm');
      fireEvent.click(nameInput);
      // Click on an INPUT bubbles up to the row's onClick, but we filter
      // those tags out so the selection stays untouched.
      expect(
        screen.getByTestId('solver-assembly-part-row-p_arm').getAttribute('data-selected'),
      ).toBeNull();
    });

    it('removing the currently-selected part clears the selection', () => {
      render(<AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-part-row-p_arm'));
      expect(
        screen.getByTestId('solver-assembly-part-row-p_arm').getAttribute('data-selected'),
      ).toBe('true');
      fireEvent.click(screen.getByTestId('solver-assembly-part-remove-p_arm'));
      // p_arm gone — only p_base remains and stays unselected.
      expect(screen.queryByTestId('solver-assembly-part-row-p_arm')).toBeNull();
      expect(
        screen.getByTestId('solver-assembly-part-row-p_base').getAttribute('data-selected'),
      ).toBeNull();
    });

    it('viewer mount is independent of project persistence (works without projectId)', () => {
      render(<AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-3d-toggle'));
      // 3D viewer host renders even without projectId / persistence wiring.
      expect(screen.getByTestId('assembly-3d-viewer')).toBeInTheDocument();
    });

    it('reset clears the selectedPartId while preserving the toggle on-state', () => {
      render(<AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-3d-toggle'));
      fireEvent.click(screen.getByTestId('solver-assembly-part-row-p_arm'));
      expect(
        screen.getByTestId('solver-assembly-part-row-p_arm').getAttribute('data-selected'),
      ).toBe('true');
      fireEvent.click(screen.getByTestId('solver-assembly-reset'));
      // Parts are gone after reset, but the toggle stays ON (matches the
      // AI-builder / autoInfer policy in this modal).
      expect(screen.queryByTestId('solver-assembly-part-row-p_arm')).toBeNull();
      expect(screen.getByTestId('solver-assembly-3d-panel')).toBeInTheDocument();
    });

    it.each<[AssemblyBrowserLang, string]>([
      ['ko', '3D 뷰 표시'],
      ['en', 'Show 3D view'],
      ['ja', '3D ビューを表示'],
      ['zh', '显示 3D 视图'],
      ['es', 'Mostrar vista 3D'],
      ['ar', 'إظهار العرض ثلاثي الأبعاد'],
    ])('toggle label is localized (%s)', (lang, expected) => {
      render(<AssemblyBrowserModal lang={lang} onClose={vi.fn()} />);
      const toggle = screen.getByTestId('solver-assembly-3d-toggle');
      expect(toggle).toHaveTextContent(expected);
    });

    it('toggle ON renders viewer with width=400/height=400 props honoured by host', () => {
      render(<AssemblyBrowserModal lang="en" initialState={seedState()} onClose={vi.fn()} />);
      fireEvent.click(screen.getByTestId('solver-assembly-3d-toggle'));
      const host = screen.getByTestId('assembly-3d-viewer') as HTMLDivElement;
      expect(host.style.width).toBe('400px');
      expect(host.style.height).toBe('400px');
    });
  });
});
