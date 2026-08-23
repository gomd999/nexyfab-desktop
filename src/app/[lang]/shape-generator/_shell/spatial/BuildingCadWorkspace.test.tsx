// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/hooks/useAuth';
import { createSpatialAiCandidate } from '@/lib/ai/spatialAiCandidate';
import { saveSpatialDesignCandidateReturnV2, SPATIAL_AI_HANDOFF_REQUEST_EVENT, SPATIAL_DESIGN_BRIEF_HANDOFF_V2_KEY } from '@/lib/ai/spatialDesignBriefHandoff';
import { spatialCadContentHash, spatialCadDocumentSnapshot } from '@/lib/ai/spatialDesignBriefBuilder';
import { dispatchSpatialCadCommand } from './spatialCadCommands';
import { BuildingCadWorkspace } from './BuildingCadWorkspace';

vi.mock('../../../nexyfab/design/AssemblyViewer3D', () => ({ default: ({ parts }: { parts: unknown[] }) => <div data-testid="mock-building-viewer">parts:{parts.length}</div> }));

describe('BuildingCadWorkspace', () => {
  beforeEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); useAuthStore.setState({ user: null, token: null, sessionStatus: 'anonymous' }); });

  it('renders a real semantic plan while keeping checks NOT_RUN', () => {
    render(<BuildingCadWorkspace lang="en" onAiDesign={vi.fn()} />);
    expect(screen.getByTestId('building-plan')).toBeInTheDocument();
    expect(screen.getByTestId('building-section-gauge')).toBeInTheDocument();
    expect(screen.getByTestId('building-section-view')).toBeInTheDocument();
    expect(screen.getByTestId('building-spatial-cad')).toHaveTextContent('NOT_RUN');
    expect(screen.queryByText('Mechanical CAD geometry is not substituted')).toBeNull();
  });

  it.each(['en', 'ar'])('shows truthful architecture agent status and keeps the building 3D viewport in %s', async lang => {
    render(<BuildingCadWorkspace lang={lang} onAiDesign={vi.fn()} />);
    const statusPanel = screen.getByTestId('architecture-interior-agent-status-panel');
    expect(statusPanel).toHaveAttribute('data-state', 'ready');
    expect(statusPanel).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    expect(screen.getByTestId('building-plan')).toBeInTheDocument();
    act(() => { dispatchSpatialCadCommand('spatial.3d'); });
    expect(await screen.findByTestId('mock-building-viewer')).toBeInTheDocument();
    expect(screen.getByTestId('architecture-interior-agent-status-panel')).toBeInTheDocument();
  });

  it('submits the architecture document with auth and keeps missing circulation NOT_RUN', async () => {
    useAuthStore.setState({ token: 'building.token', sessionStatus: 'authenticated' });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, releaseReady: false, topology: { releaseReady: true, gates: [{ id: 'space-wall-loop', status: 'passed', reasons: [] }], spaceAreasMm2: { 'space-l1': 96_000_000 } }, circulation: { status: 'not_run', failures: [{ code: 'CIRCULATION_MODEL_MISSING' }] } }), { status: 200 }));
    render(<BuildingCadWorkspace lang="en" onAiDesign={vi.fn()} />);
    fireEvent.click(screen.getByTestId('building-run-verify'));
    await waitFor(() => expect(screen.getByTestId('building-verification')).toHaveTextContent('space-wall-loop: PASSED'));
    expect(screen.getByTestId('building-verification')).toHaveTextContent('Circulation, stairs & egress: NOT_RUN');
    const init = fetchMock.mock.calls[0][1]!;
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer building.token');
    const body = JSON.parse(String(init.body)) as { architecture: { schema: string; storeys: unknown[]; openings: unknown[] }; circulation?: unknown };
    expect(body.architecture.schema).toBe('nexyfab.architecture.v1');
    expect(body.architecture.storeys).toHaveLength(2);
    expect(body.architecture.openings.length).toBeGreaterThan(1);
    expect(body).not.toHaveProperty('circulation');
  });

  it('surfaces anonymous CAD v1 verification as AUTH_REQUIRED', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401 }));
    render(<BuildingCadWorkspace lang="en" onAiDesign={vi.fn()} />);
    fireEvent.click(screen.getByTestId('building-run-verify'));
    expect(await screen.findByText(/AUTH_REQUIRED/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in and run again' })).toHaveAttribute('href', '/login');
  });

  it('routes building ribbon view commands to the workspace', async () => {
    render(<BuildingCadWorkspace lang="en" onAiDesign={vi.fn()} />);
    act(() => { dispatchSpatialCadCommand('spatial.3d'); });
    expect(await screen.findByTestId('mock-building-viewer')).toHaveTextContent(/parts:/);
    expect(screen.getByText('CONCEPT · geometry preview')).toBeInTheDocument();
    expect(screen.queryByText('PREVIEW · topology calculated')).toBeNull();
  });

  it('lets a person finish typing a dimension before normalization', async () => {
    useAuthStore.setState({ token: 'building.token', sessionStatus: 'authenticated' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { document: { revision: number } };
      return new Response(JSON.stringify({ ok: true, transaction: { document: { revision: body.document.revision + 1 } }, persistence: 'NOT_RUN' }), { status: 200 });
    });
    render(<BuildingCadWorkspace lang="en" onAiDesign={vi.fn()} />);
    const width = screen.getByRole('spinbutton', { name: 'Building width' });
    fireEvent.change(width, { target: { value: '13500' } });
    expect(width).toHaveValue(13500);
    expect(screen.getByText(/12000 × 8000 mm/)).toBeInTheDocument();
    fireEvent.blur(width);
    expect(screen.getByText(/13500 × 8000 mm/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('spatial-transaction-status')).toHaveTextContent('Server command validated'));
  });

  it('routes the dimensions command to the primary building field', () => {
    render(<BuildingCadWorkspace lang="en" onAiDesign={vi.fn()} />);
    act(() => { dispatchSpatialCadCommand('spatial.dimensions'); });
    expect(screen.getByRole('spinbutton', { name: 'Building width' })).toHaveFocus();
  });

  it('does not turn focus and a no-op blur into an AI edit selection', () => {
    render(<BuildingCadWorkspace lang="en" onAiDesign={vi.fn()} />);
    const width = screen.getByRole('spinbutton', { name: 'Building width' });
    fireEvent.focus(width);
    fireEvent.blur(width);
    act(() => { window.dispatchEvent(new Event(SPATIAL_AI_HANDOFF_REQUEST_EVENT)); });
    expect(sessionStorage.getItem(SPATIAL_DESIGN_BRIEF_HANDOFF_V2_KEY)).toBeNull();
  });

  it('restores the bound document identity and commits a returned candidate once', async () => {
    const parameters = {
      'building width (mm)': 12_000, 'building depth (mm)': 8000,
      'storey count': 2, 'storey height (mm)': 3200, 'wall thickness (mm)': 200,
      'slab thickness (mm)': 200, 'entrance width (mm)': 1200, 'window width (mm)': 1800,
      'windows per storey': 1, 'window height (mm)': 1400, 'window sill (mm)': 900,
    };
    const contentHash = await spatialCadContentHash(spatialCadDocumentSnapshot('building', 0, parameters));
    const handoff = {
      schema: 'nexyfab.spatial-design-brief-handoff.v2' as const, createdAt: Date.now(), domain: 'building' as const, unit: 'mm' as const,
      parameters, missingAuthority: [], verification: 'NOT_RUN' as const, baseDocumentRevision: 0,
      contentHash, documentId: 'stable-building-document', parameterPaths: ['building width (mm)'], locks: [], mode: 'request_only_edit' as const,
    };
    const candidate = createSpatialAiCandidate({ handoff, operation: { kind: 'set_parameter', path: 'building width (mm)', value: 13_000 }, id: 'building-return-1', summary: 'resize' });
    saveSpatialDesignCandidateReturnV2(sessionStorage, { handoff, candidate });

    render(<BuildingCadWorkspace lang="en" onAiDesign={vi.fn()} />);
    const apply = await screen.findByTestId('spatial-ai-candidate-apply');
    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);

    await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Building width' })).toHaveValue(13_000));
    expect(screen.getByTestId('spatial-transaction-status')).toHaveTextContent('Local semantic model r1');
    expect(screen.getByTestId('spatial-undo')).toBeEnabled();
    expect(screen.queryByTestId('spatial-ai-candidate-bridge')).toBeNull();
  });
});
