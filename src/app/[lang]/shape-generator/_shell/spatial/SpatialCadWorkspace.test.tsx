// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/hooks/useAuth';
import { SpatialCadWorkspace } from './SpatialCadWorkspace';
import { dispatchSpatialCadCommand } from './spatialCadCommands';
import { SPATIAL_AI_HANDOFF_REQUEST_EVENT, SPATIAL_DESIGN_BRIEF_HANDOFF_KEY, SPATIAL_DESIGN_BRIEF_HANDOFF_V2_KEY } from '@/lib/ai/spatialDesignBriefHandoff';

vi.mock('../../../nexyfab/design/InteriorPlanEditor', () => ({
  default: ({ width }: { width: number }) => <div data-testid="mock-interior-plan">plan:{width}</div>,
}));
vi.mock('../../../nexyfab/design/AssemblyViewer3D', () => ({
  default: ({ parts }: { parts: unknown[] }) => <div data-testid="mock-spatial-viewer">parts:{parts.length}</div>,
}));

describe('SpatialCadWorkspace', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null, token: null, sessionStatus: 'anonymous' });
  });

  it('renders an interior plan with fail-closed session truth', async () => {
    render(<SpatialCadWorkspace domain="interior" lang="en" experience="guided" onAiDesign={vi.fn()} />);
    expect(await screen.findByTestId('mock-interior-plan')).toHaveTextContent('plan:8000');
    expect(screen.getByTestId('interior-section-gauge')).toBeInTheDocument();
    expect(screen.getByTestId('interior-section-view')).toBeInTheDocument();
    expect(screen.getByTestId('spatial-status-preview')).toHaveTextContent('field/host authority not confirmed');
    expect(screen.getByTestId('spatial-status-not_run')).toHaveTextContent('NOT_RUN');
    expect(screen.getByTestId('spatial-product-qualification-layer')).toContainElement(screen.getByTestId('domain-product-qualification-panel'));
    expect(screen.getByTestId('domain-product-qualification-panel')).toHaveAttribute('data-state', 'NOT_RUN');
    expect(screen.getByTestId('domain-product-qualification-panel')).not.toHaveTextContent('PRODUCT_QUALIFIED');
    expect(screen.queryByText('Create Sketch')).toBeNull();
  });

  it.each(['ko', 'en', 'ja', 'zh', 'es', 'ar'])('keeps the interior 3D viewport while showing the agent status in %s', async lang => {
    render(<SpatialCadWorkspace domain="interior" lang={lang} experience="standard" onAiDesign={vi.fn()} />);
    const shell = screen.getByTestId('spatial-workspace-shell');
    expect(screen.getByTestId('architecture-interior-agent-status-panel')).toBeInTheDocument();
    expect(screen.getByTestId('architecture-interior-agent-status-panel')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    expect(await screen.findByTestId('mock-interior-plan')).toBeInTheDocument();
    act(() => { dispatchSpatialCadCommand('spatial.3d'); });
    expect(await screen.findByTestId('mock-spatial-viewer')).toBeInTheDocument();
    expect(shell).toContainElement(screen.getByTestId('architecture-interior-agent-status-panel'));
  });

  it('runs the real check endpoint but keeps the overall result at PREVIEW', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.includes('space-boundary')) return new Response(JSON.stringify({
        ok: true,
        result: { closed: true, openBoundaries: 0, loopCount: 1, loopAreasMm2: [48_000_000], conservative: true },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({
        ok: true,
        travel: { pass: true, maxTravelM: 8.4, limitM: 30, unreachableM2: 0 },
        egress: { verdict: 'INPUT' },
        finishes: { floorM2: 48, wallM2: 70, ceilingM2: 48 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    render(<SpatialCadWorkspace domain="interior" lang="en" experience="standard" onAiDesign={vi.fn()} />);
    fireEvent.click(screen.getByTestId('spatial-run-interior-check'));
    await waitFor(() => expect(screen.getAllByTestId('spatial-status-preview')).toHaveLength(2));
    expect(screen.getByText(/Farthest travel:/)).toHaveTextContent('PASS');
    expect(screen.getByText(/Egress width:/)).toHaveTextContent('INPUT');
    expect(screen.getByTestId('spatial-governed-checks')).toHaveTextContent('Space-boundary closure: PASS');
    expect(screen.getByTestId('spatial-governed-checks')).toHaveTextContent('Door-swing clearance: NOT_RUN');
    expect(screen.getByTestId('spatial-governed-checks')).toHaveTextContent('Egress route graph: NOT_RUN');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const legacyCall = fetchMock.mock.calls.find(([url]) => String(url).includes('drawing/interior-check'))!;
    const request = JSON.parse(String(legacyCall[1]?.body)) as { assembly: { roomBounds: { W: number }; parts: unknown[] }; params: Record<string, unknown> };
    expect(request.assembly.roomBounds.W).toBe(8000);
    expect(request.assembly.parts.length).toBeGreaterThan(10);
    expect(request.params).not.toHaveProperty('occupantDensityM2');
  });

  it('runs the governed door-swing API only after explicit leaf thickness input', async () => {
    useAuthStore.setState({ token: 'signed.test.token', sessionStatus: 'authenticated' });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.includes('space-boundary')) return new Response(JSON.stringify({ ok: true, result: { closed: true, openBoundaries: 0, loopCount: 1, loopAreasMm2: [48_000_000], conservative: true } }), { status: 200 });
      if (url.includes('door-swing')) return new Response(JSON.stringify({ ok: true, result: { clear: true, minimumEnvelopeDistanceMm: 320, requiredEnvelopeDistanceMm: 40, collidingObstacleIds: [], conservative: true } }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, travel: { pass: true, maxTravelM: 8, limitM: 30 }, egress: { verdict: 'INPUT' } }), { status: 200 });
    });
    render(<SpatialCadWorkspace domain="interior" lang="en" experience="standard" onAiDesign={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Door-leaf thickness (mm)'), { target: { value: '40' } });
    fireEvent.click(screen.getByTestId('spatial-run-interior-check'));
    await waitFor(() => expect(screen.getByTestId('spatial-governed-checks')).toHaveTextContent('Door-swing clearance: PASS'));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const doorCall = fetchMock.mock.calls.find(([url]) => String(url).includes('door-swing'))!;
    const body = JSON.parse(String(doorCall[1]?.body)) as { thicknessMm: number; obstacles: unknown[] };
    expect(body.thicknessMm).toBe(40);
    expect(body.obstacles.length).toBeGreaterThan(0);
    expect(new Headers(doorCall[1]?.headers).get('authorization')).toBe('Bearer signed.test.token');
    const legacyCall = fetchMock.mock.calls.find(([url]) => String(url).includes('drawing/interior-check'))!;
    expect(new Headers(legacyCall[1]?.headers).get('authorization')).toBeNull();
  });

  it('surfaces protected v1 checks as AUTH_REQUIRED instead of fabricating results', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      if (String(input).includes('drawing/interior-check')) return new Response(JSON.stringify({ ok: true, travel: { pass: true, maxTravelM: 8, limitM: 30 }, egress: { verdict: 'INPUT' } }), { status: 200 });
      return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401 });
    });
    render(<SpatialCadWorkspace domain="interior" lang="en" experience="standard" onAiDesign={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Door-leaf thickness (mm)'), { target: { value: '40' } });
    fireEvent.click(screen.getByTestId('spatial-run-interior-check'));
    await waitFor(() => expect(screen.getByTestId('spatial-governed-checks')).toHaveTextContent('AUTH_REQUIRED'));
    expect(screen.getAllByTestId('spatial-status-blocked')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Sign in and run again' })).toHaveAttribute('href', '/login');
  });

  it('builds and submits governed egress evidence only after explicit rule inputs', async () => {
    useAuthStore.setState({ token: 'signed.test.token', sessionStatus: 'authenticated' });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.includes('space-boundary')) return new Response(JSON.stringify({ ok: true, result: { closed: true, openBoundaries: 0, loopCount: 1, loopAreasMm2: [48_000_000], conservative: true } }), { status: 200 });
      if (url.includes('/egress/')) return new Response(JSON.stringify({ ok: true, result: { passed: true, reachableExitCount: 1, requiredIndependentExits: 1, failures: [], conservative: true } }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, travel: { pass: true, maxTravelM: 8, limitM: 30 }, egress: { verdict: 'PASS' } }), { status: 200 });
    });
    render(<SpatialCadWorkspace domain="interior" lang="en" experience="standard" onAiDesign={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Governed minimum clear width (mm)'), { target: { value: '900' } });
    fireEvent.change(screen.getByLabelText('Required independent exits'), { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('spatial-run-interior-check'));
    await waitFor(() => expect(screen.getByTestId('spatial-governed-checks')).toHaveTextContent('Egress route graph: PASS'));
    const egressCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/egress/'))!;
    const body = JSON.parse(String(egressCall[1]?.body)) as { nodes: unknown[]; edges: Array<{ clearWidthMm: number }>; originNodeIds: string[]; minimumClearWidthMm: number; minimumIndependentExits: number };
    expect(body.nodes.length).toBeGreaterThan(10);
    expect(body.originNodeIds.length).toBeGreaterThan(10);
    expect(body.edges.every(edge => Number.isFinite(edge.clearWidthMm))).toBe(true);
    expect(body.minimumClearWidthMm).toBe(900);
    expect(body.minimumIndependentExits).toBe(1);
    expect(new Headers(egressCall[1]?.headers).get('authorization')).toBe('Bearer signed.test.token');
  });

  it('routes spatial ribbon commands to the visible workspace', async () => {
    render(<SpatialCadWorkspace domain="interior" lang="en" experience="expert" onAiDesign={vi.fn()} />);
    act(() => { dispatchSpatialCadCommand('spatial.3d'); });
    expect(await screen.findByTestId('mock-spatial-viewer')).toHaveTextContent(/parts:/);
  });

  it('keeps a numeric draft stable and commits once on blur', async () => {
    render(<SpatialCadWorkspace domain="interior" lang="en" experience="standard" onAiDesign={vi.fn()} />);
    const width = screen.getByTestId('spatial-input-width');
    fireEvent.change(width, { target: { value: '8500' } });
    expect(width).toHaveValue(8500);
    expect(await screen.findByTestId('mock-interior-plan')).toHaveTextContent('plan:8000');
    fireEvent.blur(width);
    await waitFor(() => expect(screen.getByTestId('mock-interior-plan')).toHaveTextContent('plan:8500'));
  });

  it('serializes the current interior draft for AI review without running AI', async () => {
    useAuthStore.setState({ token: 'interior.token', sessionStatus: 'authenticated' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { document: { revision: number } };
      return new Response(JSON.stringify({ ok: true, transaction: { document: { revision: body.document.revision + 1 } }, persistence: 'NOT_RUN' }), { status: 200 });
    });
    sessionStorage.clear();
    render(<SpatialCadWorkspace domain="interior" lang="en" experience="standard" onAiDesign={vi.fn()} />);
    fireEvent.change(screen.getByTestId('spatial-input-width'), { target: { value: '8500' } });
    fireEvent.blur(screen.getByTestId('spatial-input-width'));
    act(() => window.dispatchEvent(new Event(SPATIAL_AI_HANDOFF_REQUEST_EVENT)));
    const handoff = JSON.parse(sessionStorage.getItem(SPATIAL_DESIGN_BRIEF_HANDOFF_KEY) ?? 'null') as { domain: string; parameters: Record<string, unknown>; missingAuthority: string[] };
    expect(handoff.domain).toBe('interior');
    expect(handoff.parameters['room width (mm)']).toBe(8500);
    expect(handoff.missingAuthority).toContain('authenticated governed-check evidence');
    await waitFor(() => {
      const v2 = JSON.parse(sessionStorage.getItem(SPATIAL_DESIGN_BRIEF_HANDOFF_V2_KEY) ?? 'null') as { parameters?: Record<string, unknown>; parameterPaths?: string[] } | null;
      expect(v2?.parameters).toMatchObject({ width: 8500, depth: 6000, ceilingHeight: 2700, doorWidth: 1000, exitCount: 1, rows: 2, cols: 3 });
      expect(v2?.parameters).not.toHaveProperty('furniture');
      expect(v2?.parameters).not.toHaveProperty('travel limit (m)');
      expect(v2?.parameterPaths).toEqual(['width']);
    });
    await waitFor(() => expect(screen.getByTestId('spatial-transaction-status')).toHaveTextContent('Server command validated'));
  });

  it('routes civil to its real alignment workspace without mechanical substitution', () => {
    const onAiDesign = vi.fn();
    render(<SpatialCadWorkspace domain="civil" lang="en" experience="standard" onAiDesign={onAiDesign} />);
    expect(screen.getByTestId('civil-plan')).toBeInTheDocument();
    expect(screen.queryByText('Mechanical CAD geometry is not substituted')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review AI design brief' }));
    expect(onAiDesign).toHaveBeenCalledTimes(1);
  });
});
