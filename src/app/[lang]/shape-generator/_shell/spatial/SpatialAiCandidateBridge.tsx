'use client';

import { useEffect, useMemo, useState } from 'react';
import { applySpatialAiCandidate, type SpatialAiCandidate, type SpatialAiCandidateOperation } from '@/lib/ai/spatialAiCandidate';
import type { AiCandidateLock } from '@/lib/ai/aiCanonicalCandidate';
import type { SpatialCadDocument, SpatialCadParameters } from '@/lib/cad/spatialCadCommand';
import { getSpatialCadLiveLocks } from './useSpatialCadTransaction';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

export function SpatialAiCandidateBridge({
  candidate,
  currentDocument,
  currentDocumentId,
  currentContentHash,
  currentLocks,
  onCommit,
  onAuthoritativeCommit,
  onDiscard,
  lang,
}: {
  candidate: SpatialAiCandidate | null;
  currentDocument: SpatialCadDocument;
  currentDocumentId: string;
  currentContentHash: string | null;
  currentLocks?: readonly AiCandidateLock[];
  onCommit: (parameters: SpatialCadParameters) => boolean;
  onAuthoritativeCommit?: (...args: never[]) => Promise<boolean>;
  onDiscard: () => void;
  lang: string;
}) {
  const L = createCommercialLocalizer(lang);
  const [scopedLocks, setScopedLocks] = useState<readonly AiCandidateLock[]>(() => getSpatialCadLiveLocks(currentDocument.domain, currentDocumentId));
  useEffect(() => {
    setScopedLocks(getSpatialCadLiveLocks(currentDocument.domain, currentDocumentId));
    const onLocks = (event: Event) => {
      const detail = (event as CustomEvent<{ domain?: string; documentId?: string; locks?: AiCandidateLock[] }>).detail;
      if (detail?.domain === currentDocument.domain && detail.documentId === currentDocumentId) setScopedLocks(detail.locks ?? []);
    };
    window.addEventListener('nexyfab:spatial-cad-locks', onLocks);
    return () => window.removeEventListener('nexyfab:spatial-cad-locks', onLocks);
  }, [currentDocument.domain, currentDocumentId]);
  const liveLocks = (currentLocks ?? scopedLocks).filter(lock => lock.target.kind === 'workspace' || lock.target.objectId === currentDocumentId);
  const [issue, setIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const diff = useMemo(() => {
    if (!candidate) return [];
    if (candidate.operation.kind === 'set_parameter') return [[candidate.operation.path, currentDocument.parameters[candidate.operation.path], candidate.operation.value] as const];
    return Object.entries(candidate.operation.parameters).map(([path, value]) => [path, currentDocument.parameters[path], value] as const);
  }, [candidate, currentDocument.parameters]);
  if (!candidate) return null;
  const apply = async () => {
    if (!currentContentHash) { setIssue('current_document_hash_unavailable'); return; }
    setBusy(true);
    const result = applySpatialAiCandidate({ candidate, document: currentDocument, currentDocumentId, currentContentHash, currentLocks: liveLocks, commandId: `spatial-ai-${Date.now()}` });
    if (!result.applied || !result.transaction) {
      setIssue(result.issues.join(', ') || 'spatial_candidate_blocked');
      setBusy(false);
      return;
    }
    let committed = false;
    try {
      committed = onAuthoritativeCommit
        ? await (onAuthoritativeCommit as unknown as (parameters: SpatialCadParameters, operation: SpatialAiCandidateOperation, metadata: { documentId: string; contentHash: string; locks: readonly AiCandidateLock[]; parameterPaths: readonly string[]; mode: 'new_design' | 'request_only_edit' }) => Promise<boolean>)(result.document.parameters, candidate.operation, { documentId: currentDocumentId, contentHash: currentContentHash, locks: liveLocks, parameterPaths: candidate.parameterPaths, mode: candidate.mode })
        : onCommit(result.document.parameters);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : 'spatial_transaction_commit_failed');
      setBusy(false);
      return;
    }
    if (!committed) {
      setIssue('spatial_transaction_commit_failed');
      setBusy(false);
      return;
    }
    setIssue(null);
    setBusy(false);
    onDiscard();
  };
  return (
    <section data-testid="spatial-ai-candidate-bridge" aria-live="polite" style={{ marginTop: 10, padding: 10, border: '1px solid var(--nx-accent, #2563eb)', borderRadius: 8, background: 'var(--nx-accent-soft, rgba(37,99,235,.08))', fontSize: 11 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>{L('AI 변경안 검토', 'Review AI CAD change')}</b><span>r{candidate.baseDocumentRevision} → r{currentDocument.revision}</span></div>
      <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>{diff.map(([path, before, after]) => <div key={path}><code>{path}</code>: {String(before ?? '—')} → <b>{String(after)}</b></div>)}</div>
      {issue && <div style={{ marginTop: 6, color: 'var(--nx-danger, #dc2626)' }}>{issue}</div>}
      <div style={{ marginTop: 6, color: 'var(--nx-text-3, #6b7684)' }}>{liveLocks.length
        ? (L(`현재 잠금 ${liveLocks.length}개를 적용 직전 다시 검사합니다.`, `${liveLocks.length} live lock(s) will be rechecked at Apply.`))
        : candidate.mode === 'new_design'
          ? (L('신규 설계 전체 매개변수 변경안입니다.', 'This new-design proposal covers the full parameter set.'))
          : (L('선택한 치수만 AI 수정 범위입니다.', 'Only the selected parameter is in scope.'))}</div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button type="button" data-testid="spatial-ai-candidate-apply" disabled={busy || !currentContentHash} onClick={apply} style={{ padding: '5px 9px', border: 0, borderRadius: 6, background: 'var(--nx-accent, #2563eb)', color: '#fff', fontWeight: 700 }}>{L('검토 후 적용', 'Apply reviewed change')}</button>
        <button type="button" data-testid="spatial-ai-candidate-discard" disabled={busy} onClick={() => { setIssue(null); onDiscard(); }} style={{ padding: '5px 9px', border: '1px solid var(--nx-border, #dfe3e8)', borderRadius: 6, background: 'transparent', color: 'inherit' }}>{L('폐기', 'Discard')}</button>
      </div>
    </section>
  );
}
