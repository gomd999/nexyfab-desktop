'use client';

// Z1-UI — SolidWorks-style FeatureManager tree for the SCAD agent.
//
// The Z1 data layer (featureTree.ts) already records every brep_* call as
// a parametric node with parents + dirty flag. This component renders the
// graph as a familiar collapsible tree so the user can:
//   - see how the design was built ("a fillet on a boolean on two prims")
//   - inspect each node's params + result handle
//   - edit a param value inline (when the caller wires onParamChange to
//     the agent's tree_set_param tool)
//   - delete a node (when the caller wires onRemove)
//
// Read-only by default — the caller opts in to edit/delete UI by passing
// the matching callbacks. That lets us ship the tree view in one PR and
// wire the mutation path in a follow-up.

import React, { useCallback, useMemo, useState } from 'react';
import type { FeatureTree, FeatureNode } from '@/lib/ai/scad-agent/featureTree';

/* ─── i18n ──────────────────────────────────────────────────────────────── */

const dict = {
  ko: {
    title: '피처 트리',
    emptyTitle: '피처 트리가 비어있습니다',
    emptyHint: 'brep_* 도구가 호출되면 여기에 기록됩니다.',
    parentsLabel: '부모',
    handleLabel: '핸들',
    notBuilt: '(미빌드)',
    dirty: '재빌드 필요',
    delete: '삭제',
    paramsLabel: '파라미터',
    op_primitive: '프리미티브',
    op_boolean: '불리언',
    op_fillet: '필렛',
    op_chamfer: '챔퍼',
    op_shell: '쉘',
    op_sweep: '스윕',
    op_loft: '로프트',
    op_draft: '드래프트',
    op_helix: '헬릭스',
    op_sketch_extrude: '스케치 돌출',
    op_pattern: '패턴',
    op_mirror: '대칭',
    op_transform: '변환',
  },
  en: {
    title: 'Feature tree',
    emptyTitle: 'No feature tree yet',
    emptyHint: 'brep_* tools populate this tree as they run.',
    parentsLabel: 'parents',
    handleLabel: 'handle',
    notBuilt: '(not built)',
    dirty: 'needs rebuild',
    delete: 'Delete',
    paramsLabel: 'Params',
    op_primitive: 'Primitive',
    op_boolean: 'Boolean',
    op_fillet: 'Fillet',
    op_chamfer: 'Chamfer',
    op_shell: 'Shell',
    op_sweep: 'Sweep',
    op_loft: 'Loft',
    op_draft: 'Draft',
    op_helix: 'Helix',
    op_sketch_extrude: 'Sketch+Extrude',
    op_pattern: 'Pattern',
    op_mirror: 'Mirror',
    op_transform: 'Transform',
  },
  ja: {
    title: 'フィーチャーツリー',
    emptyTitle: 'フィーチャーツリーは空です',
    emptyHint: 'brep_* ツールが実行されるとここに記録されます。',
    parentsLabel: '親',
    handleLabel: 'ハンドル',
    notBuilt: '(未ビルド)',
    dirty: '再ビルド必要',
    delete: '削除',
    paramsLabel: 'パラメータ',
    op_primitive: 'プリミティブ',
    op_boolean: 'ブーリアン',
    op_fillet: 'フィレット',
    op_chamfer: '面取り',
    op_shell: 'シェル',
    op_sweep: 'スイープ',
    op_loft: 'ロフト',
    op_draft: '抜き勾配',
    op_helix: 'ヘリックス',
    op_sketch_extrude: 'スケッチ押出',
    op_pattern: 'パターン',
    op_mirror: 'ミラー',
    op_transform: '変換',
  },
  zh: {
    title: '特征树',
    emptyTitle: '特征树为空',
    emptyHint: 'brep_* 工具运行后会记录到此处。',
    parentsLabel: '父级',
    handleLabel: '句柄',
    notBuilt: '(未构建)',
    dirty: '需重建',
    delete: '删除',
    paramsLabel: '参数',
    op_primitive: '基础体',
    op_boolean: '布尔',
    op_fillet: '圆角',
    op_chamfer: '倒角',
    op_shell: '抽壳',
    op_sweep: '扫描',
    op_loft: '放样',
    op_draft: '拔模',
    op_helix: '螺旋',
    op_sketch_extrude: '草图拉伸',
    op_pattern: '阵列',
    op_mirror: '镜像',
    op_transform: '变换',
  },
  es: {
    title: 'Árbol de operaciones',
    emptyTitle: 'Sin árbol de operaciones',
    emptyHint: 'Las herramientas brep_* lo poblarán al ejecutarse.',
    parentsLabel: 'padres',
    handleLabel: 'handle',
    notBuilt: '(no construido)',
    dirty: 'requiere reconstrucción',
    delete: 'Eliminar',
    paramsLabel: 'Parámetros',
    op_primitive: 'Primitiva',
    op_boolean: 'Booleano',
    op_fillet: 'Redondeo',
    op_chamfer: 'Chaflán',
    op_shell: 'Vaciado',
    op_sweep: 'Barrido',
    op_loft: 'Recubrimiento',
    op_draft: 'Inclinación',
    op_helix: 'Hélice',
    op_sketch_extrude: 'Croquis+Extrusión',
    op_pattern: 'Patrón',
    op_mirror: 'Simetría',
    op_transform: 'Transformar',
  },
  ar: {
    title: 'شجرة الميزات',
    emptyTitle: 'شجرة الميزات فارغة',
    emptyHint: 'تملأ أدوات brep_* هذه الشجرة عند تشغيلها.',
    parentsLabel: 'الآباء',
    handleLabel: 'مقبض',
    notBuilt: '(لم يُبنَ)',
    dirty: 'يتطلب إعادة البناء',
    delete: 'حذف',
    paramsLabel: 'المعلمات',
    op_primitive: 'بدائي',
    op_boolean: 'منطقي',
    op_fillet: 'تدوير',
    op_chamfer: 'شطف',
    op_shell: 'تجويف',
    op_sweep: 'مسح',
    op_loft: 'تقشير',
    op_draft: 'انحدار',
    op_helix: 'حلزون',
    op_sketch_extrude: 'رسم+بثق',
    op_pattern: 'نمط',
    op_mirror: 'انعكاس',
    op_transform: 'تحويل',
  },
} as const;

const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

type OpType = FeatureNode['op'];
type OpLabelKey = `op_${OpType}`;
// Widen to plain strings — each lang variant has identical keys but the
// `as const` on the dict makes every value a distinct literal type. We
// only need to read strings.
type Dict = { [K in keyof typeof dict['en']]: string };

/* ─── Op metadata (icon + i18n key) ─────────────────────────────────────── */

const OP_ICONS: Record<OpType, string> = {
  primitive: '🟦',
  boolean: '➕',
  fillet: '🟢',
  chamfer: '🔺',
  shell: '🥚',
  sweep: '🌀',
  loft: '🪡',
  draft: '📐',
  helix: '🌪️',
  sketch_extrude: '✏️',
  pattern: '⬛',
  mirror: '⊥',
  transform: '🔄',
};

function opLabel(t: Dict, op: OpType): string {
  const key: OpLabelKey = `op_${op}`;
  return t[key];
}

/* ─── Props ─────────────────────────────────────────────────────────────── */

export interface ScadAgentFeatureTreeProps {
  lang: string;
  tree: FeatureTree | null | undefined;
  /** Fired when a node's param value is edited inline. Caller is
   *  expected to route this to a tree_set_param tool call (or
   *  equivalent). Optional — when omitted, params render read-only. */
  onParamChange?: (nodeId: string, key: string, newValue: unknown) => void;
  /** Fired when the trash button is clicked. Optional — when omitted,
   *  no delete UI shows. */
  onRemove?: (nodeId: string) => void;
}

/* ─── Component ─────────────────────────────────────────────────────────── */

export default function ScadAgentFeatureTree({
  lang,
  tree,
  onParamChange,
  onRemove,
}: ScadAgentFeatureTreeProps) {
  const t = dict[langMap[lang] ?? 'en'];
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);

  // Build parent → children adjacency once per tree identity. Children of
  // node X are nodes whose `parents` array includes X.id. Stable by `seq`
  // so the render order matches the agent's call order.
  const childrenOf = useMemo(() => {
    const map = new Map<string, FeatureNode[]>();
    if (!tree) return map;
    for (const node of Object.values(tree.nodes)) {
      for (const p of node.parents) {
        if (!map.has(p)) map.set(p, []);
        map.get(p)!.push(node);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.seq - b.seq);
    }
    return map;
  }, [tree]);

  const toggleExpanded = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelect = useCallback((id: string) => {
    setSelected(id);
    toggleExpanded(id);
  }, [toggleExpanded]);

  /* Empty state — tree null / undefined / has no nodes. */
  if (!tree || Object.keys(tree.nodes).length === 0) {
    return (
      <div
        data-testid="feature-tree-empty"
        style={{
          padding: '20px 16px',
          textAlign: 'center',
          background: 'var(--nx-bg)',
          border: '1px solid var(--nx-border)',
          borderRadius: 8,
          color: 'var(--nx-text-3)',
          fontSize: 11,
          lineHeight: 1.5,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--nx-text-2)', marginBottom: 4 }}>
          {t.emptyTitle}
        </div>
        <div>{t.emptyHint}</div>
      </div>
    );
  }

  // Render roots in their declared order. Each row recurses through its
  // children when expanded. Cycles are guarded by a visited set during the
  // depth-first walk — the Z1 graph is supposed to be a DAG but a corrupt
  // session shouldn't crash the panel.
  return (
    <div
      style={{
        padding: 8,
        background: 'var(--nx-bg)',
        border: '1px solid var(--nx-border)',
        borderRadius: 8,
        fontSize: 11,
        color: 'var(--nx-text)',
      }}
    >
      <div style={{
        fontSize: 11, fontWeight: 700,
        color: 'var(--nx-accent-2)',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        padding: '2px 4px 6px',
      }}>
        🌳 {t.title}
      </div>
      <div role="tree">
        {tree.roots.map(rootId => (
          <FeatureTreeRow
            key={rootId}
            tree={tree}
            nodeId={rootId}
            depth={0}
            childrenOf={childrenOf}
            expanded={expanded}
            selected={selected}
            onSelect={handleSelect}
            onParamChange={onParamChange}
            onRemove={onRemove}
            t={t}
            visited={new Set()}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Row (recursive) ───────────────────────────────────────────────────── */

interface RowProps {
  tree: FeatureTree;
  nodeId: string;
  depth: number;
  childrenOf: Map<string, FeatureNode[]>;
  expanded: Set<string>;
  selected: string | null;
  onSelect: (id: string) => void;
  onParamChange?: (nodeId: string, key: string, newValue: unknown) => void;
  onRemove?: (nodeId: string) => void;
  t: Dict;
  /** Tracks ancestor ids so a (theoretical) cycle in the DAG stops the recursion. */
  visited: Set<string>;
}

function FeatureTreeRow({
  tree, nodeId, depth, childrenOf, expanded, selected,
  onSelect, onParamChange, onRemove, t, visited,
}: RowProps) {
  const node = tree.nodes[nodeId];
  if (!node || visited.has(nodeId)) return null;
  const nextVisited = new Set(visited);
  nextVisited.add(nodeId);

  const children = childrenOf.get(nodeId) ?? [];
  const isOpen = expanded.has(nodeId);
  const isSelected = selected === nodeId;
  const hasChildren = children.length > 0;
  const label = node.name ?? node.id;

  return (
    <div role="treeitem" aria-selected={isSelected} aria-expanded={hasChildren ? isOpen : undefined}>
      <div
        data-testid={`feature-tree-row-${nodeId}`}
        onClick={() => onSelect(nodeId)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 6px',
          paddingLeft: 6 + depth * 14,
          cursor: 'pointer',
          borderLeft: isSelected ? '2px solid var(--nx-accent-2)' : '2px solid transparent',
          background: isSelected ? 'rgba(31, 111, 235, 0.12)' : 'transparent',
          borderRadius: 4,
          userSelect: 'none',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => {
          if (!isSelected) e.currentTarget.style.background = 'var(--nx-panel-2)';
        }}
        onMouseLeave={e => {
          if (!isSelected) e.currentTarget.style.background = 'transparent';
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 10,
            fontSize: 9,
            color: 'var(--nx-text-3)',
            opacity: hasChildren ? 1 : 0.2,
          }}
          aria-hidden="true"
        >
          {hasChildren ? (isOpen ? '▾' : '▸') : '·'}
        </span>
        <span style={{ fontSize: 12 }} aria-hidden="true">{OP_ICONS[node.op]}</span>
        <span style={{
          flex: 1,
          fontFamily: node.name ? 'inherit' : 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontWeight: node.name ? 600 : 400,
          color: 'var(--nx-text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {label}
        </span>
        {node.dirty && (
          <span
            title={t.dirty}
            aria-label={t.dirty}
            style={{
              fontSize: 12,
              color: 'var(--nx-warn)',
              lineHeight: 1,
            }}
          >
            ●
          </span>
        )}
      </div>

      {isOpen && (
        <FeatureTreeDetails
          node={node}
          t={t}
          onParamChange={onParamChange}
          onRemove={onRemove}
          depth={depth}
        />
      )}

      {isOpen && children.map(child => (
        <FeatureTreeRow
          key={child.id}
          tree={tree}
          nodeId={child.id}
          depth={depth + 1}
          childrenOf={childrenOf}
          expanded={expanded}
          selected={selected}
          onSelect={onSelect}
          onParamChange={onParamChange}
          onRemove={onRemove}
          t={t}
          visited={nextVisited}
        />
      ))}
    </div>
  );
}

/* ─── Details (params + meta + delete) ──────────────────────────────────── */

interface DetailsProps {
  node: FeatureNode;
  t: Dict;
  onParamChange?: (nodeId: string, key: string, newValue: unknown) => void;
  onRemove?: (nodeId: string) => void;
  depth: number;
}

function FeatureTreeDetails({ node, t, onParamChange, onRemove, depth }: DetailsProps) {
  const handleText = node.resultHandle ?? t.notBuilt;
  const paramEntries = Object.entries(node.params);

  return (
    <div
      data-testid={`feature-tree-row-${node.id}-details`}
      style={{
        marginLeft: 6 + depth * 14 + 14,
        marginTop: 2,
        marginBottom: 6,
        padding: '6px 8px',
        background: 'var(--nx-panel-2)',
        border: '1px solid var(--nx-border)',
        borderRadius: 4,
        fontSize: 10,
        color: 'var(--nx-text-2)',
        lineHeight: 1.45,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div>
        <span style={{ fontWeight: 700, color: 'var(--nx-text)' }}>
          {opLabel(t, node.op)}
        </span>
      </div>
      {node.parents.length > 0 && (
        <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10 }}>
          <span style={{ color: 'var(--nx-text-3)' }}>{t.parentsLabel}: </span>
          [{node.parents.join(', ')}]
        </div>
      )}
      <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10 }}>
        <span style={{ color: 'var(--nx-text-3)' }}>{t.handleLabel}: </span>
        <span style={{ color: node.resultHandle ? 'var(--nx-ok)' : 'var(--nx-text-3)' }}>
          {handleText}
        </span>
      </div>

      {paramEntries.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{
            color: 'var(--nx-text-3)',
            fontWeight: 700,
            fontSize: 9,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            marginBottom: 4,
          }}>
            {t.paramsLabel}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {paramEntries.map(([key, value]) => (
              <ParamRow
                key={key}
                nodeId={node.id}
                paramKey={key}
                value={value}
                onParamChange={onParamChange}
              />
            ))}
          </div>
        </div>
      )}

      {onRemove && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            data-testid={`feature-tree-delete-${node.id}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(node.id);
            }}
            style={{
              padding: '3px 8px',
              fontSize: 10,
              fontWeight: 600,
              border: '1px solid var(--nx-error)',
              borderRadius: 4,
              background: 'transparent',
              color: 'var(--nx-error)',
              cursor: 'pointer',
            }}
          >
            🗑 {t.delete}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Param row ─────────────────────────────────────────────────────────── */

interface ParamRowProps {
  nodeId: string;
  paramKey: string;
  value: unknown;
  onParamChange?: (nodeId: string, key: string, newValue: unknown) => void;
}

function ParamRow({ nodeId, paramKey, value, onParamChange }: ParamRowProps) {
  // Local draft so the user can type freely without each keystroke
  // re-rendering the whole tree. Commit on blur or Enter.
  const isNumber = typeof value === 'number';
  const isString = typeof value === 'string';
  const isEditable = !!onParamChange && (isNumber || isString);

  const initialText = useMemo(() => {
    if (isNumber || isString) return String(value);
    return '';
  }, [value, isNumber, isString]);

  const [draft, setDraft] = useState<string>(initialText);

  // Keep draft in sync if upstream value changes (e.g. a tool result
  // updated the param without the user editing).
  React.useEffect(() => {
    setDraft(initialText);
  }, [initialText]);

  const commit = useCallback(() => {
    if (!onParamChange) return;
    if (isNumber) {
      const n = Number(draft);
      // If the input isn't a finite number, fall back to the original
      // value rather than emitting NaN — the tree_set_param tool should
      // not have to defensively reject bad input.
      if (!Number.isFinite(n)) {
        setDraft(initialText);
        return;
      }
      if (n !== value) onParamChange(nodeId, paramKey, n);
    } else if (isString) {
      if (draft !== value) onParamChange(nodeId, paramKey, draft);
    }
  }, [draft, isNumber, isString, value, nodeId, paramKey, onParamChange, initialText]);

  const inputCommon: React.CSSProperties = {
    flex: 1,
    padding: '2px 6px',
    background: 'var(--nx-bg)',
    border: '1px solid var(--nx-border)',
    borderRadius: 3,
    color: 'var(--nx-text)',
    fontSize: 10,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    outline: 'none',
    minWidth: 60,
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    }}>
      <span style={{
        color: 'var(--nx-text-3)',
        minWidth: 70,
        flexShrink: 0,
        fontSize: 10,
      }}>
        {paramKey}
      </span>
      {isEditable && isNumber && (
        <input
          type="number"
          data-testid={`feature-tree-param-${nodeId}-${paramKey}`}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
              (e.target as HTMLInputElement).blur();
            }
          }}
          style={inputCommon}
        />
      )}
      {isEditable && isString && (
        <input
          type="text"
          data-testid={`feature-tree-param-${nodeId}-${paramKey}`}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
              (e.target as HTMLInputElement).blur();
            }
          }}
          style={inputCommon}
        />
      )}
      {!isEditable && (
        <ReadOnlyValue value={value} />
      )}
    </div>
  );
}

function ReadOnlyValue({ value }: { value: unknown }) {
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return (
      <span style={{
        flex: 1,
        color: 'var(--nx-text)',
        fontSize: 10,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {String(value)}
      </span>
    );
  }
  // Arrays / objects / null — JSON pretty-print, truncated.
  let body: string;
  try {
    body = JSON.stringify(value);
  } catch {
    body = String(value);
  }
  if (body.length > 200) body = body.slice(0, 197) + '…';
  return (
    <pre style={{
      flex: 1,
      margin: 0,
      padding: '2px 6px',
      background: 'var(--nx-bg)',
      borderRadius: 3,
      color: 'var(--nx-text-2)',
      fontSize: 10,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
      maxHeight: 80,
      overflow: 'auto',
    }}>{body}</pre>
  );
}
