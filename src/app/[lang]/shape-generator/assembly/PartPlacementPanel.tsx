'use client';
/**
 * 파트 배치 패널 (Part Placement Panel)
 * 여러 shape을 XYZ 위치 + RxRyRz 회전으로 배치,
 * BOM 테이블 자동 생성 + CSV 내보내기
 */
import React, { useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { SHAPES, SHAPE_MAP, buildShapeResult } from '../shapes';
import type { BomPartResult } from '../ShapePreview';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlacedPart {
  id: string;
  name: string;
  shapeId: string;
  params: Record<string, number>;
  qty: number;
  position: [number, number, number];  // mm
  rotation: [number, number, number];  // degrees
  materialId?: string;
  color?: string;
}

interface Props {
  parts: PlacedPart[];
  onChange: (parts: PlacedPart[]) => void;
  isKo: boolean;
  currentShapeId: string;
  currentParams: Record<string, number>;
}

// ─── i18n ────────────────────────────────────────────────────────────────────

const dict = {
  ko: {
    title: '파트 배치',
    addCurrent: '현재 Shape 추가',
    addNew: '파트 추가',
    position: '위치 (mm)',
    rotation: '회전 (°)',
    qty: '수량',
    name: '이름',
    delete: '삭제',
    duplicate: '복제',
    bom: 'BOM 테이블',
    bomExport: 'CSV 내보내기',
    empty: '추가된 파트가 없습니다',
    total: '합계',
    volume: '부피 (cm³)',
    mass: '질량 (g)',
    bbox: '외형 (W×H×D mm)',
    current: '현재',
    pick: '선택',
    copy: '복사',
  },
  en: {
    title: 'Part Placement',
    addCurrent: 'Add Current Shape',
    addNew: 'Add Part',
    position: 'Position (mm)',
    rotation: 'Rotation (°)',
    qty: 'Qty',
    name: 'Name',
    delete: 'Delete',
    duplicate: 'Duplicate',
    bom: 'BOM Table',
    bomExport: 'Export CSV',
    empty: 'No parts added yet',
    total: 'Total',
    volume: 'Volume (cm³)',
    mass: 'Mass (g)',
    bbox: 'Bbox (W×H×D mm)',
    current: 'Current',
    pick: 'Pick',
    copy: 'copy',
  },
  ja: {
    title: 'パーツ配置',
    addCurrent: '現在のShape追加',
    addNew: 'パーツ追加',
    position: '位置 (mm)',
    rotation: '回転 (°)',
    qty: '数量',
    name: '名前',
    delete: '削除',
    duplicate: '複製',
    bom: 'BOMテーブル',
    bomExport: 'CSVエクスポート',
    empty: 'パーツがまだ追加されていません',
    total: '合計',
    volume: '体積 (cm³)',
    mass: '質量 (g)',
    bbox: '外形 (W×H×D mm)',
    current: '現在',
    pick: '選択',
    copy: 'コピー',
  },
  zh: {
    title: '零件布置',
    addCurrent: '添加当前形状',
    addNew: '添加零件',
    position: '位置 (mm)',
    rotation: '旋转 (°)',
    qty: '数量',
    name: '名称',
    delete: '删除',
    duplicate: '复制',
    bom: 'BOM 表',
    bomExport: '导出 CSV',
    empty: '尚未添加零件',
    total: '合计',
    volume: '体积 (cm³)',
    mass: '质量 (g)',
    bbox: '外形 (W×H×D mm)',
    current: '当前',
    pick: '选择',
    copy: '副本',
  },
  es: {
    title: 'Colocación de Pieza',
    addCurrent: 'Añadir Forma Actual',
    addNew: 'Añadir Pieza',
    position: 'Posición (mm)',
    rotation: 'Rotación (°)',
    qty: 'Cant',
    name: 'Nombre',
    delete: 'Eliminar',
    duplicate: 'Duplicar',
    bom: 'Tabla BOM',
    bomExport: 'Exportar CSV',
    empty: 'No hay piezas añadidas aún',
    total: 'Total',
    volume: 'Volumen (cm³)',
    mass: 'Masa (g)',
    bbox: 'Bbox (W×H×D mm)',
    current: 'Actual',
    pick: 'Elegir',
    copy: 'copia',
  },
  ar: {
    title: 'وضع الجزء',
    addCurrent: 'إضافة الشكل الحالي',
    addNew: 'إضافة جزء',
    position: 'الموضع (mm)',
    rotation: 'الدوران (°)',
    qty: 'الكمية',
    name: 'الاسم',
    delete: 'حذف',
    duplicate: 'تكرار',
    bom: 'جدول BOM',
    bomExport: 'تصدير CSV',
    empty: 'لم يتم إضافة أجزاء بعد',
    total: 'الإجمالي',
    volume: 'الحجم (cm³)',
    mass: 'الكتلة (g)',
    bbox: 'Bbox (W×H×D mm)',
    current: 'الحالي',
    pick: 'اختيار',
    copy: 'نسخة',
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function genId() {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const SHAPE_ICONS: Record<string, string> = {
  box: '📦', cylinder: '🔩', sphere: '🔮', cone: '🔺', torus: '🍩', wedge: '🔻',
  pipe: '🔧', lBracket: '📐', flange: '⚙️', plateBend: '🔨',
  gear: '⚙️', fanBlade: '🌀', sprocket: '🔗', pulley: '🎡',
  sweep: '🔀', loft: '🔄',
  bolt: '🔩', spring: '🌀', tSlot: '⊓',
  hexNut: '⬡', washer: '⭕', iBeam: 'Ⅰ', bearing: '⊚',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function PartPlacementPanel({ parts, onChange, isKo, currentShapeId, currentParams }: Props) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? (isKo ? 'ko' : 'en')];
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showBom, setShowBom] = useState(false);
  const [showShapeSelector, setShowShapeSelector] = useState(false);

  const handleAddCurrent = useCallback(() => {
    const shape = SHAPE_MAP[currentShapeId];
    if (!shape) return;
    const next: PlacedPart = {
      id: genId(),
      name: `${SHAPE_ICONS[currentShapeId] || ''} ${currentShapeId} ${parts.length + 1}`,
      shapeId: currentShapeId,
      params: { ...currentParams },
      qty: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    };
    onChange([...parts, next]);
  }, [parts, onChange, currentShapeId, currentParams]);

  const handleAddShape = useCallback((shapeId: string) => {
    const shape = SHAPE_MAP[shapeId];
    if (!shape) return;
    const defaultParams: Record<string, number> = {};
    shape.params.forEach(p => { defaultParams[p.key] = p.default; });
    const next: PlacedPart = {
      id: genId(),
      name: `${SHAPE_ICONS[shapeId] || ''} ${shapeId} ${parts.length + 1}`,
      shapeId,
      params: defaultParams,
      qty: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    };
    onChange([...parts, next]);
    setShowShapeSelector(false);
  }, [parts, onChange]);

  const handleRemove = useCallback((id: string) => {
    onChange(parts.filter(p => p.id !== id));
  }, [parts, onChange]);

  const handleDuplicate = useCallback((part: PlacedPart) => {
    const dup: PlacedPart = { ...part, id: genId(), name: part.name + ` (${t.copy})`, position: [part.position[0] + 10, part.position[1], part.position[2]] };
    onChange([...parts, dup]);
  }, [parts, onChange, t]);

  const updatePart = useCallback((id: string, patch: Partial<PlacedPart>) => {
    onChange(parts.map(p => p.id === id ? { ...p, ...patch } : p));
  }, [parts, onChange]);

  const handleExportCSV = useCallback(() => {
    void (async () => {
      const { downloadBlob } = await import('@/lib/platform');
      const header = 'No,Name,Shape,Qty,Volume(cm³),Mass(g),W(mm),H(mm),D(mm)';
      const rows = parts.map((p, i) => {
        try {
          const result = buildShapeResult(p.shapeId, p.params);
          if (!result) return `${i+1},"${p.name}",${p.shapeId},${p.qty},,,,,`;
          const mass = result.volume_cm3 * 7.85; // steel density
          return `${i+1},"${p.name}",${p.shapeId},${p.qty},${result.volume_cm3.toFixed(2)},${(mass * p.qty).toFixed(1)},${result.bbox.w},${result.bbox.h},${result.bbox.d}`;
        } catch {
          return `${i+1},"${p.name}",${p.shapeId},${p.qty},,,,,`;
        }
      });
      const csv = [header, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      await downloadBlob('assembly_bom.csv', blob);
    })();
  }, [parts]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#c9d1d9' }}>{t.title}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={handleAddCurrent} title={t.addCurrent}
            style={{ fontSize: 10, padding: '3px 8px', borderRadius: 5, background: '#388bfd22', border: '1px solid #388bfd55', color: '#58a6ff', cursor: 'pointer' }}>
            + {t.current}
          </button>
          <button onClick={() => setShowShapeSelector(s => !s)} title={t.addNew}
            style={{ fontSize: 10, padding: '3px 8px', borderRadius: 5, background: '#21262d', border: '1px solid #30363d', color: '#8b949e', cursor: 'pointer' }}>
            + {t.pick}
          </button>
        </div>
      </div>

      {/* Shape selector dropdown */}
      {showShapeSelector && (
        <div style={{
          background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
          padding: 8, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 3,
        }}>
          {SHAPES.map(s => (
            <button key={s.id} onClick={() => handleAddShape(s.id)}
              title={s.id}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5px 0', borderRadius: 5, fontSize: 15, background: '#0d1117', border: '1px solid #30363d', cursor: 'pointer' }}>
              {SHAPE_ICONS[s.id] || s.icon}
            </button>
          ))}
        </div>
      )}

      {/* Parts list */}
      {parts.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#484f58', fontSize: 11, padding: '12px 0' }}>{t.empty}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {parts.map(part => {
            const expanded = expandedId === part.id;
            return (
              <div key={part.id} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 7, overflow: 'hidden' }}>
                {/* Part row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', cursor: 'pointer' }}
                  onClick={() => setExpandedId(expanded ? null : part.id)}>
                  <span style={{ fontSize: 14 }}>{SHAPE_ICONS[part.shapeId] || '◻'}</span>
                  <input
                    value={part.name}
                    onChange={e => { e.stopPropagation(); updatePart(part.id, { name: e.target.value }); }}
                    onClick={e => e.stopPropagation()}
                    style={{ flex: 1, background: 'none', border: 'none', color: '#c9d1d9', fontSize: 11, outline: 'none', minWidth: 0 }}
                  />
                  <input type="number" min={1} max={999} value={part.qty}
                    onChange={e => { e.stopPropagation(); updatePart(part.id, { qty: Math.max(1, parseInt(e.target.value) || 1) }); }}
                    onClick={e => e.stopPropagation()}
                    style={{ width: 36, background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, color: '#c9d1d9', fontSize: 11, padding: '2px 4px', textAlign: 'center' }}
                  />
                  <button onClick={e => { e.stopPropagation(); handleDuplicate(part); }} title={t.duplicate}
                    style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, padding: '0 2px' }}>⎘</button>
                  <button onClick={e => { e.stopPropagation(); handleRemove(part.id); }} title={t.delete}
                    style={{ background: 'none', border: 'none', color: '#f85149', cursor: 'pointer', fontSize: 12, padding: '0 2px' }}>×</button>
                  <span style={{ color: '#484f58', fontSize: 10, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
                </div>

                {/* Expanded: position + rotation */}
                {expanded && (
                  <div style={{ borderTop: '1px solid #30363d', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {/* Position */}
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#484f58', textTransform: 'uppercase', marginBottom: 3 }}>{t.position}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                          <div key={axis}>
                            <div style={{ fontSize: 9, color: '#484f58', marginBottom: 2 }}>{axis}</div>
                            <input type="number" step={1} value={part.position[i]}
                              onChange={e => {
                                const pos: [number, number, number] = [...part.position] as [number, number, number];
                                pos[i] = parseFloat(e.target.value) || 0;
                                updatePart(part.id, { position: pos });
                              }}
                              style={{ width: '100%', boxSizing: 'border-box', background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, color: '#c9d1d9', fontSize: 11, padding: '3px 5px' }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Rotation */}
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#484f58', textTransform: 'uppercase', marginBottom: 3 }}>{t.rotation}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                        {(['Rx', 'Ry', 'Rz'] as const).map((axis, i) => (
                          <div key={axis}>
                            <div style={{ fontSize: 9, color: '#484f58', marginBottom: 2 }}>{axis}</div>
                            <input type="number" step={5} value={part.rotation[i]}
                              onChange={e => {
                                const rot: [number, number, number] = [...part.rotation] as [number, number, number];
                                rot[i] = parseFloat(e.target.value) || 0;
                                updatePart(part.id, { rotation: rot });
                              }}
                              style={{ width: '100%', boxSizing: 'border-box', background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, color: '#c9d1d9', fontSize: 11, padding: '3px 5px' }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Parameters */}
                    {SHAPE_MAP[part.shapeId]?.params && SHAPE_MAP[part.shapeId].params.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#484f58', textTransform: 'uppercase', marginBottom: 3 }}>
                          {langMap[seg] === 'ko' ? '파라미터' : 'Parameters'}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {SHAPE_MAP[part.shapeId].params.map(param => (
                            <div key={param.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: 10, color: '#8b949e' }}>{param.labelKey}</span>
                              <input
                                type="number"
                                min={param.min}
                                max={param.max}
                                step={param.step}
                                value={part.params[param.key] ?? param.default}
                                onChange={e => {
                                  const newParams = { ...part.params, [param.key]: parseFloat(e.target.value) || param.default };
                                  updatePart(part.id, { params: newParams });
                                }}
                                style={{ width: 60, background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, color: '#c9d1d9', fontSize: 11, padding: '2px 4px', textAlign: 'right' }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* BOM section */}
      {parts.length > 0 && (
        <div style={{ borderTop: '1px solid #30363d', paddingTop: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <button onClick={() => setShowBom(s => !s)}
              style={{ fontSize: 10, fontWeight: 700, color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              {t.bom} {showBom ? '▲' : '▼'}
            </button>
            <button onClick={handleExportCSV}
              style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: '#21262d', border: '1px solid #30363d', color: '#8b949e', cursor: 'pointer' }}>
              {t.bomExport}
            </button>
          </div>
          {showBom && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                <thead>
                  <tr style={{ color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    <th style={{ padding: '3px 4px', textAlign: 'left', borderBottom: '1px solid #30363d' }}>#</th>
                    <th style={{ padding: '3px 4px', textAlign: 'left', borderBottom: '1px solid #30363d' }}>{t.name}</th>
                    <th style={{ padding: '3px 4px', textAlign: 'right', borderBottom: '1px solid #30363d' }}>{t.qty}</th>
                    <th style={{ padding: '3px 4px', textAlign: 'right', borderBottom: '1px solid #30363d' }}>{t.volume}</th>
                    <th style={{ padding: '3px 4px', textAlign: 'right', borderBottom: '1px solid #30363d' }}>{t.mass}</th>
                  </tr>
                </thead>
                <tbody>
                  {parts.map((p, i) => {
                    let vol = 0, bbox = { w: 0, h: 0, d: 0 };
                    try { const r = buildShapeResult(p.shapeId, p.params); if (r) { vol = r.volume_cm3; bbox = r.bbox; } } catch {}
                    const mass = vol * 7.85 * p.qty;
                    return (
                      <tr key={p.id} style={{ borderBottom: '1px solid #21262d' }}>
                        <td style={{ padding: '3px 4px', color: '#484f58' }}>{i + 1}</td>
                        <td style={{ padding: '3px 4px', color: '#c9d1d9', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</td>
                        <td style={{ padding: '3px 4px', textAlign: 'right', color: '#c9d1d9' }}>{p.qty}</td>
                        <td style={{ padding: '3px 4px', textAlign: 'right', color: '#58a6ff' }}>{(vol * p.qty).toFixed(1)}</td>
                        <td style={{ padding: '3px 4px', textAlign: 'right', color: '#8b949e' }}>{mass.toFixed(0)}</td>
                      </tr>
                    );
                  })}
                  {/* Totals */}
                  {(() => {
                    let totalVol = 0, totalMass = 0;
                    parts.forEach(p => {
                      try {
                        const r = buildShapeResult(p.shapeId, p.params);
                        if (r) { totalVol += r.volume_cm3 * p.qty; totalMass += r.volume_cm3 * 7.85 * p.qty; }
                      } catch {}
                    });
                    return (
                      <tr style={{ borderTop: '1px solid #388bfd44', fontWeight: 700 }}>
                        <td colSpan={2} style={{ padding: '3px 4px', color: '#8b949e' }}>{t.total}</td>
                        <td style={{ padding: '3px 4px', textAlign: 'right', color: '#c9d1d9' }}>{parts.reduce((a, b) => a + b.qty, 0)}</td>
                        <td style={{ padding: '3px 4px', textAlign: 'right', color: '#58a6ff' }}>{totalVol.toFixed(1)}</td>
                        <td style={{ padding: '3px 4px', textAlign: 'right', color: '#8b949e' }}>{totalMass.toFixed(0)}</td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Convert PlacedPart[] → BomPartResult[] for ShapePreview ─────────────────

/**
 * Maps library placement to `BomPartResult` for the viewport and interference.
 * **Units:** `position` is mm (same as `PlacedPart`); `rotation` is **degrees** per
 * `ShapeMesh` / `bomPartWorldMatrixFromBom` (M3 품질: 이전에는 라디안으로 넣어 뷰·간섭이 어긋남).
 */
export function placedPartsToBomResults(parts: PlacedPart[]): BomPartResult[] {
  const results: BomPartResult[] = [];
  parts.forEach(part => {
    for (let q = 0; q < part.qty; q++) {
      try {
        const result = buildShapeResult(part.shapeId, part.params);
        if (!result) continue;
        const offset = q * 20; // slight offset along X for multiple quantities (mm)
        results.push({
          name: part.qty > 1 ? `${part.name} #${q + 1}` : part.name,
          result,
          position: [
            part.position[0] + offset,
            part.position[1],
            part.position[2],
          ],
          rotation: [part.rotation[0], part.rotation[1], part.rotation[2]],
        });
      } catch { /* skip failed parts */ }
    }
  });
  return results;
}
