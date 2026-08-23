'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/hooks/useAuth';

type Locale = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';
type ArtifactKind = 'quantity' | 'drawing' | 'ifc';
type ActionState = 'idle' | 'loading' | 'challenging' | 'running' | 'saved' | 'error';
type WorkspaceState = { revision: number; contentHash: string; track: string; maturity: string; role: string };
type Payload = Record<string, unknown>;
export const ARCHITECTURE_INTERIOR_WORKSPACE_CHANGED_EVENT = 'nexyfab:architecture-interior-workspace-changed';

const COPY: Record<Locale, Record<string, string>> = {
  ko: { title: '정밀 CAD 워크플로', load: '현재 작업공간 불러오기', revision: '리비전', hash: '콘텐츠 해시', track: '트랙', maturity: '성숙도', readonly: '읽기 전용입니다. 편집자 승인이 필요합니다.', exact: '개념을 정밀 형상으로 승격', exactBusy: '정밀 형상 승격 중…', exactSaved: '정밀 형상 승격 완료', artifacts: '산출물 번들 생성', artifactsBusy: '산출물 생성 중…', artifactsSaved: '산출물 번들 저장 완료', quantity: '수량·일정', drawing: '도면 패킷', ifc: 'IFC 번들', select: '생성할 산출물', exactStatus: '정밀 형상', pricing: '가격', ifcStatus: 'IFC 왕복 검증', release: '출시', notRun: 'NOT_RUN', review: '각 작업은 명시적 승인 후 실행됩니다. 자동 실행하지 않습니다.', error: '워크플로 요청을 완료하지 못했습니다.', noProject: '프로젝트 ID가 없어 현재 작업공간을 불러올 수 없습니다.' },
  en: { title: 'Precision CAD workflow', load: 'Load current workspace', revision: 'Revision', hash: 'Content hash', track: 'Track', maturity: 'Maturity', readonly: 'Read-only. Editor approval is required.', exact: 'Promote concept to exact geometry', exactBusy: 'Promoting to exact geometry…', exactSaved: 'Exact geometry promotion complete', artifacts: 'Generate artifact bundle', artifactsBusy: 'Generating artifacts…', artifactsSaved: 'Artifact bundle saved', quantity: 'Quantities & schedule', drawing: 'Drawing packet', ifc: 'IFC bundle', select: 'Artifacts to generate', exactStatus: 'Exact geometry', pricing: 'Pricing', ifcStatus: 'IFC roundtrip', release: 'Release', notRun: 'NOT_RUN', review: 'Each action requires explicit approval. Nothing runs automatically.', error: 'The workflow request could not be completed.', noProject: 'A project ID is required to load the current workspace.' },
  ja: { title: '正確 CAD ワークフロー', load: '現在のワークスペースを読み込む', revision: 'リビジョン', hash: 'コンテンツハッシュ', track: 'トラック', maturity: '成熟度', readonly: '読み取り専用です。編集者の承認が必要です。', exact: 'コンセプトを正確な形状へ昇格', exactBusy: '正確な形状へ昇格中…', exactSaved: '正確な形状への昇格完了', artifacts: '成果物バンドルを生成', artifactsBusy: '成果物を生成中…', artifactsSaved: '成果物バンドルを保存しました', quantity: '数量・スケジュール', drawing: '図面パケット', ifc: 'IFC バンドル', select: '生成する成果物', exactStatus: '正確な形状', pricing: '価格', ifcStatus: 'IFC ラウンドトリップ', release: 'リリース', notRun: 'NOT_RUN', review: '各操作には明示的な承認が必要です。自動実行はありません。', error: 'ワークフロー依頼を完了できませんでした。', noProject: '現在のワークスペースを読み込むにはプロジェクト ID が必要です。' },
  zh: { title: '精密 CAD 工作流', load: '加载当前工作区', revision: '修订版', hash: '内容哈希', track: '轨道', maturity: '成熟度', readonly: '只读模式，需要编辑者批准。', exact: '将概念提升为精确几何', exactBusy: '正在提升为精确几何…', exactSaved: '精确几何提升完成', artifacts: '生成成果包', artifactsBusy: '正在生成成果…', artifactsSaved: '成果包已保存', quantity: '数量与计划', drawing: '图纸包', ifc: 'IFC 包', select: '要生成的成果', exactStatus: '精确几何', pricing: '定价', ifcStatus: 'IFC 往返', release: '发布', notRun: 'NOT_RUN', review: '每个操作都需要明确批准。不会自动执行。', error: '无法完成工作流请求。', noProject: '需要项目 ID 才能加载当前工作区。' },
  es: { title: 'Flujo CAD de precisión', load: 'Cargar espacio de trabajo actual', revision: 'Revisión', hash: 'Hash de contenido', track: 'Pista', maturity: 'Madurez', readonly: 'Solo lectura. Se requiere aprobación de editor.', exact: 'Promover concepto a geometría exacta', exactBusy: 'Promoviendo a geometría exacta…', exactSaved: 'Promoción a geometría exacta completada', artifacts: 'Generar paquete de entregables', artifactsBusy: 'Generando entregables…', artifactsSaved: 'Paquete de entregables guardado', quantity: 'Cantidades y programa', drawing: 'Paquete de planos', ifc: 'Paquete IFC', select: 'Entregables a generar', exactStatus: 'Geometría exacta', pricing: 'Precios', ifcStatus: 'Vuelta IFC', release: 'Publicación', notRun: 'NOT_RUN', review: 'Cada acción requiere aprobación explícita. Nada se ejecuta automáticamente.', error: 'No se pudo completar la solicitud del flujo.', noProject: 'Se necesita un ID de proyecto para cargar el espacio actual.' },
  ar: { title: 'سير عمل CAD الدقيق', load: 'تحميل مساحة العمل الحالية', revision: 'المراجعة', hash: 'تجزئة المحتوى', track: 'المسار', maturity: 'النضج', readonly: 'للقراءة فقط. يلزم اعتماد محرر.', exact: 'ترقية التصور إلى هندسة دقيقة', exactBusy: 'جارٍ الترقية إلى هندسة دقيقة…', exactSaved: 'اكتملت ترقية الهندسة الدقيقة', artifacts: 'إنشاء حزمة المخرجات', artifactsBusy: 'جارٍ إنشاء المخرجات…', artifactsSaved: 'تم حفظ حزمة المخرجات', quantity: 'الكميات والجدول', drawing: 'حزمة الرسومات', ifc: 'حزمة IFC', select: 'المخرجات المراد إنشاؤها', exactStatus: 'الهندسة الدقيقة', pricing: 'التسعير', ifcStatus: 'دورة IFC', release: 'الإصدار', notRun: 'NOT_RUN', review: 'كل إجراء يتطلب اعتماداً صريحاً. لا يتم التنفيذ تلقائياً.', error: 'تعذر إكمال طلب سير العمل.', noProject: 'يلزم معرّف المشروع لتحميل مساحة العمل الحالية.' },
};

const EXTRA_COPY: Record<Locale, Record<string, string>> = {
  ko: { concept: '\uac1c\ub150', exactMaturity: '\uc815\ubc00', aiDesign: 'AI \uc124\uacc4', precisionCad: '\uc815\ubc00 CAD', unknown: '\uc54c \uc218 \uc5c6\uc74c', passed: '\ud1b5\uacfc', failed: '\uc2e4\ud328', pending: '\ub300\uae30', notRunStatus: '\ubbf8\uc2e4\ud589' },
  en: { concept: 'Concept', exactMaturity: 'Exact', aiDesign: 'AI design', precisionCad: 'Precision CAD', unknown: 'Unknown', passed: 'Passed', failed: 'Failed', pending: 'Pending', notRunStatus: 'Not run' },
  ja: { concept: '\u30b3\u30f3\u30bb\u30d7\u30c8', exactMaturity: '\u6b63\u78ba', aiDesign: 'AI \u8a2d\u8a08', precisionCad: '\u6b63\u78ba CAD', unknown: '\u4e0d\u660e', passed: '\u5408\u683c', failed: '\u4e0d\u5408\u683c', pending: '\u5f85\u6a5f\u4e2d', notRunStatus: '\u672a\u5b9f\u884c' },
  zh: { concept: '\u6982\u5ff5', exactMaturity: '\u7cbe\u786e', aiDesign: 'AI \u8bbe\u8ba1', precisionCad: '\u7cbe\u5bc6 CAD', unknown: '\u672a\u77e5', passed: '\u5df2\u901a\u8fc7', failed: '\u672a\u901a\u8fc7', pending: '\u7b49\u5f85\u4e2d', notRunStatus: '\u672a\u8fd0\u884c' },
  es: { concept: 'Concepto', exactMaturity: 'Exacta', aiDesign: 'Dise\u00f1o IA', precisionCad: 'CAD de precisi\u00f3n', unknown: 'Desconocido', passed: 'Aprobado', failed: 'Fallido', pending: 'Pendiente', notRunStatus: 'No ejecutado' },
  ar: { concept: '\u062a\u0635\u0648\u0631\u064a', exactMaturity: '\u062f\u0642\u064a\u0642', aiDesign: '\u062a\u0635\u0645\u064a\u0645 \u0628\u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064a', precisionCad: 'CAD \u062f\u0642\u064a\u0642', unknown: '\u063a\u064a\u0631 \u0645\u0639\u0631\u0648\u0641', passed: '\u0645\u062c\u062a\u0627\u0632', failed: '\u0641\u0634\u0644', pending: '\u0642\u064a\u062f \u0627\u0644\u0627\u0646\u062a\u0638\u0627\u0631', notRunStatus: '\u0644\u0645 \u064a\u064f\u0634\u063a\u0651\u0644' },
};

function locale(lang: string): Locale { const value = lang.toLowerCase().split('-')[0]; return value === 'ko' || value === 'ja' || value === 'zh' || value === 'es' || value === 'ar' ? value : 'en'; }
function isRecord(value: unknown): value is Payload { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function status(value: unknown, fallback = 'not_run'): string { return isRecord(value) && typeof value.status === 'string' ? value.status : fallback; }
function statusLabel(value: string, copy: Record<string, string>): string {
  if (value === 'passed') return copy.passed;
  if (value === 'failed') return copy.failed;
  if (value === 'pending') return copy.pending;
  if (value === 'not_run') return copy.notRunStatus;
  return copy.unknown;
}

async function boundedJson(response: Response): Promise<Payload> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > 16 * 1024 * 1024) throw new Error('response_too_large');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('response_invalid'); }
  if (!isRecord(parsed)) throw new Error('response_invalid');
  return parsed;
}

export function ArchitectureInteriorPrecisionWorkflowPanel({ lang, projectId }: { lang: string; projectId?: string | null }) {
  const t = { ...COPY[locale(lang)], ...EXTRA_COPY[locale(lang)] };
  const token = useAuthStore(state => state.token);
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [bundleHash, setBundleHash] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<ActionState>('idle');
  const [exactState, setExactState] = useState<ActionState>('idle');
  const [artifactState, setArtifactState] = useState<ActionState>('idle');
  const [selected, setSelected] = useState<Record<ArtifactKind, boolean>>({ quantity: true, drawing: true, ifc: true });
  const [statuses, setStatuses] = useState({ exact: 'not_run', pricing: 'not_run', ifc: 'not_run', release: 'not_run' });
  const [error, setError] = useState('');
  const canEdit = workspace?.role === 'owner' || workspace?.role === 'editor';
  const kinds = useMemo(() => (['quantity', 'drawing', 'ifc'] as ArtifactKind[]).filter(kind => selected[kind]), [selected]);
  const headers = useMemo(() => ({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }), [token]);

  const load = useCallback(async () => {
    if (!projectId) { setError(t.noProject); return; }
    setLoadState('loading'); setError('');
    try {
      const [workspaceResponse, artifactResponse, exactResponse] = await Promise.all([
        fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/architecture-interior-agent`, { headers }),
        fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/architecture-interior-artifacts`, { headers }),
        fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/architecture-interior-exact`, { headers }),
      ]);
      const workspacePayload = await boundedJson(workspaceResponse);
      if (!workspaceResponse.ok || workspacePayload.ok !== true || !isRecord(workspacePayload.session)) throw new Error('workspace_load_failed');
      const session = workspacePayload.session;
      const envelope = isRecord(workspacePayload.workspace) && isRecord(workspacePayload.workspace.workspace) ? workspacePayload.workspace.workspace : null;
      setWorkspace({ revision: Number(session.revision), contentHash: String(session.contentHash), track: String(envelope?.track ?? 'unknown'), maturity: String(envelope?.maturity ?? 'unknown'), role: String(session.role ?? 'viewer') });
      if (artifactResponse.ok) { const artifactPayload = await boundedJson(artifactResponse); const bundle = isRecord(artifactPayload.bundle) ? artifactPayload.bundle : null; setBundleHash(bundle && typeof bundle.bundleHash === 'string' ? bundle.bundleHash : null); setStatuses(current => ({ ...current, pricing: status(artifactPayload.pricing), ifc: status(artifactPayload.ifcRoundtrip), release: status(artifactPayload.release) })); }
      if (exactResponse.ok) { const exactPayload = await boundedJson(exactResponse); setStatuses(current => ({ ...current, exact: status(exactPayload.exact, current.exact) })); }
      setLoadState('saved');
    } catch { setLoadState('error'); setError(t.error); }
  }, [headers, projectId, t.error, t.noProject]);
  useEffect(() => { if (projectId) void load(); }, [load, projectId]);
  useEffect(() => {
    if (!projectId) return;
    const onWorkspaceChanged = (event: Event) => {
      const changedProjectId = (event as CustomEvent<{ projectId?: string }>).detail?.projectId;
      if (changedProjectId === projectId) void load();
    };
    window.addEventListener(ARCHITECTURE_INTERIOR_WORKSPACE_CHANGED_EVENT, onWorkspaceChanged);
    return () => window.removeEventListener(ARCHITECTURE_INTERIOR_WORKSPACE_CHANGED_EVENT, onWorkspaceChanged);
  }, [load, projectId]);

  const promoteExact = async () => {
    if (!projectId || !workspace || !canEdit) return;
    setExactState('challenging'); setError('');
    const body = { expectedWorkspaceRevision: workspace.revision, expectedWorkspaceContentHash: workspace.contentHash };
    try {
      const challengeResponse = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/architecture-interior-exact`, { method: 'POST', headers, body: JSON.stringify(body) });
      const challenge = await boundedJson(challengeResponse);
      const approval = isRecord(challenge.approval) ? challenge.approval : null;
      if (challenge.code !== 'APPROVAL_REQUIRED' || !approval || typeof approval.token !== 'string') throw new Error('approval_failed');
      setExactState('running');
      const committedResponse = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/architecture-interior-exact`, { method: 'POST', headers, body: JSON.stringify({ ...body, approved: true, approvalToken: approval.token }) });
      const committed = await boundedJson(committedResponse);
      if (!committedResponse.ok || committed.ok !== true) throw new Error('exact_failed');
      setWorkspace(current => current ? { ...current, revision: Number(committed.revision), contentHash: String(committed.contentHash), track: 'precision_cad', maturity: 'exact' } : current);
      setStatuses(current => ({ ...current, exact: status(committed.exact, 'passed'), release: status(committed.release) })); setExactState('saved');
      window.dispatchEvent(new CustomEvent(ARCHITECTURE_INTERIOR_WORKSPACE_CHANGED_EVENT, { detail: { projectId } }));
    } catch { setExactState('error'); setError(t.error); void load(); }
  };

  const generateArtifacts = async () => {
    if (!projectId || !workspace || !canEdit || !kinds.length) return;
    setArtifactState('challenging'); setError('');
    const body = { expectedWorkspaceRevision: workspace.revision, expectedWorkspaceContentHash: workspace.contentHash, requestedKinds: kinds, expectedHeadBundleHash: bundleHash, approvalScope: 'architecture_interior_artifacts' as const };
    try {
      const challengeResponse = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/architecture-interior-artifacts`, { method: 'POST', headers, body: JSON.stringify(body) });
      const challenge = await boundedJson(challengeResponse);
      const approval = isRecord(challenge.approval) ? challenge.approval : null;
      if (challenge.code !== 'APPROVAL_REQUIRED' || !approval || typeof approval.token !== 'string') throw new Error('approval_failed');
      setArtifactState('running');
      const committedResponse = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/architecture-interior-artifacts`, { method: 'POST', headers, body: JSON.stringify({ ...body, approved: true, approvalToken: approval.token }) });
      const committed = await boundedJson(committedResponse);
      if (!committedResponse.ok || committed.ok !== true) throw new Error('artifacts_failed');
      const bundle = isRecord(committed.bundle) ? committed.bundle : null;
      setBundleHash(bundle && typeof bundle.bundleHash === 'string' ? bundle.bundleHash : bundleHash); setStatuses(current => ({ ...current, pricing: status(committed.pricing), ifc: status(committed.ifcRoundtrip), release: status(committed.release) })); setArtifactState('saved');
      window.dispatchEvent(new CustomEvent(ARCHITECTURE_INTERIOR_WORKSPACE_CHANGED_EVENT, { detail: { projectId } }));
    } catch { setArtifactState('error'); setError(t.error); }
  };

  return <section data-testid="architecture-interior-precision-workflow-panel" dir={locale(lang) === 'ar' ? 'rtl' : 'ltr'} style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--nx-border)', display: 'grid', gap: 8, fontSize: 10.5 }}>
    <b>{t.title}</b>
    {!projectId && <span role="status">{t.noProject}</span>}
    {projectId && <button type="button" data-testid="architecture-interior-precision-load" onClick={() => void load()} disabled={loadState === 'loading'}>{loadState === 'loading' ? '…' : t.load}</button>}
    {workspace && <div data-testid="architecture-interior-precision-workspace" style={{ display: 'grid', gap: 3 }}><span>{t.revision}: <b>{workspace.revision}</b></span><span>{t.hash}: <code>{workspace.contentHash}</code></span><span>{t.track}: <b>{t[workspace.track === 'ai_design' ? 'aiDesign' : workspace.track === 'precision_cad' ? 'precisionCad' : 'unknown']}</b> · {t.maturity}: <b>{t[workspace.maturity === 'concept' ? 'concept' : workspace.maturity === 'exact' ? 'exactMaturity' : 'unknown']}</b></span></div>}
    {workspace && !canEdit && <span role="status">{t.readonly}</span>}
    {workspace && <button type="button" data-testid="architecture-interior-precision-exact" disabled={!canEdit || workspace.maturity !== 'concept' || exactState === 'challenging' || exactState === 'running' || exactState === 'saved'} onClick={() => void promoteExact()}>{exactState === 'challenging' || exactState === 'running' ? t.exactBusy : workspace.maturity !== 'concept' || exactState === 'saved' ? t.exactSaved : t.exact}</button>}
    {workspace && <fieldset style={{ border: '1px solid var(--nx-border)', borderRadius: 6, padding: 7 }}><legend>{t.select}</legend>{([['quantity', t.quantity], ['drawing', t.drawing], ['ifc', t.ifc]] as const).map(([kind, label]) => <label key={kind} style={{ display: 'block', margin: '3px 0' }}><input data-testid={`architecture-interior-precision-kind-${kind}`} type="checkbox" checked={selected[kind]} onChange={event => setSelected(current => ({ ...current, [kind]: event.target.checked }))} /> {label}</label>)}<button type="button" data-testid="architecture-interior-precision-artifacts" disabled={!canEdit || !kinds.length || artifactState === 'challenging' || artifactState === 'running'} onClick={() => void generateArtifacts()}>{artifactState === 'challenging' || artifactState === 'running' ? t.artifactsBusy : artifactState === 'saved' ? t.artifactsSaved : t.artifacts}</button></fieldset>}
    <div data-testid="architecture-interior-precision-status" style={{ display: 'grid', gap: 3 }}><span>{t.exactStatus}: <b>{statusLabel(statuses.exact, t)}</b></span><span>{t.pricing}: <b>{statusLabel(statuses.pricing, t)}</b></span><span>{t.ifcStatus}: <b>{statusLabel(statuses.ifc, t)}</b></span><span>{t.release}: <b>{statusLabel(statuses.release, t)}</b></span></div>
    {error && <span role="alert">{error}</span>}
    <small>{t.review}</small>
  </section>;
}

export default ArchitectureInteriorPrecisionWorkflowPanel;
