/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_QUAT, type AssemblyState } from '@/lib/assembly/assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';
import { AssemblyBrowserPageContent } from './_content';

const state: AssemblyState = {
  parts: [{
    id: 'plate',
    name: 'Plate',
    partTemplateId: 'plate',
    position: { x: 0, y: 0, z: 0 },
    orientation: IDENTITY_QUAT,
    fixed: true,
  }],
  mates: [],
};

const featureTrees: Record<string, FeatureTree> = {
  plate: {
    nodes: [{
      id: 'plate-extrude',
      name: 'Plate extrude',
      dependencies: [],
      payload: {
        kind: 'extrude',
        loop: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 10 },
          { x: 0, y: 10 },
        ],
        depth: 4,
        direction: 'one_sided',
        mode: 'add',
      },
    }],
  },
};

describe('assembly to drawing page handoff', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });
  it('captures the modal current state and navigates with a revision-bound handoff id', async () => {
    const onDrawingHandoff = vi.fn();
    render(
      <AssemblyBrowserPageContent
        lang="en"
        initialState={state}
        initialFeatureTrees={featureTrees}
        onSolve={vi.fn()}
        onDrawingHandoff={onDrawingHandoff}
      />,
    );

    const button = await screen.findByTestId('assembly-create-drawing-handoff');
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    await waitFor(() => expect(onDrawingHandoff).toHaveBeenCalledTimes(1));
    const [handoff, href] = onDrawingHandoff.mock.calls[0]!;
    expect(handoff.assembly.state).toEqual(state);
    expect(handoff.assembly.featureTrees).toEqual(featureTrees);
    expect(handoff.verification.solver.status).toBe('NOT_RUN');
    expect(handoff.artifacts.gdtPmi.status).toBe('NOT_RUN');
    expect(href).toBe(`/en/shape-generator/drawing?expert=1&handoff=${handoff.handoffId}&storage=session`);
    expect(sessionStorage.getItem(`nexyfab:assembly-drawing-handoff:${handoff.handoffId}`)).not.toBeNull();
    expect(screen.getByTestId('assembly-drawing-handoff-persistence')).toHaveTextContent('NOT_RUN');
  });

  it('uses the server-issued handoff id only after an immutable persistence receipt', async () => {
    const serverId = '11111111-1111-4111-8111-111111111111';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true, handoffId: serverId, payloadSha256: 'b'.repeat(64), expiresAt: '2026-08-20T00:00:00.000Z', exactSinglePartStatus: 'NOT_RUN',
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const onDrawingHandoff = vi.fn();
    render(
      <AssemblyBrowserPageContent
        lang="en"
        projectId="project-1"
        projectRevision={4}
        projectRevisionHash={'a'.repeat(64)}
        initialState={state}
        initialFeatureTrees={featureTrees}
        onSolve={vi.fn()}
        onDrawingHandoff={onDrawingHandoff}
      />,
    );
    const button = await screen.findByTestId('assembly-create-drawing-handoff');
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(onDrawingHandoff).toHaveBeenCalledTimes(1));
    const [handoff, href] = onDrawingHandoff.mock.calls[0]!;
    expect(handoff.source).toMatchObject({ projectId: 'project-1', workspaceRevision: 4, workspaceContentSha256: 'a'.repeat(64) });
    expect(href).toBe(`/en/shape-generator/drawing?expert=1&handoff=${serverId}&project=project-1&storage=server`);
    expect(sessionStorage.getItem(`nexyfab:assembly-drawing-handoff:${handoff.handoffId}`)).toBeNull();
    expect(screen.getByTestId('assembly-drawing-handoff-persistence')).toHaveTextContent('PASS');
    vi.unstubAllGlobals();
  });
});
