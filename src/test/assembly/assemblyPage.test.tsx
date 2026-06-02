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
import { AssemblyBrowserPageContent } from '@/app/[lang]/shape-generator/assembly/_content';
import { IDENTITY_QUAT, type AssemblyState } from '@/lib/assembly/assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';

describe('AssemblyBrowserPageContent', () => {
  it('mounts the modal inside a page wrapper', () => {
    render(<AssemblyBrowserPageContent lang="en" onSolve={vi.fn()} />);
    expect(screen.getByTestId('solver-assembly-page')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-modal')).toBeInTheDocument();
  });

  it('default initial state has no parts and no mates', () => {
    render(<AssemblyBrowserPageContent lang="en" onSolve={vi.fn()} />);
    expect(screen.getByTestId('solver-assembly-parts-empty')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-mates-empty')).toBeInTheDocument();
  });

  it('respects the lang prop (en → English title)', () => {
    render(<AssemblyBrowserPageContent lang="en" onSolve={vi.fn()} />);
    expect(screen.getByTestId('solver-assembly-title').textContent).toMatch(
      /Assembly Browser/i,
    );
  });

  it('respects the lang prop (ko → Korean title)', () => {
    render(<AssemblyBrowserPageContent lang="ko" onSolve={vi.fn()} />);
    expect(screen.getByTestId('solver-assembly-title').textContent).toMatch(
      /어셈블리 브라우저/,
    );
  });

  it('normalizes unknown lang codes to English', () => {
    render(<AssemblyBrowserPageContent lang="xx" onSolve={vi.fn()} />);
    expect(screen.getByTestId('solver-assembly-title').textContent).toMatch(
      /Assembly Browser/i,
    );
  });

  it('renders a seeded initialState', () => {
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
    expect(screen.getByTestId('solver-assembly-part-row-p1')).toBeInTheDocument();
  });

  // ── Phase 4: default fetcher routes featureTrees correctly ────────────

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

    const TINY_TREE: FeatureTree = { nodes: [] };

    it('omits featureTrees from POST body when no tree has been entered (phase=stub)', async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            success: true,
            iterations: 0,
            finalMaxResidual: 0,
            dof: 0,
            residuals: [],
            phase: 'stub',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
      render(<AssemblyBrowserPageContent lang="en" initialState={seedOnePart} />);
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body).toHaveProperty('state');
      expect(body).not.toHaveProperty('featureTrees');
      // Phase badge surfaces.
      await waitFor(() =>
        expect(screen.getByTestId('solver-assembly-solve-phase')).toBeInTheDocument(),
      );
      expect(screen.getByTestId('solver-assembly-solve-phase').textContent).toMatch(
        /stub/i,
      );
    });

    it('includes featureTrees in POST body when initialFeatureTrees supplied (phase=real)', async () => {
      fetchMock.mockResolvedValue(
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
      );
      render(
        <AssemblyBrowserPageContent
          lang="en"
          initialState={seedOnePart}
          initialFeatureTrees={{ p1: TINY_TREE }}
        />,
      );
      fireEvent.click(screen.getByTestId('solver-assembly-solve'));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
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
      render(<AssemblyBrowserPageContent lang="en" initialState={seedOnePart} />);
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
