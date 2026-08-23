'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/hooks/useAuth';
import { ARCHITECTURE_INTERIOR_WORKSPACE_CHANGED_EVENT } from './ArchitectureInteriorPrecisionWorkflowPanel';

type Locale = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';
type SourceLength = 'mm' | 'cm' | 'm' | 'in' | 'ft';
type ConstructionAuthority = {
  wallThickness: number | null;
  slabThickness: number | null;
  ceilingThickness: number | null;
};
type DesignConstraints = {
  storeyCount?: number;
  storeyHeight?: number;
  maximumFootprintWidth?: number;
  maximumFootprintDepth?: number;
};

type Candidate = {
  architecture?: {
    storeys?: Array<{ id?: string; heightMm?: number }>;
    spaces?: Array<{ id?: string; usageKey?: string; boundaryMm?: Array<[number, number]> }>;
  };
  interior?: { furniture?: unknown[]; lights?: unknown[]; finishes?: unknown[] };
};

type DesignResponse = {
  ok?: boolean;
  candidate?: Candidate;
  code?: string;
  message?: string;
  statusKey?: string;
  persisted?: boolean;
  exact?: { status?: string };
  compliance?: { status?: string };
  release?: { status?: string };
  nextStep?: { statusKey?: string };
  approval?: { status: 'ready' | 'unavailable'; token?: string; proposalId?: string; proposalHash?: string; candidateHash?: string };
};
const EMPTY_SPACES: NonNullable<NonNullable<Candidate['architecture']>['spaces']> = [];

const COPY: Record<Locale, {
  title: string; brief: string; briefPlaceholder: string; generate: string; generating: string;
  review: string; missingProject: string; missingAuthority: string; missingBrief: string;
  candidate: string; plan: string; storeys: string; spaces: string; objects: string;
  notRun: string; notPersisted: string; approval: string; requestFailed: string; tooLong: string;
  wallThickness: string; slabThickness: string; ceilingThickness: string; sourceUnit: string;
  exact: string; compliance: string; release: string; approveSave: string; saving: string; saved: string; commitFailed: string;
}> = {
  ko: { title: 'AI 건축·인테리어 설계', brief: '설계 브리프', briefPlaceholder: '공간 용도, 동선, 채광, 재료 요구를 입력하세요.', generate: '개념안 생성', generating: '생성 중…', review: '검토 후 승인', missingProject: '프로젝트 ID가 없어 요청할 수 없습니다.', missingAuthority: '벽·슬래브·천장 두께의 승인 입력이 모두 필요합니다. 없는 값은 추정하지 않습니다.', missingBrief: '설계 브리프를 입력하세요.', candidate: '비저장 개념 후보', plan: '개념 평면 미리보기', storeys: '층', spaces: '공간', objects: '인테리어 객체', notRun: 'NOT_RUN', notPersisted: '저장되지 않음 · 자동 적용 안 함', approval: '검토·승인 후에만 정식 문서와 정밀 검증으로 이동합니다.', requestFailed: 'AI 설계 요청을 완료하지 못했습니다.', tooLong: '브리프는 12,000자 이내여야 합니다.', wallThickness: '벽 두께', slabThickness: '슬래브 두께', ceilingThickness: '천장 두께', sourceUnit: '입력 단위', exact: '정밀 형상', compliance: '규정 검증', release: '출시 승인', approveSave: '검토 후 승인하고 저장', saving: '승인·저장 중…', saved: '승인되어 개념 문서에 저장됨', commitFailed: '승인·저장을 완료하지 못했습니다.' },
  en: { title: 'AI architecture & interior design', brief: 'Design brief', briefPlaceholder: 'Describe use, circulation, daylight and material requirements.', generate: 'Generate concept', generating: 'Generating…', review: 'Review and approve', missingProject: 'A project ID is required before requesting a design.', missingAuthority: 'Approved wall, slab and ceiling thicknesses are all required. Missing values are never invented.', missingBrief: 'Enter a design brief.', candidate: 'Non-persisted concept candidate', plan: 'Concept plan preview', storeys: 'storeys', spaces: 'spaces', objects: 'interior objects', notRun: 'NOT_RUN', notPersisted: 'Not persisted · never auto-applied', approval: 'Only explicit review and approval can continue to exact geometry and governed verification.', requestFailed: 'The AI design request could not be completed.', tooLong: 'The brief must be 12,000 characters or fewer.', wallThickness: 'Wall thickness', slabThickness: 'Slab thickness', ceilingThickness: 'Ceiling thickness', sourceUnit: 'Source unit', exact: 'Exact geometry', compliance: 'Compliance', release: 'Release', approveSave: 'Review, approve & save', saving: 'Approving & saving…', saved: 'Approved and saved as concept workspace', commitFailed: 'The approval and save could not be completed.' },
  ja: { title: 'AI 建築・インテリア設計', brief: '設計ブリーフ', briefPlaceholder: '用途、動線、採光、材料の要件を入力してください。', generate: 'コンセプトを生成', generating: '生成中…', review: '確認して承認', missingProject: '設計依頼にはプロジェクト ID が必要です。', missingAuthority: '承認済みの壁・スラブ・天井厚がすべて必要です。不明な値は推測しません。', missingBrief: '設計ブリーフを入力してください。', candidate: '未保存のコンセプト候補', plan: 'コンセプト平面プレビュー', storeys: '階', spaces: '空間', objects: 'インテリアオブジェクト', notRun: 'NOT_RUN', notPersisted: '未保存・自動適用なし', approval: '確認と承認の後にのみ、正確な形状と検証へ進みます。', requestFailed: 'AI 設計依頼を完了できませんでした。', tooLong: 'ブリーフは12,000文字以内です。', wallThickness: '壁厚', slabThickness: 'スラブ厚', ceilingThickness: '天井厚', sourceUnit: '入力単位', exact: '正確な形状', compliance: '適合性', release: 'リリース', approveSave: '確認して承認・保存', saving: '承認・保存中…', saved: '承認済みのコンセプトとして保存しました', commitFailed: '承認・保存を完了できませんでした。' },
  zh: { title: 'AI 建筑与室内设计', brief: '设计简报', briefPlaceholder: '描述用途、动线、采光和材料要求。', generate: '生成概念方案', generating: '生成中…', review: '审阅并批准', missingProject: '请求设计前需要项目 ID。', missingAuthority: '需要已批准的墙、楼板和天花厚度。不会猜测缺失值。', missingBrief: '请输入设计简报。', candidate: '未保存概念候选', plan: '概念平面预览', storeys: '层', spaces: '空间', objects: '室内对象', notRun: 'NOT_RUN', notPersisted: '未保存 · 不会自动应用', approval: '只有明确审阅和批准后，才能继续精确几何与受控验证。', requestFailed: '无法完成 AI 设计请求。', tooLong: '简报不得超过12,000个字符。', wallThickness: '墙厚', slabThickness: '楼板厚度', ceilingThickness: '天花厚度', sourceUnit: '输入单位', exact: '精确几何', compliance: '合规性', release: '发布', approveSave: '审阅、批准并保存', saving: '批准并保存中…', saved: '已批准并保存为概念工作区', commitFailed: '无法完成批准和保存。' },
  es: { title: 'Diseño arquitectónico y de interiores IA', brief: 'Resumen de diseño', briefPlaceholder: 'Describe uso, circulación, luz natural y materiales.', generate: 'Generar concepto', generating: 'Generando…', review: 'Revisar y aprobar', missingProject: 'Se necesita un ID de proyecto para solicitar un diseño.', missingAuthority: 'Se requieren espesores aprobados de muro, losa y techo. Nunca se inventan valores faltantes.', missingBrief: 'Introduce un resumen de diseño.', candidate: 'Candidato conceptual no persistido', plan: 'Vista previa del plano conceptual', storeys: 'plantas', spaces: 'espacios', objects: 'objetos interiores', notRun: 'NOT_RUN', notPersisted: 'No persistido · no se aplica automáticamente', approval: 'Solo la revisión y aprobación explícitas permiten continuar a geometría exacta y verificación gobernada.', requestFailed: 'No se pudo completar la solicitud de diseño IA.', tooLong: 'El resumen debe tener 12.000 caracteres o menos.', wallThickness: 'Espesor de muro', slabThickness: 'Espesor de losa', ceilingThickness: 'Espesor de techo', sourceUnit: 'Unidad de origen', exact: 'Geometría exacta', compliance: 'Conformidad', release: 'Publicación', approveSave: 'Revisar, aprobar y guardar', saving: 'Aprobando y guardando…', saved: 'Aprobado y guardado como espacio conceptual', commitFailed: 'No se pudo completar la aprobación y el guardado.' },
  ar: { title: 'تصميم معماري وداخلي بالذكاء الاصطناعي', brief: 'موجز التصميم', briefPlaceholder: 'صف الاستخدام والحركة والإضاءة والمواد المطلوبة.', generate: 'إنشاء تصور', generating: 'جارٍ الإنشاء…', review: 'مراجعة واعتماد', missingProject: 'يلزم معرّف المشروع قبل طلب التصميم.', missingAuthority: 'يلزم اعتماد سماكات الجدار والبلاطة والسقف جميعاً. لا يتم تخمين القيم المفقودة.', missingBrief: 'أدخل موجز التصميم.', candidate: 'مرشح تصوري غير محفوظ', plan: 'معاينة المخطط التصوري', storeys: 'طوابق', spaces: 'مساحات', objects: 'عناصر داخلية', notRun: 'NOT_RUN', notPersisted: 'غير محفوظ · لا تطبيق تلقائي', approval: 'لا يمكن الانتقال إلى الهندسة الدقيقة والتحقق المنضبط إلا بعد المراجعة والاعتماد الصريحين.', requestFailed: 'تعذر إكمال طلب التصميم بالذكاء الاصطناعي.', tooLong: 'يجب ألا يتجاوز الموجز 12000 حرف.', wallThickness: 'سماكة الجدار', slabThickness: 'سماكة البلاطة', ceilingThickness: 'سماكة السقف', sourceUnit: 'وحدة المصدر', exact: 'هندسة دقيقة', compliance: 'الامتثال', release: 'الإصدار', approveSave: 'مراجعة واعتماد وحفظ', saving: 'جارٍ الاعتماد والحفظ…', saved: 'تم الاعتماد والحفظ كمساحة تصورية', commitFailed: 'تعذر إكمال الاعتماد والحفظ.' },
};

function normalizeLocale(lang: string): Locale {
  const value = lang.toLowerCase().split('-')[0];
  return value === 'ko' || value === 'ja' || value === 'zh' || value === 'es' || value === 'ar' ? value : 'en';
}

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export type ArchitectureInteriorAiDesignPanelProps = {
  lang: string;
  projectId?: string | null;
  sourceLength?: SourceLength;
  construction: ConstructionAuthority;
  constraints?: DesignConstraints;
  className?: string;
};

export function ArchitectureInteriorAiDesignPanel({ lang, projectId: explicitProjectId, sourceLength = 'mm', construction, constraints, className }: ArchitectureInteriorAiDesignPanelProps) {
  const t = COPY[normalizeLocale(lang)];
  const token = useAuthStore(state => state.token);
  const [brief, setBrief] = useState('');
  const [authority, setAuthority] = useState<Record<keyof ConstructionAuthority, string>>({
    wallThickness: construction.wallThickness == null ? '' : String(construction.wallThickness),
    slabThickness: construction.slabThickness == null ? '' : String(construction.slabThickness),
    ceilingThickness: construction.ceilingThickness == null ? '' : String(construction.ceilingThickness),
  });
  useEffect(() => {
    setAuthority({
      wallThickness: construction.wallThickness == null ? '' : String(construction.wallThickness),
      slabThickness: construction.slabThickness == null ? '' : String(construction.slabThickness),
      ceilingThickness: construction.ceilingThickness == null ? '' : String(construction.ceilingThickness),
    });
  }, [construction.ceilingThickness, construction.slabThickness, construction.wallThickness]);
  const [state, setState] = useState<'idle' | 'running' | 'candidate' | 'committing' | 'committed' | 'error'>('idle');
  const [response, setResponse] = useState<DesignResponse | null>(null);
  const [error, setError] = useState('');
  const proposalSequence = useRef(0);
  const projectId = explicitProjectId ?? (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('project') ?? new URLSearchParams(window.location.search).get('projectId'));
  const authorityValues = {
    wallThickness: Number(authority.wallThickness), slabThickness: Number(authority.slabThickness), ceilingThickness: Number(authority.ceilingThickness),
  };
  const authorityReady = finitePositive(authorityValues.wallThickness) && finitePositive(authorityValues.slabThickness) && finitePositive(authorityValues.ceilingThickness);
  const canSubmit = Boolean(projectId && authorityReady && brief.trim() && brief.length <= 12_000 && state !== 'running' && state !== 'committing');
  const spaces = response?.candidate?.architecture?.spaces ?? EMPTY_SPACES;
  const previewBounds = useMemo(() => {
    const points = spaces.flatMap(space => space.boundaryMm ?? []);
    if (!points.length) return { minX: 0, minY: 0, width: 100, height: 100 };
    const xs = points.map(point => point[0]); const ys = points.map(point => point[1]);
    return { minX: Math.min(...xs), minY: Math.min(...ys), width: Math.max(1, Math.max(...xs) - Math.min(...xs)), height: Math.max(1, Math.max(...ys) - Math.min(...ys)) };
  }, [spaces]);

  const submit = async () => {
    setError('');
    if (!projectId) { setError(t.missingProject); return; }
    if (!authorityReady) { setError(t.missingAuthority); return; }
    if (!brief.trim()) { setError(t.missingBrief); return; }
    if (brief.length > 12_000) { setError(t.tooLong); return; }
    proposalSequence.current += 1;
    const proposalId = `ai-design-${proposalSequence.current}`;
    setState('running'); setResponse(null);
    try {
      const requestBody = {
        designBrief: brief.trim(), proposalId, sourceLength,
        construction: authorityValues,
        ...(constraints ? { constraints } : {}), locale: normalizeLocale(lang),
      };
      const result = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/architecture-interior-ai-design`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(requestBody),
      });
      const raw = await result.text();
      if (raw.length > 2 * 1024 * 1024) throw new Error('response_too_large');
      const payload = JSON.parse(raw) as DesignResponse;
      if (!result.ok || !payload.ok || !payload.candidate) throw new Error(payload.message ?? payload.code ?? 'request_failed');
      setResponse(payload); setState('candidate');
    } catch {
      setState('error'); setError(t.requestFailed);
    }
  };

  const approveAndSave = async () => {
    const approval = response?.approval;
    if (!projectId || !response?.candidate || !approval || approval.status !== 'ready' || !approval.token || !approval.proposalHash || !approval.candidateHash) { setError(t.commitFailed); return; }
    setError(''); setState('committing');
    try {
      const result = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/architecture-interior-ai-design/commit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ proposalId: approval.proposalId, proposalHash: approval.proposalHash, candidateHash: approval.candidateHash, candidate: response.candidate, approvalToken: approval.token }),
      });
      const raw = await result.text();
      if (raw.length > 2 * 1024 * 1024) throw new Error('response_too_large');
      const payload = JSON.parse(raw) as DesignResponse;
      if (!result.ok || !payload.ok) throw new Error(payload.code ?? 'commit_failed');
      setResponse(current => ({ ...current, ...payload, persisted: true })); setState('committed');
      window.dispatchEvent(new CustomEvent(ARCHITECTURE_INTERIOR_WORKSPACE_CHANGED_EVENT, { detail: { projectId } }));
    } catch {
      setState('candidate'); setError(t.commitFailed);
    }
  };

  return <section className={className} data-testid="architecture-interior-ai-design-panel" dir={normalizeLocale(lang) === 'ar' ? 'rtl' : 'ltr'} style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--nx-border)', display: 'grid', gap: 8, fontSize: 10.5 }}>
    <b>{t.title}</b>
    <label htmlFor="architecture-interior-ai-brief">{t.brief}</label>
    <textarea id="architecture-interior-ai-brief" data-testid="architecture-interior-ai-brief" value={brief} maxLength={12_000} onChange={event => { setBrief(event.target.value); if (state !== 'idle') { setState('idle'); setResponse(null); setError(''); } }} placeholder={t.briefPlaceholder} rows={4} style={{ width: '100%', resize: 'vertical', minHeight: 72, padding: 8, border: '1px solid var(--nx-border)', borderRadius: 6, background: 'var(--nx-panel-2)', color: 'var(--nx-text)' }} />
    {!projectId && <span role="status" style={{ color: 'var(--nx-warn, #d97706)' }}>{t.missingProject}</span>}
    <div style={{ display: 'grid', gap: 5 }}>
      {([['wallThickness', t.wallThickness], ['slabThickness', t.slabThickness], ['ceilingThickness', t.ceilingThickness]] as const).map(([key, label]) => <label key={key} style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 6, alignItems: 'center' }}><span>{label}</span><input aria-label={label} type="number" min={0.001} step="any" value={authority[key]} onChange={event => setAuthority(current => ({ ...current, [key]: event.target.value }))} style={{ width: '100%', minHeight: 28, padding: '0 6px', border: '1px solid var(--nx-border)', borderRadius: 5, background: 'var(--nx-panel-2)', color: 'var(--nx-text)' }} /></label>)}
      <small>{t.sourceUnit}: {sourceLength}</small>
    </div>
    {!authorityReady && <span role="status" style={{ color: 'var(--nx-warn, #d97706)' }}>{t.missingAuthority}</span>}
    <button type="button" data-testid="architecture-interior-ai-submit" disabled={!canSubmit} onClick={() => void submit()} style={{ minHeight: 32, border: 0, borderRadius: 6, background: canSubmit ? 'var(--nx-accent)' : 'var(--nx-panel-2)', color: 'var(--nx-text)', fontWeight: 800 }}>{state === 'running' ? t.generating : t.generate}</button>
    {error && <span role="alert" style={{ color: 'var(--nx-danger, #dc2626)' }}>{error}</span>}
    {response?.candidate && <div data-testid="architecture-interior-ai-candidate" style={{ display: 'grid', gap: 7, padding: 8, border: '1px solid var(--nx-accent)', borderRadius: 6 }}>
      <b>{t.candidate}</b>
      <span>{spaces.length} {t.spaces} · {(response.candidate.architecture?.storeys ?? []).length} {t.storeys} · {(response.candidate.interior?.furniture?.length ?? 0) + (response.candidate.interior?.lights?.length ?? 0) + (response.candidate.interior?.finishes?.length ?? 0)} {t.objects}</span>
      <svg data-testid="architecture-interior-ai-plan-preview" role="img" aria-label={t.plan} viewBox={`${previewBounds.minX} ${previewBounds.minY} ${previewBounds.width} ${previewBounds.height}`} style={{ width: '100%', minHeight: 120, background: 'var(--nx-bg)', borderRadius: 4 }}>{spaces.map((space, index) => <polygon key={space.id ?? `space-${index}`} points={(space.boundaryMm ?? []).map(point => point.join(',')).join(' ')} fill="color-mix(in srgb, var(--nx-accent) 18%, transparent)" stroke="var(--nx-accent)" strokeWidth={Math.max(1, previewBounds.width / 300)} />)}</svg>
      <span>{state === 'committed' ? t.saved : t.notPersisted} · {t.review}</span>
      <span>{t.plan}: {t.notRun} · {t.exact}: {t.notRun} · {t.compliance}: {t.notRun} · {t.release}: {t.notRun}</span>
      <small>{t.approval}</small>
      {state !== 'committed' && <button type="button" data-testid="architecture-interior-ai-approve-save" disabled={state === 'committing' || response.approval?.status !== 'ready'} onClick={() => void approveAndSave()} style={{ minHeight: 32, border: 0, borderRadius: 6, background: response.approval?.status === 'ready' ? 'var(--nx-accent)' : 'var(--nx-panel-2)', color: 'var(--nx-text)', fontWeight: 800 }}>{state === 'committing' ? t.saving : t.approveSave}</button>}
    </div>}
  </section>;
}

export default ArchitectureInteriorAiDesignPanel;
