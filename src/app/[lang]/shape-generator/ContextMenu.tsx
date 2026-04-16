'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  separator?: boolean;
  children?: ContextMenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  visible: boolean;
  items: ContextMenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

// ── i18n context menu labels (ko, en, ja, cn, es, ar) ──────────────────────

type CL = Record<string, string>;
const CTX_I18N: Record<string, CL> = {
  ko: {
    zoomFit: '화면 맞춤', zoomSel: '선택 확대', selectAll: '전체 선택',
    sketchHere: '여기에 스케치', paste: '붙여넣기',
    editFeature: '피처 편집', suppress: '억제', copy: '복사', delete: '삭제',
    appearance: '외관', red: '빨강', blue: '파랑', green: '초록', default: '기본값',
    properties: '속성', measure: '측정', addToCart: '장바구니 추가',
    finishSketch: '스케치 완료', cancel: '취소', addDim: '치수 추가', addConst: '구속 추가',
    horizontal: '수평', vertical: '수직', perpendicular: '직각', parallel: '평행',
    tangent: '접선', coincident: '일치', undo: '실행 취소', clearAll: '전체 삭제',
  },
  en: {
    zoomFit: 'Zoom Fit', zoomSel: 'Zoom Selection', selectAll: 'Select All',
    sketchHere: 'Sketch Here', paste: 'Paste',
    editFeature: 'Edit Feature', suppress: 'Suppress', copy: 'Copy', delete: 'Delete',
    appearance: 'Appearance', red: 'Red', blue: 'Blue', green: 'Green', default: 'Default',
    properties: 'Properties', measure: 'Measure', addToCart: 'Add to Cart',
    finishSketch: 'Finish Sketch', cancel: 'Cancel', addDim: 'Add Dimension', addConst: 'Add Constraint',
    horizontal: 'Horizontal', vertical: 'Vertical', perpendicular: 'Perpendicular', parallel: 'Parallel',
    tangent: 'Tangent', coincident: 'Coincident', undo: 'Undo', clearAll: 'Clear All',
  },
  ja: {
    zoomFit: '全体表示', zoomSel: '選択を拡大', selectAll: 'すべて選択',
    sketchHere: 'ここにスケッチ', paste: '貼り付け',
    editFeature: 'フィーチャー編集', suppress: '抑制', copy: 'コピー', delete: '削除',
    appearance: '外観', red: '赤', blue: '青', green: '緑', default: 'デフォルト',
    properties: 'プロパティ', measure: '測定', addToCart: 'カートに追加',
    finishSketch: 'スケッチ完了', cancel: 'キャンセル', addDim: '寸法追加', addConst: '拘束追加',
    horizontal: '水平', vertical: '垂直', perpendicular: '直角', parallel: '平行',
    tangent: '接線', coincident: '一致', undo: '元に戻す', clearAll: 'すべて削除',
  },
  cn: {
    zoomFit: '适应窗口', zoomSel: '缩放到选择', selectAll: '全部选择',
    sketchHere: '在此处草图', paste: '粘贴',
    editFeature: '编辑特征', suppress: '抑制', copy: '复制', delete: '删除',
    appearance: '外观', red: '红色', blue: '蓝色', green: '绿色', default: '默认',
    properties: '属性', measure: '测量', addToCart: '添加到购物车',
    finishSketch: '完成草图', cancel: '取消', addDim: '添加尺寸', addConst: '添加约束',
    horizontal: '水平', vertical: '垂直', perpendicular: '垂直约束', parallel: '平行',
    tangent: '相切', coincident: '重合', undo: '撤销', clearAll: '全部清除',
  },
  es: {
    zoomFit: 'Ajustar Vista', zoomSel: 'Zoom a Selección', selectAll: 'Seleccionar Todo',
    sketchHere: 'Boceto Aquí', paste: 'Pegar',
    editFeature: 'Editar Operación', suppress: 'Suprimir', copy: 'Copiar', delete: 'Eliminar',
    appearance: 'Apariencia', red: 'Rojo', blue: 'Azul', green: 'Verde', default: 'Predeterminado',
    properties: 'Propiedades', measure: 'Medir', addToCart: 'Añadir al Carrito',
    finishSketch: 'Finalizar Boceto', cancel: 'Cancelar', addDim: 'Añadir Dimensión', addConst: 'Añadir Restricción',
    horizontal: 'Horizontal', vertical: 'Vertical', perpendicular: 'Perpendicular', parallel: 'Paralelo',
    tangent: 'Tangente', coincident: 'Coincidente', undo: 'Deshacer', clearAll: 'Borrar Todo',
  },
  ar: {
    zoomFit: 'ملاءمة العرض', zoomSel: 'تكبير التحديد', selectAll: 'تحديد الكل',
    sketchHere: 'رسم هنا', paste: 'لصق',
    editFeature: 'تحرير الميزة', suppress: 'إخفاء', copy: 'نسخ', delete: 'حذف',
    appearance: 'المظهر', red: 'أحمر', blue: 'أزرق', green: 'أخضر', default: 'افتراضي',
    properties: 'الخصائص', measure: 'قياس', addToCart: 'أضف إلى السلة',
    finishSketch: 'إنهاء الرسم', cancel: 'إلغاء', addDim: 'إضافة بُعد', addConst: 'إضافة قيد',
    horizontal: 'أفقي', vertical: 'عمودي', perpendicular: 'عمودي', parallel: 'متوازي',
    tangent: 'مماس', coincident: 'متطابق', undo: 'تراجع', clearAll: 'مسح الكل',
  },
};

function cl(lang: string, key: string): string {
  return (CTX_I18N[lang] ?? CTX_I18N.en)[key] ?? (CTX_I18N.en[key] ?? key);
}

// ── Preset item sets (accepts lang string, not just isKo) ──────────────────

export function getContextItemsEmpty(lang: string | boolean): ContextMenuItem[] {
  const l = typeof lang === 'boolean' ? (lang ? 'ko' : 'en') : lang;
  return [
    { id: 'zoom-fit', label: cl(l, 'zoomFit'), icon: '⊞', shortcut: 'F' },
    { id: 'zoom-selection', label: cl(l, 'zoomSel'), icon: '🔍', shortcut: 'Z' },
    { id: 'select-all', label: cl(l, 'selectAll'), icon: '☐', shortcut: 'Ctrl+A', separator: true },
    { id: 'sketch-here', label: cl(l, 'sketchHere'), icon: '✏️', shortcut: 'S' },
    { id: 'paste', label: cl(l, 'paste'), icon: '📋', shortcut: 'Ctrl+V' },
  ];
}

export function getContextItemsGeometry(lang: string | boolean): ContextMenuItem[] {
  const l = typeof lang === 'boolean' ? (lang ? 'ko' : 'en') : lang;
  return [
    { id: 'edit-feature', label: cl(l, 'editFeature'), icon: '✎', shortcut: 'Enter' },
    { id: 'suppress', label: cl(l, 'suppress'), icon: '⊘' },
    { id: 'copy', label: cl(l, 'copy'), icon: '📋', shortcut: 'Ctrl+C' },
    { id: 'delete', label: cl(l, 'delete'), icon: '✕', shortcut: 'Del', separator: true },
    { id: 'appearance', label: cl(l, 'appearance'), icon: '🎨', children: [
      { id: 'color-red', label: cl(l, 'red'), icon: '🔴' },
      { id: 'color-blue', label: cl(l, 'blue'), icon: '🔵' },
      { id: 'color-green', label: cl(l, 'green'), icon: '🟢' },
      { id: 'color-default', label: cl(l, 'default'), icon: '⊙' },
    ]},
    { id: 'properties', label: cl(l, 'properties'), icon: 'ℹ', shortcut: 'P' },
    { id: 'measure', label: cl(l, 'measure'), icon: '📏', shortcut: 'M', separator: true },
    { id: 'add-to-cart', label: cl(l, 'addToCart'), icon: '🛒' },
  ];
}

export function getContextItemsSketch(lang: string | boolean): ContextMenuItem[] {
  const l = typeof lang === 'boolean' ? (lang ? 'ko' : 'en') : lang;
  return [
    { id: 'finish-sketch', label: cl(l, 'finishSketch'), icon: '✓', shortcut: 'Esc' },
    { id: 'cancel-sketch', label: cl(l, 'cancel'), icon: '✕' },
    { id: 'add-dimension', label: cl(l, 'addDim'), icon: '📐', shortcut: 'D', separator: true },
    { id: 'add-constraint', label: cl(l, 'addConst'), icon: '🔗', shortcut: 'C', children: [
      { id: 'constraint-horizontal', label: cl(l, 'horizontal'), icon: '─' },
      { id: 'constraint-vertical', label: cl(l, 'vertical'), icon: '│' },
      { id: 'constraint-perpendicular', label: cl(l, 'perpendicular'), icon: '⊥' },
      { id: 'constraint-parallel', label: cl(l, 'parallel'), icon: '∥' },
      { id: 'constraint-tangent', label: cl(l, 'tangent'), icon: '⌒' },
      { id: 'constraint-coincident', label: cl(l, 'coincident'), icon: '⊙' },
    ]},
    { id: 'sketch-undo', label: cl(l, 'undo'), icon: '↩', shortcut: 'Ctrl+Z', separator: true },
    { id: 'sketch-clear', label: cl(l, 'clearAll'), icon: '🗑️' },
  ];
}

// Legacy exports for backwards compatibility
export const CONTEXT_ITEMS_EMPTY = getContextItemsEmpty('en');
export const CONTEXT_ITEMS_GEOMETRY = getContextItemsGeometry('en');
export const CONTEXT_ITEMS_SKETCH = getContextItemsSketch('en');

// ── Submenu component ───────────────────────────────────────────────────────

function SubMenu({ items, x, y, onSelect, onClose }: { items: ContextMenuItem[]; x: number; y: number; onSelect: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div ref={ref} style={{
      position: 'fixed', left: x, top: y, zIndex: 10001,
      background: '#21262d', border: '1px solid #30363d', borderRadius: 8, padding: 4,
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)', minWidth: 180,
      animation: 'ctxFadeIn 0.12s ease-out',
    }}>
      {items.map(item => (
        <button key={item.id} disabled={item.disabled}
          onClick={() => { if (!item.disabled) { onSelect(item.id); onClose(); } }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '7px 12px', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: 'transparent', color: item.disabled ? '#484f58' : '#c9d1d9',
            cursor: item.disabled ? 'default' : 'pointer', textAlign: 'left', transition: 'background 0.1s',
          }}
          onMouseEnter={e => { if (!item.disabled) e.currentTarget.style.background = '#30363d'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={{ width: 18, textAlign: 'center', fontSize: 13, flexShrink: 0 }}>{item.icon || ''}</span>
          <span style={{ flex: 1 }}>{item.label}</span>
          {item.shortcut && <span style={{ fontSize: 10, color: '#484f58', fontFamily: 'monospace' }}>{item.shortcut}</span>}
        </button>
      ))}
    </div>
  );
}

// ── Main ContextMenu ────────────────────────────────────────────────────────

export default function ContextMenu({ x, y, visible, items, onSelect, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hoverChild, setHoverChild] = useState<{ id: string; items: ContextMenuItem[]; x: number; y: number } | null>(null);

  // Close on Escape
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible, onClose]);

  // Close on outside click
  useEffect(() => {
    if (!visible) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [visible, onClose]);

  // Reset submenu on hide
  useEffect(() => { if (!visible) setHoverChild(null); }, [visible]);

  const handleItemHover = useCallback((item: ContextMenuItem, e: React.MouseEvent) => {
    if (item.children && item.children.length > 0) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setHoverChild({ id: item.id, items: item.children, x: rect.right + 2, y: rect.top });
    } else {
      setHoverChild(null);
    }
  }, []);

  if (!visible || items.length === 0) return null;

  // Clamp position to viewport
  const menuW = 220;
  const menuH = items.length * 34 + 8;
  const posX = Math.min(x, window.innerWidth - menuW - 8);
  const posY = Math.min(y, window.innerHeight - menuH - 8);

  return (
    <>
      <div ref={ref} style={{
        position: 'fixed', left: posX, top: posY, zIndex: 10000,
        background: '#21262d', border: '1px solid #30363d', borderRadius: 8, padding: 4,
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)', minWidth: menuW,
        animation: 'ctxFadeIn 0.12s ease-out',
      }}>
        {items.map((item, idx) => (
          <React.Fragment key={item.id}>
            {item.separator && idx > 0 && (
              <div style={{ height: 1, background: '#30363d', margin: '4px 8px' }} />
            )}
            <button disabled={item.disabled}
              onClick={() => {
                if (!item.disabled && !item.children) { onSelect(item.id); onClose(); }
              }}
              onMouseEnter={e => {
                if (!item.disabled) e.currentTarget.style.background = '#30363d';
                handleItemHover(item, e);
              }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '7px 12px', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: 'transparent', color: item.disabled ? '#484f58' : '#c9d1d9',
                cursor: item.disabled ? 'default' : 'pointer', textAlign: 'left', transition: 'background 0.1s',
              }}
            >
              <span style={{ width: 18, textAlign: 'center', fontSize: 13, flexShrink: 0 }}>{item.icon || ''}</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.shortcut && <span style={{ fontSize: 10, color: '#484f58', fontFamily: 'monospace' }}>{item.shortcut}</span>}
              {item.children && <span style={{ fontSize: 10, color: '#484f58' }}>▶</span>}
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* Submenu */}
      {hoverChild && (
        <SubMenu items={hoverChild.items} x={hoverChild.x} y={hoverChild.y} onSelect={onSelect} onClose={onClose} />
      )}

      {/* Keyframe animation */}
      <style>{`@keyframes ctxFadeIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }`}</style>
    </>
  );
}
