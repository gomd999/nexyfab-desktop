// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/hooks/useAuth';
import { createInteriorPlacementDocument, type InteriorPlacementObject } from '@/lib/cad/interiorPlacementDocument';
import { hashInteriorPlacementDocument } from '@/lib/cad/interiorPlacementTransaction';
import { useInteriorPlacementTransaction } from './useInteriorPlacementTransaction';

const object = (id: string, x = 0): InteriorPlacementObject => ({
  id, catalogType: 'table4', spaceId: 'room-1',
  pose: { positionMm: [x, 0, 0], rotationDeg: [0, 0, 0] },
  dimensionsMm: [1_000, 600, 750], clearanceMm: [0, 0, 0],
});
const base = () => createInteriorPlacementDocument({ documentId: 'placement-1', roomDocumentId: 'room-1', roomSizeMm: [10_000, 8_000, 3_000], objects: [object('table-1')] });

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  useAuthStore.setState({ user: null, token: null, sessionStatus: 'anonymous' });
});
afterEach(() => vi.restoreAllMocks());

describe('useInteriorPlacementTransaction', () => {
  it('keeps preview at revision zero and commits one guest revision', async () => {
    const { result } = renderHook(() => useInteriorPlacementTransaction(base()));
    const before = result.current.currentDocument;
    act(() => {
      const preview = result.current.previewMove('table-1', [500, 400, 0]);
      expect(preview.revision).toBe(0);
      expect(preview.objects[0]?.pose.positionMm).toEqual([500, 400, 0]);
    });
    expect(result.current.state.revision).toBe(0);
    await act(async () => { expect(await result.current.moveObject('table-1', [500, 400, 0])).toBe(true); });
    expect(result.current.state.revision).toBe(1);
    expect(before.revision).toBe(0);
    expect(result.current.currentDocument.objects[0]?.pose.positionMm).toEqual([500, 400, 0]);
  });

  it('generates an add identity once and supports guest undo/redo', async () => {
    const { result } = renderHook(() => useInteriorPlacementTransaction(base()));
    await act(async () => { expect(await result.current.addObject({ catalogType: 'sofa', spaceId: 'room-1', pose: { positionMm: [2_000, 1_000, 0], rotationDeg: [0, 0, 0] }, dimensionsMm: [2_200, 900, 850], clearanceMm: [0, 0, 0] })).toBe(true); });
    const addedId = result.current.currentDocument.objects.at(-1)?.id;
    expect(addedId).toBeTruthy();
    await act(async () => { expect(await result.current.undo()).toBe(true); });
    expect(result.current.currentDocument.objects.some(item => item.id === addedId)).toBe(false);
    await act(async () => { expect(await result.current.redo()).toBe(true); });
    expect(result.current.currentDocument.objects.some(item => item.id === addedId)).toBe(true);
  });

  it('does not mutate document or history while an authenticated commit is rejected', async () => {
    window.history.replaceState({}, '', '/?project=project-1');
    useAuthStore.setState({ token: 'token', sessionStatus: 'authenticated' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (!init?.method) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      return new Response(JSON.stringify({ ok: false, code: 'REVISION_CONFLICT', issues: ['stale'] }), { status: 409 });
    });
    const { result } = renderHook(() => useInteriorPlacementTransaction(base()));
    await waitFor(() => expect(result.current.state.persistence).toBe('NOT_RUN'));
    const before = result.current.currentDocument;
    await act(async () => { expect(await result.current.moveObject('table-1', [500, 0, 0])).toBe(false); });
    expect(result.current.currentDocument).toEqual(before);
    expect(result.current.state.revision).toBe(0);
    expect(result.current.state.canUndo).toBe(false);
  });

  it('adopts one authoritative authenticated commit and release without changing document revision', async () => {
    window.history.replaceState({}, '', '/?project=project-1');
    useAuthStore.setState({ token: 'token', sessionStatus: 'authenticated' });
    const initial = base();
    const moved = { ...initial, revision: 1, objects: [{ ...initial.objects[0]!, pose: { ...initial.objects[0]!.pose, positionMm: [500, 0, 0] as [number, number, number] } }] };
    const hash = hashInteriorPlacementDocument(initial);
    const lock = { id: 'human:one', target: { kind: 'occurrence', objectId: 'table-1' }, scope: 'project:project-1:domain:interior:document:placement-1', source: 'human', reason: 'edit', createdAt: '2026-01-01T00:00:00.000Z' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (!init?.method) return new Response(JSON.stringify({ ok: true, draft: { projectRevision: 2, contentHash: hash, document: initial, documentId: initial.documentId, roomDocumentId: initial.roomDocumentId, locks: [lock] } }), { status: 200 });
      const body = JSON.parse(String(init.body)) as { action?: string };
      if (body.action === 'release_locks') return new Response(JSON.stringify({ ok: true, draft: { projectRevision: 4, contentHash: hashInteriorPlacementDocument(moved), document: moved, documentId: initial.documentId, roomDocumentId: initial.roomDocumentId, locks: [] } }), { status: 201 });
      return new Response(JSON.stringify({ ok: true, changedObjectIds: ['table-1'], draft: { projectRevision: 3, contentHash: hashInteriorPlacementDocument(moved), document: moved, documentId: moved.documentId, roomDocumentId: moved.roomDocumentId, locks: [lock] } }), { status: 201 });
    });
    const { result } = renderHook(() => useInteriorPlacementTransaction(base()));
    await waitFor(() => expect(result.current.state.persistence).toBe('SAVED'));
    await act(async () => { expect(await result.current.moveObject('table-1', [500, 0, 0])).toBe(true); });
    expect(result.current.state.revision).toBe(1);
    expect(result.current.state.projectRevision).toBe(3);
    await act(async () => { expect(await result.current.releaseLocks(['human:one'])).toBe(true); });
    expect(result.current.state.revision).toBe(1);
    expect(result.current.currentLocks).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('creates an exact baseline before the first authenticated object operation', async () => {
    window.history.replaceState({}, '', '/?project=project-1');
    useAuthStore.setState({ token: 'token', sessionStatus: 'authenticated' });
    const initial = base(); const requests: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (!init?.method) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      const body = JSON.parse(String(init.body)) as Record<string, unknown>; requests.push(body);
      if (requests.length === 1) return new Response(JSON.stringify({ ok: true, changedObjectIds: [], draft: { projectRevision: 0, contentHash: hashInteriorPlacementDocument(initial), document: initial, documentId: initial.documentId, roomDocumentId: initial.roomDocumentId, locks: [] } }), { status: 201 });
      const operation = body.operation as { object: InteriorPlacementObject };
      const next = { ...initial, revision: 1, objects: [...initial.objects, operation.object] };
      return new Response(JSON.stringify({ ok: true, changedObjectIds: [operation.object.id], draft: { projectRevision: 1, contentHash: hashInteriorPlacementDocument(next), document: next, documentId: next.documentId, roomDocumentId: next.roomDocumentId, locks: [] } }), { status: 201 });
    });
    const { result } = renderHook(() => useInteriorPlacementTransaction(base()));
    await waitFor(() => expect(result.current.state.persistence).toBe('NOT_RUN'));
    await act(async () => { expect(await result.current.addObject({ catalogType: 'table2', spaceId: 'room-1', pose: { positionMm: [1000, 0, 0], rotationDeg: [0, 0, 0] }, dimensionsMm: [700, 700, 750], clearanceMm: [0, 0, 0] })).toBe(true); });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ baseProjectRevision: -1, operation: { kind: 'reset_layout' }, document: { revision: 0 } });
    expect(requests[1]).toMatchObject({ baseProjectRevision: 0, operation: { kind: 'add_object' } });
    expect(result.current.state).toMatchObject({ revision: 1, projectRevision: 1, canUndo: true, persistence: 'SAVED' });
  });
});
