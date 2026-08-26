'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createArchitectureInteriorSelection,
  type ArchitectureInteriorSelection,
  type ArchitectureInteriorSelectionKind,
  type ArchitectureInteriorSelectionSource,
  type ResolvedArchitectureInteriorSelection,
} from '@/lib/ai/architectureInteriorSelection';
import type { ArchitectureInteriorWorkspaceV2 } from '@/lib/ai/architectureInteriorWorkspace';
import { validateArchitectureInteriorWorkspaceClientEnvelope } from '@/lib/ai/architectureInteriorWorkspaceClientValidation';
import { ARCHITECTURE_INTERIOR_WORKSPACE_CHANGED_EVENT } from './ArchitectureInteriorPrecisionWorkflowPanel';
import { ArchitectureInteriorInspector } from './ArchitectureInteriorInspector';

type Copy = { title: string; load: string; select: string; loading: string; unavailable: string; error: string; viewer: string; apply: string; stale: string };
type HistoryCopy = { undo: string; redo: string; historyLoading: string; historyInvalid: string; unauthorized: string; conflict: string };
const COPY: Record<string, Copy> = {
  ko: { title: '실시간 건축·인테리어 검사기', load: '작업공간 새로고침', select: '검사할 객체', loading: '불러오는 중…', unavailable: '프로젝트 ID가 없어 읽기 전용입니다.', error: '서버 작업공간을 불러오지 못했습니다.', viewer: '뷰어 권한입니다. 편집은 비활성화됩니다.', apply: '적용', stale: '최신 작업공간을 다시 불러왔습니다. 객체를 다시 선택하세요.' },
  en: { title: 'Live architecture / interior Inspector', load: 'Reload workspace', select: 'Inspectable object', loading: 'Loading…', unavailable: 'No project ID; read-only.', error: 'The server workspace could not be loaded.', viewer: 'Viewer role. Editing is disabled.', apply: 'Apply', stale: 'The workspace changed. Select the object again.' },
  ja: { title: 'ライブ建築・インテリア検査', load: 'ワークスペースを再読込', select: '検査対象', loading: '読み込み中…', unavailable: 'プロジェクト ID がないため読み取り専用です。', error: 'サーバーのワークスペースを読み込めません。', viewer: 'ビューア権限のため編集できません。', apply: '適用', stale: 'ワークスペースが変更されました。対象を再選択してください。' },
  zh: { title: '实时建筑 / 室内检查器', load: '重新加载工作区', select: '检查对象', loading: '加载中…', unavailable: '没有项目 ID，仅可读。', error: '无法加载服务器工作区。', viewer: '查看者权限，编辑已禁用。', apply: '应用', stale: '工作区已变化，请重新选择对象。' },
  es: { title: 'Inspector vivo de arquitectura / interiores', load: 'Recargar espacio', select: 'Objeto inspeccionable', loading: 'Cargando…', unavailable: 'Falta el ID del proyecto; solo lectura.', error: 'No se pudo cargar el espacio del servidor.', viewer: 'Rol de visor. Edición desactivada.', apply: 'Aplicar', stale: 'El espacio cambió. Seleccione el objeto otra vez.' },
  ar: { title: 'فاحص معماري / داخلي مباشر', load: 'إعادة تحميل مساحة العمل', select: 'العنصر القابل للفحص', loading: 'جارٍ التحميل…', unavailable: 'لا يوجد معرّف مشروع؛ للقراءة فقط.', error: 'تعذر تحميل مساحة العمل من الخادم.', viewer: 'صلاحية عرض؛ تم تعطيل التحرير.', apply: 'تطبيق', stale: 'تغيرت مساحة العمل. اختر العنصر مرة أخرى.' },
};

const HISTORY_COPY: Record<string, HistoryCopy> = {
  ko: { undo: '실행 취소', redo: '다시 실행', historyLoading: '기록을 불러오는 중...', historyInvalid: '서버 기록 응답이 올바르지 않습니다.', unauthorized: '이 기록 작업을 수행할 권한이 없습니다.', conflict: '작업공간이 변경되었습니다. 새로고침 후 다시 시도하세요.' },
  en: { undo: 'Undo', redo: 'Redo', historyLoading: 'Loading history...', historyInvalid: 'The server history response was invalid.', unauthorized: 'You are not authorized for this history action.', conflict: 'The workspace changed. Reload and try again.' },
  ja: { undo: '元に戻す', redo: 'やり直す', historyLoading: '履歴を読み込み中...', historyInvalid: 'サーバーの履歴応答が不正です。', unauthorized: 'この履歴操作の権限がありません。', conflict: 'ワークスペースが変更されました。再読み込みして再試行してください。' },
  zh: { undo: '撤销', redo: '重做', historyLoading: '正在加载历史记录...', historyInvalid: '服务器历史记录响应无效。', unauthorized: '您无权执行此历史操作。', conflict: '工作区已更改。请重新加载后重试。' },
  es: { undo: 'Deshacer', redo: 'Rehacer', historyLoading: 'Cargando historial...', historyInvalid: 'La respuesta del historial no es válida.', unauthorized: 'No tiene autorización para esta acción.', conflict: 'El espacio cambió. Recárguelo e inténtelo de nuevo.' },
  ar: { undo: 'تراجع', redo: 'إعادة', historyLoading: 'جارٍ تحميل السجل...', historyInvalid: 'استجابة سجل الخادم غير صالحة.', unauthorized: 'ليست لديك صلاحية لتنفيذ عملية السجل هذه.', conflict: 'تغيّرت مساحة العمل. أعد التحميل وحاول مرة أخرى.' },
};

type HistoryAction = 'undo' | 'redo';
type HistoryPointer = { sequence: number; commandId: string };
type HistoryState = {
  schema: 'nexyfab.architecture-interior-history.v1'; projectId: string; revision: number; contentHash: string;
  canUndo: boolean; canRedo: boolean; undo: HistoryPointer | null; redo: HistoryPointer | null;
};
const HISTORY_SCHEMA = 'nexyfab.architecture-interior-history.v1';
const APPROVAL_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

const APPLY_TOOLS: Record<string, string> = { wall: 'edit_wall', opening: 'edit_opening', furniture: 'edit_furniture', finish: 'edit_finish', millwork: 'edit_millwork', light: 'edit_light' };

function text(lang: string): Copy & HistoryCopy {
  const key = lang === 'kr' ? 'ko' : lang;
  return { ...(COPY[key] ?? COPY.en!), ...(HISTORY_COPY[key] ?? HISTORY_COPY.en!) };
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function validHash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function validHistoryPointer(value: unknown): value is HistoryPointer {
  return isRecord(value) && Number.isSafeInteger(value.sequence) && Number(value.sequence) > 0
    && typeof value.commandId === 'string' && value.commandId.trim().length > 0;
}
function isHistoryState(value: unknown, projectId: string, workspace: ArchitectureInteriorWorkspaceV2): value is HistoryState {
  if (!isRecord(value) || value.ok !== true || value.schema !== HISTORY_SCHEMA || value.projectId !== projectId
    || value.revision !== workspace.workspace.revision || value.contentHash !== workspace.contentHash
    || !Number.isSafeInteger(value.revision) || !validHash(value.contentHash)
    || typeof value.canUndo !== 'boolean' || typeof value.canRedo !== 'boolean') return false;
  const undo = value.undo === null ? null : validHistoryPointer(value.undo) ? value.undo : undefined;
  const redo = value.redo === null ? null : validHistoryPointer(value.redo) ? value.redo : undefined;
  return undo !== undefined && redo !== undefined && value.canUndo === Boolean(undo) && value.canRedo === Boolean(redo);
}
function responseCode(value: unknown): string | null { return isRecord(value) && typeof value.code === 'string' ? value.code : null; }
function historyMessage(t: Copy & HistoryCopy, response: Response, body: unknown): string {
  const code = responseCode(body);
  if (response.status === 401 || response.status === 403 || code === 'AUTHENTICATION_REQUIRED' || code === 'EDITOR_REQUIRED') return t.unauthorized;
  if (response.status === 409 || code === 'REVISION_CONFLICT' || code === 'HISTORY_DIVERGED' || code === 'APPROVAL_INVALID') return t.conflict;
  return t.historyInvalid;
}
async function readJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}
function isClientWorkspace(value: unknown, projectId: string): value is ArchitectureInteriorWorkspaceV2 {
  if (!isRecord(value) || value.schema !== 'nexyfab.architecture-interior-workspace.v2' || value.projectId !== projectId || !isRecord(value.workspace) || value.workspace.projectId !== projectId || !Number.isSafeInteger(value.workspace.revision) || typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentHash)) return false;
  if (!isRecord(value.architecture) || !isRecord(value.interior) || typeof value.architecture.documentId !== 'string' || typeof value.interior.documentId !== 'string' || !isRecord(value.architecture.document) || !isRecord(value.interior.document)) return false;
  const architecture = value.architecture.document, interior = value.interior.document;
  if (!(architecture.schema === 'nexyfab.architecture.v1' && interior.schema === 'nexyfab.interior.v1'
    && Number.isSafeInteger(architecture.revision) && architecture.revision === interior.revision && architecture.revision === value.workspace.revision
    && [architecture.storeys, architecture.spaces, architecture.walls, architecture.slabs, architecture.openings, architecture.ceilings, interior.furniture, interior.finishes, interior.lights].every(Array.isArray))) return false;
  try { return validateArchitectureInteriorWorkspaceClientEnvelope(value).length === 0; } catch { return false; }
}
function sourceFor(workspace: ArchitectureInteriorWorkspaceV2): ArchitectureInteriorSelectionSource {
  return { projectId: workspace.projectId, architectureDocumentId: workspace.architecture.documentId, interiorDocumentId: workspace.interior.documentId, architecture: workspace.architecture.document, interior: workspace.interior.document };
}
function selectionList(source: ArchitectureInteriorSelectionSource): ArchitectureInteriorSelection[] {
  const values: ArchitectureInteriorSelection[] = [];
  const collections: ReadonlyArray<{ document: 'architecture' | 'interior'; kind: ArchitectureInteriorSelectionKind; objects: ReadonlyArray<{ id: string }> }> = [
    { document: 'architecture', kind: 'storey', objects: source.architecture.storeys },
    { document: 'architecture', kind: 'space', objects: source.architecture.spaces },
    { document: 'architecture', kind: 'wall', objects: source.architecture.walls },
    { document: 'architecture', kind: 'opening', objects: source.architecture.openings },
    { document: 'architecture', kind: 'ceiling', objects: source.architecture.ceilings },
    { document: 'interior', kind: 'furniture', objects: source.interior.furniture },
    { document: 'interior', kind: 'finish', objects: source.interior.finishes },
    { document: 'interior', kind: 'millwork', objects: source.interior.millwork ?? [] },
    { document: 'interior', kind: 'light', objects: source.interior.lights },
    { document: 'interior', kind: 'ceiling', objects: source.interior.ceilingSystems ?? [] },
  ];
  for (const collection of collections) for (const object of collection.objects) {
    const resolved = createArchitectureInteriorSelection(source, collection.kind, object.id, collection.document);
    if (resolved.ok) values.push(resolved.value.selection);
  }
  return values;
}

function toolPatch(resolved: ResolvedArchitectureInteriorSelection, patch: Readonly<Record<string, unknown>>): { tool: string; patch: Record<string, unknown> } | null {
  const tool = resolved.selection.kind === 'ceiling'
    ? resolved.selection.document === 'architecture' ? 'edit_ceiling' : 'edit_ceiling_system'
    : APPLY_TOOLS[resolved.selection.kind];
  if (!tool) return null;
  let mapped = { ...patch };
  if (resolved.selection.kind === 'wall' && isRecord(resolved.object)) {
    const geometryKeys = ['startMm', 'endMm', 'centerMm', 'radiusMm', 'startAngleDeg', 'endAngleDeg'];
    if (Object.keys(mapped).some(key => geometryKeys.includes(key))) {
      mapped = resolved.object.kind === 'line'
        ? { kind: 'line', startMm: resolved.object.startMm, endMm: resolved.object.endMm, ...mapped }
        : { kind: 'arc', centerMm: resolved.object.centerMm, radiusMm: resolved.object.radiusMm, startAngleDeg: resolved.object.startAngleDeg, endAngleDeg: resolved.object.endAngleDeg, ...mapped };
    }
  }
  if (resolved.selection.kind === 'finish') { if ('surface' in mapped) { mapped.surfaceCode = mapped.surface; delete mapped.surface; } if ('material' in mapped) { mapped.materialCode = mapped.material; delete mapped.material; } }
  if (resolved.selection.kind === 'millwork' && 'material' in mapped) { mapped.materialCode = mapped.material; delete mapped.material; }
  return { tool, patch: mapped };
}

export function ArchitectureInteriorLiveInspector({ lang, projectId }: { lang: string; projectId?: string | null }) {
  const t = useMemo(() => text(lang), [lang]);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const [workspace, setWorkspace] = useState<ArchitectureInteriorWorkspaceV2 | null>(null);
  const [history, setHistory] = useState<HistoryState | null>(null);
  const [selectionKey, setSelectionKey] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'saved'>('idle');
  const [message, setMessage] = useState('');
  const [role, setRole] = useState<'owner' | 'editor' | 'viewer'>('viewer');
  const source = useMemo(() => workspace ? sourceFor(workspace) : null, [workspace]);
  const selections = useMemo(() => source ? selectionList(source) : [], [source]);
  const selected = useMemo(() => selections.find(item => item.selectionKey === selectionKey) ?? null, [selectionKey, selections]);

  const readHistory = useCallback(async (candidate: ArchitectureInteriorWorkspaceV2): Promise<HistoryState | null> => {
    if (!projectId) return null;
    const response = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/architecture-interior-history`, { credentials: 'same-origin', cache: 'no-store' });
    const body = await readJson(response);
    if (!response.ok) throw new Error(historyMessage(t, response, body));
    if (!isHistoryState(body, projectId, candidate)) throw new Error(t.historyInvalid);
    return body;
  }, [projectId, t]);

  const load = useCallback(async () => {
    if (!projectId) { setWorkspace(null); setHistory(null); setSelectionKey(null); setMessage(t.unavailable); return; }
    setStatus('loading');
    setHistory(null);
    try {
      const response = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/architecture-interior-agent`, { credentials: 'same-origin', cache: 'no-store' });
      const body = await readJson(response);
      const candidate = isRecord(body) ? body.workspace : null;
      if (!response.ok || !isClientWorkspace(candidate, projectId)) throw new Error('workspace_invalid');
      setWorkspace(candidate);
      setRole(isRecord(body) && isRecord(body.session) && (body.session.role === 'owner' || body.session.role === 'editor') ? body.session.role : 'viewer');
      setSelectionKey(null);
      try {
        const authoritativeHistory = await readHistory(candidate);
        setHistory(authoritativeHistory);
        setStatus('idle');
        setMessage('');
      } catch (historyError) {
        setStatus('error');
        setMessage(historyError instanceof Error ? historyError.message : t.historyInvalid);
      }
    } catch { setWorkspace(null); setHistory(null); setSelectionKey(null); setStatus('error'); setMessage(t.error); }
  }, [projectId, readHistory, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onChanged = (event: Event) => { const detail = (event as CustomEvent<{ projectId?: string; source?: string }>).detail; if (detail?.source === 'inspector' || detail?.source === 'history') return; const changed = detail?.projectId; if (!changed || changed === projectId) { setMessage(t.stale); void load(); } };
    window.addEventListener(ARCHITECTURE_INTERIOR_WORKSPACE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(ARCHITECTURE_INTERIOR_WORKSPACE_CHANGED_EVENT, onChanged);
  }, [load, projectId, t.stale]);

  const applyHistoryAction = useCallback(async (action: HistoryAction) => {
    if (!projectId || !workspace || !history || (action === 'undo' ? !history.canUndo : !history.canRedo)) return false;
    const endpoint = `/api/nexyfab/projects/${encodeURIComponent(projectId)}/architecture-interior-history`;
    const expectedRevision = workspace.workspace.revision;
    const expectedContentHash = workspace.contentHash;
    const base = { action, expectedRevision, expectedContentHash };
    setStatus('loading');
    setMessage('');
    try {
      const challengeResponse = await fetch(endpoint, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(base),
      });
      const challenge = await readJson(challengeResponse);
      if (challengeResponse.ok) throw new Error(t.historyInvalid);
      const receiptHash = isRecord(challenge) && isRecord(challenge.approval) && typeof challenge.approval.receiptHash === 'string' && APPROVAL_TOKEN.test(challenge.approval.receiptHash)
        ? challenge.approval.receiptHash : null;
      if (responseCode(challenge) !== 'APPROVAL_REQUIRED' || !receiptHash) {
        throw new Error(historyMessage(t, challengeResponse, challenge));
      }
      const approvedResponse = await fetch(endpoint, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, approved: true, receiptHash }),
      });
      const approved = await readJson(approvedResponse);
      const nextWorkspace = isRecord(approved) ? approved.workspace : null;
      if (!approvedResponse.ok || responseCode(approved) || !isClientWorkspace(nextWorkspace, projectId)
        || nextWorkspace.workspace.revision !== expectedRevision + 1 || nextWorkspace.contentHash === expectedContentHash) {
        throw new Error(historyMessage(t, approvedResponse, approved));
      }
      const nextHistory = await readHistory(nextWorkspace);
      if (!nextHistory) throw new Error(t.historyInvalid);
      setWorkspace(nextWorkspace);
      setHistory(nextHistory);
      setSelectionKey(null);
      setStatus('saved');
      setMessage('');
      window.dispatchEvent(new CustomEvent(ARCHITECTURE_INTERIOR_WORKSPACE_CHANGED_EVENT, { detail: { projectId, source: 'inspector' } }));
      return true;
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error && error.message ? error.message : t.historyInvalid);
      return false;
    }
  }, [history, projectId, readHistory, t, workspace]);

  const commit = useCallback(async (resolved: ResolvedArchitectureInteriorSelection, patch: Readonly<Record<string, unknown>>) => {
    if (!projectId || !workspace || role === 'viewer') return false;
    const mapped = toolPatch(resolved, patch);
    if (!mapped || resolved.selection.revision !== workspace.workspace.revision) { setMessage(t.stale); setSelectionKey(null); return false; }
    const args = { revision: resolved.selection.revision, documentId: resolved.selection.document === 'architecture' ? workspace.architecture.documentId : workspace.interior.documentId, objectId: resolved.selection.objectId, parameterPaths: Object.keys(mapped.patch), patch: mapped.patch };
    const init = { method: 'POST', credentials: 'same-origin' as const, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: mapped.tool, requestedScope: 'apply', requestedProfile: 'architecture-interior', requestedDomain: 'architecture-interior', arguments: args, locale: lang }) };
    setStatus('loading');
    try {
      const challengeResponse = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/architecture-interior-agent`, init);
      const challenge: unknown = await challengeResponse.json();
      const approval = isRecord(challenge) && isRecord(challenge.approval) && typeof challenge.approval.receiptHash === 'string' ? challenge.approval.receiptHash : null;
      if (challengeResponse.status !== 409 || !approval) throw new Error('approval_required');
      const approvedResponse = await fetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/architecture-interior-agent`, { ...init, body: JSON.stringify({ tool: mapped.tool, requestedScope: 'apply', requestedProfile: 'architecture-interior', requestedDomain: 'architecture-interior', arguments: args, approval: { approved: true, receiptHash: approval }, locale: lang }) });
      const approvedBody: unknown = await approvedResponse.json();
      const approvedWorkspace = isRecord(approvedBody) ? approvedBody.workspace : null;
      const expectedRevision = workspace.workspace.revision + 1;
      const artifacts = isRecord(approvedWorkspace) && isRecord(approvedWorkspace.artifactGraph) ? approvedWorkspace.artifactGraph.artifacts : null;
      if (!approvedResponse.ok || !isClientWorkspace(approvedWorkspace, projectId)
        || approvedWorkspace.workspace.revision !== expectedRevision
        || approvedWorkspace.contentHash === workspace.contentHash
        || !isRecord(approvedWorkspace.artifactGraph)
        || approvedWorkspace.artifactGraph.revision !== expectedRevision
        || !Array.isArray(artifacts) || !artifacts.every(artifact => isRecord(artifact) && artifact.state === 'stale')) throw new Error('apply_response_invalid');
      const authoritativeHistory = await readHistory(approvedWorkspace);
      setWorkspace(approvedWorkspace);
      setHistory(authoritativeHistory);
      setStatus('saved');
      setSelectionKey(null);
      window.dispatchEvent(new CustomEvent(ARCHITECTURE_INTERIOR_WORKSPACE_CHANGED_EVENT, { detail: { projectId, source: 'inspector' } }));
      return true;
    } catch { setStatus('error'); setMessage(t.error); return false; }
  }, [lang, projectId, readHistory, role, t.error, t.stale, workspace]);

  return <section data-testid="architecture-interior-live-inspector" dir={dir} aria-live="polite" style={{ display: 'grid', gap: 7, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--nx-border)', fontSize: 10.5 }}>
    <b>{t.title}</b>
    {!projectId ? <span role="status">{t.unavailable}</span> : <button type="button" data-testid="architecture-interior-live-reload" onClick={() => void load()} disabled={status === 'loading'}>{status === 'loading' ? t.loading : t.load}</button>}
    {message && <span role={status === 'error' ? 'alert' : 'status'}>{message}</span>}
    {workspace && <>
      <div role="group" aria-label={`${t.title} · ${t.undo} / ${t.redo}`} style={{ display: 'flex', gap: 5 }}>
        <button type="button" data-testid="architecture-interior-history-undo" onClick={() => void applyHistoryAction('undo')} disabled={role === 'viewer' || !history?.canUndo || status === 'loading'}>{t.undo}</button>
        <button type="button" data-testid="architecture-interior-history-redo" onClick={() => void applyHistoryAction('redo')} disabled={role === 'viewer' || !history?.canRedo || status === 'loading'}>{t.redo}</button>
        {!history && status === 'loading' && <span role="status">{t.historyLoading}</span>}
      </div>
      <label>{t.select}<select data-testid="architecture-interior-live-selection" value={selectionKey ?? ''} onChange={event => setSelectionKey(event.target.value || null)}><option value="">—</option>{selections.map(item => <option key={item.selectionKey} value={item.selectionKey}>{item.document} / {item.kind} / {item.objectId}</option>)}</select></label>
      {role === 'viewer' && <span role="status">{t.viewer}</span>}
      <ArchitectureInteriorInspector selection={selected} source={source} lang={lang} pending={status === 'loading'} explicitApply onCommit={role === 'viewer' ? undefined : commit} onInvalidSelection={() => { setSelectionKey(null); setMessage(t.stale); }} />
    </>}
  </section>;
}

export default ArchitectureInteriorLiveInspector;
