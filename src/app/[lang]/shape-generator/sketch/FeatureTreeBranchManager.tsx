'use client';

/**
 * FeatureTreeBranchManager — Phase 2.10 UX surface for the whole-tree ops
 * exposed by `featureTreeOps.ts` (Agent-TTTTT).
 *
 * Standalone panel (NOT a wrapper of SolverSketchEditor). Lets the user:
 *   - Snapshot the current FeatureTree under a named branch (deep clone
 *     via `cloneTree`, persisted to localStorage).
 *   - List saved branches with rename / load / diff / merge / delete row
 *     actions.
 *   - Preview a structural diff (added / removed / modified counts) before
 *     loading or merging — gives the user a "what would change" gut check
 *     without committing.
 *   - Merge a branch into the current tree using the default 'suffix'
 *     collision strategy from `mergeTrees` and surface the resulting
 *     remap-count so the user knows that grafting renamed N nodes.
 *
 * Storage layout (governed by `storageKeyPrefix`, default
 * `nexyfab:tree-branches`):
 *   - `<prefix>:_index`           → JSON array of branch names (insertion
 *                                  order; oldest first, newest last). The
 *                                  oldest gets evicted when MAX_BRANCHES
 *                                  is exceeded.
 *   - `<prefix>:<branch-name>`    → JSON envelope `{ version: 1, tree }`
 *                                  produced by `serializeFeatureTree`.
 *                                  Reusing the persist envelope means a
 *                                  branch is interchangeable with the
 *                                  primary save slot — same recovery rules.
 *
 * MAX_BRANCHES = 20: a hard cap. We do NOT silently grow the index
 * because typical browsers cap localStorage at 5-10 MB per origin and a
 * pathological tree (~1000 nodes ≈ 150 KB JSON) × 20 = 3 MB, which is
 * comfortably under the budget. When the cap is hit on save, the oldest
 * branch is evicted (both index entry and its JSON blob) BEFORE the new
 * branch is appended — failing back to "stale data lingers in another
 * key" would surprise debug tooling.
 *
 * Why we re-use `serializeFeatureTree` instead of inlining JSON.stringify:
 *   - One on-wire format. A future *.nexyfab importer (Phase 3.x) can
 *     ingest a branch blob verbatim.
 *   - Cross-tab debugging stays grep-able with one schema, not two.
 *   - Versioning + payload validation come for free via
 *     `deserializeFeatureTree`. A corrupt or downrev'd branch blob is
 *     surfaced as a status message rather than silently rendering
 *     nothing — we still keep the row visible so the user can choose to
 *     delete the bad branch instead of losing UI access to it.
 *
 * Diff UX:
 *   - "Diff vs current" toggles a compact `+N -N ~N` strip (added /
 *     removed / modified). Clicking again on the same branch closes the
 *     panel; clicking on a different branch swaps the preview. We
 *     intentionally show counts only, not the per-node payload, because
 *     this panel is the entry point — a full visual diff would belong in
 *     a richer side-by-side view (out of scope for this batch).
 *
 * Merge UX:
 *   - We always use `mergeTrees(current, branch)` with the default
 *     'suffix' collision strategy. Picking a strategy here would inflate
 *     the row UI without enough signal — the suffix strategy is
 *     deterministic and never drops nodes (vs 'skip', which can cascade
 *     drop dependents and surprise the user). If a future "advanced
 *     merge" surface is needed, it gets its own modal.
 *   - The resulting tree is handed to the parent via `onLoadTree`
 *     (same pathway as plain Load). We surface the count of nodes that
 *     were remapped so the user knows the graft happened with collisions.
 *
 * Pure-prop callback contract:
 *   - We never mutate `currentTree`. Every operation that produces a new
 *     tree is fed back through `onLoadTree` so the parent owns state.
 *   - This mirrors the FeatureTreeView pattern — the panel does not have
 *     its own editor state for the working tree.
 *
 * Test surface (data-testids — all prefixed branch-manager-):
 *   branch-manager-panel
 *   branch-manager-header
 *   branch-manager-count
 *   branch-manager-empty
 *   branch-manager-new-name
 *   branch-manager-save
 *   branch-manager-status
 *   branch-manager-list
 *   branch-manager-row-{name}
 *   branch-manager-row-{name}-name
 *   branch-manager-row-{name}-name-input
 *   branch-manager-row-{name}-rename-confirm
 *   branch-manager-row-{name}-load
 *   branch-manager-row-{name}-diff
 *   branch-manager-row-{name}-merge
 *   branch-manager-row-{name}-delete
 *   branch-manager-row-{name}-diff-result
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  cloneTree,
  diffTrees,
  mergeTrees,
  type TreeDiff,
} from '@/lib/cad/featureTreeOps';
import {
  deserializeFeatureTree,
  serializeFeatureTree,
} from '@/lib/cad/featureTreePersist';
import type { FeatureTree } from '@/lib/cad/featureTree';

export type BranchManagerLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

const DEFAULT_PREFIX = 'nexyfab:tree-branches';
const INDEX_SUFFIX = '_index';
export const MAX_BRANCHES = 20;

// ─── i18n ─────────────────────────────────────────────────────────────────

interface Dict {
  branches: string;
  saveBranch: string;
  loadBranch: string;
  diffCurrent: string;
  mergeInto: string;
  deleteBranch: string;
  empty: string;
  branchNamePlaceholder: string;
  rename: string;
  renameConfirm: string;
  cancel: string;
  diffAdded: string;
  diffRemoved: string;
  diffModified: string;
  diffUnchanged: string;
  countPrefix: string;
  saveOk: string;
  saveErrorEmpty: string;
  saveErrorDuplicate: string;
  saveErrorQuota: string;
  loadOk: string;
  loadErrorCorrupt: string;
  mergeOk: string;
  mergeOkRemapped: string;
  mergeError: string;
  deleteOk: string;
  evictedOldest: string;
  confirmDelete: string;
}

const dict: Record<BranchManagerLang, Dict> = {
  ko: {
    branches: '브랜치',
    saveBranch: '현재 트리를 브랜치로 저장',
    loadBranch: '불러오기',
    diffCurrent: '현재와 비교',
    mergeInto: '현재에 병합',
    deleteBranch: '삭제',
    empty: '저장된 브랜치 없음',
    branchNamePlaceholder: '브랜치 이름',
    rename: '이름 변경',
    renameConfirm: '확인',
    cancel: '취소',
    diffAdded: '추가',
    diffRemoved: '삭제',
    diffModified: '수정',
    diffUnchanged: '유지',
    countPrefix: '개',
    saveOk: '저장됨',
    saveErrorEmpty: '브랜치 이름을 입력하세요',
    saveErrorDuplicate: '이미 같은 이름의 브랜치가 있습니다',
    saveErrorQuota: '저장 공간 부족',
    loadOk: '불러왔습니다',
    loadErrorCorrupt: '저장된 브랜치가 손상되었습니다',
    mergeOk: '병합됨',
    mergeOkRemapped: '병합됨 (ID 충돌 {n}건 재배치)',
    mergeError: '병합 실패',
    deleteOk: '삭제됨',
    evictedOldest: '오래된 브랜치 {n} 자동 삭제',
    confirmDelete: '정말 삭제하시겠습니까?',
  },
  en: {
    branches: 'Branches',
    saveBranch: 'Save current as branch',
    loadBranch: 'Load',
    diffCurrent: 'Diff vs current',
    mergeInto: 'Merge into current',
    deleteBranch: 'Delete',
    empty: 'No branches saved',
    branchNamePlaceholder: 'Branch name',
    rename: 'Rename',
    renameConfirm: 'OK',
    cancel: 'Cancel',
    diffAdded: 'added',
    diffRemoved: 'removed',
    diffModified: 'modified',
    diffUnchanged: 'unchanged',
    countPrefix: '',
    saveOk: 'Saved',
    saveErrorEmpty: 'Enter a branch name',
    saveErrorDuplicate: 'Branch with this name already exists',
    saveErrorQuota: 'Storage quota exceeded',
    loadOk: 'Loaded',
    loadErrorCorrupt: 'Branch data is corrupted',
    mergeOk: 'Merged',
    mergeOkRemapped: 'Merged ({n} id collisions remapped)',
    mergeError: 'Merge failed',
    deleteOk: 'Deleted',
    evictedOldest: 'Evicted oldest branch {n}',
    confirmDelete: 'Delete this branch?',
  },
  ja: {
    branches: 'ブランチ',
    saveBranch: '現在のツリーをブランチとして保存',
    loadBranch: '読込',
    diffCurrent: '現在と比較',
    mergeInto: '現在にマージ',
    deleteBranch: '削除',
    empty: '保存されたブランチなし',
    branchNamePlaceholder: 'ブランチ名',
    rename: '名前変更',
    renameConfirm: 'OK',
    cancel: 'キャンセル',
    diffAdded: '追加',
    diffRemoved: '削除',
    diffModified: '変更',
    diffUnchanged: '変更なし',
    countPrefix: '件',
    saveOk: '保存しました',
    saveErrorEmpty: 'ブランチ名を入力してください',
    saveErrorDuplicate: '同名のブランチが既にあります',
    saveErrorQuota: 'ストレージ容量超過',
    loadOk: '読み込みました',
    loadErrorCorrupt: 'ブランチデータが破損しています',
    mergeOk: 'マージしました',
    mergeOkRemapped: 'マージしました (ID衝突 {n}件を再割当)',
    mergeError: 'マージに失敗しました',
    deleteOk: '削除しました',
    evictedOldest: '最古のブランチ {n} を自動削除',
    confirmDelete: '本当に削除しますか?',
  },
  zh: {
    branches: '分支',
    saveBranch: '将当前保存为分支',
    loadBranch: '加载',
    diffCurrent: '与当前比较',
    mergeInto: '合并到当前',
    deleteBranch: '删除',
    empty: '尚未保存任何分支',
    branchNamePlaceholder: '分支名称',
    rename: '重命名',
    renameConfirm: '确定',
    cancel: '取消',
    diffAdded: '新增',
    diffRemoved: '移除',
    diffModified: '修改',
    diffUnchanged: '未变',
    countPrefix: '个',
    saveOk: '已保存',
    saveErrorEmpty: '请输入分支名称',
    saveErrorDuplicate: '已存在同名分支',
    saveErrorQuota: '存储空间不足',
    loadOk: '已加载',
    loadErrorCorrupt: '分支数据已损坏',
    mergeOk: '已合并',
    mergeOkRemapped: '已合并（重映射了 {n} 个 ID 冲突）',
    mergeError: '合并失败',
    deleteOk: '已删除',
    evictedOldest: '已自动移除最旧的分支 {n}',
    confirmDelete: '确定要删除该分支吗？',
  },
  es: {
    branches: 'Ramas',
    saveBranch: 'Guardar actual como rama',
    loadBranch: 'Cargar',
    diffCurrent: 'Comparar con actual',
    mergeInto: 'Fusionar con actual',
    deleteBranch: 'Eliminar',
    empty: 'No hay ramas guardadas',
    branchNamePlaceholder: 'Nombre de la rama',
    rename: 'Renombrar',
    renameConfirm: 'OK',
    cancel: 'Cancelar',
    diffAdded: 'añadido',
    diffRemoved: 'eliminado',
    diffModified: 'modificado',
    diffUnchanged: 'sin cambios',
    countPrefix: '',
    saveOk: 'Guardado',
    saveErrorEmpty: 'Introduce un nombre de rama',
    saveErrorDuplicate: 'Ya existe una rama con ese nombre',
    saveErrorQuota: 'Cuota de almacenamiento excedida',
    loadOk: 'Cargado',
    loadErrorCorrupt: 'Los datos de la rama están dañados',
    mergeOk: 'Fusionado',
    mergeOkRemapped: 'Fusionado ({n} colisiones de ID renombradas)',
    mergeError: 'Error al fusionar',
    deleteOk: 'Eliminado',
    evictedOldest: 'Se eliminó la rama más antigua {n}',
    confirmDelete: '¿Eliminar esta rama?',
  },
  ar: {
    branches: 'الفروع',
    saveBranch: 'حفظ الحالي كفرع',
    loadBranch: 'تحميل',
    diffCurrent: 'مقارنة بالحالي',
    mergeInto: 'دمج مع الحالي',
    deleteBranch: 'حذف',
    empty: 'لا توجد فروع محفوظة',
    branchNamePlaceholder: 'اسم الفرع',
    rename: 'إعادة تسمية',
    renameConfirm: 'موافق',
    cancel: 'إلغاء',
    diffAdded: 'مضاف',
    diffRemoved: 'محذوف',
    diffModified: 'معدل',
    diffUnchanged: 'دون تغيير',
    countPrefix: '',
    saveOk: 'تم الحفظ',
    saveErrorEmpty: 'أدخل اسم الفرع',
    saveErrorDuplicate: 'يوجد فرع بنفس الاسم بالفعل',
    saveErrorQuota: 'تم تجاوز سعة التخزين',
    loadOk: 'تم التحميل',
    loadErrorCorrupt: 'بيانات الفرع تالفة',
    mergeOk: 'تم الدمج',
    mergeOkRemapped: 'تم الدمج (إعادة تعيين {n} من تعارضات المعرفات)',
    mergeError: 'فشل الدمج',
    deleteOk: 'تم الحذف',
    evictedOldest: 'تم حذف أقدم فرع {n} تلقائياً',
    confirmDelete: 'هل تريد حذف هذا الفرع؟',
  },
};

// ─── storage helpers ──────────────────────────────────────────────────────

/**
 * Read the branch index list from localStorage. Returns [] for any failure
 * (missing key, malformed JSON, non-array shape). We intentionally do NOT
 * throw — a corrupted index becomes "no branches" so the UI keeps working.
 */
function readIndex(prefix: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${prefix}:${INDEX_SUFFIX}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    return [];
  }
}

function writeIndex(prefix: string, names: string[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(`${prefix}:${INDEX_SUFFIX}`, JSON.stringify(names));
}

function branchKey(prefix: string, name: string): string {
  return `${prefix}:${name}`;
}

function readBranchTree(prefix: string, name: string): FeatureTree | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(branchKey(prefix, name));
  if (!raw) return null;
  const res = deserializeFeatureTree(raw);
  return res.ok ? res.tree : null;
}

// ─── component ────────────────────────────────────────────────────────────

export interface FeatureTreeBranchManagerProps {
  lang: BranchManagerLang;
  currentTree: FeatureTree;
  onLoadTree: (tree: FeatureTree) => void;
  /** localStorage key prefix; default 'nexyfab:tree-branches'. */
  storageKeyPrefix?: string;
}

type StatusKind = 'info' | 'error';
interface Status {
  kind: StatusKind;
  message: string;
}

interface DiffPreview {
  branchName: string;
  diff: TreeDiff;
}

export default function FeatureTreeBranchManager(
  props: FeatureTreeBranchManagerProps,
): React.ReactElement {
  const { lang, currentTree, onLoadTree, storageKeyPrefix = DEFAULT_PREFIX } = props;
  const t = dict[lang];

  const [branches, setBranches] = useState<string[]>(() => readIndex(storageKeyPrefix));
  const [newName, setNewName] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [diffPreview, setDiffPreview] = useState<DiffPreview | null>(null);
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  // Re-read the index if the storage prefix prop changes — keeps the
  // component honest if the host swaps storage scopes.
  useEffect(() => {
    setBranches(readIndex(storageKeyPrefix));
    setDiffPreview(null);
    setStatus(null);
    setRenamingName(null);
  }, [storageKeyPrefix]);

  // ─── save current as branch ─────────────────────────────────────────────
  const handleSave = useCallback(() => {
    const name = newName.trim();
    if (!name) {
      setStatus({ kind: 'error', message: t.saveErrorEmpty });
      return;
    }
    const existing = readIndex(storageKeyPrefix);
    if (existing.includes(name)) {
      setStatus({ kind: 'error', message: t.saveErrorDuplicate });
      return;
    }

    // Snapshot via cloneTree so the in-memory branch payload is a true
    // deep copy. (The serialize call below would also detach references,
    // but cloning first matches the Agent-TTTTT documented contract for
    // "snapshot before transform".)
    const snapshot = cloneTree(currentTree);
    const json = serializeFeatureTree(snapshot);

    // Evict oldest if at the cap — perform the eviction BEFORE the write
    // so a quota-exceeded write doesn't strand the new branch in the
    // index without a payload.
    let evicted: string | null = null;
    const nextIndex = existing.slice();
    if (nextIndex.length >= MAX_BRANCHES) {
      evicted = nextIndex.shift() ?? null;
      if (evicted) {
        try { window.localStorage.removeItem(branchKey(storageKeyPrefix, evicted)); }
        catch { /* ignore */ }
      }
    }
    nextIndex.push(name);

    try {
      window.localStorage.setItem(branchKey(storageKeyPrefix, name), json);
      writeIndex(storageKeyPrefix, nextIndex);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/quota/i.test(msg)) {
        setStatus({ kind: 'error', message: t.saveErrorQuota });
      } else {
        setStatus({ kind: 'error', message: t.saveErrorQuota });
      }
      return;
    }

    setBranches(nextIndex);
    setNewName('');
    if (evicted) {
      setStatus({
        kind: 'info',
        message: `${t.saveOk} · ${t.evictedOldest.replace('{n}', evicted)}`,
      });
    } else {
      setStatus({ kind: 'info', message: t.saveOk });
    }
  }, [currentTree, newName, storageKeyPrefix, t]);

  // ─── load ───────────────────────────────────────────────────────────────
  const handleLoad = useCallback((name: string) => {
    const tree = readBranchTree(storageKeyPrefix, name);
    if (!tree) {
      setStatus({ kind: 'error', message: t.loadErrorCorrupt });
      return;
    }
    onLoadTree(tree);
    setStatus({ kind: 'info', message: t.loadOk });
  }, [onLoadTree, storageKeyPrefix, t]);

  // ─── diff ───────────────────────────────────────────────────────────────
  const handleDiff = useCallback((name: string) => {
    // Toggle off if we're already showing this branch.
    if (diffPreview?.branchName === name) {
      setDiffPreview(null);
      return;
    }
    const tree = readBranchTree(storageKeyPrefix, name);
    if (!tree) {
      setStatus({ kind: 'error', message: t.loadErrorCorrupt });
      return;
    }
    // Diff direction: branch (a) → current (b). "added" means present in
    // current but not in branch — i.e. the user would lose those if they
    // loaded the branch as-is. We label them with the user-facing words
    // anyway; the panel is symmetric enough that order doesn't mislead.
    const diff = diffTrees(tree, currentTree);
    setDiffPreview({ branchName: name, diff });
  }, [currentTree, diffPreview, storageKeyPrefix, t]);

  // ─── merge ──────────────────────────────────────────────────────────────
  const handleMerge = useCallback((name: string) => {
    const branchTree = readBranchTree(storageKeyPrefix, name);
    if (!branchTree) {
      setStatus({ kind: 'error', message: t.loadErrorCorrupt });
      return;
    }
    try {
      const result = mergeTrees(currentTree, branchTree);
      onLoadTree(result.merged);
      // remappedIds includes both renamed and dropped entries. For the
      // default 'suffix' strategy nothing is dropped, so the count equals
      // the renamed count.
      const remapCount = result.remappedIds.size;
      if (remapCount > 0) {
        setStatus({
          kind: 'info',
          message: t.mergeOkRemapped.replace('{n}', String(remapCount)),
        });
      } else {
        setStatus({ kind: 'info', message: t.mergeOk });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ kind: 'error', message: `${t.mergeError}: ${msg}` });
    }
  }, [currentTree, onLoadTree, storageKeyPrefix, t]);

  // ─── delete ─────────────────────────────────────────────────────────────
  const handleDelete = useCallback((name: string) => {
    try { window.localStorage.removeItem(branchKey(storageKeyPrefix, name)); }
    catch { /* ignore */ }
    const next = readIndex(storageKeyPrefix).filter((b) => b !== name);
    writeIndex(storageKeyPrefix, next);
    setBranches(next);
    if (diffPreview?.branchName === name) setDiffPreview(null);
    if (renamingName === name) {
      setRenamingName(null);
      setRenameDraft('');
    }
    setStatus({ kind: 'info', message: t.deleteOk });
  }, [diffPreview, renamingName, storageKeyPrefix, t]);

  // ─── rename ─────────────────────────────────────────────────────────────
  const startRename = useCallback((name: string) => {
    setRenamingName(name);
    setRenameDraft(name);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingName(null);
    setRenameDraft('');
  }, []);

  const confirmRename = useCallback((oldName: string) => {
    const next = renameDraft.trim();
    if (!next) {
      setStatus({ kind: 'error', message: t.saveErrorEmpty });
      return;
    }
    if (next === oldName) {
      setRenamingName(null);
      setRenameDraft('');
      return;
    }
    const idx = readIndex(storageKeyPrefix);
    if (idx.includes(next)) {
      setStatus({ kind: 'error', message: t.saveErrorDuplicate });
      return;
    }
    // Move the blob to the new key (preserve content verbatim — no
    // re-serialize so the on-disk envelope stays byte-identical).
    const oldKey = branchKey(storageKeyPrefix, oldName);
    const newKey = branchKey(storageKeyPrefix, next);
    const raw = window.localStorage.getItem(oldKey);
    if (raw !== null) {
      try { window.localStorage.setItem(newKey, raw); }
      catch {
        setStatus({ kind: 'error', message: t.saveErrorQuota });
        return;
      }
      try { window.localStorage.removeItem(oldKey); }
      catch { /* ignore */ }
    }
    const renamed = idx.map((b) => (b === oldName ? next : b));
    writeIndex(storageKeyPrefix, renamed);
    setBranches(renamed);
    if (diffPreview?.branchName === oldName) {
      setDiffPreview({ ...diffPreview, branchName: next });
    }
    setRenamingName(null);
    setRenameDraft('');
  }, [diffPreview, renameDraft, storageKeyPrefix, t]);

  // ─── render ─────────────────────────────────────────────────────────────
  return (
    <div
      data-testid="branch-manager-panel"
      style={{
        padding: 12,
        fontFamily: 'system-ui, sans-serif',
        background: 'var(--nx-panel, #111827)',
        color: 'var(--nx-text, #e5e7eb)',
        borderRadius: 6,
        minWidth: 280,
      }}
    >
      {/* header */}
      <div
        data-testid="branch-manager-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <span>{t.branches}</span>
        <span
          data-testid="branch-manager-count"
          style={{
            fontSize: 11,
            fontWeight: 400,
            color: 'var(--nx-text-3, #9ca3af)',
          }}
        >
          {branches.length}/{MAX_BRANCHES}
        </span>
      </div>

      {/* save row */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <input
          data-testid="branch-manager-new-name"
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t.branchNamePlaceholder}
          aria-label={t.branchNamePlaceholder}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            padding: '4px 6px',
            background: 'var(--nx-input, #1f2937)',
            color: 'inherit',
            border: '1px solid var(--nx-border, #374151)',
            borderRadius: 4,
          }}
        />
        <button
          data-testid="branch-manager-save"
          type="button"
          onClick={handleSave}
          style={{
            fontSize: 12,
            padding: '4px 8px',
            background: 'var(--nx-accent, #2563eb)',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            flex: '0 0 auto',
          }}
        >
          {t.saveBranch}
        </button>
      </div>

      {/* status line */}
      {status && (
        <div
          data-testid="branch-manager-status"
          data-status-kind={status.kind}
          style={{
            fontSize: 11,
            marginBottom: 8,
            padding: '4px 6px',
            background: status.kind === 'error'
              ? 'var(--nx-error-bg, rgba(239,68,68,0.15))'
              : 'var(--nx-info-bg, rgba(59,130,246,0.12))',
            color: status.kind === 'error'
              ? 'var(--nx-error, #fca5a5)'
              : 'var(--nx-info, #93c5fd)',
            borderRadius: 4,
          }}
        >
          {status.message}
        </div>
      )}

      {/* branch list */}
      {branches.length === 0 ? (
        <div
          data-testid="branch-manager-empty"
          style={{
            fontSize: 12,
            fontStyle: 'italic',
            color: 'var(--nx-text-3, #9ca3af)',
            padding: '12px 4px',
            textAlign: 'center',
          }}
        >
          {t.empty}
        </div>
      ) : (
        <div data-testid="branch-manager-list" role="list">
          {branches.map((name) => (
            <BranchRow
              key={name}
              name={name}
              t={t}
              renaming={renamingName === name}
              renameDraft={renameDraft}
              diffOpen={diffPreview?.branchName === name}
              diff={diffPreview?.branchName === name ? diffPreview.diff : null}
              onStartRename={startRename}
              onRenameDraft={setRenameDraft}
              onConfirmRename={confirmRename}
              onCancelRename={cancelRename}
              onLoad={handleLoad}
              onDiff={handleDiff}
              onMerge={handleMerge}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── row ──────────────────────────────────────────────────────────────────

interface RowProps {
  name: string;
  t: Dict;
  renaming: boolean;
  renameDraft: string;
  diffOpen: boolean;
  diff: TreeDiff | null;
  onStartRename: (name: string) => void;
  onRenameDraft: (draft: string) => void;
  onConfirmRename: (oldName: string) => void;
  onCancelRename: () => void;
  onLoad: (name: string) => void;
  onDiff: (name: string) => void;
  onMerge: (name: string) => void;
  onDelete: (name: string) => void;
}

function BranchRow(props: RowProps): React.ReactElement {
  const {
    name, t, renaming, renameDraft, diffOpen, diff,
    onStartRename, onRenameDraft, onConfirmRename, onCancelRename,
    onLoad, onDiff, onMerge, onDelete,
  } = props;

  const btnStyle: React.CSSProperties = {
    fontSize: 11,
    padding: '3px 6px',
    background: 'var(--nx-button, #1f2937)',
    color: 'var(--nx-text-2, #d1d5db)',
    border: '1px solid var(--nx-border, #374151)',
    borderRadius: 3,
    cursor: 'pointer',
    flex: '0 0 auto',
  };

  return (
    <div
      role="listitem"
      data-testid={`branch-manager-row-${name}`}
      data-branch-name={name}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '6px 4px',
        borderBottom: '1px solid var(--nx-border-soft, rgba(255,255,255,0.05))',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {renaming ? (
          <>
            <input
              data-testid={`branch-manager-row-${name}-name-input`}
              type="text"
              value={renameDraft}
              onChange={(e) => onRenameDraft(e.target.value)}
              aria-label={t.rename}
              style={{
                flex: 1,
                minWidth: 80,
                fontSize: 12,
                padding: '3px 5px',
                background: 'var(--nx-input, #1f2937)',
                color: 'inherit',
                border: '1px solid var(--nx-border, #374151)',
                borderRadius: 3,
              }}
            />
            <button
              data-testid={`branch-manager-row-${name}-rename-confirm`}
              type="button"
              onClick={() => onConfirmRename(name)}
              style={btnStyle}
            >
              {t.renameConfirm}
            </button>
            <button
              type="button"
              onClick={onCancelRename}
              style={btnStyle}
              aria-label={t.cancel}
            >
              {t.cancel}
            </button>
          </>
        ) : (
          <button
            data-testid={`branch-manager-row-${name}-name`}
            type="button"
            onClick={() => onStartRename(name)}
            title={t.rename}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              fontWeight: 500,
              textAlign: 'left',
              background: 'transparent',
              color: 'inherit',
              border: 'none',
              padding: '3px 4px',
              cursor: 'text',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <button
          data-testid={`branch-manager-row-${name}-load`}
          type="button"
          onClick={() => onLoad(name)}
          style={btnStyle}
        >
          {t.loadBranch}
        </button>
        <button
          data-testid={`branch-manager-row-${name}-diff`}
          type="button"
          onClick={() => onDiff(name)}
          style={btnStyle}
          aria-pressed={diffOpen}
        >
          {t.diffCurrent}
        </button>
        <button
          data-testid={`branch-manager-row-${name}-merge`}
          type="button"
          onClick={() => onMerge(name)}
          style={btnStyle}
        >
          {t.mergeInto}
        </button>
        <button
          data-testid={`branch-manager-row-${name}-delete`}
          type="button"
          onClick={() => onDelete(name)}
          aria-label={t.deleteBranch}
          title={t.deleteBranch}
          style={{
            ...btnStyle,
            color: 'var(--nx-danger, #f87171)',
          }}
        >
          {t.deleteBranch}
        </button>
      </div>

      {diffOpen && diff && (
        <div
          data-testid={`branch-manager-row-${name}-diff-result`}
          data-added={diff.added.length}
          data-removed={diff.removed.length}
          data-modified={diff.modified.length}
          data-unchanged={diff.unchanged.length}
          style={{
            display: 'flex',
            gap: 8,
            fontSize: 11,
            padding: '4px 6px',
            background: 'var(--nx-row, rgba(255,255,255,0.04))',
            borderRadius: 3,
            fontFamily: 'monospace',
          }}
        >
          <span style={{ color: 'var(--nx-success, #4ade80)' }}>
            +{diff.added.length} {t.diffAdded}
          </span>
          <span style={{ color: 'var(--nx-danger, #f87171)' }}>
            -{diff.removed.length} {t.diffRemoved}
          </span>
          <span style={{ color: 'var(--nx-warning, #fbbf24)' }}>
            ~{diff.modified.length} {t.diffModified}
          </span>
          <span style={{ color: 'var(--nx-text-3, #9ca3af)' }}>
            ={diff.unchanged.length} {t.diffUnchanged}
          </span>
        </div>
      )}
    </div>
  );
}
