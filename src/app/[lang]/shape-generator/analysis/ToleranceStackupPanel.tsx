'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import {
  computeStackup,
  monteCarloStackup,
  type ToleranceDimension,
  type StackupResult,
  type MonteCarloResult,
} from './toleranceStackup';

/* ─── i18n ────────────────────────────────────────────────────────────────── */

const dict = {
  ko: {
    title: '공차 누적 분석',
    addDimension: '치수 추가',
    nominal: '공칭값',
    tolPlus: '+공차',
    tolMinus: '-공차',
    direction: '방향',
    worstCase: '최악 조건',
    rss: 'RSS',
    monteCarlo: '몬테카를로',
    run: '분석 실행',
    results: '결과',
    critical: '핵심 치수',
    cpk: 'Cpk',
    close: '닫기',
    histogram: '히스토그램',
    mean: '평균',
    stdDev: '표준편차',
    name: '이름',
    remove: '삭제',
    noResults: '치수를 추가하고 분석을 실행하세요',
    wcMax: '최대',
    wcMin: '최소',
  },
  en: {
    title: 'Tolerance Stack-Up',
    addDimension: 'Add Dimension',
    nominal: 'Nominal',
    tolPlus: '+Tol',
    tolMinus: '-Tol',
    direction: 'Dir',
    worstCase: 'Worst Case',
    rss: 'RSS',
    monteCarlo: 'Monte Carlo',
    run: 'Run Analysis',
    results: 'Results',
    critical: 'Critical Dim',
    cpk: 'Cpk',
    close: 'Close',
    histogram: 'Histogram',
    mean: 'Mean',
    stdDev: 'Std Dev',
    name: 'Name',
    remove: 'Remove',
    noResults: 'Add dimensions and run analysis',
    wcMax: 'Max',
    wcMin: 'Min',
  },
  ja: {
    title: '公差積上げ解析',
    addDimension: '寸法追加',
    nominal: '公称値',
    tolPlus: '+公差',
    tolMinus: '-公差',
    direction: '方向',
    worstCase: 'ワーストケース',
    rss: 'RSS',
    monteCarlo: 'モンテカルロ',
    run: '解析実行',
    results: '結果',
    critical: '重要寸法',
    cpk: 'Cpk',
    close: '閉じる',
    histogram: 'ヒストグラム',
    mean: '平均',
    stdDev: '標準偏差',
    name: '名前',
    remove: '削除',
    noResults: '寸法を追加して解析を実行してください',
    wcMax: '最大',
    wcMin: '最小',
  },
  zh: {
    title: '公差累积分析',
    addDimension: '添加尺寸',
    nominal: '标称值',
    tolPlus: '+公差',
    tolMinus: '-公差',
    direction: '方向',
    worstCase: '最坏情况',
    rss: 'RSS',
    monteCarlo: '蒙特卡洛',
    run: '运行分析',
    results: '结果',
    critical: '关键尺寸',
    cpk: 'Cpk',
    close: '关闭',
    histogram: '直方图',
    mean: '均值',
    stdDev: '标准差',
    name: '名称',
    remove: '删除',
    noResults: '请添加尺寸并运行分析',
    wcMax: '最大',
    wcMin: '最小',
  },
  es: {
    title: 'Apilamiento de Tolerancias',
    addDimension: 'Agregar Dimensi\u00f3n',
    nominal: 'Nominal',
    tolPlus: '+Tol',
    tolMinus: '-Tol',
    direction: 'Dir',
    worstCase: 'Peor Caso',
    rss: 'RSS',
    monteCarlo: 'Monte Carlo',
    run: 'Ejecutar',
    results: 'Resultados',
    critical: 'Dim Cr\u00edtica',
    cpk: 'Cpk',
    close: 'Cerrar',
    histogram: 'Histograma',
    mean: 'Media',
    stdDev: 'Desv Est',
    name: 'Nombre',
    remove: 'Eliminar',
    noResults: 'Agregue dimensiones y ejecute el an\u00e1lisis',
    wcMax: 'M\u00e1x',
    wcMin: 'M\u00edn',
  },
  ar: {
    title: '\u062a\u062d\u0644\u064a\u0644 \u062a\u0631\u0627\u0643\u0645 \u0627\u0644\u062a\u0641\u0627\u0648\u062a',
    addDimension: '\u0625\u0636\u0627\u0641\u0629 \u0628\u064f\u0639\u062f',
    nominal: '\u0627\u0644\u0642\u064a\u0645\u0629 \u0627\u0644\u0627\u0633\u0645\u064a\u0629',
    tolPlus: '+\u062a\u0641\u0627\u0648\u062a',
    tolMinus: '-\u062a\u0641\u0627\u0648\u062a',
    direction: '\u0627\u0644\u0627\u062a\u062c\u0627\u0647',
    worstCase: '\u0623\u0633\u0648\u0623 \u062d\u0627\u0644\u0629',
    rss: 'RSS',
    monteCarlo: '\u0645\u0648\u0646\u062a\u064a \u0643\u0627\u0631\u0644\u0648',
    run: '\u062a\u0634\u063a\u064a\u0644',
    results: '\u0627\u0644\u0646\u062a\u0627\u0626\u062c',
    critical: '\u0627\u0644\u0628\u064f\u0639\u062f \u0627\u0644\u062d\u0631\u062c',
    cpk: 'Cpk',
    close: '\u0625\u063a\u0644\u0627\u0642',
    histogram: '\u0631\u0633\u0645 \u0628\u064a\u0627\u0646\u064a',
    mean: '\u0627\u0644\u0645\u062a\u0648\u0633\u0637',
    stdDev: '\u0627\u0644\u0627\u0646\u062d\u0631\u0627\u0641',
    name: '\u0627\u0644\u0627\u0633\u0645',
    remove: '\u062d\u0630\u0641',
    noResults: '\u0623\u0636\u0641 \u0623\u0628\u0639\u0627\u062f \u0648\u0634\u063a\u0644 \u0627\u0644\u062a\u062d\u0644\u064a\u0644',
    wcMax: '\u0623\u0642\u0635\u0649',
    wcMin: '\u0623\u062f\u0646\u0649',
  },
} as const;

const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

/* ─── Styles ──────────────────────────────────────────────────────────────── */

const C = {
  bg: '#161b22',
  panelBg: '#0d1117',
  border: '#30363d',
  text: '#c9d1d9',
  dim: '#8b949e',
  accent: '#388bfd',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  row: '#21262d',
};

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 60,
  right: 16,
  width: 380,
  maxHeight: 'calc(100vh - 80px)',
  background: C.panelBg,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontSize: 12,
  color: C.text,
  zIndex: 800,
  boxShadow: '0 8px 32px rgba(0,0,0,.55)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 12px',
  borderBottom: `1px solid ${C.border}`,
  background: C.bg,
  fontWeight: 700,
  fontSize: 13,
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 0,
};

const sectionStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: `1px solid ${C.border}`,
};

const btnStyle: React.CSSProperties = {
  padding: '4px 10px',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  background: C.row,
  border: `1px solid ${C.border}`,
  borderRadius: 3,
  color: C.text,
  padding: '3px 5px',
  fontSize: 11,
  width: '100%',
  outline: 'none',
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: '6px 0',
  textAlign: 'center',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  borderBottom: active ? `2px solid ${C.accent}` : '2px solid transparent',
  color: active ? C.accent : C.dim,
  background: 'transparent',
  border: 'none',
  borderBottomWidth: 2,
  borderBottomStyle: 'solid',
  borderBottomColor: active ? C.accent : 'transparent',
});

/* ─── Component ───────────────────────────────────────────────────────────── */

interface Props {
  lang?: string;
  onClose: () => void;
}

let _idCounter = 0;
function nextId(): string {
  return `td_${++_idCounter}_${Date.now()}`;
}

function defaultDim(): ToleranceDimension {
  return {
    id: nextId(),
    name: '',
    nominal: 10,
    tolerancePlus: 0.1,
    toleranceMinus: -0.1,
    direction: 1,
    distribution: 'normal',
  };
}

type Mode = 'worstCase' | 'rss' | 'monteCarlo';

export default function ToleranceStackupPanel({ onClose }: Props) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const t = dict[langMap[seg] ?? 'en'];

  const [dims, setDims] = useState<ToleranceDimension[]>([defaultDim()]);
  const [mode, setMode] = useState<Mode>('worstCase');
  const [stackResult, setStackResult] = useState<StackupResult | null>(null);
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);

  /* ── Dimension CRUD ─ */
  const addDim = useCallback(() => {
    setDims(prev => [...prev, defaultDim()]);
  }, []);

  const removeDim = useCallback((id: string) => {
    setDims(prev => prev.filter(d => d.id !== id));
  }, []);

  const updateDim = useCallback((id: string, patch: Partial<ToleranceDimension>) => {
    setDims(prev => prev.map(d => (d.id === id ? { ...d, ...patch } : d)));
  }, []);

  /* ── Run ─ */
  const run = useCallback(() => {
    const sr = computeStackup(dims);
    setStackResult(sr);
    if (mode === 'monteCarlo') {
      setMcResult(monteCarloStackup(dims, 10000));
    } else {
      setMcResult(null);
    }
  }, [dims, mode]);

  /* ── Cpk badge color ─ */
  const cpkColor = useMemo(() => {
    if (!stackResult) return C.dim;
    if (stackResult.cpk >= 1.33) return C.green;
    if (stackResult.cpk >= 1.0) return C.yellow;
    return C.red;
  }, [stackResult]);

  /* ── Stack-up diagram scale ─ */
  const barScale = useMemo(() => {
    if (!stackResult || dims.length === 0) return 1;
    const maxAbs = Math.max(
      ...dims.map(d => Math.abs(d.nominal) + Math.max(Math.abs(d.tolerancePlus), Math.abs(d.toleranceMinus))),
      1,
    );
    return 300 / maxAbs;
  }, [stackResult, dims]);

  /* ── Histogram max ─ */
  const histMax = useMemo(() => {
    if (!mcResult) return 1;
    return Math.max(...mcResult.histogram, 1);
  }, [mcResult]);

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span>{t.title}</span>
        <button
          onClick={onClose}
          style={{ ...btnStyle, background: 'transparent', color: C.dim, fontSize: 16 }}
          aria-label={t.close}
        >
          x
        </button>
      </div>

      <div style={bodyStyle}>
        {/* ── Dimension list ─ */}
        <div style={sectionStyle}>
          {dims.map((d, i) => (
            <div
              key={d.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 54px 48px 48px 32px 24px',
                gap: 4,
                alignItems: 'center',
                marginBottom: 4,
              }}
            >
              <input
                style={inputStyle}
                placeholder={`${t.name} ${i + 1}`}
                value={d.name}
                onChange={e => updateDim(d.id, { name: e.target.value })}
              />
              <input
                style={{ ...inputStyle, textAlign: 'right' }}
                type="number"
                title={t.nominal}
                value={d.nominal}
                onChange={e => updateDim(d.id, { nominal: +e.target.value })}
              />
              <input
                style={{ ...inputStyle, textAlign: 'right', color: C.green }}
                type="number"
                step={0.01}
                title={t.tolPlus}
                value={d.tolerancePlus}
                onChange={e => updateDim(d.id, { tolerancePlus: +e.target.value })}
              />
              <input
                style={{ ...inputStyle, textAlign: 'right', color: C.red }}
                type="number"
                step={0.01}
                title={t.tolMinus}
                value={d.toleranceMinus}
                onChange={e => updateDim(d.id, { toleranceMinus: +e.target.value })}
              />
              <button
                style={{
                  ...btnStyle,
                  background: d.direction === 1 ? C.accent : C.yellow,
                  color: '#fff',
                  fontSize: 13,
                  padding: '2px 0',
                }}
                title={t.direction}
                onClick={() => updateDim(d.id, { direction: d.direction === 1 ? -1 : 1 })}
              >
                {d.direction === 1 ? '+' : '-'}
              </button>
              <button
                style={{ ...btnStyle, background: 'transparent', color: C.red, fontSize: 13, padding: 0 }}
                title={t.remove}
                onClick={() => removeDim(d.id)}
              >
                x
              </button>
            </div>
          ))}
          <button
            onClick={addDim}
            style={{ ...btnStyle, background: C.row, color: C.accent, marginTop: 4, width: '100%' }}
          >
            + {t.addDimension}
          </button>
        </div>

        {/* ── Mode tabs ─ */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}` }}>
          {(['worstCase', 'rss', 'monteCarlo'] as Mode[]).map(m => (
            <button key={m} style={tabStyle(mode === m)} onClick={() => setMode(m)}>
              {t[m]}
            </button>
          ))}
        </div>

        {/* ── Run button ─ */}
        <div style={{ padding: '8px 12px' }}>
          <button
            onClick={run}
            style={{
              ...btnStyle,
              background: C.accent,
              color: '#fff',
              width: '100%',
              padding: '7px 0',
              fontSize: 12,
            }}
          >
            {t.run}
          </button>
        </div>

        {/* ── Results ─ */}
        {stackResult ? (
          <>
            {/* Summary table */}
            <div style={sectionStyle}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, marginBottom: 6 }}>
                {t.results}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <tbody>
                  <tr>
                    <td style={{ color: C.dim, padding: '2px 0' }}>{t.nominal}</td>
                    <td style={{ textAlign: 'right' }}>{stackResult.nominal.toFixed(4)}</td>
                  </tr>
                  {(mode === 'worstCase' || mode === 'rss') && (
                    <>
                      <tr>
                        <td style={{ color: C.dim, padding: '2px 0' }}>
                          {mode === 'worstCase' ? t.worstCase : t.rss} {t.wcMax}
                        </td>
                        <td style={{ textAlign: 'right', color: C.green }}>
                          {(mode === 'worstCase' ? stackResult.worstCaseMax : stackResult.rssMax).toFixed(4)}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ color: C.dim, padding: '2px 0' }}>
                          {mode === 'worstCase' ? t.worstCase : t.rss} {t.wcMin}
                        </td>
                        <td style={{ textAlign: 'right', color: C.red }}>
                          {(mode === 'worstCase' ? stackResult.worstCaseMin : stackResult.rssMin).toFixed(4)}
                        </td>
                      </tr>
                    </>
                  )}
                  {mode === 'monteCarlo' && mcResult && (
                    <>
                      <tr>
                        <td style={{ color: C.dim, padding: '2px 0' }}>{t.mean}</td>
                        <td style={{ textAlign: 'right' }}>{mcResult.mean.toFixed(4)}</td>
                      </tr>
                      <tr>
                        <td style={{ color: C.dim, padding: '2px 0' }}>{t.stdDev}</td>
                        <td style={{ textAlign: 'right' }}>{mcResult.stdDev.toFixed(4)}</td>
                      </tr>
                    </>
                  )}
                  <tr>
                    <td style={{ color: C.dim, padding: '2px 0' }}>{t.critical}</td>
                    <td style={{ textAlign: 'right' }}>
                      {dims.find(d => d.id === stackResult.criticalDimension)?.name || '-'}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ color: C.dim, padding: '2px 0' }}>{t.cpk}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '1px 8px',
                          borderRadius: 8,
                          background: cpkColor,
                          color: '#fff',
                          fontWeight: 700,
                          fontSize: 10,
                        }}
                      >
                        {stackResult.cpk.toFixed(2)}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Stack-up diagram */}
            <div style={sectionStyle}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, marginBottom: 6 }}>
                Stack-Up Diagram
              </div>
              {dims.map((d, i) => {
                const nomW = Math.abs(d.nominal) * barScale;
                const tolPW = Math.abs(d.tolerancePlus) * barScale;
                const tolMW = Math.abs(d.toleranceMinus) * barScale;
                return (
                  <div key={d.id} style={{ marginBottom: 3 }}>
                    <div style={{ fontSize: 10, color: C.dim, marginBottom: 1 }}>
                      {d.name || `Dim ${i + 1}`} ({d.direction === 1 ? '+' : '-'})
                    </div>
                    <div style={{ display: 'flex', height: 10, alignItems: 'center' }}>
                      {/* minus tolerance */}
                      <div
                        style={{
                          width: Math.max(tolMW, 1),
                          height: '100%',
                          background: C.red,
                          opacity: 0.5,
                          borderRadius: '2px 0 0 2px',
                        }}
                      />
                      {/* nominal */}
                      <div
                        style={{
                          width: Math.max(nomW, 2),
                          height: '100%',
                          background: d.direction === 1 ? C.accent : C.yellow,
                        }}
                      />
                      {/* plus tolerance */}
                      <div
                        style={{
                          width: Math.max(tolPW, 1),
                          height: '100%',
                          background: C.green,
                          opacity: 0.5,
                          borderRadius: '0 2px 2px 0',
                        }}
                      />
                    </div>
                  </div>
                );
              })}

              {/* Comparison bars */}
              <div style={{ marginTop: 8 }}>
                {[
                  { label: t.nominal, val: stackResult.nominal, color: C.accent },
                  { label: t.worstCase, val: stackResult.worstCaseMax, color: C.red },
                  { label: t.rss, val: stackResult.rssMax, color: C.yellow },
                ].map(row => (
                  <div key={row.label} style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ width: 60, fontSize: 10, color: C.dim }}>{row.label}</span>
                    <div style={{ flex: 1, background: C.row, borderRadius: 2, height: 8, position: 'relative' }}>
                      <div
                        style={{
                          width: `${Math.min(
                            (Math.abs(row.val) / Math.max(Math.abs(stackResult.worstCaseMax), 1)) * 100,
                            100,
                          )}%`,
                          height: '100%',
                          background: row.color,
                          borderRadius: 2,
                        }}
                      />
                    </div>
                    <span style={{ width: 55, textAlign: 'right', fontSize: 10 }}>{row.val.toFixed(3)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Monte Carlo histogram */}
            {mode === 'monteCarlo' && mcResult && (
              <div style={sectionStyle}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, marginBottom: 6 }}>
                  {t.histogram}
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', height: 80, gap: 1 }}>
                  {mcResult.histogram.map((count, i) => (
                    <div
                      key={i}
                      style={{
                        flex: 1,
                        height: `${(count / histMax) * 100}%`,
                        background: C.accent,
                        borderRadius: '2px 2px 0 0',
                        minHeight: count > 0 ? 1 : 0,
                      }}
                    />
                  ))}
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 9,
                    color: C.dim,
                    marginTop: 2,
                  }}
                >
                  <span>{mcResult.percentiles['0.1']?.toFixed(2)}</span>
                  <span>{mcResult.mean.toFixed(2)}</span>
                  <span>{mcResult.percentiles['99.9']?.toFixed(2)}</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{ padding: '20px 12px', textAlign: 'center', color: C.dim, fontSize: 11 }}>
            {t.noResults}
          </div>
        )}
      </div>
    </div>
  );
}
