'use client';

/**
 * MoldPanel.tsx — Parting / draft / undercut visualisation panel.
 *
 * Side panel that runs the three mold-analysis modules against the
 * current mesh and surfaces the results. Caller passes in the
 * MoldMesh; this component owns the per-pull-direction toggle +
 * heat-map opacity slider.
 */

import React, { useMemo, useState } from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';
import { detectPartingLine, type MoldMesh } from './partingLine';
import { analyzeDraft, isMoldableFromDirection, suggestPullDirection, draftColor } from './draftAnalysis';
import { detectUndercuts, type UndercutRegion } from './undercutDetect';

interface MoldPanelProps {
  lang: string;
  mesh: MoldMesh | null;
  onClose?: () => void;
  /** Caller renders the heat-map; this panel just emits which mode
   *  is selected + the per-triangle data. */
  onModeChange?: (mode: AnalysisMode | 'off', data?: AnalysisResult) => void;
}

export type AnalysisMode = 'parting' | 'draft' | 'undercut';

interface AnalysisResult {
  draftClasses?: ('positive' | 'zero' | 'negative')[];
  partingLoops?: number[][];
  undercutRegions?: UndercutRegion[];
}

const COPY = {
  ko: {
    title: '몰드 분석',
    pullDir: '뽑힘 방향',
    mode: '모드',
    parting: '분할선',
    draft: '드래프트',
    undercut: '언더컷',
    off: '끄기',
    suggestBest: '최적 방향 제안',
    moldable: '추출 가능',
    notMoldable: '슬라이드 필요',
    regions: '영역',
  },
  en: {
    title: 'Mold Analysis',
    pullDir: 'Pull Direction',
    mode: 'Mode',
    parting: 'Parting Line',
    draft: 'Draft',
    undercut: 'Undercut',
    off: 'Off',
    suggestBest: 'Suggest Best',
    moldable: 'Moldable',
    notMoldable: 'Slides Required',
    regions: 'regions',
  },
  ja: {
    title: '金型解析',
    pullDir: '抜き方向',
    mode: 'モード',
    parting: 'パーティングライン',
    draft: '抜き勾配',
    undercut: 'アンダーカット',
    off: 'オフ',
    suggestBest: '最適方向を提案',
    moldable: '抜き取り可能',
    notMoldable: 'スライドが必要',
    regions: '領域',
  },
  zh: {
    title: '模具分析',
    pullDir: '脱模方向',
    mode: '模式',
    parting: '分型线',
    draft: '拔模斜度',
    undercut: '倒扣',
    off: '关闭',
    suggestBest: '推荐最佳方向',
    moldable: '可脱模',
    notMoldable: '需滑块',
    regions: '区域',
  },
  es: {
    title: 'Análisis de molde',
    pullDir: 'Dirección de desmoldeo',
    mode: 'Modo',
    parting: 'Línea de partición',
    draft: 'Ángulo de desmoldeo',
    undercut: 'Contrasalida',
    off: 'Desactivado',
    suggestBest: 'Sugerir la mejor dirección',
    moldable: 'Desmoldeable',
    notMoldable: 'Requiere correderas',
    regions: 'Regiones',
  },
  ar: {
    title: 'تحليل القالب',
    pullDir: 'اتجاه السحب',
    mode: 'الوضع',
    parting: 'خط الانفصال',
    draft: 'زاوية السحب',
    undercut: 'التعشيق العكسي',
    off: 'إيقاف',
    suggestBest: 'اقتراح أفضل اتجاه',
    moldable: 'قابل للسحب',
    notMoldable: 'يتطلب منزلقات',
    regions: 'المناطق',
  },
} as const;

const AXES: Array<{ label: string; vector: [number, number, number] }> = [
  { label: '+X', vector: [1, 0, 0] },
  { label: '-X', vector: [-1, 0, 0] },
  { label: '+Y', vector: [0, 1, 0] },
  { label: '-Y', vector: [0, -1, 0] },
  { label: '+Z', vector: [0, 0, 1] },
  { label: '-Z', vector: [0, 0, -1] },
];

export default function MoldPanel({ lang, mesh, onClose, onModeChange }: MoldPanelProps) {
  const ko = lang === 'ko' || lang === 'kr';
  // ⚠ 260802: 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const t = COPY[toIsoLang(lang)] ?? COPY.en;
  const [pullIdx, setPullIdx] = useState(4); // +Z default
  const [mode, setMode] = useState<AnalysisMode | 'off'>('draft');

  const pullDir = AXES[pullIdx]!.vector;

  const analysis = useMemo<AnalysisResult>(() => {
    if (!mesh) return {};
    if (mode === 'parting') {
      const r = detectPartingLine(mesh, pullDir);
      return { partingLoops: r.loops };
    }
    if (mode === 'draft') {
      const r = analyzeDraft(mesh, pullDir);
      return { draftClasses: r.classes };
    }
    if (mode === 'undercut') {
      return { undercutRegions: detectUndercuts(mesh, pullDir) };
    }
    return {};
  }, [mesh, mode, pullDir]);

  // Notify parent on changes.
  React.useEffect(() => {
    onModeChange?.(mode, analysis);
  }, [mode, analysis, onModeChange]);

  const moldable = mesh && mode === 'draft'
    ? isMoldableFromDirection(analyzeDraft(mesh, pullDir))
    : null;

  const handleSuggest = () => {
    if (!mesh) return;
    const r = suggestPullDirection(mesh);
    const bestIdx = AXES.findIndex(a =>
      a.vector[0] === r.bestDirection[0]
      && a.vector[1] === r.bestDirection[1]
      && a.vector[2] === r.bestDirection[2]);
    if (bestIdx >= 0) setPullIdx(bestIdx);
  };

  return (
    <div style={panelStyle()}>
      <div style={headerStyle()}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{t.title}</h3>
        {onClose && <button onClick={onClose} style={xBtnStyle()}>✕</button>}
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={labelStyle()}>{t.pullDir}</div>
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          {AXES.map((axis, i) => (
            <button
              key={axis.label}
              onClick={() => setPullIdx(i)}
              style={i === pullIdx ? activeBtnStyle() : inactiveBtnStyle()}
            >
              {axis.label}
            </button>
          ))}
        </div>
        <button onClick={handleSuggest} style={{ ...textBtnStyle(), marginTop: 6 }}>{t.suggestBest}</button>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={labelStyle()}>{t.mode}</div>
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          {(['parting', 'draft', 'undercut', 'off'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={m === mode ? activeBtnStyle() : inactiveBtnStyle()}
            >
              {t[m]}
            </button>
          ))}
        </div>
      </div>

      {mode === 'draft' && moldable !== null && (
        <div style={{
          padding: '8px 12px', borderRadius: 6,
          background: moldable ? '#16a34a22' : '#dc262622',
          border: `1px solid ${moldable ? '#16a34a' : '#dc2626'}`,
          color: moldable ? '#22c55e' : '#f87171',
          fontSize: 12, fontWeight: 600,
        }}>
          {moldable ? `✓ ${t.moldable}` : `⚠ ${t.notMoldable}`}
        </div>
      )}

      {mode === 'undercut' && analysis.undercutRegions && (
        <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginTop: 8 }}>
          {analysis.undercutRegions.length} {t.regions}
          {analysis.undercutRegions.length > 0 && (
            <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 10 }}>
              {analysis.undercutRegions.slice(0, 3).map((r, i) => (
                <li key={i}>{r.severity} · {r.areaMm2.toFixed(1)} mm²</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mode === 'draft' && (
        <div style={{ marginTop: 10, fontSize: 10, display: 'flex', gap: 12 }}>
          <span><span style={swatchStyle(draftColor('positive'))} />{t.draft}+</span>
          <span><span style={swatchStyle(draftColor('zero'))} />0°</span>
          <span><span style={swatchStyle(draftColor('negative'))} />{t.draft}-</span>
        </div>
      )}
    </div>
  );
}

function panelStyle(): React.CSSProperties {
  return {
    // right: 336 clears the 320px right property pane (2026-06-12)
    position: 'fixed', top: 80, right: 340, zIndex: 700, width: 280,
    background: 'var(--nx-panel)', color: 'var(--nx-text)',
    borderRadius: 10, padding: '14px 16px',
    boxShadow: '0 12px 24px rgba(0,0,0,0.35)',
    fontFamily: 'system-ui, sans-serif',
  };
}
function headerStyle(): React.CSSProperties {
  return { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 };
}
function xBtnStyle(): React.CSSProperties {
  return { background: 'transparent', border: 'none', color: 'var(--nx-text-2)', cursor: 'pointer', fontSize: 16 };
}
function labelStyle(): React.CSSProperties {
  return { fontSize: 10, color: 'var(--nx-text-2)', textTransform: 'uppercase', letterSpacing: '0.04em' };
}
function activeBtnStyle(): React.CSSProperties {
  return { background: '#3b82f6', color: 'white', border: 'none', padding: '4px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer' };
}
function inactiveBtnStyle(): React.CSSProperties {
  return { background: 'var(--nx-panel-2)', color: 'var(--nx-text-2)', border: '1px solid var(--nx-border)', padding: '4px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer' };
}
function textBtnStyle(): React.CSSProperties {
  return { background: 'transparent', color: '#3b82f6', border: 'none', fontSize: 11, cursor: 'pointer', padding: 0 };
}
function swatchStyle(c: string): React.CSSProperties {
  return { display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: c, marginRight: 4 };
}
