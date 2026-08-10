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
import { toIsoLang } from '@/lib/i18n/normalize';
import type { ReconstructedFeatureTree } from '../io/stepReverseEngineer';
import type * as THREE from 'three';
import { decideReconstructionReview } from './reconstructionReviewPolicy';

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
  ja: {
    title: 'STEP リバースエンジニアリング',
    subtitle: '取り込んだ形状からフィーチャーを抽出',
    analyzing: '解析中…',
    base: 'ベース形状',
    features: '検出されたフィーチャー',
    noFeatures: '追加フィーチャーなし (単純形状)',
    apply: 'フィーチャーツリーに適用',
    applyFeature: 'フィーチャーを適用',
    confidence: '信頼度',
    mesh: 'メッシュ情報',
    vertices: '頂点',
    triangles: '三角形',
    params: '抽出されたパラメータ',
    dismiss: '閉じる',
    overall: '総合信頼度',
    box: '直方体',
    cylinder: '円柱',
    sphere: '球',
    imported_mesh: '取り込みメッシュ',
    hole: '穴',
    pocket: 'ポケット',
    fillet: 'フィレット',
    chamfer: '面取り',
    boss: 'ボス',
    rib: 'リブ',
    width: '幅', height: '高さ', depth: '深さ',
    radius: '半径', diameter: '直径',
  },
  zh: {
    title: 'STEP 逆向工程',
    subtitle: '从导入的几何体中提取特征',
    analyzing: '分析中…',
    base: '基础形状',
    features: '检测到的特征',
    noFeatures: '没有额外特征（简单形状）',
    apply: '应用到特征树',
    applyFeature: '应用特征',
    confidence: '置信度',
    mesh: '网格信息',
    vertices: '顶点',
    triangles: '三角形',
    params: '提取的参数',
    dismiss: '关闭',
    overall: '整体置信度',
    box: '长方体',
    cylinder: '圆柱',
    sphere: '球',
    imported_mesh: '导入的网格',
    hole: '孔',
    pocket: '型腔',
    fillet: '圆角',
    chamfer: '倒角',
    boss: '凸台',
    rib: '筋板',
    width: '宽度', height: '高度', depth: '深度',
    radius: '半径', diameter: '直径',
  },
  es: {
    title: 'Ingeniería inversa de STEP',
    subtitle: 'Extracción de operaciones a partir de la geometría importada',
    analyzing: 'Analizando…',
    base: 'Forma base',
    features: 'Operaciones detectadas',
    noFeatures: 'Sin operaciones adicionales (forma simple)',
    apply: 'Aplicar al árbol de operaciones',
    applyFeature: 'Aplicar operación',
    confidence: 'Confianza',
    mesh: 'Información de malla',
    vertices: 'Vértices',
    triangles: 'Triángulos',
    params: 'Parámetros extraídos',
    dismiss: 'Cerrar',
    overall: 'Confianza global',
    box: 'Prisma',
    cylinder: 'Cilindro',
    sphere: 'Esfera',
    imported_mesh: 'Malla importada',
    hole: 'Agujero',
    pocket: 'Cajera',
    fillet: 'Redondeo',
    chamfer: 'Chaflán',
    boss: 'Resalte',
    rib: 'Nervio',
    width: 'Anchura', height: 'Altura', depth: 'Profundidad',
    radius: 'Radio', diameter: 'Diámetro',
  },
  ar: {
    title: 'الهندسة العكسية لملفات STEP',
    subtitle: 'استخراج المعالم من الشكل المستورد',
    analyzing: 'جارٍ التحليل…',
    base: 'الشكل الأساسي',
    features: 'المعالم المكتشفة',
    noFeatures: 'لا توجد معالم إضافية (شكل بسيط)',
    apply: 'تطبيق على شجرة المعالم',
    applyFeature: 'تطبيق المعلم',
    confidence: 'درجة الثقة',
    mesh: 'معلومات الشبكة',
    vertices: 'الرؤوس',
    triangles: 'المثلثات',
    params: 'المعاملات المستخرجة',
    dismiss: 'إغلاق',
    overall: 'الثقة الإجمالية',
    box: 'متوازي مستطيلات',
    cylinder: 'أسطوانة',
    sphere: 'كرة',
    imported_mesh: 'شبكة مستوردة',
    hole: 'ثقب',
    pocket: 'تجويف',
    fillet: 'تدوير حافة',
    chamfer: 'شطف',
    boss: 'نتوء',
    rib: 'ضلع تقوية',
    width: 'العرض', height: 'الارتفاع', depth: 'العمق',
    radius: 'نصف القطر', diameter: 'القطر',
  },
} as const;

type Lang = keyof typeof dict;

// ─── Confidence bar ──────────────────────────────────────────────────────────

function ConfBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 75 ? 'var(--nx-ok)' : pct >= 50 ? 'var(--nx-warn)' : 'var(--nx-error)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        flex: 1, height: 4, borderRadius: 4,
        background: 'var(--nx-panel-2)', overflow: 'hidden',
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
  // ⚠ 260802: 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const langKey: Lang = toIsoLang(lang) as Lang;
  const t = dict[langKey] ?? dict.en;

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
      } catch (_e) {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [geometry, visible]);

  if (!visible) return null;

  const toggleExpand = (i: number) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  });

  const PRIM_ICONS: Record<string, string> = {
    box: '📦', cylinder: '🔵', sphere: '🔴', imported_mesh: '📁',
  };
  const FEAT_ICONS: Record<string, string> = {
    hole: '⭕', pocket: '🟦', fillet: '〽️', chamfer: '✂️', boss: '🔺', rib: '📐',
  };
  const review = tree ? decideReconstructionReview(tree) : null;

  return (
    <div style={{
      background: 'var(--nx-bg)',
      border: '1px solid var(--nx-panel-2)',
      borderRadius: 12,
      overflow: 'hidden',
      fontFamily: 'Inter, system-ui, sans-serif',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--nx-panel-2)',
        background: 'linear-gradient(135deg,rgba(56,139,253,0.08),rgba(63,185,80,0.08))',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>🔬</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--nx-text)' }}>{t.title}</div>
          <div style={{ fontSize: 10, color: 'var(--nx-text-2)' }}>{t.subtitle}</div>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              border: 'none', background: 'var(--nx-panel)', color: 'var(--nx-text-3)',
              width: 22, height: 22, borderRadius: 6, cursor: 'pointer',
              fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >✕</button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--nx-text-2)', fontSize: 12 }}>
          <div style={{
            width: 24, height: 24, border: '2px solid var(--nx-panel-2)', borderTop: '2px solid var(--nx-accent)',
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
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--nx-panel-2)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--nx-text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              {t.overall}
            </div>
            <ConfBar value={tree.overallConfidence} />
            {review && (
              <div data-testid="step-reverse-grade" style={{ marginTop: 7, display: 'flex', alignItems: 'center', gap: 7, fontSize: 10, color: 'var(--nx-text-2)' }}>
                <span style={{ padding: '2px 7px', borderRadius: 999, fontWeight: 800, background: review.grade === 'A' ? 'rgba(63,185,80,.16)' : review.grade === 'B' ? 'rgba(56,139,253,.16)' : 'rgba(210,153,34,.16)', color: review.grade === 'A' ? 'var(--nx-ok)' : review.grade === 'B' ? 'var(--nx-accent-2)' : 'var(--nx-warn)' }}>
                  Grade {review.grade}
                </span>
                <span>{review.grade === 'A' ? 'verified analytic candidate' : review.grade === 'B' ? 'editable candidate' : review.grade === 'C' ? 'expert review required' : 'reference only'}</span>
              </div>
            )}
            {review && review.status !== 'candidate' && (
              <div data-testid="step-reverse-review-required" style={{ marginTop: 8, padding: '8px 10px', borderRadius: 7, background: 'rgba(210,153,34,0.12)', border: '1px solid rgba(210,153,34,0.35)', color: 'var(--nx-warn)', fontSize: 10, lineHeight: 1.5 }}>
                <strong>{review.status === 'reference_only' ? 'Reference geometry only' : 'Expert review required'}</strong>
                {review.reasons.map((reason, index) => <div key={index}>• {reason}</div>)}
              </div>
            )}
          </div>

          {/* Base shape */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--nx-panel-2)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--nx-text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              {t.base}
            </div>
            <div style={{
              background: 'var(--nx-panel)', borderRadius: 8,
              border: '1px solid var(--nx-border)',
              padding: '10px 12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 16 }}>{PRIM_ICONS[tree.baseShape.type] ?? '🔷'}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--nx-text)' }}>
                    {t[tree.baseShape.type as keyof typeof t] ?? tree.baseShape.type}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--nx-text-2)' }}>{tree.baseShape.label}</div>
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
                    fontSize: 10, fontWeight: 600, color: 'var(--nx-accent-2)',
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
                  disabled={!review?.canApplyBase}
                  title={!review?.canApplyBase ? 'Resolve reconstruction limitations before applying an editable base.' : undefined}
                  style={{
                    marginTop: 10, width: '100%',
                    padding: '7px 0', borderRadius: 8,
                    border: '1px solid var(--nx-accent)',
                    background: 'rgba(56,139,253,0.12)',
                    color: 'var(--nx-accent-2)', fontSize: 11, fontWeight: 700,
                    cursor: review?.canApplyBase ? 'pointer' : 'not-allowed', transition: 'all 0.15s',
                    opacity: review?.canApplyBase ? 1 : 0.5,
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
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--nx-panel-2)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--nx-text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              {t.features} ({tree.features.length})
            </div>
            {tree.features.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--nx-border-strong)', fontStyle: 'italic', padding: '6px 0' }}>
                {tree.limitations.length > 0 ? 'Features unverified — detection limitations are listed above.' : t.noFeatures}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {tree.features.map((f, i) => (
                  <div key={i} style={{
                    background: 'var(--nx-panel)', borderRadius: 8,
                    border: '1px solid var(--nx-border)', overflow: 'hidden',
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
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nx-text)' }}>
                          {t[f.type as keyof typeof t] ?? f.type}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--nx-text-2)' }}>{f.label}</div>
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--nx-text-2)' }}>
                        {expanded.has(i) ? '▾' : '▸'}
                      </span>
                    </div>
                    {expanded.has(i) && (
                      <div style={{ padding: '0 10px 10px', borderTop: '1px solid var(--nx-panel-2)' }}>
                        <div style={{ paddingTop: 8 }}>
                          <ConfBar value={f.confidence} />
                        </div>
                        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {Object.entries(f.params).map(([k, v]) => (
                            <div key={k} style={{
                              background: 'rgba(188,140,255,0.1)',
                              border: '1px solid rgba(188,140,255,0.2)',
                              borderRadius: 6, padding: '2px 7px',
                              fontSize: 10, fontWeight: 600, color: 'var(--nx-accent-2)',
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
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--nx-text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              {t.mesh}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { label: t.vertices, value: tree.meshStats.vertices.toLocaleString() },
                { label: t.triangles, value: tree.meshStats.triangles.toLocaleString() },
                { label: 'W×H×D', value: `${tree.bbox.width}×${tree.bbox.height}×${tree.bbox.depth}` },
              ].map(item => (
                <div key={item.label} style={{
                  flex: 1, background: 'var(--nx-panel)', borderRadius: 8,
                  border: '1px solid var(--nx-border)', padding: '6px 8px',
                }}>
                  <div style={{ fontSize: 9, color: 'var(--nx-text-3)', fontWeight: 600, textTransform: 'uppercase' }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--nx-text)', fontWeight: 700, marginTop: 2 }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
