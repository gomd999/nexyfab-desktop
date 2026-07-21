'use client';

// AI review queue panel — Wave A Track WA-C.
//
// The human side of the AI review loop: AI runs arrive as `ai/<runId>` branch
// commits (pdm/reviewQueue) and the reviewer sees ONLY what matters —
// the feature diff (pdm/historyView.diffCommits, same code path as the
// version tree) plus the run's verification report (gate id / pass / measured
// value / reason). Actions:
//
//   - Approve      → merges the run into main (2-parent commit) via the
//                    injected callback. DISABLED when any gate failed:
//                    검증 실패물은 사람 승인으로도 main에 들어갈 수 없다 —
//                    the only path is a change request → new run.
//   - Request changes → comments become a RevisionDirective IR (the next
//                    AI run's input). At least one note is required.
//
// Props-injected (no store import) so the queue backend stays swappable and
// the panel is testable in isolation — the shell wires it to
// pdm/sessionRepoStore (aiRuns / approveAiRun / requestAiChanges).

import { useMemo, useState } from 'react';
import { useLang } from '../hooks/useLang';
import { loc } from '../lib/loc';
import { diffCommits, type DiffSummary } from '../pdm/historyView';
import type { Commit } from '../pdm/versionBranch';
import type { AiRunRecord, GateResultLike, ReviewComment } from '../pdm/reviewQueue';

export interface AiReviewQueuePanelProps {
  isKo: boolean;
  /** All recorded AI runs — the panel lists the pending ones. */
  runs: AiRunRecord[];
  /** Commit lookup (repo.getCommit) — used to compute the review diff. */
  resolveCommit: (commitId: string) => Commit | null;
  onApprove: (runId: string) => void;
  onRequestChanges: (runId: string, comments: ReviewComment[]) => void;
  /**
   * Wave A · WA-E autonomy-measurement hooks (additive, optional — the panel
   * behaves identically when omitted). Fired ONLY from real reviewer actions:
   *   - onReviewOpen  when a run's detail is expanded (human_review_started)
   *   - onReviewClose when it is collapsed / an action closes it (…_ended)
   * The shell wires these to autonomySessionStore. Approve / request-changes
   * autonomy events are emitted by the parent from onApprove/onRequestChanges;
   * the panel guarantees the review is CLOSED (…_ended) before it fires
   * onApprove, so the store sequence never places an event after the terminal
   * 'approved'.
   */
  onReviewOpen?: (runId: string) => void;
  onReviewClose?: (runId: string) => void;
}

function gateStats(gates: GateResultLike[]): { pass: number; total: number; failed: GateResultLike[] } {
  const failed = gates.filter(g => !g.pass);
  return { pass: gates.length - failed.length, total: gates.length, failed };
}

function fmtGateValue(g: GateResultLike): string {
  const parts: string[] = [];
  if (g.value !== undefined) parts.push(`${g.value}${g.unit ?? ''}`);
  if (g.expected !== undefined) parts.push(`→ ${g.expected}${g.unit ?? ''}`);
  return parts.join(' ');
}

export function AiReviewQueuePanel({
  isKo,
  runs,
  resolveCommit,
  onApprove,
  onRequestChanges,
  onReviewOpen,
  onReviewClose,
}: AiReviewQueuePanelProps) {
  void isKo;
  const lang = useLang();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [featureIdDraft, setFeatureIdDraft] = useState('');

  // Single entry point for expand/collapse so review-session open/close events
  // are emitted exactly once per real transition (no nested/duplicate sessions).
  const changeExpanded = (nextId: string | null) => {
    if (expandedId === nextId) return;
    if (expandedId) onReviewClose?.(expandedId);
    if (nextId) onReviewOpen?.(nextId);
    setExpandedId(nextId);
  };

  const pending = useMemo(() => runs.filter(r => r.status === 'pending'), [runs]);

  const expanded = pending.find(r => r.runId === expandedId) ?? null;
  const expandedDiff: DiffSummary | null = useMemo(() => {
    if (!expanded) return null;
    const c = resolveCommit(expanded.commitId);
    if (!c || c.parents.length === 0) return null;
    const base = resolveCommit(c.parents[0]!);
    return base ? diffCommits(base, c) : null;
  }, [expanded, resolveCommit]);

  if (pending.length === 0) {
    return (
      <div data-testid="arq-empty" style={{ padding: 8, fontSize: 11, color: 'var(--nx-text-3)' }}>
        {loc(lang, {
          ko: '검토 대기 중인 AI 실행이 없습니다. AI 실행은 ai/<runId> 브랜치 커밋으로 기록된 뒤 이 큐에 나타납니다.',
          en: 'No AI runs awaiting review. Runs are recorded as ai/<runId> branch commits and then appear here.',
          ja: 'レビュー待ちのAI実行はありません。実行は ai/<runId> ブランチのコミットとして記録された後、ここに表示されます。',
          zh: '暂无待审核的 AI 运行。运行会先记录为 ai/<runId> 分支提交，然后显示在此处。',
          es: 'No hay ejecuciones de IA pendientes de revisión. Las ejecuciones se registran como commits en ramas ai/<runId> y luego aparecen aquí.',
          ar: 'لا توجد عمليات تشغيل ذكاء اصطناعي بانتظار المراجعة. تُسجل العمليات كالتزامات على فروع ai/<runId> ثم تظهر هنا.',
        })}
      </div>
    );
  }

  const submitChanges = (run: AiRunRecord) => {
    const note = noteDraft.trim();
    if (!note) return;
    const comment: ReviewComment = featureIdDraft.trim()
      ? { featureId: featureIdDraft.trim(), note }
      : { note };
    onRequestChanges(run.runId, [comment]);
    setNoteDraft('');
    setFeatureIdDraft('');
    changeExpanded(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--nx-text)', overflow: 'auto', height: '100%' }}>
      <div style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>
        {loc(lang, {
          ko: `검토 대기 ${pending.length}건 — 승인 = main 머지 · 수정요청 = 다음 AI 실행 입력(RevisionDirective)`,
          en: `${pending.length} pending — approve = merge into main · request changes = next-run input (RevisionDirective)`,
          ja: `レビュー待ち ${pending.length}件 — 承認 = main へマージ · 修正依頼 = 次回実行の入力 (RevisionDirective)`,
          zh: `待审核 ${pending.length} 项 — 批准 = 合并到 main · 请求修改 = 下次运行的输入 (RevisionDirective)`,
          es: `${pending.length} pendientes — aprobar = fusionar en main · pedir cambios = entrada de la próxima ejecución (RevisionDirective)`,
          ar: `${pending.length} بانتظار المراجعة — الموافقة = دمج في main · طلب تعديل = مدخل التشغيل التالي (RevisionDirective)`,
        })}
      </div>

      {pending.map(run => {
        const stats = gateStats(run.report.gates);
        const hasFail = stats.failed.length > 0;
        const isOpen = expandedId === run.runId;
        return (
          <div key={run.runId} data-testid="arq-run" style={{ border: '1px solid var(--nx-border)', borderRadius: 4, padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* Header row: branch + gate badge */}
            <button
              data-testid="arq-run-toggle"
              onClick={() => changeExpanded(isOpen ? null : run.runId)}
              style={{ ...rowBtn }}
            >
              <span style={{ fontWeight: 700, fontSize: 11 }}>{run.branchName}</span>
              <span
                data-testid="arq-gate-badge"
                style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 8,
                  background: hasFail ? 'var(--nx-warn-bg, rgba(239,68,68,0.15))' : 'var(--nx-ok-bg, rgba(34,197,94,0.15))',
                  color: hasFail ? 'var(--nx-warn, #ef4444)' : 'var(--nx-ok, #22c55e)',
                }}
              >
                {loc(lang, { ko: '게이트', en: 'gates', ja: 'ゲート', zh: '门控', es: 'puertas', ar: 'بوابات' })}
                {` ${stats.pass}/${stats.total}`}
              </span>
            </button>
            <div style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>{run.briefSummary}</div>
            {hasFail && (
              <div data-testid="arq-fail-reasons" style={{ fontSize: 10, color: 'var(--nx-warn, #ef4444)' }}>
                {stats.failed.map(g => `${g.id}: ${g.reason ?? loc(lang, { ko: '사유 미기재', en: 'no reason given', ja: '理由未記載', zh: '未注明原因', es: 'sin motivo', ar: 'بدون سبب' })}`).join(' · ')}
              </div>
            )}

            {/* Expanded: diff + verification report + actions */}
            {isOpen && (
              <div data-testid="arq-run-detail" style={{ borderTop: '1px solid var(--nx-border)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Diff vs fork point (same diffCommits as the version tree) */}
                <div style={{ fontSize: 10, fontWeight: 700 }}>
                  {loc(lang, { ko: '변경 (분기 시점 대비)', en: 'Changes (vs fork point)', ja: '変更（分岐時点比）', zh: '变更（相对分叉点）', es: 'Cambios (vs punto de bifurcación)', ar: 'التغييرات (مقارنة بنقطة التفرع)' })}
                </div>
                {expandedDiff ? (
                  <div data-testid="arq-diff" style={{ fontSize: 10, color: 'var(--nx-text-3)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div>{`+${expandedDiff.added} −${expandedDiff.removed} ~${expandedDiff.modified}`}</div>
                    {expandedDiff.entries.map(e => (
                      <div key={`${e.kind}-${e.featureId}`} data-testid="arq-diff-entry">
                        {e.kind === 'added' ? '+' : e.kind === 'removed' ? '−' : '~'} {e.featureId}
                        {e.changedParams?.map(p => ` ${p.key}: ${p.before}→${p.after}`).join(',')}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>
                    {loc(lang, { ko: '디프 계산 불가 (커밋 조회 실패)', en: 'Diff unavailable (commit lookup failed)', ja: '差分を計算できません（コミット参照失敗）', zh: '无法计算差异（提交查询失败）', es: 'Diff no disponible (fallo al resolver commit)', ar: 'الفرق غير متاح (فشل جلب الالتزام)' })}
                  </div>
                )}

                {/* Verification report */}
                <div style={{ fontSize: 10, fontWeight: 700 }}>
                  {loc(lang, { ko: '검증 리포트', en: 'Verification report', ja: '検証レポート', zh: '验证报告', es: 'Informe de verificación', ar: 'تقرير التحقق' })}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {run.report.gates.map(g => (
                    <div key={g.id} data-testid="arq-gate-row" style={{ fontSize: 10, display: 'flex', gap: 6, color: g.pass ? 'var(--nx-text-3)' : 'var(--nx-warn, #ef4444)' }}>
                      <span style={{ minWidth: 12 }}>{g.pass ? '✓' : '✗'}</span>
                      <span style={{ fontWeight: 600 }}>{g.id}</span>
                      <span>{fmtGateValue(g)}</span>
                      {!g.pass && <span>{g.reason}</span>}
                    </div>
                  ))}
                </div>

                {/* Approve — hard-gated on verification */}
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <button
                    data-testid="arq-approve"
                    disabled={hasFail}
                    onClick={() => { if (!hasFail) { changeExpanded(null); onApprove(run.runId); } }}
                    style={{ ...primaryBtn, opacity: hasFail ? 0.5 : 1, cursor: hasFail ? 'not-allowed' : 'pointer' }}
                  >
                    {loc(lang, { ko: '승인 (main 머지)', en: 'Approve (merge into main)', ja: '承認（main へマージ）', zh: '批准（合并到 main）', es: 'Aprobar (fusionar en main)', ar: 'موافقة (دمج في main)' })}
                  </button>
                </div>
                {hasFail && (
                  <div data-testid="arq-approve-blocked" style={{ fontSize: 9, color: 'var(--nx-warn, #ef4444)' }}>
                    {loc(lang, {
                      ko: '게이트 실패 — 검증에 실패한 산출물은 사람의 승인으로도 main에 들어갈 수 없습니다. 수정요청으로 재실행하세요.',
                      en: 'Gate failed — verification failures cannot enter main, even with human approval. Request changes to re-run.',
                      ja: 'ゲート失敗 — 検証に失敗した成果物は人の承認でも main に入れません。修正依頼で再実行してください。',
                      zh: '门控失败 — 验证失败的产物即使经人工批准也不能进入 main。请通过请求修改重新运行。',
                      es: 'Puerta fallida — los resultados que fallan la verificación no pueden entrar en main, ni con aprobación humana. Pida cambios para re-ejecutar.',
                      ar: 'فشلت البوابة — لا يمكن للنتائج الفاشلة في التحقق دخول main حتى بموافقة بشرية. اطلب تعديلات لإعادة التشغيل.',
                    })}
                  </div>
                )}

                {/* Request changes → RevisionDirective */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--nx-border)', paddingTop: 6 }}>
                  <input
                    data-testid="arq-comment-feature"
                    value={featureIdDraft}
                    onChange={e => setFeatureIdDraft(e.target.value)}
                    placeholder={loc(lang, { ko: '대상 피처 id (선택)', en: 'Target feature id (optional)', ja: '対象フィーチャー id（任意）', zh: '目标特征 id（可选）', es: 'Id de operación (opcional)', ar: 'معرف الميزة (اختياري)' })}
                    style={inputStyle}
                  />
                  <textarea
                    data-testid="arq-comment-note"
                    value={noteDraft}
                    onChange={e => setNoteDraft(e.target.value)}
                    placeholder={loc(lang, { ko: '수정요청 코멘트 — 다음 AI 실행의 입력이 됩니다', en: 'Change-request comment — becomes the next AI run input', ja: '修正依頼コメント — 次回AI実行の入力になります', zh: '修改请求评论 — 将作为下次 AI 运行的输入', es: 'Comentario de cambios — será la entrada de la próxima ejecución', ar: 'تعليق طلب التعديل — سيكون مدخل التشغيل التالي' })}
                    rows={2}
                    style={{ ...inputStyle, height: 'auto', resize: 'vertical', padding: 4 }}
                  />
                  <button
                    data-testid="arq-request-changes"
                    disabled={!noteDraft.trim()}
                    onClick={() => submitChanges(run)}
                    style={{ ...ghostBtn, opacity: noteDraft.trim() ? 1 : 0.5 }}
                  >
                    {loc(lang, { ko: '수정요청 (RevisionDirective 발행)', en: 'Request changes (issue RevisionDirective)', ja: '修正依頼（RevisionDirective 発行）', zh: '请求修改（签发 RevisionDirective）', es: 'Pedir cambios (emitir RevisionDirective)', ar: 'طلب تعديل (إصدار RevisionDirective)' })}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const rowBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  border: 0, background: 'transparent', color: 'var(--nx-text)',
  padding: 0, cursor: 'pointer', textAlign: 'left',
};
const primaryBtn: React.CSSProperties = {
  padding: '4px 10px', height: 24, border: 0, borderRadius: 4,
  background: 'var(--nx-accent)', color: '#fff', fontSize: 10,
  fontWeight: 600,
};
const ghostBtn: React.CSSProperties = {
  padding: '4px 10px', height: 24,
  border: '1px solid var(--nx-border)', borderRadius: 4,
  background: 'transparent', color: 'var(--nx-text)',
  fontSize: 10, cursor: 'pointer',
};
const inputStyle: React.CSSProperties = {
  height: 22, fontSize: 10, padding: '0 6px',
  border: '1px solid var(--nx-border)', borderRadius: 4,
  background: 'var(--nx-bg-2, transparent)', color: 'var(--nx-text)',
  minWidth: 0, fontFamily: 'inherit',
};
