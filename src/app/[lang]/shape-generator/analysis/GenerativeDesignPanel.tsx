'use client';
import React, { useState, useCallback } from 'react';
import * as THREE from 'three';
import {
  runTopologyOptimization,
  topologyResultToGeometry,
  assessManufacturability,
  type TopologyConfig,
  type TopologyResult,
  type ManufacturabilityFlag,
} from './topologyOptimization';
import type { OptProgress } from '../topology/optimizer/types';

interface Props {
  geometry: THREE.BufferGeometry | null;
  lang: string;
  onResult: (geo: THREE.BufferGeometry, result: TopologyResult) => void;
  onClose: () => void;
}

export default function GenerativeDesignPanel({ geometry, lang, onResult, onClose }: Props) {
  const isKo = lang === 'ko';
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<OptProgress | null>(null);
  const [mfgFlags, setMfgFlags] = useState<ManufacturabilityFlag[] | null>(null);
  const [expandedProcess, setExpandedProcess] = useState<string | null>(null);
  const [config, setConfig] = useState<Partial<TopologyConfig>>({
    volumeFraction: 0.4,
    iterations: 30,
    gridX: 16, gridY: 16, gridZ: 16,
    penaltyExp: 3,
    filterRadius: 1.5,
    fixedFaces: [0],
    loadFace: 1,
    loadDirection: [0, -1, 0],
  });

  const run = useCallback(async () => {
    if (!geometry || isRunning) return;
    setIsRunning(true);
    setProgress(null);
    try {
      const result = await runTopologyOptimization(geometry, config, (iter, compliance, vf, densities) => {
        setProgress({
          iteration: iter,
          maxIteration: config.iterations ?? 30,
          compliance,
          volumeFraction: vf,
          change: 0,
          densities: Float64Array.from(densities),
        });
      });
      const geo = topologyResultToGeometry(result, 0.5);
      onResult(geo, result);
      setMfgFlags(assessManufacturability(result));
    } catch (e) {
      console.error('[GenDesign]', e);
    } finally {
      setIsRunning(false);
    }
  }, [geometry, config, isRunning, onResult]);

  const C = {
    bg: '#0d1117',
    card: '#161b22',
    border: '#30363d',
    text: '#c9d1d9',
    muted: '#8b949e',
    accent: '#388bfd',
  };

  const SliderRow = ({
    label,
    value,
    min,
    max,
    step,
    unit,
    onChange,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    unit: string;
    onChange: (v: number) => void;
  }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 40px', gap: 4, alignItems: 'center', marginBottom: 4 }}>
      <span style={{ fontSize: 10, color: C.muted }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%' }}
      />
      <span style={{ fontSize: 10, color: C.text, textAlign: 'right' }}>{value}{unit}</span>
    </div>
  );

  const faceLabels = isKo
    ? ['하', '상', '전', '후', '좌', '우']
    : ['Bot', 'Top', 'Frt', 'Bak', 'Lft', 'Rgt'];

  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, width: 280, color: C.text, fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>✨ {isKo ? '생성형 설계' : 'Generative Design'}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16 }}>×</button>
      </div>

      <div style={{ fontSize: 10, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>
        {isKo
          ? 'SIMP 위상 최적화 — 하중 조건을 입력하면 AI가 최적 구조를 제안합니다.'
          : 'SIMP Topology Optimization — AI suggests optimal structure for given load conditions.'}
      </div>

      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, marginBottom: 6, textTransform: 'uppercase' }}>
          {isKo ? '최적화 설정' : 'Settings'}
        </div>
        <SliderRow
          label={isKo ? '재료 유지율' : 'Volume Frac.'}
          value={Math.round((config.volumeFraction ?? 0.4) * 100)}
          min={10} max={80} step={5} unit="%"
          onChange={v => setConfig(c => ({ ...c, volumeFraction: v / 100 }))}
        />
        <SliderRow
          label={isKo ? '반복 횟수' : 'Iterations'}
          value={config.iterations ?? 30}
          min={10} max={60} step={5} unit=""
          onChange={v => setConfig(c => ({ ...c, iterations: v }))}
        />
        <SliderRow
          label={isKo ? '격자 해상도' : 'Grid Res.'}
          value={config.gridX ?? 16}
          min={8} max={24} step={4} unit=""
          onChange={v => setConfig(c => ({ ...c, gridX: v, gridY: v, gridZ: v }))}
        />
      </div>

      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, marginBottom: 6, textTransform: 'uppercase' }}>
          {isKo ? '경계 조건' : 'Boundary Conditions'}
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          {faceLabels.map((label, i) => {
            const isFixed = (config.fixedFaces ?? [0]).includes(i);
            const isLoad = (config.loadFace ?? 1) === i;
            return (
              <button
                key={i}
                onClick={() => {
                  if (isFixed) {
                    setConfig(c => ({ ...c, fixedFaces: (c.fixedFaces ?? []).filter(f => f !== i) }));
                  } else if (isLoad) {
                    setConfig(c => ({ ...c, loadFace: i }));
                  } else {
                    setConfig(c => ({ ...c, fixedFaces: [...(c.fixedFaces ?? []), i] }));
                  }
                }}
                style={{
                  flex: 1,
                  padding: '3px 0',
                  borderRadius: 4,
                  border: `1px solid ${isFixed ? '#3fb950' : isLoad ? '#f59e0b' : C.border}`,
                  background: isFixed ? 'rgba(63,185,80,0.15)' : isLoad ? 'rgba(245,158,11,0.15)' : 'transparent',
                  color: isFixed ? '#3fb950' : isLoad ? '#f59e0b' : C.muted,
                  fontSize: 9,
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 9, color: C.muted }}>
          {isKo ? '녹색=고정, 노란=하중 적용면' : 'Green=Fixed, Yellow=Load face'}
        </div>
      </div>

      {progress && (
        <div style={{ background: C.card, borderRadius: 6, padding: '6px 10px', marginBottom: 8, fontSize: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: C.muted }}>{isKo ? '반복' : 'Iter'} {progress.iteration}</span>
            <span style={{ color: C.accent }}>VF {(progress.volumeFraction * 100).toFixed(1)}%</span>
          </div>
          <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${(progress.iteration / (config.iterations ?? 30)) * 100}%`,
                background: C.accent,
                transition: 'width 0.3s',
                borderRadius: 2,
              }}
            />
          </div>
        </div>
      )}

      <button
        onClick={run}
        disabled={!geometry || isRunning}
        style={{
          width: '100%',
          padding: '8px 0',
          borderRadius: 6,
          border: 'none',
          background: isRunning ? C.card : C.accent,
          color: isRunning ? C.muted : '#fff',
          fontWeight: 700,
          fontSize: 12,
          cursor: geometry && !isRunning ? 'pointer' : 'default',
        }}
      >
        {isRunning
          ? `⏳ ${isKo ? '최적화 중...' : 'Optimizing...'}`
          : `✨ ${isKo ? '최적 구조 생성' : 'Generate Optimal Structure'}`}
      </button>

      {/* ── Manufacturability flags ── */}
      {mfgFlags && mfgFlags.length > 0 && (
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 4 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            🏭 {isKo ? '공정 적합성 분석' : 'Process Feasibility'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {mfgFlags.map(f => {
              const fgColor = f.feasibility === 'feasible' ? '#3fb950' : f.feasibility === 'challenging' ? '#d29922' : '#f85149';
              const bgColor = f.feasibility === 'feasible' ? '#3fb95015' : f.feasibility === 'challenging' ? '#d2992215' : '#f8514915';
              const isExpanded = expandedProcess === f.process;
              return (
                <div
                  key={f.process}
                  style={{ borderRadius: 6, border: `1px solid ${fgColor}44`, background: bgColor, overflow: 'hidden' }}
                >
                  <button
                    onClick={() => setExpandedProcess(isExpanded ? null : f.process)}
                    style={{
                      width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                      padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    {/* Score bar */}
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, color: C.text, fontWeight: 700, minWidth: 90, textAlign: 'left' }}>
                        {f.label}
                      </span>
                      <div style={{ flex: 1, height: 5, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${f.score}%`, background: fgColor, borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 10, color: fgColor, fontWeight: 800, minWidth: 28, textAlign: 'right' }}>
                        {f.score}
                      </span>
                    </div>
                    <span style={{ fontSize: 9, color: fgColor, fontWeight: 700, minWidth: 60, textAlign: 'right' }}>
                      {isKo
                        ? f.feasibility === 'feasible' ? '적합' : f.feasibility === 'challenging' ? '주의 필요' : '비추천'
                        : f.feasibility === 'feasible' ? 'Feasible' : f.feasibility === 'challenging' ? 'Challenging' : 'Not Rec.'}
                    </span>
                    <span style={{ fontSize: 9, color: C.muted }}>{isExpanded ? '▲' : '▼'}</span>
                  </button>

                  {isExpanded && (
                    <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {(isKo ? f.reasonsKo : f.reasons).map((r, i) => (
                        <div key={i} style={{ fontSize: 9, color: C.muted, lineHeight: 1.5, paddingLeft: 8, borderLeft: `2px solid ${fgColor}44` }}>
                          {r}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 9, color: C.muted, marginTop: 6 }}>
            {isKo ? '* 해상도와 단순화된 휴리스틱 기반 추정치입니다.' : '* Estimates based on voxel-resolution heuristics.'}
          </div>
        </div>
      )}
    </div>
  );
}
