'use client';

// Design-brief entry — Wave A · WA-D3 (3면 표면의 웹 면).
//
// A form/simple-chat door to the AI design driver: one brief → POST
// /api/nexyfab/design-brief → a VERIFIED package summary (parts · measured
// dims · gate report · BOM) OR an explicit refusal (stage · reason · failed
// gate ids — no fabricated values). Below the entry it mounts the WA-C
// AiReviewQueuePanel wired to the PDM session store, so AI runs recorded as
// ai/<runId> branch commits are reviewed here.
//
// This component owns NO planner choice and NO gate logic — the server's shared
// runner does, and the same brief yields the same payload as the MCP tool/API.

import { useRef, useState } from 'react';
import { useLang } from '../hooks/useLang';
import { loc } from '../lib/loc';
import { AiReviewQueuePanel } from '../_shell/AiReviewQueuePanel';
import { usePdmSessionStore } from '../pdm/sessionRepoStore';
import { useAutonomySessionStore } from '../_shell/autonomySessionStore';
import type { ReviewComment } from '../pdm/reviewQueue';
import type { EditableWorkspaceCandidate } from '@/lib/ai/design-driver/workspaceCandidate';
import { downloadBlob } from '@/lib/platform';
import type { WorkspaceRevisionVerification } from './workspaceRevisionVerification';

interface MeasuredDim { id: string; kind: string; value: number; unit: string; expected?: number; deviation?: number }
interface PartPkg {
  partId: string;
  volumeMm3: number;
  dxf: string;
  dimensions: MeasuredDim[];
  exactCad?: {
    exactVolumeMm3: number;
    bodies: Array<{
      bodyId: string;
      source?: 'direct-extrude' | 'direct-revolve' | 'hole-step' | 'curved-step';
      volumeMm3?: number;
      faceCount?: number;
      edgeCount?: number;
      degeneratedEdgeCount?: number;
      boundaryEdgeCount?: number;
      nonManifoldEdgeCount?: number;
      analyticCylinder?: boolean;
      roundTripVolumeRelError: number;
      roundTripDegeneratedEdgeCount?: number;
      roundTripBoundaryEdgeCount?: number;
      roundTripNonManifoldEdgeCount?: number;
      step: string;
    }>;
  };
  exactDrawing?: {
    views: Array<{
      bodyId: string;
      view: 'front' | 'top' | 'right';
      method: 'replicad-hlr' | 'analytic-sphere-fallback';
      visiblePathCount: number;
      hiddenPathCount: number;
      analyticCurveEvidence: boolean;
      sourceStepSha256: string;
      svgSha256: string;
      svg: string;
      curveRecordSha256?: string;
      curveCount?: number;
      curveTypes?: number[];
      exactDxfSha256?: string;
      exactDxf?: string;
    }>;
  };
  manufacturingDrawing?: {
    releaseEligible: false;
    releaseBlockers: string[];
    plannedDimensionCount: number;
    includedDimensionCount: number;
    sheets: Array<{
      bodyId: string;
      role: 'geometry-and-dimensions' | 'dimension-continuation';
      sheetNumber: number;
      sheetCount: number;
      exactViewCount: number;
      dimensionCount: number;
      releaseStatus: 'engineering-review-required';
      svgSha256: string;
      svg: string;
    }>;
  };
}
interface GateLike { id: string; kind: string; pass: boolean; reason?: string; metrics: Record<string, number> }
interface ExecutionDisclosure {
  mode: 'reference-fixture' | 'ai-generated';
  assuranceLevel: 'deterministic-reference' | 'engineering-screening';
  manufacturingReleaseReady: false;
  workspaceApplied: false;
  humanReviewRequired: true;
  exactCadRequiredForRelease: true;
  releaseBlockers: string[];
}
interface Payload {
  ok: boolean;
  planId?: string;
  package?: {
    planId: string;
    parts: PartPkg[];
    bom?: Array<{ itemNo: number; name: string; qty: number; material: string }>;
    assembly?: { converged: boolean; iterations: number; finalMaxResidual: number };
    report: { allPassed: boolean; gates: GateLike[]; approximations: string[]; limitations: string[] };
  };
  refusal?: { stage: string; reason: string; failedGateIds: string[] };
  gates?: GateLike[];
  error?: string;
  code?: string;
  execution?: ExecutionDisclosure;
  workspaceCandidate?: EditableWorkspaceCandidate;
}

const FIXTURES = ['l-bracket', 'stepped-shaft', 'pin-block-assembly'] as const;

function artifactFilenameSegment(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'part';
}

export interface DesignBriefPanelProps {
  onClose?: () => void;
  /** Test seam: override fetch (defaults to window.fetch). */
  fetchImpl?: typeof fetch;
  onApplyWorkspaceCandidate?: (
    candidate: EditableWorkspaceCandidate,
  ) => Promise<{ ok: true; revisionId: string } | { ok: false; reason: string }>;
  workspaceRevisionVerification?: WorkspaceRevisionVerification | null;
}

export function DesignBriefPanel({
  onClose,
  fetchImpl,
  onApplyWorkspaceCandidate,
  workspaceRevisionVerification,
}: DesignBriefPanelProps) {
  const lang = useLang();
  const doFetch = fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  const [text, setText] = useState('');
  const [fixture, setFixture] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [applyArmed, setApplyArmed] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const aiRuns = usePdmSessionStore((s) => s.aiRuns);
  const repo = usePdmSessionStore((s) => s.repo);
  const approveAiRun = usePdmSessionStore((s) => s.approveAiRun);
  const requestAiChanges = usePdmSessionStore((s) => s.requestAiChanges);

  // Wave A · WA-E autonomy emitters — REAL actions only (submit outcome +
  // review-queue interactions). No fabricated events. See autonomySessionStore.
  const autonomyRunStarted = useAutonomySessionStore((s) => s.runStarted);
  const autonomyAbandoned = useAutonomySessionStore((s) => s.abandoned);
  const autonomyReviewStarted = useAutonomySessionStore((s) => s.reviewStarted);
  const autonomyReviewEnded = useAutonomySessionStore((s) => s.reviewEnded);
  const autonomyApproved = useAutonomySessionStore((s) => s.approved);
  const autonomyChangesRequested = useAutonomySessionStore((s) => s.changesRequested);
  /** One driver-run id per submit that reaches an outcome (package/refusal). */
  const briefRunSeq = useRef(0);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    setErrorMsg(null);
    setPayload(null);
    setStatus(null);
    setApplyArmed(false);
    setApplyResult(null);
    setDownloadError(null);
    try {
      const res = await doFetch('/api/nexyfab/design-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: { text: text.trim(), params: fixture ? { fixture } : undefined } }),
      });
      setStatus(res.status);
      const data = (await res.json().catch(() => ({}))) as Payload;
      if (res.status === 401) {
        setErrorMsg(loc(lang, { ko: '로그인이 필요합니다.', en: 'Sign in required.', ja: 'ログインが必要です。', zh: '需要登录。', es: 'Inicia sesión.', ar: 'تسجيل الدخول مطلوب.' }));
      } else if (res.status === 402 || res.status === 429) {
        setErrorMsg(data.error ?? loc(lang, { ko: '플랜 한도에 도달했습니다.', en: 'Plan limit reached.', ja: 'プラン上限に達しました。', zh: '已达套餐上限。', es: 'Límite del plan alcanzado.', ar: 'تم بلوغ حد الخطة.' }));
      } else if (!res.ok && !data.refusal) {
        setErrorMsg(data.error ?? loc(lang, { ko: '요청 실패.', en: 'Request failed.', ja: 'リクエスト失敗。', zh: '请求失败。', es: 'Solicitud fallida.', ar: 'فشل الطلب.' }));
      } else {
        setPayload(data);
        // WA-E autonomy: a driver run reached an outcome (package or refusal).
        // Auth/plan/network failures above emit NOTHING — no driver run happened.
        const runId = data.package?.planId ?? `brief-run-${++briefRunSeq.current}`;
        autonomyRunStarted(runId);
        if (!data.ok && data.refusal) autonomyAbandoned(runId); // 승인 없이 종료
      }
    } catch {
      setErrorMsg(loc(lang, { ko: '네트워크 오류.', en: 'Network error.', ja: 'ネットワークエラー。', zh: '网络错误。', es: 'Error de red.', ar: 'خطأ في الشبكة.' }));
    } finally {
      setBusy(false);
    }
  };

  const pkg = payload?.ok ? payload.package : undefined;
  const refusal = payload && !payload.ok ? payload.refusal : undefined;
  const execution = payload?.execution;
  const workspaceCandidate = payload?.workspaceCandidate;

  const applyWorkspaceCandidate = async () => {
    if (!workspaceCandidate?.supported || !onApplyWorkspaceCandidate || applying) return;
    if (!applyArmed) {
      setApplyArmed(true);
      return;
    }
    setApplying(true);
    setApplyResult(null);
    try {
      const result = await onApplyWorkspaceCandidate(workspaceCandidate);
      setApplyResult(result.ok
        ? { ok: true, message: `Revision ${result.revisionId} applied · verification reset` }
        : { ok: false, message: result.reason });
      if (result.ok) setApplyArmed(false);
    } catch (error) {
      setApplyResult({ ok: false, message: error instanceof Error ? error.message : 'workspace apply failed' });
    } finally {
      setApplying(false);
    }
  };

  const downloadArtifact = async (filename: string, contents: string, mimeType: string) => {
    setDownloadError(null);
    try {
      await downloadBlob(filename, new Blob([contents], { type: mimeType }));
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'artifact download failed');
    }
  };

  return (
    <div
      data-testid="design-brief-panel"
      style={{ width: 360, maxHeight: '82vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: 12, background: 'var(--nx-panel, #161b22)', border: '1px solid var(--nx-border, #30363d)', borderRadius: 8, color: 'var(--nx-text, #e6edf3)', fontSize: 12 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 700 }}>
          {loc(lang, { ko: 'AI 설계 브리프', en: 'AI Design Brief', ja: 'AI設計ブリーフ', zh: 'AI设计简报', es: 'Brief de diseño IA', ar: 'موجز التصميم بالذكاء' })}
        </div>
        {onClose && (
          <button data-testid="db-close" onClick={onClose} style={ghostBtn}>×</button>
        )}
      </div>
      <div style={{ fontSize: 10, color: 'var(--nx-text-3, #8b949e)' }}>
        {loc(lang, {
          ko: '한 문장 → 검증된 패키지(전 게이트 통과 시) 또는 명시 거부. 계획은 LLM, 검증은 결정론.',
          en: 'One brief → a verified package (only if all gates pass) or an explicit refusal. Plan by LLM, verification deterministic.',
          ja: '1文 → 検証済みパッケージ（全ゲート通過時）または明示的な拒否。計画はLLM、検証は決定論。',
          zh: '一句话 → 验证过的包（全部门控通过时）或明确拒绝。计划由LLM，验证为确定性。',
          es: 'Un brief → un paquete verificado (solo si pasan todas las puertas) o un rechazo explícito.',
          ar: 'موجز واحد → حزمة موثّقة (فقط عند اجتياز كل البوابات) أو رفض صريح.',
        })}
      </div>

      <div
        data-testid="db-scope-notice"
        role="status"
        style={{ padding: 8, borderRadius: 6, border: '1px solid #92400e', background: '#451a03', color: '#fde68a', fontSize: 10, lineHeight: 1.45 }}
      >
        {loc(lang, {
          ko: '전문가 동반 클로즈드 베타 · 게이트 통과 결과도 제조 출고 승인이 아닙니다. 정확 CAD, 제조도면, 전체 조립 검증과 독립 승인이 필요하며 워크스페이스에는 자동 적용되지 않습니다.',
          en: 'Expert-assisted closed beta · A gate-passed result is not a manufacturing release. Exact CAD, production drawings, full assembly verification, and independent approval are required; output is not auto-applied to the workspace.',
          ja: '専門家同伴のクローズドベータです。ゲート通過は製造リリース承認ではなく、正確なCAD、製造図面、組立検証、独立承認が必要です。',
          zh: '专家协作封闭测试。通过门控不代表制造放行；仍需精确 CAD、生产图纸、完整装配验证和独立审批。',
          es: 'Beta cerrada asistida por expertos. Superar las verificaciones no autoriza la fabricación; se requiere CAD exacto, planos, verificación completa y aprobación independiente.',
          ar: 'إصدار تجريبي مغلق بمراجعة خبير. اجتياز البوابات لا يعني اعتماد التصنيع؛ يلزم CAD دقيق ورسومات إنتاج وتحقق كامل وموافقة مستقلة.',
        })}
      </div>

      <form data-testid="db-form" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <textarea
          data-testid="db-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder={loc(lang, { ko: '설계 요청을 한 문장으로…', en: 'Describe the part in one line…', ja: '設計要求を1文で…', zh: '用一句话描述零件…', es: 'Describe la pieza en una línea…', ar: 'صف الجزء في سطر واحد…' })}
          style={{ ...inputStyle, height: 'auto', resize: 'vertical', padding: 6 }}
        />
        <label style={{ fontSize: 10, color: 'var(--nx-text-3, #8b949e)' }}>
          {loc(lang, { ko: '실행 모드', en: 'Execution mode', ja: '実行モード', zh: '执行模式', es: 'Modo de ejecución', ar: 'وضع التنفيذ' })}
        </label>
        <select data-testid="db-fixture" value={fixture} onChange={(e) => setFixture(e.target.value)} style={inputStyle}>
          <option value="">{loc(lang, { ko: '실제 AI 설계 · Pro 클로즈드 베타', en: 'Real AI design · Pro closed beta', ja: '実AI設計 · Proクローズドベータ', zh: '真实 AI 设计 · Pro 封闭测试', es: 'Diseño IA real · beta Pro', ar: 'تصميم AI فعلي · إصدار Pro مغلق' })}</option>
          {FIXTURES.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <div data-testid="db-mode-notice" style={{ fontSize: 9, color: 'var(--nx-text-3, #8b949e)' }}>
          {fixture
            ? loc(lang, { ko: '재현 가능한 참조 fixture 데모입니다. 입력 문장은 형상을 변경하지 않습니다.', en: 'Reproducible reference-fixture demo. The prompt does not change its geometry.', ja: '再現可能な参照fixtureデモです。入力文は形状を変更しません。', zh: '可复现的参考 fixture 演示；提示词不会改变其几何体。', es: 'Demo fixture reproducible; el texto no cambia la geometría.', ar: 'عرض مرجعي قابل للتكرار؛ النص لا يغير الشكل.' })
            : loc(lang, { ko: '입력 문장을 실제 LLM 설계 계획으로 처리합니다. 운영자가 승인한 Pro 베타에서만 실행됩니다.', en: 'The prompt is sent to the real LLM planner. Runs only in the operator-enabled Pro beta.', ja: '入力を実際のLLM設計計画として処理します。承認済みProベータのみ実行できます。', zh: '提示词将交给真实 LLM 规划器，仅在运营方启用的 Pro 测试中运行。', es: 'El texto se envía al planificador LLM real y solo funciona en la beta Pro habilitada.', ar: 'يُرسل النص إلى مخطط LLM الفعلي ويعمل فقط ضمن نسخة Pro المفعّلة.' })}
        </div>
        <button data-testid="db-submit" type="submit" disabled={busy || !text.trim()} style={{ ...primaryBtn, opacity: busy || !text.trim() ? 0.5 : 1 }}>
          {busy
            ? loc(lang, { ko: '검증 중…', en: 'Verifying…', ja: '検証中…', zh: '验证中…', es: 'Verificando…', ar: 'جارٍ التحقق…' })
            : loc(lang, { ko: '설계 패키지 생성', en: 'Generate package', ja: 'パッケージ生成', zh: '生成设计包', es: 'Generar paquete', ar: 'إنشاء الحزمة' })}
        </button>
      </form>

      {errorMsg && (
        <div data-testid="db-error" style={{ fontSize: 11, color: 'var(--nx-warn, #ef4444)' }}>{errorMsg}</div>
      )}

      {/* Gate-passed engineering package summary (not a manufacturing release). */}
      {pkg && (
        <div data-testid="db-package" style={{ borderTop: '1px solid var(--nx-border, #30363d)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontWeight: 700, color: '#f59e0b' }}>
            {loc(lang, { ko: '공학 게이트 통과 · 전문가 검토 대기', en: 'Engineering gates passed · expert review required', ja: '工学ゲート通過 · 専門家レビュー必須', zh: '工程门控通过 · 需要专家审核', es: 'Verificaciones superadas · requiere revisión experta', ar: 'اجتاز بوابات الهندسة · يلزم خبير' })} · {pkg.planId}
          </div>
          <div data-testid="db-execution-disclosure" style={{ padding: 6, borderRadius: 4, background: '#2b2112', color: '#fcd34d', fontSize: 9, lineHeight: 1.5 }}>
            {execution?.mode === 'reference-fixture' ? 'REFERENCE FIXTURE' : 'AI GENERATED'} · MANUFACTURING RELEASE: BLOCKED · WORKSPACE: NOT APPLIED · HUMAN REVIEW: REQUIRED
          </div>
          {workspaceCandidate && (
            <div data-testid="db-workspace-candidate" style={{ padding: 6, borderRadius: 4, border: '1px solid var(--nx-border, #30363d)', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {workspaceCandidate.supported ? (
                <>
                  <div style={{ fontSize: 9, color: 'var(--nx-text-3, #8b949e)' }}>
                    {loc(lang, {
                      ko: '편집 가능한 새 리비전으로 변환할 수 있습니다. 적용 시 현재 검증은 승계되지 않고 정확 커널 재검증 대기 상태가 됩니다.',
                      en: 'Can be converted into a new editable revision. Applying never inherits the current verification; exact-kernel reverification becomes mandatory.',
                      ja: '編集可能な新リビジョンに変換できます。現在の検証は継承されず、正確カーネルでの再検証が必須です。',
                      zh: '可转换为新的可编辑版本。不会继承当前验证，必须重新执行精确内核验证。',
                      es: 'Puede convertirse en una revisión editable. La verificación no se hereda y debe repetirse con el kernel exacto.',
                      ar: 'يمكن تحويله إلى مراجعة قابلة للتحرير. لا ينتقل التحقق الحالي ويلزم إعادة التحقق بالنواة الدقيقة.',
                    })}
                  </div>
                  {workspaceCandidate.target === 'assembly-browser' && (
                    <div data-testid="db-assembly-candidate-disclosure" style={{ fontSize: 9, color: '#fcd34d' }}>
                      Named axis/plane mates and solved placements will open in the semantic Assembly Browser. Part B-rep, drawings, interference and motion must be reverified.
                    </div>
                  )}
                  <button
                    data-testid="db-apply-workspace"
                    type="button"
                    disabled={!onApplyWorkspaceCandidate || applying}
                    onClick={() => { void applyWorkspaceCandidate(); }}
                    style={{ ...primaryBtn, background: applyArmed ? '#b45309' : '#1d4ed8', opacity: !onApplyWorkspaceCandidate || applying ? 0.5 : 1 }}
                  >
                    {workspaceCandidate.target === 'assembly-browser' && !applying
                      ? (applyArmed
                        ? 'Confirm: open semantic assembly workspace'
                        : 'Open semantic assembly workspace · reverify')
                      : applying
                      ? loc(lang, { ko: '리비전 적용 중…', en: 'Applying revision…', ja: 'リビジョン適用中…', zh: '正在应用版本…', es: 'Aplicando revisión…', ar: 'جارٍ تطبيق المراجعة…' })
                      : applyArmed
                        ? loc(lang, { ko: '확인: 현재 모델을 새 초안으로 교체', en: 'Confirm: replace current model with draft', ja: '確認：現在のモデルを下書きで置換', zh: '确认：用草稿替换当前模型', es: 'Confirmar: reemplazar modelo actual', ar: 'تأكيد: استبدال النموذج الحالي' })
                        : loc(lang, { ko: '편집 리비전 적용 · 재검증 필요', en: 'Apply editable revision · reverify', ja: '編集リビジョンを適用 · 再検証', zh: '应用可编辑版本 · 重新验证', es: 'Aplicar revisión editable · reverificar', ar: 'تطبيق مراجعة قابلة للتحرير · إعادة تحقق' })}
                  </button>
                </>
              ) : (
                <details data-testid="db-workspace-blockers" style={{ fontSize: 9, color: '#fca5a5' }}>
                  <summary>{loc(lang, { ko: '현재 편집 리비전 변환 불가', en: 'Editable revision conversion blocked', ja: '編集リビジョン変換不可', zh: '无法转换可编辑版本', es: 'Conversión editable bloqueada', ar: 'تحويل المراجعة محظور' })}</summary>
                  <ul style={{ margin: '4px 0 0', paddingInlineStart: 16 }}>
                    {workspaceCandidate.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}
                  </ul>
                </details>
              )}
              {applyResult && (
                <div data-testid="db-workspace-apply-result" style={{ fontSize: 9, color: applyResult.ok ? '#86efac' : '#fca5a5' }}>
                  {applyResult.message}
                </div>
              )}
              {workspaceRevisionVerification && (
                <div
                  data-testid="db-workspace-verification"
                  style={{
                    fontSize: 9,
                    color: workspaceRevisionVerification.status === 'passed'
                      ? '#86efac'
                      : workspaceRevisionVerification.status === 'failed' ? '#fca5a5' : '#fcd34d',
                  }}
                >
                  {workspaceRevisionVerification.status === 'pending'
                    ? `Revision ${workspaceRevisionVerification.revisionId} · exact OCCT B-rep verification pending`
                    : workspaceRevisionVerification.status === 'passed'
                      ? `Revision ${workspaceRevisionVerification.revisionId} · exact OCCT B-rep rebuild passed · manufacturing release still blocked`
                      : `Revision ${workspaceRevisionVerification.revisionId} · exact OCCT B-rep rebuild failed: ${workspaceRevisionVerification.reason ?? 'unknown error'}`}
                </div>
              )}
            </div>
          )}
          {pkg.parts.map((p) => {
            const exactBodies = p.exactCad?.bodies ?? [];
            const maxRoundTripError = exactBodies.length > 0
              ? Math.max(...exactBodies.map(body => body.roundTripVolumeRelError))
              : null;
            const originalOpenEdges = exactBodies.reduce((sum, body) => sum + (body.boundaryEdgeCount ?? 0) + (body.nonManifoldEdgeCount ?? 0), 0);
            const roundTripOpenEdges = exactBodies.reduce((sum, body) => sum + (body.roundTripBoundaryEdgeCount ?? 0) + (body.roundTripNonManifoldEdgeCount ?? 0), 0);
            const analyticCylinderCount = exactBodies.filter(body => body.analyticCylinder).length;
            const exactDrawingViews = p.exactDrawing?.views ?? [];
            const manufacturingSheets = p.manufacturingDrawing?.sheets ?? [];
            const partName = artifactFilenameSegment(p.partId);
            return (
              <div
                key={p.partId}
                data-testid="db-part"
                style={{ padding: 7, border: '1px solid var(--nx-border, #30363d)', borderRadius: 5, fontSize: 11, color: 'var(--nx-text-2, #c9d1d9)', display: 'flex', flexDirection: 'column', gap: 5 }}
              >
                <div>
                  <b>{p.partId}</b> · {loc(lang, { ko: '부피', en: 'vol', ja: '体積', zh: '体积', es: 'vol', ar: 'حجم' })} {p.volumeMm3.toFixed(2)} mm³ · {loc(lang, { ko: '치수', en: 'dims', ja: '寸法', zh: '尺寸', es: 'dims', ar: 'أبعاد' })} {p.dimensions.length}
                </div>
                {p.exactCad ? (
                  <div data-testid="db-exact-cad-evidence" style={{ fontSize: 9, lineHeight: 1.45, color: originalOpenEdges === 0 && roundTripOpenEdges === 0 ? '#86efac' : '#fca5a5' }}>
                    EXACT OCCT B-REP: PASSED · {exactBodies.length} {exactBodies.length === 1 ? 'body' : 'bodies'} · {p.exactCad.exactVolumeMm3.toFixed(6)} mm³
                    <br />CLOSED/NON-MANIFOLD: {originalOpenEdges === 0 ? '0/0' : `FAILED (${originalOpenEdges})`} · STEP ROUND-TRIP: {roundTripOpenEdges === 0 ? 'CLOSED' : `FAILED (${roundTripOpenEdges})`} · ΔVrel ≤ {maxRoundTripError?.toExponential(2) ?? 'n/a'} · analytic cylinders {analyticCylinderCount}
                  </div>
                ) : (
                  <div data-testid="db-exact-cad-missing" style={{ fontSize: 9, color: '#fca5a5' }}>
                    EXACT OCCT B-REP: MISSING · commercial verification unavailable
                  </div>
                )}
                {exactBodies.map((body) => (
                  <div key={body.bodyId} data-testid="db-exact-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: 9 }}>
                    <span>{body.bodyId} · F{body.faceCount ?? '?'} E{body.edgeCount ?? '?'} · degenerate {body.degeneratedEdgeCount ?? '?'}</span>
                    <button
                      data-testid="db-step-download"
                      type="button"
                      onClick={() => { void downloadArtifact(`${partName}-${artifactFilenameSegment(body.bodyId)}.step`, body.step, 'application/step'); }}
                      style={ghostBtn}
                    >
                      STEP
                    </button>
                  </div>
                ))}
                {p.exactDrawing ? (
                  <div data-testid="db-exact-drawing-evidence" style={{ fontSize: 9, lineHeight: 1.45, color: exactDrawingViews.length > 0 ? '#86efac' : '#fca5a5' }}>
                    EXACT STEP HLR: {exactDrawingViews.length > 0 ? 'PASSED' : 'FAILED'} · {exactDrawingViews.length} views · visible {exactDrawingViews.reduce((sum, view) => sum + view.visiblePathCount, 0)} · hidden {exactDrawingViews.reduce((sum, view) => sum + view.hiddenPathCount, 0)}
                  </div>
                ) : (
                  <div data-testid="db-exact-drawing-missing" style={{ fontSize: 9, color: '#fca5a5' }}>
                    EXACT STEP HLR: MISSING · exact drawing verification unavailable
                  </div>
                )}
                {exactDrawingViews.map((view) => (
                  <div key={`${view.bodyId}:${view.view}`} data-testid="db-exact-drawing-view" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: 9 }}>
                    <span>{view.bodyId} · {view.view} · {view.method} · curves {view.curveCount ?? '?'} · SHA {view.svgSha256.slice(0, 10)}…</span>
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      <button
                        data-testid="db-hlr-svg-download"
                        type="button"
                        onClick={() => { void downloadArtifact(`${partName}-${artifactFilenameSegment(view.bodyId)}-${view.view}-exact-hlr.svg`, view.svg, 'image/svg+xml;charset=utf-8'); }}
                        style={ghostBtn}
                      >
                        HLR SVG
                      </button>
                      {view.exactDxf&&<button
                        data-testid="db-hlr-dxf-download"
                        type="button"
                        onClick={() => { void downloadArtifact(`${partName}-${artifactFilenameSegment(view.bodyId)}-${view.view}-exact-hlr.dxf`, view.exactDxf!, 'application/dxf'); }}
                        style={ghostBtn}
                      >
                        EXACT DXF
                      </button>}
                    </span>
                  </div>
                ))}
                {p.manufacturingDrawing ? (
                  <div data-testid="db-manufacturing-drawing-evidence" style={{ fontSize: 9, lineHeight: 1.45, color: manufacturingSheets.length > 0 ? '#86efac' : '#fca5a5' }}>
                    ENGINEERING DRAWING PACKET: {manufacturingSheets.length > 0 ? 'COMPLETE FOR REVIEW' : 'INCOMPLETE'} · {manufacturingSheets.length} sheets · exact views {manufacturingSheets.reduce((sum, sheet) => sum + sheet.exactViewCount, 0)} · measured dimensions {p.manufacturingDrawing.includedDimensionCount}/{p.manufacturingDrawing.plannedDimensionCount}
                    <br /><span style={{ color: '#fcd34d' }}>NOT RELEASED · checker approval and revision freeze required</span>
                  </div>
                ) : (
                  <div data-testid="db-manufacturing-drawing-missing" style={{ fontSize: 9, color: '#fca5a5' }}>
                    ENGINEERING DRAWING PACKET: MISSING
                  </div>
                )}
                {manufacturingSheets.map((sheetArtifact) => (
                  <div key={`${sheetArtifact.bodyId}:${sheetArtifact.sheetNumber}`} data-testid="db-manufacturing-sheet" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: 9 }}>
                    <span>{sheetArtifact.bodyId} · sheet {sheetArtifact.sheetNumber}/{sheetArtifact.sheetCount} · {sheetArtifact.role} · SHA {sheetArtifact.svgSha256.slice(0, 10)}…</span>
                    <button
                      data-testid="db-manufacturing-svg-download"
                      type="button"
                      onClick={() => { void downloadArtifact(`${partName}-${artifactFilenameSegment(sheetArtifact.bodyId)}-engineering-review-${sheetArtifact.sheetNumber}-of-${sheetArtifact.sheetCount}.svg`, sheetArtifact.svg, 'image/svg+xml;charset=utf-8'); }}
                      style={ghostBtn}
                    >
                      REVIEW SVG
                    </button>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <span style={{ fontSize: 9, color: '#fcd34d' }}>Legacy sheet DXF preview · exact model curves are in the per-view EXACT DXF and review SVG above</span>
                  <button
                    data-testid="db-dxf-download"
                    type="button"
                    onClick={() => { void downloadArtifact(`${partName}-drawing-preview.dxf`, p.dxf, 'application/dxf'); }}
                    style={ghostBtn}
                  >
                    DXF
                  </button>
                </div>
              </div>
            );
          })}
          {downloadError && <div data-testid="db-download-error" style={{ fontSize: 9, color: '#fca5a5' }}>{downloadError}</div>}
          {pkg.bom && (
            <div data-testid="db-bom" style={{ fontSize: 10, color: 'var(--nx-text-3, #8b949e)' }}>
              BOM: {pkg.bom.map((r) => `${r.qty}× ${r.name}`).join(', ')}
            </div>
          )}
          {pkg.assembly && (
            <div style={{ fontSize: 10, color: 'var(--nx-text-3, #8b949e)' }}>
              {loc(lang, { ko: '조립 수렴', en: 'assembly converged', ja: '組立収束', zh: '装配收敛', es: 'ensamblaje convergió', ar: 'تقارب التجميع' })} · {pkg.assembly.iterations} it · r={pkg.assembly.finalMaxResidual.toExponential(1)}
            </div>
          )}
          <div data-testid="db-gates" style={{ fontSize: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {pkg.report.gates.map((g) => (
              <div key={g.id} style={{ color: g.pass ? 'var(--nx-text-3, #8b949e)' : 'var(--nx-warn, #ef4444)' }}>
                {g.pass ? '✓' : '✗'} {g.id}
              </div>
            ))}
          </div>
          {pkg.report.approximations.length > 0 && (
            <details data-testid="db-approx" style={{ fontSize: 10, color: 'var(--nx-text-3, #8b949e)' }}>
              <summary>{loc(lang, { ko: '근사·한계 고지', en: 'approximations · limitations', ja: '近似・限界', zh: '近似·限制', es: 'aproximaciones · límites', ar: 'التقريبات · الحدود' })}</summary>
              <ul style={{ margin: '4px 0 0', paddingInlineStart: 16 }}>
                {[...pkg.report.approximations, ...pkg.report.limitations].map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Explicit refusal — no package, stage + reason + failed gates */}
      {refusal && (
        <div data-testid="db-refusal" style={{ borderTop: '1px solid var(--nx-border, #30363d)', paddingTop: 8, fontSize: 11, color: 'var(--nx-warn, #ef4444)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontWeight: 700 }}>
            {loc(lang, { ko: '거부', en: 'Refused', ja: '拒否', zh: '拒绝', es: 'Rechazado', ar: 'مرفوض' })} · stage: {refusal.stage}
          </div>
          <div>{refusal.reason}</div>
          {refusal.failedGateIds.length > 0 && (
            <div data-testid="db-refusal-gates">{loc(lang, { ko: '실패 게이트', en: 'failed gates', ja: '失敗ゲート', zh: '失败门控', es: 'puertas fallidas', ar: 'بوابات فاشلة' })}: {refusal.failedGateIds.join(', ')}</div>
          )}
        </div>
      )}

      {/* WA-C review queue — AI runs (ai/<runId> commits) awaiting human review */}
      <div style={{ borderTop: '1px solid var(--nx-border, #30363d)', paddingTop: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 4, color: 'var(--nx-text-3, #8b949e)' }}>
          {loc(lang, { ko: 'AI 검토 큐', en: 'AI review queue', ja: 'AIレビューキュー', zh: 'AI审核队列', es: 'Cola de revisión IA', ar: 'قائمة مراجعة الذكاء' })}
        </div>
        <div data-testid="db-review-queue" style={{ maxHeight: 260, overflow: 'auto' }}>
          <AiReviewQueuePanel
            isKo={lang === 'ko'}
            runs={aiRuns}
            resolveCommit={(id) => repo?.getCommit(id) ?? null}
            onApprove={(runId) => { approveAiRun(runId, 'me'); autonomyApproved(runId); }}
            onRequestChanges={(runId, comments: ReviewComment[]) => { requestAiChanges(runId, comments); autonomyChangesRequested(runId, comments.length); }}
            onReviewOpen={(runId) => autonomyReviewStarted(runId)}
            onReviewClose={(runId) => autonomyReviewEnded(runId)}
          />
        </div>
      </div>

      <div style={{ fontSize: 9, color: 'var(--nx-text-3, #8b949e)' }}>
        {status !== null ? `HTTP ${status}` : ''}
      </div>
    </div>
  );
}

export default DesignBriefPanel;

const primaryBtn: React.CSSProperties = {
  padding: '6px 10px', border: 0, borderRadius: 4,
  background: 'var(--nx-accent, #2563eb)', color: '#fff', fontSize: 11,
  fontWeight: 600, cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  padding: '2px 8px', border: '1px solid var(--nx-border, #30363d)', borderRadius: 4,
  background: 'transparent', color: 'var(--nx-text, #e6edf3)', fontSize: 12, cursor: 'pointer',
};
const inputStyle: React.CSSProperties = {
  fontSize: 11, padding: '4px 6px',
  border: '1px solid var(--nx-border, #30363d)', borderRadius: 4,
  background: 'var(--nx-bg-2, #0d1117)', color: 'var(--nx-text, #e6edf3)',
  minWidth: 0, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
};
