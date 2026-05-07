'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Design Variants Panel — let users snapshot parameter sets as named variants
 * and switch between them to compare design alternatives.
 *
 * Variants are stored in React state by the caller so they survive only for the
 * session unless the caller persists them (e.g., via autoSave).
 */

export interface DesignVariant {
  id: string;
  name: string;
  shapeId: string;
  params: Record<string, number>;
  createdAt: number;
  notes?: string;
  /** Optional thumbnail data URL captured at time of save */
  thumbnail?: string;
}

export interface DesignVariantsPanelProps {
  lang: 'ko' | 'en' | 'ja' | 'cn' | 'es' | 'ar';
  variants: DesignVariant[];
  currentShapeId: string;
  currentParams: Record<string, number>;
  activeVariantId: string | null;
  onClose: () => void;
  onSaveVariant: (variant: DesignVariant) => void;
  onDeleteVariant: (id: string) => void;
  onApplyVariant: (variant: DesignVariant) => void;
  onRenameVariant: (id: string, name: string) => void;
  /** Capture a thumbnail of the current viewport (optional) */
  captureThumbnail?: () => string | null;
  /** Parametric sweep: generate N variants by stepping one param from min..max */
  onGenerateSweep?: (paramKey: string, min: number, max: number, count: number) => DesignVariant[];
}

const dict = {
  ko: {
    title: '설계 대안 (Design Variants)',
    saveCurrent: '현재 설정 저장',
    empty: '저장된 대안이 없습니다. "현재 설정 저장"으로 시작하세요.',
    apply: '적용',
    delete: '삭제',
    rename: '이름 변경',
    compare: '비교',
    current: '현재',
    paramsCount: '파라미터',
    sweep: '파라메트릭 스윕',
    sweepParam: '파라미터',
    sweepMin: '최소',
    sweepMax: '최대',
    sweepCount: '개수',
    sweepGo: '생성',
    exportAll: '모두 내보내기 (JSON)',
    confirmDelete: '이 대안을 삭제하시겠습니까?',
    defaultName: '대안',
  },
  en: {
    title: 'Design Variants',
    saveCurrent: 'Save Current',
    empty: 'No variants saved. Click "Save Current" to start.',
    apply: 'Apply',
    delete: 'Delete',
    rename: 'Rename',
    compare: 'Compare',
    current: 'Current',
    paramsCount: 'params',
    sweep: 'Parametric Sweep',
    sweepParam: 'Parameter',
    sweepMin: 'Min',
    sweepMax: 'Max',
    sweepCount: 'Count',
    sweepGo: 'Generate',
    exportAll: 'Export All (JSON)',
    confirmDelete: 'Delete this variant?',
    defaultName: 'Variant',
  },
  ja: { title: 'デザインバリアント', saveCurrent: '現在を保存', empty: '保存されたバリアントがありません', apply: '適用', delete: '削除', rename: '名前変更', compare: '比較', current: '現在', paramsCount: 'パラメータ', sweep: 'パラメトリックスイープ', sweepParam: 'パラメータ', sweepMin: '最小', sweepMax: '最大', sweepCount: '数', sweepGo: '生成', exportAll: 'エクスポート', confirmDelete: '削除しますか？', defaultName: 'バリアント' },
  zh: { title: '设计方案', saveCurrent: '保存当前', empty: '没有已保存方案', apply: '应用', delete: '删除', rename: '重命名', compare: '比较', current: '当前', paramsCount: '参数', sweep: '参数扫描', sweepParam: '参数', sweepMin: '最小', sweepMax: '最大', sweepCount: '数量', sweepGo: '生成', exportAll: '导出', confirmDelete: '删除此方案？', defaultName: '方案' },
  es: { title: 'Variantes de Diseño', saveCurrent: 'Guardar Actual', empty: 'Sin variantes guardadas', apply: 'Aplicar', delete: 'Eliminar', rename: 'Renombrar', compare: 'Comparar', current: 'Actual', paramsCount: 'parámetros', sweep: 'Barrido Paramétrico', sweepParam: 'Parámetro', sweepMin: 'Mín', sweepMax: 'Máx', sweepCount: 'Cantidad', sweepGo: 'Generar', exportAll: 'Exportar Todo', confirmDelete: '¿Eliminar variante?', defaultName: 'Variante' },
  ar: { title: 'متغيرات التصميم', saveCurrent: 'حفظ الحالي', empty: 'لا توجد متغيرات', apply: 'تطبيق', delete: 'حذف', rename: 'إعادة تسمية', compare: 'مقارنة', current: 'الحالي', paramsCount: 'معاملات', sweep: 'مسح بارامتري', sweepParam: 'معامل', sweepMin: 'الحد الأدنى', sweepMax: 'الحد الأقصى', sweepCount: 'العدد', sweepGo: 'توليد', exportAll: 'تصدير الكل', confirmDelete: 'حذف هذا المتغير؟', defaultName: 'متغير' },
} as const;

function makeVariantId(): string {
  return `variant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatParamDiff(a: Record<string, number>, b: Record<string, number>): string[] {
  const changes: string[] = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.forEach(k => {
    const va = a[k];
    const vb = b[k];
    if (va !== vb && isFinite(va) && isFinite(vb)) {
      const pct = vb === 0 ? 0 : ((va - vb) / vb) * 100;
      changes.push(`${k}: ${vb?.toFixed(2) ?? '–'} → ${va?.toFixed(2) ?? '–'} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`);
    }
  });
  return changes;
}

export default function DesignVariantsPanel({
  lang,
  variants,
  currentShapeId,
  currentParams,
  activeVariantId,
  onClose,
  onSaveVariant,
  onDeleteVariant,
  onApplyVariant,
  onRenameVariant,
  captureThumbnail,
  onGenerateSweep,
}: DesignVariantsPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const fallback: keyof typeof dict = langMap[lang] ?? 'en';
  const t = dict[langMap[seg] ?? fallback] ?? dict.en;

  const [newVariantName, setNewVariantName] = useState('');
  const [compareId, setCompareId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showSweepPanel, setShowSweepPanel] = useState(false);
  const [sweepParam, setSweepParam] = useState<string>(() => Object.keys(currentParams)[0] ?? '');
  const [sweepMin, setSweepMin] = useState('');
  const [sweepMax, setSweepMax] = useState('');
  const [sweepCount, setSweepCount] = useState(5);

  const handleSaveCurrent = useCallback(() => {
    const name = newVariantName.trim() || `${t.defaultName} ${variants.length + 1}`;
    const variant: DesignVariant = {
      id: makeVariantId(),
      name,
      shapeId: currentShapeId,
      params: { ...currentParams },
      createdAt: Date.now(),
      thumbnail: captureThumbnail ? captureThumbnail() ?? undefined : undefined,
    };
    onSaveVariant(variant);
    setNewVariantName('');
  }, [newVariantName, currentShapeId, currentParams, variants.length, t, onSaveVariant, captureThumbnail]);

  const handleRename = useCallback((id: string) => {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    onRenameVariant(id, renameValue.trim());
    setRenamingId(null);
    setRenameValue('');
  }, [renameValue, onRenameVariant]);

  const handleExportJson = useCallback(() => {
    void (async () => {
      const { downloadBlob } = await import('@/lib/platform');
      const payload = JSON.stringify({ variants, exportedAt: new Date().toISOString() }, null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      await downloadBlob(`design-variants-${Date.now()}.json`, blob);
    })();
  }, [variants]);

  const handleSweep = useCallback(() => {
    if (!onGenerateSweep || !sweepParam) return;
    const min = parseFloat(sweepMin);
    const max = parseFloat(sweepMax);
    if (!isFinite(min) || !isFinite(max) || min >= max) return;
    const count = Math.max(2, Math.min(20, Math.floor(sweepCount)));
    const created = onGenerateSweep(sweepParam, min, max, count);
    created.forEach(v => onSaveVariant(v));
    setShowSweepPanel(false);
  }, [onGenerateSweep, sweepParam, sweepMin, sweepMax, sweepCount, onSaveVariant]);

  const compareVariant = useMemo(
    () => variants.find(v => v.id === compareId) ?? null,
    [variants, compareId],
  );

  const compareDiff = useMemo(
    () => compareVariant ? formatParamDiff(currentParams, compareVariant.params) : [],
    [currentParams, compareVariant],
  );

  return (
    <div style={{
      position: 'fixed', top: 80, right: 20, width: 440, maxHeight: 'calc(100vh - 120px)',
      background: '#0d1117', border: '1px solid #30363d', borderRadius: 8,
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex',
      flexDirection: 'column', color: '#c9d1d9', fontSize: 13,
    }}>
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid #30363d', display: 'flex',
        alignItems: 'center', justifyContent: 'space-between',
      }}>
        <strong style={{ fontSize: 14 }}>🎨 {t.title}</strong>
        <button onClick={onClose} style={{
          background: 'transparent', color: '#8b949e', border: 'none',
          cursor: 'pointer', fontSize: 18, lineHeight: 1,
        }}>×</button>
      </div>

      <div style={{ padding: 12, borderBottom: '1px solid #30363d', display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={newVariantName}
          onChange={e => setNewVariantName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSaveCurrent(); }}
          placeholder={`${t.defaultName} ${variants.length + 1}`}
          style={{
            flex: 1, background: '#161b22', border: '1px solid #30363d',
            borderRadius: 4, padding: '6px 10px', color: '#c9d1d9', fontSize: 13,
          }}
        />
        <button
          onClick={handleSaveCurrent}
          style={{
            background: '#238636', color: '#fff', border: 'none', borderRadius: 4,
            padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >💾 {t.saveCurrent}</button>
      </div>

      {onGenerateSweep && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #30363d' }}>
          <button
            onClick={() => setShowSweepPanel(v => !v)}
            style={{
              background: 'transparent', color: '#58a6ff', border: '1px solid #30363d',
              borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12,
            }}
          >📊 {t.sweep} {showSweepPanel ? '▲' : '▼'}</button>
          {showSweepPanel && (
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <select
                value={sweepParam}
                onChange={e => setSweepParam(e.target.value)}
                style={{ gridColumn: 'span 2', background: '#161b22', border: '1px solid #30363d', borderRadius: 4, padding: '4px 8px', color: '#c9d1d9', fontSize: 12 }}
              >
                {Object.keys(currentParams).map(k => (
                  <option key={k} value={k}>{k} = {currentParams[k]?.toFixed(2)}</option>
                ))}
              </select>
              <input type="number" placeholder={t.sweepMin} value={sweepMin} onChange={e => setSweepMin(e.target.value)}
                style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 4, padding: '4px 8px', color: '#c9d1d9', fontSize: 12 }} />
              <input type="number" placeholder={t.sweepMax} value={sweepMax} onChange={e => setSweepMax(e.target.value)}
                style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 4, padding: '4px 8px', color: '#c9d1d9', fontSize: 12 }} />
              <input type="number" min={2} max={20} value={sweepCount}
                onChange={e => setSweepCount(parseInt(e.target.value) || 5)}
                placeholder={t.sweepCount}
                style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 4, padding: '4px 8px', color: '#c9d1d9', fontSize: 12 }} />
              <button onClick={handleSweep}
                style={{ background: '#1f6feb', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>
                {t.sweepGo}
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {variants.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#6e7681', fontSize: 12 }}>
            {t.empty}
          </div>
        ) : (
          variants.map(v => {
            const isActive = v.id === activeVariantId;
            const isCompare = v.id === compareId;
            return (
              <div key={v.id} style={{
                padding: 10, marginBottom: 6,
                background: isActive ? '#1f2d3f' : '#161b22',
                border: `1px solid ${isActive ? '#58a6ff' : '#30363d'}`,
                borderRadius: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  {renamingId === v.id ? (
                    <input
                      type="text"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => handleRename(v.id)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRename(v.id); if (e.key === 'Escape') setRenamingId(null); }}
                      autoFocus
                      style={{ flex: 1, background: '#0d1117', border: '1px solid #58a6ff', borderRadius: 4, padding: '2px 6px', color: '#c9d1d9', fontSize: 13 }}
                    />
                  ) : (
                    <span style={{ fontWeight: 600, flex: 1 }}>
                      {isActive && <span style={{ color: '#58a6ff', marginRight: 4 }}>▸</span>}
                      {v.name}
                    </span>
                  )}
                  <span style={{ fontSize: 10, color: '#6e7681', marginLeft: 8 }}>
                    {Object.keys(v.params).length} {t.paramsCount}
                  </span>
                </div>

                {v.thumbnail && (
                  <img src={v.thumbnail} alt={v.name} style={{
                    width: '100%', height: 80, objectFit: 'cover', borderRadius: 4,
                    border: '1px solid #30363d', marginBottom: 6,
                  }} />
                )}

                <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 8, fontFamily: 'monospace' }}>
                  {Object.entries(v.params).slice(0, 4).map(([k, val]) => (
                    <span key={k} style={{ marginRight: 10 }}>{k}={val.toFixed(1)}</span>
                  ))}
                  {Object.keys(v.params).length > 4 && '...'}
                </div>

                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => onApplyVariant(v)} disabled={isActive}
                    style={{
                      background: isActive ? '#30363d' : '#1f6feb', color: '#fff', border: 'none',
                      borderRadius: 4, padding: '4px 10px', cursor: isActive ? 'default' : 'pointer', fontSize: 11,
                      opacity: isActive ? 0.6 : 1,
                    }}>
                    {isActive ? `✓ ${t.current}` : `↻ ${t.apply}`}
                  </button>
                  <button onClick={() => setCompareId(isCompare ? null : v.id)}
                    style={{
                      background: isCompare ? '#8957e5' : 'transparent', color: isCompare ? '#fff' : '#8957e5',
                      border: '1px solid #8957e5', borderRadius: 4, padding: '4px 10px',
                      cursor: 'pointer', fontSize: 11,
                    }}>
                    ⇄ {t.compare}
                  </button>
                  <button onClick={() => { setRenamingId(v.id); setRenameValue(v.name); }}
                    style={{ background: 'transparent', color: '#8b949e', border: '1px solid #30363d', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>
                    ✎
                  </button>
                  <button onClick={() => { if (confirm(t.confirmDelete)) onDeleteVariant(v.id); }}
                    style={{ background: 'transparent', color: '#f85149', border: '1px solid #f85149', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 11, marginLeft: 'auto' }}>
                    🗑
                  </button>
                </div>

                {isCompare && compareDiff.length > 0 && (
                  <div style={{
                    marginTop: 8, padding: 8, background: '#0d1117',
                    border: '1px dashed #8957e5', borderRadius: 4,
                    fontSize: 11, fontFamily: 'monospace', color: '#c9d1d9',
                  }}>
                    <div style={{ color: '#8957e5', marginBottom: 4, fontWeight: 600 }}>
                      {t.current} ← {v.name}:
                    </div>
                    {compareDiff.map((d, i) => <div key={i}>{d}</div>)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {variants.length > 0 && (
        <div style={{ padding: 10, borderTop: '1px solid #30363d' }}>
          <button onClick={handleExportJson}
            style={{ background: 'transparent', color: '#58a6ff', border: '1px solid #30363d', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>
            📥 {t.exportAll}
          </button>
        </div>
      )}
    </div>
  );
}

/** Default sweep generator — linearly interpolates a single parameter from min..max. */
export function generateLinearSweep(
  shapeId: string,
  baseParams: Record<string, number>,
  paramKey: string,
  min: number,
  max: number,
  count: number,
): DesignVariant[] {
  const out: DesignVariant[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    const v = min + (max - min) * t;
    out.push({
      id: `sweep-${Date.now()}-${i}`,
      name: `Sweep ${paramKey}=${v.toFixed(2)}`,
      shapeId,
      params: { ...baseParams, [paramKey]: v },
      createdAt: Date.now() + i,
    });
  }
  return out;
}
