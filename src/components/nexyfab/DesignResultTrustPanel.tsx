'use client';

import React from 'react';
import { classifyManufacturingReadiness } from '@/lib/ai/manufacturingReadiness';

type SiteLang = 'kr' | 'en' | 'ja' | 'cn' | 'es' | 'ar';

type Copy = {
  concept: string;
  review: string;
  verified: string;
  conceptBody: string;
  reviewBody: string;
  verifiedBody: string;
  generationPass: string;
  generationBlock: string;
  generationNotRun: string;
  scopeTitle: string;
  supported: string;
  supportedBody: string;
  reviewScope: string;
  reviewScopeBody: string;
};

export const DESIGN_RESULT_TRUST_I18N: Record<SiteLang, Copy> = {
  kr: {
    concept: '개념 모델', review: '제조 전 검토 필요', verified: '제조 게이트 검증됨',
    conceptBody: '렌더링 성공은 제조 가능성을 증명하지 않습니다.',
    reviewBody: 'STEP 왕복·피처 누락·G0–G9 제조 게이트를 모두 확인해야 합니다.',
    verifiedBody: '해석형 STEP 전달과 G0–G9 제조 게이트를 통과했습니다.',
    generationPass: '생성 검사 통과', generationBlock: '생성 검사 수정 필요', generationNotRun: '생성 검사 미실행',
    scopeTitle: '제품·기계 파일럿 지원 범위', supported: '지원',
    supportedBody: '치수 기반 부품, 단순 하우징·축·부싱·플랜지·홀 패턴·판금, 2–20부품 단순 조립체',
    reviewScope: '전문가 검토 또는 미지원',
    reviewScopeBody: '고급 자유곡면, 안전 필수·압력용기, 복잡 메커니즘 무검토 릴리스, 공정 변형·수축 보정',
  },
  en: {
    concept: 'Concept only', review: 'Review required before manufacturing', verified: 'Manufacturing gates verified',
    conceptBody: 'A successful render does not prove manufacturability.',
    reviewBody: 'STEP round-trip, feature-loss, and all G0–G9 manufacturing gates must be checked.',
    verifiedBody: 'Analytic STEP handoff and all G0–G9 manufacturing gates passed.',
    generationPass: 'Generation check passed', generationBlock: 'Generation check needs correction', generationNotRun: 'Generation check not run',
    scopeTitle: 'Product & mechanical pilot scope', supported: 'Supported',
    supportedBody: 'Dimension-driven parts, simple housings, shafts, bushings, flanges, hole patterns, sheet metal, and simple 2–20-part assemblies',
    reviewScope: 'Expert review or unsupported',
    reviewScopeBody: 'Advanced free-form surfaces, safety-critical or pressure-vessel work, unreviewed complex mechanisms, and process deformation or shrinkage compensation',
  },
  ja: {
    concept: 'コンセプトモデル', review: '製造前の確認が必要', verified: '製造ゲート検証済み',
    conceptBody: 'レンダリングの成功は製造可能性を証明しません。',
    reviewBody: 'STEP往復、フィーチャ欠落、G0–G9製造ゲートをすべて確認する必要があります。',
    verifiedBody: '解析STEP引き渡しとG0–G9製造ゲートを通過しました。',
    generationPass: '生成チェック合格', generationBlock: '生成チェックの修正が必要', generationNotRun: '生成チェック未実行',
    scopeTitle: '製品・機械パイロット対応範囲', supported: '対応',
    supportedBody: '寸法駆動部品、単純な筐体・軸・ブッシュ・フランジ・穴パターン・板金、2～20部品の単純アセンブリ',
    reviewScope: '専門家確認または未対応',
    reviewScopeBody: '高度な自由曲面、安全重要部品・圧力容器、未確認の複雑機構、工程変形・収縮補正',
  },
  cn: {
    concept: '概念模型', review: '制造前需要审核', verified: '制造门控已验证',
    conceptBody: '渲染成功并不能证明可制造性。',
    reviewBody: '必须检查 STEP 往返、特征丢失及全部 G0–G9 制造门控。',
    verifiedBody: '解析型 STEP 交接及全部 G0–G9 制造门控均已通过。',
    generationPass: '生成检查通过', generationBlock: '生成检查需要修正', generationNotRun: '生成检查未执行',
    scopeTitle: '产品与机械试点支持范围', supported: '支持',
    supportedBody: '尺寸驱动零件、简单壳体、轴、衬套、法兰、孔阵列、钣金及 2–20 零件的简单装配体',
    reviewScope: '专家审核或暂不支持',
    reviewScopeBody: '高级自由曲面、安全关键件或压力容器、未经审核的复杂机构，以及工艺变形或收缩补偿',
  },
  es: {
    concept: 'Solo concepto', review: 'Revisión necesaria antes de fabricar', verified: 'Compuertas de fabricación verificadas',
    conceptBody: 'Un render correcto no demuestra la fabricabilidad.',
    reviewBody: 'Deben comprobarse el ciclo STEP, la pérdida de operaciones y todas las compuertas G0–G9.',
    verifiedBody: 'La entrega STEP analítica y todas las compuertas G0–G9 fueron aprobadas.',
    generationPass: 'Comprobación de generación aprobada', generationBlock: 'La generación necesita corrección', generationNotRun: 'Comprobación de generación no ejecutada',
    scopeTitle: 'Alcance piloto de producto y mecánica', supported: 'Compatible',
    supportedBody: 'Piezas paramétricas, carcasas, ejes, casquillos, bridas, patrones de agujeros y chapa simples, y conjuntos simples de 2–20 piezas',
    reviewScope: 'Revisión experta o no compatible',
    reviewScopeBody: 'Superficies libres avanzadas, piezas críticas o recipientes a presión, mecanismos complejos sin revisar y compensación de deformación o contracción',
  },
  ar: {
    concept: 'نموذج مفاهيمي', review: 'يلزم التحقق قبل التصنيع', verified: 'تم التحقق من بوابات التصنيع',
    conceptBody: 'نجاح العرض لا يثبت قابلية التصنيع.',
    reviewBody: 'يجب فحص دورة STEP وفقدان الميزات وجميع بوابات التصنيع G0–G9.',
    verifiedBody: 'نجح تسليم STEP التحليلي وجميع بوابات التصنيع G0–G9.',
    generationPass: 'نجح فحص التوليد', generationBlock: 'يحتاج فحص التوليد إلى تصحيح', generationNotRun: 'لم يُنفذ فحص التوليد',
    scopeTitle: 'نطاق التجربة للمنتجات والهندسة الميكانيكية', supported: 'مدعوم',
    supportedBody: 'أجزاء محددة الأبعاد، وأغلفة ومحاور وجلب وشفاه وأنماط ثقوب وصفائح بسيطة، وتجميعات بسيطة من 2 إلى 20 جزءًا',
    reviewScope: 'مراجعة خبير أو غير مدعوم',
    reviewScopeBody: 'الأسطح الحرة المتقدمة، والأجزاء الحرجة للسلامة أو أوعية الضغط، والآليات المعقدة غير المراجعة، وتعويض تشوه أو انكماش العملية',
  },
};

export function DesignResultTrustPanel({
  lang,
  hasGeometry,
  hasFeatureProgram,
  analyticStepHandoffPassed,
  generationGateStatus,
  revisionId,
  artifactSha256,
}: {
  lang: SiteLang;
  hasGeometry: boolean;
  hasFeatureProgram: boolean;
  analyticStepHandoffPassed: boolean;
  generationGateStatus: 'passed' | 'failed' | 'not_run';
  revisionId?: string | null;
  artifactSha256?: string | null;
}) {
  const copy = DESIGN_RESULT_TRUST_I18N[lang] ?? DESIGN_RESULT_TRUST_I18N.en;
  // A generation gate is deliberately not promoted to a manufacturing gate.
  // Only a signed G0-G9 report may make this classifier return `verified`.
  const readiness = classifyManufacturingReadiness({
    hasGeometry,
    hasFeatureProgram,
    analyticStepHandoffPassed,
  });
  const readinessCopy = readiness.level === 'verified'
    ? { title: copy.verified, body: copy.verifiedBody, color: '#4ade80', bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.30)' }
    : readiness.level === 'review_required'
      ? { title: copy.review, body: copy.reviewBody, color: '#fbbf24', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.30)' }
      : { title: copy.concept, body: copy.conceptBody, color: '#cbd5e1', bg: 'rgba(100,116,139,0.12)', border: 'rgba(148,163,184,0.25)' };
  const generationCopy = generationGateStatus === 'passed'
    ? { icon: '✓', label: copy.generationPass, color: '#86efac' }
    : generationGateStatus === 'failed'
      ? { icon: '!', label: copy.generationBlock, color: '#fca5a5' }
      : { icon: '–', label: copy.generationNotRun, color: '#fbbf24' };

  return (
    <div data-testid="design-result-trust" style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
      <div style={{ padding: '8px 10px', borderRadius: 9, background: readinessCopy.bg, border: `1px solid ${readinessCopy.border}` }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ color: readinessCopy.color, fontSize: 11.5 }}>{readinessCopy.title}</strong>
          <span data-testid="generation-gate-status" style={{ fontSize: 10, color: generationCopy.color }}>
            {generationCopy.icon} {generationCopy.label}
          </span>
        </div>
        <div style={{ marginTop: 3, color: '#94a3b8', fontSize: 10.5, lineHeight: 1.45 }}>{readinessCopy.body}</div>
        {revisionId && artifactSha256 && (
          <div data-testid="design-revision-binding" style={{ marginTop: 5, color: '#64748b', fontSize: 9.5, fontFamily: 'ui-monospace, monospace', overflowWrap: 'anywhere' }}>
            REV {revisionId} · SHA-256 {artifactSha256.slice(0, 16)}…
          </div>
        )}
      </div>
      <details style={{ borderRadius: 9, border: '1px solid rgba(148,163,184,0.18)', background: 'rgba(15,23,42,0.34)', padding: '7px 10px' }}>
        <summary style={{ cursor: 'pointer', color: '#cbd5e1', fontSize: 11, fontWeight: 700 }}>{copy.scopeTitle}</summary>
        <div style={{ marginTop: 7, display: 'grid', gap: 6, color: '#94a3b8', fontSize: 10.5, lineHeight: 1.45 }}>
          <div><b style={{ color: '#86efac' }}>{copy.supported}:</b> {copy.supportedBody}</div>
          <div><b style={{ color: '#fbbf24' }}>{copy.reviewScope}:</b> {copy.reviewScopeBody}</div>
        </div>
      </details>
    </div>
  );
}
