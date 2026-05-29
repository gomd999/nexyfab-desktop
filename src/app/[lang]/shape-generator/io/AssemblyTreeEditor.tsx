'use client';

/**
 * AssemblyTreeEditor.tsx — Phase D++ nested sub-assembly tree builder UI.
 *
 * Companion to `stitchNestedAssemblyHierarchy` in `assemblyStepHierarchy.ts`.
 * That stitcher consumes a recursive `AssemblySubNode` tree (root sub-asm →
 * sub-asm | leaf, arbitrary depth) and emits STEP with proper NAUO + IDT
 * entities. Until now there was no UI to build that tree — bodies were
 * implicitly flattened by the v1/v2 flat exporters. This editor lets the
 * user shape the assembly hierarchy before kicking off the v2.1 export.
 *
 *   Assembly (root)              [Add part] [Add sub]
 *   ├── Bracket_L      tx 0 ty 0 tz 0       [×]
 *   └── Gearbox (sub)  tx 0 ty 0 tz 0       [Add part] [Add sub] [×]
 *       ├── Housing                          [×]
 *       └── Shaft      tx 10 ty 0 tz 0       [×]
 *
 * Leaf identity: a leaf node carries a `partId` chosen from the host's
 * `availablePartIds` (the scene's actual leaf bodies). The component
 * stores a placeholder `stepText: ''` per leaf — the host fills in the
 * real per-part STEP at export time by matching `partId`. (Carrying
 * megabytes of STEP through this UI tree would be both wasteful and
 * make the controlled `onChange` round-trip painfully slow.)
 *
 * Sub-assembly identity: each `subAssembly` node gets a stable
 * `subAsmId` (used in NAUO 'name' fields + diagnostics). New sub-asm
 * nodes get an auto-generated id (`sub_<counter>`) — user can rename
 * via the label input; we don't ask for a separate id since the label
 * is already used as the display name.
 *
 * Transforms: only translation is exposed in the UI for v1 — rotation
 * needs a 3D gizmo to be usable. The stitcher accepts a full Matrix4,
 * so future revisions can swap in a quaternion editor without touching
 * the tree shape.
 *
 * No external libs — inline styles, react state, plain dropdowns.
 */

import React, { useCallback, useMemo } from 'react';
import * as THREE from 'three';
import type { AssemblySubNode } from './assemblyStepHierarchy';

// ─── i18n (inline dict) ────────────────────────────────────────────────────

export type Lang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

export interface Dict {
  readonly assemblyRoot: string;
  readonly subAssembly: string;
  readonly part: string;
  readonly addPart: string;
  readonly addSubAssembly: string;
  readonly remove: string;
  readonly label: string;
  readonly translate: string;
  readonly toolBody: string;
  readonly selectPart: string;
  readonly noPartsAvailable: string;
  readonly emptyTree: string;
}

const DICTS: Record<Lang, Dict> = {
  ko: {
    assemblyRoot: '어셈블리 (루트)',
    subAssembly: '서브 어셈블리',
    part: '부품',
    addPart: '부품 추가',
    addSubAssembly: '서브 어셈블리 추가',
    remove: '제거',
    label: '레이블',
    translate: '이동',
    toolBody: '도구 바디',
    selectPart: '부품 선택…',
    noPartsAvailable: '사용 가능한 부품 없음',
    emptyTree: '아직 항목이 없습니다',
  },
  en: {
    assemblyRoot: 'Assembly (root)',
    subAssembly: 'Sub-assembly',
    part: 'Part',
    addPart: 'Add part',
    addSubAssembly: 'Add sub-assembly',
    remove: 'Remove',
    label: 'Label',
    translate: 'Translate',
    toolBody: 'Tool body',
    selectPart: 'Select part…',
    noPartsAvailable: 'No parts available',
    emptyTree: 'No items yet',
  },
  ja: {
    assemblyRoot: 'アセンブリ (ルート)',
    subAssembly: 'サブアセンブリ',
    part: '部品',
    addPart: '部品を追加',
    addSubAssembly: 'サブアセンブリを追加',
    remove: '削除',
    label: 'ラベル',
    translate: '移動',
    toolBody: 'ツールボディ',
    selectPart: '部品を選択…',
    noPartsAvailable: '利用可能な部品なし',
    emptyTree: '項目がまだありません',
  },
  zh: {
    assemblyRoot: '装配体 (根)',
    subAssembly: '子装配体',
    part: '零件',
    addPart: '添加零件',
    addSubAssembly: '添加子装配体',
    remove: '移除',
    label: '标签',
    translate: '平移',
    toolBody: '工具体',
    selectPart: '选择零件…',
    noPartsAvailable: '无可用零件',
    emptyTree: '尚无项目',
  },
  es: {
    assemblyRoot: 'Ensamble (raíz)',
    subAssembly: 'Subensamble',
    part: 'Pieza',
    addPart: 'Añadir pieza',
    addSubAssembly: 'Añadir subensamble',
    remove: 'Quitar',
    label: 'Etiqueta',
    translate: 'Trasladar',
    toolBody: 'Cuerpo herramienta',
    selectPart: 'Seleccionar pieza…',
    noPartsAvailable: 'No hay piezas disponibles',
    emptyTree: 'Aún no hay elementos',
  },
  ar: {
    assemblyRoot: 'التجميع (الجذر)',
    subAssembly: 'تجميع فرعي',
    part: 'قطعة',
    addPart: 'إضافة قطعة',
    addSubAssembly: 'إضافة تجميع فرعي',
    remove: 'إزالة',
    label: 'تسمية',
    translate: 'إزاحة',
    toolBody: 'جسم الأداة',
    selectPart: 'اختر قطعة…',
    noPartsAvailable: 'لا توجد قطع متاحة',
    emptyTree: 'لا توجد عناصر بعد',
  },
};

function pickDict(lang: string | undefined | null): Dict {
  if (!lang) return DICTS.en;
  const lower = lang.toLowerCase();
  if (lower in DICTS) return DICTS[lower as Lang];
  return DICTS.en;
}

// ─── Tree-edit helpers ─────────────────────────────────────────────────────

/** Read translation from a Matrix4 (assumes column-major elements layout). */
function readTranslate(m: THREE.Matrix4 | undefined): [number, number, number] {
  if (!m) return [0, 0, 0];
  const e = m.elements;
  return [e[12], e[13], e[14]];
}

/** Build a translation-only Matrix4 (preserves existing rotation if any). */
function withTranslate(prev: THREE.Matrix4 | undefined, t: [number, number, number]): THREE.Matrix4 {
  const next = prev ? prev.clone() : new THREE.Matrix4();
  const e = next.elements;
  e[12] = t[0];
  e[13] = t[1];
  e[14] = t[2];
  return next;
}

let __subIdCounter = 0;
function genSubAsmId(): string {
  __subIdCounter += 1;
  return `sub_${__subIdCounter}`;
}

/** Test-only: reset the sub-asm id counter so test runs are deterministic. */
export function __resetSubIdCounter(): void {
  __subIdCounter = 0;
}

function emptyLeaf(partId: string): AssemblySubNode {
  return { kind: 'part', partId, label: partId, transform: new THREE.Matrix4().identity(), stepText: '' };
}

function emptySubAssembly(): AssemblySubNode {
  return {
    kind: 'subAssembly',
    subAsmId: genSubAsmId(),
    label: '',
    transform: new THREE.Matrix4().identity(),
    children: [],
  };
}

/** Walk `path` ([childIndex, childIndex, …]) and replace the node there.
 *  `path === []` replaces the root. Returns a new tree (immutable update). */
function replaceAt(
  root: AssemblySubNode,
  path: readonly number[],
  updater: (n: AssemblySubNode) => AssemblySubNode,
): AssemblySubNode {
  if (path.length === 0) return updater(root);
  if (root.kind !== 'subAssembly') return root;
  const [head, ...rest] = path;
  if (head < 0 || head >= root.children.length) return root;
  const nextChildren = root.children.slice();
  nextChildren[head] = replaceAt(nextChildren[head], rest, updater);
  return { ...root, children: nextChildren };
}

/** Walk `path` to a sub-assembly node and remove its `idx`-th child. */
function removeChild(
  root: AssemblySubNode,
  path: readonly number[],
  idx: number,
): AssemblySubNode {
  return replaceAt(root, path, (n) => {
    if (n.kind !== 'subAssembly') return n;
    if (idx < 0 || idx >= n.children.length) return n;
    const nextChildren = n.children.slice();
    nextChildren.splice(idx, 1);
    return { ...n, children: nextChildren };
  });
}

/** Walk `path` to a sub-assembly node and append a child. */
function appendChild(
  root: AssemblySubNode,
  path: readonly number[],
  child: AssemblySubNode,
): AssemblySubNode {
  return replaceAt(root, path, (n) => {
    if (n.kind !== 'subAssembly') return n;
    return { ...n, children: [...n.children, child] };
  });
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = {
  container: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: 12,
    color: 'var(--nx-text, #e5e7eb)',
    background: 'var(--nx-panel, #1a1d23)',
    border: '1px solid var(--nx-border, #2d3138)',
    borderRadius: 6,
    padding: 10,
  } as React.CSSProperties,
  empty: {
    padding: 12,
    textAlign: 'center' as const,
    color: 'var(--nx-text-3, #6b7280)',
    fontStyle: 'italic' as const,
  } as React.CSSProperties,
  row: (depth: number, kind: 'subAssembly' | 'part'): React.CSSProperties => ({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    padding: '6px 8px',
    marginTop: 4,
    marginLeft: depth * 16,
    background: kind === 'subAssembly'
      ? 'var(--nx-bg-2, rgba(34, 211, 238, 0.05))'
      : 'transparent',
    border: '1px solid var(--nx-border, #2d3138)',
    borderRadius: 4,
  }),
  rowHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap' as const,
  } as React.CSSProperties,
  kindBadge: (kind: 'subAssembly' | 'part'): React.CSSProperties => ({
    fontSize: 10,
    fontWeight: 700,
    color: kind === 'subAssembly' ? 'var(--nx-accent, #22d3ee)' : 'var(--nx-text-2, #cbd5e0)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    minWidth: 70,
  }),
  labelInput: {
    flex: 1,
    minWidth: 100,
    padding: '4px 6px',
    fontSize: 12,
    border: '1px solid var(--nx-border, #2d3138)',
    borderRadius: 3,
    background: 'var(--nx-bg, #0f1115)',
    color: 'var(--nx-text, #e5e7eb)',
  } as React.CSSProperties,
  partSelect: {
    flex: 1,
    minWidth: 120,
    padding: '4px 6px',
    fontSize: 12,
    border: '1px solid var(--nx-border, #2d3138)',
    borderRadius: 3,
    background: 'var(--nx-bg, #0f1115)',
    color: 'var(--nx-text, #e5e7eb)',
  } as React.CSSProperties,
  txGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap' as const,
    fontSize: 11,
  } as React.CSSProperties,
  txLabel: {
    color: 'var(--nx-text-3, #6b7280)',
    minWidth: 56,
  } as React.CSSProperties,
  txInput: {
    width: 56,
    padding: '2px 4px',
    fontSize: 11,
    border: '1px solid var(--nx-border, #2d3138)',
    borderRadius: 3,
    background: 'var(--nx-bg, #0f1115)',
    color: 'var(--nx-text, #e5e7eb)',
  } as React.CSSProperties,
  btn: (variant: 'primary' | 'secondary' | 'danger'): React.CSSProperties => ({
    padding: '3px 8px',
    fontSize: 11,
    fontWeight: 600,
    border: '1px solid var(--nx-border, #2d3138)',
    borderRadius: 3,
    cursor: 'pointer',
    background:
      variant === 'primary' ? 'var(--nx-accent, #22d3ee)' :
      variant === 'danger' ? 'transparent' :
      'var(--nx-panel-2, #22252b)',
    color:
      variant === 'primary' ? '#000' :
      variant === 'danger' ? '#ff6b6b' :
      'var(--nx-text-2, #cbd5e0)',
  }),
} as const;

// ─── Sub-components ────────────────────────────────────────────────────────

interface TxEditorProps {
  readonly dict: Dict;
  readonly translate: [number, number, number];
  readonly onChange: (t: [number, number, number]) => void;
  readonly testIdPrefix: string;
}

function TxEditor({ dict, translate, onChange, testIdPrefix }: TxEditorProps): React.ReactElement {
  const handle = (axis: 0 | 1 | 2) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const n = raw === '' || raw === '-' ? 0 : Number(raw);
    if (!Number.isFinite(n)) return;
    const next = translate.slice() as [number, number, number];
    next[axis] = n;
    onChange(next);
  };
  return (
    <div style={styles.txGroup}>
      <span style={styles.txLabel}>{dict.translate}</span>
      <label>x</label>
      <input
        type="number"
        style={styles.txInput}
        value={translate[0]}
        onChange={handle(0)}
        data-testid={`${testIdPrefix}-tx`}
      />
      <label>y</label>
      <input
        type="number"
        style={styles.txInput}
        value={translate[1]}
        onChange={handle(1)}
        data-testid={`${testIdPrefix}-ty`}
      />
      <label>z</label>
      <input
        type="number"
        style={styles.txInput}
        value={translate[2]}
        onChange={handle(2)}
        data-testid={`${testIdPrefix}-tz`}
      />
    </div>
  );
}

interface NodeRowProps {
  readonly node: AssemblySubNode;
  readonly path: readonly number[];
  readonly depth: number;
  readonly dict: Dict;
  readonly availablePartIds: readonly { id: string; label: string }[];
  readonly testId: string;
  readonly isRoot: boolean;
  readonly onUpdate: (path: readonly number[], updater: (n: AssemblySubNode) => AssemblySubNode) => void;
  readonly onAddChild: (path: readonly number[], child: AssemblySubNode) => void;
  readonly onRemoveSelf: () => void;
}

function NodeRow(props: NodeRowProps): React.ReactElement {
  const { node, path, depth, dict, availablePartIds, testId, isRoot, onUpdate, onAddChild, onRemoveSelf } = props;
  const pathKey = path.join('.');
  const rowTestId = `${testId}-node-${pathKey || 'root'}`;

  const translate = readTranslate(node.transform);

  const handleTxChange = useCallback((t: [number, number, number]) => {
    onUpdate(path, (n) => ({ ...n, transform: withTranslate(n.transform, t) }) as AssemblySubNode);
  }, [onUpdate, path]);

  if (node.kind === 'part') {
    return (
      <div style={styles.row(depth, 'part')} data-testid={rowTestId}>
        <div style={styles.rowHeader}>
          <span style={styles.kindBadge('part')}>{dict.part}</span>
          {availablePartIds.length === 0 ? (
            <span style={{ color: 'var(--nx-text-3, #6b7280)' }}>{dict.noPartsAvailable}</span>
          ) : (
            <select
              style={styles.partSelect}
              value={node.partId}
              onChange={(e) => {
                const id = e.target.value;
                onUpdate(path, (n) => ({ ...n, partId: id, label: id }) as AssemblySubNode);
              }}
              data-testid={`${rowTestId}-part-select`}
            >
              {!availablePartIds.some((p) => p.id === node.partId) && (
                <option value={node.partId}>{node.partId}</option>
              )}
              {availablePartIds.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            style={styles.btn('danger')}
            onClick={onRemoveSelf}
            data-testid={`${rowTestId}-remove`}
          >
            {dict.remove}
          </button>
        </div>
        <TxEditor dict={dict} translate={translate} onChange={handleTxChange} testIdPrefix={rowTestId} />
      </div>
    );
  }

  // sub-assembly
  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    onUpdate(path, (n) => ({ ...n, label: v }) as AssemblySubNode);
  };
  const handleAddPart = () => {
    const seedId = availablePartIds[0]?.id ?? 'part_unknown';
    onAddChild(path, emptyLeaf(seedId));
  };
  const handleAddSub = () => {
    onAddChild(path, emptySubAssembly());
  };

  return (
    <div style={styles.row(depth, 'subAssembly')} data-testid={rowTestId}>
      <div style={styles.rowHeader}>
        <span style={styles.kindBadge('subAssembly')}>
          {isRoot ? dict.assemblyRoot : dict.subAssembly}
        </span>
        <input
          type="text"
          style={styles.labelInput}
          placeholder={dict.label}
          value={node.label ?? ''}
          onChange={handleLabelChange}
          data-testid={`${rowTestId}-label`}
        />
        <button
          type="button"
          style={styles.btn('secondary')}
          onClick={handleAddPart}
          data-testid={`${rowTestId}-add-part`}
        >
          {dict.addPart}
        </button>
        <button
          type="button"
          style={styles.btn('secondary')}
          onClick={handleAddSub}
          data-testid={`${rowTestId}-add-sub`}
        >
          {dict.addSubAssembly}
        </button>
        {!isRoot && (
          <button
            type="button"
            style={styles.btn('danger')}
            onClick={onRemoveSelf}
            data-testid={`${rowTestId}-remove`}
          >
            {dict.remove}
          </button>
        )}
      </div>
      {!isRoot && (
        <TxEditor dict={dict} translate={translate} onChange={handleTxChange} testIdPrefix={rowTestId} />
      )}
      {node.children.length === 0 ? (
        <div style={styles.empty}>{dict.emptyTree}</div>
      ) : (
        node.children.map((child, idx) => (
          <NodeRow
            key={`${pathKey}.${idx}`}
            node={child}
            path={[...path, idx]}
            depth={depth + 1}
            dict={dict}
            availablePartIds={availablePartIds}
            testId={testId}
            isRoot={false}
            onUpdate={onUpdate}
            onAddChild={onAddChild}
            onRemoveSelf={() => {
              onUpdate(path, (n) => {
                if (n.kind !== 'subAssembly') return n;
                const next = n.children.slice();
                next.splice(idx, 1);
                return { ...n, children: next };
              });
            }}
          />
        ))
      )}
    </div>
  );
}

// ─── Top-level component ───────────────────────────────────────────────────

export interface AssemblyTreeEditorProps {
  /** Controlled tree root. Must be a `subAssembly` node. */
  readonly root: AssemblySubNode;
  /** Fired with the next tree on any edit. */
  readonly onChange: (next: AssemblySubNode) => void;
  /** Scene's leaf parts — populates the `partId` dropdown for new leaves. */
  readonly availablePartIds: readonly { id: string; label: string }[];
  /** UI language (6-lang ko/en/ja/zh/es/ar). Default 'en'. */
  readonly lang?: string;
  readonly testId?: string;
}

export function AssemblyTreeEditor(props: AssemblyTreeEditorProps): React.ReactElement {
  const { root, onChange, availablePartIds, lang = 'en', testId = 'assembly-tree-editor' } = props;
  const dict = useMemo(() => pickDict(lang), [lang]);
  const isRtl = (lang ?? '').toLowerCase().startsWith('ar');

  const handleUpdate = useCallback(
    (path: readonly number[], updater: (n: AssemblySubNode) => AssemblySubNode) => {
      onChange(replaceAt(root, path, updater));
    },
    [root, onChange],
  );

  const handleAddChild = useCallback(
    (path: readonly number[], child: AssemblySubNode) => {
      onChange(appendChild(root, path, child));
    },
    [root, onChange],
  );

  // Root remove is a no-op for the user; we still pass a handler to satisfy
  // NodeRow's signature. The button is hidden when isRoot=true so the no-op
  // is never reachable.
  const noopRemove = useCallback(() => {
    // Root cannot be removed via the editor — would require unmounting from
    // the host. Exposed via `removeChild` for child rows below.
    void 0;
  }, []);

  return (
    <div
      style={styles.container}
      data-testid={testId}
      dir={isRtl ? 'rtl' : undefined}
    >
      <NodeRow
        node={root}
        path={[]}
        depth={0}
        dict={dict}
        availablePartIds={availablePartIds}
        testId={testId}
        isRoot={true}
        onUpdate={handleUpdate}
        onAddChild={handleAddChild}
        onRemoveSelf={noopRemove}
      />
    </div>
  );
}

// Re-export tree mutation helpers for host-side wiring + tests.
export { replaceAt, appendChild, removeChild, emptyLeaf, emptySubAssembly };
