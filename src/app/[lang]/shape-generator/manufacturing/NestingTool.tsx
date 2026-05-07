'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import type * as THREE from 'three';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NestingPart {
  id: string;
  label: string;
  width: number;  // mm
  height: number; // mm
  quantity: number;
  color?: string;
}

interface PlacedPart {
  partId: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotated: boolean;
  color: string;
  instance: number;
}

interface NestingToolProps {
  parts?: NestingPart[];
  lang?: string;
}

// ─── i18n dict ───────────────────────────────────────────────────────────────

const dict = {
  ko: {
    title: '네스팅 (2D 배치)',
    util: '이용률',
    sheetSettings: '시트 설정',
    width: '너비 (mm)',
    height: '높이 (mm)',
    gap: '간격 (mm)',
    allowRotation: '90° 회전 허용',
    parts: '부품',
    add: '추가',
    placed: '배치됨',
    unplaced: '개 미배치 (시트 부족)',
    editPart: '부품 편집',
    name: '이름',
    quantity: '수량',
    save: '저장',
    cancel: '취소',
  },
  en: {
    title: 'Nesting (2D Packing)',
    util: 'util.',
    sheetSettings: 'Sheet Settings',
    width: 'Width (mm)',
    height: 'Height (mm)',
    gap: 'Gap (mm)',
    allowRotation: 'Allow 90° rotation',
    parts: 'Parts',
    add: 'Add',
    placed: 'placed',
    unplaced: 'unplaced (sheet too small)',
    editPart: 'Edit Part',
    name: 'Name',
    quantity: 'Quantity',
    save: 'Save',
    cancel: 'Cancel',
  },
  ja: {
    title: 'ネスティング (2D配置)',
    util: '利用率',
    sheetSettings: 'シート設定',
    width: '幅 (mm)',
    height: '高さ (mm)',
    gap: '間隔 (mm)',
    allowRotation: '90°回転を許可',
    parts: '部品',
    add: '追加',
    placed: '配置済み',
    unplaced: '個未配置 (シート不足)',
    editPart: '部品を編集',
    name: '名前',
    quantity: '数量',
    save: '保存',
    cancel: 'キャンセル',
  },
  zh: {
    title: '排样 (2D 排布)',
    util: '利用率',
    sheetSettings: '板材设置',
    width: '宽度 (mm)',
    height: '高度 (mm)',
    gap: '间隙 (mm)',
    allowRotation: '允许 90° 旋转',
    parts: '零件',
    add: '添加',
    placed: '已放置',
    unplaced: '个未放置 (板材不足)',
    editPart: '编辑零件',
    name: '名称',
    quantity: '数量',
    save: '保存',
    cancel: '取消',
  },
  es: {
    title: 'Anidado (Empaquetado 2D)',
    util: 'uso',
    sheetSettings: 'Ajustes de Lámina',
    width: 'Ancho (mm)',
    height: 'Alto (mm)',
    gap: 'Separación (mm)',
    allowRotation: 'Permitir rotación 90°',
    parts: 'Piezas',
    add: 'Añadir',
    placed: 'colocadas',
    unplaced: 'sin colocar (lámina insuficiente)',
    editPart: 'Editar Pieza',
    name: 'Nombre',
    quantity: 'Cantidad',
    save: 'Guardar',
    cancel: 'Cancelar',
  },
  ar: {
    title: 'التعشيش (تعبئة ثنائية الأبعاد)',
    util: 'الاستخدام',
    sheetSettings: 'إعدادات اللوح',
    width: 'العرض (mm)',
    height: 'الارتفاع (mm)',
    gap: 'الفجوة (mm)',
    allowRotation: 'السماح بالدوران 90°',
    parts: 'القطع',
    add: 'إضافة',
    placed: 'موضوعة',
    unplaced: 'غير موضوعة (اللوح صغير جدًا)',
    editPart: 'تعديل القطعة',
    name: 'الاسم',
    quantity: 'الكمية',
    save: 'حفظ',
    cancel: 'إلغاء',
  },
};

// ─── Shelf / FFDH bin-pack algorithm ─────────────────────────────────────────

const PART_COLORS = [
  '#388bfd', '#3fb950', '#e3b341', '#f85149', '#a78bfa',
  '#22d3ee', '#fb7185', '#34d399', '#fbbf24', '#c084fc',
];

function packParts(
  parts: NestingPart[],
  sheetW: number,
  sheetH: number,
  gap: number,
  allowRotation: boolean,
): { placed: PlacedPart[]; utilization: number } {
  const placed: PlacedPart[] = [];

  // Expand instances
  type Item = { partId: string; label: string; w: number; h: number; color: string; instance: number };
  const items: Item[] = [];
  parts.forEach((p, pi) => {
    const color = p.color ?? PART_COLORS[pi % PART_COLORS.length];
    for (let i = 0; i < p.quantity; i++) {
      items.push({ partId: p.id, label: p.label, w: p.width, h: p.height, color, instance: i });
    }
  });

  // Sort by height descending (FFDH heuristic)
  items.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));

  // Shelf packing
  let shelfY = gap;
  let shelfH = 0;
  let curX = gap;

  for (const item of items) {
    let w = item.w;
    let h = item.h;
    let rotated = false;

    // Try rotation if it helps fit
    if (allowRotation && h > w && w <= sheetH && h <= sheetW) {
      [w, h] = [h, w];
      rotated = true;
    }

    if (w > sheetW - gap * 2 || h > sheetH - gap * 2) continue; // item too large

    // Start new shelf if needed
    if (curX + w + gap > sheetW) {
      shelfY += shelfH + gap;
      shelfH = 0;
      curX = gap;
    }
    if (shelfY + h + gap > sheetH) break; // sheet full

    placed.push({ partId: item.partId, label: item.label, x: curX, y: shelfY, w, h, rotated, color: item.color, instance: item.instance });
    shelfH = Math.max(shelfH, h);
    curX += w + gap;
  }

  const totalArea = placed.reduce((s, p) => s + p.w * p.h, 0);
  const utilization = totalArea / (sheetW * sheetH);
  return { placed, utilization };
}

// ─── Component ───────────────────────────────────────────────────────────────

const DEFAULT_PARTS: NestingPart[] = [
  { id: 'p1', label: 'Panel A', width: 120, height: 80, quantity: 3 },
  { id: 'p2', label: 'Panel B', width: 60, height: 40, quantity: 5 },
  { id: 'p3', label: 'Bracket', width: 90, height: 30, quantity: 4 },
];

export default function NestingTool({ parts: initialParts, lang }: NestingToolProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];

  const [parts, setParts] = useState<NestingPart[]>(initialParts ?? DEFAULT_PARTS);
  const [sheetW, setSheetW] = useState(600);
  const [sheetH, setSheetH] = useState(400);
  const [gap, setGap] = useState(5);
  const [allowRotation, setAllowRotation] = useState(true);
  const [editingPart, setEditingPart] = useState<NestingPart | null>(null);

  const { placed, utilization } = useMemo(
    () => packParts(parts, sheetW, sheetH, gap, allowRotation),
    [parts, sheetW, sheetH, gap, allowRotation],
  );

  // Scale for display (fit in ~500px wide)
  const displayScale = Math.min(500 / sheetW, 300 / sheetH);

  const addPart = useCallback(() => {
    const id = `p${Date.now()}`;
    setParts(prev => [...prev, { id, label: `Part ${prev.length + 1}`, width: 80, height: 50, quantity: 1 }]);
  }, []);

  const removePart = useCallback((id: string) => {
    setParts(prev => prev.filter(p => p.id !== id));
  }, []);

  const updatePart = useCallback((updated: NestingPart) => {
    setParts(prev => prev.map(p => p.id === updated.id ? updated : p));
    setEditingPart(null);
  }, []);

  const totalInstances = parts.reduce((s, p) => s + p.quantity, 0);
  const placedCount = placed.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0d1117', color: '#c9d1d9', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 14 }}>🧩</span>
        <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{t.title}</span>
        <span style={{
          padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
          background: utilization > 0.7 ? '#3fb95022' : '#e3b34122',
          color: utilization > 0.7 ? '#3fb950' : '#e3b341',
          border: `1px solid ${utilization > 0.7 ? '#3fb95044' : '#e3b34144'}`,
        }}>
          {(utilization * 100).toFixed(1)}% {t.util}
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', display: 'flex', gap: 0 }}>
        {/* Left: settings + parts list */}
        <div style={{ width: 220, flexShrink: 0, borderRight: '1px solid #21262d', display: 'flex', flexDirection: 'column' }}>
          {/* Sheet settings */}
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #21262d' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              {t.sheetSettings}
            </div>
            {[
              { label: t.width, value: sheetW, set: setSheetW, min: 100, max: 3000 },
              { label: t.height, value: sheetH, set: setSheetH, min: 100, max: 2000 },
              { label: t.gap, value: gap, set: setGap, min: 0, max: 30 },
            ].map(({ label, value, set, min, max }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: '#8b949e', flex: 1 }}>{label}</span>
                <input
                  type="number"
                  value={value}
                  min={min}
                  max={max}
                  onChange={e => set(Math.max(min, Math.min(max, Number(e.target.value))))}
                  style={{
                    width: 64, padding: '3px 6px', background: '#161b22', border: '1px solid #30363d',
                    borderRadius: 4, color: '#c9d1d9', fontSize: 11, outline: 'none',
                  }}
                />
              </div>
            ))}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#8b949e', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={allowRotation}
                onChange={e => setAllowRotation(e.target.checked)}
                style={{ accentColor: '#388bfd' }}
              />
              {t.allowRotation}
            </label>
          </div>

          {/* Parts list */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 700, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', justifyContent: 'space-between' }}>
              <span>{t.parts} ({totalInstances})</span>
              <button onClick={addPart} style={{ background: 'none', border: 'none', color: '#388bfd', fontSize: 12, cursor: 'pointer', padding: 0 }}>+ {t.add}</button>
            </div>
            {parts.map((p, pi) => (
              <div key={p.id} style={{ padding: '5px 12px', borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color ?? PART_COLORS[pi % PART_COLORS.length], flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</div>
                  <div style={{ fontSize: 9, color: '#6e7681' }}>{p.width}×{p.height}mm ×{p.quantity}</div>
                </div>
                <button onClick={() => setEditingPart({ ...p })} style={{ background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer', fontSize: 11, padding: 0 }}>✏</button>
                <button onClick={() => removePart(p.id)} style={{ background: 'none', border: 'none', color: '#f85149', cursor: 'pointer', fontSize: 11, padding: 0 }}>×</button>
              </div>
            ))}
          </div>

          {/* Stats */}
          <div style={{ padding: '8px 12px', borderTop: '1px solid #21262d', fontSize: 10, color: '#6e7681' }}>
            <div>{placedCount}/{totalInstances} {t.placed}</div>
            {placedCount < totalInstances && (
              <div style={{ color: '#e3b341', marginTop: 2 }}>
                ⚠ {totalInstances - placedCount} {t.unplaced}
              </div>
            )}
          </div>
        </div>

        {/* Right: visual canvas */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
          <div style={{ position: 'relative' }}>
            {/* Sheet */}
            <div style={{
              width: sheetW * displayScale,
              height: sheetH * displayScale,
              background: '#161b22',
              border: '1px solid #30363d',
              position: 'relative',
              overflow: 'hidden',
              borderRadius: 4,
            }}>
              {placed.map((p, idx) => (
                <div
                  key={`${p.partId}-${p.instance}`}
                  title={`${p.label} ${p.w}×${p.h}mm${p.rotated ? ' (rotated)' : ''}`}
                  style={{
                    position: 'absolute',
                    left: p.x * displayScale,
                    top: p.y * displayScale,
                    width: p.w * displayScale,
                    height: p.h * displayScale,
                    background: p.color + '44',
                    border: `1px solid ${p.color}`,
                    borderRadius: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    boxSizing: 'border-box',
                    fontSize: Math.max(7, Math.min(11, p.w * displayScale / 6)),
                    color: p.color,
                    fontWeight: 700,
                    fontFamily: 'monospace',
                  }}
                >
                  {p.w * displayScale > 30 && p.h * displayScale > 16 && (
                    <span style={{ padding: '0 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.rotated ? '↻' : ''}{p.label.length > 8 ? p.label.slice(0, 7) + '…' : p.label}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Sheet dimensions label */}
            <div style={{ marginTop: 6, fontSize: 10, color: '#6e7681', textAlign: 'center' }}>
              {sheetW} × {sheetH} mm
            </div>
          </div>
        </div>
      </div>

      {/* Part editor modal */}
      {editingPart && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }} onClick={() => setEditingPart(null)}>
          <div style={{
            background: '#1c2128', border: '1px solid #30363d', borderRadius: 10,
            padding: '20px 24px', width: 280, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14 }}>{t.editPart}</div>
            {[
              { key: 'label', label: t.name, type: 'text' },
              { key: 'width', label: t.width, type: 'number' },
              { key: 'height', label: t.height, type: 'number' },
              { key: 'quantity', label: t.quantity, type: 'number' },
            ].map(({ key, label, type }) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 4 }}>{label}</label>
                <input
                  type={type}
                  value={(editingPart as any)[key]}
                  min={type === 'number' ? 1 : undefined}
                  onChange={e => setEditingPart(prev => prev ? { ...prev, [key]: type === 'number' ? Number(e.target.value) : e.target.value } : null)}
                  style={{
                    width: '100%', padding: '5px 8px', background: '#161b22', border: '1px solid #30363d',
                    borderRadius: 5, color: '#c9d1d9', fontSize: 12, outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => updatePart(editingPart)}
                style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', background: '#388bfd', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
              >
                {t.save}
              </button>
              <button
                onClick={() => setEditingPart(null)}
                style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: '1px solid #30363d', background: 'transparent', color: '#8b949e', fontSize: 12, cursor: 'pointer' }}
              >
                {t.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
