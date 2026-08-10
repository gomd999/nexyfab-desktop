'use client';

import { useEffect, useMemo } from 'react';
import { DESIGN_DOMAIN_IDS, type DesignDomainId } from '@/lib/ai/domainProfile';
import { getDomainProfile } from '@/lib/ai/domainProfileRegistry';
import type { DesignWorkMode } from '@/lib/ai/designWorkspaceRevision';
import { useDomainWorkspaceSelection } from './domainWorkspaceStore';
import { generationDomainFor } from '@/lib/ai/domainGenerationRequest';
import { designDomainFromSlug, getDomainUserJourney } from '@/lib/ai/domainUserJourney';
import { releaseAllManualEditProtections, useManualEditProtectionLocks } from '../ai/manualEditProtectionStore';

const WORK_MODES: readonly DesignWorkMode[] = ['ai_assisted', 'manual', 'precision_cad'];
const LABELS = {
  ko: {
    domain: '설계 분야', level: '도구 수준', guided: '일반', expert: '전문가', workflow: '작업 방식',
    ai_assisted: 'AI 설계', manual: '수동 편집', precision_cad: '정밀 CAD', tools: '현재 도구',
    open: '간편 설계로 돌아가기', sameRevision: '같은 설계 이력', protected: '사용자 값 보호', release: '잠금 해제', current: '현재 단계', outputs: '주요 산출물',
    releaseConfirm: '사용자가 입력한 값의 AI 변경 방지를 모두 해제할까요?',
    domains: { mechanical: '기계·제품', building: '건축', civil: '토목', landscape: '조경', interior: '인테리어' },
  },
  en: {
    domain: 'Design domain', level: 'Tool level', guided: 'Guided', expert: 'Expert', workflow: 'Work mode',
    ai_assisted: 'AI design', manual: 'Manual edit', precision_cad: 'Precision CAD', tools: 'Current tools',
    open: 'Back to guided design', sameRevision: 'Same design revision', protected: 'user values protected', release: 'Release locks', current: 'Current stage', outputs: 'Key outputs',
    releaseConfirm: 'Release every AI-change protection on user-entered values?',
    domains: { mechanical: 'Mechanical', building: 'Building', civil: 'Civil', landscape: 'Landscape', interior: 'Interior' },
  },
  ja: {
    domain: '設計分野', level: 'ツールレベル', guided: 'ガイド', expert: '専門家', workflow: '作業モード',
    ai_assisted: 'AI設計', manual: '手動編集', precision_cad: '精密CAD', tools: '現在のツール',
    open: 'ガイド設計に戻る', sameRevision: '同じ設計リビジョン', protected: 'ユーザー値を保護', release: 'ロック解除', current: '現在の段階', outputs: '主要成果物',
    releaseConfirm: 'ユーザー入力値に対するAI変更防止をすべて解除しますか？',
    domains: { mechanical: '機械・製品', building: '建築', civil: '土木', landscape: 'ランドスケープ', interior: 'インテリア' },
  },
  zh: {
    domain: '设计领域', level: '工具级别', guided: '引导模式', expert: '专家模式', workflow: '工作模式',
    ai_assisted: 'AI设计', manual: '手动编辑', precision_cad: '精密CAD', tools: '当前工具',
    open: '返回引导设计', sameRevision: '同一设计版本', protected: '用户数值已保护', release: '解除锁定', current: '当前阶段', outputs: '主要交付物',
    releaseConfirm: '是否解除用户输入值的全部AI修改保护？',
    domains: { mechanical: '机械与产品', building: '建筑', civil: '土木', landscape: '景观', interior: '室内' },
  },
  es: {
    domain: 'Disciplina', level: 'Nivel de herramientas', guided: 'Guiado', expert: 'Experto', workflow: 'Modo de trabajo',
    ai_assisted: 'Diseño con IA', manual: 'Edición manual', precision_cad: 'CAD de precisión', tools: 'Herramientas actuales',
    open: 'Volver al diseño guiado', sameRevision: 'Misma revisión de diseño', protected: 'valores protegidos', release: 'Desbloquear', current: 'Etapa actual', outputs: 'Entregables clave',
    releaseConfirm: '¿Desea quitar toda la protección contra cambios de IA en los valores introducidos?',
    domains: { mechanical: 'Mecánica y producto', building: 'Arquitectura', civil: 'Ingeniería civil', landscape: 'Paisajismo', interior: 'Interiorismo' },
  },
  ar: {
    domain: 'مجال التصميم', level: 'مستوى الأدوات', guided: 'موجّه', expert: 'خبير', workflow: 'نمط العمل',
    ai_assisted: 'تصميم بالذكاء الاصطناعي', manual: 'تحرير يدوي', precision_cad: 'CAD دقيق', tools: 'الأدوات الحالية',
    open: 'العودة إلى التصميم الموجّه', sameRevision: 'نفس مراجعة التصميم', protected: 'قيم المستخدم محمية', release: 'إلغاء القفل', current: 'المرحلة الحالية', outputs: 'المخرجات الرئيسية',
    releaseConfirm: 'هل تريد إلغاء جميع وسائل حماية قيم المستخدم من تغييرات الذكاء الاصطناعي؟',
    domains: { mechanical: 'الميكانيكا والمنتجات', building: 'العمارة', civil: 'الهندسة المدنية', landscape: 'تصميم المناظر الطبيعية', interior: 'التصميم الداخلي' },
  },
} as const;

type WorkspaceLocale = keyof typeof LABELS;

function workspaceLocale(lang: string): WorkspaceLocale {
  if (lang === 'ko' || lang === 'kr') return 'ko';
  if (lang === 'ja' || lang === 'zh' || lang === 'cn' || lang === 'es' || lang === 'ar') return lang === 'cn' ? 'zh' : lang;
  return 'en';
}

const GUIDED_TOOL_LABELS_KO: Record<string, string> = {
  dimension: '치수', 'move-part': '부품 이동', 'replace-component': '부품 교체', 'lock-parameter': '값 잠금',
  'move-wall': '벽 이동', 'resize-space': '공간 크기', 'set-level': '층 설정', 'add-opening': '개구부 추가',
  'edit-alignment': '선형 수정', 'edit-profile': '종단 수정', 'set-design-elevation': '계획고 설정', 'resolve-drainage-low-point': '배수 저점 해결',
  'paint-planting-zone': '식재 구역', 'set-spacing': '식재 간격', 'edit-grade': '구배 수정', 'split-irrigation-zone': '관수 구역 분할',
  'move-furniture': '가구 이동', 'change-finish': '마감 변경', 'set-ceiling-height': '천장고 설정', 'check-door-clearance': '문 여유 확인',
};

function readableTool(tool: string, lang: string, guided: boolean): string {
  if (guided && (lang === 'ko' || lang === 'kr')) return GUIDED_TOOL_LABELS_KO[tool] ?? tool.replaceAll('-', ' ');
  return tool.replaceAll('-', ' ');
}

export function DomainWorkspaceBar({ lang, readOnly = false }: { lang: string; readOnly?: boolean }) {
  const copy = LABELS[workspaceLocale(lang)];
  const [selection, setSelection] = useDomainWorkspaceSelection();
  const protectedEdits = useManualEditProtectionLocks();
  const profile = useMemo(() => getDomainProfile(selection.domain), [selection.domain]);
  const journey = useMemo(() => getDomainUserJourney(selection.domain, lang), [lang, selection.domain]);
  const tools = profile.manualTools[selection.experience].map(tool => readableTool(tool, lang, selection.experience === 'guided'));
  const stageIndex = selection.workMode === 'ai_assisted' ? 1 : selection.workMode === 'manual' ? 2 : 3;

  // Deep links from guided design must restore the same discipline and working
  // level. Session state remains the fallback for ordinary in-app navigation.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hasContext = query.has('domain') || query.has('experience') || query.has('workMode') || query.get('mode') === 'expert';
    if (!hasContext) return;
    const requestedDomain = query.get('domain');
    const experience = query.get('experience') === 'expert' || query.get('mode') === 'expert' ? 'expert' : query.get('experience') === 'guided' ? 'guided' : undefined;
    const requestedMode = query.get('workMode');
    const workMode: DesignWorkMode | undefined = requestedMode === 'ai_assisted' || requestedMode === 'manual' || requestedMode === 'precision_cad'
      ? requestedMode
      : query.get('mode') === 'expert' ? 'precision_cad' : undefined;
    setSelection(current => ({
      ...current,
      domain: requestedDomain ? designDomainFromSlug(requestedDomain) : current.domain,
      experience: experience ?? current.experience,
      workMode: workMode ?? current.workMode,
    }));
  }, [setSelection]);
  const buttonStyle = (active: boolean) => ({
    height: 22, padding: '0 8px', border: 0, borderRight: '1px solid var(--nx-border)',
    background: active ? 'var(--nx-accent)' : 'var(--nx-panel-2)',
    color: active ? '#071a17' : 'var(--nx-text-2)', fontSize: 10, fontWeight: 700,
    cursor: readOnly ? 'not-allowed' : 'pointer',
  } as const);
  return (
    <section data-testid="domain-workspace-bar" aria-label={copy.domain} style={{ minHeight: 32, display: 'flex', alignItems: 'center', gap: 10, padding: '4px 10px', borderBottom: '1px solid var(--nx-border)', background: 'var(--nx-panel)', color: 'var(--nx-text)', fontSize: 11, overflowX: 'auto' }}>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
        <span style={{ color: 'var(--nx-text-2)', fontWeight: 650 }}>{copy.domain}</span>
        <select aria-label={copy.domain} value={selection.domain} disabled={readOnly} onChange={event => setSelection(current => ({ ...current, domain: event.target.value as DesignDomainId }))} style={{ height: 24, borderRadius: 5, border: '1px solid var(--nx-border)', background: 'var(--nx-panel-2)', color: 'var(--nx-text)', fontSize: 11 }}>
          {DESIGN_DOMAIN_IDS.map(domain => <option key={domain} value={domain}>{copy.domains[domain]}</option>)}
        </select>
      </label>
      <div role="group" aria-label={copy.level} style={{ display: 'inline-flex', border: '1px solid var(--nx-border)', borderRadius: 5, overflow: 'hidden', flexShrink: 0 }}>
        {(['guided', 'expert'] as const).map(level => <button key={level} type="button" disabled={readOnly} aria-pressed={selection.experience === level} onClick={() => setSelection(current => ({ ...current, experience: level }))} style={buttonStyle(selection.experience === level)}>{copy[level]}</button>)}
      </div>
      <div role="group" aria-label={copy.workflow} style={{ display: 'inline-flex', border: '1px solid var(--nx-border)', borderRadius: 5, overflow: 'hidden', flexShrink: 0 }}>
        {WORK_MODES.map(workMode => <button key={workMode} type="button" disabled={readOnly} aria-pressed={selection.workMode === workMode} onClick={() => setSelection(current => ({ ...current, workMode }))} style={buttonStyle(selection.workMode === workMode)}>{copy[workMode]}</button>)}
      </div>
      <span data-testid="same-design-revision" style={{ color: 'var(--nx-accent)', whiteSpace: 'nowrap', fontWeight: 700 }}>↻ {copy.sameRevision}</span>
      <span data-testid="domain-current-stage" title={journey.focus} style={{ padding: '2px 7px', borderRadius: 10, background: 'color-mix(in srgb, var(--nx-accent) 14%, transparent)', color: 'var(--nx-accent)', whiteSpace: 'nowrap', fontWeight: 750 }}>
        {copy.current}: {journey.stages[stageIndex].label}
      </span>
      <span style={{ color: 'var(--nx-text-3)', whiteSpace: 'nowrap' }}>{copy.tools}</span>
      <div aria-live="polite" style={{ display: 'flex', gap: 4, whiteSpace: 'nowrap' }}>
        {tools.map(tool => <span key={tool} style={{ padding: '2px 6px', borderRadius: 10, border: '1px solid var(--nx-border)', background: 'var(--nx-panel-2)', color: 'var(--nx-text-2)' }}>{tool}</span>)}
      </div>
      <a data-testid="guided-domain-return" href={`/${lang}/nexyfab/design/?domain=${generationDomainFor(selection.domain)}&handoff=1`} style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid var(--nx-accent)', color: 'var(--nx-accent)', textDecoration: 'none', fontWeight: 750, whiteSpace: 'nowrap' }}>
        {copy.open} →
      </a>
      {protectedEdits.length > 0 && (
        <span data-testid="manual-edit-lock-count" style={{ color: 'var(--nx-warn)', whiteSpace: 'nowrap', fontWeight: 700 }}>
          🔒 {protectedEdits.length} {copy.protected}
          {!readOnly && <button type="button" onClick={() => { if (window.confirm(copy.releaseConfirm)) releaseAllManualEditProtections(); }} style={{ marginLeft: 4, border: 0, background: 'transparent', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', fontSize: 10 }}>{copy.release}</button>}
        </span>
      )}
      <span title={selection.experience === 'expert' ? profile.documentSchemas.join(' · ') : journey.focus} style={{ marginLeft: 'auto', color: 'var(--nx-text-3)', whiteSpace: 'nowrap' }}>
        {copy.outputs}: {journey.deliverables.join(' · ')}
      </span>
    </section>
  );
}
