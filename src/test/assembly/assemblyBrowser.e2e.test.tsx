/** @vitest-environment jsdom */
/**
 * AssemblyBrowser — Phase 4.A end-to-end integration tests.
 *
 * Exercises the full UI → fetch('/api/assembly-solve') → response → badge
 * pipeline for the sample-preset flow:
 *
 *   1. user picks a sample from the dropdown,
 *   2. the modal remounts with the preset's state + featureTrees,
 *   3. clicking Solve POSTs { state, featureTrees, solverOptions? } to the
 *      assembly-solve endpoint,
 *   4. the response phase badge ('real' | 'stub') is rendered,
 *   5. ok=false responses surface as solve-error.
 *
 * `fetch` is mocked at the global level — we do NOT hit the real API
 * (the real route has its own unit tests in route.test.ts). What matters
 * here is the wire shape between the modal page and the endpoint.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { AssemblyBrowserPageContent } from '@/app/[lang]/shape-generator/assembly/_content';
import type { FeatureTree } from '@/lib/cad/featureTree';
import type { AssemblyState } from '@/lib/assembly/assemblyState';

interface FetchedSolveBody {
  state: AssemblyState;
  featureTrees?: Record<string, FeatureTree>;
  solverOptions?: Record<string, unknown>;
}

function makeJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AssemblyBrowser → /api/assembly-solve e2e (sample presets)', () => {
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

  // ── 1. sample dropdown renders + loads state + featureTrees ────────────

  it('renders the sample picker with all 3 presets + blank', async () => {
    render(<AssemblyBrowserPageContent lang="en" />);
    await screen.findByTestId('solver-assembly-modal');
    const sel = screen.getByTestId(
      'solver-assembly-sample-select',
    ) as HTMLSelectElement;
    const values = Array.from(sel.options).map((o) => o.value);
    expect(values).toContain('');
    expect(values).toContain('two-cubes-concentric');
    expect(values).toContain('three-cubes-chain');
    expect(values).toContain('hinge-pair');
  });

  it('loading the two-cubes-concentric sample populates parts + mate rows', async () => {
    render(<AssemblyBrowserPageContent lang="en" />);
    await screen.findByTestId('solver-assembly-modal');
    fireEvent.change(screen.getByTestId('solver-assembly-sample-select'), {
      target: { value: 'two-cubes-concentric' },
    });
    expect(screen.getByTestId('solver-assembly-part-row-cube_a')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-part-row-cube_b')).toBeInTheDocument();
    expect(
      screen.getByTestId('solver-assembly-mate-row-mate_concentric_ab'),
    ).toBeInTheDocument();
  });

  // ── 2. solve POST body contains state + featureTrees ───────────────────

  it('clicking Solve after loading a sample posts state + featureTrees', async () => {
    fetchMock.mockResolvedValue(
      makeJsonResponse({
        ok: true,
        success: true,
        iterations: 1,
        finalMaxResidual: 1e-9,
        dof: 2,
        residuals: [],
        phase: 'real',
      }),
    );
    render(<AssemblyBrowserPageContent lang="en" />);
    await screen.findByTestId('solver-assembly-modal');
    fireEvent.change(screen.getByTestId('solver-assembly-sample-select'), {
      target: { value: 'two-cubes-concentric' },
    });
    fireEvent.click(screen.getByTestId('solver-assembly-solve'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/assembly-solve/');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body)) as FetchedSolveBody;
    // State must carry the preset's two cubes + concentric mate.
    expect(body.state.parts).toHaveLength(2);
    expect(body.state.mates).toHaveLength(1);
    expect(body.state.mates[0]!.kind).toBe('concentric');
    // featureTrees must include an entry per preset part.
    expect(body.featureTrees).toBeDefined();
    expect(body.featureTrees).toHaveProperty('cube_a');
    expect(body.featureTrees).toHaveProperty('cube_b');
  });

  // ── 3. phase=real response renders the 'real' badge ────────────────────

  it('renders phase badge "real" when the API responds with phase=real success', async () => {
    fetchMock.mockResolvedValue(
      makeJsonResponse({
        ok: true,
        success: true,
        iterations: 1,
        finalMaxResidual: 1e-9,
        dof: 2,
        residuals: [
          { mateId: 'mate_concentric_ab', residual: 0, supported: true },
        ],
        phase: 'real',
      }),
    );
    render(<AssemblyBrowserPageContent lang="en" />);
    await screen.findByTestId('solver-assembly-modal');
    fireEvent.change(screen.getByTestId('solver-assembly-sample-select'), {
      target: { value: 'two-cubes-concentric' },
    });
    fireEvent.click(screen.getByTestId('solver-assembly-solve'));
    await waitFor(() =>
      expect(screen.getByTestId('solver-assembly-solve-phase')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('solver-assembly-solve-phase').textContent).toMatch(
      /real/i,
    );
  });

  // ── 4. production authoring rejects a compatibility-stub response ─────

  it('provisions geometry for a new part and rejects phase=stub as non-authoritative', async () => {
    fetchMock.mockResolvedValue(
      makeJsonResponse({
        ok: true,
        success: true,
        iterations: 0,
        finalMaxResidual: 0,
        dof: 0,
        residuals: [],
        phase: 'stub',
      }),
    );
    render(<AssemblyBrowserPageContent lang="en" />);
    await screen.findByTestId('solver-assembly-modal');
    // Bare blank has no parts, so add one so the modal becomes solvable.
    fireEvent.click(screen.getByTestId('solver-assembly-add-part'));
    fireEvent.click(screen.getByTestId('solver-assembly-solve'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as FetchedSolveBody;
    expect(body.featureTrees?.part_1?.nodes).toHaveLength(1);
    await waitFor(() =>
      expect(screen.getByTestId('solver-assembly-solve-error')).toHaveTextContent(
        /AUTHORITATIVE_SOLVER_REQUIRED/i,
      ),
    );
    expect(screen.queryByTestId('solver-assembly-solve-phase')).not.toBeInTheDocument();
  });

  // ── 5. ok=false response renders error ─────────────────────────────────

  it('surfaces ok=false response as a solve-error', async () => {
    fetchMock.mockResolvedValue(
      makeJsonResponse(
        {
          ok: false,
          code: 'INVALID_ASSEMBLY',
          message: 'sample-mate references unknown part',
        },
        400,
      ),
    );
    render(<AssemblyBrowserPageContent lang="en" />);
    await screen.findByTestId('solver-assembly-modal');
    fireEvent.change(screen.getByTestId('solver-assembly-sample-select'), {
      target: { value: 'hinge-pair' },
    });
    fireEvent.click(screen.getByTestId('solver-assembly-solve'));
    await waitFor(() =>
      expect(screen.getByTestId('solver-assembly-solve-error')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('solver-assembly-solve-error').textContent).toMatch(
      /INVALID_ASSEMBLY/,
    );
  });

  // ── 6. changing sample resets previous state (modal remount) ───────────

  it('switching to a different sample resets the modal (no stale parts)', async () => {
    render(<AssemblyBrowserPageContent lang="en" />);
    await screen.findByTestId('solver-assembly-modal');
    // Load the 3-cube chain first.
    fireEvent.change(screen.getByTestId('solver-assembly-sample-select'), {
      target: { value: 'three-cubes-chain' },
    });
    expect(screen.getByTestId('solver-assembly-part-row-cube_c')).toBeInTheDocument();
    // Switch to the hinge pair — the chain-only `cube_c` row must disappear.
    fireEvent.change(screen.getByTestId('solver-assembly-sample-select'), {
      target: { value: 'hinge-pair' },
    });
    expect(screen.queryByTestId('solver-assembly-part-row-cube_c')).toBeNull();
    expect(screen.getByTestId('solver-assembly-part-row-hinge_base')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-part-row-hinge_door')).toBeInTheDocument();
  });

  // ── 7. switching back to blank clears the loaded preset ───────────────

  it('switching back to blank resets the modal to the empty placeholder state', async () => {
    render(<AssemblyBrowserPageContent lang="en" />);
    await screen.findByTestId('solver-assembly-modal');
    fireEvent.change(screen.getByTestId('solver-assembly-sample-select'), {
      target: { value: 'two-cubes-concentric' },
    });
    expect(screen.getByTestId('solver-assembly-part-row-cube_a')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('solver-assembly-sample-select'), {
      target: { value: '' },
    });
    expect(screen.queryByTestId('solver-assembly-part-row-cube_a')).toBeNull();
    expect(screen.getByTestId('solver-assembly-parts-empty')).toBeInTheDocument();
  });

  // ── 8. solverOptions passthrough is OPTIONAL (not auto-injected) ──────

  it('default POST body does NOT inject solverOptions when none configured', async () => {
    fetchMock.mockResolvedValue(
      makeJsonResponse({
        ok: true,
        success: true,
        iterations: 1,
        finalMaxResidual: 0,
        dof: 0,
        residuals: [],
        phase: 'real',
      }),
    );
    render(<AssemblyBrowserPageContent lang="en" />);
    await screen.findByTestId('solver-assembly-modal');
    fireEvent.change(screen.getByTestId('solver-assembly-sample-select'), {
      target: { value: 'hinge-pair' },
    });
    fireEvent.click(screen.getByTestId('solver-assembly-solve'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as FetchedSolveBody;
    expect(body.solverOptions).toBeUndefined();
  });

  // ── 9. three-cubes-chain wire shape — 3 parts, 2 mates ────────────────

  it('three-cubes-chain posts 3 parts + 2 mates + 3 featureTree entries', async () => {
    fetchMock.mockResolvedValue(
      makeJsonResponse({
        ok: true,
        success: true,
        iterations: 2,
        finalMaxResidual: 0,
        dof: 4,
        residuals: [
          { mateId: 'mate_chain_ab', residual: 0, supported: true },
          { mateId: 'mate_chain_bc', residual: 0, supported: true },
        ],
        phase: 'real',
      }),
    );
    render(<AssemblyBrowserPageContent lang="en" />);
    await screen.findByTestId('solver-assembly-modal');
    fireEvent.change(screen.getByTestId('solver-assembly-sample-select'), {
      target: { value: 'three-cubes-chain' },
    });
    fireEvent.click(screen.getByTestId('solver-assembly-solve'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as FetchedSolveBody;
    expect(body.state.parts).toHaveLength(3);
    expect(body.state.mates).toHaveLength(2);
    expect(Object.keys(body.featureTrees!).sort()).toEqual([
      'cube_a',
      'cube_b',
      'cube_c',
    ]);
  });

  // ── 10. residuals from the mocked response appear in the UI ───────────

  it('per-mate residuals from the response are rendered under solve-residuals', async () => {
    fetchMock.mockResolvedValue(
      makeJsonResponse({
        ok: true,
        success: true,
        iterations: 1,
        finalMaxResidual: 1e-9,
        dof: 1,
        residuals: [
          { mateId: 'mate_hinge', residual: 0.0001, supported: true },
        ],
        phase: 'real',
      }),
    );
    render(<AssemblyBrowserPageContent lang="en" />);
    await screen.findByTestId('solver-assembly-modal');
    fireEvent.change(screen.getByTestId('solver-assembly-sample-select'), {
      target: { value: 'hinge-pair' },
    });
    fireEvent.click(screen.getByTestId('solver-assembly-solve'));
    await waitFor(() =>
      expect(
        screen.getByTestId('solver-assembly-solve-residual-mate_hinge'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('solver-assembly-solve-residual-mate_hinge').textContent,
    ).toMatch(/mate_hinge/);
  });
});
