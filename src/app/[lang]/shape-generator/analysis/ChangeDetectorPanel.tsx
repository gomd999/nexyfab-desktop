'use client';

/**
 * ChangeDetectorPanel — Phase 9-1 (customer-side).
 *
 * Lets the user enter two design revisions (spec fields, not raw CAD files)
 * and shows which specs changed, cost/lead impact, whether re-RFQ is needed,
 * and recommended next actions.
 *
 * Mounted as an overlay panel alongside the shape-generator analysis tabs.
 */

import { useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { detectChanges, type DesignSpec, type ChangeDetectorResult, type SpecDiff } from './changeDetector';

// ─── i18n ────────────────────────────────────────────────────────────────────

const dict = {
  ko: {
    title: '설계 변경 감지기',
    subtitle: '두 리비전의 사양을 비교하고 RFQ 재발송 필요 여부를 판단합니다.',
    prevRev: '이전 리비전',
    newRev: '새 리비전',
    revNamePlaceholder: '리비전 이름 (Rev A)',
    materialPlaceholder: '재질',
    processPlaceholder: '공정',
    quantityPlaceholder: '수량',
    tolerancePlaceholder: '공차',
    finishPlaceholder: '표면처리',
    costImpact: '비용 영향',
    leadImpact: '납기 영향',
    reRfq: 'RFQ 재발송',
    required: '필요',
    notNeeded: '불필요',
    changedSpecs: '변경된 사양',
    fieldCol: '항목',
    beforeCol: '이전',
    afterCol: '이후',
    impactCol: '영향도',
    noChanges: '사양 변경 없음',
    recommendedActions: '권장 조치',
    analysing: '분석 중...',
    detectChanges: '🔍 변경 감지 실행',
    reIssueRfq: '📋 RFQ 재발송',
    compareAgain: '🔄 다시 비교',
    close: '닫기',
    proRequired: 'Pro 플랜이 필요합니다.',
    genericError: '오류',
    diffAdded: '추가',
    diffModified: '변경',
    diffRemoved: '삭제',
  },
  en: {
    title: 'Design Change Detector',
    subtitle: 'Compare two spec revisions and flag RFQ re-issue impact.',
    prevRev: 'Previous Rev',
    newRev: 'New Rev',
    revNamePlaceholder: 'Revision name (Rev A)',
    materialPlaceholder: 'Material',
    processPlaceholder: 'Process',
    quantityPlaceholder: 'Quantity',
    tolerancePlaceholder: 'Tolerance',
    finishPlaceholder: 'Surface finish',
    costImpact: 'Cost Impact',
    leadImpact: 'Lead Impact',
    reRfq: 'Re-RFQ',
    required: 'Required',
    notNeeded: 'Not needed',
    changedSpecs: 'Changed Specs',
    fieldCol: 'Field',
    beforeCol: 'Before',
    afterCol: 'After',
    impactCol: 'Impact',
    noChanges: 'No spec changes detected',
    recommendedActions: 'Recommended Actions',
    analysing: 'Analysing...',
    detectChanges: '🔍 Detect Changes',
    reIssueRfq: '📋 Re-Issue RFQ',
    compareAgain: '🔄 Compare Again',
    close: 'Close',
    proRequired: 'Upgrade to Pro.',
    genericError: 'Error',
    diffAdded: 'Added',
    diffModified: 'Modified',
    diffRemoved: 'Removed',
  },
  ja: {
    title: '設計変更検出',
    subtitle: '2つのリビジョンの仕様を比較しRFQ再発行の要否を判定します。',
    prevRev: '以前のリビジョン',
    newRev: '新しいリビジョン',
    revNamePlaceholder: 'リビジョン名 (Rev A)',
    materialPlaceholder: '材質',
    processPlaceholder: '工程',
    quantityPlaceholder: '数量',
    tolerancePlaceholder: '公差',
    finishPlaceholder: '表面処理',
    costImpact: 'コスト影響',
    leadImpact: '納期影響',
    reRfq: 'RFQ再発行',
    required: '必要',
    notNeeded: '不要',
    changedSpecs: '変更された仕様',
    fieldCol: '項目',
    beforeCol: '変更前',
    afterCol: '変更後',
    impactCol: '影響度',
    noChanges: '仕様変更なし',
    recommendedActions: '推奨アクション',
    analysing: '分析中...',
    detectChanges: '🔍 変更検出を実行',
    reIssueRfq: '📋 RFQ再発行',
    compareAgain: '🔄 再比較',
    close: '閉じる',
    proRequired: 'Proプランが必要です。',
    genericError: 'エラー',
    diffAdded: '追加',
    diffModified: '変更',
    diffRemoved: '削除',
  },
  zh: {
    title: '设计变更检测器',
    subtitle: '比较两个修订版本的规格并判断是否需要重发 RFQ。',
    prevRev: '上一版本',
    newRev: '新版本',
    revNamePlaceholder: '版本名称 (Rev A)',
    materialPlaceholder: '材料',
    processPlaceholder: '工艺',
    quantityPlaceholder: '数量',
    tolerancePlaceholder: '公差',
    finishPlaceholder: '表面处理',
    costImpact: '成本影响',
    leadImpact: '交期影响',
    reRfq: '重发 RFQ',
    required: '需要',
    notNeeded: '不需要',
    changedSpecs: '变更的规格',
    fieldCol: '字段',
    beforeCol: '之前',
    afterCol: '之后',
    impactCol: '影响',
    noChanges: '未检测到规格变更',
    recommendedActions: '建议操作',
    analysing: '分析中...',
    detectChanges: '🔍 运行变更检测',
    reIssueRfq: '📋 重发 RFQ',
    compareAgain: '🔄 再次比较',
    close: '关闭',
    proRequired: '需要升级到 Pro。',
    genericError: '错误',
    diffAdded: '新增',
    diffModified: '修改',
    diffRemoved: '删除',
  },
  es: {
    title: 'Detector de Cambios de Diseño',
    subtitle: 'Compara dos revisiones de especificaciones y detecta si se requiere reemitir la RFQ.',
    prevRev: 'Revisión Anterior',
    newRev: 'Nueva Revisión',
    revNamePlaceholder: 'Nombre de revisión (Rev A)',
    materialPlaceholder: 'Material',
    processPlaceholder: 'Proceso',
    quantityPlaceholder: 'Cantidad',
    tolerancePlaceholder: 'Tolerancia',
    finishPlaceholder: 'Acabado superficial',
    costImpact: 'Impacto en Costo',
    leadImpact: 'Impacto en Plazo',
    reRfq: 'Re-RFQ',
    required: 'Requerido',
    notNeeded: 'No necesario',
    changedSpecs: 'Especificaciones Cambiadas',
    fieldCol: 'Campo',
    beforeCol: 'Antes',
    afterCol: 'Después',
    impactCol: 'Impacto',
    noChanges: 'No se detectaron cambios',
    recommendedActions: 'Acciones Recomendadas',
    analysing: 'Analizando...',
    detectChanges: '🔍 Detectar Cambios',
    reIssueRfq: '📋 Reemitir RFQ',
    compareAgain: '🔄 Comparar de Nuevo',
    close: 'Cerrar',
    proRequired: 'Actualice a Pro.',
    genericError: 'Error',
    diffAdded: 'Añadido',
    diffModified: 'Modificado',
    diffRemoved: 'Eliminado',
  },
  ar: {
    title: 'كاشف تغيير التصميم',
    subtitle: 'قارن مراجعتَي المواصفات وحدد ما إذا كانت إعادة إصدار RFQ مطلوبة.',
    prevRev: 'المراجعة السابقة',
    newRev: 'المراجعة الجديدة',
    revNamePlaceholder: 'اسم المراجعة (Rev A)',
    materialPlaceholder: 'المادة',
    processPlaceholder: 'العملية',
    quantityPlaceholder: 'الكمية',
    tolerancePlaceholder: 'التفاوت',
    finishPlaceholder: 'تشطيب السطح',
    costImpact: 'تأثير التكلفة',
    leadImpact: 'تأثير المهلة',
    reRfq: 'إعادة RFQ',
    required: 'مطلوب',
    notNeeded: 'غير مطلوب',
    changedSpecs: 'المواصفات المتغيرة',
    fieldCol: 'الحقل',
    beforeCol: 'قبل',
    afterCol: 'بعد',
    impactCol: 'التأثير',
    noChanges: 'لم يتم اكتشاف تغييرات',
    recommendedActions: 'الإجراءات الموصى بها',
    analysing: '...جاري التحليل',
    detectChanges: '🔍 تشغيل كشف التغييرات',
    reIssueRfq: '📋 إعادة إصدار RFQ',
    compareAgain: '🔄 قارن مرة أخرى',
    close: 'إغلاق',
    proRequired: 'يتطلب خطة Pro.',
    genericError: 'خطأ',
    diffAdded: 'مضاف',
    diffModified: 'معدل',
    diffRemoved: 'محذوف',
  },
};

type Lang = keyof typeof dict;
const langMap: Record<string, Lang> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

const C = {
  bg: '#0d1117', surface: '#161b22', card: '#21262d', border: '#30363d',
  text: '#e6edf3', textDim: '#8b949e', textMuted: '#6e7681',
  accent: '#388bfd', green: '#3fb950', yellow: '#d29922', red: '#f85149', purple: '#8b5cf6',
};

const IMPACT_COLOR = { high: C.red, medium: C.yellow, low: C.green };

interface Props {
  /** Pre-fill from shape-generator context. */
  currentSpec?: DesignSpec;
  onClose: () => void;
  lang?: string;
  projectId?: string;
}

const EMPTY: DesignSpec = { label: '', material: '', process: '', quantity: undefined, tolerance: '', surfaceFinish: '' };

function SpecInput({ spec, onChange, label, tt }: { spec: DesignSpec; onChange: (s: DesignSpec) => void; label: string; tt: typeof dict[Lang] }) {
  const field = (key: keyof DesignSpec, type: string, placeholder: string) => (
    <input
      type={type}
      value={type === 'number' ? (spec[key] as number | undefined) ?? '' : (spec[key] as string | undefined) ?? ''}
      onChange={e => onChange({ ...spec, [key]: type === 'number' ? (e.target.value ? Number(e.target.value) : undefined) : e.target.value })}
      placeholder={placeholder}
      style={{
        width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 11, boxSizing: 'border-box',
        background: C.card, color: C.text, border: `1px solid ${C.border}`, outline: 'none',
      }}
    />
  );
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: C.textDim }}>{label}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {field('label',        'text',   tt.revNamePlaceholder)}
        {field('material',     'text',   tt.materialPlaceholder)}
        {field('process',      'text',   tt.processPlaceholder)}
        {field('quantity',     'number', tt.quantityPlaceholder)}
        {field('tolerance',    'text',   tt.tolerancePlaceholder)}
        {field('surfaceFinish','text',   tt.finishPlaceholder)}
      </div>
    </div>
  );
}

function DiffRow({ diff, isKo }: { diff: SpecDiff; isKo: boolean }) {
  const color = IMPACT_COLOR[diff.impact];
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '90px 1fr 1fr 52px', gap: 6, alignItems: 'center',
      padding: '7px 10px', background: C.card, borderRadius: 7,
      border: `1px solid ${diff.impact === 'high' ? C.red + '44' : C.border}`,
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.textDim }}>{isKo ? diff.fieldKo : (diff as any).field ?? diff.fieldKo}</span>
      <span style={{ fontSize: 11, color: C.textMuted, textDecoration: 'line-through' }}>{diff.prev}</span>
      <span style={{ fontSize: 11, color: C.text }}>{diff.next}</span>
      <span style={{
        fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 8, textAlign: 'center',
        background: `${color}20`, color,
      }}>
        {isKo ? diff.impactKo : (diff as any).impact}
      </span>
    </div>
  );
}

function ImpactBadge({ label, value, valueKo, valueEn, icon, isKo }: { label: string; value: string; valueKo: string; valueEn?: string; icon: string; isKo: boolean }) {
  const color = value === 'increase' ? C.red : value === 'decrease' ? C.green : value === 'neutral' ? C.textMuted : C.yellow;
  return (
    <div style={{ flex: 1, background: C.card, borderRadius: 8, padding: '8px 10px', textAlign: 'center', border: `1px solid ${C.border}` }}>
      <p style={{ margin: '0 0 2px', fontSize: 10, color: C.textMuted }}>{icon} {label}</p>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color }}>{isKo ? valueKo : (valueEn ?? valueKo)}</p>
    </div>
  );
}

export default function ChangeDetectorPanel({ currentSpec, onClose, lang = 'ko', projectId }: Props) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const resolvedLang: Lang = langMap[seg] ?? langMap[lang] ?? 'en';
  const t = dict[resolvedLang];
  const isKo = resolvedLang === 'ko';
  const router = useRouter();
  const [prev, setPrev] = useState<DesignSpec>({ ...EMPTY, label: 'Rev A', ...currentSpec });
  const [next, setNext] = useState<DesignSpec>({ ...EMPTY, label: 'Rev B' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChangeDetectorResult | null>(null);

  const handleReRfq = useCallback(() => {
    const params = new URLSearchParams({ open: '1' });
    if (next.material) params.set('material', next.material);
    if (next.quantity)  params.set('qty', String(next.quantity));
    if (next.label)     params.set('shapeName', next.label);
    onClose();
    router.push(`/${lang}/nexyfab/rfq?${params.toString()}`);
  }, [next, lang, router, onClose]);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const r = await detectChanges({ prev, next, lang, projectId });
      setResult(r);
    } catch (e) {
      const err = e as Error & { requiresPro?: boolean };
      setError(err.requiresPro ? t.proRequired : (err.message || t.genericError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`,
          width: '100%', maxWidth: 680, maxHeight: '92vh', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'linear-gradient(135deg, #1e2430, #1a1f2e)',
        }}>
          <span style={{ fontSize: 18 }}>🔍</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: C.text }}>
              {t.title}
            </p>
            <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>
              {t.subtitle}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Spec inputs */}
          {!result && (
            <div style={{ display: 'flex', gap: 12 }}>
              <SpecInput spec={prev} onChange={setPrev} label={t.prevRev} tt={t} />
              <div style={{ display: 'flex', alignItems: 'center', paddingTop: 28, color: C.textMuted, fontSize: 18 }}>→</div>
              <SpecInput spec={next} onChange={setNext} label={t.newRev} tt={t} />
            </div>
          )}

          {error && (
            <div style={{ background: `${C.red}12`, border: `1px solid ${C.red}30`, borderRadius: 8, padding: '10px 14px', fontSize: 12, color: C.red }}>
              {error}
            </div>
          )}

          {result && (
            <>
              {/* Impact summary */}
              <div style={{ display: 'flex', gap: 8 }}>
                <ImpactBadge label={t.costImpact} value={result.costImpact} valueKo={result.costImpactKo} valueEn={result.costImpact} icon="💰" isKo={isKo} />
                <ImpactBadge label={t.leadImpact} value={result.leadImpact} valueKo={result.leadImpactKo} valueEn={result.leadImpact} icon="⏱" isKo={isKo} />
                <div style={{ flex: 1, background: result.reRfqRequired ? `${C.red}12` : `${C.green}12`, borderRadius: 8, padding: '8px 10px', textAlign: 'center', border: `1px solid ${result.reRfqRequired ? C.red + '44' : C.green + '44'}` }}>
                  <p style={{ margin: '0 0 2px', fontSize: 10, color: C.textMuted }}>📋 {t.reRfq}</p>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: result.reRfqRequired ? C.red : C.green }}>
                    {result.reRfqRequired ? t.required : t.notNeeded}
                  </p>
                </div>
              </div>

              {/* Re-RFQ reason */}
              <div style={{ background: C.card, borderRadius: 8, padding: '10px 14px', fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>
                {isKo ? result.reRfqReasonKo : result.reRfqReason}
              </div>

              {/* Diffs */}
              {result.diffs.length > 0 ? (
                <div>
                  <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>
                    {t.changedSpecs}
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr 52px', gap: 4, padding: '0 10px 6px', fontSize: 9, color: C.textMuted }}>
                    <span>{t.fieldCol}</span>
                    <span>{t.beforeCol}</span>
                    <span>{t.afterCol}</span>
                    <span>{t.impactCol}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {result.diffs.map((d, i) => <DiffRow key={i} diff={d} isKo={isKo} />)}
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '16px 0', color: C.green, fontSize: 13, fontWeight: 700 }}>
                  ✓ {t.noChanges}
                </div>
              )}

              {/* Actions */}
              {result.actionsKo.length > 0 && (
                <div>
                  <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>
                    {t.recommendedActions}
                  </p>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {(isKo ? result.actionsKo : result.actions).map((a, i) => (
                      <li key={i} style={{
                        display: 'flex', gap: 8, alignItems: 'flex-start',
                        background: C.card, borderRadius: 7, padding: '7px 10px',
                        fontSize: 12, color: C.textDim,
                      }}>
                        <span style={{ color: C.accent, marginTop: 1 }}>→</span>
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 18px', display: 'flex', gap: 8 }}>
          {!result ? (
            <button
              onClick={run}
              disabled={loading}
              style={{
                flex: 1, padding: 10, borderRadius: 8, border: 'none',
                background: loading ? '#388bfd66' : 'linear-gradient(135deg, #8b5cf6, #388bfd)',
                color: '#fff', fontSize: 13, fontWeight: 800, cursor: loading ? 'default' : 'pointer',
              }}
            >
              {loading ? t.analysing : t.detectChanges}
            </button>
          ) : (
            <>
              {result.reRfqRequired && (
                <button
                  onClick={handleReRfq}
                  style={{
                    flex: 1, padding: 10, borderRadius: 8, border: 'none',
                    background: `linear-gradient(135deg, ${C.red}, #f97316)`,
                    color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer',
                  }}
                >
                  {t.reIssueRfq}
                </button>
              )}
              <button
                onClick={() => setResult(null)}
                style={{
                  flex: 1, padding: 10, borderRadius: 8,
                  border: `1px solid ${C.border}`, background: 'transparent',
                  color: C.textDim, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {t.compareAgain}
              </button>
            </>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '10px 18px', borderRadius: 8,
              border: `1px solid ${C.border}`, background: 'transparent',
              color: C.textMuted, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}
