'use client';

// PDM version tree panel — Wave 6 Track W6-D.
//
// Renders the CURRENT SESSION's real PDM state (pdm/sessionRepoStore wrapping
// the tested versionBranch engine) instead of the former hard-coded DEMO_SEED.
//
//   - No commits yet → explicit "no commits" empty state. The first commit is
//     recorded from the REAL live feature snapshot Inner publishes to
//     useShellBridge.featureItems (adapter: pdm/shellFeatureAdapter).
//   - Demo history is OPT-IN only and visibly labeled as sample data.
//   - Merge flow: pick a source branch → 3-way mergeFeatures (LCA base) →
//     conflict list with per-conflict ours/theirs resolution → 2-parent
//     merge commit via VersionRepo.merge.
//
// Checkout is available for both session branches and server-backed versions.
// The selected immutable snapshot is replayed into Inner's live feature
// pipeline through the shared nexyfab:pdm-checkout-restore contract.

import { useEffect, useMemo, useState } from 'react';
import { useLang } from '../hooks/useLang';
import { loc } from '../lib/loc';
import { useShellBridge } from './shellBridgeStore';
import { useAuthStore } from '@/hooks/useAuth';
import { usePdmSessionStore } from '../pdm/sessionRepoStore';
import { shellItemsToFeatureInstances } from '../pdm/shellFeatureAdapter';
import { layoutCommitGraph, diffCommits } from '../pdm/historyView';
import type { Commit } from '../pdm/versionBranch';
import type { MergeConflict } from '../pdm/conflictResolution';
import type { FeatureInstance } from '../features/types';

export interface VersionTreePanelProps {
  isKo: boolean;
  /** Server-side `nf_documents` id to persist/load this session's PDM history
   *  against (G4 bridge — see pdm/documentPersistence.ts). Optional: when
   *  omitted (today's default — no live caller supplies one yet, see 260723
   *  architecture-debt notes), the panel behaves exactly as before, pure
   *  in-memory, no network. When provided, the panel auto-binds on mount and
   *  every commit is also pushed as a server version snapshot. */
  documentId?: string | null;
}

const BRANCH_COLORS = ['#4f8bff', '#a855f7', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];

function paramsSummary(f: FeatureInstance | undefined, deletedLabel: string): string {
  if (!f) return deletedLabel;
  const entries = Object.entries(f.params);
  const head = entries.slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(', ');
  return `${f.type}${head ? ` (${head}${entries.length > 3 ? ', …' : ''})` : ''}${f.enabled ? '' : ' [off]'}`;
}

export function VersionTreePanel({ isKo, documentId }: VersionTreePanelProps) {
  void isKo;
  const lang = useLang();
  const user = useAuthStore(s => s.user);
  const author = user?.name || user?.email || 'guest';

  // Real per-session model snapshot published by ShapeGeneratorInner.
  const featureItems = useShellBridge(s => s.featureItems);

  const repo = usePdmSessionStore(s => s.repo);
  const rev = usePdmSessionStore(s => s.rev);
  const isDemo = usePdmSessionStore(s => s.isDemo);
  const pendingMerge = usePdmSessionStore(s => s.pendingMerge);
  const init = usePdmSessionStore(s => s.init);
  const loadDemo = usePdmSessionStore(s => s.loadDemo);
  const reset = usePdmSessionStore(s => s.reset);
  const commit = usePdmSessionStore(s => s.commit);
  const createBranch = usePdmSessionStore(s => s.createBranch);
  const checkout = usePdmSessionStore(s => s.checkout);
  const startMerge = usePdmSessionStore(s => s.startMerge);
  const resolvePending = usePdmSessionStore(s => s.resolvePending);
  const applyMerge = usePdmSessionStore(s => s.applyMerge);
  const abortMerge = usePdmSessionStore(s => s.abortMerge);

  // ── G4 bridge: server-side history (advisory gate badges) ──────────────────
  const boundDocumentId = usePdmSessionStore(s => s.documentId);
  const bindDocument = usePdmSessionStore(s => s.bindDocument);
  const commitAndPersist = usePdmSessionStore(s => s.commitAndPersist);
  const persistCommit = usePdmSessionStore(s => s.persistCommit);
  const loadHistory = usePdmSessionStore(s => s.loadHistory);
  const checkoutServerVersion = usePdmSessionStore(s => s.checkoutServerVersion);
  const restoredGraph = usePdmSessionStore(s => s.restoredGraph);
  const lastPersistError = usePdmSessionStore(s => s.lastPersistError);
  const [showServerHistory, setShowServerHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  // Auto-bind when a caller supplies a real document id (no-op today — no
  // live caller passes one yet; see documentPersistence.ts's 260723 note).
  useEffect(() => {
    if (documentId && documentId !== boundDocumentId) bindDocument(documentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [commitMsg, setCommitMsg] = useState('');
  const [branchName, setBranchName] = useState('');
  const [mergeSource, setMergeSource] = useState('');

  // rev is the mutation counter for the mutable repo class — recompute below.
  const commits = useMemo(() => (repo ? repo.listCommits() : []), [repo, rev]);
  const branches = useMemo(() => (repo ? repo.listBranches() : []), [repo, rev]);
  const current = useMemo(() => (repo ? repo.current() : null), [repo, rev]);

  const graph = useMemo(
    () =>
      layoutCommitGraph(
        commits,
        branches.map(b => ({ branch: b.name, commitId: b.headCommitId })),
      ),
    [commits, branches],
  );
  const commitById = useMemo(() => new Map(commits.map(c => [c.id, c])), [commits]);
  const headsByCommit = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const b of branches) {
      const arr = m.get(b.headCommitId) ?? [];
      arr.push(b.name);
      m.set(b.headCommitId, arr);
    }
    return m;
  }, [branches]);

  const selected: Commit | null = selectedId ? commitById.get(selectedId) ?? null : null;
  const selectedParent: Commit | null =
    selected && selected.parents.length > 0
      ? commitById.get(selected.parents[0]!) ?? null
      : null;
  const selectedDiff = useMemo(
    () => (selected && selectedParent ? diffCommits(selectedParent, selected) : null),
    [selected, selectedParent],
  );

  const deletedLabel = loc(lang, { ko: '삭제됨', en: 'deleted', ja: '削除済み', zh: '已删除', es: 'eliminado', ar: 'محذوف' });

  // ─── Empty state — no session history yet ─────────────────────────────────
  if (!repo) {
    return (
      <div data-testid="pdm-empty" style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start', padding: 8, fontSize: 12, color: 'var(--nx-text)' }}>
        <div style={{ fontWeight: 700 }}>
          {loc(lang, { ko: '커밋 없음', en: 'No commits', ja: 'コミットなし', zh: '暂无提交', es: 'Sin commits', ar: 'لا توجد التزامات' })}
        </div>
        <div style={{ fontSize: 11, color: 'var(--nx-text-3)', maxWidth: 420 }}>
          {loc(lang, {
            ko: '이 세션에는 아직 버전 이력이 없습니다. 현재 모델 상태를 첫 커밋으로 기록하면 브랜치·머지를 사용할 수 있습니다. (세션 메모리 저장 — 서버 저장 미지원)',
            en: 'This session has no version history yet. Record the current model as the first commit to enable branching and merging. (In-memory only — no server persistence yet)',
            ja: 'このセッションにはまだバージョン履歴がありません。現在のモデルを最初のコミットとして記録すると、ブランチ・マージが使えます。（セッションメモリのみ — サーバ保存は未対応）',
            zh: '本会话尚无版本历史。将当前模型记录为第一个提交后即可使用分支与合并。（仅会话内存 — 暂不支持服务器保存）',
            es: 'Esta sesión aún no tiene historial de versiones. Registre el modelo actual como primer commit para habilitar ramas y fusiones. (Solo en memoria — sin persistencia en servidor)',
            ar: 'لا يوجد سجل إصدارات لهذه الجلسة بعد. سجّل النموذج الحالي كأول التزام لتفعيل التفريع والدمج. (في الذاكرة فقط — لا حفظ على الخادم بعد)',
          })}
        </div>
        <button
          data-testid="pdm-init-btn"
          onClick={() => {
            init(shellItemsToFeatureInstances(featureItems), author);
            if (boundDocumentId) {
              const root = usePdmSessionStore.getState().repo?.current().commit;
              if (root) void persistCommit(root);
            }
          }}
          style={primaryBtn}
        >
          {loc(lang, { ko: '현재 모델로 첫 커밋 기록', en: 'Record first commit from current model', ja: '現在のモデルで最初のコミットを記録', zh: '以当前模型记录首次提交', es: 'Registrar primer commit del modelo actual', ar: 'تسجيل أول التزام من النموذج الحالي' })}
          {` (${featureItems.length} ${loc(lang, { ko: '피처', en: 'features', ja: 'フィーチャー', zh: '特征', es: 'operaciones', ar: 'ميزات' })})`}
        </button>
        <button data-testid="pdm-demo-btn" onClick={loadDemo} style={ghostBtn}>
          {loc(lang, {
            ko: '샘플 데모 이력 보기 (실제 데이터 아님)',
            en: 'View sample demo history (not real data)',
            ja: 'サンプルデモ履歴を見る（実データではありません）',
            zh: '查看示例演示历史（非真实数据）',
            es: 'Ver historial de demostración (no son datos reales)',
            ar: 'عرض سجل تجريبي (ليست بيانات حقيقية)',
          })}
        </button>
      </div>
    );
  }

  // ─── Merge-in-progress view ───────────────────────────────────────────────
  const mergeView = pendingMerge && (
    <div data-testid="pdm-merge-view" style={{ display: 'flex', flexDirection: 'column', gap: 6, overflow: 'auto' }}>
      <div style={{ fontSize: 11, fontWeight: 700 }}>
        {loc(lang, { ko: '머지', en: 'Merge', ja: 'マージ', zh: '合并', es: 'Fusión', ar: 'دمج' })}
        {`: ${pendingMerge.sourceBranch} → ${pendingMerge.targetBranch}`}
      </div>
      <div style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>
        {loc(lang, { ko: '충돌', en: 'Conflicts', ja: '競合', zh: '冲突', es: 'Conflictos', ar: 'تعارضات' })}
        {`: ${pendingMerge.result.conflicts.length} · `}
        {loc(lang, { ko: '자동 병합', en: 'auto-merged', ja: '自動マージ', zh: '自动合并', es: 'auto-fusionadas', ar: 'مدموجة تلقائيًا' })}
        {`: ${pendingMerge.result.merged.length}`}
      </div>
      {pendingMerge.result.conflicts.map((c: MergeConflict) => (
        <div key={c.featureId} data-testid="pdm-conflict-row" style={{ border: '1px solid var(--nx-border)', borderRadius: 4, padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 10, fontWeight: 700 }}>
            {c.featureId} <span style={{ color: 'var(--nx-warn, #f59e0b)' }}>[{c.kind}]</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>
            {loc(lang, { ko: '내 쪽', en: 'ours', ja: '自分側', zh: '我方', es: 'nuestro', ar: 'جانبنا' })}: {paramsSummary(c.ours, deletedLabel)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>
            {loc(lang, { ko: '상대 쪽', en: 'theirs', ja: '相手側', zh: '对方', es: 'suyo', ar: 'جانبهم' })}: {paramsSummary(c.theirs, deletedLabel)}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button data-testid="pdm-conflict-ours" onClick={() => resolvePending(c.featureId, 'ours')} style={miniBtn}>
              {loc(lang, { ko: '내 것 선택', en: 'Take ours', ja: '自分側を採用', zh: '采用我方', es: 'Usar nuestro', ar: 'اختيار جانبنا' })}
            </button>
            <button data-testid="pdm-conflict-theirs" onClick={() => resolvePending(c.featureId, 'theirs')} style={miniBtn}>
              {loc(lang, { ko: '상대 것 선택', en: 'Take theirs', ja: '相手側を採用', zh: '采用对方', es: 'Usar suyo', ar: 'اختيار جانبهم' })}
            </button>
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          data-testid="pdm-merge-apply"
          disabled={pendingMerge.result.conflicts.length > 0}
          onClick={() => applyMerge(author)}
          style={{ ...primaryBtn, opacity: pendingMerge.result.conflicts.length > 0 ? 0.5 : 1 }}
        >
          {loc(lang, { ko: '머지 커밋 적용', en: 'Apply merge commit', ja: 'マージコミットを適用', zh: '应用合并提交', es: 'Aplicar commit de fusión', ar: 'تطبيق التزام الدمج' })}
        </button>
        <button data-testid="pdm-merge-abort" onClick={abortMerge} style={ghostBtn}>
          {loc(lang, { ko: '취소', en: 'Cancel', ja: 'キャンセル', zh: '取消', es: 'Cancelar', ar: 'إلغاء' })}
        </button>
      </div>
    </div>
  );

  // ─── Main view ────────────────────────────────────────────────────────────
  const COL_W = 34;
  const ROW_H = 26;
  const graphWidth = Math.max(280, 24 + graph.columnCount * COL_W + 260);
  const graphHeight = 18 + graph.nodes.length * ROW_H + 10;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, height: '100%', fontSize: 12, color: 'var(--nx-text)' }}>
      {isDemo && (
        <div data-testid="pdm-demo-banner" style={{ background: 'var(--nx-warn-bg, rgba(245,158,11,0.15))', border: '1px solid var(--nx-warn, #f59e0b)', borderRadius: 4, padding: '4px 8px', fontSize: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>
            {loc(lang, {
              ko: '데모 데이터 (샘플) — 실제 프로젝트 이력이 아닙니다',
              en: 'Demo data (sample) — not your real project history',
              ja: 'デモデータ（サンプル）— 実際のプロジェクト履歴ではありません',
              zh: '演示数据（示例）— 并非您的真实项目历史',
              es: 'Datos de demostración (muestra) — no es su historial real',
              ar: 'بيانات تجريبية (عينة) — ليست سجل مشروعك الحقيقي',
            })}
          </span>
          <button onClick={reset} style={miniBtn} data-testid="pdm-demo-exit">
            {loc(lang, { ko: '데모 종료', en: 'Exit demo', ja: 'デモ終了', zh: '退出演示', es: 'Salir de demo', ar: 'إنهاء التجربة' })}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
        {/* Graph */}
        <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
          <svg width={graphWidth} height={graphHeight} style={{ display: 'block' }}>
            {graph.nodes.map(n => n.parents.map(p => {
              const x1 = 24 + p.column * COL_W;
              const y1 = 18 + p.row * ROW_H;
              const x2 = 24 + n.column * COL_W;
              const y2 = 18 + n.row * ROW_H;
              return (
                <path
                  key={`e-${n.commitId}-${p.commitId}`}
                  d={`M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`}
                  fill="none"
                  stroke={BRANCH_COLORS[p.column % BRANCH_COLORS.length]}
                  strokeWidth="1.5"
                  opacity={0.8}
                />
              );
            }))}
            {graph.nodes.map(n => {
              const c = commitById.get(n.commitId);
              if (!c) return null;
              const x = 24 + n.column * COL_W;
              const y = 18 + n.row * ROW_H;
              const heads = headsByCommit.get(c.id) ?? [];
              const isSel = c.id === selectedId;
              return (
                <g key={c.id} data-testid="pdm-graph-node" onClick={() => setSelectedId(c.id)} style={{ cursor: 'pointer' }}>
                  <circle
                    cx={x} cy={y} r={isSel ? 7 : 5}
                    fill={BRANCH_COLORS[n.column % BRANCH_COLORS.length]}
                    stroke={isSel ? 'var(--nx-text)' : c.parents.length > 1 ? 'var(--nx-accent-2)' : 'transparent'}
                    strokeWidth="2"
                  />
                  <text x={24 + graph.columnCount * COL_W + 8} y={y + 3} fontSize="10" fill="var(--nx-text)" style={{ pointerEvents: 'none' }}>
                    {c.message}
                    {c.tags && c.tags.length > 0 && (
                      <tspan fill="var(--nx-accent-2)" dx="6">[{c.tags.join(', ')}]</tspan>
                    )}
                    {heads.length > 0 && (
                      <tspan fill="var(--nx-ok, #22c55e)" dx="6">
                        {heads.map(h => (h === current?.branchName ? `● ${h}` : h)).join(' · ')}
                      </tspan>
                    )}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Controls / detail / merge */}
        <div style={{ width: 240, borderLeft: '1px solid var(--nx-border)', paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto' }}>
          {mergeView ?? (
            <>
              {/* Branch checkout */}
              <label style={{ fontSize: 10, color: 'var(--nx-text-3)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {loc(lang, { ko: '현재 브랜치', en: 'Current branch', ja: '現在のブランチ', zh: '当前分支', es: 'Rama actual', ar: 'الفرع الحالي' })}
                <select
                  data-testid="pdm-branch-select"
                  value={current?.branchName ?? ''}
                  onChange={e => checkout(e.target.value)}
                  style={inputStyle}
                >
                  {branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
                </select>
              </label>
              <div style={{ fontSize: 9, color: 'var(--nx-text-3)' }}>
                {loc(lang, {
                  ko: '체크아웃하면 PDM HEAD와 해당 피처 스냅샷이 현재 모델에 함께 복원됩니다.',
                  en: 'Checkout restores the PDM HEAD and replays its feature snapshot into the live model.',
                  ja: 'チェックアウトすると、PDM HEADとフィーチャースナップショットが現在のモデルに復元されます。',
                  zh: '检出会恢复 PDM HEAD，并将其特征快照重新应用到当前模型。',
                  es: 'El checkout restaura el HEAD de PDM y reproduce su instantánea de operaciones en el modelo activo.',
                  ar: 'يعيد السحب رأس PDM ويطبّق لقطة الميزات الخاصة به على النموذج الحالي.',
                })}
              </div>

              {/* Commit current snapshot */}
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  data-testid="pdm-commit-msg"
                  value={commitMsg}
                  onChange={e => setCommitMsg(e.target.value)}
                  placeholder={loc(lang, { ko: '커밋 메시지', en: 'Commit message', ja: 'コミットメッセージ', zh: '提交信息', es: 'Mensaje de commit', ar: 'رسالة الالتزام' })}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  data-testid="pdm-commit-btn"
                  onClick={() => {
                    if (!commitMsg.trim()) return;
                    const msg = commitMsg.trim();
                    const feats = shellItemsToFeatureInstances(featureItems);
                    if (boundDocumentId) {
                      void commitAndPersist(feats, msg, author);
                    } else {
                      commit(feats, msg, author);
                    }
                    setCommitMsg('');
                  }}
                  style={miniBtn}
                >
                  {loc(lang, { ko: '커밋', en: 'Commit', ja: 'コミット', zh: '提交', es: 'Commit', ar: 'التزام' })}
                </button>
              </div>
              {lastPersistError && (
                <div data-testid="pdm-persist-error" style={{ fontSize: 9, color: 'var(--nx-danger, #ef4444)' }}>
                  {loc(lang, { ko: '서버 저장 실패', en: 'Server save failed', ja: 'サーバ保存失敗', zh: '服务器保存失败', es: 'Fallo al guardar', ar: 'فشل الحفظ' })}
                  {`: ${lastPersistError.reason}`}
                </div>
              )}

              {/* New branch */}
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  data-testid="pdm-branch-name"
                  value={branchName}
                  onChange={e => setBranchName(e.target.value)}
                  placeholder={loc(lang, { ko: '새 브랜치 이름', en: 'New branch name', ja: '新しいブランチ名', zh: '新分支名', es: 'Nombre de rama', ar: 'اسم الفرع الجديد' })}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  data-testid="pdm-branch-btn"
                  onClick={() => { if (createBranch(branchName)) setBranchName(''); }}
                  style={miniBtn}
                >
                  {loc(lang, { ko: '브랜치', en: 'Branch', ja: 'ブランチ', zh: '分支', es: 'Rama', ar: 'فرع' })}
                </button>
              </div>

              {/* Merge */}
              <div style={{ display: 'flex', gap: 4 }}>
                <select
                  data-testid="pdm-merge-source"
                  value={mergeSource}
                  onChange={e => setMergeSource(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                >
                  <option value="">
                    {loc(lang, { ko: '머지할 브랜치…', en: 'Branch to merge…', ja: 'マージするブランチ…', zh: '要合并的分支…', es: 'Rama a fusionar…', ar: 'فرع للدمج…' })}
                  </option>
                  {branches
                    .filter(b => b.name !== current?.branchName)
                    .map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
                </select>
                <button
                  data-testid="pdm-merge-btn"
                  disabled={!mergeSource}
                  onClick={() => { if (mergeSource) { startMerge(mergeSource); setMergeSource(''); } }}
                  style={{ ...miniBtn, opacity: mergeSource ? 1 : 0.5 }}
                >
                  {loc(lang, { ko: '머지', en: 'Merge', ja: 'マージ', zh: '合并', es: 'Fusionar', ar: 'دمج' })}
                </button>
              </div>

              {/* Selected commit detail */}
              {selected ? (
                <div data-testid="pdm-detail" style={{ borderTop: '1px solid var(--nx-border)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 700 }}>{selected.message}</div>
                  <div style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>
                    <div>{selected.authorUserId}</div>
                    <div>{new Date(selected.timestamp).toLocaleString()}</div>
                    <div>
                      {loc(lang, { ko: '피처', en: 'features', ja: 'フィーチャー', zh: '特征', es: 'operaciones', ar: 'ميزات' })}: {selected.features.length}
                      {selected.parents.length > 1 && (
                        <span style={{ color: 'var(--nx-accent-2)' }}> · merge</span>
                      )}
                    </div>
                    {selectedDiff && (
                      <div data-testid="pdm-detail-diff">
                        {`+${selectedDiff.added} −${selectedDiff.removed} ~${selectedDiff.modified}`}
                      </div>
                    )}
                    {selected.tags && selected.tags.length > 0 && <div>tags: {selected.tags.join(', ')}</div>}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--nx-text-3)' }}>
                  {loc(lang, { ko: '커밋을 선택하세요', en: 'Select a commit', ja: 'コミットを選択してください', zh: '请选择一个提交', es: 'Seleccione un commit', ar: 'اختر التزامًا' })}
                </div>
              )}

              {/* Server history (G4 bridge) — honest limits shown either way */}
              <div style={{ borderTop: '1px solid var(--nx-border)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button
                  data-testid="pdm-server-history-toggle"
                  onClick={() => setShowServerHistory(v => !v)}
                  style={{ ...ghostBtn, alignSelf: 'flex-start', padding: '4px 8px', height: 'auto', fontSize: 10 }}
                >
                  {loc(lang, { ko: '서버 이력', en: 'Server history', ja: 'サーバ履歴', zh: '服务器历史', es: 'Historial del servidor', ar: 'سجل الخادم' })}
                  {showServerHistory ? ' ▲' : ' ▼'}
                </button>
                {showServerHistory && (
                  !boundDocumentId ? (
                    <div style={{ fontSize: 9, color: 'var(--nx-text-3)' }}>
                      {loc(lang, {
                        ko: '이 세션은 서버 문서에 연결되어 있지 않습니다 — 커밋은 이 브라우저에만 저장됩니다.',
                        en: 'This session is not bound to a server document — commits are saved only in this browser.',
                        ja: 'このセッションはサーバ文書に接続されていません — コミットはこのブラウザにのみ保存されます。',
                        zh: '此会话未绑定到服务器文档 — 提交仅保存在此浏览器中。',
                        es: 'Esta sesión no está vinculada a un documento del servidor — los commits solo se guardan en este navegador.',
                        ar: 'هذه الجلسة غير مرتبطة بمستند خادم — يتم حفظ الالتزامات في هذا المتصفح فقط.',
                      })}
                    </div>
                  ) : (
                    <>
                      <button
                        data-testid="pdm-load-history-btn"
                        onClick={() => {
                          setHistoryLoading(true);
                          void loadHistory().finally(() => setHistoryLoading(false));
                        }}
                        disabled={historyLoading}
                        style={{ ...miniBtn, alignSelf: 'flex-start', opacity: historyLoading ? 0.6 : 1 }}
                      >
                        {loc(lang, { ko: '불러오기', en: 'Load', ja: '読み込み', zh: '加载', es: 'Cargar', ar: 'تحميل' })}
                      </button>
                      {restoredGraph && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {restoredGraph.skipped > 0 && (
                            <div style={{ fontSize: 9, color: 'var(--nx-text-3)' }}>
                              {loc(lang, { ko: '건너뜀', en: 'skipped', ja: 'スキップ', zh: '已跳过', es: 'omitidos', ar: 'تم التخطي' })}
                              {`: ${restoredGraph.skipped}`}
                            </div>
                          )}
                          {restoredGraph.commits.slice().reverse().map(c => (
                            <div key={c.versionId} data-testid="pdm-server-commit-row" style={{ fontSize: 9, color: 'var(--nx-text-3)', display: 'flex', gap: 4, alignItems: 'baseline' }}>
                              <span
                                data-testid="pdm-gate-badge"
                                title={c.gateReport?.map(g => `${g.id}: ${g.pass ? 'pass' : g.reason ?? 'fail'}`).join('\n') ?? ''}
                                style={{
                                  color: c.gateStatus === 'passed' ? 'var(--nx-ok, #22c55e)' : c.gateStatus === 'failed' ? 'var(--nx-danger, #ef4444)' : 'var(--nx-text-3)',
                                  fontWeight: 700,
                                }}
                              >
                                {c.gateStatus === 'passed' ? '✓' : c.gateStatus === 'failed' ? '✗' : '–'}
                              </span>
                              <span style={{ color: 'var(--nx-text)' }}>{c.message}</span>
                              <span>({c.branch})</span>
                              <button
                                type="button"
                                data-testid={`pdm-server-checkout-${c.id}`}
                                disabled={checkoutLoading !== null}
                                onClick={() => {
                                  setCheckoutLoading(c.id);
                                  void checkoutServerVersion(c.id).finally(() => setCheckoutLoading(null));
                                }}
                                style={{ ...miniBtn, height: 18, padding: '1px 5px', opacity: checkoutLoading !== null ? 0.55 : 1 }}
                              >
                                {checkoutLoading === c.id ? '…' : loc(lang, { ko: '복원', en: 'Restore', ja: '復元', zh: '恢复', es: 'Restaurar', ar: 'استعادة' })}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '6px 10px', height: 26, border: 0, borderRadius: 4,
  background: 'var(--nx-accent)', color: '#fff', fontSize: 11,
  fontWeight: 600, cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  padding: '6px 10px', height: 26,
  border: '1px solid var(--nx-border)', borderRadius: 4,
  background: 'transparent', color: 'var(--nx-text)',
  fontSize: 11, cursor: 'pointer',
};
const miniBtn: React.CSSProperties = {
  padding: '3px 8px', height: 22,
  border: '1px solid var(--nx-border)', borderRadius: 4,
  background: 'transparent', color: 'var(--nx-text)',
  fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap',
};
const inputStyle: React.CSSProperties = {
  height: 22, fontSize: 10, padding: '0 6px',
  border: '1px solid var(--nx-border)', borderRadius: 4,
  background: 'var(--nx-bg-2, transparent)', color: 'var(--nx-text)',
  minWidth: 0,
};
