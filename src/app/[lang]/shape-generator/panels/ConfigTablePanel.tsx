'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { resolveAll } from '../ExpressionEngine';

// ─── i18n dict ────────────────────────────────────────────────────────────────

const dict = {
  ko: {
    title: '파라메트릭 설정 테이블',
    addRow: '+ 행 추가',
    apply: '적용',
    csvExport: 'CSV 내보내기',
    colNum: '#',
    colKey: '변수명',
    colExpr: '수식 / 값',
    colResult: '결과',
    colUnit: '단위',
    preview: '결과 미리보기',
    noChanges: '변경 없음',
    error: '오류',
    hint: '수식에서 다른 변수명을 참조할 수 있습니다 (예: width * 2)',
    unchanged: '변경 없음',
    new_: '신규',
    deleteRow: '삭제',
    errInterp: '해석 오류',
    errGeneric: '오류',
  },
  en: {
    title: 'Parametric Config Table',
    addRow: '+ Add Row',
    apply: 'Apply',
    csvExport: 'Export CSV',
    colNum: '#',
    colKey: 'Variable',
    colExpr: 'Expression / Value',
    colResult: 'Result',
    colUnit: 'Unit',
    preview: 'Result Preview',
    noChanges: 'No changes',
    error: 'Error',
    hint: 'You can reference other variables in expressions (e.g. width * 2)',
    unchanged: 'unchanged',
    new_: 'new',
    deleteRow: 'Delete',
    errInterp: 'Resolve error',
    errGeneric: 'Error',
  },
  ja: {
    title: 'パラメトリック設定テーブル',
    addRow: '+ 行追加',
    apply: '適用',
    csvExport: 'CSVエクスポート',
    colNum: '#',
    colKey: '変数名',
    colExpr: '数式 / 値',
    colResult: '結果',
    colUnit: '単位',
    preview: '結果プレビュー',
    noChanges: '変更なし',
    error: 'エラー',
    hint: '数式内で他の変数を参照できます (例: width * 2)',
    unchanged: '変更なし',
    new_: '新規',
    deleteRow: '削除',
    errInterp: '解析エラー',
    errGeneric: 'エラー',
  },
  zh: {
    title: '参数化配置表',
    addRow: '+ 添加行',
    apply: '应用',
    csvExport: '导出 CSV',
    colNum: '#',
    colKey: '变量名',
    colExpr: '表达式 / 值',
    colResult: '结果',
    colUnit: '单位',
    preview: '结果预览',
    noChanges: '无变更',
    error: '错误',
    hint: '表达式中可以引用其他变量 (例: width * 2)',
    unchanged: '无变更',
    new_: '新',
    deleteRow: '删除',
    errInterp: '解析错误',
    errGeneric: '错误',
  },
  es: {
    title: 'Tabla de Configuración Paramétrica',
    addRow: '+ Añadir Fila',
    apply: 'Aplicar',
    csvExport: 'Exportar CSV',
    colNum: '#',
    colKey: 'Variable',
    colExpr: 'Expresión / Valor',
    colResult: 'Resultado',
    colUnit: 'Unidad',
    preview: 'Vista Previa',
    noChanges: 'Sin cambios',
    error: 'Error',
    hint: 'Puedes referenciar otras variables en expresiones (ej: width * 2)',
    unchanged: 'sin cambios',
    new_: 'nuevo',
    deleteRow: 'Eliminar',
    errInterp: 'Error de resolución',
    errGeneric: 'Error',
  },
  ar: {
    title: 'جدول الإعدادات البارامترية',
    addRow: '+ إضافة صف',
    apply: 'تطبيق',
    csvExport: 'تصدير CSV',
    colNum: '#',
    colKey: 'المتغير',
    colExpr: 'التعبير / القيمة',
    colResult: 'النتيجة',
    colUnit: 'الوحدة',
    preview: 'معاينة النتيجة',
    noChanges: 'لا تغييرات',
    error: 'خطأ',
    hint: 'يمكنك الإشارة إلى متغيرات أخرى في التعبيرات (مثال: width * 2)',
    unchanged: 'لا تغيير',
    new_: 'جديد',
    deleteRow: 'حذف',
    errInterp: 'خطأ في التحليل',
    errGeneric: 'خطأ',
  },
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Row {
  id: string;
  key: string;
  expr: string;
  resolved: number | null;
  error: boolean;
  errorMsg: string;
  unit: 'mm' | 'deg' | 'ratio' | 'count';
}

export interface ConfigTablePanelProps {
  params: Record<string, number>;
  onApply: (updates: Record<string, number>) => void;
  onClose: () => void;
  lang?: string;
}

// ─── Color palette ────────────────────────────────────────────────────────────

const C = {
  bg:       '#161b22',
  surface:  '#21262d',
  border:   '#30363d',
  text:     '#c9d1d9',
  muted:    '#8b949e',
  accent:   '#1f6feb',
  accentHv: '#388bfd',
  danger:   '#f85149',
  success:  '#3fb950',
  warning:  '#d29922',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId() { return `row-${++_idCounter}`; }

function rowsToExprMap(rows: Row[]): Record<string, string | number> {
  const map: Record<string, string | number> = {};
  for (const r of rows) {
    if (r.key.trim() === '') continue;
    const num = parseFloat(r.expr);
    map[r.key.trim()] = (!isNaN(num) && String(num) === r.expr.trim()) ? num : r.expr.trim();
  }
  return map;
}

function resolveRows(rows: Row[], errMsgs?: { interp: string; generic: string }): Row[] {
  const ei = errMsgs?.interp ?? 'Resolve error';
  const eg = errMsgs?.generic ?? 'Error';
  if (rows.length === 0) return rows;
  const exprMap = rowsToExprMap(rows);

  // Resolve all — per-key error handling
  let resolved: Record<string, number> = {};
  let globalError = false;
  try {
    resolved = resolveAll(exprMap);
  } catch {
    globalError = true;
  }

  return rows.map((r) => {
    if (r.key.trim() === '') return { ...r, resolved: null, error: false, errorMsg: '' };

    if (!globalError && r.key.trim() in resolved) {
      const val = resolved[r.key.trim()];
      return { ...r, resolved: val, error: false, errorMsg: '' };
    }

    // Try per-key resolution with subset of already resolved vars
    try {
      const subset: Record<string, number> = {};
      for (const [k, v] of Object.entries(resolved)) subset[k] = v;
      const singleMap: Record<string, string | number> = { ...subset, [r.key.trim()]: exprMap[r.key.trim()] ?? r.expr };
      const single = resolveAll(singleMap);
      const val = single[r.key.trim()];
      if (val !== undefined) return { ...r, resolved: val, error: false, errorMsg: '' };
    } catch (e) {
      return { ...r, resolved: null, error: true, errorMsg: e instanceof Error ? e.message : eg };
    }

    return { ...r, resolved: null, error: true, errorMsg: ei };
  });
}

async function downloadCSV(rows: Row[]) {
  const { downloadBlob } = await import('@/lib/platform');
  const header = 'key,expr,resolved,unit';
  const lines = rows.map(r =>
    `"${r.key}","${r.expr}","${r.resolved !== null ? r.resolved : ''}","${r.unit}"`,
  );
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  await downloadBlob('parametric-config.csv', blob);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface CellInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  highlight?: 'error' | 'none';
  style?: React.CSSProperties;
}

function CellInput({ value, onChange, placeholder, mono, highlight, style }: CellInputProps) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      style={{
        background: 'transparent',
        border: 'none',
        outline: 'none',
        color: highlight === 'error' ? C.danger : C.text,
        fontFamily: mono ? 'monospace' : 'inherit',
        fontSize: 12,
        width: '100%',
        padding: '2px 4px',
        ...style,
      }}
    />
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ConfigTablePanel({ params, onApply, onClose, lang }: ConfigTablePanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? (!lang || lang === 'ko' ? 'ko' : 'en')];

  // ─── State ────────────────────────────────────────────────────────────────

  const initRows = useCallback((): Row[] =>
    Object.entries(params).map(([k, v]) => ({
      id:       nextId(),
      key:      k,
      expr:     String(v),
      resolved: v,
      error:    false,
      errorMsg: '',
      unit:     'mm' as const,
    })),
  [params]);

  const errMsgs = { interp: t.errInterp, generic: t.errGeneric };
  const [rows, setRows] = useState<Row[]>(() => resolveRows(initRows(), errMsgs));
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [focusedCell, setFocusedCell] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Re-evaluate whenever rows content changes
  const updateRows = useCallback((updater: (prev: Row[]) => Row[]) => {
    setRows(prev => resolveRows(updater(prev), errMsgs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errMsgs.interp, errMsgs.generic]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleKeyChange = useCallback((id: string, val: string) => {
    updateRows(prev => prev.map(r => r.id === id ? { ...r, key: val } : r));
  }, [updateRows]);

  const handleExprChange = useCallback((id: string, val: string) => {
    updateRows(prev => prev.map(r => r.id === id ? { ...r, expr: val } : r));
  }, [updateRows]);

  const handleUnitChange = useCallback((id: string, val: string) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, unit: val as Row['unit'] } : r));
  }, []);

  const handleAddRow = useCallback(() => {
    updateRows(prev => [...prev, {
      id: nextId(), key: '', expr: '', resolved: null, error: false, errorMsg: '', unit: 'mm',
    }]);
  }, [updateRows]);

  const handleDeleteRow = useCallback((id: string) => {
    updateRows(prev => prev.filter(r => r.id !== id));
  }, [updateRows]);

  const handleApply = useCallback(() => {
    const updates: Record<string, number> = {};
    for (const r of rows) {
      if (r.key.trim() && !r.error && r.resolved !== null) {
        updates[r.key.trim()] = r.resolved;
      }
    }
    onApply(updates);
  }, [rows, onApply]);

  const handleCSV = useCallback(() => { void downloadCSV(rows); }, [rows]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // ─── Derived: preview diff ─────────────────────────────────────────────────

  const previewDiff = rows
    .filter(r => r.key.trim() && !r.error && r.resolved !== null)
    .map(r => {
      const orig = params[r.key.trim()];
      const changed = orig !== undefined && orig !== r.resolved;
      const isNew = orig === undefined;
      return { key: r.key.trim(), resolved: r.resolved!, orig, changed, isNew };
    })
    .filter(d => d.changed || d.isNew);

  // ─── Render ────────────────────────────────────────────────────────────────

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 640,
    maxHeight: 480,
    background: C.bg,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
    zIndex: 9000,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: 13,
    color: C.text,
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: `1px solid ${C.border}`,
    background: C.surface,
    flexShrink: 0,
  };

  const toolbarStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 10px',
    borderBottom: `1px solid ${C.border}`,
    background: C.surface,
    flexShrink: 0,
  };

  const scrollAreaStyle: React.CSSProperties = {
    overflowY: 'auto',
    flex: 1,
    minHeight: 0,
  };

  const tableStyle: React.CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
    tableLayout: 'fixed',
  };

  const thStyle: React.CSSProperties = {
    padding: '5px 6px',
    textAlign: 'left',
    color: C.muted,
    fontSize: 11,
    fontWeight: 600,
    borderBottom: `1px solid ${C.border}`,
    background: C.surface,
    position: 'sticky',
    top: 0,
    zIndex: 1,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  };

  const footerStyle: React.CSSProperties = {
    padding: '8px 14px',
    borderTop: `1px solid ${C.border}`,
    background: C.surface,
    flexShrink: 0,
  };

  const btnBase: React.CSSProperties = {
    border: `1px solid ${C.border}`,
    borderRadius: 5,
    padding: '3px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
    background: C.surface,
    color: C.text,
    transition: 'background 0.15s',
  };

  const btnPrimary: React.CSSProperties = {
    ...btnBase,
    background: C.accent,
    borderColor: C.accent,
    color: '#fff',
  };

  const colWidths = { num: 28, key: 140, expr: 170, result: 90, unit: 68, del: 30 };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 8999 }}
      />

      {/* Panel */}
      <div ref={containerRef} style={panelStyle} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={headerStyle}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            ⚙️ {t.title}
          </span>
          <button
            onClick={onClose}
            style={{ ...btnBase, padding: '2px 8px', fontSize: 14, lineHeight: 1 }}
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Toolbar */}
        <div style={toolbarStyle}>
          <button onClick={handleAddRow} style={btnBase}>{t.addRow}</button>
          <button onClick={handleApply} style={btnPrimary}>{t.apply}</button>
          <button onClick={handleCSV} style={btnBase}>{t.csvExport}</button>
        </div>

        {/* Table scroll area */}
        <div style={scrollAreaStyle}>
          <table style={tableStyle}>
            <colgroup>
              <col style={{ width: colWidths.num }} />
              <col style={{ width: colWidths.key }} />
              <col style={{ width: colWidths.expr }} />
              <col style={{ width: colWidths.result }} />
              <col style={{ width: colWidths.unit }} />
              <col style={{ width: colWidths.del }} />
            </colgroup>
            <thead>
              <tr>
                <th style={thStyle}>{t.colNum}</th>
                <th style={thStyle}>{t.colKey}</th>
                <th style={thStyle}>{t.colExpr}</th>
                <th style={thStyle}>{t.colResult}</th>
                <th style={thStyle}>{t.colUnit}</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const isHovered = hoveredRow === row.id;
                const rowBg = isHovered ? C.surface : 'transparent';
                const tdStyle: React.CSSProperties = {
                  padding: '3px 0',
                  borderBottom: `1px solid ${C.border}`,
                  background: rowBg,
                  verticalAlign: 'middle',
                };

                return (
                  <tr
                    key={row.id}
                    onMouseEnter={() => setHoveredRow(row.id)}
                    onMouseLeave={() => setHoveredRow(null)}
                  >
                    {/* # */}
                    <td style={{ ...tdStyle, textAlign: 'center', color: C.muted, fontSize: 11 }}>
                      {idx + 1}
                    </td>

                    {/* Variable name */}
                    <td style={tdStyle}>
                      <CellInput
                        value={row.key}
                        onChange={v => handleKeyChange(row.id, v)}
                        placeholder="var_name"
                        mono
                      />
                    </td>

                    {/* Expression */}
                    <td style={tdStyle}>
                      <CellInput
                        value={row.expr}
                        onChange={v => handleExprChange(row.id, v)}
                        placeholder="0"
                        mono
                        highlight={row.error ? 'error' : 'none'}
                      />
                    </td>

                    {/* Result */}
                    <td style={{ ...tdStyle, paddingLeft: 6 }}>
                      {row.error ? (
                        <span
                          style={{ color: C.danger, fontSize: 11, cursor: 'help' }}
                          title={row.errorMsg}
                        >
                          {t.error}
                        </span>
                      ) : row.resolved !== null ? (
                        <span style={{ color: C.success, fontFamily: 'monospace', fontSize: 12 }}>
                          {Number.isInteger(row.resolved)
                            ? row.resolved
                            : row.resolved.toFixed(4).replace(/\.?0+$/, '')}
                        </span>
                      ) : (
                        <span style={{ color: C.muted }}>—</span>
                      )}
                    </td>

                    {/* Unit */}
                    <td style={tdStyle}>
                      <select
                        value={row.unit}
                        onChange={e => handleUnitChange(row.id, e.target.value)}
                        style={{
                          background: C.bg,
                          border: `1px solid ${C.border}`,
                          borderRadius: 3,
                          color: C.muted,
                          fontSize: 11,
                          padding: '1px 2px',
                          width: '100%',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="mm">mm</option>
                        <option value="deg">deg</option>
                        <option value="ratio">ratio</option>
                        <option value="count">count</option>
                      </select>
                    </td>

                    {/* Delete */}
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <button
                        onClick={() => handleDeleteRow(row.id)}
                        title={t.deleteRow}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: isHovered ? C.danger : C.border,
                          cursor: 'pointer',
                          fontSize: 14,
                          lineHeight: 1,
                          padding: '0 2px',
                          transition: 'color 0.15s',
                        }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Preview diff */}
        <div style={{
          padding: '7px 14px',
          borderTop: `1px solid ${C.border}`,
          background: C.bg,
          flexShrink: 0,
          maxHeight: 88,
          overflowY: 'auto',
        }}>
          <div style={{ color: C.muted, fontSize: 11, fontWeight: 600, marginBottom: 4, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {t.preview}
          </div>
          {previewDiff.length === 0 ? (
            <span style={{ color: C.muted, fontSize: 11 }}>{t.noChanges}</span>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
              {previewDiff.map(d => (
                <span key={d.key} style={{ fontSize: 11, fontFamily: 'monospace' }}>
                  <span style={{ color: C.text }}>{d.key}</span>
                  <span style={{ color: C.muted }}>{' '}</span>
                  {d.isNew ? (
                    <span style={{ color: C.warning }}>[{t.new_}] → {d.resolved}</span>
                  ) : (
                    <span style={{ color: C.warning }}>
                      {d.orig} → <span style={{ color: C.success }}>{d.resolved}</span>
                    </span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div style={footerStyle}>
          <span style={{ color: C.muted, fontSize: 11 }}>{t.hint}</span>
        </div>

      </div>
    </>
  );
}
