// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureInteriorWorkspaceV2 } from '@/lib/ai/architectureInteriorWorkspace';

const workspaceMocks = vi.hoisted(() => ({ validate: vi.fn((): string[] => []) }));
vi.mock('@/lib/ai/architectureInteriorWorkspaceClientValidation', () => ({ validateArchitectureInteriorWorkspaceClientEnvelope: workspaceMocks.validate }));

import { ArchitectureInteriorLiveInspector } from './ArchitectureInteriorLiveInspector';

const workspace = {
  schema: 'nexyfab.architecture-interior-workspace.v2', projectId: 'project-1', contentHash: 'c'.repeat(64),
  workspace: { projectId: 'project-1', revision: 2, contentHash: 'c'.repeat(64), track: 'ai_design', maturity: 'concept' },
  units: { sourceUnit: 'mm', geometryUnit: 'mm', analysisUnit: 'SI' }, coordinates: [], artifactGraph: {},
  architecture: { documentId: 'architecture-1', document: { schema: 'nexyfab.architecture.v1', revision: 2, storeys: [{ id: 'storey-1', name: 'Ground', elevationMm: 0, heightMm: 3000 }], spaces: [{ id: 'space-1', storeyId: 'storey-1', name: 'Room', usage: 'office', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], wallIds: ['wall-1'], slabId: 'slab-1', ceilingId: 'ceiling-1' }], walls: [{ id: 'wall-1', kind: 'line', storeyId: 'storey-1', startMm: [0, 0], endMm: [4000, 0], thicknessMm: 200, heightMm: 3000 }], slabs: [{ id: 'slab-1', storeyId: 'storey-1', spaceId: 'space-1', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], thicknessMm: 180 }], ceilings: [{ id: 'ceiling-1', storeyId: 'storey-1', spaceId: 'space-1', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], elevationMm: 2800, thicknessMm: 100 }], openings: [] }, geometry: {}, semantic: {}, provenance: [{}] },
  interior: { documentId: 'interior-1', document: { schema: 'nexyfab.interior.v1', revision: 2, architectureDocumentId: 'architecture-1', lights: [], furniture: [{ id: 'furniture-1', spaceId: 'space-1', positionMm: [1000, 1200, 0], sizeMm: [1200, 600, 750], clearanceMm: 100, rotationDeg: 0 }], finishes: [], ceilingSystems: [{ id: 'ceiling-system-1', spaceId: 'space-1', hostCeilingId: 'ceiling-1', kind: 'grid', elevationMm: 2700, moduleMm: [600, 600] }] }, geometry: {}, semantic: {}, provenance: [{}] },
} as never;

const baseWorkspace = workspace as unknown as ArchitectureInteriorWorkspaceV2;
const historyState = {
  ok: true, schema: 'nexyfab.architecture-interior-history.v1', projectId: 'project-1', revision: 2, contentHash: 'c'.repeat(64),
  canUndo: true, canRedo: false, undo: { sequence: 1, commandId: 'command-1' }, redo: null,
};
const appliedWorkspace = {
  ...baseWorkspace,
  contentHash: 'd'.repeat(64),
  workspace: { ...baseWorkspace.workspace, revision: 3, contentHash: 'd'.repeat(64) },
  architecture: { ...baseWorkspace.architecture, document: { ...baseWorkspace.architecture.document, revision: 3 } },
  interior: { ...baseWorkspace.interior, document: { ...baseWorkspace.interior.document, revision: 3 } },
  artifactGraph: { revision: 3, artifacts: [] },
} as never;
const appliedWorkspace4 = {
  ...baseWorkspace,
  contentHash: 'e'.repeat(64),
  workspace: { ...baseWorkspace.workspace, revision: 4, contentHash: 'e'.repeat(64) },
  architecture: { ...baseWorkspace.architecture, document: { ...baseWorkspace.architecture.document, revision: 4 } },
  interior: { ...baseWorkspace.interior, document: { ...baseWorkspace.interior.document, revision: 4 } },
  artifactGraph: { revision: 4, artifacts: [] },
} as never;

function bodyFor(url: string, value: unknown): Response {
  return new Response(JSON.stringify(url.includes('architecture-interior-history') ? value : { ok: true, session: { role: 'editor' }, workspace }), { status: 200 });
}

describe('ArchitectureInteriorLiveInspector', () => {
  it('loads stable selections and waits for explicit Apply before the approved POST', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method) return bodyFor(url, fetchMock.mock.calls.length > 4 ? { ...historyState, revision: 3, contentHash: 'd'.repeat(64) } : historyState);
      if (fetchMock.mock.calls.length === 3) return new Response(JSON.stringify({ ok: false, code: 'APPROVAL_REQUIRED', approval: { receiptHash: 'a'.repeat(64) } }), { status: 409 });
      return new Response(JSON.stringify({ ok: true, workspace: appliedWorkspace }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ArchitectureInteriorLiveInspector lang="en" projectId="project-1" />);
    await waitFor(() => expect(screen.getByTestId('architecture-interior-live-selection')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('architecture-interior-live-selection'), { target: { value: 'interior:furniture:furniture-1' } });
    const position = await screen.findByLabelText('positionMm 1');
    fireEvent.change(position, { target: { value: '2200' } });
    fireEvent.blur(position);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByTestId('architecture-interior-apply-positionMm'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).not.toHaveProperty('approval');
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toMatchObject({ approval: { approved: true, receiptHash: 'a'.repeat(64) } });
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)).arguments).toMatchObject({ objectId: 'furniture-1', parameterPaths: ['positionMm'], patch: { positionMm: [2200, 1200, 0] } });
  });

  it('binds wall geometry and interior ceiling systems to executable atomic patches', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method) return bodyFor(url, fetchMock.mock.calls.length > 4 ? { ...historyState, revision: fetchMock.mock.calls.length > 7 ? 4 : 3, contentHash: fetchMock.mock.calls.length > 7 ? 'e'.repeat(64) : 'd'.repeat(64) } : historyState);
      if (!JSON.parse(String(init.body)).approval) return new Response(JSON.stringify({ ok: false, approval: { receiptHash: 'b'.repeat(64) } }), { status: 409 });
      return new Response(JSON.stringify({ ok: true, workspace: fetchMock.mock.calls.length > 5 ? appliedWorkspace4 : appliedWorkspace }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ArchitectureInteriorLiveInspector lang="en" projectId="project-1" />);
    await waitFor(() => expect(screen.getByTestId('architecture-interior-live-selection')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('architecture-interior-live-selection'), { target: { value: 'architecture:wall:wall-1' } });
    fireEvent.change(await screen.findByLabelText('startMm 1'), { target: { value: '25' } });
    fireEvent.click(screen.getByTestId('architecture-interior-apply-startMm'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({ tool: 'edit_wall', arguments: { patch: { kind: 'line', startMm: [25, 0], endMm: [4000, 0] } } });

    await waitFor(() => expect(screen.getByTestId('architecture-interior-live-selection')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('architecture-interior-live-selection'), { target: { value: 'interior:ceiling:ceiling-system-1' } });
    fireEvent.change(await screen.findByLabelText('elevationMm'), { target: { value: '2650' } });
    fireEvent.click(screen.getByTestId('architecture-interior-apply-elevationMm'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(8));
    expect(JSON.parse(String(fetchMock.mock.calls[6]?.[1]?.body))).toMatchObject({ tool: 'edit_ceiling_system', arguments: { patch: { elevationMm: 2650 } } });
  });

  it('fails closed when an approved response does not advance revision/hash with stale artifacts', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method) return bodyFor(url, historyState);
      if (!JSON.parse(String(init.body)).approval) return new Response(JSON.stringify({ ok: false, approval: { receiptHash: 'c'.repeat(64) } }), { status: 409 });
      return new Response(JSON.stringify({ ok: true, workspace }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ArchitectureInteriorLiveInspector lang="en" projectId="project-1" />);
    await waitFor(() => expect(screen.getByTestId('architecture-interior-live-selection')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('architecture-interior-live-selection'), { target: { value: 'interior:furniture:furniture-1' } });
    fireEvent.change(await screen.findByLabelText('positionMm 1'), { target: { value: '2200' } });
    fireEvent.click(screen.getByTestId('architecture-interior-apply-positionMm'));
    await waitFor(() => expect(screen.getByText('The server workspace could not be loaded.', { exact: true })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(screen.queryByTestId('architecture-interior-inspector-saved')).not.toBeInTheDocument();
  });

  it('rejects a reconnect payload refused by the authoritative workspace validator', async () => {
    workspaceMocks.validate.mockReturnValueOnce(['artifact_graph_revision_mismatch']);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, session: { role: 'editor' }, workspace }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<ArchitectureInteriorLiveInspector lang="en" projectId="project-1" />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The server workspace could not be loaded.'));
    expect(screen.queryByTestId('architecture-interior-live-selection')).not.toBeInTheDocument();
  });

  it('uses server canUndo/canRedo flags and completes the history approval handshake', async () => {
    const nextHistory = { ...historyState, revision: 3, contentHash: 'd'.repeat(64), canUndo: false, canRedo: true, undo: null, redo: { sequence: 2, commandId: 'command-1:undo:3' } };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method) return bodyFor(url, fetchMock.mock.calls.length > 4 ? nextHistory : historyState);
      const request = JSON.parse(String(init.body));
      if (!request.approved) return new Response(JSON.stringify({ ok: false, code: 'APPROVAL_REQUIRED', approval: { receiptHash: 'h'.repeat(32) } }), { status: 409 });
      return new Response(JSON.stringify({ ok: true, action: 'undo', workspace: appliedWorkspace, persistence: { revision: 3, contentHash: 'd'.repeat(64) }, event: { operation: 'undo' } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ArchitectureInteriorLiveInspector lang="en" projectId="project-1" />);
    await waitFor(() => expect(screen.getByTestId('architecture-interior-history-undo')).toBeEnabled());
    expect(screen.getByTestId('architecture-interior-history-redo')).toBeDisabled();
    fireEvent.click(screen.getByTestId('architecture-interior-history-undo'));
    await waitFor(() => expect(screen.getByTestId('architecture-interior-history-undo')).toBeDisabled());
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({ action: 'undo', expectedRevision: 2 });
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toMatchObject({ action: 'undo', approved: true, receiptHash: 'h'.repeat(32) });
    expect(screen.getByTestId('architecture-interior-history-redo')).toBeEnabled();
  });

  it('surfaces a history conflict without claiming a local undo', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method) return bodyFor(url, historyState);
      return new Response(JSON.stringify({ ok: false, code: 'REVISION_CONFLICT' }), { status: 409 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ArchitectureInteriorLiveInspector lang="en" projectId="project-1" />);
    await waitFor(() => expect(screen.getByTestId('architecture-interior-history-undo')).toBeEnabled());
    fireEvent.click(screen.getByTestId('architecture-interior-history-undo'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('workspace changed'));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fails closed on an invalid history response', async () => {
    const fetchMock = vi.fn(async (url: string) => bodyFor(url, url.includes('architecture-interior-history') ? { ok: true, schema: 'nexyfab.architecture-interior-history.v1' } : historyState));
    vi.stubGlobal('fetch', fetchMock);
    render(<ArchitectureInteriorLiveInspector lang="en" projectId="project-1" />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('history response was invalid'));
    expect(screen.getByTestId('architecture-interior-history-undo')).toBeDisabled();
    expect(screen.getByTestId('architecture-interior-history-redo')).toBeDisabled();
  });

  it('refreshes authoritative workspace and history after reconnect', async () => {
    const refreshed = { ...historyState, canUndo: false, canRedo: true, undo: null, redo: { sequence: 2, commandId: 'redo-2' } };
    const fetchMock = vi.fn(async (url: string) => bodyFor(url, fetchMock.mock.calls.length > 2 ? refreshed : historyState));
    vi.stubGlobal('fetch', fetchMock);
    render(<ArchitectureInteriorLiveInspector lang="en" projectId="project-1" />);
    await waitFor(() => expect(screen.getByTestId('architecture-interior-history-undo')).toBeEnabled());
    await act(async () => { window.dispatchEvent(new CustomEvent('nexyfab:architecture-interior-workspace-changed', { detail: { projectId: 'project-1' } })); });
    await waitFor(() => expect(screen.getByTestId('architecture-interior-history-undo')).toBeDisabled());
    expect(screen.getByTestId('architecture-interior-history-redo')).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
