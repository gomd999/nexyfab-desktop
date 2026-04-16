'use client';

import React, { useState } from 'react';
import type { PrintAnalysisResult, PrintAnalysisOptions, OrientationOptimizationResult, PrintProcess } from './printAnalysis';

/* ─── Styles ─────────────────────────────────────────────────────────────── */

const C = {
  bg: '#161b22',
  card: '#21262d',
  border: '#30363d',
  text: '#c9d1d9',
  textDim: '#8b949e',
  accent: '#388bfd',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  orange: '#f0883e',
};

/* ─── Component ──────────────────────────────────────────────────────────── */

interface PrintAnalysisPanelProps {
  analysis: PrintAnalysisResult | null;
  onAnalyze: (options: PrintAnalysisOptions) => void;
  onClose: () => void;
  isKo: boolean;
  optimization?: OrientationOptimizationResult | null;
  onOptimizeOrientation?: (overhangAngle: number, currentDirection: [number, number, number]) => void;
  onApplyOptimalOrientation?: (direction: [number, number, number]) => void;
  onExportPrintReady?: (settings: {
    process: PrintProcess;
    layerHeight: number;
    infillPercent: number;
    printSpeed: number;
    buildDirection: [number, number, number];
  }) => void;
}

type BuildDirPreset = 'y-up' | 'z-up' | 'custom';

export default function PrintAnalysisPanel({
  analysis,
  onAnalyze,
  onClose,
  isKo,
  optimization,
  onOptimizeOrientation,
  onApplyOptimalOrientation,
  onExportPrintReady,
}: PrintAnalysisPanelProps) {
  const [overhangAngle, setOverhangAngle] = useState(45);
  const [layerHeight, setLayerHeight] = useState(0.2);
  const [minWallThickness, setMinWallThickness] = useState(0.8);
  const [buildDirPreset, setBuildDirPreset] = useState<BuildDirPreset>('y-up');
  const [customDir, setCustomDir] = useState<[number, number, number]>([0, 1, 0]);
  const [process, setProcess] = useState<PrintProcess>('fdm');
  const [infillPercent, setInfillPercent] = useState(20);
  const [printSpeed, setPrintSpeed] = useState(60);

  const getBuildDirection = (): [number, number, number] => {
    switch (buildDirPreset) {
      case 'y-up': return [0, 1, 0];
      case 'z-up': return [0, 0, 1];
      case 'custom': return customDir;
    }
  };

  const handleAnalyze = () => {
    onAnalyze({
      buildDirection: getBuildDirection(),
      overhangAngle,
      layerHeight,
      minWallThickness,
      infillPercent,
      printSpeed,
      process,
    });
  };

  const PROCESS_OPTIONS: Array<{ key: PrintProcess; label: string }> = [
    { key: 'fdm', label: 'FDM' },
    { key: 'sla', label: 'SLA' },
    { key: 'sls', label: 'SLS' },
  ];

  const severityColor = (sev: 'warning' | 'error') => sev === 'error' ? C.red : C.yellow;
  const typeIcon = (type: string) => {
    switch (type) {
      case 'overhang': return '⚠';
      case 'thin_wall': return '📏';
      case 'bridging': return '🌉';
      case 'small_feature': return '🔍';
      default: return '•';
    }
  };
  const typeLabel = (type: string) => {
    if (isKo) {
      switch (type) {
        case 'overhang': return '오버행';
        case 'thin_wall': return '얇은 벽';
        case 'bridging': return '브리징';
        case 'small_feature': return '미세 형상';
        default: return type;
      }
    }
    switch (type) {
      case 'overhang': return 'Overhang';
      case 'thin_wall': return 'Thin Wall';
      case 'bridging': return 'Bridging';
      case 'small_feature': return 'Small Feature';
      default: return type;
    }
  };

  return (
    <div data-tour="print-panel" style={{
      width: 300, background: C.bg, borderLeft: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontSize: 12, color: C.text, userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
        background: C.card,
      }}>
        <span style={{ fontWeight: 800, fontSize: 13 }}>
          🖨 {isKo ? '3D 프린팅 분석' : '3D Print Analysis'}
        </span>
        <button onClick={onClose} style={{
          border: 'none', background: 'none', color: C.textDim,
          fontSize: 16, cursor: 'pointer', lineHeight: 1,
        }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        {/* ── Settings ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
            {isKo ? '설정' : 'Settings'}
          </div>

          {/* Overhang angle slider */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: C.textDim }}>
                {isKo ? '오버행 각도' : 'Overhang Angle'}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, fontFamily: 'monospace' }}>
                {overhangAngle}°
              </span>
            </div>
            <input
              type="range"
              min={30} max={60} step={1}
              value={overhangAngle}
              onChange={e => setOverhangAngle(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#484f58' }}>
              <span>30°</span><span>45°</span><span>60°</span>
            </div>
          </div>

          {/* Layer height */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: C.textDim }}>
                {isKo ? '레이어 높이' : 'Layer Height'}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.text, fontFamily: 'monospace' }}>
                {layerHeight} mm
              </span>
            </div>
            <input
              type="range"
              min={0.05} max={0.5} step={0.05}
              value={layerHeight}
              onChange={e => setLayerHeight(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent }}
            />
          </div>

          {/* Build direction */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>
              {isKo ? '빌드 방향' : 'Build Direction'}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {([
                { key: 'y-up' as BuildDirPreset, label: 'Y-up' },
                { key: 'z-up' as BuildDirPreset, label: 'Z-up' },
                { key: 'custom' as BuildDirPreset, label: isKo ? '사용자 정의' : 'Custom' },
              ]).map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setBuildDirPreset(opt.key)}
                  style={{
                    flex: 1, padding: '4px 6px', borderRadius: 4,
                    border: 'none', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    background: buildDirPreset === opt.key ? C.accent : C.card,
                    color: buildDirPreset === opt.key ? '#fff' : C.textDim,
                    transition: 'all 0.12s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {buildDirPreset === 'custom' && (
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                  <div key={axis} style={{ flex: 1 }}>
                    <label style={{ fontSize: 9, color: '#484f58' }}>{axis}</label>
                    <input
                      type="number"
                      step={0.1}
                      value={customDir[idx]}
                      onChange={e => {
                        const v = [...customDir] as [number, number, number];
                        v[idx] = Number(e.target.value);
                        setCustomDir(v);
                      }}
                      style={{
                        width: '100%', padding: '3px 6px', borderRadius: 4,
                        border: `1px solid ${C.border}`, background: '#0d1117',
                        color: C.text, fontSize: 11, fontFamily: 'monospace',
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Process selector */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>
              {isKo ? '프로세스' : 'Process'}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {PROCESS_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setProcess(opt.key)}
                  style={{
                    flex: 1, padding: '4px 6px', borderRadius: 4,
                    border: 'none', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                    background: process === opt.key ? C.accent : C.card,
                    color: process === opt.key ? '#fff' : C.textDim,
                    transition: 'all 0.12s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Infill (FDM only) */}
          {process === 'fdm' && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: C.textDim }}>
                  {isKo ? '내부 채움' : 'Infill'}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.text, fontFamily: 'monospace' }}>
                  {infillPercent}%
                </span>
              </div>
              <input
                type="range"
                min={0} max={100} step={5}
                value={infillPercent}
                onChange={e => setInfillPercent(Number(e.target.value))}
                style={{ width: '100%', accentColor: C.accent }}
              />
            </div>
          )}

          {/* Print speed */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: C.textDim }}>
                {isKo ? '프린트 속도' : 'Print Speed'}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.text, fontFamily: 'monospace' }}>
                {printSpeed} mm/s
              </span>
            </div>
            <input
              type="range"
              min={20} max={150} step={5}
              value={printSpeed}
              onChange={e => setPrintSpeed(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent }}
            />
          </div>

          {/* Min wall thickness */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: C.textDim }}>
                {isKo ? '최소 벽 두께' : 'Min Wall Thickness'}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.text, fontFamily: 'monospace' }}>
                {minWallThickness} mm
              </span>
            </div>
            <input
              type="range"
              min={0.4} max={2.0} step={0.1}
              value={minWallThickness}
              onChange={e => setMinWallThickness(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent }}
            />
          </div>

          {/* Analyze button */}
          <button
            onClick={handleAnalyze}
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 6,
              border: 'none', background: C.accent, color: '#fff',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              transition: 'opacity 0.12s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            ▶ {isKo ? '분석 실행' : 'Analyze'}
          </button>

          {/* Auto-orient button */}
          {onOptimizeOrientation && (
            <button
              data-tour="auto-orient-btn"
              onClick={() => onOptimizeOrientation(overhangAngle, getBuildDirection())}
              style={{
                width: '100%', marginTop: 6, padding: '7px 12px', borderRadius: 6,
                border: `1px solid ${C.border}`, background: C.card, color: C.text,
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
                transition: 'all 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.text; }}
            >
              🧭 {isKo ? '자동 방향 최적화' : 'Auto-Orient'}
            </button>
          )}
        </div>

        {/* ── Orientation optimization result ── */}
        {optimization && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
              {isKo ? '방향 최적화' : 'Orientation Ranking'}
            </div>
            {(() => {
              const best = optimization.candidates[optimization.bestIndex];
              const cur  = optimization.candidates[optimization.currentIndex];
              const isAlready = optimization.bestIndex === optimization.currentIndex;
              const supportDelta = cur.supportArea - best.supportArea;
              const pct = cur.supportArea > 0
                ? Math.round((supportDelta / cur.supportArea) * 100)
                : 0;
              return (
                <div style={{
                  padding: 10, background: C.card, borderRadius: 6,
                  border: `1px solid ${isAlready ? C.green : C.accent}`,
                  marginBottom: 8,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: isAlready ? C.green : C.accent }}>
                      {isAlready
                        ? (isKo ? '✓ 이미 최적' : '✓ Already optimal')
                        : (isKo ? `↑ ${best.label} 권장` : `↑ Try ${best.label}`)}
                    </span>
                    <span style={{ fontSize: 10, color: C.textDim, fontFamily: 'monospace' }}>
                      {best.label}
                    </span>
                  </div>
                  {!isAlready && (
                    <div style={{ fontSize: 10, color: C.textDim, lineHeight: 1.5, marginBottom: 6 }}>
                      {isKo
                        ? `서포트 면적 ${pct}% ↓ (${cur.supportArea.toFixed(0)} → ${best.supportArea.toFixed(0)} mm²)`
                        : `Support area ${pct}% ↓ (${cur.supportArea.toFixed(0)} → ${best.supportArea.toFixed(0)} mm²)`}
                    </div>
                  )}
                  {!isAlready && onApplyOptimalOrientation && (
                    <button
                      onClick={() => onApplyOptimalOrientation(best.buildDirection)}
                      style={{
                        width: '100%', padding: '5px 8px', borderRadius: 4,
                        border: 'none', background: C.accent, color: '#fff',
                        fontSize: 10, fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      {isKo ? '이 방향으로 분석' : 'Re-analyze with this'}
                    </button>
                  )}
                </div>
              );
            })()}

            {/* All 6 candidates ranked */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {[...optimization.candidates]
                .map((c, idx) => ({ c, idx }))
                .sort((a, b) => a.c.score - b.c.score)
                .map(({ c, idx }, rank) => {
                  const isBest = idx === optimization.bestIndex;
                  const isCur  = idx === optimization.currentIndex;
                  return (
                    <div key={idx} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 8px', borderRadius: 4,
                      background: isBest ? '#1f2937' : 'transparent',
                      border: `1px solid ${isBest ? C.accent : 'transparent'}`,
                    }}>
                      <span style={{ fontSize: 9, color: C.textDim, width: 14, fontFamily: 'monospace' }}>
                        #{rank + 1}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: C.text, width: 22, fontFamily: 'monospace' }}>
                        {c.label}
                      </span>
                      <span style={{ fontSize: 9, color: C.textDim, flex: 1, fontFamily: 'monospace' }}>
                        {c.supportArea.toFixed(0)} mm²
                      </span>
                      {isCur && (
                        <span style={{ fontSize: 8, color: C.yellow, fontWeight: 700 }}>
                          {isKo ? '현재' : 'NOW'}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* ── Results ── */}
        {analysis && (
          <>
            {/* Summary stats */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
                {isKo ? '분석 결과' : 'Results'}
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
              }}>
                {[
                  {
                    label: isKo ? '레이어 수' : 'Layers',
                    value: analysis.layerCount.toLocaleString(),
                    icon: '📊',
                  },
                  {
                    label: isKo ? '예상 시간' : 'Est. Time',
                    value: analysis.printTime < 60
                      ? `${analysis.printTime.toFixed(0)} min`
                      : `${(analysis.printTime / 60).toFixed(1)} hr`,
                    icon: '⏱',
                  },
                  {
                    label: isKo ? '재료 사용량' : 'Material',
                    value: `${analysis.materialUsage.toFixed(2)} cm³`,
                    icon: '🧱',
                  },
                  {
                    label: isKo ? '서포트 볼륨' : 'Support Vol.',
                    value: `${analysis.supportVolume.toFixed(2)} cm³`,
                    icon: '🏗',
                  },
                  {
                    label: isKo ? '빌드 높이' : 'Build Height',
                    value: `${analysis.buildHeight.toFixed(1)} mm`,
                    icon: '📐',
                  },
                  {
                    label: isKo ? '오버행 면' : 'Overhang Faces',
                    value: analysis.overhangFaces.length.toLocaleString(),
                    icon: '⚠',
                  },
                ].map((stat, i) => (
                  <div key={i} style={{
                    padding: '8px 10px', background: C.card, borderRadius: 6,
                    border: `1px solid ${C.border}`,
                  }}>
                    <div style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>
                      {stat.icon} {stat.label}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: C.text, fontFamily: 'monospace' }}>
                      {stat.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Printability score */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
                {isKo ? '프린터빌리티' : 'Printability'}
              </div>
              {(() => {
                const errors = analysis.issues.filter(i => i.severity === 'error').length;
                const warnings = analysis.issues.filter(i => i.severity === 'warning').length;
                const score = Math.max(0, 100 - errors * 30 - warnings * 10);
                const barColor = score >= 70 ? C.green : score >= 40 ? C.yellow : C.red;
                return (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, color: barColor }}>{score}/100</span>
                      <span style={{ fontSize: 10, color: C.textDim }}>
                        {score >= 70
                          ? (isKo ? '양호' : 'Good')
                          : score >= 40
                            ? (isKo ? '주의 필요' : 'Needs Attention')
                            : (isKo ? '문제 있음' : 'Issues Found')
                        }
                      </span>
                    </div>
                    <div style={{ height: 6, background: '#0d1117', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${score}%`, height: '100%', background: barColor, borderRadius: 3, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Cost breakdown */}
            {analysis.costBreakdown && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
                  💰 {isKo ? '예상 비용' : 'Cost Estimate'}
                  <span style={{ marginLeft: 6, fontSize: 9, color: '#484f58', textTransform: 'none' }}>
                    ±{analysis.costBreakdown.confidencePct}%
                  </span>
                </div>
                <div style={{
                  padding: 12, background: C.card, borderRadius: 8,
                  border: `1px solid ${C.border}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                    <span style={{ fontSize: 10, color: C.textDim }}>
                      {isKo ? '총 비용' : 'Total'}
                    </span>
                    <span style={{ fontSize: 18, fontWeight: 800, color: C.green, fontFamily: 'monospace' }}>
                      ${analysis.costBreakdown.totalCost.toFixed(2)}
                    </span>
                  </div>
                  <div style={{ height: 1, background: C.border, marginBottom: 8 }} />
                  {[
                    {
                      label: isKo ? '재료비' : 'Material',
                      value: `$${analysis.costBreakdown.materialCost.toFixed(2)}`,
                      sub: `${analysis.costBreakdown.materialWeight.toFixed(1)} g`,
                    },
                    {
                      label: isKo ? '기계 시간' : 'Machine',
                      value: `$${analysis.costBreakdown.machineCost.toFixed(2)}`,
                      sub: analysis.printTime < 60
                        ? `${analysis.printTime.toFixed(0)} min`
                        : `${(analysis.printTime / 60).toFixed(1)} hr`,
                    },
                    {
                      label: isKo ? '실제 부피' : 'Effective Vol.',
                      value: `${analysis.costBreakdown.effectiveVolume.toFixed(2)} cm³`,
                      sub: isKo
                        ? `솔리드 ${analysis.costBreakdown.meshVolume.toFixed(2)} cm³`
                        : `solid ${analysis.costBreakdown.meshVolume.toFixed(2)} cm³`,
                    },
                  ].map((row, i) => (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '3px 0',
                    }}>
                      <span style={{ fontSize: 10, color: C.textDim }}>{row.label}</span>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.text, fontFamily: 'monospace' }}>
                          {row.value}
                        </span>
                        <span style={{ fontSize: 9, color: '#484f58', fontFamily: 'monospace' }}>
                          {row.sub}
                        </span>
                      </span>
                    </div>
                  ))}
                  {analysis.process && (
                    <div style={{
                      marginTop: 8, paddingTop: 6,
                      borderTop: `1px solid ${C.border}`,
                      fontSize: 9, color: '#484f58',
                    }}>
                      {isKo ? '프로세스: ' : 'Process: '}
                      <span style={{ color: C.textDim, fontWeight: 700 }}>
                        {analysis.process.toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Send to slicer */}
                {onExportPrintReady && (
                  <button
                    data-tour="export-slicer-btn"
                    onClick={() => onExportPrintReady({
                      process,
                      layerHeight,
                      infillPercent,
                      printSpeed,
                      buildDirection: getBuildDirection(),
                    })}
                    style={{
                      width: '100%', marginTop: 10, padding: '9px 12px', borderRadius: 6,
                      border: 'none',
                      background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                      color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                      transition: 'opacity 0.12s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                  >
                    📥 {isKo ? '슬라이서로 보내기 (STL + 3MF)' : 'Send to Slicer (STL + 3MF)'}
                  </button>
                )}
              </div>
            )}

            {/* Issues */}
            <div>
              <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
                {isKo ? '이슈 목록' : 'Issues'} ({analysis.issues.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {analysis.issues.map((issue, i) => (
                  <div key={i} style={{
                    padding: '8px 10px', background: C.card, borderRadius: 6,
                    border: `1px solid ${C.border}`,
                    borderLeft: `3px solid ${severityColor(issue.severity)}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 13 }}>{typeIcon(issue.type)}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                        color: severityColor(issue.severity),
                      }}>
                        {issue.severity === 'error' ? (isKo ? '오류' : 'ERROR') : (isKo ? '경고' : 'WARN')}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: C.text }}>
                        {typeLabel(issue.type)}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.4 }}>
                      {issue.description}
                    </div>
                    {issue.faceIndices && (
                      <div style={{ fontSize: 9, color: '#484f58', marginTop: 3, fontFamily: 'monospace' }}>
                        {issue.faceIndices.length} {isKo ? '면 영향' : 'faces affected'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div style={{ marginTop: 16, padding: '10px', background: '#0d1117', borderRadius: 8, border: `1px solid ${C.border}` }}>
              <div style={{ fontWeight: 700, fontSize: 10, color: C.textDim, marginBottom: 6 }}>
                {isKo ? '색상 범례' : 'Color Legend'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  { color: '#26bf4e', label: isKo ? '안전 (오버행 없음)' : 'Safe (no overhang)' },
                  { color: '#d4c026', label: isKo ? '주의 (중간 오버행)' : 'Moderate overhang' },
                  { color: '#f0883e', label: isKo ? '경고 (높은 오버행)' : 'High overhang' },
                  { color: '#f85149', label: isKo ? '위험 (서포트 필요)' : 'Support required' },
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 2, background: item.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: C.textDim }}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {!analysis && (
          <div style={{
            textAlign: 'center', padding: '30px 10px', color: '#484f58',
          }}>
            <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>🖨</div>
            <div style={{ fontSize: 11 }}>
              {isKo
                ? '설정을 조정하고 "분석 실행"을 클릭하세요'
                : 'Adjust settings and click "Analyze"'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
