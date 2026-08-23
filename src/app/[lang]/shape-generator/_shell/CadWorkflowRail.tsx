'use client';

import type { CSSProperties } from 'react';
import type { AdaptiveComplexProductExecutionPlan } from '@/lib/ai/adaptiveComplexProductExecution';
import type { DesignDomainId } from '@/lib/ai/domainProfile';
import { getDomainUserJourney } from '@/lib/ai/domainUserJourney';

export interface CadWorkflowRailProps {
  lang: string;
  domain?: DesignDomainId;
  hasModel: boolean;
  dfmWarningCount: number | null;
  executionPlan?: AdaptiveComplexProductExecutionPlan | null;
  onAiDesign: () => void;
  onPreciseCad: () => void;
  onVerify: () => void;
  onExportEvidencePackage: () => void;
  compact?: boolean;
}

export type CadWorkflowTruth = 'NOT_RUN' | 'WORKING' | 'PREVIEW' | 'BLOCKED' | 'VERIFIED';
export type CadWorkflowStep = 'ai' | 'cad' | 'verify' | 'release';

export interface CadWorkflowGuidance {
  step: CadWorkflowStep;
  truth: CadWorkflowTruth;
  action: CadWorkflowStep | null;
}

/**
 * One fail-closed summary for the novice-facing next action.  In particular,
 * a clean preview/DFM result is not promoted to release evidence.
 */
export function getCadWorkflowGuidance({
  hasModel,
  dfmWarningCount,
  executionPlan,
}: Pick<CadWorkflowRailProps, 'hasModel' | 'dfmWarningCount' | 'executionPlan'>): CadWorkflowGuidance {
  if (executionPlan?.status === 'ai_building') {
    return { step: 'ai', truth: 'WORKING', action: null };
  }
  if (executionPlan?.status === 'authoritative_input_required') {
    return { step: 'ai', truth: 'BLOCKED', action: 'ai' };
  }
  if (executionPlan?.status === 'precision_cad_required') {
    return { step: 'cad', truth: 'PREVIEW', action: 'cad' };
  }
  if (executionPlan?.status === 'expert_review_required') {
    return { step: 'release', truth: 'BLOCKED', action: 'cad' };
  }
  if (!hasModel) return { step: 'ai', truth: 'NOT_RUN', action: 'ai' };
  if (dfmWarningCount === null) return { step: 'verify', truth: 'NOT_RUN', action: 'verify' };
  if (dfmWarningCount > 0) return { step: 'verify', truth: 'BLOCKED', action: 'ai' };
  if (executionPlan?.releaseReady === true) return { step: 'release', truth: 'VERIFIED', action: 'release' };
  return { step: 'verify', truth: 'PREVIEW', action: 'verify' };
}

const copy = {
  ko: {
    label: '설계 흐름', ai: '1 AI 제품 구현', aiState: '복잡 제품을 부품·조립·동작·제조 단계까지 구현',
    cad: '2 정밀 CAD 엔진', cadState: '일반 사용자는 AI 자동 처리 · 전문가는 필요할 때 직접 편집',
    aiBuilding: 'AI가 제품 완성 파이프라인 진행 중', input: '권위 있는 사양·재료·카탈로그 입력 필요', precision: 'AI가 지정 범위를 정밀 CAD로 자동 처리 중 · 전문가 편집 선택 가능', expert: '설계 완료 · 전문가 릴리스 검토 필요', complete: 'AI 제품 구현 및 검증 완료',
    verify: '3 정확성 검증', waiting: '형상 생성 후 검증', run: 'DFM 및 정밀 증거 확인',
    issues: (n: number) => `DFM 이슈 ${n}건 · 조정 필요`, dfmPass: 'DFM 통과 · 정밀 릴리스 증거 확인 필요',
    release: '4 릴리스 / 전문가', blocked: '증거 없이는 제조 승인 안 됨',
    package: '증거 패키지', external: '외부 CAD 설치 불필요',
    affected: (n: number) => `영향 부품 ${n}개`, reasons: '확인 필요', verified: '기술 검증 완료 · 상용 출시는 별도 승인',
    now: '현재', next: '다음', actions: { ai: 'AI에게 입력·수정 요청', cad: '정밀 CAD 열기', verify: '정확성 검사 실행', release: '검증 패키지 내보내기' },
  },
  en: {
    label: 'Design flow', ai: '1 AI product build', aiState: 'Build complex parts, assemblies, motion and manufacturing outputs',
    cad: '2 Precision CAD engine', cadState: 'AI-managed for general users · direct editing is optional for experts',
    aiBuilding: 'AI is advancing the complete product pipeline', input: 'Authoritative specification, material or catalog input required', precision: 'AI is automatically running precision CAD on the governed scope · expert editing remains optional', expert: 'Design complete · expert release review required', complete: 'AI product build and governed verification complete',
    verify: '3 Accuracy gates', waiting: 'Verify after geometry exists', run: 'Run DFM and exact evidence gates',
    issues: (n: number) => `${n} DFM issue(s) · adjustment required`, dfmPass: 'DFM passed · exact release evidence still required',
    release: '4 Release / expert', blocked: 'No manufacturing approval without evidence',
    package: 'Evidence package', external: 'No external CAD installation',
    affected: (n: number) => `${n} affected part(s)`, reasons: 'Needs attention', verified: 'Technically verified · commercial release is separate',
    now: 'Now', next: 'Next', actions: { ai: 'Ask AI for input or repair', cad: 'Open precision CAD', verify: 'Run accuracy checks', release: 'Export verified package' },
  },
  ja: {
    label: '設計フロー', ai: '1 AI製品実装', aiState: '複雑な部品・アセンブリ・動作・製造成果物まで実装',
    cad: '2 精密CADエンジン', cadState: '一般ユーザーはAI自動処理・専門家は必要時のみ直接編集',
    aiBuilding: 'AIが製品完成パイプラインを実行中', input: '信頼できる仕様・材料・カタログ情報が必要', precision: 'AIが対象範囲を精密CADで自動処理中・専門家編集も選択可能', expert: '設計完了・専門家のリリース確認が必要', complete: 'AI製品実装と管理された検証が完了',
    verify: '3 精度検証', waiting: '形状生成後に検証', run: 'DFMと精密証拠を確認',
    issues: (n: number) => `DFM問題 ${n}件・調整が必要`, dfmPass: 'DFM合格・精密リリース証拠は別途必要',
    release: '4 リリース / 専門家', blocked: '証拠なしでは製造承認不可',
    package: '証拠パッケージ', external: '外部CADのインストール不要',
    affected: (n: number) => `影響部品 ${n}個`, reasons: '確認が必要', verified: '技術検証済み・商用リリースは別途承認',
    now: '現在', next: '次へ', actions: { ai: 'AIに入力・修正を依頼', cad: '精密CADを開く', verify: '精度検証を実行', release: '検証済みパッケージを出力' },
  },
  zh: {
    label: '设计流程', ai: '1 AI产品实现', aiState: '实现复杂零件、装配、运动和制造输出',
    cad: '2 精密CAD引擎', cadState: '普通用户由AI自动处理，专家可在需要时直接编辑',
    aiBuilding: 'AI正在运行完整产品流程', input: '需要权威的规格、材料或目录信息', precision: 'AI正在对受控范围自动执行精密CAD，专家编辑仍可选', expert: '设计完成，需要专家发布审核', complete: 'AI产品实现和受控验证已完成',
    verify: '3 准确性验证', waiting: '生成几何体后验证', run: '运行DFM和精密证据检查',
    issues: (n: number) => `${n}个DFM问题，需要调整`, dfmPass: 'DFM已通过，仍需精密发布证据',
    release: '4 发布 / 专家', blocked: '没有证据不得批准制造',
    package: '证据包', external: '无需安装外部CAD',
    affected: (n: number) => `${n}个受影响零件`, reasons: '需要确认', verified: '技术验证完成，商业发布需单独批准',
    now: '当前', next: '下一步', actions: { ai: '请求AI补充或修复', cad: '打开精密CAD', verify: '运行精度检查', release: '导出已验证包' },
  },
  es: {
    label: 'Flujo de diseño', ai: '1 Implementación de producto con IA', aiState: 'Crea piezas complejas, ensamblajes, movimiento y resultados de fabricación',
    cad: '2 Motor CAD de precisión', cadState: 'La IA gestiona el uso general; la edición directa es opcional para expertos',
    aiBuilding: 'La IA está ejecutando el flujo completo del producto', input: 'Se requiere una especificación, material o catálogo autorizado', precision: 'La IA ejecuta CAD de precisión en el alcance controlado; la edición experta sigue siendo opcional', expert: 'Diseño completo; se requiere revisión experta de publicación', complete: 'Implementación y verificación controlada completadas',
    verify: '3 Verificación de precisión', waiting: 'Verificar después de generar la geometría', run: 'Ejecutar DFM y controles de evidencia exacta',
    issues: (n: number) => `${n} problema(s) DFM; se requiere ajuste`, dfmPass: 'DFM aprobado; aún se requiere evidencia exacta de publicación',
    release: '4 Publicación / experto', blocked: 'Sin evidencia no se aprueba la fabricación',
    package: 'Paquete de evidencia', external: 'No requiere instalar CAD externo',
    affected: (n: number) => `${n} pieza(s) afectada(s)`, reasons: 'Requiere atención', verified: 'Verificado técnicamente; la publicación comercial es independiente',
    now: 'Ahora', next: 'Siguiente', actions: { ai: 'Pedir datos o corrección a la IA', cad: 'Abrir CAD de precisión', verify: 'Ejecutar controles de precisión', release: 'Exportar paquete verificado' },
  },
  ar: {
    label: 'مسار التصميم', ai: '1 تنفيذ المنتج بالذكاء الاصطناعي', aiState: 'إنشاء الأجزاء المعقدة والتجميع والحركة ومخرجات التصنيع',
    cad: '2 محرك CAD دقيق', cadState: 'إدارة آلية للمستخدم العام وتحرير مباشر اختياري للخبير',
    aiBuilding: 'ينفذ الذكاء الاصطناعي مسار المنتج الكامل', input: 'يلزم إدخال مواصفة أو مادة أو كتالوج موثوق', precision: 'ينفذ الذكاء الاصطناعي CAD الدقيق تلقائيا للنطاق المحكوم مع بقاء تحرير الخبير اختياريا', expert: 'اكتمل التصميم وتلزم مراجعة خبير للإصدار', complete: 'اكتمل تنفيذ المنتج والتحقق المحكوم',
    verify: '3 التحقق من الدقة', waiting: 'التحقق بعد إنشاء الهندسة', run: 'تشغيل DFM وبوابات الأدلة الدقيقة',
    issues: (n: number) => `${n} مشكلة DFM؛ يلزم التعديل`, dfmPass: 'اجتاز DFM وما زال دليل الإصدار الدقيق مطلوبا',
    release: '4 الإصدار / الخبير', blocked: 'لا اعتماد للتصنيع من دون دليل',
    package: 'حزمة الأدلة', external: 'لا حاجة إلى تثبيت CAD خارجي',
    affected: (n: number) => `${n} جزء متأثر`, reasons: 'يحتاج إلى مراجعة', verified: 'تم التحقق تقنيا؛ الإصدار التجاري مستقل',
    now: 'الآن', next: 'التالي', actions: { ai: 'اطلب إدخالا أو إصلاحا من الذكاء الاصطناعي', cad: 'فتح CAD الدقيق', verify: 'تشغيل فحوص الدقة', release: 'تصدير الحزمة المتحقق منها' },
  },
};

export function CadWorkflowRail({
  lang, domain = 'mechanical', hasModel, dfmWarningCount, executionPlan, onAiDesign, onPreciseCad, onVerify, onExportEvidencePackage, compact = false,
}: CadWorkflowRailProps) {
  const normalizedLang = lang === 'kr' ? 'ko' : lang;
  const d = copy[normalizedLang as keyof typeof copy] ?? copy.en;
  const journey = getDomainUserJourney(domain, normalizedLang);
  const domainCopy = {
    ko: {
      ai: `1 AI ${journey.title} 구현`, state: `${journey.focus} 범위를 구현`,
      issues: (n: number) => `형상·분야 이슈 ${n}건 · 조정 필요`,
      pass: '기본 형상 통과 · 분야 검증과 릴리스 증거 확인 필요',
    },
    en: {
      ai: `1 AI ${journey.title} build`, state: `Build ${journey.focus.toLocaleLowerCase()}`,
      issues: (n: number) => `${n} geometry/domain issue(s) · adjustment required`,
      pass: 'Base geometry passed · domain checks and release evidence required',
    },
  }[normalizedLang as 'ko' | 'en'];
  const aiLabel = domainCopy?.ai ?? d.ai;
  const domainAiState = domainCopy?.state ?? d.aiState;
  const verifyState = !hasModel
    ? d.waiting
    : dfmWarningCount === null
      ? d.run
      : dfmWarningCount > 0
        ? domain === 'mechanical' ? d.issues(dfmWarningCount) : (domainCopy?.issues(dfmWarningCount) ?? d.issues(dfmWarningCount))
        : domain === 'mechanical' ? d.dfmPass : (domainCopy?.pass ?? d.dfmPass);
  const aiState = executionPlan?.status === 'authoritative_input_required' ? d.input
    : executionPlan?.status === 'precision_cad_required' ? d.precision
      : executionPlan?.status === 'expert_review_required' ? d.expert
        : executionPlan?.status === 'ai_design_complete' ? d.complete
          : executionPlan?.status === 'ai_building' ? d.aiBuilding : domainAiState;
  const precisionRequired = executionPlan?.precisionCad.required === true;
  const guidance = getCadWorkflowGuidance({ hasModel, dfmWarningCount, executionPlan });
  const nextAction = guidance.action ? d.actions[guidance.action] : aiState;
  const runNextAction = guidance.action === 'ai' ? onAiDesign
    : guidance.action === 'cad' ? onPreciseCad
      : guidance.action === 'verify' ? onVerify
        : guidance.action === 'release' ? onExportEvidencePackage
          : undefined;
  const affected = executionPlan?.affectedPartIds.length ?? 0;
  const detail = executionPlan && (executionPlan.reasonCodes.length || affected)
    ? `${affected ? `${d.affected(affected)} · ` : ''}${executionPlan.reasonCodes.slice(0, 2).join(', ') || d.reasons}`
    : '';
  const itemStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, height: 28,
    padding: '0 10px', border: 0, borderRight: '1px solid var(--nx-border)',
    background: 'transparent', color: 'var(--nx-text)', cursor: 'pointer', textAlign: 'left',
  };
  const stateStyle: CSSProperties = {
    color: 'var(--nx-text-2)', fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  };

  return (
    <nav
      aria-label={d.label}
      data-testid="cad-workflow-rail"
      data-compact={compact || undefined}
      style={{
        display: 'flex', alignItems: 'center', flex: '0 0 29px', minWidth: 0,
        borderBottom: '1px solid var(--nx-border)', background: 'var(--nx-panel-2)', overflowX: 'auto',
      }}
    >
      <button type="button" aria-current={guidance.step === 'ai' ? 'step' : undefined} style={itemStyle} onClick={onAiDesign} title={[aiState, detail].filter(Boolean).join(' — ')}>
        <strong style={{ fontSize: 11, whiteSpace: 'nowrap', color: !hasModel ? 'var(--nx-accent)' : 'var(--nx-ok)' }}>{aiLabel}</strong>
        <span style={stateStyle}>{aiState}</span>
        {detail && <span data-testid="cad-workflow-local-repair" style={{ ...stateStyle, color: 'var(--nx-warn)' }}>{detail}</span>}
      </button>
      <button type="button" aria-current={guidance.step === 'cad' ? 'step' : undefined} style={itemStyle} onClick={onPreciseCad} title={[d.cadState, detail].filter(Boolean).join(' — ')}>
        <strong style={{ fontSize: 11, whiteSpace: 'nowrap', color: precisionRequired ? 'var(--nx-warn)' : hasModel ? 'var(--nx-accent)' : 'var(--nx-text-2)' }}>{d.cad}</strong>
        <span style={stateStyle}>{precisionRequired ? aiState : d.cadState}</span>
      </button>
      <button type="button" aria-current={guidance.step === 'verify' ? 'step' : undefined} style={itemStyle} onClick={onVerify} disabled={!hasModel} title={verifyState}>
        <strong style={{ fontSize: 11, whiteSpace: 'nowrap', color: dfmWarningCount === 0 ? 'var(--nx-ok)' : dfmWarningCount && dfmWarningCount > 0 ? 'var(--nx-warn)' : 'var(--nx-text-2)' }}>{d.verify}</strong>
        <span style={stateStyle}>{verifyState}</span>
      </button>
      <button type="button" aria-current={guidance.step === 'release' ? 'step' : undefined} style={itemStyle} onClick={onExportEvidencePackage} disabled={!hasModel || executionPlan?.releaseReady !== true} title={executionPlan?.releaseReady ? d.verified : d.blocked}>
        <strong style={{ fontSize: 11, whiteSpace: 'nowrap', color: executionPlan?.releaseReady ? 'var(--nx-ok)' : 'var(--nx-warn)' }}>{d.release}</strong>
        <span data-testid="cad-workflow-release-status" style={stateStyle}>{executionPlan?.releaseReady ? d.verified : d.blocked}</span>
        <span style={{ fontSize: 10, whiteSpace: 'nowrap', color: 'var(--nx-accent)' }}>{d.package}</span>
      </button>
      <div
        data-testid="cad-workflow-guidance"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 8px', whiteSpace: 'nowrap' }}
      >
        <span role="status" aria-live="polite" aria-atomic="true" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <strong style={{ color: guidance.truth === 'BLOCKED' ? 'var(--nx-danger)' : guidance.truth === 'VERIFIED' ? 'var(--nx-ok)' : guidance.truth === 'WORKING' ? 'var(--nx-accent)' : 'var(--nx-warn)', fontSize: 10 }}>
            {d.now}: {guidance.truth}
          </strong>
          <span style={stateStyle}>{d.next}: {nextAction}</span>
        </span>
        <button
          type="button"
          data-testid="cad-workflow-next-action"
          disabled={!runNextAction}
          onClick={runNextAction}
          style={{ minHeight: 24, padding: '0 8px', border: '1px solid var(--nx-accent)', borderRadius: 5, background: 'var(--nx-panel)', color: 'var(--nx-accent)', fontSize: 10, fontWeight: 800, cursor: runNextAction ? 'pointer' : 'wait' }}
        >
          {nextAction}
        </button>
      </div>
      <span style={{ marginLeft: 'auto', padding: '0 10px', color: 'var(--nx-ok)', fontSize: 10, whiteSpace: 'nowrap' }}>
        {d.external}
      </span>
    </nav>
  );
}
