'use client';
/**
 * StepReversePanel
 *
 * Displays the result of a reverse-engineering analysis on an imported
 * STEP/mesh file. Shows:
 *  - Detected base primitive (box/cylinder/sphere/mesh) with confidence
 *  - Detected machined features (holes, pockets) with dimensions
 *  - "Apply to Feature Tree" button that calls onApply with extracted params
 *  - Raw mesh statistics
 */

import React, { useState, useEffect } from 'react';
import type { ReconstructedFeatureTree } from '../io/stepReverseEngineer';
import type * as THREE from 'three';

// ─── i18n ────────────────────────────────────────────────────────────────────
const dict = {
  ko: {
    title: 'STEP 역공학 분석',
    subtitle: '가져온 형상에서 피처 추출',
    analyzing: '분석 중…',
    base: '기본 형상',
    features: '감지된 피처',
    noFeatures: '추가 피처 없음 (단순 형상)',
    apply: '피처 트리에 적용',
    applyFeature: '피처 적용',
    confidence: '신뢰도',
    mesh: '메시 정보',
    vertices: '정점',
    triangles: '삼각형',
    params: '추출된 파라미터',
    dismiss: '닫기',
    overall: '전체 신뢰도',
    box: '직육면체',
    cylinder: '원기둥',
    sphere: '구',
    imported_mesh: '가져온 메시',
    hole: '구멍',
    pocket: '포켓',
    fillet: '모깎기',
    chamfer: '모따기',
    boss: '보스',
    rib: '리브',
    width: '너비', height: '높이', depth: '깊이',
    radius: '반지름', diameter: '지름',
  },
  en: {
    title: 'STEP Reverse Engineering',
    subtitle: 'Feature extraction from imported geometry',
    analyzing: 'Analyzing…',
    base: 'Base Shape',
    features: 'Detected Features',
    noFeatures: 'No additional features (simple shape)',
    apply: 'Apply to Feature Tree',
    applyFeature: 'Apply Feature',
    confidence: 'Confidence',
    mesh: 'Mesh Stats',
    vertices: 'Vertices',
    triangles: 'Triangles',
    params: 'Extracted Parameters',
    dismiss: 'Dismiss',
    overall: 'Overall Confidence',
    box: 'Box', cylinder: 'Cylinder', sphere: 'Sphere', imported_mesh: 'Imported Mesh',
    hole: 'Hole', pocket: 'Pocket', fillet: 'Fillet', chamfer: 'Chamfer', boss: 'Boss', rib: 'Rib',
    width: 'Width', height: 'Height', depth: 'Depth',
    radius: 'Radius', diameter: 'Diameter',
  },
} as const;

type Lang = keyof typeof dict;

// ─── Confidence bar ──────────────────────────────────────────────────────────

function ConfBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 75 ? '#3fb950' : pct >= 50 ? '#d29922' : '#f85149';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        flex: 1, height: 4, borderRadius: 4,
        background: '#21262d', overflow: 'hidden',
      }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color, minWidth: 28 }}>{pct}%</span>
    </div>
  );
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface StepReversePanelProps {
  geometry: THREE.BufferGeometry | null;
  lang?: string;
  visible?: boolean;
  onApplyBase?: (shapeId: string, params: Record<string, number>) => void;
  onDismiss?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function StepReversePanel({
  geometry,
  lang = 'en',
  visible = true,
  onApplyBase,
  onDismiss,
}: StepReversePanelProps) {
  const langKey: Lang = (lang === 'ko' || lang === 'kr') ? 'ko' : 'en';
  const t = dict[langKey];

  const [tree, setTree] = useState<ReconstructedFeatureTree | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!geometry || !visible) return;
    setLoading(true);
    setTree(null);

    let cancelled = false;
    (async () => {
      try {
        const { reverseEngineerStep } = await import('../io/stepReverseEngineer');
        const result = await reverseEngineerStep(geometry);
        if (!cancelled) {
          setTree(result);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [geometry, visible]);

  if (!visible) return null;

  const toggleExpand = (i: number) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(i) ? next.delete(i) : next.add(i);
    return next;
  });

  const PRIM_ICONS: Record<string, string> = {
    box: '📦', cylinder: '🔵', sphere: '🔴', imported_mesh: '📁',
  };
  const FEAT_ICONS: Record<string, string> = {
    hole: '⭕', pocket: '🟦', fillet: '〽️', chamfer: '✂️', boss: '🔺', rib: '📐',
  };

  return (
    <div style={{
      background: '#0d1117',
      border: '1px solid #21262d',
      borderRadius: 12,
      overflow: 'hidden',
      fontFamily: 'Inter, system-ui, sans-serif',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid #21262d',
        background: 'linear-gradient(135deg,rgba(56,139,253,0.08),rgba(63,185,80,0.08))',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>🔬</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#c9d1d9' }}>{t.title}</div>
          <div style={{ fontSize: 10, color: '#8b949e' }}>{t.subtitle}</div>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              border: 'none', background: '#161b22', color: '#6e7681',
              width: 22, height: 22, borderRadius: 6, cursor: 'pointer',
              fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >✕</button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ padding: 24, textAlign: 'center', color: '#8b949e', fontSize: 12 }}>
          <div style={{
            width: 24, height: 24, border: '2px solid #21262d', borderTop: '2px solid #388bfd',
            borderRadius: '50%', animation: 'revSpin 0.8s linear infinite',
            margin: '0 auto 10px',
          }} />
          <style>{`@keyframes revSpin { to { transform: rotate(360deg); } }`}</style>
          {t.analyzing}
        </div>
      )}

      {/* Result */}
      {!loading && tree && (
        <div className="nf-scroll" style={{ overflowY: 'auto', maxHeight: 520 }}>
          {/* Overall confidence */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #21262d' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              {t.overall}
            </div>
            <ConfBar value={tree.overallConfidence} />
          </div>

          {/* Base shape */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #21262d' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              {t.base}
            </div>
            <div style={{
              background: '#161b22', borderRadius: 8,
              border: '1px solid #30363d',
              padding: '10px 12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 16 }}>{PRIM_ICONS[tree.baseShape.type] ?? '🔷'}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#c9d1d9' }}>
                    {t[tree.baseShape.type as keyof typeof t] ?? tree.baseShape.type}
                  </div>
                  <div style={{ fontSize: 10, color: '#8b949e' }}>{tree.baseShape.label}</div>
                </div>
              </div>
              <ConfBar value={tree.baseShape.confidence} />

              {/* Parameters */}
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(tree.baseShape.params).map(([k, v]) => (
                  <div key={k} style={{
                    background: 'rgba(56,139,253,0.1)',
                    border: '1px solid rgba(56,139,253,0.2)',
                    borderRadius: 6, padding: '3px 8px',
                    fontSize: 10, fontWeight: 600, color: '#79c0ff',
                  }}>
                    {t[k as keyof typeof t] ?? k}: <strong>{typeof v === 'number' ? v.toFixed(1) : v}</strong> mm
                  </div>
                ))}
              </div>

              {/* Apply button */}
              {onApplyBase && tree.baseShape.type !== 'imported_mesh' && (
                <button
                  onClick={() => onApplyBase(
                    tree.baseShape.type === 'box' ? 'box' :
                    tree.baseShape.type === 'cylinder' ? 'cylinder' :
                    tree.baseShape.type === 'sphere' ? 'sphere' : 'box',
                    tree.baseShape.params
                  )}
                  style={{
                    marginTop: 10, width: '100%',
                    padding: '7px 0', borderRadius: 8,
                    border: '1px solid #388bfd',
                    background: 'rgba(56,139,253,0.12)',
                    color: '#58a6ff', fontSize: 11, fontWeight: 700,
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(56,139,253,0.25)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(56,139,253,0.12)'; }}
                >
                  {t.apply}
                </button>
              )}
            </div>
          </div>

          {/* Detected features */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #21262d' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              {t.features} ({tree.features.length})
            </div>
            {tree.features.length === 0 ? (
              <div style={{ fontSize: 11, color: '#484f58', fontStyle: 'italic', padding: '6px 0' }}>
                {t.noFeatures}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {tree.features.map((f, i) => (
                  <div key={i} style={{
                    background: '#161b22', borderRadius: 8,
                    border: '1px solid #30363d', overflow: 'hidden',
                  }}>
                    <div
                      onClick={() => toggleExpand(i)}
                      style={{
                        padding: '8px 10px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 13 }}>{FEAT_ICONS[f.type] ?? '🔹'}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#c9d1d9' }}>
                          {t[f.type as keyof typeof t] ?? f.type}
                        </div>
                        <div style={{ fontSize: 10, color: '#8b949e' }}>{f.label}</div>
                      </div>
                      <span style={{ fontSize: 10, color: '#8b949e' }}>
                        {expanded.has(i) ? '▾' : '▸'}
                      </span>
                    </div>
                    {expanded.has(i) && (
                      <div style={{ padding: '0 10px 10px', borderTop: '1px solid #21262d' }}>
                        <div style={{ paddingTop: 8 }}>
                          <ConfBar value={f.confidence} />
                        </div>
                        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {Object.entries(f.params).map(([k, v]) => (
                            <div key={k} style={{
                              background: 'rgba(188,140,255,0.1)',
                              border: '1px solid rgba(188,140,255,0.2)',
                              borderRadius: 6, padding: '2px 7px',
                              fontSize: 10, fontWeight: 600, color: '#bc8cff',
                            }}>
                              {t[k as keyof typeof t] ?? k}: <strong>{typeof v === 'number' ? v.toFixed(1) : v}</strong>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Mesh stats */}
          <div style={{ padding: '10px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              {t.mesh}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { label: t.vertices, value: tree.meshStats.vertices.toLocaleString() },
                { label: t.triangles, value: tree.meshStats.triangles.toLocaleString() },
                { label: 'W×H×D', value: `${tree.bbox.width}×${tree.bbox.height}×${tree.bbox.depth}` },
              ].map(item => (
                <div key={item.label} style={{
                  flex: 1, background: '#161b22', borderRadius: 8,
                  border: '1px solid #30363d', padding: '6px 8px',
                }}>
                  <div style={{ fontSize: 9, color: '#6e7681', fontWeight: 600, textTransform: 'uppercase' }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: '#c9d1d9', fontWeight: 700, marginTop: 2 }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
