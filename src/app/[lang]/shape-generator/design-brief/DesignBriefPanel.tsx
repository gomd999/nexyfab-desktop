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

interface MeasuredDim { id: string; kind: string; value: number; unit: string; expected?: number; deviation?: number }
interface PartPkg { partId: string; volumeMm3: number; dxf: string; dimensions: MeasuredDim[] }
interface GateLike { id: string; kind: string; pass: boolean; reason?: string; metrics: Record<string, number> }
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
}

const FIXTURES = ['l-bracket', 'stepped-shaft', 'pin-block-assembly'] as const;

export interface DesignBriefPanelProps {
  onClose?: () => void;
  /** Test seam: override fetch (defaults to window.fetch). */
  fetchImpl?: typeof fetch;
}

export function DesignBriefPanel({ onClose, fetchImpl }: DesignBriefPanelProps) {
  const lang = useLang();
  const doFetch = fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  const [text, setText] = useState('L-Bracket 60×40×8');
  const [fixture, setFixture] = useState<string>('l-bracket');
  const [busy, setBusy] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);

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
          {loc(lang, { ko: '결정론 플래너 픽스처', en: 'Deterministic planner fixture', ja: '決定論プランナー', zh: '确定性规划器', es: 'Fixture del planificador', ar: 'ثابت المخطِّط' })}
        </label>
        <select data-testid="db-fixture" value={fixture} onChange={(e) => setFixture(e.target.value)} style={inputStyle}>
          {FIXTURES.map((f) => <option key={f} value={f}>{f}</option>)}
          <option value="">{loc(lang, { ko: '(픽스처 없음 — 거부 데모)', en: '(no fixture — refusal demo)', ja: '(なし — 拒否デモ)', zh: '(无 — 拒绝演示)', es: '(sin fixture — demo de rechazo)', ar: '(بدون — عرض الرفض)' })}</option>
        </select>
        <button data-testid="db-submit" type="submit" disabled={busy || !text.trim()} style={{ ...primaryBtn, opacity: busy || !text.trim() ? 0.5 : 1 }}>
          {busy
            ? loc(lang, { ko: '검증 중…', en: 'Verifying…', ja: '検証中…', zh: '验证中…', es: 'Verificando…', ar: 'جارٍ التحقق…' })
            : loc(lang, { ko: '설계 패키지 생성', en: 'Generate package', ja: 'パッケージ生成', zh: '生成设计包', es: 'Generar paquete', ar: 'إنشاء الحزمة' })}
        </button>
      </form>

      {errorMsg && (
        <div data-testid="db-error" style={{ fontSize: 11, color: 'var(--nx-warn, #ef4444)' }}>{errorMsg}</div>
      )}

      {/* Verified package summary */}
      {pkg && (
        <div data-testid="db-package" style={{ borderTop: '1px solid var(--nx-border, #30363d)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontWeight: 700, color: 'var(--nx-ok, #22c55e)' }}>
            {loc(lang, { ko: '검증 통과 — 패키지', en: 'Verified — package', ja: '検証通過 — パッケージ', zh: '验证通过 — 设计包', es: 'Verificado — paquete', ar: 'تم التحقق — الحزمة' })} · {pkg.planId}
          </div>
          {pkg.parts.map((p) => (
            <div key={p.partId} data-testid="db-part" style={{ fontSize: 11, color: 'var(--nx-text-2, #c9d1d9)' }}>
              <b>{p.partId}</b> · {loc(lang, { ko: '부피', en: 'vol', ja: '体積', zh: '体积', es: 'vol', ar: 'حجم' })} {p.volumeMm3.toFixed(2)} mm³ · {loc(lang, { ko: '치수', en: 'dims', ja: '寸法', zh: '尺寸', es: 'dims', ar: 'أبعاد' })} {p.dimensions.length} · DXF {p.dxf.length}B
            </div>
          ))}
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
