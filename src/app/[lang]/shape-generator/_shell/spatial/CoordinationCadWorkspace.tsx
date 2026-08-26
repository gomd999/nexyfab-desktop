'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  checkCoordinationCandidates,
  coordinationParameters,
  prepareExactClashJob,
  type CoordinationClashCandidate,
  type CoordinationDocument,
} from '@/lib/cad/coordinationSpatialModel';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';
import { SpatialCadTransactionStatus, useSpatialCadTransaction } from './useSpatialCadTransaction';
import { SPATIAL_CAD_COMMAND_EVENT, type SpatialCadCommandDetail } from './spatialCadCommands';
import { useAuthStore } from '@/hooks/useAuth';
import { SpatialPaneResizers } from './SpatialPaneResizers';
import { loc } from '@/lib/i18n/loc';

const BASE_DOCUMENT: CoordinationDocument = {
  schema: 'nexyfab.coordination.v1', revision: 0, activeCoordinateSystem: 'CRS_NOT_CONNECTED', toleranceMm: 50,
  models: [
    { id: 'architecture', discipline: 'architecture', revision: 'A', coordinateSystem: 'CRS_NOT_CONNECTED', offsetMm: [0, 0, 0], boundsMm: { min: [0, 0, 0], max: [12_000, 8000, 6400] }, geometryEvidence: 'concept_bounds' },
    { id: 'mep', discipline: 'mep', revision: 'A', coordinateSystem: 'CRS_NOT_CONNECTED', offsetMm: [0, 0, 0], boundsMm: { min: [5200, 3200, 2500], max: [6800, 4800, 3200] }, geometryEvidence: 'concept_bounds' },
    { id: 'interior', discipline: 'interior', revision: 'A', coordinateSystem: 'CRS_NOT_CONNECTED', offsetMm: [0, 0, 0], boundsMm: { min: [600, 600, 0], max: [11_400, 7400, 3000] }, geometryEvidence: 'concept_bounds' },
  ],
};

const input: React.CSSProperties = { width: '100%', height: 30, border: '1px solid var(--nx-border)', borderRadius: 5, background: 'var(--nx-panel-2)', color: 'var(--nx-text)', padding: '0 8px', fontSize: 11 };

interface CoordinationIssue {
  id: string;
  candidateId: string;
  modelRevision: number;
  status: 'OPEN' | 'RESOLVED';
  evidence: 'BOUNDS_PREVIEW';
  persistence: 'NOT_RUN' | 'RUNNING' | 'SAVED' | 'AUTH_REQUIRED' | 'CONFLICT' | 'BLOCKED';
  updatedAt?: number;
}

interface ExactRevisionSummary {
  artifactId: string;
  revision: number;
  domain: string;
  lineageId: string;
  geometryContentHash: string;
  shapeIdentityHash: string;
  kernelId: string;
}

type ExactJobUiState = {
  state: 'NOT_RUN' | 'BLOCKED' | 'AUTH_REQUIRED' | 'CONFLICT' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  execution: 'NOT_RUN' | 'RUNNING' | 'PASS' | 'FAIL';
  jobId?: string;
  issues: string[];
  cancelling?: boolean;
};

type ExactJobUsage = { active: number; limit: number };

const SHA256 = /^[a-f0-9]{64}$/;

// Keep retries for the same prepared request idempotent without importing a
// server-only hash implementation into this browser component. The server
// still hashes and compares the request payload before reusing a job.
async function exactClashIdempotencyKey(request: unknown): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(request)));
  const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  return `exact-clash-${sha256}`;
}

function parseExactJobUsage(value: unknown): ExactJobUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Number.isSafeInteger(record.active) && Number(record.active) >= 0
    && Number.isSafeInteger(record.limit) && Number(record.limit) > 0
    ? { active: Number(record.active), limit: Number(record.limit) }
    : null;
}

function parseExactJobState(status: unknown, execution: unknown): Pick<ExactJobUiState, 'state' | 'execution'> | null {
  if (status === 'QUEUED' && execution === 'NOT_RUN') return { state: 'QUEUED', execution: 'NOT_RUN' };
  if (status === 'RUNNING' && execution === 'RUNNING') return { state: 'RUNNING', execution: 'RUNNING' };
  if (status === 'SUCCEEDED' && execution === 'PASS') return { state: 'SUCCEEDED', execution: 'PASS' };
  if (status === 'FAILED' && execution === 'FAIL') return { state: 'FAILED', execution: 'FAIL' };
  if (status === 'CANCELLED' && execution === 'NOT_RUN') return { state: 'CANCELLED', execution: 'NOT_RUN' };
  return null;
}

function DraftNumberInput({
  id,
  label,
  value,
  min,
  max,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const normalized = Math.min(max, Math.max(min, parsed));
    setDraft(String(normalized));
    if (normalized !== value) onCommit(normalized);
  };

  return (
    <input
      id={id}
      name={id}
      aria-label={label}
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(String(value));
          event.currentTarget.blur();
        }
      }}
      style={input}
    />
  );
}

export function CoordinationCadWorkspace({ lang }: { lang: string }) {
  const L = createCommercialLocalizer(lang);
  const token = useAuthStore(state => state.token);
  const sessionStatus = useAuthStore(state => state.sessionStatus);
  const [document, setDocument] = useState(BASE_DOCUMENT);
  const [result, setResult] = useState<ReturnType<typeof checkCoordinationCandidates> | null>(null);
  const [coordinationIssues, setCoordinationIssues] = useState<CoordinationIssue[]>([]);
  const [exactJob, setExactJob] = useState<ExactJobUiState>({ state: 'NOT_RUN', execution: 'NOT_RUN', issues: [] });
  const [exactUsage, setExactUsage] = useState<ExactJobUsage | null>(null);
  const [exactCanEdit, setExactCanEdit] = useState<boolean | null>(null);
  const [exactRevisions, setExactRevisions] = useState<ExactRevisionSummary[]>([]);
  const [exactRevisionLoad, setExactRevisionLoad] = useState<'NOT_RUN' | 'RUNNING' | 'READY' | 'AUTH_REQUIRED' | 'BLOCKED'>('NOT_RUN');
  const restoreProjectDraft = useCallback((parameters: ReturnType<typeof coordinationParameters>) => {
    const coordinateSystem = typeof parameters.activeCoordinateSystem === 'string' ? parameters.activeCoordinateSystem : 'CRS_NOT_CONNECTED';
    const tolerance = typeof parameters.toleranceMm === 'number' && Number.isFinite(parameters.toleranceMm) ? parameters.toleranceMm : BASE_DOCUMENT.toleranceMm;
    const offsets = parameters.modelOffsets && typeof parameters.modelOffsets === 'object' && !Array.isArray(parameters.modelOffsets)
      ? parameters.modelOffsets as Record<string, unknown>
      : {};
    const exactBindings = parameters.modelExactGeometry && typeof parameters.modelExactGeometry === 'object' && !Array.isArray(parameters.modelExactGeometry)
      ? parameters.modelExactGeometry as Record<string, unknown>
      : {};
    setDocument(current => ({
      ...current,
      activeCoordinateSystem: coordinateSystem,
      toleranceMm: tolerance,
      models: current.models.map(model => {
        const value = offsets[model.id];
        const offset = Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'number' && Number.isFinite(item))
          ? value as [number, number, number]
          : model.offsetMm;
        const binding = exactBindings[model.id];
        const validBinding = binding && typeof binding === 'object' && !Array.isArray(binding)
          && typeof (binding as Record<string, unknown>).artifactId === 'string'
          && SHA256.test(String((binding as Record<string, unknown>).contentHash ?? ''))
          && SHA256.test(String((binding as Record<string, unknown>).shapeIdentityHash ?? ''));
        return validBinding ? {
          ...model, coordinateSystem, offsetMm: offset, geometryEvidence: 'exact_brep' as const,
          revision: String((binding as Record<string, unknown>).revision ?? model.revision),
          exactGeometry: {
            artifactId: String((binding as Record<string, unknown>).artifactId),
            contentHash: String((binding as Record<string, unknown>).contentHash),
            shapeIdentityHash: String((binding as Record<string, unknown>).shapeIdentityHash),
          },
        } : { ...model, coordinateSystem, offsetMm: offset, geometryEvidence: 'concept_bounds' as const, exactGeometry: undefined };
      }),
    }));
    setResult(null);
    setCoordinationIssues([]);
  }, []);
  const transaction = useSpatialCadTransaction('coordination', coordinationParameters(BASE_DOCUMENT), { onRestore: restoreProjectDraft });
  const scale = 44;
  const orderedModels = useMemo(() => document.models.slice().sort((a, b) => a.id.localeCompare(b.id)), [document.models]);
  const runCheck = useCallback(() => setResult(checkCoordinationCandidates(document)), [document]);
  const projectId = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('project') ?? new URLSearchParams(window.location.search).get('projectId');

  useEffect(() => {
    if (sessionStatus !== 'authenticated' || !projectId) {
      setExactUsage(null);
      setExactCanEdit(null);
      return;
    }
    let active = true;
    void fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/spatial-cad/jobs`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })
      .then(async response => {
        const payload = await response.json().catch(() => null) as { usage?: unknown; canEdit?: unknown } | null;
        if (!active) return;
        if (!response.ok) {
          setExactUsage(null);
          setExactCanEdit(null);
          return;
        }
        setExactUsage(parseExactJobUsage(payload?.usage));
        setExactCanEdit(typeof payload?.canEdit === 'boolean' ? payload.canEdit : null);
      })
      .catch(() => { if (active) { setExactUsage(null); setExactCanEdit(null); } });
    return () => { active = false; };
  }, [projectId, sessionStatus, token]);

  useEffect(() => {
    if (sessionStatus !== 'authenticated') {
      setExactRevisions([]);
      setExactRevisionLoad(sessionStatus === 'anonymous' ? 'AUTH_REQUIRED' : 'NOT_RUN');
      return;
    }
    if (!projectId) { setExactRevisionLoad('NOT_RUN'); return; }
    let active = true;
    setExactRevisionLoad('RUNNING');
    void fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/cad-revisions?list=1&limit=100`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })
      .then(async response => {
        const payload = await response.json().catch(() => null) as { revisions?: ExactRevisionSummary[] } | null;
        if (!active) return;
        if (!response.ok || !Array.isArray(payload?.revisions)) {
          setExactRevisions([]); setExactRevisionLoad(response.status === 401 ? 'AUTH_REQUIRED' : 'BLOCKED'); return;
        }
        setExactRevisions(payload.revisions.filter(item => item.artifactId?.trim() && SHA256.test(item.geometryContentHash) && SHA256.test(item.shapeIdentityHash)));
        setExactRevisionLoad('READY');
      }).catch(() => { if (active) { setExactRevisions([]); setExactRevisionLoad('BLOCKED'); } });
    return () => { active = false; };
  }, [projectId, sessionStatus, token]);

  const updateCrs = (value: string) => {
    const normalized = value.trim() ? `EPSG:${value.replace(/^EPSG:/i, '')}` : 'CRS_NOT_CONNECTED';
    const next = { ...document, revision: document.revision + 1, activeCoordinateSystem: normalized, models: document.models.map(model => ({ ...model, coordinateSystem: normalized })) };
    setDocument(next); setResult(null); setExactJob({ state: 'NOT_RUN', execution: 'NOT_RUN', issues: [] }); transaction.commit(coordinationParameters(next));
  };
  const updateTolerance = (value: number) => {
    const next = { ...document, revision: document.revision + 1, toleranceMm: Math.min(100_000, Math.max(0, Number.isFinite(value) ? value : 0)) };
    setDocument(next); setResult(null); setExactJob({ state: 'NOT_RUN', execution: 'NOT_RUN', issues: [] }); transaction.commit(coordinationParameters(next));
  };
  const updateOffset = (modelId: string, axis: 0 | 1 | 2, value: number) => {
    const next = { ...document, revision: document.revision + 1, models: document.models.map(model => model.id !== modelId ? model : { ...model, offsetMm: model.offsetMm.map((current, index) => index === axis ? value : current) as [number, number, number] }) };
    setDocument(next); setResult(null); setExactJob({ state: 'NOT_RUN', execution: 'NOT_RUN', issues: [] }); transaction.commit(coordinationParameters(next));
  };
  const bindExactRevision = (modelId: string, artifactId: string) => {
    const selected = exactRevisions.find(item => item.artifactId === artifactId);
    const next = {
      ...document,
      revision: document.revision + 1,
      models: document.models.map(model => model.id !== modelId ? model : selected ? {
        ...model,
        revision: String(selected.revision),
        geometryEvidence: 'exact_brep' as const,
        exactGeometry: { artifactId: selected.artifactId, contentHash: selected.geometryContentHash, shapeIdentityHash: selected.shapeIdentityHash },
      } : { ...model, revision: 'A', geometryEvidence: 'concept_bounds' as const, exactGeometry: undefined }),
    };
    setDocument(next); setResult(null); setExactJob({ state: 'NOT_RUN', execution: 'NOT_RUN', issues: [] }); transaction.commit(coordinationParameters(next));
  };
  const requestExactClashJob = useCallback(async () => {
    const prepared = prepareExactClashJob(document);
    if (prepared.state === 'BLOCKED') {
      setExactJob({ state: 'BLOCKED', execution: 'NOT_RUN', issues: prepared.issues });
      return;
    }
    if (sessionStatus !== 'authenticated') {
      setExactJob({ state: 'AUTH_REQUIRED', execution: 'NOT_RUN', issues: ['authentication_required'] });
      return;
    }
    if (!projectId) {
      setExactJob({ state: 'BLOCKED', execution: 'NOT_RUN', issues: ['project_context_required'] });
      return;
    }
    try {
      const response = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/spatial-cad/jobs`, {
        method: 'POST', headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': await exactClashIdempotencyKey(prepared.request),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        }, body: JSON.stringify({ request: prepared.request }),
      });
      const payload = await response.json().catch(() => null) as { job?: { id?: string; status?: string; execution?: string; errorCode?: string }; issues?: string[]; usage?: unknown } | null;
      const usage = parseExactJobUsage(payload?.usage);
      if (usage) setExactUsage(usage);
      const job = payload?.job;
      const jobId = typeof job?.id === 'string' && job.id.length > 0 ? job.id : undefined;
      const responseIssues = Array.isArray(payload?.issues) ? payload.issues.filter(issue => typeof issue === 'string' && issue.length > 0) : [];
      const acceptedState = parseExactJobState(job?.status, job?.execution);
      const accepted = (response.status === 202 || response.status === 200) && acceptedState !== null && !!jobId;
      setExactJob(accepted && acceptedState && jobId
        ? { ...acceptedState, jobId, issues: typeof job?.errorCode === 'string' && job.errorCode ? [job.errorCode] : [] }
        : { state: response.status === 401 ? 'AUTH_REQUIRED' : response.status === 409 ? 'CONFLICT' : 'BLOCKED', execution: 'NOT_RUN', issues: responseIssues.length > 0 ? responseIssues : [response.status === 200 || response.status === 202 ? 'invalid_exact_clash_job_response' : `exact_clash_job_${response.status}`] });
    } catch (error) {
      setExactJob({ state: 'BLOCKED', execution: 'NOT_RUN', issues: [error instanceof Error ? error.message : 'exact_clash_job_failed'] });
    }
  }, [document, projectId, sessionStatus, token]);
  const cancelExactClashJob = useCallback(async () => {
    const jobId = exactJob.jobId;
    if (exactCanEdit !== true || !jobId || (exactJob.state !== 'QUEUED' && exactJob.state !== 'RUNNING') || exactJob.cancelling) return;
    setExactJob(current => ({ ...current, cancelling: true, issues: [] }));
    try {
      const response = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId ?? '')}/spatial-cad/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'cancel', jobId }),
      });
      const payload = await response.json().catch(() => null) as { job?: { id?: string; status?: string; execution?: string; errorCode?: string }; issues?: string[]; code?: string; usage?: unknown } | null;
      const usage = parseExactJobUsage(payload?.usage);
      if (usage) setExactUsage(usage);
      const responseIssues = Array.isArray(payload?.issues) ? payload.issues.filter(issue => typeof issue === 'string' && issue.length > 0) : [];
      const cancelled = response.status === 200
        && payload?.job?.id === jobId
        && payload.job.status === 'CANCELLED'
        && payload.job.execution === 'NOT_RUN';
      if (cancelled) {
        setExactJob({ state: 'CANCELLED', execution: 'NOT_RUN', jobId, issues: [] });
        return;
      }
      const issues = responseIssues.length > 0 ? responseIssues : [payload?.code ?? (response.status === 200 ? 'invalid_exact_clash_cancel_response' : `exact_clash_cancel_${response.status}`)];
      if (response.status === 409) {
        setExactJob(current => ({ ...current, jobId, issues, cancelling: false }));
        return;
      }
      setExactJob({ state: response.status === 401 ? 'AUTH_REQUIRED' : 'BLOCKED', execution: 'NOT_RUN', jobId, issues });
    } catch (error) {
      setExactJob(current => ({ ...current, jobId, issues: [error instanceof Error ? error.message : 'exact_clash_cancel_failed'], cancelling: false }));
    }
  }, [exactCanEdit, exactJob.cancelling, exactJob.jobId, exactJob.state, projectId, token]);
  useEffect(() => {
    if (!projectId || sessionStatus !== 'authenticated' || !exactJob.jobId || (exactJob.state !== 'QUEUED' && exactJob.state !== 'RUNNING')) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/spatial-cad/jobs`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
        const payload = await response.json().catch(() => null) as { jobs?: Array<{ id: string; status: ExactJobUiState['state']; execution: ExactJobUiState['execution']; errorCode?: string }>; usage?: unknown; canEdit?: unknown } | null;
        if (!active || !response.ok || !Array.isArray(payload?.jobs)) return;
        const usage = parseExactJobUsage(payload.usage);
        if (usage) setExactUsage(usage);
        if (typeof payload.canEdit === 'boolean') setExactCanEdit(payload.canEdit);
        const job = payload.jobs.find(item => item.id === exactJob.jobId);
        const state = job ? parseExactJobState(job.status, job.execution) : null;
        if (!job || typeof job.id !== 'string' || !state) return;
        setExactJob({ ...state, jobId: job.id, issues: job.errorCode ? [job.errorCode] : [] });
      } catch { /* keep the last visible server state; the next poll retries */ }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [exactJob.jobId, exactJob.state, projectId, sessionStatus, token]);
  const createIssue = async (candidate: CoordinationClashCandidate) => {
    const localId = `ISS-${String(coordinationIssues.length + 1).padStart(3, '0')}`;
    const persistence = sessionStatus === 'anonymous' ? 'AUTH_REQUIRED' : projectId ? 'RUNNING' : 'NOT_RUN';
    const local: CoordinationIssue = { id: localId, candidateId: candidate.id, modelRevision: document.revision, status: 'OPEN', evidence: 'BOUNDS_PREVIEW', persistence };
    if (coordinationIssues.some(issue => issue.candidateId === candidate.id && issue.modelRevision === document.revision)) return;
    setCoordinationIssues(current => [...current, local]);
    if (sessionStatus !== 'authenticated' || !projectId) return;
    try {
      const response = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/spatial-cad/issues`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ candidate: { candidateId: candidate.id, modelA: candidate.modelA, modelB: candidate.modelB, overlapMm: candidate.overlapMm, severity: candidate.severity, modelRevision: document.revision, evidence: 'BOUNDS_PREVIEW', exactVerification: 'NOT_RUN' } }),
      });
      const payload = await response.json().catch(() => null) as { issue?: { id?: string; status?: 'OPEN' | 'RESOLVED'; updatedAt?: number }; code?: string } | null;
      setCoordinationIssues(current => current.map(issue => issue.id !== localId ? issue : {
        ...issue,
        id: response.ok && payload?.issue?.id ? payload.issue.id : issue.id,
        status: response.ok && payload?.issue?.status ? payload.issue.status : issue.status,
        updatedAt: response.ok ? payload?.issue?.updatedAt : issue.updatedAt,
        persistence: response.ok ? 'SAVED' : response.status === 401 ? 'AUTH_REQUIRED' : response.status === 409 ? 'CONFLICT' : 'BLOCKED',
      }));
    } catch {
      setCoordinationIssues(current => current.map(issue => issue.id === localId ? { ...issue, persistence: 'BLOCKED' } : issue));
    }
  };
  const toggleIssue = async (id: string) => {
    const issue = coordinationIssues.find(item => item.id === id);
    if (!issue) return;
    const status = issue.status === 'OPEN' ? 'RESOLVED' : 'OPEN';
    const canPersist = sessionStatus === 'authenticated' && !!projectId && issue.persistence === 'SAVED' && Number.isSafeInteger(issue.updatedAt);
    setCoordinationIssues(current => current.map(item => item.id === id ? { ...item, status, persistence: canPersist ? 'RUNNING' : item.persistence } : item));
    if (!canPersist || !projectId) return;
    try {
      const response = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/spatial-cad/issues`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ issueId: issue.id, status, expectedUpdatedAt: issue.updatedAt }),
      });
      const payload = await response.json().catch(() => null) as { issue?: { updatedAt?: number }; code?: string } | null;
      setCoordinationIssues(current => current.map(item => item.id === id ? { ...item, updatedAt: response.ok ? payload?.issue?.updatedAt : item.updatedAt, persistence: response.ok ? 'SAVED' : response.status === 409 ? 'CONFLICT' : response.status === 401 ? 'AUTH_REQUIRED' : 'BLOCKED' } : item));
    } catch {
      setCoordinationIssues(current => current.map(item => item.id === id ? { ...item, persistence: 'BLOCKED' } : item));
    }
  };
  useEffect(() => {
    if (sessionStatus !== 'authenticated' || !projectId) return;
    let active = true;
    void fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/spatial-cad/issues`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })
      .then(async response => {
        const payload = await response.json().catch(() => null) as { issues?: Array<{ id: string; candidateId: string; modelRevision: number; status: 'OPEN' | 'RESOLVED'; evidence: 'BOUNDS_PREVIEW'; updatedAt: number }> } | null;
        if (!active || !response.ok || !Array.isArray(payload?.issues)) return;
        setCoordinationIssues(payload.issues.map(issue => ({ ...issue, persistence: 'SAVED' })));
      }).catch(() => { /* visible save status changes on the next user mutation */ });
    return () => { active = false; };
  }, [projectId, sessionStatus, token]);
  useEffect(() => {
    const onCommand = (event: Event) => {
      const id = (event as CustomEvent<SpatialCadCommandDetail>).detail?.id;
      if (id === 'spatial.verify') runCheck();
    else if (id === 'spatial.dimensions') globalThis.document.getElementById('coordination-epsg')?.focus();
      else if (id === 'spatial.issues') globalThis.document.querySelector<HTMLElement>('[data-testid="coordination-issue-list"]')?.focus();
      else if (id === 'spatial.exact-clash-job') void requestExactClashJob();
    };
    window.addEventListener(SPATIAL_CAD_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(SPATIAL_CAD_COMMAND_EVENT, onCommand);
  }, [requestExactClashJob, runCheck]);

  return (
    <div data-testid="coordination-cad" className="nx-coordination-workbench" style={{ '--nx-spatial-left': '230px', '--nx-spatial-right': '310px', width: '100%', height: '100%', minHeight: 0, display: 'grid', gridTemplateColumns: 'var(--nx-spatial-left) minmax(0, 1fr) var(--nx-spatial-right)', position: 'relative', overflow: 'hidden', background: 'var(--nx-bg)', color: 'var(--nx-text)' } as React.CSSProperties}>
      <aside style={{ padding: 12, overflow: 'auto', borderRight: '1px solid var(--nx-border)', background: 'var(--nx-panel)' }}>
        <b>{L('연동 모델 브라우저', 'Federated model browser')}</b>
        <div style={{ marginTop: 10, color: 'var(--nx-warn)', fontSize: 10 }}>{document.activeCoordinateSystem} · {L('승인 기준점 NOT_RUN', 'approved controls NOT_RUN')}</div>
        <div style={{ marginTop: 8, fontSize: 9, color: exactRevisionLoad === 'BLOCKED' ? 'var(--nx-danger, #dc2626)' : 'var(--nx-text-3)' }}>Exact project revisions: {exactRevisionLoad} · {exactRevisions.length}</div>
        {orderedModels.map(model => <div key={model.id} style={{ marginTop: 9, padding: 8, border: '1px solid var(--nx-border)', borderRadius: 6, fontSize: 10 }}>
          <b>{model.id}</b><br/>{model.discipline} · r{model.revision}<br/><span style={{ color: model.geometryEvidence === 'exact_brep' ? 'var(--nx-success, #16a34a)' : 'var(--nx-warn)' }}>{model.geometryEvidence}</span>
          {projectId && sessionStatus === 'authenticated' && <select aria-label={`${model.id} exact project revision`} value={model.exactGeometry?.artifactId ?? ''} onChange={event => bindExactRevision(model.id, event.target.value)} style={{ ...input, height: 27, marginTop: 6, fontSize: 9 }}>
            <option value="">Concept bounds only</option>
            {exactRevisions.map(revision => <option key={revision.artifactId} value={revision.artifactId}>r{revision.revision} · {revision.domain} · {revision.kernelId}</option>)}
          </select>}
        </div>)}
      </aside>
      <main style={{ minWidth: 0, minHeight: 0, padding: 12, overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><b>{L('통합 평면 · 간섭 후보', 'Federated plan · clash candidates')}</b><span style={{ fontSize: 10 }}>TOL {document.toleranceMm} mm</span></div>
        <svg data-testid="coordination-plan" viewBox="-20 -20 304 210" style={{ width: '100%', minHeight: 480, border: '1px solid var(--nx-border)', borderRadius: 8, background: 'var(--nx-panel)' }}>
          {orderedModels.map((model, index) => {
            const x = (model.boundsMm.min[0] + model.offsetMm[0]) / scale;
            const y = (model.boundsMm.min[1] + model.offsetMm[1]) / scale;
            const width = (model.boundsMm.max[0] - model.boundsMm.min[0]) / scale;
            const height = (model.boundsMm.max[1] - model.boundsMm.min[1]) / scale;
            const colors = ['#38bdf8', '#f97316', '#a3e635'];
            return <g key={model.id}><rect x={x} y={y} width={width} height={height} fill={`${colors[index]}22`} stroke={colors[index]} strokeWidth="1"/><text x={x + 3} y={y + 11} fill={colors[index]} fontSize="6">{model.id}</text></g>;
          })}
          {result?.candidates.map((candidate, index) => <circle key={candidate.id} cx={145 + index * 12} cy={90 + index * 8} r="5" fill="#ef4444" stroke="#fff" strokeWidth="1"/>)}
        </svg>
      </main>
      <aside style={{ padding: 12, overflow: 'auto', borderLeft: '1px solid var(--nx-border)', background: 'var(--nx-panel)' }}>
        <b>{L('좌표·간섭 속성', 'Coordinates & clash properties')}</b>
        <SpatialCadTransactionStatus state={transaction.state} lang={lang} onUndo={transaction.undo} onRedo={transaction.redo} />
        <label htmlFor="coordination-epsg" style={{ display: 'grid', gap: 4, marginTop: 10, fontSize: 10 }}>{L('EPSG 코드', 'EPSG code')}<input key={document.activeCoordinateSystem} id="coordination-epsg" name="coordination-epsg" aria-label={loc(lang, { ko: 'EPSG 코드', en: 'EPSG code', ja: 'EPSG コード', zh: 'EPSG 代码', es: 'Código EPSG', ar: 'رمز EPSG' })} defaultValue={document.activeCoordinateSystem === 'CRS_NOT_CONNECTED' ? '' : document.activeCoordinateSystem.replace(/^EPSG:/i, '')} placeholder="5186" onBlur={event => updateCrs(event.target.value)} style={input}/></label>
        <label htmlFor="coordination-tolerance" style={{ display: 'grid', gap: 4, marginTop: 8, fontSize: 10 }}>
          {L('간섭 여유 (mm)', 'Clash tolerance (mm)')}
          <DraftNumberInput id="coordination-tolerance" label="Clash tolerance (mm)" min={0} max={100000} value={document.toleranceMm} onCommit={updateTolerance} />
        </label>
        {orderedModels.map(model => (
          <fieldset key={model.id} style={{ marginTop: 10, border: '1px solid var(--nx-border)', borderRadius: 6, fontSize: 10 }}>
            <legend>{model.id} offset mm</legend>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4 }}>
              {(['X','Y','Z'] as const).map((axis, index) => (
                <DraftNumberInput
                  key={axis}
                  id={`coordination-${model.id}-${axis.toLowerCase()}`}
                  label={`${model.id} ${axis} offset`}
                  min={-10000000}
                  max={10000000}
                  value={model.offsetMm[index]}
                  onCommit={value => updateOffset(model.id, index as 0|1|2, value)}
                />
              ))}
            </div>
          </fieldset>
        ))}
        <button type="button" data-testid="coordination-run-check" onClick={runCheck} style={{ width: '100%', minHeight: 36, marginTop: 12, border: 0, borderRadius: 6, background: 'var(--nx-accent)', fontWeight: 800 }}>{L('간섭 후보 계산', 'Calculate clash candidates')}</button>
        <section data-testid="coordination-results" aria-live="polite" style={{ display: 'grid', gap: 5, marginTop: 12, fontSize: 10 }}>
          <b>{L('검증 상태', 'Verification state')}: {result?.state ?? 'NOT_RUN'}</b>
          <span>{L('경계 상자 후보', 'Bounds candidates')}: {result ? result.candidates.length : 'NOT_RUN'}</span>
          <span>{L('정확 B-Rep 간섭', 'Exact B-Rep clash')}: <b>NOT_RUN</b></span>
          <span>{L('프로젝트 저장·출시', 'Project persistence & release')}: <b>NOT_RUN</b></span>
          {result?.issues.map(issue => <span key={issue} style={{ color: 'var(--nx-danger, #dc2626)' }}>{issue}</span>)}
        </section>
        <button type="button" data-testid="coordination-exact-job" onClick={() => void requestExactClashJob()} style={{ width: '100%', minHeight: 32, marginTop: 8, border: '1px solid var(--nx-border)', borderRadius: 6, background: 'var(--nx-panel-2)', color: 'var(--nx-text)', fontSize: 10, fontWeight: 750, cursor: 'pointer' }}>
          {L('정확 B-Rep 간섭 Job 준비', 'Prepare exact B-Rep clash job')}
        </button>
        <section data-testid="coordination-exact-job-status" aria-live="polite" style={{ display: 'grid', gap: 3, marginTop: 7, fontSize: 9.5, color: exactJob.state === 'BLOCKED' ? 'var(--nx-danger, #dc2626)' : 'var(--nx-text-2)' }}>
          <b>JOB {exactJob.state} · EXECUTION {exactJob.execution} · RELEASE NOT_RUN</b>
          {exactJob.jobId && <span>{exactJob.jobId}</span>}
          {exactJob.issues.map(issue => <span key={issue}>{issue}</span>)}
        </section>
        {projectId && sessionStatus === 'authenticated' && <section data-testid="coordination-exact-job-usage" aria-live="polite" style={{ marginTop: 7, fontSize: 9.5, color: 'var(--nx-text-2)' }}>
          {exactUsage
            ? L('Exact clash 프로젝트 활성 작업(동시 실행 제한, 결제 quota 아님): {{0}} / {{1}}', 'Exact clash project active jobs (concurrency cap, not billing quota): {{0}} / {{1}}').replace('{{0}}', String(exactUsage.active)).replace('{{1}}', String(exactUsage.limit))
            : L('Exact clash 작업 사용량을 확인할 수 없습니다', 'Exact clash active-job usage unavailable')}
        </section>}
        {exactCanEdit === true && exactJob.jobId && (exactJob.state === 'QUEUED' || exactJob.state === 'RUNNING') && <button
          type="button"
          data-testid="coordination-exact-job-cancel"
          aria-label={L('정확한 간섭 Job 취소', 'Cancel exact clash job')}
          disabled={exactJob.cancelling}
          onClick={() => void cancelExactClashJob()}
          style={{ width: '100%', minHeight: 28, marginTop: 7, border: '1px solid var(--nx-danger, #dc2626)', borderRadius: 6, background: 'transparent', color: 'var(--nx-danger, #dc2626)', fontSize: 9.5, fontWeight: 700, cursor: exactJob.cancelling ? 'wait' : 'pointer' }}
        >
          {exactJob.cancelling ? L('취소 중…', 'Cancelling…') : L('정확한 간섭 Job 취소', 'Cancel exact clash job')}
        </button>}
        {exactCanEdit === true && exactJob.jobId && (exactJob.state === 'QUEUED' || exactJob.state === 'RUNNING') && <span style={{ display: 'block', marginTop: 4, fontSize: 9, color: 'var(--nx-text-3)' }}>
          {L('취소는 협력적으로 결과 저장을 차단하며 외부 프로세스를 강제 종료하지 않습니다.', 'Cancellation is cooperative; it prevents result commits but does not terminate an external process.')}
        </span>}
        {result?.state === 'PREVIEW' && result.candidates.length > 0 && (
          <section aria-label={L('간섭 후보 목록', 'Clash candidate list')} style={{ display: 'grid', gap: 6, marginTop: 12 }}>
            {result.candidates.map(candidate => {
              const issue = coordinationIssues.find(item => item.candidateId === candidate.id && item.modelRevision === document.revision);
              return (
                <article key={candidate.id} style={{ padding: 7, border: '1px solid var(--nx-border)', borderRadius: 6, fontSize: 9.5 }}>
                  <b>{candidate.modelA} × {candidate.modelB}</b>
                  <div style={{ marginTop: 3, color: 'var(--nx-text-3)' }}>{candidate.severity} · {candidate.overlapMm.join(' × ')} mm · PREVIEW</div>
                  {issue ? (
                    <button type="button" onClick={() => void toggleIssue(issue.id)} style={{ marginTop: 5, border: '1px solid var(--nx-border)', borderRadius: 4, background: 'var(--nx-panel-2)', color: 'var(--nx-text)', fontSize: 9, cursor: 'pointer' }}>
                      {issue.id} · {issue.status} · {L('상태 전환', 'toggle state')}
                    </button>
                  ) : (
                    <button type="button" onClick={() => void createIssue(candidate)} style={{ marginTop: 5, border: '1px solid var(--nx-accent)', borderRadius: 4, background: 'transparent', color: 'var(--nx-accent)', fontSize: 9, cursor: 'pointer' }}>
                      {L('PREVIEW 이슈 만들기', 'Create PREVIEW issue')}
                    </button>
                  )}
                </article>
              );
            })}
          </section>
        )}
        <section data-testid="coordination-issue-list" tabIndex={-1} aria-label={L('조정 이슈', 'Coordination issues')} style={{ display: 'grid', gap: 5, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--nx-border)', fontSize: 9.5 }}>
          <b>{L('조정 이슈', 'Coordination issues')} · {coordinationIssues.filter(issue => issue.status === 'OPEN').length} OPEN</b>
          {coordinationIssues.length === 0 && <span style={{ color: 'var(--nx-text-3)' }}>{L('생성된 이슈 없음', 'No issues created')}</span>}
          {coordinationIssues.map(issue => (
            <span key={issue.id} data-testid={`coordination-issue-${issue.id}`} style={{ color: issue.modelRevision === document.revision ? 'var(--nx-text-2)' : 'var(--nx-warn)' }}>
              {issue.id} · {issue.status} · {issue.evidence} · {issue.modelRevision === document.revision ? `r${issue.modelRevision}` : `STALE r${issue.modelRevision}`} · {issue.persistence}
            </span>
          ))}
        </section>
      </aside>
      <SpatialPaneResizers lang={lang} storageKey="coordination" leftDefault={230} rightDefault={310} />
    </div>
  );
}
