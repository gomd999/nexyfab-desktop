'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { optimizeCutList, formatCutListReport, type CutRequirement } from './stockOptimizer';

export interface StockOptimizerPanelProps {
  lang: string;
  onClose: () => void;
  /** Optional initial requirements (e.g. from BOM/feature list). */
  initialRequirements?: CutRequirement[];
}

const dict = {
  ko: {
    title: '자재 스톡 최적화 (1D 컷 리스트)', stockLength: '원자재 길이 (mm)',
    kerf: '절단 두께 (mm)', parts: '부품 목록', length: '길이', qty: '수량', label: '라벨',
    addRow: '행 추가', optimize: '최적화 실행', result: '결과', bar: '바',
    used: '사용', waste: '폐기', utilization: '수율', exportTxt: '컷 리스트 다운로드',
    unfulfilled: '⚠ 스톡 초과: ',
  },
  en: {
    title: 'Material Stock Optimizer (1D Cut List)', stockLength: 'Stock length (mm)',
    kerf: 'Kerf (mm)', parts: 'Parts list', length: 'Length', qty: 'Qty', label: 'Label',
    addRow: 'Add Row', optimize: 'Optimize', result: 'Result', bar: 'Bar',
    used: 'Used', waste: 'Waste', utilization: 'Util', exportTxt: 'Download Cut List',
    unfulfilled: '⚠ Exceeds stock: ',
  },
  ja: {
    title: '材料ストック最適化 (1Dカットリスト)', stockLength: '原材料長さ (mm)',
    kerf: '切断幅 (mm)', parts: '部品リスト', length: '長さ', qty: '数量', label: 'ラベル',
    addRow: '行を追加', optimize: '最適化', result: '結果', bar: 'バー',
    used: '使用', waste: '廃棄', utilization: '歩留まり', exportTxt: 'カットリストをダウンロード',
    unfulfilled: '⚠ ストック超過: ',
  },
  zh: {
    title: '材料库存优化 (一维切割清单)', stockLength: '原材料长度 (mm)',
    kerf: '切缝 (mm)', parts: '零件清单', length: '长度', qty: '数量', label: '标签',
    addRow: '添加行', optimize: '优化', result: '结果', bar: '条',
    used: '已用', waste: '废料', utilization: '利用率', exportTxt: '下载切割清单',
    unfulfilled: '⚠ 超出库存: ',
  },
  es: {
    title: 'Optimizador de Stock (Lista de Corte 1D)', stockLength: 'Longitud de material (mm)',
    kerf: 'Kerf (mm)', parts: 'Lista de piezas', length: 'Longitud', qty: 'Cant.', label: 'Etiqueta',
    addRow: 'Añadir Fila', optimize: 'Optimizar', result: 'Resultado', bar: 'Barra',
    used: 'Usado', waste: 'Desperdicio', utilization: 'Aprov.', exportTxt: 'Descargar Lista de Corte',
    unfulfilled: '⚠ Excede el stock: ',
  },
  ar: {
    title: 'محسّن مخزون المواد (قائمة قطع 1D)', stockLength: 'طول المخزون (mm)',
    kerf: 'عرض القطع (mm)', parts: 'قائمة القطع', length: 'الطول', qty: 'الكمية', label: 'التسمية',
    addRow: 'إضافة صف', optimize: 'تحسين', result: 'النتيجة', bar: 'قضيب',
    used: 'مستخدم', waste: 'هدر', utilization: 'الاستفادة', exportTxt: 'تنزيل قائمة القطع',
    unfulfilled: '⚠ يتجاوز المخزون: ',
  },
};

interface Row {
  id: string;
  length: string;
  qty: string;
  label: string;
}

function makeRow(partial: Partial<Row> = {}): Row {
  return {
    id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    length: partial.length ?? '',
    qty: partial.qty ?? '1',
    label: partial.label ?? '',
  };
}

export default function StockOptimizerPanel({ lang, onClose, initialRequirements }: StockOptimizerPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];

  const [stockLen, setStockLen] = useState('6000');
  const [kerf, setKerf] = useState('2');
  const [rows, setRows] = useState<Row[]>(() => {
    if (initialRequirements && initialRequirements.length > 0) {
      return initialRequirements.map(r => makeRow({
        length: String(r.length),
        qty: String(r.qty),
        label: r.label ?? r.id,
      }));
    }
    return [makeRow({ length: '1500', qty: '3', label: 'Leg' }), makeRow({ length: '900', qty: '2', label: 'Rail' })];
  });

  const updateRow = useCallback((id: string, patch: Partial<Row>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows(prev => prev.filter(r => r.id !== id));
  }, []);

  const result = useMemo(() => {
    const sl = parseFloat(stockLen);
    const k = parseFloat(kerf);
    if (!isFinite(sl) || sl <= 0) return null;
    const reqs: CutRequirement[] = rows
      .map(r => ({
        id: r.id,
        length: parseFloat(r.length),
        qty: parseInt(r.qty) || 0,
        label: r.label || undefined,
      }))
      .filter(r => isFinite(r.length) && r.length > 0 && r.qty > 0);
    if (reqs.length === 0) return null;
    return optimizeCutList(reqs, { stockLength: sl, kerfMm: isFinite(k) ? k : 2 });
  }, [stockLen, kerf, rows]);

  const handleDownload = useCallback(() => {
    void (async () => {
      if (!result) return;
      const { downloadBlob } = await import('@/lib/platform');
      const txt = formatCutListReport(result, parseFloat(stockLen));
      const blob = new Blob([txt], { type: 'text/plain' });
      await downloadBlob(`cut-list-${Date.now()}.txt`, blob);
    })();
  }, [result, stockLen]);

  return (
    <div style={{
      position: 'fixed', top: 80, left: '50%', transform: 'translateX(-50%)',
      width: 640, maxHeight: 'calc(100vh - 120px)',
      background: '#0d1117', border: '1px solid #30363d', borderRadius: 8,
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex',
      flexDirection: 'column', color: '#c9d1d9', fontSize: 13,
    }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>📏 {t.title}</strong>
        <button onClick={onClose} style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>
      </div>

      <div style={{ padding: 12, borderBottom: '1px solid #30363d', display: 'flex', gap: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, flex: 1 }}>
          <span style={{ color: '#8b949e', marginBottom: 2 }}>{t.stockLength}</span>
          <input type="number" value={stockLen} onChange={e => setStockLen(e.target.value)}
            style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 4, padding: '4px 8px', color: '#c9d1d9' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, width: 120 }}>
          <span style={{ color: '#8b949e', marginBottom: 2 }}>{t.kerf}</span>
          <input type="number" value={kerf} onChange={e => setKerf(e.target.value)}
            style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 4, padding: '4px 8px', color: '#c9d1d9' }} />
        </label>
      </div>

      <div style={{ padding: 10, borderBottom: '1px solid #30363d' }}>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6 }}>{t.parts}</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ fontSize: 11, color: '#6e7681' }}>
              <th style={{ textAlign: 'left', padding: 3 }}>{t.label}</th>
              <th style={{ textAlign: 'right', padding: 3, width: 100 }}>{t.length}</th>
              <th style={{ textAlign: 'right', padding: 3, width: 70 }}>{t.qty}</th>
              <th style={{ width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td style={{ padding: 2 }}>
                  <input type="text" value={r.label} onChange={e => updateRow(r.id, { label: e.target.value })}
                    style={{ width: '100%', background: '#161b22', border: '1px solid #30363d', borderRadius: 3, padding: '2px 6px', color: '#c9d1d9', fontSize: 11 }} />
                </td>
                <td style={{ padding: 2 }}>
                  <input type="number" value={r.length} onChange={e => updateRow(r.id, { length: e.target.value })}
                    style={{ width: '100%', background: '#161b22', border: '1px solid #30363d', borderRadius: 3, padding: '2px 6px', color: '#c9d1d9', fontSize: 11, textAlign: 'right' }} />
                </td>
                <td style={{ padding: 2 }}>
                  <input type="number" value={r.qty} onChange={e => updateRow(r.id, { qty: e.target.value })}
                    style={{ width: '100%', background: '#161b22', border: '1px solid #30363d', borderRadius: 3, padding: '2px 6px', color: '#c9d1d9', fontSize: 11, textAlign: 'right' }} />
                </td>
                <td style={{ padding: 2, textAlign: 'center' }}>
                  <button onClick={() => removeRow(r.id)}
                    style={{ background: 'transparent', color: '#f85149', border: 'none', cursor: 'pointer', fontSize: 14 }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => setRows(prev => [...prev, makeRow()])}
          style={{ marginTop: 6, background: 'transparent', color: '#58a6ff', border: '1px dashed #30363d', borderRadius: 3, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>
          + {t.addRow}
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6 }}>{t.result}</div>
        {!result ? (
          <div style={{ color: '#6e7681', fontSize: 12 }}>—</div>
        ) : (
          <>
            <div style={{ background: '#161b22', padding: 8, borderRadius: 4, marginBottom: 8, fontSize: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <span><strong>{result.bars.length}</strong> × {stockLen}mm</span>
              <span>{t.used}: <strong>{result.totalUsedLength.toFixed(0)}mm</strong></span>
              <span>{t.waste}: <strong>{result.wasteLength.toFixed(0)}mm</strong></span>
              <span style={{ color: result.utilizationPct > 85 ? '#3fb950' : result.utilizationPct > 70 ? '#d29922' : '#f85149' }}>
                {t.utilization}: <strong>{result.utilizationPct.toFixed(1)}%</strong>
              </span>
            </div>

            {result.unfulfilled.length > 0 && (
              <div style={{ background: '#3b1f1f', border: '1px solid #f85149', color: '#f85149', padding: 6, borderRadius: 4, marginBottom: 6, fontSize: 11 }}>
                {t.unfulfilled}{result.unfulfilled.map(r => `${r.id} (${r.length}mm)`).join(', ')}
              </div>
            )}

            {result.bars.map((bar, i) => (
              <div key={i} style={{ marginBottom: 4, background: '#161b22', borderRadius: 4, padding: 6, fontSize: 11, fontFamily: 'monospace' }}>
                <div style={{ color: '#58a6ff', marginBottom: 2 }}>{t.bar} {i + 1}</div>
                <div style={{ display: 'flex', width: '100%', height: 18, background: '#0d1117', borderRadius: 2, overflow: 'hidden' }}>
                  {bar.pieces.map((p, pi) => {
                    const pct = (p.length / bar.stockLength) * 100;
                    const colors = ['#3fb950', '#58a6ff', '#8957e5', '#d29922', '#e74c3c', '#1abc9c'];
                    return (
                      <div key={pi} title={`${p.label ?? p.reqId} — ${p.length}mm`}
                        style={{ width: `${pct}%`, background: colors[pi % colors.length], borderRight: '1px solid #0d1117', textAlign: 'center', color: '#fff', fontSize: 9, lineHeight: '18px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {p.length}
                      </div>
                    );
                  })}
                  <div style={{ flex: 1, background: 'repeating-linear-gradient(45deg, #21262d 0 4px, #30363d 4px 8px)' }}
                    title={`Waste: ${bar.remaining.toFixed(1)}mm`} />
                </div>
                <div style={{ color: '#6e7681', marginTop: 2 }}>
                  {bar.pieces.map(p => p.length.toFixed(0)).join(' + ')} = {bar.used.toFixed(0)}mm ({t.waste} {bar.remaining.toFixed(0)}mm)
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div style={{ padding: 8, borderTop: '1px solid #30363d' }}>
        <button onClick={handleDownload} disabled={!result}
          style={{ background: 'transparent', color: '#58a6ff', border: '1px solid #30363d', borderRadius: 4, padding: '4px 10px', cursor: result ? 'pointer' : 'default', fontSize: 11, opacity: result ? 1 : 0.5 }}>
          📥 {t.exportTxt}
        </button>
      </div>
    </div>
  );
}
