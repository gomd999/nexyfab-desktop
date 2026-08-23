/** @vitest-environment jsdom */
/**
 * Assembly Browser route — page content tests.
 *
 * The Next.js page (page.tsx) just unwraps the params promise and renders
 * AssemblyBrowserPageContent — we test the _content.tsx component directly
 * with a plain `lang` string so jsdom doesn't have to deal with the
 * use(params) hook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// These are page/control-plane tests. The real WebGL viewer has dedicated
// suites and jsdom cannot create a WebGL context, so isolate it here instead
// of accepting repeated canvas "Not implemented" errors as test noise.
vi.mock('@/app/[lang]/shape-generator/assembly/Assembly3DViewer', async importOriginal => {
  const actual = await importOriginal<typeof import('@/app/[lang]/shape-generator/assembly/Assembly3DViewer')>();
  return { ...actual, default: () => null };
});

import { AssemblyBrowserPageContent } from '@/app/[lang]/shape-generator/assembly/_content';
import { IDENTITY_QUAT, type AssemblyState } from '@/lib/assembly/assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';
import { pinBlockAssemblyPlan } from '@/lib/ai/design-driver/fixturePlanner';
import { buildEditableWorkspaceCandidate } from '@/lib/ai/design-driver/workspaceCandidate';
import {
  readAiAssemblyWorkspaceSeed,
  writeAiAssemblyWorkspaceSeed,
} from '@/app/[lang]/shape-generator/design-brief/assemblyWorkspaceSeed';

describe('AssemblyBrowserPageContent', () => {
  it('mounts the modal inside a page wrapper', async () => {
    render(<AssemblyBrowserPageContent lang="en" onSolve={vi.fn()} />);
    expect(screen.getByTestId('solver-assembly-page')).toBeInTheDocument();
    expect(await screen.findByTestId('solver-assembly-modal')).toBeInTheDocument();
  });

  it('default initial state has no parts and no mates', async () => {
    render(<AssemblyBrowserPageContent lang="en" onSolve={vi.fn()} />);
    await screen.findByTestId('solver-assembly-modal');
    expect(screen.getByTestId('solver-assembly-parts-empty')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-mates-empty')).toBeInTheDocument();
  });

  it('respects the lang prop (en → English title)', async () => {
    render(<AssemblyBrowserPageContent lang="en" onSolve={vi.fn()} />);
    await screen.findByTestId('solver-assembly-modal');
    expect(screen.getByTestId('solver-assembly-title').textContent).toMatch(
      /Assembly Browser/i,
    );
  });

  it('respects the lang prop (ko → Korean title)', async () => {
    render(<AssemblyBrowserPageContent lang="ko" onSolve={vi.fn()} />);
    await screen.findByTestId('solver-assembly-modal');
    expect(screen.getByTestId('solver-assembly-title').textContent).toMatch(
      /어셈블리 브라우저/,
    );
  });

  it('normalizes unknown lang codes to English', async () => {
    render(<AssemblyBrowserPageContent lang="xx" onSolve={vi.fn()} />);
    await screen.findByTestId('solver-assembly-modal');
    expect(screen.getByTestId('solver-assembly-title').textContent).toMatch(
      /Assembly Browser/i,
    );
  });

  it('renders a seeded initialState', async () => {
    const seeded: AssemblyState = {
      parts: [
        {
          id: 'p1',
          name: 'P1',
          partTemplateId: 't',
          position: { x: 0, y: 0, z: 0 },
          orientation: IDENTITY_QUAT,
          fixed: true,
        },
      ],
      mates: [],
    };
    render(<AssemblyBrowserPageContent lang="en" initialState={seeded} onSolve={vi.fn()} />);
    await screen.findByTestId('solver-assembly-modal');
    expect(screen.getByTestId('solver-assembly-part-row-p1')).toBeInTheDocument();
  });

  // ── Phase 4: default fetcher routes featureTrees correctly ────────────

  it('consumes an AI semantic-assembly handoff without inheriting verification', async () => {
    const candidate = buildEditableWorkspaceCandidate(pinBlockAssemblyPlan());
    expect(writeAiAssemblyWorkspaceSeed('ai-rev-1', candidate)).toEqual({ ok: true });

    render(<AssemblyBrowserPageContent lang="en" aiRevisionId="ai-rev-1" onSolve={vi.fn()} />);
    expect(await screen.findByTestId('ai-assembly-revision-warning')).toHaveTextContent(
      /prior verification not inherited/i,
    );
    expect(await screen.findByTestId('solver-assembly-part-row-block')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-part-row-pin')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-mate-row-m_concentric')).toBeInTheDocument();
    expect(readAiAssemblyWorkspaceSeed('ai-rev-1')).toBeNull();
  });

  describe('default onSolve fetcher', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let originalFetch: typeof globalThis.fetch | undefined;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      fetchMock = vi.fn();
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    });

    afterEach(() => {
      if (originalFetch) {
        globalThis.fetch = originalFetch;
      }
    });

    const seedOnePart: AssemblyState = {
      parts: [
        {
          id: 'p1',
          name: 'P1',
          partTemplateId: 't',
          position: { x: 0, y: 0, z: 0 },
          orientation: IDENTITY_QUAT,
          fixed: true,
        },
      ],
      mates: [],
    };

    const TINY_TREE: FeatureTree = {
      nodes: [{
        id: 'p1-extrude',
        name: 'P1 base extrude',
        dependencies: [],
        payload: {
          kind: 'extrude',
          loop: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
          depth: 10,
          direction: 'one_sided',
          mode: 'add',
        },
      }],
    };

    it('blocks an exact solve before POST when no FeatureTree has been entered', async () => {
      render(<AssemblyBrowserPageContent lang="en" initialState={seedOnePart} />);
      await screen.findByTestId('solver-assembly-modal');
      expect(screen.getByTestId('solver-assembly-solve')).toBeDisabled();
      expect(screen.getByTestId('solver-assembly-readiness-gate')).toHaveTextContent(
        /Missing active geometry: p1/i,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('includes featureTrees in POST body when initialFeatureTrees supplied (phase=real)', async () => {
      // The 3D viewer also requests a mesh for the supplied tree. Return a
      // fresh Response per call so that request cannot consume the solve
      // response body before /api/assembly-solve reads it.
      fetchMock.mockImplementation(() => Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            success: true,
            iterations: 4,
            finalMaxResidual: 1e-6,
            dof: 0,
            residuals: [],
            phase: 'real',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ));
      render(
        <AssemblyBrowserPageContent
          lang="en"
          initialState={seedOnePart}
          initialFeatureTrees={{ p1: TINY_TREE }}
        />,
      );
      await screen.findByTestId('solver-assembly-modal');
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() =>
        expect(fetchMock.mock.calls.some(([url]) => url === '/api/assembly-solve/')).toBe(true),
      );
      const solveCall = fetchMock.mock.calls.find(([url]) => url === '/api/assembly-solve/');
      expect(solveCall).toBeDefined();
      const [, init] = solveCall as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body).toHaveProperty('featureTrees');
      expect((body.featureTrees as Record<string, FeatureTree>).p1).toBeDefined();
      await waitFor(() =>
        expect(screen.getByTestId('solver-assembly-solve-phase').textContent).toMatch(
          /real/i,
        ),
      );
    });

    it('surfaces ok=false errors from the API as solve-error', async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            code: 'INVALID_ASSEMBLY',
            message: 'no fixed part',
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
      );
      render(
        <AssemblyBrowserPageContent
          lang="en"
          initialState={seedOnePart}
          initialFeatureTrees={{ p1: TINY_TREE }}
        />,
      );
      await screen.findByTestId('solver-assembly-modal');
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() =>
        expect(screen.getByTestId('solver-assembly-solve-error')).toBeInTheDocument(),
      );
      expect(screen.getByTestId('solver-assembly-solve-error').textContent).toMatch(
        /INVALID_ASSEMBLY/,
      );
    });
  });
});
