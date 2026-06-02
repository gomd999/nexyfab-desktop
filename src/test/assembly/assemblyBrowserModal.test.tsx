/** @vitest-environment jsdom */
/**
 * AssemblyBrowserModal — Phase 3.A first user-facing assembly UI tests.
 *
 * Standalone modal: takes lang + optional initialState + onClose + optional
 * onSolve. All test ids prefixed solver-assembly-*.
 */
import { describe, it, expect, vi } from 'vitest';
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
});
