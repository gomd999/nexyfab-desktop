// @vitest-environment jsdom
import { useState } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpatialCadTransactionMonitor, useSpatialCadTransaction } from './useSpatialCadTransaction';
import { useAuthStore } from '@/hooks/useAuth';

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  useAuthStore.setState({ user: null, token: null, sessionStatus: 'anonymous' });
});
afterEach(() => vi.restoreAllMocks());

describe('useSpatialCadTransaction', () => {
  it('commits locally, validates on the server and never claims persistence', async () => {
    useAuthStore.setState({ token: 'test.token', sessionStatus: 'authenticated' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { document: { revision: number }; command: { operation: { parameters: object } } };
      return new Response(JSON.stringify({ ok: true, transaction: { document: { revision: body.document.revision + 1, parameters: body.command.operation.parameters } }, persistence: 'NOT_RUN' }), { status: 200 });
    });
    const { result } = renderHook(() => useSpatialCadTransaction('building', { width: 12_000 }));
    act(() => { expect(result.current.commit({ width: 13_500 })).toBe(true); });
    expect(result.current.state).toMatchObject({ revision: 1, local: 'COMMITTED', serverValidation: 'RUNNING', persistence: 'NOT_RUN' });
    await waitFor(() => expect(result.current.state.serverValidation).toBe('VALIDATED'));
    expect(result.current.state.persistence).toBe('NOT_RUN');
  });

  it('keeps a network failure visible as BLOCKED', async () => {
    useAuthStore.setState({ token: 'test.token', sessionStatus: 'authenticated' });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useSpatialCadTransaction('civil', { lengthM: 120 }));
    act(() => { result.current.commit({ lengthM: 140 }); });
    await waitFor(() => expect(result.current.state).toMatchObject({ revision: 1, serverValidation: 'BLOCKED', issues: ['offline'], persistence: 'NOT_RUN' }));
  });

  it('surfaces protected server replay as AUTH_REQUIRED instead of hanging at RUNNING', async () => {
    useAuthStore.setState({ token: 'expired.token', sessionStatus: 'authenticated' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401 }));
    const { result } = renderHook(() => useSpatialCadTransaction('coordination', { toleranceMm: 50 }));
    act(() => { result.current.commit({ toleranceMm: 75 }); });
    await waitFor(() => expect(result.current.state).toMatchObject({ revision: 1, serverValidation: 'AUTH_REQUIRED', persistence: 'AUTH_REQUIRED' }));
  });

  it('does not send a known-anonymous request to a protected endpoint', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    useAuthStore.setState({ user: null, token: null, sessionStatus: 'anonymous' });
    const { result } = renderHook(() => useSpatialCadTransaction('building', { width: 12_000 }));
    act(() => { result.current.commit({ width: 13_000 }); });
    expect(result.current.state).toMatchObject({ revision: 1, serverValidation: 'AUTH_REQUIRED', persistence: 'AUTH_REQUIRED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('records undo and redo as new immutable typed revisions', () => {
    const onRestore = vi.fn();
    const listener = vi.fn();
    window.addEventListener('nexyfab:spatial-cad-transaction', listener);
    const { result } = renderHook(() => useSpatialCadTransaction('building', { width: 12_000 }, { onRestore }));
    act(() => { expect(result.current.commit({ width: 13_000 })).toBe(true); });
    expect(result.current.state).toMatchObject({ revision: 1, canUndo: true, canRedo: false });

    act(() => { expect(result.current.undo()).toBe(true); });
    expect(result.current.state).toMatchObject({ revision: 2, canUndo: false, canRedo: true });
    expect(onRestore).toHaveBeenLastCalledWith({ width: 12_000 });

    act(() => { expect(result.current.redo()).toBe(true); });
    expect(result.current.state).toMatchObject({ revision: 3, canUndo: true, canRedo: false });
    expect(onRestore).toHaveBeenLastCalledWith({ width: 13_000 });
    expect((listener.mock.calls[1]?.[0] as CustomEvent).detail.historyAction).toBe('undo');
    expect((listener.mock.calls[2]?.[0] as CustomEvent).detail.historyAction).toBe('redo');
    window.removeEventListener('nexyfab:spatial-cad-transaction', listener);
  });

  it('restores the initial controlled field through the compatibility monitor undo control', async () => {
    function ControlledCivilField() {
      const [value, setValue] = useState(120);
      return <input name="civil-lengthM" aria-label="Alignment length" type="number" value={value} onChange={event => setValue(Number(event.target.value))}/>;
    }
    render(<SpatialCadTransactionMonitor domain="civil" lang="en"><ControlledCivilField/></SpatialCadTransactionMonitor>);
    const input = screen.getByRole('spinbutton', { name: 'Alignment length' });
    fireEvent.change(input, { target: { value: '150' } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByTestId('spatial-undo')).toBeEnabled());
    fireEvent.click(screen.getByTestId('spatial-undo'));
    await waitFor(() => expect(input).toHaveValue(120));
    expect(screen.getByTestId('spatial-redo')).toBeEnabled();
    expect(screen.getByTestId('spatial-transaction-status')).toHaveTextContent('Local semantic model r2');
  });

  it('persists a validated command when an editable project is in context', async () => {
    window.history.replaceState({}, '', '/?project=project-1');
    useAuthStore.setState({ token: 'test.token', sessionStatus: 'authenticated' });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (!init?.method && url.includes('/spatial-cad?domain=building')) return new Response(JSON.stringify({ error: 'Draft not found' }), { status: 404 });
      if (url === '/api/cad/v1/spatial/command/') {
        const body = JSON.parse(String(init?.body)) as { document: { revision: number } };
        return new Response(JSON.stringify({ ok: true, transaction: { document: { revision: body.document.revision + 1 } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, draft: { projectRevision: 0 } }), { status: 201 });
    });
    const { result } = renderHook(() => useSpatialCadTransaction('building', { width: 12_000 }, { onRestore: vi.fn() }));
    await waitFor(() => expect(result.current.state.persistence).toBe('NOT_RUN'));
    act(() => { result.current.commit({ width: 13_000 }); });
    await waitFor(() => expect(result.current.state).toMatchObject({ serverValidation: 'VALIDATED', persistence: 'SAVED' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/nexyfab/projects/project-1/spatial-cad', expect.objectContaining({ method: 'POST' }));
  });

  it('restores a persisted compatibility-workspace field into its controlled editor', async () => {
    window.history.replaceState({}, '', '/?project=project-1');
    useAuthStore.setState({ token: 'test.token', sessionStatus: 'authenticated' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      draft: {
        projectRevision: 3,
        document: { schema: 'nexyfab.spatial-cad-document.v1', domain: 'civil', revision: 2, parameters: { 'civil-lengthM': 150 }, verification: 'NOT_RUN', updatedBy: 'human' },
      },
    }), { status: 200 }));
    function ControlledCivilField() {
      const [value, setValue] = useState(120);
      return <input name="civil-lengthM" aria-label="Alignment length" type="number" value={value} onChange={event => setValue(Number(event.target.value))}/>;
    }
    render(<SpatialCadTransactionMonitor domain="civil" lang="en"><ControlledCivilField/></SpatialCadTransactionMonitor>);
    await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Alignment length' })).toHaveValue(150));
    expect(screen.getByTestId('spatial-transaction-status')).toHaveTextContent('Local semantic model r2');
    expect(screen.getByTestId('spatial-transaction-status')).toHaveTextContent('Project draft saved');
  });
});

describe('useSpatialCadTransaction reviewed server commit', () => {
  const baseDocument = { schema: 'nexyfab.spatial-cad-document.v1' as const, domain: 'building' as const, revision: 0, parameters: { width: 1000 }, verification: 'NOT_RUN' as const, updatedBy: 'human' as const };
  const metadata = { documentId: 'building-doc', contentHash: 'a'.repeat(64), locks: [], parameterPaths: ['width'], mode: 'request_only_edit' as const };

  it('keeps the local revision unchanged until authoritative success and adopts it once', async () => {
    window.history.replaceState({}, '', '/?project=project-1');
    useAuthStore.setState({ token: 'test.token', sessionStatus: 'authenticated' });
    let resolveCommand!: (value: Response) => void;
    const commandResponse = new Promise<Response>(resolve => { resolveCommand = resolve; });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (!init?.method) return new Response(JSON.stringify({ ok: true, draft: { projectRevision: 0, contentHash: metadata.contentHash, documentId: metadata.documentId, locks: [], document: baseDocument } }), { status: 200 });
      if (String(input).endsWith('/command')) return commandResponse;
      throw new Error(`unexpected request ${String(input)}`);
    });
    const onRestore = vi.fn();
    const { result } = renderHook(() => useSpatialCadTransaction('building', { width: 1000 }, { onRestore }));
    await waitFor(() => expect(result.current.state.persistence).toBe('SAVED'));
    onRestore.mockClear();
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.commitReviewed({ width: 1200 }, { kind: 'set_parameter', path: 'width', value: 1200 }, metadata); });
    expect(result.current.state.revision).toBe(0);
    await act(async () => {
      resolveCommand(new Response(JSON.stringify({ ok: true, changedPaths: ['parameters.width'], draft: { projectRevision: 1, contentHash: 'b'.repeat(64), document: { ...baseDocument, revision: 1, parameters: { width: 1200 }, updatedBy: 'ai' } } }), { status: 201 }));
      expect(await pending).toBe(true);
    });
    await waitFor(() => expect(result.current.state).toMatchObject({ revision: 1, canUndo: true, serverValidation: 'VALIDATED', persistence: 'SAVED' }));
    expect(onRestore).toHaveBeenCalledOnce();
    expect(onRestore).toHaveBeenCalledWith({ width: 1200 });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/command'))).toHaveLength(1);
  });

  it('preserves document and history when the authoritative request rejects', async () => {
    window.history.replaceState({}, '', '/?project=project-1');
    useAuthStore.setState({ token: 'test.token', sessionStatus: 'authenticated' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => !init?.method
      ? new Response(JSON.stringify({ ok: true, draft: { projectRevision: 0, contentHash: metadata.contentHash, documentId: metadata.documentId, locks: [], document: baseDocument } }), { status: 200 })
      : new Response(JSON.stringify({ ok: false, code: 'CONTENT_HASH_CONFLICT' }), { status: 409 }));
    const { result } = renderHook(() => useSpatialCadTransaction('building', { width: 1000 }, { onRestore: vi.fn() }));
    await waitFor(() => expect(result.current.state.persistence).toBe('SAVED'));
    await act(async () => { expect(await result.current.commitReviewed({ width: 1200 }, { kind: 'set_parameter', path: 'width', value: 1200 }, metadata)).toBe(false); });
    expect(result.current.state).toMatchObject({ revision: 0, canUndo: false, canRedo: false, serverValidation: 'BLOCKED', persistence: 'CONFLICT' });
  });

  it('retains the local guest workflow without a server request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const onRestore = vi.fn();
    const { result } = renderHook(() => useSpatialCadTransaction('building', { width: 1000 }, { onRestore }));
    await act(async () => { expect(await result.current.commitReviewed({ width: 1200 }, { kind: 'set_parameter', path: 'width', value: 1200 }, metadata)).toBe(true); });
    expect(result.current.state).toMatchObject({ revision: 1, canUndo: true, persistence: 'AUTH_REQUIRED' });
    expect(onRestore).toHaveBeenCalledWith({ width: 1200 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('releases authoritative locks without changing document revision or undo history', async () => {
    window.history.replaceState({}, '', '/?project=project-1');
    useAuthStore.setState({ token: 'test.token', sessionStatus: 'authenticated' });
    const lock = { id: 'human-width', target: { kind: 'parameter', objectId: 'building-doc', field: 'width' }, scope: 'project:project-1:domain:building:document:building-doc', source: 'human', reason: 'edit', createdAt: '2026-01-01T00:00:00.000Z' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (!init?.method) return new Response(JSON.stringify({ ok: true, draft: { projectRevision: 4, contentHash: metadata.contentHash, documentId: metadata.documentId, locks: [lock], document: baseDocument } }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, draft: { projectRevision: 5, contentHash: metadata.contentHash, documentId: metadata.documentId, locks: [], document: baseDocument } }), { status: 201 });
    });
    const { result } = renderHook(() => useSpatialCadTransaction('building', { width: 1000 }, { onRestore: vi.fn() }));
    await waitFor(() => expect(result.current.state.persistence).toBe('SAVED'));
    expect(result.current.state.revision).toBe(0);
    await act(async () => { expect(await result.current.releaseLocks(['human-width'])).toBe(true); });
    expect(result.current.state.revision).toBe(0);
    expect(result.current.state.canUndo).toBe(false);
    expect(result.current.currentLocks).toEqual([]);
    const body = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
    expect(body).toMatchObject({ action: 'release_locks', lockIds: ['human-width'] });
  });

  it('keeps locks and history unchanged on release conflict or network failure', async () => {
    window.history.replaceState({}, '', '/?project=project-1');
    useAuthStore.setState({ token: 'test.token', sessionStatus: 'authenticated' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (!init?.method) return new Response(JSON.stringify({ ok: true, draft: { projectRevision: 4, contentHash: metadata.contentHash, documentId: metadata.documentId, locks: [], document: baseDocument } }), { status: 200 });
      return new Response(JSON.stringify({ ok: false, code: 'REVISION_CONFLICT' }), { status: 409 });
    });
    const { result } = renderHook(() => useSpatialCadTransaction('building', { width: 1000 }, { onRestore: vi.fn() }));
    await waitFor(() => expect(result.current.state.persistence).toBe('SAVED'));
    const before = { revision: result.current.state.revision, canUndo: result.current.state.canUndo, locks: result.current.currentLocks };
    await act(async () => { expect(await result.current.releaseLocks(['missing'])).toBe(false); });
    expect(result.current.state.revision).toBe(before.revision);
    expect(result.current.state.canUndo).toBe(before.canUndo);
    expect(result.current.currentLocks).toEqual(before.locks);
  });

  it('keeps release state invariant on network failure', async () => {
    window.history.replaceState({}, '', '/?project=project-1');
    useAuthStore.setState({ token: 'test.token', sessionStatus: 'authenticated' });
    let restored = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (!init?.method) { restored = true; return new Response(JSON.stringify({ ok: true, draft: { projectRevision: 4, contentHash: metadata.contentHash, documentId: metadata.documentId, locks: [], document: baseDocument } }), { status: 200 }); }
      if (restored) throw new Error('offline');
      return new Response('{}', { status: 500 });
    });
    const { result } = renderHook(() => useSpatialCadTransaction('building', { width: 1000 }, { onRestore: vi.fn() }));
    await waitFor(() => expect(result.current.state.persistence).toBe('SAVED'));
    await act(async () => { expect(await result.current.releaseLocks(['missing'])).toBe(false); });
    expect(result.current.state.revision).toBe(0);
    expect(result.current.currentLocks).toEqual([]);
  });

  it('ignores an in-flight release response after logout', async () => {
    window.history.replaceState({}, '', '/?project=project-1');
    useAuthStore.setState({ user: { id: 'user-1', email: 'user@example.test', name: 'User', plan: 'free', projectCount: 0 }, token: 'test.token', sessionStatus: 'authenticated' });
    const lock = { id: 'human-width', target: { kind: 'parameter', objectId: 'building-doc', field: 'width' }, scope: 'project:project-1:domain:building:document:building-doc', source: 'human', reason: 'edit', createdAt: '2026-01-01T00:00:00.000Z' };
    let resolveRelease!: (value: Response) => void;
    const releaseResponse = new Promise<Response>(resolve => { resolveRelease = resolve; });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => !init?.method
      ? new Response(JSON.stringify({ ok: true, draft: { projectRevision: 4, contentHash: metadata.contentHash, documentId: metadata.documentId, locks: [lock], document: baseDocument } }), { status: 200 })
      : releaseResponse);
    const { result } = renderHook(() => useSpatialCadTransaction('building', { width: 1000 }, { onRestore: vi.fn() }));
    await waitFor(() => expect(result.current.currentLocks).toHaveLength(1));
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.releaseLocks(['human-width']); });
    act(() => { useAuthStore.setState({ user: null, token: null, sessionStatus: 'anonymous' }); });
    await act(async () => {
      resolveRelease(new Response(JSON.stringify({ ok: true, draft: { projectRevision: 5, contentHash: metadata.contentHash, documentId: metadata.documentId, locks: [] } }), { status: 201 }));
      expect(await pending).toBe(false);
    });
    expect(result.current.currentLocks).toEqual([]);
    expect(result.current.state.revision).toBe(0);
  });
});
