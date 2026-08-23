'use client';

import React from 'react';
import type { FeatureHistory, HistoryNode } from '../useFeatureStack';

type SupportedLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

const COPY: Record<SupportedLang, {
  operations: string;
  empty: string;
  edit: string;
  suppress: string;
  unsuppress: string;
  remove: string;
  failed: string;
}> = {
  ko: { operations: '피처', empty: '아직 생성된 피처가 없습니다', edit: '편집', suppress: '억제', unsuppress: '억제 해제', remove: '삭제', failed: '재생성 실패' },
  en: { operations: 'Features', empty: 'No features yet', edit: 'Edit', suppress: 'Suppress', unsuppress: 'Unsuppress', remove: 'Delete', failed: 'Rebuild failed' },
  ja: { operations: 'フィーチャー', empty: 'フィーチャーはまだありません', edit: '編集', suppress: '抑制', unsuppress: '抑制解除', remove: '削除', failed: '再構築失敗' },
  zh: { operations: '特征', empty: '尚无特征', edit: '编辑', suppress: '抑制', unsuppress: '取消抑制', remove: '删除', failed: '重建失败' },
  es: { operations: 'Operaciones', empty: 'Todavía no hay operaciones', edit: 'Editar', suppress: 'Suprimir', unsuppress: 'Activar', remove: 'Eliminar', failed: 'Error al reconstruir' },
  ar: { operations: 'الميزات', empty: 'لا توجد ميزات بعد', edit: 'تحرير', suppress: 'تعطيل', unsuppress: 'إلغاء التعطيل', remove: 'حذف', failed: 'فشلت إعادة البناء' },
};

function normaliseLang(lang: string): SupportedLang {
  return (['ko', 'en', 'ja', 'zh', 'es', 'ar'] as const).includes(lang as SupportedLang)
    ? lang as SupportedLang
    : 'en';
}

function editableNodes(history: FeatureHistory | null): HistoryNode[] {
  if (!history) return [];
  return history.nodes.filter(node => node.id !== history.rootId && node.type !== 'baseShape' && node.type !== 'sketch');
}

export interface FeatureOperationsTreeProps {
  lang: string;
  history: FeatureHistory | null;
  colors: { text: string; muted: string; accent: string; border: string; hover: string; input: string; danger?: string };
  onSelect?: (id: string) => void;
  onEdit: (id: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}

/** Live feature-history browser. Double-click or Enter opens the same
 * PropertyManager editing contract used by the timeline and command palette. */
export default function FeatureOperationsTree({
  lang,
  history,
  colors,
  onSelect,
  onEdit,
  onToggle,
  onRemove,
}: FeatureOperationsTreeProps): React.ReactElement {
  const copy = COPY[normaliseLang(lang)];
  const [expanded, setExpanded] = React.useState(true);
  const nodes = React.useMemo(() => editableNodes(history), [history]);

  return (
    <div data-testid="feature-operations-tree">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 6px', border: 0, borderRadius: 4,
          background: 'transparent', color: colors.text, cursor: 'pointer', textAlign: 'start',
        }}
      >
        <span aria-hidden style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.12s', fontSize: 9 }}>▶</span>
        <span aria-hidden>🧰</span>
        <span style={{ fontSize: 12, fontWeight: 500 }}>{copy.operations}</span>
        <span style={{ marginInlineStart: 'auto', color: colors.muted, fontSize: 10 }}>{nodes.length}</span>
      </button>

      {expanded && nodes.length === 0 && (
        <div data-testid="feature-operations-empty" style={{ marginInlineStart: 26, padding: '4px 6px', color: colors.muted, fontSize: 11, fontStyle: 'italic' }}>
          {copy.empty}
        </div>
      )}

      {expanded && nodes.map(node => {
        const editing = history?.editingNodeId === node.id;
        return (
          <div
            key={node.id}
            data-testid={`feature-operation-${node.id}`}
            role="button"
            tabIndex={0}
            aria-label={`${copy.edit}: ${node.label}`}
            onClick={() => onSelect?.(node.id)}
            onDoubleClick={event => { event.preventDefault(); onSelect?.(node.id); onEdit(node.id); }}
            onKeyDown={event => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              onSelect?.(node.id);
              onEdit(node.id);
            }}
            style={{
              marginInlineStart: 20, padding: '4px 5px', borderRadius: 4,
              display: 'flex', alignItems: 'center', gap: 5, cursor: 'default',
              color: node.enabled ? colors.text : colors.muted,
              background: editing ? colors.hover : 'transparent',
              border: editing ? `1px solid ${colors.accent}` : '1px solid transparent',
              opacity: node.enabled ? 1 : 0.62,
            }}
          >
            <span aria-hidden style={{ fontSize: 12 }}>{node.icon || '🔧'}</span>
            <span title={node.label} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
              {node.label}
            </span>
            {node.error && <span title={`${copy.failed}: ${node.error}`} aria-label={copy.failed} style={{ color: colors.danger ?? '#ef4444', fontSize: 11 }}>⚠</span>}
            <button
              type="button"
              title={node.enabled ? copy.suppress : copy.unsuppress}
              aria-label={`${node.enabled ? copy.suppress : copy.unsuppress}: ${node.label}`}
              onClick={event => { event.stopPropagation(); onToggle(node.id); }}
              style={{ border: 0, background: 'transparent', color: colors.muted, cursor: 'pointer', padding: '0 2px' }}
            >
              {node.enabled ? '👁' : '○'}
            </button>
            <button
              type="button"
              title={copy.remove}
              aria-label={`${copy.remove}: ${node.label}`}
              onClick={event => { event.stopPropagation(); onRemove(node.id); }}
              style={{ border: 0, background: 'transparent', color: colors.danger ?? '#ef4444', cursor: 'pointer', padding: '0 2px' }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
