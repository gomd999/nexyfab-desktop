'use client';
/**
 * ComposeResultPanel.tsx — L5 Composition 결과 리뷰 + Swap UI
 *
 * /api/nexyfab/compose 응답을 시각화하고, 사용자가 부품/제조법/재료 중
 * 어느 레이어든 alternatives 에서 1-클릭 swap 가능하게 함.
 * Swap 시 동일 spec + force 로 API 재호출.
 */
import React from 'react';
import { usePathname } from 'next/navigation';
import type { IntakeSpec } from './intakeSpec';

// ── i18n dict ───────────────────────────────────────────────────────────────
type Lang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

const dict = {
  ko: {
    aiDesignResult: '✨ AI 설계 결과',
    close: '닫기',
    fallbackWarning: '⚠ AI 응답 검증 실패 — 최고 점수 조합으로 폴백되었습니다',
    part: '부품',
    method: '제조법',
    material: '재료',
    tolerance: '공차',
    leadTime: '납기',
    materialPrice: '재료 단가',
    estimatedUnitCost: '예상 단가/개',
    daysUnit: '일',
    unitCostBreakdown: '단가 구성',
    basisSuffix: '개 기준',
    materialCost: '재료비',
    machiningCost: '가공비',
    setupOnce: 'setup (1회성)',
    perUnit: '개',
    volume: '부피',
    designRationale: '💡 설계 근거',
    parameters: '📐 파라미터',
    paramsCountSuffix: '개',
    otherBundles: '🎯 다른 추천 조합',
    score: '점',
    alternatives: '대안:',
    restart: '↻ 처음부터 다시',
    applyDesign: '✅ 이 설계 적용 → 3D 보기',
  },
  en: {
    aiDesignResult: '✨ AI Design Result',
    close: 'Close',
    fallbackWarning: '⚠ AI response validation failed — fell back to highest-scoring combination',
    part: 'Part',
    method: 'Method',
    material: 'Material',
    tolerance: 'Tolerance',
    leadTime: 'Lead Time',
    materialPrice: 'Material Price',
    estimatedUnitCost: 'Est. Unit Cost',
    daysUnit: 'days',
    unitCostBreakdown: 'Unit cost breakdown',
    basisSuffix: ' units basis',
    materialCost: 'Material',
    machiningCost: 'Machining',
    setupOnce: 'setup (one-time)',
    perUnit: 'units',
    volume: 'Volume',
    designRationale: '💡 Design Rationale',
    parameters: '📐 Parameters',
    paramsCountSuffix: '',
    otherBundles: '🎯 Other recommended combinations',
    score: 'pts',
    alternatives: 'Alternatives:',
    restart: '↻ Start Over',
    applyDesign: '✅ Apply Design → 3D View',
  },
  ja: {
    aiDesignResult: '✨ AI 設計結果',
    close: '閉じる',
    fallbackWarning: '⚠ AI応答の検証に失敗 — 最高スコアの組み合わせにフォールバックしました',
    part: '部品',
    method: '製法',
    material: '材料',
    tolerance: '公差',
    leadTime: '納期',
    materialPrice: '材料単価',
    estimatedUnitCost: '予想単価/個',
    daysUnit: '日',
    unitCostBreakdown: '単価構成',
    basisSuffix: '個基準',
    materialCost: '材料費',
    machiningCost: '加工費',
    setupOnce: 'setup (1回)',
    perUnit: '個',
    volume: '体積',
    designRationale: '💡 設計根拠',
    parameters: '📐 パラメータ',
    paramsCountSuffix: '個',
    otherBundles: '🎯 その他の推奨組み合わせ',
    score: '点',
    alternatives: '代替:',
    restart: '↻ 最初からやり直す',
    applyDesign: '✅ この設計を適用 → 3D 表示',
  },
  zh: {
    aiDesignResult: '✨ AI 设计结果',
    close: '关闭',
    fallbackWarning: '⚠ AI响应验证失败 — 已回退至最高分组合',
    part: '零件',
    method: '制造方法',
    material: '材料',
    tolerance: '公差',
    leadTime: '交货期',
    materialPrice: '材料单价',
    estimatedUnitCost: '预估单价/件',
    daysUnit: '天',
    unitCostBreakdown: '单价构成',
    basisSuffix: '件基准',
    materialCost: '材料费',
    machiningCost: '加工费',
    setupOnce: 'setup (一次性)',
    perUnit: '件',
    volume: '体积',
    designRationale: '💡 设计依据',
    parameters: '📐 参数',
    paramsCountSuffix: '个',
    otherBundles: '🎯 其他推荐组合',
    score: '分',
    alternatives: '替代方案:',
    restart: '↻ 重新开始',
    applyDesign: '✅ 应用此设计 → 3D 视图',
  },
  es: {
    aiDesignResult: '✨ Resultado de Diseño IA',
    close: 'Cerrar',
    fallbackWarning: '⚠ Validación de respuesta IA fallida — se usó la combinación de mayor puntuación',
    part: 'Pieza',
    method: 'Método',
    material: 'Material',
    tolerance: 'Tolerancia',
    leadTime: 'Plazo',
    materialPrice: 'Precio de Material',
    estimatedUnitCost: 'Costo Est./unidad',
    daysUnit: 'días',
    unitCostBreakdown: 'Desglose de costo unitario',
    basisSuffix: ' unidades base',
    materialCost: 'Material',
    machiningCost: 'Mecanizado',
    setupOnce: 'setup (único)',
    perUnit: 'unidades',
    volume: 'Volumen',
    designRationale: '💡 Justificación de Diseño',
    parameters: '📐 Parámetros',
    paramsCountSuffix: '',
    otherBundles: '🎯 Otras combinaciones recomendadas',
    score: 'pts',
    alternatives: 'Alternativas:',
    restart: '↻ Empezar de Nuevo',
    applyDesign: '✅ Aplicar Diseño → Vista 3D',
  },
  ar: {
    aiDesignResult: '✨ نتيجة تصميم الذكاء الاصطناعي',
    close: 'إغلاق',
    fallbackWarning: '⚠ فشل التحقق من استجابة الذكاء الاصطناعي — تم الرجوع إلى أعلى تركيبة تسجيلاً',
    part: 'الجزء',
    method: 'الطريقة',
    material: 'المادة',
    tolerance: 'التسامح',
    leadTime: 'وقت التسليم',
    materialPrice: 'سعر المادة',
    estimatedUnitCost: 'تكلفة الوحدة المقدرة',
    daysUnit: 'أيام',
    unitCostBreakdown: 'تفصيل تكلفة الوحدة',
    basisSuffix: ' وحدة أساس',
    materialCost: 'المادة',
    machiningCost: 'التشغيل الآلي',
    setupOnce: 'setup (لمرة واحدة)',
    perUnit: 'وحدة',
    volume: 'الحجم',
    designRationale: '💡 مبررات التصميم',
    parameters: '📐 المعاملات',
    paramsCountSuffix: '',
    otherBundles: '🎯 تركيبات مُوصى بها أخرى',
    score: 'نقطة',
    alternatives: 'البدائل:',
    restart: '↻ ابدأ من جديد',
    applyDesign: '✅ تطبيق التصميم → عرض ثلاثي الأبعاد',
  },
} as const;

const langMap: Record<string, Lang> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

export interface ComposeResponse {
  partId: string;
  methodId: string;
  materialId: string;
  partNameKo: string;
  methodNameKo: string;
  materialNameKo: string;
  params: Record<string, number>;
  code: string;
  rationale: string[];
  estimate: {
    toleranceMm: number;
    leadTimeDays: [number, number];
    materialPricePerKgUsd: number;
    unitCostUsd?: number;
    mass_g?: number;
    volume_cm3?: number;
    setupOnceUsd?: number;
    unitsPerOrder?: number;
    breakdown?: {
      materialUsd: number;
      machiningUsd: number;
      notes: string[];
    };
  };
  alternatives: {
    parts: { id: string; name: string; score: number }[];
    methods: { id: string; name: string; score: number }[];
    materials: { id: string; name: string; score: number }[];
  };
  bundles: {
    partId: string;
    methodId: string;
    materialId: string;
    totalScore: number;
    summary: string;
  }[];
  fallback?: boolean;
}

interface Props {
  spec: IntakeSpec;
  result: ComposeResponse;
  onApply: (code: string, label: string) => void;
  onClose: () => void;
  onRetry: () => void;   // 다시 wizard 열기
  onSwap: (force: { partId?: string; methodId?: string; materialId?: string }) => Promise<void>;
}

type Layer = 'part' | 'method' | 'material';

export default function ComposeResultPanel({
  spec,
  result,
  onApply,
  onClose,
  onRetry,
  onSwap,
}: Props) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const t = dict[langMap[seg] ?? 'en'];
  const [swapping, setSwapping] = React.useState<Layer | null>(null);

  const handleSwap = async (layer: Layer, id: string) => {
    setSwapping(layer);
    try {
      const force: any = {
        partId: result.partId,
        methodId: result.methodId,
        materialId: result.materialId,
      };
      if (layer === 'part') force.partId = id;
      if (layer === 'method') force.methodId = id;
      if (layer === 'material') force.materialId = id;
      await onSwap(force);
    } finally {
      setSwapping(null);
    }
  };

  const handleSwapBundle = async (b: ComposeResponse['bundles'][number]) => {
    setSwapping('part');
    try {
      await onSwap({ partId: b.partId, methodId: b.methodId, materialId: b.materialId });
    } finally {
      setSwapping(null);
    }
  };

  const label = `${result.partNameKo} / ${result.methodNameKo} / ${result.materialNameKo}`;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(6px)',
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 880,
          maxHeight: '92vh',
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 16,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>{t.aiDesignResult}</div>
            <h2
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: '#f1f5f9',
                margin: '2px 0 0',
              }}
            >
              {label}
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: 22,
              cursor: 'pointer',
              padding: 4,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          {result.fallback && (
            <div
              style={{
                padding: '10px 14px',
                background: 'rgba(245,158,11,0.15)',
                border: '1px solid #f59e0b',
                borderRadius: 8,
                color: '#fbbf24',
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {t.fallbackWarning}
            </div>
          )}

          {/* 3-Layer 카드 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
              marginBottom: 18,
            }}
          >
            <LayerCard
              layer="part"
              title={t.part}
              icon="🧩"
              currentId={result.partId}
              currentName={result.partNameKo}
              alternatives={result.alternatives.parts}
              swapping={swapping === 'part'}
              onSwap={(id) => handleSwap('part', id)}
              altLabel={t.alternatives}
            />
            <LayerCard
              layer="method"
              title={t.method}
              icon="🏭"
              currentId={result.methodId}
              currentName={result.methodNameKo}
              alternatives={result.alternatives.methods}
              swapping={swapping === 'method'}
              onSwap={(id) => handleSwap('method', id)}
              altLabel={t.alternatives}
            />
            <LayerCard
              layer="material"
              title={t.material}
              icon="🧪"
              currentId={result.materialId}
              currentName={result.materialNameKo}
              alternatives={result.alternatives.materials}
              swapping={swapping === 'material'}
              onSwap={(id) => handleSwap('material', id)}
              altLabel={t.alternatives}
            />
          </div>

          {/* 견적 요약 */}
          <div
            style={{
              padding: 14,
              background: '#1e293b',
              borderRadius: 10,
              marginBottom: 14,
              display: 'grid',
              gridTemplateColumns: result.estimate.unitCostUsd != null ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)',
              gap: 14,
            }}
          >
            <Stat label={t.tolerance} value={`±${result.estimate.toleranceMm} mm`} />
            <Stat
              label={t.leadTime}
              value={`${result.estimate.leadTimeDays[0]}~${result.estimate.leadTimeDays[1]} ${t.daysUnit}`}
            />
            <Stat
              label={t.materialPrice}
              value={`$${result.estimate.materialPricePerKgUsd}/kg`}
            />
            {result.estimate.unitCostUsd != null && (
              <Stat
                label={t.estimatedUnitCost}
                value={`≈ $${result.estimate.unitCostUsd}`}
                highlight
              />
            )}
          </div>

          {/* 비용 분해 (접이식) */}
          {result.estimate.breakdown && (
            <details style={{ marginBottom: 18 }}>
              <summary style={{ cursor: 'pointer', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>
                💰 {t.unitCostBreakdown} ({result.estimate.unitsPerOrder}{t.basisSuffix})
              </summary>
              <div
                style={{
                  marginTop: 8,
                  padding: '10px 14px',
                  background: '#0b1220',
                  border: '1px solid #1e293b',
                  borderRadius: 8,
                  fontSize: 12,
                  color: '#cbd5e1',
                  lineHeight: 1.7,
                }}
              >
                <div>· {t.materialCost}: <b>${result.estimate.breakdown.materialUsd}</b> ({result.estimate.mass_g}g)</div>
                <div>· {t.machiningCost}: <b>${result.estimate.breakdown.machiningUsd}</b></div>
                {result.estimate.setupOnceUsd != null && result.estimate.setupOnceUsd > 0 && (
                  <div>
                    · {t.setupOnce}: ${result.estimate.setupOnceUsd} ÷ {result.estimate.unitsPerOrder} {t.perUnit}
                    = <b>${(result.estimate.setupOnceUsd / Math.max(1, result.estimate.unitsPerOrder ?? 1)).toFixed(2)}/{t.perUnit}</b>
                  </div>
                )}
                <div style={{ marginTop: 4, color: '#94a3b8' }}>
                  · {t.volume}: {result.estimate.volume_cm3} cm³
                </div>
                {result.estimate.breakdown.notes.length > 0 && (
                  <div style={{ marginTop: 6, color: '#fbbf24' }}>
                    {result.estimate.breakdown.notes.map((n, i) => <div key={i}>⚠ {n}</div>)}
                  </div>
                )}
              </div>
            </details>
          )}

          {/* 설계 근거 */}
          {result.rationale.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <h3 style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 8px', fontWeight: 600 }}>
                {t.designRationale}
              </h3>
              <ul
                style={{
                  margin: 0,
                  padding: '12px 16px 12px 28px',
                  background: 'rgba(34,211,238,0.07)',
                  border: '1px solid rgba(34,211,238,0.25)',
                  borderRadius: 8,
                  color: '#e2e8f0',
                  fontSize: 13,
                  lineHeight: 1.7,
                }}
              >
                {result.rationale.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 파라미터 요약 */}
          <details style={{ marginBottom: 18 }}>
            <summary style={{ cursor: 'pointer', color: '#94a3b8', fontSize: 13, fontWeight: 600 }}>
              {t.parameters} ({Object.keys(result.params).length}{t.paramsCountSuffix})
            </summary>
            <div
              style={{
                marginTop: 8,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 6,
                padding: '10px 12px',
                background: '#1e293b',
                borderRadius: 8,
                fontSize: 12,
                color: '#cbd5e1',
                fontFamily: 'monospace',
              }}
            >
              {Object.entries(result.params).map(([k, v]) => (
                <div key={k}>
                  <span style={{ color: '#94a3b8' }}>{k}:</span> {v}
                </div>
              ))}
            </div>
          </details>

          {/* Top 번들 (전체 조합 swap) */}
          {result.bundles.length > 1 && (
            <details>
              <summary style={{ cursor: 'pointer', color: '#94a3b8', fontSize: 13, fontWeight: 600 }}>
                {t.otherBundles} ({result.bundles.length})
              </summary>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {result.bundles.map((b, i) => {
                  const isCurrent =
                    b.partId === result.partId &&
                    b.methodId === result.methodId &&
                    b.materialId === result.materialId;
                  return (
                    <button
                      key={i}
                      onClick={() => !isCurrent && handleSwapBundle(b)}
                      disabled={isCurrent || swapping !== null}
                      style={{
                        textAlign: 'left',
                        padding: '10px 12px',
                        background: isCurrent ? 'rgba(34,211,238,0.1)' : '#1e293b',
                        border: isCurrent ? '1px solid #22d3ee' : '1px solid #334155',
                        borderRadius: 8,
                        color: isCurrent ? '#22d3ee' : '#cbd5e1',
                        fontSize: 12,
                        cursor: isCurrent ? 'default' : 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>
                        {isCurrent && '✓ '}
                        {b.summary}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: 'rgba(255,255,255,0.05)',
                        }}
                      >
                        {b.totalScore}{t.score}
                      </span>
                    </button>
                  );
                })}
              </div>
            </details>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid #1e293b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <button
            onClick={onRetry}
            disabled={swapping !== null}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: '1px solid #334155',
              background: 'transparent',
              color: '#cbd5e1',
              cursor: swapping ? 'not-allowed' : 'pointer',
              fontSize: 13,
            }}
          >
            {t.restart}
          </button>
          <button
            onClick={() => onApply(result.code, label)}
            disabled={swapping !== null}
            style={{
              padding: '10px 26px',
              borderRadius: 8,
              border: 'none',
              background:
                swapping !== null
                  ? '#334155'
                  : 'linear-gradient(135deg, #0ea5e9, #22d3ee)',
              color: '#fff',
              cursor: swapping ? 'not-allowed' : 'pointer',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {t.applyDesign}
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────
function LayerCard({
  layer,
  title,
  icon,
  currentId,
  currentName,
  alternatives,
  swapping,
  onSwap,
  altLabel,
}: {
  layer: Layer;
  title: string;
  icon: string;
  currentId: string;
  currentName: string;
  alternatives: { id: string; name: string; score: number }[];
  swapping: boolean;
  onSwap: (id: string) => void;
  altLabel: string;
}) {
  const others = alternatives.filter((a) => a.id !== currentId);
  return (
    <div
      style={{
        padding: 14,
        background: '#1e293b',
        border: '1px solid #334155',
        borderRadius: 10,
        opacity: swapping ? 0.5 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
        {icon} {title}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: '#22d3ee',
          marginBottom: 10,
        }}
      >
        {currentName}
      </div>
      {others.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>{altLabel}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {others.slice(0, 3).map((a) => (
              <button
                key={a.id}
                onClick={() => onSwap(a.id)}
                disabled={swapping}
                title={`${a.score}`}
                style={{
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid #334155',
                  background: '#0f172a',
                  color: '#cbd5e1',
                  fontSize: 11,
                  cursor: swapping ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.name}
                </span>
                <span style={{ color: '#64748b', flexShrink: 0, marginLeft: 6 }}>{a.score}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 3 }}>{label}</div>
      <div style={{
        fontSize: highlight ? 16 : 14,
        fontWeight: 700,
        color: highlight ? '#fbbf24' : '#f1f5f9',
      }}>
        {value}
      </div>
    </div>
  );
}
