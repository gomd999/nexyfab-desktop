/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_QUAT } from '@/lib/assembly/assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';
import {
  buildAssemblyDrawingHandoff,
  writeAssemblyDrawingHandoff,
} from '../assembly/drawingHandoff';
import { DrawingPageContent } from './_content';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const tree: FeatureTree = {
  nodes: [{
    id: 'body',
    name: 'Housing body',
    dependencies: [],
    payload: {
      kind: 'extrude',
      loop: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 20 },
        { x: 0, y: 20 },
      ],
      depth: 8,
      direction: 'one_sided',
      mode: 'add',
    },
  }],
};

describe('drawing page assembly handoff', () => {
  beforeEach(() => sessionStorage.clear());

  it('opens the captured revision, builds review candidates, and keeps manufacturing blocked', async () => {
    const state = {
      parts: [{
        id: 'housing',
        name: 'Housing',
        partTemplateId: 'housing',
        position: { x: 12, y: 3, z: 4 },
        orientation: IDENTITY_QUAT,
        fixed: true,
      }],
      mates: [],
    };
    const handoff = await buildAssemblyDrawingHandoff({
      state,
      featureTrees: { housing: tree },
      solveResult: {
        phase: 'real', success: true, state, dof: 0, finalMaxResidual: 0, residuals: [],
      },
      projectId: 'fixture',
    });
    writeAssemblyDrawingHandoff(handoff);

    render(<DrawingPageContent lang="en" handoffId={handoff.handoffId} />);

    expect(await screen.findByTestId('drawing-handoff-status')).toHaveTextContent(handoff.source.revisionId);
    expect(screen.getByTestId('drawing-handoff-persistence-status')).toHaveTextContent('NOT_RUN');
    expect(screen.getByTestId('drawing-handoff-solver-status')).toHaveTextContent('PASS');
    expect(await screen.findByTestId('drawing-assembly-part-row-housing')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('drawing-assembly-bom-canvas')).toBeInTheDocument());
    expect(screen.getByTestId('drawing-manufacturing-readiness')).toHaveTextContent('BLOCKED');
    expect(screen.getByTestId('drawing-manufacturing-readiness')).toHaveTextContent('exact-brep-step-not-passed');
    expect(screen.getByTestId('drawing-manufacturing-package-blocked')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('drawing-export-assembly-step')).toBeDisabled();
  });

  it('loads a server-owned immutable handoff without falling back to session storage', async () => {
    const state = {
      parts: [{ id: 'housing', name: 'Housing', partTemplateId: 'housing', position: { x: 0, y: 0, z: 0 }, orientation: IDENTITY_QUAT, fixed: true }],
      mates: [],
    };
    const handoff = await buildAssemblyDrawingHandoff({
      state, featureTrees: { housing: tree }, projectId: 'project-1', workspaceRevision: 4,
      workspaceContentSha256: 'a'.repeat(64),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, handoff }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })));
    render(
      <DrawingPageContent
        lang="en"
        handoffId="11111111-1111-4111-8111-111111111111"
        handoffProjectId="project-1"
        handoffStorage="server"
      />,
    );
    expect(await screen.findByTestId('drawing-handoff-status')).toHaveTextContent(handoff.source.revisionId);
    expect(screen.getByTestId('drawing-handoff-persistence-status')).toHaveTextContent('PASS');
    vi.unstubAllGlobals();
  });

  it('does not downgrade a failed server lookup to a matching session handoff', async () => {
    const serverId = '11111111-1111-4111-8111-111111111111';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'HANDOFF_NOT_FOUND' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    })));
    render(<DrawingPageContent lang="en" handoffId={serverId} handoffProjectId="project-1" handoffStorage="server" />);
    expect(await screen.findByTestId('drawing-handoff-error')).toHaveTextContent('HANDOFF_NOT_FOUND');
    expect(screen.queryByTestId('drawing-handoff-status')).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('does not substitute a sample when the requested revision is absent', async () => {
    render(<DrawingPageContent lang="en" handoffId={`${'a'.repeat(20)}-${'b'.repeat(12)}`} />);
    expect(await screen.findByTestId('drawing-handoff-error')).toHaveTextContent('NOT_FOUND');
    expect(screen.queryByTestId('drawing-assembly-part-row-two_cubes_a')).not.toBeInTheDocument();
  });

  it('blocks multi-feature proxy drawings instead of silently using one feature', async () => {
    const state = {
      parts: [{
        id: 'complex', name: 'Complex', partTemplateId: 'complex',
        position: { x: 0, y: 0, z: 0 }, orientation: IDENTITY_QUAT, fixed: true,
      }],
      mates: [],
    };
    const handoff = await buildAssemblyDrawingHandoff({
      state,
      featureTrees: {
        complex: {
          nodes: [
            tree.nodes[0]!,
            { ...tree.nodes[0]!, id: 'second-body', name: 'Second body' },
          ],
        },
      },
    });
    writeAssemblyDrawingHandoff(handoff);

    render(<DrawingPageContent lang="en" handoffId={handoff.handoffId} />);
    expect(await screen.findByTestId('drawing-handoff-geometry-blockers')).toHaveTextContent('complex');
    expect(screen.queryByTestId('drawing-assembly-bom-canvas')).not.toBeInTheDocument();
    expect(screen.getByTestId('drawing-manufacturing-readiness')).toHaveTextContent('BLOCKED');
  });

  it.each([
    ['ko', '어셈블리 도면 핸드오프 상태', '리비전에 연결된 어셈블리 핸드오프'],
    ['en', 'Assembly drawing handoff status', 'Revision-bound assembly handoff'],
    ['ja', 'アセンブリ図面の引き継ぎ状態', 'リビジョンに紐づくアセンブリ引き継ぎ'],
    ['zh', '装配图交接状态', '与修订版绑定的装配体交接'],
    ['es', 'Estado de entrega del plano de ensamblaje', 'Entrega del ensamblaje vinculada a la revisión'],
    ['ar', 'حالة تسليم رسم التجميع', 'تسليم التجميع المرتبط بالمراجعة'],
  ] as const)('localizes the handoff status for %s', async (lang, ariaLabel, heading) => {
    const state = {
      parts: [{
        id: 'housing', name: 'Housing', partTemplateId: 'housing',
        position: { x: 0, y: 0, z: 0 }, orientation: IDENTITY_QUAT, fixed: true,
      }],
      mates: [],
    };
    const handoff = await buildAssemblyDrawingHandoff({
      state,
      featureTrees: { housing: tree },
    });
    writeAssemblyDrawingHandoff(handoff);

    render(<DrawingPageContent lang={lang} handoffId={handoff.handoffId} />);

    const status = await screen.findByTestId('drawing-handoff-status');
    expect(status).toHaveAttribute('aria-label', ariaLabel);
    expect(status).toHaveTextContent(heading);
  });
});
