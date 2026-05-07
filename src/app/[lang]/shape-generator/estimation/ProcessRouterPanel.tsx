'use client';

/**
 * ProcessRouterPanel.tsx — AI Process Router UI (Phase 2).
 *
 * Shows ranked manufacturing processes with cost, lead time, pros/cons, and
 * AI reasoning. Clicking "Use this" sets the active process for downstream
 * DFM analysis + cost panel.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { GeometryMetrics, ProcessType } from './CostEstimator';
import { formatCost, getProcessName, PROCESS_ICONS } from './CostEstimator';
import { routeProcesses, type ProcessRouterResult, type ProcessRouterUseCase } from './processRouter';

const C = {
  bg: '#161b22',
  card: '#21262d',
  border: '#30363d',
  accent: '#388bfd',
  purple: '#a371f7',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  text: '#c9d1d9',
  dim: '#8b949e',
};

const dict = {
  ko: {
    proRequired: 'Pro 플랜이 필요합니다',
    title: 'AI 공정 라우터',
    subtitle: '최적 제조 공정 추천',
    targetQty: '목표 수량',
    useCase: '용도',
    priority: '우선순위',
    prototype: '프로토타입',
    production: '양산',
    custom: '맞춤형',
    cost: '비용',
    speed: '속도',
    quality: '품질',
    analyzing: '분석 중…',
    reanalyze: '재분석',
    noGeometry: '지오메트리가 없습니다',
    noProcesses: '추천 공정 없음',
    each: '개',
    pros: '장점',
    cons: '단점',
    proceed: '이 공정으로 진행',
  },
  en: {
    proRequired: 'Pro plan required',
    title: 'AI Process Router',
    subtitle: 'Recommend optimal manufacturing process',
    targetQty: 'Target Quantity',
    useCase: 'Use Case',
    priority: 'Priority',
    prototype: 'Prototype',
    production: 'Production',
    custom: 'Custom',
    cost: 'Cost',
    speed: 'Speed',
    quality: 'Quality',
    analyzing: 'Analyzing…',
    reanalyze: 'Re-analyze',
    noGeometry: 'No geometry loaded',
    noProcesses: 'No applicable processes',
    each: 'ea',
    pros: 'Pros',
    cons: 'Cons',
    proceed: 'Proceed with this process',
  },
  ja: {
    proRequired: 'Proプランが必要です',
    title: 'AI工程ルーター',
    subtitle: '最適な製造工程を推奨',
    targetQty: '目標数量',
    useCase: '用途',
    priority: '優先度',
    prototype: 'プロトタイプ',
    production: '量産',
    custom: 'カスタム',
    cost: 'コスト',
    speed: '速度',
    quality: '品質',
    analyzing: '分析中…',
    reanalyze: '再分析',
    noGeometry: 'ジオメトリがありません',
    noProcesses: '適用可能な工程なし',
    each: '個',
    pros: 'メリット',
    cons: 'デメリット',
    proceed: 'この工程で進める',
  },
  zh: {
    proRequired: '需要 Pro 套餐',
    title: 'AI 工艺路由器',
    subtitle: '推荐最佳制造工艺',
    targetQty: '目标数量',
    useCase: '用途',
    priority: '优先级',
    prototype: '原型',
    production: '量产',
    custom: '定制',
    cost: '成本',
    speed: '速度',
    quality: '质量',
    analyzing: '分析中…',
    reanalyze: '重新分析',
    noGeometry: '未加载几何体',
    noProcesses: '无适用工艺',
    each: '件',
    pros: '优点',
    cons: '缺点',
    proceed: '采用此工艺',
  },
  es: {
    proRequired: 'Se requiere el plan Pro',
    title: 'Enrutador de Procesos IA',
    subtitle: 'Recomendar proceso de fabricación óptimo',
    targetQty: 'Cantidad Objetivo',
    useCase: 'Caso de Uso',
    priority: 'Prioridad',
    prototype: 'Prototipo',
    production: 'Producción',
    custom: 'Personalizado',
    cost: 'Costo',
    speed: 'Velocidad',
    quality: 'Calidad',
    analyzing: 'Analizando…',
    reanalyze: 'Reanalizar',
    noGeometry: 'Sin geometría cargada',
    noProcesses: 'Sin procesos aplicables',
    each: 'u',
    pros: 'Pros',
    cons: 'Contras',
    proceed: 'Continuar con este proceso',
  },
  ar: {
    proRequired: 'مطلوب خطة Pro',
    title: 'موجه عمليات الذكاء الاصطناعي',
    subtitle: 'التوصية بأفضل عملية تصنيع',
    targetQty: 'الكمية المستهدفة',
    useCase: 'حالة الاستخدام',
    priority: 'الأولوية',
    prototype: 'نموذج أولي',
    production: 'إنتاج',
    custom: 'مخصص',
    cost: 'التكلفة',
    speed: 'السرعة',
    quality: 'الجودة',
    analyzing: 'جارٍ التحليل…',
    reanalyze: 'إعادة التحليل',
    noGeometry: 'لا توجد هندسة محملة',
    noProcesses: 'لا توجد عمليات قابلة للتطبيق',
    each: 'قطعة',
    pros: 'المزايا',
    cons: 'العيوب',
    proceed: 'المتابعة بهذه العملية',
  },
};

interface ProcessRouterPanelProps {
  metrics: GeometryMetrics | null;
  materialId: string;
  lang: string;
  onClose: () => void;
  /** Called when user picks a process — parent can set it as the active process */
  onSelectProcess?: (process: ProcessType) => void;
  /** Called if the API returns requiresPro / freemium-blocked */
  onRequirePro?: () => void;
  /** Optional project link for history filtering. */
  projectId?: string;
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 75 ? C.green : score >= 50 ? C.yellow : C.red;
  return (
    <div style={{ flex: 1, height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${score}%`, background: color, transition: 'width 0.3s' }} />
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const color = rank === 1 ? C.green : rank === 2 ? C.accent : rank === 3 ? C.yellow : C.dim;
  return (
    <div style={{
      width: 28, height: 28, borderRadius: 14, background: `${color}22`, border: `1px solid ${color}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color, fontSize: 13, fontWeight: 800, flexShrink: 0,
    }}>
      {rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`}
    </div>
  );
}

export default function ProcessRouterPanel({
  metrics, materialId, lang, onClose, onSelectProcess, onRequirePro, projectId,
}: ProcessRouterPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];
  const resolvedLang = langMap[seg] ?? 'en';

  const [quantity, setQuantity] = useState(100);
  const [useCase, setUseCase] = useState<ProcessRouterUseCase['useCase']>('production');
  const [priority, setPriority] = useState<ProcessRouterUseCase['priority']>('cost');
  const [rows, setRows] = useState<ProcessRouterResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);

  const runRouter = useCallback(async () => {
    if (!metrics || !materialId) return;
    setLoading(true);
    setError(null);
    try {
      const results = await routeProcesses({
        metrics,
        material: materialId,
        quantity,
        useCase,
        priority,
        lang,
        projectId,
      });
      setRows(results);
      setExpandedIdx(0);
    } catch (err) {
      const e = err as Error & { requiresPro?: boolean };
      if (e.requiresPro) {
        onRequirePro?.();
        setError(t.proRequired);
      } else {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  }, [metrics, materialId, quantity, useCase, priority, lang, onRequirePro, projectId, t]);

  // Auto-run once when opened with valid metrics
  useEffect(() => {
    if (metrics && materialId && rows === null && !loading && !error) {
      runRouter();
    }
  }, [metrics, materialId, rows, loading, error, runRouter]);

  const isKo = resolvedLang === 'ko';

  return (
    <div style={{
      position: 'fixed', top: 48, right: 16, zIndex: 900,
      width: 380, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
      background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', borderBottom: `1px solid ${C.border}`,
        background: `linear-gradient(135deg, ${C.purple}11, transparent)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🧭</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>
              {t.title}
            </div>
            <div style={{ fontSize: 10, color: C.dim }}>
              {t.subtitle}
            </div>
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: C.dim, fontSize: 18, cursor: 'pointer', padding: 4,
        }}>✕</button>
      </div>

      {/* Controls */}
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, color: C.dim, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
            {t.targetQty}
          </label>
          <div style={{ display: 'flex', gap: 4 }}>
            {[1, 10, 100, 1000, 10000].map(q => (
              <button key={q} onClick={() => setQuantity(q)} style={{
                flex: 1, padding: '6px 0', borderRadius: 6,
                border: `1px solid ${quantity === q ? C.purple : C.border}`,
                background: quantity === q ? `${C.purple}22` : 'transparent',
                color: quantity === q ? C.purple : C.dim,
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}>{q.toLocaleString()}</button>
            ))}
          </div>
          <input
            type="number" value={quantity} onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
            style={{
              width: '100%', marginTop: 6, padding: '6px 8px', borderRadius: 6,
              border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 11,
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: C.dim, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
              {t.useCase}
            </label>
            <select value={useCase} onChange={e => setUseCase(e.target.value as ProcessRouterUseCase['useCase'])} style={{
              width: '100%', padding: '6px 8px', borderRadius: 6, border: `1px solid ${C.border}`,
              background: C.card, color: C.text, fontSize: 11,
            }}>
              <option value="prototype">{t.prototype}</option>
              <option value="production">{t.production}</option>
              <option value="custom">{t.custom}</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: C.dim, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
              {t.priority}
            </label>
            <select value={priority} onChange={e => setPriority(e.target.value as ProcessRouterUseCase['priority'])} style={{
              width: '100%', padding: '6px 8px', borderRadius: 6, border: `1px solid ${C.border}`,
              background: C.card, color: C.text, fontSize: 11,
            }}>
              <option value="cost">{t.cost}</option>
              <option value="speed">{t.speed}</option>
              <option value="quality">{t.quality}</option>
            </select>
          </div>
        </div>

        <button onClick={runRouter} disabled={loading || !metrics} style={{
          padding: '8px 0', borderRadius: 6, border: 'none',
          background: loading ? C.border : `linear-gradient(135deg, ${C.purple}, ${C.accent})`,
          color: '#fff', fontSize: 12, fontWeight: 800, cursor: loading ? 'wait' : 'pointer',
          opacity: !metrics ? 0.5 : 1,
        }}>
          {loading ? t.analyzing : `🧭 ${t.reanalyze}`}
        </button>
      </div>

      {/* Results */}
      <div style={{ padding: '12px 16px' }}>
        {error && (
          <div style={{
            padding: '10px 12px', borderRadius: 6, border: `1px solid ${C.red}44`,
            background: `${C.red}0d`, color: C.red, fontSize: 11, fontWeight: 600,
          }}>
            ⚠️ {error}
          </div>
        )}
        {!error && rows === null && !loading && !metrics && (
          <div style={{ color: C.dim, fontSize: 11, textAlign: 'center', padding: 20 }}>
            {t.noGeometry}
          </div>
        )}
        {rows && rows.length === 0 && (
          <div style={{ color: C.dim, fontSize: 11, textAlign: 'center', padding: 20 }}>
            {t.noProcesses}
          </div>
        )}
        {rows && rows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((row, idx) => {
              const { estimate, ranking } = row;
              const icon = PROCESS_ICONS[estimate.process] ?? '🏭';
              const procName = getProcessName(estimate.process, isKo ? 'ko' : 'en');
              const isExpanded = expandedIdx === idx;
              return (
                <div key={estimate.process} style={{
                  border: `1px solid ${isExpanded ? C.purple : C.border}`,
                  borderRadius: 8, background: C.card, overflow: 'hidden',
                  transition: 'border 0.15s',
                }}>
                  <button onClick={() => setExpandedIdx(isExpanded ? null : idx)} style={{
                    width: '100%', padding: '10px 12px', border: 'none', background: 'transparent',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                  }}>
                    <RankBadge rank={ranking.rank} />
                    <span style={{ fontSize: 20 }}>{icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{procName}</div>
                      <div style={{ fontSize: 10, color: C.dim, fontFamily: 'monospace', marginTop: 2 }}>
                        {formatCost(estimate.unitCost, estimate.currency)}/{t.each} · {estimate.leadTime}
                      </div>
                    </div>
                    <div style={{ width: 60, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: C.purple }}>{ranking.score}/100</div>
                      <ScoreBar score={ranking.score} />
                    </div>
                  </button>
                  {isExpanded && (
                    <div style={{ padding: '0 12px 12px 12px', borderTop: `1px solid ${C.border}` }}>
                      <div style={{ marginTop: 10, fontSize: 11, color: C.text, lineHeight: 1.5 }}>
                        {isKo ? ranking.reasoningKo : ranking.reasoning}
                      </div>

                      {ranking.bestFor.length > 0 && (
                        <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {ranking.bestFor.map((tag, i) => (
                            <span key={i} style={{
                              fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                              background: `${C.accent}22`, color: C.accent, border: `1px solid ${C.accent}44`,
                            }}>
                              {tag.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                      )}

                      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: C.green, textTransform: 'uppercase', marginBottom: 4 }}>
                            ✓ {t.pros}
                          </div>
                          {(isKo ? ranking.prosKo : ranking.pros).map((p, i) => (
                            <div key={i} style={{ fontSize: 10, color: C.text, lineHeight: 1.4, marginBottom: 3 }}>
                              • {p}
                            </div>
                          ))}
                        </div>
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: C.yellow, textTransform: 'uppercase', marginBottom: 4 }}>
                            ✕ {t.cons}
                          </div>
                          {(isKo ? ranking.consKo : ranking.cons).map((c, i) => (
                            <div key={i} style={{ fontSize: 10, color: C.text, lineHeight: 1.4, marginBottom: 3 }}>
                              • {c}
                            </div>
                          ))}
                        </div>
                      </div>

                      {onSelectProcess && (
                        <button onClick={() => onSelectProcess(estimate.process)} style={{
                          width: '100%', marginTop: 10, padding: '7px 0', borderRadius: 6, border: 'none',
                          background: C.purple, color: '#fff', fontSize: 11, fontWeight: 800, cursor: 'pointer',
                        }}>
                          🧭 {t.proceed}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
