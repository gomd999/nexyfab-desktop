/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AssemblyBrowserModal from '@/app/[lang]/shape-generator/assembly/AssemblyBrowserModal';
import type { AssemblyState } from '@/lib/assembly/assemblyState';
import { IDENTITY_QUAT } from '@/lib/assembly/assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';

const singlePartState: AssemblyState = {
  parts: [{
    id: 'p1',
    name: 'Part 1',
    partTemplateId: 'box',
    position: { x: 10, y: 0, z: 0 },
    orientation: IDENTITY_QUAT,
    fixed: true,
  }],
  mates: [],
};

const boxTree: FeatureTree = {
  nodes: [{
    id: 'box',
    name: 'Box',
    dependencies: [],
    payload: {
      kind: 'extrude',
      loop: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }],
      depth: 10,
      profileOffsetZ: -5,
      direction: 'one_sided',
      mode: 'add',
    },
  }],
};

describe('precision assembly workflow', () => {
  it('shows the five completion stages and blocks exact solve without active geometry', () => {
    const onSolve = vi.fn();
    render(
      <AssemblyBrowserModal
        lang="en"
        initialState={singlePartState}
        onClose={vi.fn()}
        onSolve={onSolve}
        exactSolveRequired
      />,
    );
    expect(screen.getByTestId('solver-assembly-process-rail').children).toHaveLength(5);
    expect(screen.getByTestId('solver-assembly-stage-geometry')).toHaveAttribute('data-status', 'blocked');
    expect(screen.getByTestId('solver-assembly-readiness-gate')).toHaveTextContent(/p1/);
    expect(screen.getByTestId('solver-assembly-solve')).toBeDisabled();
  });

  it('creates real default geometry for a manually added part before solve', async () => {
    const onSolve = vi.fn(async (state: AssemblyState, _trees: Record<string, FeatureTree>) => ({
      success: true,
      state,
      dof: 0,
      residuals: [],
      phase: 'real' as const,
    }));
    render(
      <AssemblyBrowserModal
        lang="en"
        onClose={vi.fn()}
        onSolve={onSolve}
        exactSolveRequired
      />,
    );
    fireEvent.click(screen.getByTestId('solver-assembly-add-part'));
    expect(screen.queryByTestId('solver-assembly-readiness-gate')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('solver-assembly-solve'));
    await waitFor(() => expect(onSolve).toHaveBeenCalled());
    expect(onSolve.mock.calls[0]?.[1].part_1.nodes).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId('solver-assembly-solve-phase')).toHaveTextContent(/real/i));
  });

  it('adopts an exact FeatureTree provisioned by the embedding modeler after mount', async () => {
    const onClose = vi.fn();
    const onSolve = vi.fn(async (state: AssemblyState) => ({
      success: true,
      state,
      dof: 0,
      residuals: [],
      phase: 'real' as const,
    }));
    const { rerender } = render(
      <AssemblyBrowserModal
        lang="en"
        initialState={singlePartState}
        initialFeatureTrees={{}}
        onClose={onClose}
        onSolve={onSolve}
        exactSolveRequired
      />,
    );
    expect(screen.getByTestId('solver-assembly-solve')).toBeDisabled();

    rerender(
      <AssemblyBrowserModal
        lang="en"
        initialState={singlePartState}
        initialFeatureTrees={{ p1: boxTree }}
        onClose={onClose}
        onSolve={onSolve}
        exactSolveRequired
      />,
    );

    await waitFor(() => expect(screen.queryByTestId('solver-assembly-readiness-gate')).not.toBeInTheDocument());
    expect(screen.getByTestId('solver-assembly-solve')).toBeEnabled();
  });

  it('commits only a successful real solved placement and keeps the result visible', async () => {
    const onStateChange = vi.fn();
    const solvedState: AssemblyState = {
      ...singlePartState,
      parts: [{ ...singlePartState.parts[0]!, position: { x: 0, y: 0, z: 0 } }],
    };
    const onSolve = vi.fn(async () => ({
      success: true,
      state: solvedState,
      iterations: 2,
      finalMaxResidual: 0,
      dof: 0,
      residuals: [],
      phase: 'real' as const,
    }));
    render(
      <AssemblyBrowserModal
        lang="en"
        initialState={singlePartState}
        initialFeatureTrees={{ p1: boxTree }}
        onStateChange={onStateChange}
        onClose={vi.fn()}
        onSolve={onSolve}
        exactSolveRequired
      />,
    );
    fireEvent.click(screen.getByTestId('solver-assembly-solve'));
    await waitFor(() => expect(onStateChange).toHaveBeenCalledWith(solvedState));
    expect(screen.getByTestId('solver-assembly-solve-result')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-stage-solve')).toHaveAttribute('data-status', 'ready');
  });
});
