'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/hooks/useAuth';
import {
  commitInteriorPlacementOperation,
  hashInteriorPlacementDocument,
  previewInteriorPlacementMove,
  redoInteriorPlacement,
  undoInteriorPlacement,
  type InteriorPlacementHistory,
  type InteriorPlacementOperation,
} from '@/lib/cad/interiorPlacementTransaction';
import { createInteriorPlacementDocument, validateInteriorPlacementDocument, type InteriorPlacementDocument, type InteriorPlacementObject, type Vec3Mm } from '@/lib/cad/interiorPlacementDocument';
import type { SpatialCadLockDto } from '@/lib/cad/spatialCadLocks';
import { guardInteriorPlacementAiCandidate, type InteriorPlacementAiCandidate } from '@/lib/ai/interiorPlacementAiCandidate';

export interface InteriorPlacementTransactionState {
  revision: number;
  projectRevision: number;
  canUndo: boolean;
  canRedo: boolean;
  local: 'READY' | 'COMMITTED' | 'BLOCKED';
  persistence: 'NOT_RUN' | 'RUNNING' | 'SAVED' | 'AUTH_REQUIRED' | 'CONFLICT' | 'BLOCKED';
  lastChangedObjectIds: string[];
  issues: string[];
}

export interface InteriorPlacementBasis {
  roomDocumentId: string;
  roomSizeMm: Vec3Mm;
}

export interface InteriorPlacementTransactionOptions {
  onRestore?: (document: InteriorPlacementDocument) => void;
  roomBasis?: InteriorPlacementBasis;
  projectId?: string | null;
}

interface DraftResponse {
  projectId?: string;
  documentId?: string;
  roomDocumentId?: string;
  projectRevision?: number;
  contentHash?: string;
  document?: InteriorPlacementDocument;
  locks?: SpatialCadLockDto[];
  savedAt?: number;
}

interface DraftEnvelope { ok?: boolean; draft?: DraftResponse; code?: string; issues?: string[]; changedObjectIds?: string[] }

const clone = <T,>(value: T): T => structuredClone(value);
let localSequence = 0;

function newObjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  localSequence += 1;
  return `interior-object-${Date.now()}-${localSequence}`;
}

function projectFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const query = new URLSearchParams(window.location.search);
  return query.get('project') ?? query.get('projectId');
}

function sameBasis(document: InteriorPlacementDocument, basis?: InteriorPlacementBasis): boolean {
  return !basis || (document.roomDocumentId === basis.roomDocumentId && basis.roomSizeMm.every((value, index) => value === document.roomSizeMm[index]));
}

function emptyHistory(): InteriorPlacementHistory { return { past: [], future: [] }; }

export function useInteriorPlacementTransaction(
  initialDocument: InteriorPlacementDocument,
  options: InteriorPlacementTransactionOptions = {},
) {
  const token = useAuthStore(state => state.token);
  const sessionStatus = useAuthStore(state => state.sessionStatus);
  const authUserId = useAuthStore(state => state.user?.id ?? 'anonymous');
  const scopedProjectId = options.projectId === undefined ? projectFromLocation() : options.projectId;
  const initialSeedRef = useRef(clone(initialDocument));
  const documentRef = useRef(clone(initialDocument));
  const historyRef = useRef<InteriorPlacementHistory>(emptyHistory());
  const projectRevisionRef = useRef(-1);
  const contentHashRef = useRef<string | null>(null);
  const locksRef = useRef<SpatialCadLockDto[]>([]);
  const requestSequence = useRef(0);
  const hydrationKeyRef = useRef('');
  const mounted = useRef(true);
  const restoreRef = useRef(options.onRestore);
  restoreRef.current = options.onRestore;
  const basisRef = useRef(options.roomBasis);
  basisRef.current = options.roomBasis;
  const [document, setDocument] = useState(() => clone(initialDocument));
  const [locks, setLocks] = useState<readonly SpatialCadLockDto[]>([]);
  const [state, setState] = useState<InteriorPlacementTransactionState>({ revision: initialDocument.revision, projectRevision: -1, canUndo: false, canRedo: false, local: 'READY', persistence: 'NOT_RUN', lastChangedObjectIds: [], issues: [] });

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestSequence.current += 1; }; }, []);

  const adopt = useCallback((next: InteriorPlacementDocument, nextProjectRevision: number, nextLocks: SpatialCadLockDto[], history: InteriorPlacementHistory, changedObjectIds: string[], persistence: InteriorPlacementTransactionState['persistence']) => {
    documentRef.current = clone(next);
    projectRevisionRef.current = nextProjectRevision;
    contentHashRef.current = hashInteriorPlacementDocument(next);
    locksRef.current = clone(nextLocks);
    historyRef.current = { past: clone(history.past), future: clone(history.future) };
    setDocument(clone(next));
    setLocks(clone(nextLocks));
    setState(current => ({ ...current, revision: next.revision, projectRevision: nextProjectRevision, canUndo: history.past.length > 0, canRedo: history.future.length > 0, local: 'COMMITTED', persistence, lastChangedObjectIds: [...changedObjectIds], issues: [] }));
    restoreRef.current?.(clone(next));
  }, []);

  useEffect(() => {
    if (sessionStatus !== 'authenticated') {
      requestSequence.current += 1;
      hydrationKeyRef.current = '';
      documentRef.current = clone(initialSeedRef.current);
      historyRef.current = emptyHistory();
      projectRevisionRef.current = -1;
      contentHashRef.current = null;
      locksRef.current = [];
      setDocument(clone(initialSeedRef.current));
      setLocks([]);
      setState({ revision: initialSeedRef.current.revision, projectRevision: -1, canUndo: false, canRedo: false, local: 'READY', persistence: sessionStatus === 'anonymous' ? 'NOT_RUN' : 'AUTH_REQUIRED', lastChangedObjectIds: [], issues: [] });
      return;
    }
    const projectId = scopedProjectId;
    if (!projectId) return;
    const hydrationKey = `${authUserId}:${projectId}:${initialSeedRef.current.documentId}`;
    if (hydrationKeyRef.current === hydrationKey) return;
    hydrationKeyRef.current = hydrationKey;
    documentRef.current = clone(initialSeedRef.current);
    historyRef.current = emptyHistory();
    projectRevisionRef.current = -1;
    contentHashRef.current = null;
    locksRef.current = [];
    setDocument(clone(initialSeedRef.current));
    setLocks([]);
    const sequence = ++requestSequence.current;
    const documentId = documentRef.current.documentId;
    setState(current => ({ ...current, persistence: 'RUNNING', issues: [] }));
    void fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/interior-placement?documentId=${encodeURIComponent(documentId)}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: 'no-store' }).then(async response => {
      const payload = await response.json().catch(() => null) as DraftEnvelope | null;
      const auth = useAuthStore.getState();
      if (!mounted.current || sequence !== requestSequence.current || auth.sessionStatus !== 'authenticated' || (auth.user?.id ?? 'anonymous') !== authUserId || scopedProjectId !== projectId) return;
      if (response.status === 404) {
        projectRevisionRef.current = -1;
        contentHashRef.current = null;
        setState(current => ({ ...current, projectRevision: -1, persistence: 'NOT_RUN' }));
        return;
      }
      const draft = payload?.draft;
      if (!response.ok || !draft?.document || draft.document.documentId !== documentId || !sameBasis(draft.document, basisRef.current) || validateInteriorPlacementDocument(draft.document).length || !Number.isSafeInteger(draft.projectRevision)) {
        setState(current => ({ ...current, persistence: response.status === 409 ? 'CONFLICT' : 'BLOCKED', issues: !draft?.document || sameBasis(draft.document, basisRef.current) ? payload?.issues ?? ['placement_restore_failed'] : ['room_basis_stale'] }));
        return;
      }
      const nextLocks = Array.isArray(draft.locks) ? draft.locks : [];
      const nextHash = hashInteriorPlacementDocument(draft.document);
      if (draft.contentHash && draft.contentHash !== nextHash) {
        setState(current => ({ ...current, persistence: 'CONFLICT', issues: ['placement_restore_hash_mismatch'] }));
        return;
      }
      adopt(draft.document, draft.projectRevision!, nextLocks, emptyHistory(), [], 'SAVED');
    }).catch(error => {
      if (!mounted.current || sequence !== requestSequence.current) return;
      setState(current => ({ ...current, persistence: 'BLOCKED', issues: [error instanceof Error ? error.message : 'placement_restore_failed'] }));
    });
  }, [adopt, authUserId, scopedProjectId, sessionStatus, token]);

  const basisGuard = useCallback((): boolean => {
    if (sameBasis(documentRef.current, basisRef.current)) return true;
    setState(current => ({ ...current, local: 'BLOCKED', issues: ['room_basis_stale'] }));
    return false;
  }, []);

  const localCommit = useCallback((operation: InteriorPlacementOperation, historyAction: 'record' | 'undo' | 'redo' = 'record'): boolean => {
    if (!basisGuard()) return false;
    const result = commitInteriorPlacementOperation(documentRef.current, operation, historyRef.current);
    if (!result.committed) {
      setState(current => ({ ...current, local: 'BLOCKED', issues: result.issues }));
      return false;
    }
    adopt(result.document, projectRevisionRef.current, locksRef.current, result.history, result.changedObjectIds, sessionStatus === 'anonymous' ? 'AUTH_REQUIRED' : 'NOT_RUN');
    void historyAction;
    return true;
  }, [adopt, basisGuard, sessionStatus]);

  const commit = useCallback(async (rawOperation: InteriorPlacementOperation): Promise<boolean> => {
    // Generate/normalize identity before either the local reducer or the
    // request. Retries therefore cannot create a second object identity.
    const operation: InteriorPlacementOperation = rawOperation.kind === 'add_object' && !rawOperation.object.id.trim()
      ? { ...rawOperation, object: { ...rawOperation.object, id: newObjectId() } }
      : clone(rawOperation);
    if (!basisGuard()) return false;
    if (sessionStatus !== 'authenticated') return localCommit(operation);
    const projectId = scopedProjectId;
    if (!projectId) return localCommit(operation);
    const base = clone(documentRef.current);
    let baseProjectRevision = projectRevisionRef.current;
    const sequence = ++requestSequence.current;
    setState(current => ({ ...current, persistence: 'RUNNING', issues: [] }));
    try {
      const stillCurrent = () => {
        const auth = useAuthStore.getState();
        return mounted.current && sequence === requestSequence.current && auth.sessionStatus === 'authenticated'
          && (auth.user?.id ?? 'anonymous') === authUserId && scopedProjectId === projectId && documentRef.current.documentId === base.documentId;
      };
      if (baseProjectRevision < 0) {
        const baselineResponse = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/interior-placement`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'commit', documentId: base.documentId, roomDocumentId: base.roomDocumentId, baseProjectRevision: -1, operation: { kind: 'reset_layout', objects: base.objects }, document: base }) });
        const baselinePayload = await baselineResponse.json().catch(() => null) as DraftEnvelope | null;
        if (!stillCurrent()) return false;
        const baseline = baselinePayload?.draft;
        const baselineHash = hashInteriorPlacementDocument(base);
        if (!baselineResponse.ok || !baselinePayload?.ok || !baseline?.document || baseline.projectRevision !== 0 || baseline.document.revision !== base.revision
          || baseline.documentId !== base.documentId || baseline.roomDocumentId !== base.roomDocumentId || baseline.contentHash !== baselineHash
          || hashInteriorPlacementDocument(baseline.document) !== baselineHash || !Array.isArray(baseline.locks)) {
          setState(current => ({ ...current, persistence: baselineResponse.status === 409 ? 'CONFLICT' : baselineResponse.status === 401 ? 'AUTH_REQUIRED' : 'BLOCKED', issues: baselinePayload?.issues ?? [baselinePayload?.code ?? `placement_baseline_${baselineResponse.status}`] }));
          return false;
        }
        baseProjectRevision = 0;
        adopt(base, 0, baseline.locks, historyRef.current, [], 'SAVED');
        setState(current => ({ ...current, persistence: 'RUNNING' }));
      }
      const body: Record<string, unknown> = { action: 'commit', documentId: base.documentId, roomDocumentId: base.roomDocumentId, baseProjectRevision, operation };
      const response = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/interior-placement`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => null) as DraftEnvelope | null;
      if (!stillCurrent()) return false;
      const draft = payload?.draft;
      const authoritativeHash = draft?.document ? hashInteriorPlacementDocument(draft.document) : null;
      if (!response.ok || !payload?.ok || !draft?.document || draft.document.documentId !== base.documentId || draft.roomDocumentId !== base.roomDocumentId
        || !sameBasis(draft.document, basisRef.current) || validateInteriorPlacementDocument(draft.document).length || draft.projectRevision !== baseProjectRevision + 1
        || draft.document.revision !== base.revision + 1 || draft.contentHash !== authoritativeHash || !Array.isArray(draft.locks)) {
        setState(current => ({ ...current, persistence: response.status === 409 ? 'CONFLICT' : response.status === 401 ? 'AUTH_REQUIRED' : 'BLOCKED', issues: payload?.issues ?? [payload?.code ?? `placement_commit_${response.status}`] }));
        return false;
      }
      const nextHistory = { past: [...historyRef.current.past, base].slice(-100), future: [] };
      adopt(draft.document, draft.projectRevision!, Array.isArray(draft.locks) ? draft.locks : [], nextHistory, Array.isArray(payload.changedObjectIds) ? payload.changedObjectIds : [], 'SAVED');
      return true;
    } catch (error) {
      if (!mounted.current || sequence !== requestSequence.current) return false;
      setState(current => ({ ...current, persistence: 'BLOCKED', issues: [error instanceof Error ? error.message : 'placement_commit_failed'] }));
      return false;
    }
  }, [adopt, authUserId, basisGuard, localCommit, scopedProjectId, sessionStatus, token]);

  const addObject = useCallback((object: Omit<InteriorPlacementObject, 'id'> & { id?: string }) => commit({ kind: 'add_object', object: { ...object, id: object.id?.trim() || newObjectId() } }), [commit]);
  const moveObject = useCallback((objectId: string, positionMm: Vec3Mm, rotationDeg?: Vec3Mm) => commit({ kind: 'move_object', objectId, positionMm, rotationDeg }), [commit]);
  const deleteObject = useCallback((objectId: string) => commit({ kind: 'delete_object', objectId }), [commit]);
  const updateObject = useCallback((objectId: string, changes: Partial<Pick<InteriorPlacementObject, 'pose' | 'dimensionsMm' | 'clearanceMm'>>) => commit({ kind: 'update_object', objectId, changes }), [commit]);
  const resetLayout = useCallback((objects: readonly InteriorPlacementObject[]) => commit({ kind: 'reset_layout', objects }), [commit]);
  const previewMove = useCallback((objectId: string, positionMm: Vec3Mm, rotationDeg?: Vec3Mm) => {
    if (!basisGuard()) return documentRef.current;
    return previewInteriorPlacementMove(documentRef.current, objectId, positionMm, rotationDeg);
  }, [basisGuard]);

  const historyCommit = useCallback(async (kind: 'undo' | 'redo'): Promise<boolean> => {
    if (!basisGuard()) return false;
    if (sessionStatus !== 'authenticated' || !scopedProjectId) {
      const result = kind === 'undo' ? undoInteriorPlacement(documentRef.current, historyRef.current) : redoInteriorPlacement(documentRef.current, historyRef.current);
      if (result.document === documentRef.current || result.document.revision === documentRef.current.revision) return false;
      adopt(result.document, projectRevisionRef.current, locksRef.current, result.history, [], sessionStatus === 'anonymous' ? 'AUTH_REQUIRED' : 'NOT_RUN');
      return true;
    }
    const source = clone(documentRef.current);
    const priorHistory = { past: clone(historyRef.current.past), future: clone(historyRef.current.future) };
    const target = kind === 'undo' ? priorHistory.past.at(-1) : priorHistory.future[0];
    if (!target) return false;
    const result = await commit({ kind: 'reset_layout', objects: target.objects });
    if (!result) return false;
    // commit() records the source as a normal past entry. Replace that entry
    // with true undo/redo stacks after authoritative success.
    const past = kind === 'undo' ? priorHistory.past.slice(0, -1) : [...priorHistory.past, source];
    const future = kind === 'undo' ? [source, ...priorHistory.future] : priorHistory.future.slice(1);
    historyRef.current = { past, future };
    setState(current => ({ ...current, canUndo: past.length > 0, canRedo: future.length > 0 }));
    return true;
  }, [adopt, basisGuard, commit, scopedProjectId, sessionStatus]);

  const releaseLocks = useCallback(async (lockIds: readonly string[]): Promise<boolean> => {
    if (sessionStatus !== 'authenticated' || !lockIds.length || projectRevisionRef.current < 0 || !contentHashRef.current) return false;
    const projectId = scopedProjectId; if (!projectId) return false;
    const sequence = ++requestSequence.current;
    const baseRevision = projectRevisionRef.current; const baseHash = contentHashRef.current; const baseDocument = documentRef.current.documentId;
    try {
      const response = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/interior-placement`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'release_locks', documentId: baseDocument, baseProjectRevision: baseRevision, baseContentHash: baseHash, lockIds }) });
      const payload = await response.json().catch(() => null) as DraftEnvelope | null;
      const auth = useAuthStore.getState();
      if (!mounted.current || sequence !== requestSequence.current || auth.sessionStatus !== 'authenticated'
        || (auth.user?.id ?? 'anonymous') !== authUserId || scopedProjectId !== projectId || documentRef.current.documentId !== baseDocument
        || projectRevisionRef.current !== baseRevision || contentHashRef.current !== baseHash) return false;
      const draft = payload?.draft;
      if (!response.ok || !payload?.ok || !draft || draft.projectRevision !== baseRevision + 1 || draft.documentId !== baseDocument || draft.contentHash !== baseHash || !Array.isArray(draft.locks)) return false;
      projectRevisionRef.current = draft.projectRevision;
      locksRef.current = clone(draft.locks);
      setLocks(clone(draft.locks));
      setState(current => ({ ...current, projectRevision: draft.projectRevision!, persistence: 'SAVED' }));
      return true;
    } catch { return false; }
  }, [authUserId, scopedProjectId, sessionStatus, token]);

  /** Apply only a reviewed placement patch. Authenticated projects are server-first;
   * a rejected command leaves the reviewed candidate and local history untouched. */
  const commitReviewedCandidate = useCallback(async (candidate: InteriorPlacementAiCandidate, selectedObjectId: string | null): Promise<boolean> => {
    if (sessionStatus !== 'authenticated' || !scopedProjectId || !token) {
      setState(current => ({ ...current, persistence: 'AUTH_REQUIRED', local: 'BLOCKED', issues: ['placement_ai_auth_required'] }));
      return false;
    }
    const current = clone(documentRef.current);
    const currentHash = contentHashRef.current ?? hashInteriorPlacementDocument(current);
    const currentProjectRevision = projectRevisionRef.current;
    const selectedObject = current.objects.find(object => object.id === selectedObjectId);
    const currentLocks = locksRef.current.map(lock => ({ id: lock.id, target: { ...lock.target } }));
    const guardIssues = guardInteriorPlacementAiCandidate({ candidate, currentDocumentId: current.documentId, currentRoomDocumentId: current.roomDocumentId, currentRevision: current.revision, currentProjectRevision, currentContentHash: currentHash, selectedObjectId, currentObject: selectedObject, currentLocks });
    if (guardIssues.length || currentProjectRevision < 0 || !contentHashRef.current) {
      setState(state => ({ ...state, persistence: 'CONFLICT', local: 'BLOCKED', issues: guardIssues.length ? guardIssues : ['placement_ai_baseline_required'] }));
      return false;
    }
    const expected = commitInteriorPlacementOperation(current, candidate.operation, { past: [], future: [] }, {
      baseRevision: current.revision,
      baseContentHash: currentHash,
      currentContentHash: currentHash,
      selectedObjectId: selectedObjectId ?? undefined,
      parameterPaths: candidate.parameterPaths,
      locks: currentLocks,
    });
    if (!expected.committed) {
      setState(state => ({ ...state, persistence: 'CONFLICT', local: 'BLOCKED', issues: expected.issues }));
      return false;
    }
    const expectedHash = hashInteriorPlacementDocument(expected.document);
    const projectId = scopedProjectId;
    const sequence = ++requestSequence.current;
    setState(state => ({ ...state, persistence: 'RUNNING', issues: [] }));
    try {
      const response = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/interior-placement/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ documentId: current.documentId, roomDocumentId: current.roomDocumentId, baseProjectRevision: currentProjectRevision, baseContentHash: currentHash, selectedObjectId: candidate.selectedObjectId, parameterPaths: candidate.parameterPaths, locks: currentLocks, operation: candidate.operation }),
      });
      const payload = await response.json().catch(() => null) as DraftEnvelope | null;
      const auth = useAuthStore.getState();
      if (!mounted.current || sequence !== requestSequence.current || auth.sessionStatus !== 'authenticated' || (auth.user?.id ?? 'anonymous') !== authUserId || scopedProjectId !== projectId || documentRef.current.documentId !== current.documentId || documentRef.current.revision !== current.revision || projectRevisionRef.current !== currentProjectRevision || contentHashRef.current !== currentHash) return false;
      const draft = payload?.draft;
      const authoritativeHash = draft?.document ? hashInteriorPlacementDocument(draft.document) : null;
      const changedObjectIds = Array.isArray(payload?.changedObjectIds) ? payload.changedObjectIds : [];
      const authoritativeDraftLocks = Array.isArray(draft?.locks) ? draft.locks : null;
      const authoritativeLocks = authoritativeDraftLocks?.map(lock => ({ id: lock.id, target: lock.target })).sort((left, right) => left.id.localeCompare(right.id)) ?? null;
      const expectedLocks = currentLocks.map(lock => ({ id: lock.id, target: lock.target })).sort((left, right) => left.id.localeCompare(right.id));
      if (!response.ok || !payload?.ok || !draft?.document || draft.document.documentId !== current.documentId || draft.document.roomDocumentId !== current.roomDocumentId || draft.document.revision !== current.revision + 1 || draft.projectRevision !== currentProjectRevision + 1 || draft.contentHash !== authoritativeHash || authoritativeHash !== expectedHash || !authoritativeDraftLocks || !authoritativeLocks || JSON.stringify(authoritativeLocks) !== JSON.stringify(expectedLocks) || changedObjectIds.length !== 1 || changedObjectIds[0] !== candidate.selectedObjectId || draft.document.objects.find(object => object.id === candidate.selectedObjectId)?.catalogType !== selectedObject?.catalogType || draft.document.objects.find(object => object.id === candidate.selectedObjectId)?.spaceId !== selectedObject?.spaceId) {
        setState(state => ({ ...state, persistence: response.status === 409 ? 'CONFLICT' : response.status === 401 ? 'AUTH_REQUIRED' : 'BLOCKED', issues: payload?.issues ?? [payload?.code ?? `placement_ai_commit_${response.status}`] }));
        return false;
      }
      const nextHistory = { past: [...historyRef.current.past, current].slice(-100), future: [] };
      adopt(draft.document, draft.projectRevision, authoritativeDraftLocks, nextHistory, changedObjectIds, 'SAVED');
      return true;
    } catch (error) {
      if (!mounted.current || sequence !== requestSequence.current) return false;
      setState(state => ({ ...state, persistence: 'BLOCKED', issues: [error instanceof Error ? error.message : 'placement_ai_commit_failed'] }));
      return false;
    }
  }, [adopt, authUserId, scopedProjectId, sessionStatus, token]);

  return { document, currentDocument: document, state, currentLocks: locks, currentDocumentId: document.documentId, projectRevision: projectRevisionRef.current, contentHash: contentHashRef.current, commit, commitReviewedCandidate, addObject, moveObject, deleteObject, updateObject, resetLayout, previewMove, undo: () => historyCommit('undo'), redo: () => historyCommit('redo'), releaseLocks };
}

export function createInteriorPlacementDocumentForRoom(input: { documentId: string; roomDocumentId: string; roomSizeMm: Vec3Mm; objects?: InteriorPlacementObject[] }): InteriorPlacementDocument {
  return createInteriorPlacementDocument(input);
}
