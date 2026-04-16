'use client';

import React, { useState } from 'react';
import type { DFMResult, ManufacturingProcess, DFMIssue } from './dfmAnalysis';

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
  purple: '#a371f7',
};

/* ─── Process labels ─────────────────────────────────────────────────────── */

const PROCESS_META: Record<ManufacturingProcess, { icon: string; en: string; ko: string }> = {
  cnc_milling: { icon: '🏭', en: 'CNC Milling', ko: 'CNC 밀링' },
  cnc_turning: { icon: '🔩', en: 'CNC Turning', ko: 'CNC 선반' },
  injection_molding: { icon: '💉', en: 'Injection Molding', ko: '사출 성형' },
  sheet_metal: { icon: '📄', en: 'Sheet Metal', ko: '판금 가공' },
  casting: { icon: '🫗', en: 'Casting', ko: '주조' },
  '3d_printing': { icon: '🖨️', en: '3D Printing', ko: '3D 프린팅' },
};

const ALL_PROCESSES: ManufacturingProcess[] = ['cnc_milling', 'cnc_turning', 'injection_molding', 'sheet_metal', 'casting', '3d_printing'];

const SEVERITY_COLOR: Record<string, string> = { error: C.red, warning: C.yellow, info: C.accent };
const SEVERITY_LABEL_EN: Record<string, string> = { error: 'ERROR', warning: 'WARN', info: 'INFO' };
const SEVERITY_LABEL_KO: Record<string, string> = { error: '오류', warning: '경고', info: '정보' };

const DIFFICULTY_COLOR: Record<string, string> = {
  easy: C.green, moderate: C.yellow, difficult: C.orange, infeasible: C.red,
};
const DIFFICULTY_LABEL_EN: Record<string, string> = {
  easy: 'Easy', moderate: 'Moderate', difficult: 'Difficult', infeasible: 'Infeasible',
};
const DIFFICULTY_LABEL_KO: Record<string, string> = {
  easy: '용이', moderate: '보통', difficult: '어려움', infeasible: '불가',
};

const TYPE_ICON: Record<string, string> = {
  undercut: '⬇', thin_wall: '📏', deep_pocket: '🕳', sharp_corner: '📐',
  draft_angle: '📏', uniform_wall: '▬', tool_access: '🔧', aspect_ratio: '↕',
};

/* ─── Fix suggestion map ─────────────────────────────────────────────────── */

interface FixSuggestion {
  paramKey: string;
  label: { ko: string; en: string };
  value: number;
  unit: string;
  description: { ko: string; en: string };
}

const FIX_SUGGESTIONS: Partial<Record<DFMIssue['type'], FixSuggestion>> = {
  sharp_corner: {
    paramKey: 'filletRadius',
    label: { ko: '필렛 반경 추가', en: 'Add fillet radius' },
    value: 0.5,
    unit: 'mm',
    description: {
      ko: 'R0.5mm 필렛을 적용하면 응력 집중이 줄고 공구 수명이 늘어납니다.',
      en: 'R0.5mm fillet reduces stress concentration and extends tool life.',
    },
  },
  thin_wall: {
    paramKey: 'wallThickness',
    label: { ko: '벽 두께 증가', en: 'Increase wall thickness' },
    value: 1.2,
    unit: 'mm',
    description: {
      ko: '최소 1.2mm 벽 두께를 권장합니다. 변형 및 파손을 방지합니다.',
      en: 'Minimum 1.2mm wall thickness is recommended to prevent warping.',
    },
  },
  draft_angle: {
    paramKey: 'draftAngle',
    label: { ko: '구배 각도 추가', en: 'Add draft angle' },
    value: 1.5,
    unit: '°',
    description: {
      ko: '1.5° 구배각을 추가하면 금형에서 부품을 쉽게 빼낼 수 있습니다.',
      en: '1.5° draft angle ensures easy ejection from the mold.',
    },
  },
  deep_pocket: {
    paramKey: 'pocketDepthRatio',
    label: { ko: '포켓 깊이 줄이기', en: 'Reduce pocket depth' },
    value: 3.0,
    unit: ':1 max ratio',
    description: {
      ko: '깊이:폭 비율을 3:1 이하로 줄이면 공구 접근성이 개선됩니다.',
      en: 'Keep depth:width ratio ≤3:1 to improve tool accessibility.',
    },
  },
  undercut: {
    paramKey: 'undercutRelief',
    label: { ko: '언더컷 제거', en: 'Remove undercut' },
    value: 0,
    unit: '',
    description: {
      ko: '슬라이드 코어 추가 또는 형상 재설계로 언더컷을 제거하세요.',
      en: 'Redesign to eliminate undercut or add slide core to the mold.',
    },
  },
};

/* ─── Component ──────────────────────────────────────────────────────────── */

interface DFMPanelProps {
  results: DFMResult[] | null;
  onAnalyze: (processes: ManufacturingProcess[], options: { minWallThickness: number; minDraftAngle: number; maxAspectRatio: number }) => void;
  onClose: () => void;
  onHighlightIssue?: (issue: DFMIssue | null) => void;
  onApplyFix?: (issueType: DFMIssue['type'], suggestion: FixSuggestion) => void;
  isKo: boolean;
  /** Feature-type-based process recommendations (from useProcessRecommendation) */
  processRecommendations?: Array<{ process: ManufacturingProcess; confidence: number; reasons: string[]; emoji: string }>;
}

export default function DFMPanel({ results, onAnalyze, onClose, onHighlightIssue, onApplyFix, isKo, processRecommendations }: DFMPanelProps) {
  const [activeFixId, setActiveFixId] = useState<string | null>(null);
  const [selectedProcesses, setSelectedProcesses] = useState<Set<ManufacturingProcess>>(
    new Set(['cnc_milling', 'injection_molding']),
  );
  const [minWall, setMinWall] = useState(1.0);
  const [minDraft, setMinDraft] = useState(1.0);
  const [maxAR, setMaxAR] = useState(4.0);
  const [expandedProcess, setExpandedProcess] = useState<ManufacturingProcess | null>(null);
  const [expandedSeverity, setExpandedSeverity] = useState<Record<string, boolean>>({});

  const toggleProcess = (p: ManufacturingProcess) => {
    setSelectedProcesses(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  };

  const handleAnalyze = () => {
    if (selectedProcesses.size === 0) return;
    onAnalyze([...selectedProcesses], { minWallThickness: minWall, minDraftAngle: minDraft, maxAspectRatio: maxAR });
  };

  // Find best recommended process
  const bestProcess = results
    ? results.reduce((best, r) => (!best || r.score > best.score) ? r : best, null as DFMResult | null)
    : null;

  return (
    <div style={{
      width: 320, background: C.bg, borderLeft: `1px solid ${C.border}`,
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
          {isKo ? '제조 가능성 분석 (DFM)' : 'DFM Analysis'}
        </span>
        <button onClick={onClose} style={{
          border: 'none', background: 'none', color: C.textDim,
          fontSize: 16, cursor: 'pointer', lineHeight: 1,
        }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>

        {/* ── Feature-based Process Recommendation (pre-analysis) ── */}
        {processRecommendations && processRecommendations.length > 0 && !results && (
          <div style={{ marginBottom: 16, padding: '10px 12px', borderRadius: 8, background: 'rgba(56,139,253,0.06)', border: '1px solid rgba(56,139,253,0.25)' }}>
            <div style={{ fontWeight: 700, fontSize: 10, color: '#388bfd', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              {isKo ? '피처 기반 공정 적합도 추천' : 'Feature-Based Process Recommendation'}
            </div>
            {processRecommendations.slice(0, 3).map((rec) => (
              <div key={rec.process} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 14 }}>{rec.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#c9d1d9' }}>
                      {isKo ? PROCESS_META[rec.process].ko : PROCESS_META[rec.process].en}
                    </span>
                    <span style={{ fontSize: 10, color: rec.confidence >= 80 ? '#3fb950' : rec.confidence >= 50 ? '#f0883e' : '#8b949e' }}>
                      {rec.confidence}%
                    </span>
                  </div>
                  {rec.reasons.length > 0 && (
                    <div style={{ fontSize: 9, color: '#8b949e', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {rec.reasons[0]}
                    </div>
                  )}
                </div>
                {/* Confidence bar */}
                <div style={{ width: 48, height: 4, borderRadius: 2, background: '#21262d', flexShrink: 0 }}>
                  <div style={{ width: `${rec.confidence}%`, height: '100%', borderRadius: 2, background: rec.confidence >= 80 ? '#3fb950' : rec.confidence >= 50 ? '#f0883e' : '#8b949e', transition: 'width 0.3s' }} />
                </div>
              </div>
            ))}
            <div style={{ fontSize: 9, color: '#6e7681', marginTop: 6 }}>
              {isKo ? '아래에서 공정 선택 후 분석 실행 시 정밀 검증' : 'Select processes below and run analysis for detailed validation'}
            </div>
          </div>
        )}

        {/* ── Process Selection ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
            {isKo ? '공정 선택' : 'Select Processes'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {ALL_PROCESSES.map(p => {
              const meta = PROCESS_META[p];
              const checked = selectedProcesses.has(p);
              return (
                <label key={p} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                  background: checked ? 'rgba(56,139,253,0.1)' : 'transparent',
                  border: `1px solid ${checked ? C.accent : C.border}`,
                  transition: 'all 0.12s',
                }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleProcess(p)}
                    style={{ accentColor: C.accent }}
                  />
                  <span style={{ fontSize: 15 }}>{meta.icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 600 }}>{isKo ? meta.ko : meta.en}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* ── Settings ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
            {isKo ? '설정' : 'Settings'}
          </div>

          {/* Min wall thickness */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: C.textDim }}>{isKo ? '최소 벽 두께' : 'Min Wall Thickness'}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, fontFamily: 'monospace' }}>{minWall} mm</span>
            </div>
            <input type="range" min={0.5} max={5} step={0.1} value={minWall}
              onChange={e => setMinWall(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent }} />
          </div>

          {/* Min draft angle */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: C.textDim }}>{isKo ? '최소 구배 각도' : 'Min Draft Angle'}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, fontFamily: 'monospace' }}>{minDraft}°</span>
            </div>
            <input type="range" min={0.5} max={5} step={0.5} value={minDraft}
              onChange={e => setMinDraft(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent }} />
          </div>

          {/* Max aspect ratio */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: C.textDim }}>{isKo ? '최대 종횡비' : 'Max Aspect Ratio'}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, fontFamily: 'monospace' }}>{maxAR}:1</span>
            </div>
            <input type="range" min={2} max={10} step={0.5} value={maxAR}
              onChange={e => setMaxAR(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent }} />
          </div>

          {/* Analyze button */}
          <button
            onClick={handleAnalyze}
            disabled={selectedProcesses.size === 0}
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 6,
              border: 'none', background: selectedProcesses.size > 0 ? C.accent : '#484f58',
              color: '#fff', fontSize: 12, fontWeight: 700, cursor: selectedProcesses.size > 0 ? 'pointer' : 'default',
              transition: 'opacity 0.12s',
            }}
            onMouseEnter={e => { if (selectedProcesses.size > 0) e.currentTarget.style.opacity = '0.85'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
          >
            {isKo ? '분석 실행' : 'Run DFM Analysis'}
          </button>
        </div>

        {/* ── Results ── */}
        {results && results.length > 0 && (
          <>
            {/* Best process recommendation */}
            {bestProcess && (
              <div style={{
                marginBottom: 16, padding: '10px 12px', borderRadius: 8,
                background: 'rgba(63,185,80,0.08)', border: `1px solid ${C.green}`,
              }}>
                <div style={{ fontWeight: 700, fontSize: 11, color: C.green, marginBottom: 6 }}>
                  {isKo ? '공정 추천' : 'Recommended Process'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 20 }}>{PROCESS_META[bestProcess.process].icon}</span>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 13, color: C.text }}>
                      {isKo ? PROCESS_META[bestProcess.process].ko : PROCESS_META[bestProcess.process].en}
                    </div>
                    <div style={{ fontSize: 10, color: C.textDim }}>
                      {isKo ? '점수' : 'Score'}: {bestProcess.score}/100 &middot;{' '}
                      {isKo ? DIFFICULTY_LABEL_KO[bestProcess.estimatedDifficulty] : DIFFICULTY_LABEL_EN[bestProcess.estimatedDifficulty]}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Process ranking table ── */}
            {results.length > 1 && (() => {
              const sorted = [...results].sort((a, b) => b.score - a.score);
              const topScore = sorted[0].score || 1;
              return (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
                    {isKo ? '공정 비교' : 'Process Ranking'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {sorted.map((r, rank) => {
                      const meta = PROCESS_META[r.process];
                      const scoreColor = r.score >= 70 ? C.green : r.score >= 40 ? C.yellow : C.red;
                      const diff = rank === 0 ? null : r.score - topScore;
                      const barWidth = Math.max(6, Math.round((r.score / 100) * 100));
                      return (
                        <div key={r.process} style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '5px 8px', borderRadius: 6, background: rank === 0 ? `${C.green}0d` : C.card,
                          border: `1px solid ${rank === 0 ? C.green + '44' : C.border}`,
                        }}>
                          <span style={{ fontSize: 9, fontWeight: 700, color: C.textDim, width: 14 }}>
                            #{rank + 1}
                          </span>
                          <span style={{ fontSize: 12 }}>{meta.icon}</span>
                          <span style={{ fontSize: 10, fontWeight: 600, color: C.text, flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                            {isKo ? meta.ko : meta.en}
                          </span>
                          <div style={{ width: 60, height: 5, background: '#0d1117', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
                            <div style={{ width: `${barWidth}%`, height: '100%', background: scoreColor, borderRadius: 3 }} />
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 800, color: scoreColor, width: 28, textAlign: 'right', fontFamily: 'monospace', flexShrink: 0 }}>
                            {r.score}
                          </span>
                          {diff !== null && (
                            <span style={{ fontSize: 9, color: C.textDim, width: 26, textAlign: 'right', fontFamily: 'monospace', flexShrink: 0 }}>
                              {diff}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 9, color: '#484f58', marginTop: 2 }}>
                    {isKo ? '점수 / 차이' : 'score / diff'}
                  </div>
                </div>
              );
            })()}

            {/* Per-process results */}
            {results.map(r => {
              const meta = PROCESS_META[r.process];
              const scoreColor = r.score >= 70 ? C.green : r.score >= 40 ? C.yellow : C.red;
              const isExpanded = expandedProcess === r.process;
              const errors = r.issues.filter(i => i.severity === 'error');
              const warnings = r.issues.filter(i => i.severity === 'warning');
              const infos = r.issues.filter(i => i.severity === 'info');

              return (
                <div key={r.process} style={{
                  marginBottom: 12, borderRadius: 8,
                  border: `1px solid ${C.border}`, overflow: 'hidden',
                }}>
                  {/* Process header */}
                  <button
                    onClick={() => setExpandedProcess(isExpanded ? null : r.process)}
                    style={{
                      width: '100%', padding: '10px 12px', border: 'none',
                      background: C.card, color: C.text, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 8,
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{meta.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 12 }}>
                        {isKo ? meta.ko : meta.en}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: scoreColor, fontFamily: 'monospace' }}>
                          {r.score}/100
                        </span>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                          background: r.feasible ? 'rgba(63,185,80,0.15)' : 'rgba(248,81,73,0.15)',
                          color: r.feasible ? C.green : C.red,
                        }}>
                          {r.feasible ? (isKo ? '가능' : 'FEASIBLE') : (isKo ? '불가' : 'NOT FEASIBLE')}
                        </span>
                        <span style={{
                          fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
                          background: `${DIFFICULTY_COLOR[r.estimatedDifficulty]}20`,
                          color: DIFFICULTY_COLOR[r.estimatedDifficulty],
                        }}>
                          {isKo ? DIFFICULTY_LABEL_KO[r.estimatedDifficulty] : DIFFICULTY_LABEL_EN[r.estimatedDifficulty]}
                        </span>
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color: C.textDim }}>{isExpanded ? '▲' : '▼'}</span>
                  </button>

                  {/* Score gauge */}
                  <div style={{ padding: '0 12px', background: C.card }}>
                    <div style={{ height: 4, background: '#0d1117', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        width: `${r.score}%`, height: '100%',
                        background: scoreColor, borderRadius: 2,
                        transition: 'width 0.3s',
                      }} />
                    </div>
                  </div>

                  {/* Issue summary */}
                  <div style={{
                    display: 'flex', gap: 8, padding: '6px 12px',
                    background: C.card, fontSize: 10,
                  }}>
                    {errors.length > 0 && <span style={{ color: C.red, fontWeight: 700 }}>{errors.length} {isKo ? '오류' : 'errors'}</span>}
                    {warnings.length > 0 && <span style={{ color: C.yellow, fontWeight: 700 }}>{warnings.length} {isKo ? '경고' : 'warnings'}</span>}
                    {infos.length > 0 && <span style={{ color: C.accent, fontWeight: 700 }}>{infos.length} {isKo ? '정보' : 'info'}</span>}
                    {r.issues.length === 0 && <span style={{ color: C.green, fontWeight: 700 }}>{isKo ? '이슈 없음' : 'No issues'}</span>}
                  </div>

                  {/* Expanded issue list */}
                  {isExpanded && (
                    <div style={{ padding: '8px 12px', background: C.bg }}>
                      {(['error', 'warning', 'info'] as const).map(sev => {
                        const sevIssues = r.issues.filter(i => i.severity === sev);
                        if (sevIssues.length === 0) return null;
                        const sevKey = `${r.process}_${sev}`;
                        const isSevExpanded = expandedSeverity[sevKey] !== false; // default expanded
                        return (
                          <div key={sev} style={{ marginBottom: 8 }}>
                            <button
                              onClick={() => setExpandedSeverity(prev => ({ ...prev, [sevKey]: !isSevExpanded }))}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                background: 'none', border: 'none', color: SEVERITY_COLOR[sev],
                                fontWeight: 700, fontSize: 10, cursor: 'pointer',
                                padding: '2px 0', textTransform: 'uppercase',
                              }}
                            >
                              {isSevExpanded ? '▼' : '▶'} {isKo ? SEVERITY_LABEL_KO[sev] : SEVERITY_LABEL_EN[sev]} ({sevIssues.length})
                            </button>
                            {isSevExpanded && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                                {sevIssues.map(issue => {
                                  const fix = FIX_SUGGESTIONS[issue.type];
                                  const fixKey = `${issue.id}_fix`;
                                  const showFix = activeFixId === fixKey;
                                  return (
                                  <div key={issue.id} style={{
                                    padding: '8px 10px', background: C.card, borderRadius: 6,
                                    border: `1px solid ${C.border}`,
                                    borderLeft: `3px solid ${SEVERITY_COLOR[issue.severity]}`,
                                  }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                      <span style={{ fontSize: 13 }}>{TYPE_ICON[issue.type] ?? '•'}</span>
                                      <span style={{ fontSize: 11, fontWeight: 700, color: C.text, flex: 1 }}>
                                        {issue.type.replace(/_/g, ' ')}
                                      </span>
                                      {fix && (
                                        <button
                                          onClick={() => setActiveFixId(showFix ? null : fixKey)}
                                          style={{
                                            padding: '2px 7px', borderRadius: 4,
                                            border: `1px solid ${showFix ? C.green : C.border}`,
                                            background: showFix ? `${C.green}22` : 'transparent',
                                            color: showFix ? C.green : C.textDim,
                                            fontSize: 9, fontWeight: 700, cursor: 'pointer',
                                            transition: 'all 0.12s',
                                          }}
                                        >
                                          🔧 {isKo ? '수정' : 'Fix'}
                                        </button>
                                      )}
                                    </div>
                                    <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.4, marginBottom: 4 }}>
                                      {issue.description}
                                    </div>
                                    <div style={{ fontSize: 10, color: C.green, lineHeight: 1.4, fontStyle: 'italic' }}>
                                      {issue.suggestion}
                                    </div>

                                    {/* Fix suggestion panel */}
                                    {showFix && fix && (
                                      <div style={{
                                        marginTop: 8, padding: '8px 10px', borderRadius: 6,
                                        background: `${C.green}0d`, border: `1px solid ${C.green}44`,
                                      }}>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: C.green, marginBottom: 4 }}>
                                          {isKo ? fix.label.ko : fix.label.en}
                                          {fix.value > 0 && (
                                            <span style={{ color: C.text, fontFamily: 'monospace', marginLeft: 6 }}>
                                              → {fix.value}{fix.unit}
                                            </span>
                                          )}
                                        </div>
                                        <div style={{ fontSize: 10, color: C.textDim, lineHeight: 1.4, marginBottom: 6 }}>
                                          {isKo ? fix.description.ko : fix.description.en}
                                        </div>
                                        <button
                                          onClick={() => {
                                            onApplyFix?.(issue.type, fix);
                                            setActiveFixId(null);
                                          }}
                                          style={{
                                            width: '100%', padding: '4px 0', borderRadius: 4,
                                            border: 'none', background: C.green,
                                            color: '#fff', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                                          }}
                                        >
                                          {isKo ? '적용' : 'Apply'}
                                        </button>
                                      </div>
                                    )}

                                    {issue.faceIndices && issue.faceIndices.length > 0 && (
                                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                                        <span style={{ fontSize: 9, color: '#484f58', fontFamily: 'monospace' }}>
                                          {issue.faceIndices.length} {isKo ? '면 영향' : 'faces'}
                                        </span>
                                        <button
                                          onClick={() => onHighlightIssue?.(issue)}
                                          style={{
                                            padding: '2px 8px', borderRadius: 4, border: `1px solid ${C.border}`,
                                            background: 'transparent', color: C.accent, fontSize: 9,
                                            fontWeight: 700, cursor: 'pointer', transition: 'all 0.12s',
                                          }}
                                          onMouseEnter={e => { e.currentTarget.style.background = C.accent; e.currentTarget.style.color = '#fff'; }}
                                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.accent; }}
                                        >
                                          {isKo ? '강조' : 'Highlight'}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Color legend */}
            <div style={{ marginTop: 8, padding: '10px', background: '#0d1117', borderRadius: 8, border: `1px solid ${C.border}` }}>
              <div style={{ fontWeight: 700, fontSize: 10, color: C.textDim, marginBottom: 6 }}>
                {isKo ? '색상 범례' : 'Color Legend'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  { color: C.green, label: isKo ? '이슈 없음' : 'No issues' },
                  { color: C.yellow, label: isKo ? '경고' : 'Warning' },
                  { color: C.red, label: isKo ? '오류 / 문제' : 'Error / Problem' },
                  { color: C.accent, label: isKo ? '선택된 이슈' : 'Selected issue' },
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

        {!results && (
          <div style={{ textAlign: 'center', padding: '30px 10px', color: '#484f58' }}>
            <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>🏭</div>
            <div style={{ fontSize: 11 }}>
              {isKo
                ? '공정을 선택하고 "분석 실행"을 클릭하세요'
                : 'Select processes and click "Run DFM Analysis"'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
