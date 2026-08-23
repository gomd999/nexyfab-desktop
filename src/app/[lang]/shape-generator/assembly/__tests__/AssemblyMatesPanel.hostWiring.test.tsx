// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { Euler, Vector3 } from 'three';
import AssemblyMatesPanel from '../AssemblyMatesPanel';
import type { AssemblyState, Mate } from '../matesSolver';

vi.mock('../../workers/useMateWorker', () => ({
  useMateWorker: () => ({
    performSolve: async (state: AssemblyState) => ({
      bodies: state.bodies.map((body) => ({ position: body.position, rotation: body.rotation })),
      unsatisfied: [], conflicts: [], remainingDOF: 0, overConstrained: false,
      converged: true, iterations: 1,
    }),
  }),
}));

const selection = (bodyIndex: number) => ({
  bodyIndex,
  type: 'face' as const,
  localPoint: new Vector3(),
  localNormal: new Vector3(0, 0, 1),
});

function conflictingMate(id: string): Mate {
  return {
    id, type: 'coincident', enabled: true,
    selections: [selection(0), selection(1)],
  };
}

const initialState = (): AssemblyState => ({
  bodies: [
    { name: 'Ground', position: new Vector3(), rotation: new Euler(), fixed: true },
    { name: 'Part', position: new Vector3(), rotation: new Euler(), fixed: false },
  ],
  mates: ['m1', 'm2', 'm3', 'm4'].map(conflictingMate),
});

const theme = {
  panelBg: '#111', border: '#444', text: '#fff', textMuted: '#aaa',
  cardBg: '#222', accent: '#06f', accentBright: '#08f',
};

function Host(): React.ReactElement {
  const [state, setState] = React.useState(initialState);
  return <AssemblyMatesPanel theme={theme} lang="en" assemblyState={state} onAssemblyUpdate={setState} />;
}

describe('AssemblyMatesPanel conflict host wiring', () => {
  it('surfaces an over-constraint and auto-resolve suppresses the weakest mates', async () => {
    const view = render(<Host />);
    expect(view.getByTestId('conflict-overlay')).toBeTruthy();
    fireEvent.click(view.getByTestId('conflict-accept-all'));

    await waitFor(() => expect(view.queryByTestId('conflict-overlay')).toBeNull());
    const disabled = ['m1', 'm2', 'm3', 'm4'].filter((id) => (
      view.getByTestId(`assembly-mate-row-${id}`).getAttribute('data-enabled') === 'false'
    ));
    expect(disabled).toHaveLength(2);
  });

  it('hovering a proposal highlights the conflicting live mate rows', () => {
    const view = render(<Host />);
    fireEvent.mouseEnter(view.getByTestId('conflict-card-0'));
    expect(view.getByTestId('assembly-mate-row-m1').getAttribute('data-highlighted')).toBe('true');
    fireEvent.mouseLeave(view.getByTestId('conflict-card-0'));
    expect(view.getByTestId('assembly-mate-row-m1').getAttribute('data-highlighted')).toBe('false');
  });
});
