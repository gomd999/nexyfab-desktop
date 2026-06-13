'use client';

/**
 * SketchGroupPanel — Phase 2.x of NexyFab Pro own-CAD (ADR-013).
 *
 * Standalone UI for the SketchGroupManager (lib/sketch/sketchGroup.ts):
 *   - "Group selected (N)" button (disabled when fewer than 2 selected).
 *   - Per-group row: name + count + lock toggle + transform inputs
 *     (translate dx/dy, rotate °, scale factor) + delete.
 *
 * Standalone-by-design:
 *   - Has NO dependency on planegcs / SketchSolver. Tests mount in jsdom
 *     without booting WASM. The host (SolverSketchEditor) owns the
 *     SketchGroupManager + solver and routes group-mutations into it.
 *
 * Props are typed against `SketchGroup` (a read-only snapshot shape) and
 * the callbacks return void; the host is responsible for re-solving the
 * solver after each transform.
 *
 * Test surface (data-testids):
 *   solver-sketch-group-panel
 *   solver-sketch-group-create               (the "Group selected (N)" button)
 *   solver-sketch-group-row-{groupId}
 *   solver-sketch-group-name-{groupId}
 *   solver-sketch-group-count-{groupId}
 *   solver-sketch-group-lock-{groupId}       (lock toggle button)
 *   solver-sketch-group-translate-dx-{groupId}
 *   solver-sketch-group-translate-dy-{groupId}
 *   solver-sketch-group-translate-apply-{groupId}
 *   solver-sketch-group-rotate-deg-{groupId}
 *   solver-sketch-group-rotate-apply-{groupId}
 *   solver-sketch-group-scale-factor-{groupId}
 *   solver-sketch-group-scale-apply-{groupId}
 *   solver-sketch-group-delete-{groupId}
 *   solver-sketch-group-empty                 (hint when groups.length === 0)
 */

import React, { useCallback, useState } from 'react';
import type { SketchGroup } from '@/lib/sketch/sketchGroup';

// ─── i18n (6 langs) ────────────────────────────────────────────────────────

export type EditorLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  title: string;
  groups: string;
  groupSelected: string;          // "Group selected"
  groupSelectedHint: string;      // "Select ≥ 2 entities to group"
  groupName: string;              // prompt-label / placeholder
  defaultGroupName: string;       // "Group {n}"
  empty: string;                  // "No groups yet"
  count: string;                  // "N items"
  locked: string;
  unlocked: string;
  translate: string;
  rotate: string;
  scale: string;
  apply: string;
  delete: string;
  dx: string;
  dy: string;
  deg: string;
  factor: string;
  confirmDelete: string;
}

const dict: Record<EditorLang, Dict> = {
  ko: {
    title: '그룹', groups: '그룹',
    groupSelected: '선택 항목 그룹화',
    groupSelectedHint: '2개 이상 선택해야 그룹화 가능',
    groupName: '그룹 이름',
    defaultGroupName: '그룹',
    empty: '그룹이 없습니다',
    count: '개 항목',
    locked: '잠금', unlocked: '잠금 해제',
    translate: '이동', rotate: '회전', scale: '크기',
    apply: '적용', delete: '삭제',
    dx: 'dx', dy: 'dy', deg: '°', factor: '배율',
    confirmDelete: '이 그룹을 삭제하시겠습니까?',
  },
  en: {
    title: 'Groups', groups: 'Groups',
    groupSelected: 'Group selected',
    groupSelectedHint: 'Select ≥ 2 entities to group',
    groupName: 'Group name',
    defaultGroupName: 'Group',
    empty: 'No groups yet',
    count: 'items',
    locked: 'Locked', unlocked: 'Unlocked',
    translate: 'Translate', rotate: 'Rotate', scale: 'Scale',
    apply: 'Apply', delete: 'Delete',
    dx: 'dx', dy: 'dy', deg: '°', factor: 'factor',
    confirmDelete: 'Delete this group?',
  },
  ja: {
    title: 'グループ', groups: 'グループ',
    groupSelected: '選択をグループ化',
    groupSelectedHint: '2つ以上選択でグループ化',
    groupName: 'グループ名',
    defaultGroupName: 'グループ',
    empty: 'グループはありません',
    count: '個',
    locked: 'ロック中', unlocked: 'ロック解除',
    translate: '移動', rotate: '回転', scale: 'スケール',
    apply: '適用', delete: '削除',
    dx: 'dx', dy: 'dy', deg: '°', factor: '倍率',
    confirmDelete: 'このグループを削除しますか?',
  },
  zh: {
    title: '组', groups: '组',
    groupSelected: '将所选编为组',
    groupSelectedHint: '至少选择 2 个实体',
    groupName: '组名',
    defaultGroupName: '组',
    empty: '尚无分组',
    count: '项',
    locked: '已锁定', unlocked: '已解锁',
    translate: '平移', rotate: '旋转', scale: '缩放',
    apply: '应用', delete: '删除',
    dx: 'dx', dy: 'dy', deg: '°', factor: '倍率',
    confirmDelete: '是否删除此分组?',
  },
  es: {
    title: 'Grupos', groups: 'Grupos',
    groupSelected: 'Agrupar selección',
    groupSelectedHint: 'Selecciona ≥ 2 entidades para agrupar',
    groupName: 'Nombre del grupo',
    defaultGroupName: 'Grupo',
    empty: 'Sin grupos',
    count: 'elementos',
    locked: 'Bloqueado', unlocked: 'Desbloqueado',
    translate: 'Trasladar', rotate: 'Rotar', scale: 'Escalar',
    apply: 'Aplicar', delete: 'Eliminar',
    dx: 'dx', dy: 'dy', deg: '°', factor: 'factor',
    confirmDelete: '¿Eliminar este grupo?',
  },
  ar: {
    title: 'مجموعات', groups: 'مجموعات',
    groupSelected: 'تجميع المحدد',
    groupSelectedHint: 'حدد كيانين على الأقل للتجميع',
    groupName: 'اسم المجموعة',
    defaultGroupName: 'مجموعة',
    empty: 'لا توجد مجموعات بعد',
    count: 'عنصر',
    locked: 'مقفل', unlocked: 'غير مقفل',
    translate: 'إزاحة', rotate: 'تدوير', scale: 'تحجيم',
    apply: 'تطبيق', delete: 'حذف',
    dx: 'dx', dy: 'dy', deg: '°', factor: 'عامل',
    confirmDelete: 'حذف هذه المجموعة؟',
  },
};

// ─── types ────────────────────────────────────────────────────────────────

export interface SketchSelectionRef {
  /** entity kind (matches lib/sketch/solver kinds) — opaque to this panel. */
  kind: string;
  id: string;
}

export interface SketchGroupPanelProps {
  lang?: EditorLang;
  groups: ReadonlyArray<SketchGroup>;
  selection: ReadonlyArray<SketchSelectionRef>;
  onCreate: (
    name: string,
    entityIds: string[],
    anchor?: { x: number; y: number },
  ) => void;
  onRemove: (groupId: string) => void;
  onTranslate: (groupId: string, dx: number, dy: number) => void;
  onRotate: (groupId: string, angleRad: number) => void;
  onScale: (groupId: string, factor: number) => void;
  onToggleLock: (groupId: string) => void;
}

// ─── helpers ──────────────────────────────────────────────────────────────

function parseFinite(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Per-row transform-input local state. Stored in a map by groupId so each
// row keeps its own draft; we don't push every keystroke to the solver.
interface RowDraft {
  dx: string;
  dy: string;
  deg: string;
  factor: string;
}

const EMPTY_DRAFT: RowDraft = { dx: '0', dy: '0', deg: '0', factor: '1' };

// ─── component ────────────────────────────────────────────────────────────

export default function SketchGroupPanel({
  lang = 'en',
  groups,
  selection,
  onCreate,
  onRemove,
  onTranslate,
  onRotate,
  onScale,
  onToggleLock,
}: SketchGroupPanelProps): React.ReactElement {
  const t = dict[lang];

  // Per-group drafts. Initialised lazily on first interaction; missing
  // entries treated as EMPTY_DRAFT in the reader.
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});

  const draftOf = useCallback(
    (gid: string): RowDraft => drafts[gid] ?? EMPTY_DRAFT,
    [drafts],
  );

  const setDraftField = useCallback(
    (gid: string, field: keyof RowDraft, value: string): void => {
      setDrafts((prev) => ({
        ...prev,
        [gid]: { ...(prev[gid] ?? EMPTY_DRAFT), [field]: value },
      }));
    },
    [],
  );

  // ─── create handler ────────────────────────────────────────────────────
  const canGroup = selection.length >= 2;
  const handleCreate = useCallback((): void => {
    if (!canGroup) return;
    const ids = selection.map((s) => s.id);
    // Suggest a default name. Caller (host) can override via window.prompt
    // upstream; this panel keeps the API simple — name is required so we
    // synthesise one and let the host's onCreate decide whether to prompt.
    const defaultName = `${t.defaultGroupName} ${groups.length + 1}`;
    onCreate(defaultName, ids);
  }, [canGroup, selection, t.defaultGroupName, groups.length, onCreate]);

  // ─── per-row handlers ──────────────────────────────────────────────────
  const handleTranslate = useCallback(
    (gid: string): void => {
      const d = draftOf(gid);
      const dx = parseFinite(d.dx);
      const dy = parseFinite(d.dy);
      if (dx === null || dy === null) return;
      onTranslate(gid, dx, dy);
    },
    [draftOf, onTranslate],
  );

  const handleRotate = useCallback(
    (gid: string): void => {
      const d = draftOf(gid);
      const deg = parseFinite(d.deg);
      if (deg === null) return;
      onRotate(gid, (deg * Math.PI) / 180);
    },
    [draftOf, onRotate],
  );

  const handleScale = useCallback(
    (gid: string): void => {
      const d = draftOf(gid);
      const f = parseFinite(d.factor);
      if (f === null || f === 0) return;
      onScale(gid, f);
    },
    [draftOf, onScale],
  );

  const handleDelete = useCallback(
    (gid: string): void => {
      // window.confirm guard — tests stub this. Skip the delete if the user
      // dismisses. Same UX pattern as SketchEntityPropertyPanel.bulkDelete.
      const ok =
        typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm(t.confirmDelete)
          : true;
      if (!ok) return;
      onRemove(gid);
    },
    [t.confirmDelete, onRemove],
  );

  // ─── render ────────────────────────────────────────────────────────────

  return (
    <div
      data-testid="solver-sketch-group-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 10,
        background: 'var(--nx-panel)',
        border: '1px solid var(--nx-border)',
        borderRadius: 6,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        color: 'var(--nx-text)',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{t.groups}</h3>
      </header>

      <button
        type="button"
        data-testid="solver-sketch-group-create"
        onClick={handleCreate}
        disabled={!canGroup}
        title={canGroup ? undefined : t.groupSelectedHint}
        style={{
          padding: '6px 10px',
          fontSize: 12,
          background: canGroup ? '#2563eb' : 'var(--nx-panel-2)',
          color: canGroup ? '#fff' : 'var(--nx-text-2)',
          border: '1px solid ' + (canGroup ? '#2563eb' : 'var(--nx-border)'),
          borderRadius: 4,
          cursor: canGroup ? 'pointer' : 'not-allowed',
        }}
      >
        {t.groupSelected} ({selection.length})
      </button>

      {groups.length === 0 ? (
        <div
          data-testid="solver-sketch-group-empty"
          style={{ fontSize: 11, color: 'var(--nx-text-2)', textAlign: 'center', padding: '8px 0' }}
        >
          {t.empty}
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {groups.map((g) => {
            const d = draftOf(g.id);
            return (
              <li
                key={g.id}
                data-testid={`solver-sketch-group-row-${g.id}`}
                data-group-locked={g.locked}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  padding: 6,
                  border: '1px solid var(--nx-border)',
                  borderRadius: 4,
                  background: g.locked ? '#fef3c7' : 'var(--nx-panel-2)',
                }}
              >
                {/* row header: name + count + lock + delete */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    data-testid={`solver-sketch-group-name-${g.id}`}
                    style={{ fontWeight: 600, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {g.name}
                  </span>
                  <span
                    data-testid={`solver-sketch-group-count-${g.id}`}
                    style={{ color: 'var(--nx-text-2)', fontSize: 11 }}
                  >
                    {g.entityIds.length} {t.count}
                  </span>
                  <button
                    type="button"
                    data-testid={`solver-sketch-group-lock-${g.id}`}
                    aria-pressed={g.locked}
                    onClick={() => onToggleLock(g.id)}
                    title={g.locked ? t.locked : t.unlocked}
                    style={{
                      padding: '2px 6px',
                      fontSize: 11,
                      background: g.locked ? '#d97706' : 'var(--nx-panel)',
                      color: g.locked ? '#fff' : 'var(--nx-text-2)',
                      border: '1px solid ' + (g.locked ? '#d97706' : 'var(--nx-border)'),
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    {g.locked ? t.locked : t.unlocked}
                  </button>
                  <button
                    type="button"
                    data-testid={`solver-sketch-group-delete-${g.id}`}
                    onClick={() => handleDelete(g.id)}
                    title={t.delete}
                    style={{
                      padding: '2px 6px',
                      fontSize: 11,
                      background: 'var(--nx-panel)',
                      color: '#dc2626',
                      border: '1px solid #fca5a5',
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    {t.delete}
                  </button>
                </div>

                {/* translate row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 64, color: 'var(--nx-text-2)' }}>{t.translate}</span>
                  <input
                    data-testid={`solver-sketch-group-translate-dx-${g.id}`}
                    type="number"
                    aria-label={`${t.translate} ${t.dx}`}
                    value={d.dx}
                    disabled={g.locked}
                    onChange={(e) => setDraftField(g.id, 'dx', e.target.value)}
                    style={{ width: 60, fontSize: 11, padding: '2px 4px' }}
                  />
                  <input
                    data-testid={`solver-sketch-group-translate-dy-${g.id}`}
                    type="number"
                    aria-label={`${t.translate} ${t.dy}`}
                    value={d.dy}
                    disabled={g.locked}
                    onChange={(e) => setDraftField(g.id, 'dy', e.target.value)}
                    style={{ width: 60, fontSize: 11, padding: '2px 4px' }}
                  />
                  <button
                    type="button"
                    data-testid={`solver-sketch-group-translate-apply-${g.id}`}
                    onClick={() => handleTranslate(g.id)}
                    disabled={g.locked}
                    style={{
                      padding: '2px 8px',
                      fontSize: 11,
                      background: g.locked ? 'var(--nx-panel-2)' : 'var(--nx-panel)',
                      color: g.locked ? 'var(--nx-text-2)' : 'var(--nx-text)',
                      border: '1px solid var(--nx-border)',
                      borderRadius: 3,
                      cursor: g.locked ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {t.apply}
                  </button>
                </div>

                {/* rotate row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 64, color: 'var(--nx-text-2)' }}>{t.rotate}</span>
                  <input
                    data-testid={`solver-sketch-group-rotate-deg-${g.id}`}
                    type="number"
                    aria-label={`${t.rotate} ${t.deg}`}
                    value={d.deg}
                    disabled={g.locked}
                    onChange={(e) => setDraftField(g.id, 'deg', e.target.value)}
                    style={{ width: 60, fontSize: 11, padding: '2px 4px' }}
                  />
                  <span style={{ color: 'var(--nx-text-2)' }}>{t.deg}</span>
                  <button
                    type="button"
                    data-testid={`solver-sketch-group-rotate-apply-${g.id}`}
                    onClick={() => handleRotate(g.id)}
                    disabled={g.locked}
                    style={{
                      padding: '2px 8px',
                      fontSize: 11,
                      background: g.locked ? 'var(--nx-panel-2)' : 'var(--nx-panel)',
                      color: g.locked ? 'var(--nx-text-2)' : 'var(--nx-text)',
                      border: '1px solid var(--nx-border)',
                      borderRadius: 3,
                      cursor: g.locked ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {t.apply}
                  </button>
                </div>

                {/* scale row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 64, color: 'var(--nx-text-2)' }}>{t.scale}</span>
                  <input
                    data-testid={`solver-sketch-group-scale-factor-${g.id}`}
                    type="number"
                    aria-label={`${t.scale} ${t.factor}`}
                    value={d.factor}
                    disabled={g.locked}
                    onChange={(e) => setDraftField(g.id, 'factor', e.target.value)}
                    style={{ width: 60, fontSize: 11, padding: '2px 4px' }}
                  />
                  <button
                    type="button"
                    data-testid={`solver-sketch-group-scale-apply-${g.id}`}
                    onClick={() => handleScale(g.id)}
                    disabled={g.locked}
                    style={{
                      padding: '2px 8px',
                      fontSize: 11,
                      background: g.locked ? 'var(--nx-panel-2)' : 'var(--nx-panel)',
                      color: g.locked ? 'var(--nx-text-2)' : 'var(--nx-text)',
                      border: '1px solid var(--nx-border)',
                      borderRadius: 3,
                      cursor: g.locked ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {t.apply}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
