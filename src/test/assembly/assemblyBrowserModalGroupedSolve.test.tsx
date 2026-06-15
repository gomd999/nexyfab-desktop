/** @vitest-environment jsdom */
/**
 * AssemblyBrowserModal — Phase B31.1 grouped-solve UI tests.
 *
 * Verifies the "Use group partition" checkbox + Max parallel input + the
 * partition summary line surfaced from the grouped-solve response. Kept
 * in a separate file from `assemblyBrowserModal.test.tsx` so the
 * pre-existing 4000-line suite stays grep-able and unaffected.
 *
 * Coverage:
 *   - checkbox renders, defaults off
 *   - flipping the checkbox reveals the Max parallel number input
 *     (defaults to 4, range 1-8)
 *   - checkbox OFF → onSolve called without the 4th `groupOptions` arg
 *     (zero-regression contract — wire payload byte-identical to pre-B31.1)
 *   - checkbox ON → onSolve called with `{ useGroups: true, maxParallel }`
 *   - changing maxParallel before Solve forwards the new value
 *   - response with `groups` + `groupResults` renders the localized
 *     partition summary (testid solver-assembly-groups-summary)
 *   - response without `groups` does NOT render the summary
 *   - maxParallel input clamps inputs to [1, 8]
 *   - 6-lang i18n smoke (label text for checkbox + summary)
 *   - turning the checkbox back off after a grouped Solve drops the bag
 *     from the next call's args (idempotent toggle)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import AssemblyBrowserModal, {
  type AssemblyBrowserLang,
  type AssemblyBrowserSolveResult,
} from '@/app/[lang]/shape-generator/assembly/AssemblyBrowserModal';
import { IDENTITY_QUAT, type AssemblyState } from '@/lib/assembly/assemblyState';

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

const PLAIN_RESULT: AssemblyBrowserSolveResult = {
  success: true,
  iterations: 1,
  finalMaxResidual: 0,
  dof: 0,
  residuals: [],
};

const GROUPED_RESULT: AssemblyBrowserSolveResult = {
  success: true,
  iterations: 3,
  finalMaxResidual: 1e-7,
  dof: 0,
  residuals: [{ mateId: 'm1', residual: 0, supported: true }],
  groups: 2,
  groupResults: [
    { success: true, iterations: 3, finalMaxResidual: 1e-7 },
    { success: true, iterations: 2, finalMaxResidual: 1e-8 },
  ],
  totalDurationMs: 17.5,
};

describe('AssemblyBrowserModal — grouped-solve UI (Phase B31.1)', () => {
  it('renders the Use group partition checkbox, default off', () => {
    render(
      <AssemblyBrowserModal
        lang="en"
        initialState={seedState()}
        onClose={vi.fn()}
        onSolve={vi.fn().mockResolvedValue(PLAIN_RESULT)}
      />,
    );
    const cb = screen.getByTestId('solver-assembly-use-groups') as HTMLInputElement;
    expect(cb).toBeInTheDocument();
    expect(cb.type).toBe('checkbox');
    expect(cb.checked).toBe(false);
  });

  it('Max parallel input is hidden by default and revealed when the checkbox flips on', () => {
    render(
      <AssemblyBrowserModal
        lang="en"
        initialState={seedState()}
        onClose={vi.fn()}
        onSolve={vi.fn().mockResolvedValue(PLAIN_RESULT)}
      />,
    );
    expect(screen.queryByTestId('solver-assembly-max-parallel')).toBeNull();

    fireEvent.click(screen.getByTestId('solver-assembly-use-groups'));

    const input = screen.getByTestId('solver-assembly-max-parallel') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.type).toBe('number');
    expect(input.value).toBe('4');
    expect(input.min).toBe('1');
    expect(input.max).toBe('8');
  });

  it('checkbox OFF (default) → onSolve called WITHOUT the groupOptions 4th arg', async () => {
    const onSolve = vi.fn().mockResolvedValue(PLAIN_RESULT);
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
    // 4th arg must be undefined so the wire payload stays byte-identical
    // to the pre-B31.1 path (zero-regression contract).
    expect(onSolve.mock.calls[0][3]).toBeUndefined();
  });

  it('checkbox ON → onSolve called with { useGroups: true, maxParallel: 4 }', async () => {
    const onSolve = vi.fn().mockResolvedValue(GROUPED_RESULT);
    render(
      <AssemblyBrowserModal
        lang="en"
        initialState={seedState()}
        onClose={vi.fn()}
        onSolve={onSolve}
      />,
    );
    fireEvent.click(screen.getByTestId('solver-assembly-use-groups'));
    fireEvent.click(screen.getByTestId('solver-assembly-solve'));
    await waitFor(() => expect(onSolve).toHaveBeenCalled());
    expect(onSolve.mock.calls[0][3]).toEqual({
      useGroups: true,
      maxParallel: 4,
    });
  });

  it('changing Max parallel before Solve forwards the new value', async () => {
    const onSolve = vi.fn().mockResolvedValue(GROUPED_RESULT);
    render(
      <AssemblyBrowserModal
        lang="en"
        initialState={seedState()}
        onClose={vi.fn()}
        onSolve={onSolve}
      />,
    );
    fireEvent.click(screen.getByTestId('solver-assembly-use-groups'));
    fireEvent.change(screen.getByTestId('solver-assembly-max-parallel'), {
      target: { value: '6' },
    });
    fireEvent.click(screen.getByTestId('solver-assembly-solve'));
    await waitFor(() => expect(onSolve).toHaveBeenCalled());
    expect(onSolve.mock.calls[0][3]).toEqual({
      useGroups: true,
      maxParallel: 6,
    });
  });

  it('Max parallel input clamps to [1, 8] when forwarded to onSolve', async () => {
    const onSolve = vi.fn().mockResolvedValue(GROUPED_RESULT);
    render(
      <AssemblyBrowserModal
        lang="en"
        initialState={seedState()}
        onClose={vi.fn()}
        onSolve={onSolve}
      />,
    );
    fireEvent.click(screen.getByTestId('solver-assembly-use-groups'));

    // Above the cap → clamps to 8.
    fireEvent.change(screen.getByTestId('solver-assembly-max-parallel'), {
      target: { value: '99' },
    });
    fireEvent.click(screen.getByTestId('solver-assembly-solve'));
    await waitFor(() => expect(onSolve).toHaveBeenCalledTimes(1));
    expect(onSolve.mock.calls[0][3]).toEqual({
      useGroups: true,
      maxParallel: 8,
    });

    // Below the floor → clamps to 1.
    fireEvent.change(screen.getByTestId('solver-assembly-max-parallel'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByTestId('solver-assembly-solve'));
    await waitFor(() => expect(onSolve).toHaveBeenCalledTimes(2));
    expect(onSolve.mock.calls[1][3]).toEqual({
      useGroups: true,
      maxParallel: 1,
    });
  });

  it('response with `groups` renders the partition summary', async () => {
    const onSolve = vi.fn().mockResolvedValue(GROUPED_RESULT);
    render(
      <AssemblyBrowserModal
        lang="en"
        initialState={seedState()}
        onClose={vi.fn()}
        onSolve={onSolve}
      />,
    );
    fireEvent.click(screen.getByTestId('solver-assembly-use-groups'));
    fireEvent.click(screen.getByTestId('solver-assembly-solve'));
    await waitFor(() => {
      expect(screen.getByTestId('solver-assembly-groups-summary')).toBeInTheDocument();
    });
    const text = screen.getByTestId('solver-assembly-groups-summary').textContent ?? '';
    // English template: "Solved as 2 partitions in 18ms (parallel: 4)".
    // (totalDurationMs 17.5 rounds via toFixed(0).)
    expect(text).toMatch(/Solved as 2 partitions/);
    expect(text).toMatch(/parallel: 4/);
  });

  it('response WITHOUT `groups` does NOT render the partition summary', async () => {
    const onSolve = vi.fn().mockResolvedValue(PLAIN_RESULT);
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
    expect(screen.queryByTestId('solver-assembly-groups-summary')).toBeNull();
  });

  it('toggling the checkbox off AFTER a grouped solve drops the 4th arg on next solve', async () => {
    const onSolve = vi
      .fn()
      .mockResolvedValueOnce(GROUPED_RESULT)
      .mockResolvedValueOnce(PLAIN_RESULT);
    render(
      <AssemblyBrowserModal
        lang="en"
        initialState={seedState()}
        onClose={vi.fn()}
        onSolve={onSolve}
      />,
    );
    // First solve — checkbox on.
    fireEvent.click(screen.getByTestId('solver-assembly-use-groups'));
    fireEvent.click(screen.getByTestId('solver-assembly-solve'));
    await waitFor(() => expect(onSolve).toHaveBeenCalledTimes(1));
    expect(onSolve.mock.calls[0][3]).toBeDefined();

    // Toggle back off and solve again.
    fireEvent.click(screen.getByTestId('solver-assembly-use-groups'));
    expect(screen.queryByTestId('solver-assembly-max-parallel')).toBeNull();

    fireEvent.click(screen.getByTestId('solver-assembly-solve'));
    await waitFor(() => expect(onSolve).toHaveBeenCalledTimes(2));
    expect(onSolve.mock.calls[1][3]).toBeUndefined();
  });

  it('Solve preserves the existing solver-picker 3rd arg alongside the new 4th arg', async () => {
    const onSolve = vi.fn().mockResolvedValue(GROUPED_RESULT);
    render(
      <AssemblyBrowserModal
        lang="en"
        initialState={seedState()}
        onClose={vi.fn()}
        onSolve={onSolve}
      />,
    );
    fireEvent.change(screen.getByTestId('solver-assembly-solver-select'), {
      target: { value: 'adaptive' },
    });
    fireEvent.click(screen.getByTestId('solver-assembly-use-groups'));
    fireEvent.click(screen.getByTestId('solver-assembly-solve'));
    await waitFor(() => expect(onSolve).toHaveBeenCalled());
    expect(onSolve.mock.calls[0][2]).toBe('adaptive');
    expect(onSolve.mock.calls[0][3]).toEqual({
      useGroups: true,
      maxParallel: 4,
    });
  });

  it.each<[AssemblyBrowserLang, RegExp]>([
    ['ko', /그룹 분할/],
    ['en', /Use group partition/],
    ['ja', /グループ分割/],
    ['zh', /分组分区/],
    ['es', /partición de grupos/],
    ['ar', /تقسيم المجموعات/],
  ])('i18n: lang %s renders the localized checkbox label', (lang, re) => {
    render(
      <AssemblyBrowserModal
        lang={lang}
        initialState={seedState()}
        onClose={vi.fn()}
        onSolve={vi.fn().mockResolvedValue(PLAIN_RESULT)}
      />,
    );
    expect(
      screen.getByTestId('solver-assembly-use-groups-label').textContent,
    ).toMatch(re);
  });

  it.each<[AssemblyBrowserLang, RegExp]>([
    ['ko', /파티션/],
    ['en', /partitions/],
    ['ja', /パーティション/],
    ['zh', /分区/],
    ['es', /particiones/],
    ['ar', /أقسام/],
  ])(
    'i18n: lang %s renders the localized partition summary',
    async (lang, re) => {
      const onSolve = vi.fn().mockResolvedValue(GROUPED_RESULT);
      render(
        <AssemblyBrowserModal
          lang={lang}
          initialState={seedState()}
          onClose={vi.fn()}
          onSolve={onSolve}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-use-groups'));
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() =>
        expect(screen.getByTestId('solver-assembly-groups-summary')).toBeInTheDocument(),
      );
      expect(
        screen.getByTestId('solver-assembly-groups-summary').textContent,
      ).toMatch(re);
    },
  );

  it('Max parallel input still renders & retains the value across re-renders while on', () => {
    render(
      <AssemblyBrowserModal
        lang="en"
        initialState={seedState()}
        onClose={vi.fn()}
        onSolve={vi.fn().mockResolvedValue(PLAIN_RESULT)}
      />,
    );
    fireEvent.click(screen.getByTestId('solver-assembly-use-groups'));
    fireEvent.change(screen.getByTestId('solver-assembly-max-parallel'), {
      target: { value: '3' },
    });
    expect(
      (screen.getByTestId('solver-assembly-max-parallel') as HTMLInputElement).value,
    ).toBe('3');
    // Solver picker is independent — flipping it doesn't unmount the input.
    fireEvent.change(screen.getByTestId('solver-assembly-solver-select'), {
      target: { value: 'lagrangian' },
    });
    expect(
      (screen.getByTestId('solver-assembly-max-parallel') as HTMLInputElement).value,
    ).toBe('3');
  });

  it('partition summary uses totalDurationMs from the response (rounded ms)', async () => {
    const onSolve = vi.fn().mockResolvedValue({
      ...GROUPED_RESULT,
      groups: 5,
      totalDurationMs: 142.7,
    } as AssemblyBrowserSolveResult);
    render(
      <AssemblyBrowserModal
        lang="en"
        initialState={seedState()}
        onClose={vi.fn()}
        onSolve={onSolve}
      />,
    );
    fireEvent.click(screen.getByTestId('solver-assembly-use-groups'));
    fireEvent.click(screen.getByTestId('solver-assembly-solve'));
    await waitFor(() =>
      expect(screen.getByTestId('solver-assembly-groups-summary')).toBeInTheDocument(),
    );
    const txt = screen.getByTestId('solver-assembly-groups-summary').textContent ?? '';
    expect(txt).toMatch(/5 partitions/);
    expect(txt).toMatch(/143ms/);
  });
});
