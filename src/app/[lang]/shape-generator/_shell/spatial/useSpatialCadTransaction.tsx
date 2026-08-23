'use client';

import { useCallback, useEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import {
  SPATIAL_CAD_COMMAND_SCHEMA,
  applySpatialCadCommand,
  createSpatialCadDocument,
  validateSpatialCadDocument,
  type SpatialCadCommand,
  type SpatialCadDocument,
  type SpatialCadDomain,
  type SpatialCadParameters,
} from '@/lib/cad/spatialCadCommand';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';
import { useAuthStore } from '@/hooks/useAuth';
import { createSpatialDocumentId } from '@/lib/ai/spatialDesignBriefBuilder';
import type { SpatialAiCandidateOperation } from '@/lib/ai/spatialAiCandidate';
import type { AiCandidateLock } from '@/lib/ai/aiCanonicalCandidate';
import { spatialCadLockScope } from '@/lib/cad/spatialCadLocks';
import { replaceManualEditProtectionLocks, type RuntimeDesignLock } from '../../ai/manualEditProtectionStore';

export const SPATIAL_CAD_TRANSACTION_EVENT = 'nexyfab:spatial-cad-transaction' as const;
export type SpatialServerValidation = 'NOT_RUN' | 'RUNNING' | 'VALIDATED' | 'AUTH_REQUIRED' | 'BLOCKED';

export interface SpatialCadTransactionUiState {
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
  local: 'READY' | 'COMMITTED' | 'BLOCKED';
  serverValidation: SpatialServerValidation;
  persistence: 'NOT_RUN' | 'RUNNING' | 'SAVED' | 'AUTH_REQUIRED' | 'CONFLICT' | 'BLOCKED';
  lastChangedPaths: string[];
  issues: string[];
}

let fallbackCommandSequence = 0;
const spatialLockRegistry = new Map<string, readonly AiCandidateLock[]>();

export function getSpatialCadLiveLocks(domain: SpatialCadDomain, documentId: string): readonly AiCandidateLock[] {
  return spatialLockRegistry.get(`${domain}:${documentId}`) ?? [];
}

export function publishSpatialCadLiveLocks(domain: SpatialCadDomain, documentId: string, locks: readonly AiCandidateLock[]): void {
  const snapshot = locks.map(lock => ({ ...lock, target: { ...lock.target } }));
  spatialLockRegistry.set(`${domain}:${documentId}`, snapshot);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nexyfab:spatial-cad-locks', { detail: { domain, documentId, locks: snapshot } }));
}

function commandId(domain: SpatialCadDomain): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  fallbackCommandSequence += 1;
  return `${domain}-${Date.now()}-${fallbackCommandSequence}`;
}

function toParameters(value: object): SpatialCadParameters {
  return structuredClone(value) as SpatialCadParameters;
}

function syncManualProtectionScope(projectId: string, domain: SpatialCadDomain, documentId: string, locks: readonly AiCandidateLock[]): boolean {
  const scope = spatialCadLockScope(projectId, domain, documentId);
  const runtimeLocks: Omit<RuntimeDesignLock, 'sessionId'>[] = [];
  for (const lock of locks) {
    const candidate = lock as AiCandidateLock & Partial<RuntimeDesignLock>;
    if (!candidate.id?.trim() || !candidate.target || !candidate.source || !candidate.reason || !candidate.createdAt
      || !['human', 'expert', 'authority'].includes(candidate.source) || !Number.isFinite(Date.parse(candidate.createdAt))) return false;
    runtimeLocks.push({ id: candidate.id, target: { ...candidate.target }, scope, source: candidate.source, reason: candidate.reason, createdAt: candidate.createdAt });
  }
  return replaceManualEditProtectionLocks(scope, runtimeLocks);
}

export function useSpatialCadTransaction<P extends object>(
  domain: SpatialCadDomain,
  initialParameters: P,
  options: { onRestore?: (parameters: P) => void } = {},
) {
  const token = useAuthStore(state => state.token);
  const sessionStatus = useAuthStore(state => state.sessionStatus);
  const authUserId = useAuthStore(state => state.user?.id ?? 'anonymous');
  const documentRef = useRef(createSpatialCadDocument(domain, toParameters(initialParameters)));
  const persistedRevision = useRef(-1);
  const persistedContentHash = useRef<string | null>(null);
  const documentId = useRef(createSpatialDocumentId(domain));
  const liveLocks = useRef<readonly AiCandidateLock[]>([]);
  const projectIdRef = useRef<string | null>(null);
  const manualScopeRef = useRef<string | null>(null);
  const hydrationKey = useRef('');
  const restoreRef = useRef(options.onRestore);
  restoreRef.current = options.onRestore;
  const undoStack = useRef<P[]>([]);
  const redoStack = useRef<P[]>([]);
  const requestSequence = useRef(0);
  const mounted = useRef(true);
  const [state, setState] = useState<SpatialCadTransactionUiState>({
    revision: 0,
    canUndo: false,
    canRedo: false,
    local: 'READY',
    serverValidation: 'NOT_RUN',
    persistence: 'NOT_RUN',
    lastChangedPaths: [],
    issues: [],
  });
  const [authoritativeLocks, setAuthoritativeLocks] = useState<readonly AiCandidateLock[]>([]);

  useEffect(() => {
    // React Strict Mode intentionally mounts, cleans up and remounts effects in
    // development. Re-arm this guard on every mount so completed requests do
    // not leave the visible transaction stuck at RUNNING.
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    documentRef.current = createSpatialCadDocument(domain, toParameters(initialParameters));
    persistedRevision.current = -1;
    persistedContentHash.current = null;
    documentId.current = createSpatialDocumentId(domain);
    liveLocks.current = [];
    publishSpatialCadLiveLocks(domain, documentId.current, []);
    projectIdRef.current = null;
    if (manualScopeRef.current) replaceManualEditProtectionLocks(manualScopeRef.current, []);
    manualScopeRef.current = null;
    setAuthoritativeLocks([]);
    hydrationKey.current = '';
    requestSequence.current += 1;
    undoStack.current = [];
    redoStack.current = [];
    setState({ revision: 0, canUndo: false, canRedo: false, local: 'READY', serverValidation: 'NOT_RUN', persistence: 'NOT_RUN', lastChangedPaths: [], issues: [] });
  // initialParameters intentionally seeds only a domain transition.
  // Parameter changes go through commit() and must not reset the revision.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  useEffect(() => {
    if (sessionStatus !== 'authenticated' || typeof window === 'undefined') {
      if (manualScopeRef.current) replaceManualEditProtectionLocks(manualScopeRef.current, []);
      manualScopeRef.current = null;
      projectIdRef.current = null;
      liveLocks.current = [];
      setAuthoritativeLocks([]);
      publishSpatialCadLiveLocks(domain, documentId.current, []);
      hydrationKey.current = '';
      return;
    }
    const query = new URLSearchParams(window.location.search);
    const projectId = query.get('project') ?? query.get('projectId');
    if (!projectId) return;
    projectIdRef.current = projectId;
    const key = `${authUserId}:${projectId}:${domain}`;
    if (hydrationKey.current === key) return;
    if (hydrationKey.current && manualScopeRef.current) replaceManualEditProtectionLocks(manualScopeRef.current, []);
    manualScopeRef.current = null;
    liveLocks.current = [];
    setAuthoritativeLocks([]);
    hydrationKey.current = key;
    const sequence = ++requestSequence.current;
    setState(current => ({ ...current, persistence: 'RUNNING' }));
    void fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/spatial-cad?domain=${domain}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }).then(async response => {
      const payload = await response.json().catch(() => null) as { draft?: { projectRevision?: number; document?: SpatialCadDocument; locks?: AiCandidateLock[]; documentId?: string; contentHash?: string } } | null;
      if (!mounted.current || sequence !== requestSequence.current) return;
      if (response.status === 404) {
        setState(current => ({ ...current, persistence: 'NOT_RUN' }));
        return;
      }
      const restored = payload?.draft?.document;
      if (!response.ok || !restored || restored.domain !== domain || validateSpatialCadDocument(restored).length) {
        setState(current => ({ ...current, persistence: response.status === 401 ? 'AUTH_REQUIRED' : 'BLOCKED', issues: response.status === 401 ? current.issues : [...current.issues, 'project_draft_restore_failed'] }));
        return;
      }
      if (!restoreRef.current) {
        setState(current => ({ ...current, persistence: 'CONFLICT', issues: [...current.issues, 'project_draft_restore_not_supported'] }));
        return;
      }
      documentRef.current = structuredClone(restored);
      undoStack.current = [];
      redoStack.current = [];
      persistedRevision.current = Number.isSafeInteger(payload?.draft?.projectRevision) ? payload!.draft!.projectRevision! : -1;
      persistedContentHash.current = typeof (payload?.draft as { contentHash?: unknown } | undefined)?.contentHash === 'string' ? (payload!.draft as { contentHash: string }).contentHash : null;
      documentId.current = typeof (payload?.draft as { documentId?: unknown } | undefined)?.documentId === 'string' ? (payload!.draft as { documentId: string }).documentId : documentId.current;
      liveLocks.current = Array.isArray((payload?.draft as { locks?: unknown } | undefined)?.locks) ? (payload!.draft as { locks: AiCandidateLock[] }).locks : [];
      setAuthoritativeLocks([...liveLocks.current]);
      publishSpatialCadLiveLocks(domain, documentId.current, liveLocks.current);
      const restoredScope = spatialCadLockScope(projectId, domain, documentId.current);
      if (syncManualProtectionScope(projectId, domain, documentId.current, liveLocks.current)) manualScopeRef.current = restoredScope;
      restoreRef.current(structuredClone(restored.parameters) as unknown as P);
      setState(current => ({ ...current, revision: restored.revision, canUndo: false, canRedo: false, local: 'READY', persistence: 'SAVED' }));
    }).catch(error => {
      if (!mounted.current || sequence !== requestSequence.current) return;
      setState(current => ({ ...current, persistence: 'BLOCKED', issues: [...current.issues, error instanceof Error ? error.message : 'project_draft_restore_failed'] }));
    });
  }, [authUserId, domain, sessionStatus, token]);

  const applyParameters = useCallback((nextParameters: P, actor: 'human' | 'ai' = 'human', historyAction: 'record' | 'undo' | 'redo' = 'record', skipServer = false): boolean => {
    const baseDocument = documentRef.current;
    const command: SpatialCadCommand = {
      schema: SPATIAL_CAD_COMMAND_SCHEMA,
      commandId: commandId(domain),
      domain,
      baseRevision: baseDocument.revision,
      actor,
      operation: { kind: 'replace_parameters', parameters: toParameters(nextParameters) },
    };
    const transaction = applySpatialCadCommand(baseDocument, command);
    if (!transaction.committed) {
      if (transaction.issues.length === 1 && transaction.issues[0] === 'no_effect') return false;
      setState(current => ({ ...current, local: 'BLOCKED', serverValidation: 'NOT_RUN', issues: transaction.issues }));
      return false;
    }

    if (historyAction === 'record') {
      undoStack.current.push(structuredClone(baseDocument.parameters) as unknown as P);
      if (undoStack.current.length > 100) undoStack.current.shift();
      redoStack.current = [];
    }
    documentRef.current = transaction.document;
    const sequence = ++requestSequence.current;
    setState({
      revision: transaction.document.revision,
      canUndo: undoStack.current.length > 0,
      canRedo: redoStack.current.length > 0,
      local: 'COMMITTED',
      serverValidation: 'RUNNING',
      persistence: 'NOT_RUN',
      lastChangedPaths: transaction.changedPaths,
      issues: [],
    });
    window.dispatchEvent(new CustomEvent(SPATIAL_CAD_TRANSACTION_EVENT, { detail: { domain, command, transaction, historyAction } }));

    if (skipServer) {
      restoreRef.current?.(structuredClone(nextParameters));
      setState(current => ({ ...current, serverValidation: 'VALIDATED', persistence: 'SAVED' }));
      return true;
    }

    if (sessionStatus === 'anonymous') {
      setState(current => ({ ...current, serverValidation: 'AUTH_REQUIRED', persistence: 'AUTH_REQUIRED' }));
      return true;
    }

    void fetch('/api/cad/v1/spatial/command/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ document: baseDocument, command }),
    }).then(async response => {
      const payload = await response.json().catch(() => null) as { ok?: boolean; transaction?: { document?: { revision?: number }; issues?: string[] } } | null;
      if (!mounted.current || sequence !== requestSequence.current) return;
      const valid = response.ok && payload?.ok === true && payload.transaction?.document?.revision === transaction.document.revision;
      setState(current => ({
        ...current,
        serverValidation: valid ? 'VALIDATED' : response.status === 401 ? 'AUTH_REQUIRED' : 'BLOCKED',
        persistence: response.status === 401 ? 'AUTH_REQUIRED' : current.persistence,
        issues: valid || response.status === 401 ? [] : payload?.transaction?.issues ?? [`server_command_${response.status}`],
      }));
      if (!valid || typeof window === 'undefined') return;
      const query = new URLSearchParams(window.location.search);
      const projectId = query.get('project') ?? query.get('projectId');
      if (!projectId) return;
      setState(current => ({ ...current, persistence: 'RUNNING' }));
      try {
        const persistResponse = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/spatial-cad`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ baseRevision: persistedRevision.current, document: transaction.document, documentId: documentId.current }),
        });
        const persistPayload = await persistResponse.json().catch(() => null) as { draft?: { projectRevision?: number; contentHash?: string; documentId?: string; locks?: AiCandidateLock[] }; code?: string; issues?: string[] } | null;
        if (!mounted.current || sequence !== requestSequence.current) return;
        if (persistResponse.ok && Number.isSafeInteger(persistPayload?.draft?.projectRevision)) {
          persistedRevision.current = persistPayload!.draft!.projectRevision!;
          persistedContentHash.current = typeof persistPayload?.draft?.contentHash === 'string' ? persistPayload.draft.contentHash : persistedContentHash.current;
          if (typeof persistPayload?.draft?.documentId === 'string') documentId.current = persistPayload.draft.documentId;
          if (Array.isArray(persistPayload?.draft?.locks)) { liveLocks.current = persistPayload.draft.locks; setAuthoritativeLocks([...liveLocks.current]); publishSpatialCadLiveLocks(domain, documentId.current, liveLocks.current); if (syncManualProtectionScope(projectId, domain, documentId.current, liveLocks.current)) manualScopeRef.current = spatialCadLockScope(projectId, domain, documentId.current); }
          setState(current => ({ ...current, persistence: 'SAVED' }));
        } else {
          const persistence = persistResponse.status === 401 ? 'AUTH_REQUIRED' : persistResponse.status === 409 ? 'CONFLICT' : 'BLOCKED';
          setState(current => ({ ...current, persistence, issues: [...current.issues, ...(persistPayload?.issues ?? [persistPayload?.code ?? `project_draft_${persistResponse.status}`])] }));
        }
      } catch (error) {
        if (!mounted.current || sequence !== requestSequence.current) return;
        setState(current => ({ ...current, persistence: 'BLOCKED', issues: [...current.issues, error instanceof Error ? error.message : 'project_draft_save_failed'] }));
      }
    }).catch(error => {
      if (!mounted.current || sequence !== requestSequence.current) return;
      setState(current => ({ ...current, serverValidation: 'BLOCKED', issues: [error instanceof Error ? error.message : 'server_command_failed'] }));
    });
    return true;
  }, [domain, sessionStatus, token]);

  const commit = useCallback((nextParameters: P, actor: 'human' | 'ai' = 'human') => (
    applyParameters(nextParameters, actor, 'record')
  ), [applyParameters]);

  const commitReviewed = useCallback(async (nextParameters: P, operation: SpatialAiCandidateOperation, metadata: { documentId: string; contentHash: string; locks: readonly AiCandidateLock[]; parameterPaths: readonly string[]; mode: 'new_design' | 'request_only_edit' }): Promise<boolean> => {
    const commitLocalReviewed = () => {
      const committed = applyParameters(nextParameters, 'ai', 'record');
      if (committed) restoreRef.current?.(structuredClone(nextParameters));
      return committed;
    };
    if (sessionStatus !== 'authenticated') return commitLocalReviewed();
    const projectId = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('project') ?? new URLSearchParams(window.location.search).get('projectId');
    if (!projectId) return commitLocalReviewed();
    if (persistedRevision.current < 0 || !persistedContentHash.current) {
      setState(current => ({ ...current, persistence: 'CONFLICT', issues: [...current.issues, 'project_draft_baseline_required'] }));
      return false;
    }
    if (metadata.contentHash !== persistedContentHash.current) {
      setState(current => ({ ...current, persistence: 'CONFLICT', issues: [...current.issues, 'local_project_hash_mismatch'] }));
      return false;
    }
    const base = structuredClone(documentRef.current);
    const command: SpatialCadCommand = { schema: SPATIAL_CAD_COMMAND_SCHEMA, commandId: `spatial-ai-${Date.now()}-${++fallbackCommandSequence}`, domain, baseRevision: base.revision, actor: 'ai', operation: operation.kind === 'set_parameter' ? { kind: 'set_parameter', key: operation.path, value: operation.value } : { kind: 'replace_parameters', parameters: operation.parameters } };
    const sequence = ++requestSequence.current;
    setState(current => ({ ...current, serverValidation: 'RUNNING', persistence: 'RUNNING', issues: [] }));
    try {
      // Empty is an authoritative snapshot too. Falling back to candidate-time
      // metadata would resurrect stale locks after an explicit release.
      const commandLocks = liveLocks.current;
      const response = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/spatial-cad/command`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ baseProjectRevision: persistedRevision.current, baseContentHash: persistedContentHash.current, documentId: documentId.current || metadata.documentId, locks: commandLocks, parameterPaths: metadata.parameterPaths, mode: metadata.mode, command }) });
      const payload = await response.json().catch(() => null) as { ok?: boolean; changedPaths?: string[]; draft?: { projectRevision?: number; contentHash?: string; document?: SpatialCadDocument; documentId?: string; locks?: AiCandidateLock[] } } | null;
      if (!mounted.current || sequence !== requestSequence.current) return false;
      if (!response.ok || payload?.ok !== true || !Number.isSafeInteger(payload.draft?.projectRevision)) {
        setState(current => ({ ...current, serverValidation: response.status === 401 ? 'AUTH_REQUIRED' : 'BLOCKED', persistence: response.status === 409 ? 'CONFLICT' : response.status === 401 ? 'AUTH_REQUIRED' : 'BLOCKED', issues: [...current.issues, `spatial_command_${response.status}`] }));
        return false;
      }
      const authoritativeDocument = payload.draft?.document;
      if (!authoritativeDocument || authoritativeDocument.domain !== domain || validateSpatialCadDocument(authoritativeDocument).length
        || authoritativeDocument.revision !== base.revision + 1) {
        setState(current => ({ ...current, serverValidation: 'BLOCKED', persistence: 'CONFLICT', issues: ['invalid_authoritative_spatial_document'] }));
        return false;
      }
      undoStack.current.push(structuredClone(base.parameters) as unknown as P);
      if (undoStack.current.length > 100) undoStack.current.shift();
      redoStack.current = [];
      documentRef.current = structuredClone(authoritativeDocument);
      restoreRef.current?.(structuredClone(authoritativeDocument.parameters) as unknown as P);
      persistedRevision.current = payload.draft!.projectRevision!;
      persistedContentHash.current = payload.draft!.contentHash ?? persistedContentHash.current;
      documentId.current = payload.draft?.documentId ?? documentId.current ?? metadata.documentId;
      liveLocks.current = Array.isArray(payload.draft?.locks) ? payload.draft!.locks! : commandLocks;
      setAuthoritativeLocks([...liveLocks.current]);
      publishSpatialCadLiveLocks(domain, documentId.current, liveLocks.current);
      if (syncManualProtectionScope(projectId, domain, documentId.current, liveLocks.current)) manualScopeRef.current = spatialCadLockScope(projectId, domain, documentId.current);
      const changedPaths = Array.isArray(payload.changedPaths) ? payload.changedPaths : [];
      setState({ revision: authoritativeDocument.revision, canUndo: true, canRedo: false, local: 'COMMITTED', serverValidation: 'VALIDATED', persistence: 'SAVED', lastChangedPaths: changedPaths, issues: [] });
      window.dispatchEvent(new CustomEvent(SPATIAL_CAD_TRANSACTION_EVENT, { detail: { domain, command, transaction: { committed: true, document: authoritativeDocument, changedPaths, issues: [] }, historyAction: 'record' } }));
      return true;
    } catch (error) {
      if (!mounted.current || sequence !== requestSequence.current) return false;
      setState(current => ({ ...current, serverValidation: 'BLOCKED', persistence: 'BLOCKED', issues: [...current.issues, error instanceof Error ? error.message : 'spatial_command_network_failed'] }));
      return false;
    }
  }, [applyParameters, domain, sessionStatus, token]);

  const releaseLocks = useCallback(async (lockIds: readonly string[]): Promise<boolean> => {
    if (sessionStatus !== 'authenticated' || !projectIdRef.current || persistedRevision.current < 0 || !persistedContentHash.current || !documentId.current || !lockIds.length) return false;
    const projectId = projectIdRef.current;
    const baseProjectRevision = persistedRevision.current;
    const baseContentHash = persistedContentHash.current;
    const baseDocumentId = documentId.current;
    const sequence = ++requestSequence.current;
    try {
      const response = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/spatial-cad`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'release_locks', domain, baseProjectRevision, baseContentHash, documentId: baseDocumentId, lockIds }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; draft?: { projectRevision?: number; locks?: AiCandidateLock[]; contentHash?: string; documentId?: string } } | null;
      const currentAuth = useAuthStore.getState();
      if (!mounted.current || sequence !== requestSequence.current || currentAuth.sessionStatus !== 'authenticated'
        || (currentAuth.user?.id ?? 'anonymous') !== authUserId || projectIdRef.current !== projectId
        || persistedRevision.current !== baseProjectRevision || persistedContentHash.current !== baseContentHash
        || documentId.current !== baseDocumentId) return false;
      if (!response.ok || payload?.ok !== true || payload.draft?.projectRevision !== baseProjectRevision + 1
        || payload.draft?.contentHash !== baseContentHash || payload.draft?.documentId !== baseDocumentId
        || !Array.isArray(payload.draft?.locks)) return false;
      if (!syncManualProtectionScope(projectId, domain, baseDocumentId, payload.draft.locks)) return false;
      persistedRevision.current = payload.draft!.projectRevision!;
      liveLocks.current = payload.draft!.locks!;
      setAuthoritativeLocks([...liveLocks.current]);
      publishSpatialCadLiveLocks(domain, baseDocumentId, liveLocks.current);
      manualScopeRef.current = spatialCadLockScope(projectId, domain, baseDocumentId);
      setState(current => ({ ...current, persistence: 'SAVED' }));
      return true;
    } catch { return false; }
  }, [authUserId, domain, sessionStatus, token]);

  const undo = useCallback((): boolean => {
    const target = undoStack.current.pop();
    if (!target) return false;
    const current = structuredClone(documentRef.current.parameters) as unknown as P;
    redoStack.current.push(current);
    const committed = applyParameters(target, 'human', 'undo');
    if (!committed) {
      redoStack.current.pop();
      undoStack.current.push(target);
      return false;
    }
    restoreRef.current?.(structuredClone(target));
    return true;
  }, [applyParameters]);

  const redo = useCallback((): boolean => {
    const target = redoStack.current.pop();
    if (!target) return false;
    const current = structuredClone(documentRef.current.parameters) as unknown as P;
    undoStack.current.push(current);
    const committed = applyParameters(target, 'human', 'redo');
    if (!committed) {
      undoStack.current.pop();
      redoStack.current.push(target);
      return false;
    }
    restoreRef.current?.(structuredClone(target));
    return true;
  }, [applyParameters]);

  const seed = useCallback((baseline: P, revision = 0, seededDocumentId?: string): boolean => {
    if (documentRef.current.revision !== 0 || undoStack.current.length > 0 || redoStack.current.length > 0) return false;
    if (!Number.isSafeInteger(revision) || revision < 0 || (seededDocumentId !== undefined && !seededDocumentId.trim())) return false;
    documentRef.current = { ...createSpatialCadDocument(domain, toParameters(baseline)), revision };
    if (seededDocumentId) documentId.current = seededDocumentId;
    setState(current => ({ ...current, revision }));
    return true;
  }, [domain]);

  const lockScope = projectIdRef.current && documentId.current ? spatialCadLockScope(projectIdRef.current, domain, documentId.current) : 'local-workspace';
  return { state, commit, commitReviewed, undo, redo, seed, currentLocks: authoritativeLocks, currentDocumentId: documentId.current, lockScope, releaseLocks };
}

export function SpatialCadTransactionStatus({ state, lang, onUndo, onRedo, testId = 'spatial-transaction-status' }: { state: SpatialCadTransactionUiState; lang: string; onUndo?: () => boolean | Promise<boolean>; onRedo?: () => boolean | Promise<boolean>; testId?: string }) {
  const L = createCommercialLocalizer(lang);
  const server = state.serverValidation === 'VALIDATED'
      ? (L('서버 명령 검증됨', 'Server command validated'))
    : state.serverValidation === 'RUNNING'
      ? (L('서버 검증 중', 'Server validation running'))
      : state.serverValidation === 'AUTH_REQUIRED'
        ? (L('서버 검증 AUTH_REQUIRED', 'Server validation AUTH_REQUIRED'))
      : state.serverValidation === 'BLOCKED'
        ? (L('서버 검증 BLOCKED', 'Server validation BLOCKED'))
        : (L('서버 검증 NOT_RUN', 'Server validation NOT_RUN'));
  const persistence = state.persistence === 'SAVED'
    ? (L('프로젝트 초안 저장됨', 'Project draft saved'))
    : state.persistence === 'RUNNING'
      ? (L('프로젝트 초안 저장 중', 'Project draft saving'))
      : state.persistence === 'AUTH_REQUIRED'
        ? (L('프로젝트 저장 AUTH_REQUIRED', 'Project persistence AUTH_REQUIRED'))
        : state.persistence === 'CONFLICT'
          ? (L('프로젝트 저장 CONFLICT', 'Project persistence CONFLICT'))
          : state.persistence === 'BLOCKED'
            ? (L('프로젝트 저장 BLOCKED', 'Project persistence BLOCKED'))
            : (L('프로젝트 저장 NOT_RUN', 'Project persistence NOT_RUN'));
  return (
    <div data-testid={testId} aria-live="polite" style={{ marginTop: 8, padding: '7px 8px', border: '1px solid var(--nx-border)', borderRadius: 6, display: 'grid', gap: 3, fontSize: 9.5, color: 'var(--nx-text-2)' }}>
      <b style={{ color: 'var(--nx-text)' }}>{L(`로컬 의미 모델 r${state.revision}`, `Local semantic model r${state.revision}`)}</b>
      <span>{server}</span>
      <span>{persistence} · {L('출시 검증 NOT_RUN', 'release verification NOT_RUN')}</span>
      {(onUndo || onRedo) && (
        <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
          {onUndo && <button type="button" data-testid="spatial-undo" disabled={!state.canUndo} onClick={() => onUndo()} style={{ minHeight: 24, padding: '0 8px', border: '1px solid var(--nx-border)', borderRadius: 4, background: 'var(--nx-panel-2)', color: 'var(--nx-text)', fontSize: 9.5, cursor: state.canUndo ? 'pointer' : 'not-allowed', opacity: state.canUndo ? 1 : .45 }}>↶ {L('실행 취소', 'Undo')}</button>}
          {onRedo && <button type="button" data-testid="spatial-redo" disabled={!state.canRedo} onClick={() => onRedo()} style={{ minHeight: 24, padding: '0 8px', border: '1px solid var(--nx-border)', borderRadius: 4, background: 'var(--nx-panel-2)', color: 'var(--nx-text)', fontSize: 9.5, cursor: state.canRedo ? 'pointer' : 'not-allowed', opacity: state.canRedo ? 1 : .45 }}>↷ {L('다시 실행', 'Redo')}</button>}
        </div>
      )}
      {state.issues.length > 0 && <span style={{ color: 'var(--nx-danger, #dc2626)' }}>{state.issues.join(' · ')}</span>}
    </div>
  );
}

/**
 * Compatibility bridge for existing spatial editors while their individual
 * parameter panels are moved onto the typed document hook. Native input names
 * become explicit semantic parameter keys; no click is treated as a commit.
 */
export function SpatialCadTransactionMonitor({ domain, lang, children }: { domain: SpatialCadDomain; lang: string; children: ReactNode }) {
  const parameters = useRef<Record<string, string | number | boolean>>({});
  const restoreFormParameters = useCallback((restored: Record<string, string | number | boolean>) => {
    parameters.current = { ...restored };
    queueMicrotask(() => {
      const root = globalThis.document.querySelector<HTMLElement>(`[data-spatial-command-monitor="${domain}"]`);
      if (!root) return;
      const controls = Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input[name], select[name], textarea[name]'));
      for (const [name, value] of Object.entries(restored)) {
        const control = controls.find(item => item.name === name);
        if (!control) continue;
        if (control instanceof HTMLInputElement && control.type === 'checkbox') {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
          setter?.call(control, Boolean(value));
        } else {
          const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
          setter?.call(control, String(value));
        }
        control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
      }
    });
  }, [domain]);
  const { state, commit, seed, undo, redo } = useSpatialCadTransaction(domain, parameters.current, { onRestore: restoreFormParameters });
  useEffect(() => {
    const root = globalThis.document.querySelector<HTMLElement>(`[data-spatial-command-monitor="${domain}"]`);
    if (!root) return;
    const baseline: Record<string, string | number | boolean> = {};
    const controls = Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input[name], select[name], textarea[name]'));
    for (const control of controls) {
      if (control instanceof HTMLInputElement && control.type === 'checkbox') baseline[control.name] = control.checked;
      else if (control instanceof HTMLInputElement && control.type === 'number') baseline[control.name] = control.value.trim() === '' ? '' : Number(control.value);
      else baseline[control.name] = control.value;
    }
    parameters.current = baseline;
    seed(baseline);
  }, [domain, seed]);
  const onBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) || !target.name) return;
    const value = target instanceof HTMLInputElement && target.type === 'number'
      ? (target.value.trim() === '' ? '' : Number(target.value))
      : target instanceof HTMLInputElement && target.type === 'checkbox'
        ? target.checked
        : target.value;
    if (typeof value === 'number' && !Number.isFinite(value)) return;
    if (Object.is(parameters.current[target.name], value)) return;
    parameters.current = { ...parameters.current, [target.name]: value };
    commit(parameters.current);
  };
  return (
    <div data-spatial-command-monitor={domain} onBlurCapture={onBlurCapture} style={{ width: '100%', height: '100%', minHeight: 0, display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
      <div style={{ padding: '0 8px 6px', background: 'var(--nx-bg)' }}>
        <SpatialCadTransactionStatus state={state} lang={lang} onUndo={undo} onRedo={redo} />
      </div>
      <div style={{ minHeight: 0 }}>{children}</div>
    </div>
  );
}
