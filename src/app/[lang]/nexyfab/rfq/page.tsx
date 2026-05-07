'use client';

import { use, useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { isKorean } from '@/lib/i18n/normalize';
import { useAuthStore } from '@/hooks/useAuth';
import DemoBadge from '@/components/nexyfab/DemoBadge';
import RfqCadFilesPanel from '@/components/nexyfab/RfqCadFilesPanel';

const QuoteNegotiatorPanel = dynamic(() => import('./QuoteNegotiatorPanel'), { ssr: false });

// ─── Types ────────────────────────────────────────────────────────────────────

interface CostEstimate {
  process: string;
  unitCost: number;
  leadTime: string;
  confidence: string;
}

interface RFQEntry {
  rfqId: string;
  shapeName: string;
  materialId: string;
  quantity: number;
  volume_cm3: number;
  costEstimates?: CostEstimate[];
  note?: string;
  deadline?: string;
  status: 'pending' | 'assigned' | 'quoted' | 'accepted' | 'rejected';
  assignedFactoryName?: string;
  assignedAt?: string;
  quoteAmount?: number;
  manufacturerNote?: string;
  createdAt: string;
}

interface Pagination {
  page: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const C = {
  bg: '#0d1117',
  surface: '#161b22',
  card: '#21262d',
  border: '#30363d',
  text: '#e6edf3',
  textDim: '#8b949e',
  textMuted: '#6e7681',
  accent: '#388bfd',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
};

const STATUS_META: Record<
  RFQEntry['status'],
  { labelKo: string; labelEn: string; color: string; bg: string }
> = {
  pending:  { labelKo: '검토 중',     labelEn: 'Pending',   color: '#d29922', bg: '#d2992220' },
  assigned: { labelKo: '제조사 배정', labelEn: 'Assigned',  color: '#a78bfa', bg: '#a78bfa20' },
  quoted:   { labelKo: '견적 완료',   labelEn: 'Quoted',    color: '#388bfd', bg: '#388bfd20' },
  accepted: { labelKo: '수락됨',      labelEn: 'Accepted',  color: '#3fb950', bg: '#3fb95020' },
  rejected: { labelKo: '취소됨',      labelEn: 'Cancelled', color: '#f85149', bg: '#f8514920' },
};

const PROCESS_LABELS: Record<string, { en: string; ko: string }> = {
  cnc_milling:       { en: 'CNC Milling',       ko: 'CNC 밀링' },
  cnc_turning:       { en: 'CNC Turning',        ko: 'CNC 선반' },
  injection_molding: { en: 'Injection Molding',  ko: '사출 성형' },
  sheet_metal:       { en: 'Sheet Metal',        ko: '판금 가공' },
  casting:           { en: 'Casting',            ko: '주조' },
  '3d_printing':     { en: '3D Printing',        ko: '3D 프린팅' },
};

const MATERIAL_OPTIONS = [
  { value: 'aluminum_6061',   labelKo: '알루미늄 6061', labelEn: 'Aluminum 6061' },
  { value: 'aluminum_7075',   labelKo: '알루미늄 7075', labelEn: 'Aluminum 7075' },
  { value: 'steel_mild',      labelKo: '일반 강재',      labelEn: 'Mild Steel' },
  { value: 'steel_stainless', labelKo: '스테인리스',     labelEn: 'Stainless Steel' },
  { value: 'titanium',        labelKo: '티타늄',         labelEn: 'Titanium' },
  { value: 'abs',             labelKo: 'ABS 플라스틱',   labelEn: 'ABS Plastic' },
  { value: 'pla',             labelKo: 'PLA 플라스틱',   labelEn: 'PLA Plastic' },
  { value: 'nylon',           labelKo: '나일론',         labelEn: 'Nylon' },
  { value: 'other',           labelKo: '기타',           labelEn: 'Other' },
];

const STATUS_FILTER_OPTIONS: { value: string; labelKo: string; labelEn: string }[] = [
  { value: '',         labelKo: '전체',       labelEn: 'All' },
  { value: 'pending',  labelKo: '검토 중',    labelEn: 'Pending' },
  { value: 'assigned', labelKo: '제조사 배정', labelEn: 'Assigned' },
  { value: 'quoted',   labelKo: '견적 완료',  labelEn: 'Quoted' },
  { value: 'accepted', labelKo: '수락됨',     labelEn: 'Accepted' },
  { value: 'rejected', labelKo: '취소됨',     labelEn: 'Cancelled' },
];

// ─── Page Component ───────────────────────────────────────────────────────────

export default function RFQPage({ params }: { params: Promise<{ lang: string }> }) {
  return (
    <Suspense fallback={null}>
      <RFQContent params={params} />
    </Suspense>
  );
}

function RFQContent({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const isKo = isKorean(lang);
  const { user } = useAuthStore();

  // 데모 모드 상태. 본 계정 인증이 없을 때 데모 세션 쿠키가 있으면 활성화.
  // 활성화 시 plan/email-verified 게이트 우회 → 광고 클릭 즉시 견적 시도 가능.
  const [demoActive, setDemoActive] = useState(false);
  const [demoStarting, setDemoStarting] = useState(false);

  // 견적 요청 가능 여부: 유료 플랜 OR 데모 모드.
  const canRfq = user?.plan === 'pro' || user?.plan === 'enterprise' || demoActive;

  const prefillFactoryId = searchParams.get('factoryId') ?? '';
  const prefillShapeName = searchParams.get('shapeName') ?? '';
  const prefillMaterial  = searchParams.get('material') ?? '';
  const prefillQty       = searchParams.get('qty') ?? '';
  const prefillOpen      = searchParams.get('open') === '1';
  // Phase B-2: DFM 결과 페이지에서 "매칭 의뢰" 클릭으로 진입했을 때 전달되는 컨텍스트.
  const prefillDfmCheckId = searchParams.get('dfmCheckId') ?? '';

  const [rfqs, setRfqs] = useState<RFQEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [compareRfq, setCompareRfq] = useState<{ id: string; name: string } | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // ── Phase B-2: DFM 컨텍스트 (DFM 검증 결과 → 매칭 의뢰 진입 시 표시) ──────
  interface DfmContext {
    id:         string;
    fileId:     string | null;
    issues:     number;
    warnings:   number;
    nextAction: string;
    createdAt:  number;
  }
  const [dfmContext, setDfmContext] = useState<DfmContext | null>(null);

  // ── New RFQ form ────────────────────────────────────────────────────────────
  const [showNewForm, setShowNewForm] = useState(false);
  const [formState, setFormState] = useState({ quantity: '', material: '', deadline: '', note: '', shapeName: '', preferredFactoryId: '' });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // ── AI 자연어 파싱 ─────────────────────────────────────────────────────────
  const [aiText, setAiText] = useState('');
  const [aiParsing, setAiParsing] = useState(false);
  const [aiResult, setAiResult] = useState<{ confidence: number; fallback?: boolean } | null>(null);
  const [showAiInput, setShowAiInput] = useState(false);

  const handleAiParse = async () => {
    if (!aiText.trim()) return;
    setAiParsing(true);
    setAiResult(null);
    try {
      const res = await fetch('/api/nexyfab/rfq/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: aiText, lang }),
      });
      const data = await res.json() as {
        parsed?: {
          shapeName?: string; materialId?: string; quantity?: number;
          deadline?: string; note?: string; dfmProcess?: string;
        };
        confidence?: number;
        fallback?: boolean;
      };
      if (res.ok && data.parsed) {
        setFormState(s => ({
          ...s,
          ...(data.parsed!.shapeName   && { shapeName: data.parsed!.shapeName }),
          ...(data.parsed!.materialId  && { material: data.parsed!.materialId }),
          ...(data.parsed!.quantity    && { quantity: String(data.parsed!.quantity) }),
          ...(data.parsed!.deadline    && { deadline: data.parsed!.deadline }),
          ...(data.parsed!.note        && { note: data.parsed!.note }),
        }));
        setAiResult({ confidence: data.confidence ?? 70, fallback: data.fallback });
        setShowAiInput(false);
      }
    } catch { /* ignore */ } finally {
      setAiParsing(false);
    }
  };

  const validate = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    const qty = parseInt(formState.quantity, 10);
    if (!formState.quantity.trim()) {
      errs.quantity = 'QTY_REQUIRED';
    } else if (isNaN(qty) || qty < 1) {
      errs.quantity = 'QTY_MIN';
    }
    if (!formState.material) {
      errs.material = 'MAT_REQUIRED';
    }
    if (formState.deadline) {
      const deadlineDate = new Date(formState.deadline);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (deadlineDate < today) {
        errs.deadline = 'DEADLINE_PAST';
      }
    }
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }, [formState]);

  const loadRfqs = useCallback(async (p = page, sf = statusFilter, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ page: String(p), limit: '10' });
      if (sf) qs.set('status', sf);
      const r = await fetch(`/api/nexyfab/rfq?${qs}`, { signal });
      if (!r.ok) throw new Error('Failed to load');
      const data = await r.json() as { rfqs: RFQEntry[]; pagination: Pagination };
      setRfqs(data.rfqs ?? []);
      setPagination(data.pagination ?? null);
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError('LOAD_FAILED');
      }
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    const controller = new AbortController();
    loadRfqs(page, statusFilter, controller.signal);
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter]);

  // Auto-open form and pre-fill from shape-generator URL params
  useEffect(() => {
    const hasPrefill = prefillFactoryId || prefillShapeName || prefillMaterial || prefillQty || prefillOpen || prefillDfmCheckId;
    if (!hasPrefill) return;
    setFormState(s => ({
      ...s,
      ...(prefillFactoryId && { preferredFactoryId: prefillFactoryId }),
      ...(prefillShapeName && { shapeName: prefillShapeName }),
      ...(prefillMaterial  && { material: prefillMaterial }),
      ...(prefillQty       && { quantity: prefillQty }),
    }));
    if (canRfq && (prefillOpen || prefillShapeName || prefillMaterial || prefillDfmCheckId)) setShowNewForm(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 데모 세션 상태 조회 — 비로그인 사용자만. 쿠키가 이미 있으면 active=true.
  // 페이지 새로고침 시 데모 진입 상태가 유지되도록 마운트 시 확인.
  useEffect(() => {
    if (user) { setDemoActive(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/nexyfab/demo-session', { method: 'GET' });
        if (cancelled) return;
        if (r.ok) {
          const data = await r.json() as { active?: boolean };
          setDemoActive(!!data.active);
        }
      } catch { /* 네트워크 실패해도 일반 비로그인 화면 그대로 — 무해 */ }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const startDemo = useCallback(async () => {
    if (demoStarting) return;
    setDemoStarting(true);
    try {
      const r = await fetch('/api/nexyfab/demo-session', { method: 'POST' });
      if (r.ok) {
        setDemoActive(true);
        setShowNewForm(true); // 진입 즉시 form 열어 마찰 최소화
      }
    } catch { /* 사용자에게 명시적 메시지는 불필요 — 버튼이 그대로 남으면 재시도 가능 */ }
    finally { setDemoStarting(false); }
  }, [demoStarting]);

  const handleSignupClick = useCallback(() => {
    // 가입 후 claim 엔드포인트가 자동으로 데모 데이터를 본 계정으로 이관.
    router.push(`/${lang}/nexyfab/signup?reason=demo_claim&next=${encodeURIComponent(`/${lang}/nexyfab/rfq`)}`);
  }, [router, lang]);

  // Phase B-2: DFM 컨텍스트 로드 + match_view funnel 기록.
  // 페이지 진입 시 1회 실행. 컨텍스트가 있으면 ContextSummary 카드를 그리고,
  // funnel 에는 dfmContextUsed 플래그를 함께 남겨 코호트 비교가 가능하게 한다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (prefillDfmCheckId) {
        try {
          const r = await fetch(`/api/nexyfab/dfm-check/${prefillDfmCheckId}`);
          if (!cancelled && r.ok) {
            const data = await r.json() as DfmContext;
            setDfmContext(data);
          }
        } catch { /* ignore — 카드만 안 그려질 뿐 */ }
      }
      // Stage 와 무관 — 의도 시그널만 기록. 실패해도 사용자 흐름 차단 ❌.
      fetch('/api/nexyfab/funnel-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'match_view',
          contextType: prefillDfmCheckId ? 'dfm_check' : 'rfq_page',
          contextId:   prefillDfmCheckId || undefined,
          metadata: { dfmContextUsed: !!prefillDfmCheckId },
        }),
      }).catch(() => {});
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStatusFilter = (val: string) => {
    setStatusFilter(val);
    setPage(1);
  };

  async function handleSubmitRFQ(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/nexyfab/rfq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materialId: formState.material,
          quantity: parseInt(formState.quantity, 10),
          deadline: formState.deadline || undefined,
          note: formState.note || undefined,
          shapeName: formState.shapeName || undefined,
          preferredFactoryId: formState.preferredFactoryId || undefined,
          // Phase B-2: DFM 결과 페이지에서 진입했을 때만 채워진다.
          // 서버에서 본인 소유 검증인지 재확인하므로 위조 위험 없음.
          dfmCheckId: prefillDfmCheckId || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setFormErrors({ _submit: data.error || (isKo ? '제출에 실패했습니다.' : 'Submission failed.') });
        return;
      }
      setSubmitSuccess(true);
      setFormState({ quantity: '', material: '', deadline: '', note: '', shapeName: '', preferredFactoryId: '' });
      setFormErrors({});
      setTimeout(() => { setShowNewForm(false); setSubmitSuccess(false); }, 2000);
      await loadRfqs(1, statusFilter);
      setPage(1);
    } catch {
      setFormErrors({ _submit: isKo ? '네트워크 오류가 발생했습니다.' : 'Network error. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  const handleCancel = useCallback(async (rfq: RFQEntry) => {
    setCancellingId(rfq.rfqId);
    try {
      const r = await fetch(`/api/nexyfab/rfq/${rfq.rfqId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' }),
      });
      if (!r.ok) throw new Error('Failed');
      setRfqs(prev => prev.map(item =>
        item.rfqId === rfq.rfqId ? { ...item, status: 'rejected' } : item,
      ));
    } catch {
      // ignore — show nothing, the UI doesn't change
    } finally {
      setCancellingId(null);
    }
  }, []);

  const selectStyle: React.CSSProperties = {
    padding: '7px 10px', borderRadius: 7, fontSize: 12,
    background: C.card, border: `1px solid ${C.border}`,
    color: C.text, outline: 'none', cursor: 'pointer',
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: C.bg,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: C.text,
    }}>
      {/* Header */}
      <div style={{
        borderBottom: `1px solid #21262d`,
        padding: '16px clamp(16px, 4vw, 32px)',
        display: 'flex', alignItems: 'center', gap: 16,
        position: 'sticky', top: 0, background: C.bg, zIndex: 10,
      }}>
        <Link prefetch href={`/${lang}/shape-generator`} style={{ textDecoration: 'none' }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: C.accent }}>Nexy</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: C.green }}>Fab</span>
        </Link>
        <span style={{ color: C.border }}>/</span>
        <span style={{ fontSize: 14, color: C.textMuted }}>
          {isKo ? '견적 요청' : 'Quote Requests'}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => router.push(`/${lang}/shape-generator`)}
          style={{
            padding: '7px 16px', borderRadius: 8, border: 'none',
            background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
            color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          {isKo ? '+ 새 형상 제작' : '+ New Design'}
        </button>
      </div>

      {/* 데모 모드 배너 — 활성화 시 가입 CTA 와 함께 항상 상단에 표시 */}
      <DemoBadge active={demoActive && !user} onSignupClick={handleSignupClick} lang={lang} />

      {/* Body */}
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px clamp(12px, 3vw, 24px)' }}>
        <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800 }}>
              {isKo ? '견적 요청 목록' : 'RFQ List'}
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: C.textMuted }}>
              {isKo
                ? '제출한 견적 요청과 제조사의 응답을 확인하세요.'
                : 'Track your submitted quote requests and manufacturer responses.'}
            </p>
          </div>
          {canRfq ? (
            <button
              onClick={() => { setShowNewForm(v => !v); setFormErrors({}); setSubmitSuccess(false); }}
              style={{
                padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                border: `1px solid ${showNewForm ? C.accent : C.border}`,
                background: showNewForm ? `${C.accent}20` : 'transparent',
                color: showNewForm ? C.accent : C.textDim, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {showNewForm ? (isKo ? '✕ 닫기' : '✕ Close') : (isKo ? '+ 새 견적 요청' : '+ New RFQ')}
            </button>
          ) : !user ? (
            // 비로그인: 데모 진입 1차 CTA, Pro 안내는 2차로 강등.
            // ID/PW 게이트 → 광고 첫 클릭 drop-off 차단이 핵심.
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={startDemo}
                disabled={demoStarting}
                style={{
                  padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                  border: 'none',
                  background: 'linear-gradient(135deg, #22d3ee, #0ea5e9)',
                  color: '#0c4a6e', cursor: demoStarting ? 'wait' : 'pointer',
                }}
              >
                {demoStarting
                  ? (isKo ? '준비 중…' : 'Starting…')
                  : (isKo ? '🎯 데모 모드 시작' : '🎯 Try Demo')}
              </button>
              <a
                href={`/${lang}/nexyfab/billing`}
                style={{
                  padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  border: `1px solid ${C.border}`, background: 'transparent',
                  color: C.textDim, cursor: 'pointer', textDecoration: 'none',
                }}
              >
                {isKo ? 'Pro 보기' : 'See Pro'}
              </a>
            </div>
          ) : (
            // 로그인은 했지만 free 플랜: Pro 업그레이드 CTA 만 노출.
            <a
              href={`/${lang}/nexyfab/billing`}
              style={{
                padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                border: '1px solid #f0883e', background: '#f0883e18',
                color: '#f0883e', cursor: 'pointer', textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              ⬆ {isKo ? 'Pro에서 견적 요청' : 'Upgrade to Request RFQ'}
            </a>
          )}
        </div>

        {/* ── New RFQ Form ─────────────────────────────────────────────────── */}
        {showNewForm && (
          <form
            onSubmit={handleSubmitRFQ}
            noValidate
            style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
              padding: '24px 20px', marginBottom: 28,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                {isKo ? '새 견적 요청' : 'New Quote Request'}
              </h2>
              <button
                type="button"
                onClick={() => setShowAiInput(v => !v)}
                style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                  border: `1px solid ${showAiInput ? '#a78bfa' : C.border}`,
                  background: showAiInput ? '#a78bfa20' : 'transparent',
                  color: showAiInput ? '#a78bfa' : C.textDim, cursor: 'pointer',
                }}
              >
                ✦ {isKo ? 'AI 자동 입력' : 'AI Auto-fill'}
              </button>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: C.textMuted }}>
              {isKo
                ? '형상 설계 없이도 요청 가능합니다. 더 정확한 견적은 형상 생성기를 이용하세요.'
                : 'You can request a quote without a 3D design. Use the shape generator for accurate quotes.'}
            </p>

            {/* ── Phase B-2: DFM 컨텍스트 요약 카드 ──────────────────────────
                 DFM 결과 페이지에서 매칭 의뢰로 진입한 경우에만 노출.
                 PASS/WARN/FAIL 한 눈에 보이도록 색을 갈라 그린다. */}
            {dfmContext && (() => {
              const grade = dfmContext.issues > 0 ? 'FAIL'
                          : dfmContext.warnings > 0 ? 'WARN'
                          : 'PASS';
              const tone = grade === 'FAIL' ? { c: C.red,    bg: '#f8514912' }
                         : grade === 'WARN' ? { c: C.yellow, bg: '#d2992212' }
                         :                    { c: C.green,  bg: '#3fb95012' };
              return (
                <div style={{
                  marginBottom: 20, padding: '14px 16px', borderRadius: 10,
                  background: tone.bg, border: `1px solid ${tone.c}40`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 800,
                      background: tone.c, color: '#0d1117', letterSpacing: 0.4,
                    }}>{grade}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                      {isKo ? 'DFM 검증 결과 동봉' : 'DFM check attached'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>
                    {isKo
                      ? `에러 ${dfmContext.issues}건 · 경고 ${dfmContext.warnings}건 · 검증 ID ${dfmContext.id.slice(0, 8)}…`
                      : `${dfmContext.issues} issues · ${dfmContext.warnings} warnings · check ${dfmContext.id.slice(0, 8)}…`}
                    {dfmContext.fileId && (
                      <> · {isKo ? '파일' : 'file'} <code style={{ color: C.textMuted }}>{dfmContext.fileId.slice(0, 8)}…</code></>
                    )}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 11, color: C.textMuted }}>
                    {isKo
                      ? '제조사가 견적을 낼 때 이 검증 결과를 참고합니다. 매칭 정확도가 향상됩니다.'
                      : 'Manufacturers will see this check result when quoting — improves match accuracy.'}
                  </div>
                </div>
              );
            })()}

            {/* ── AI 자연어 입력 패널 ───────────────────────────────────── */}
            {showAiInput && (
              <div style={{
                marginBottom: 20, padding: '14px 16px', borderRadius: 10,
                background: '#a78bfa0e', border: '1px solid #a78bfa40',
              }}>
                <p style={{ margin: '0 0 8px', fontSize: 12, color: '#a78bfa', fontWeight: 700 }}>
                  ✦ {isKo ? 'AI가 자연어를 분석해 아래 양식을 자동으로 채웁니다.' : 'AI will parse your description and auto-fill the form below.'}
                </p>
                <textarea
                  value={aiText}
                  onChange={e => setAiText(e.target.value)}
                  placeholder={isKo
                    ? '예) 알루미늄 6061 브라켓, CNC 밀링, 500개, 공차 ±0.05mm, 4주 안에 납기'
                    : 'e.g. Aluminum 6061 bracket, CNC milling, 500 pcs, ±0.05mm tolerance, 4 week lead time'}
                  rows={3}
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '9px 12px',
                    borderRadius: 8, fontSize: 13, resize: 'vertical',
                    background: C.card, color: C.text,
                    border: `1px solid ${C.border}`, outline: 'none',
                    fontFamily: 'inherit',
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={handleAiParse}
                    disabled={aiParsing || !aiText.trim()}
                    style={{
                      padding: '7px 18px', borderRadius: 7, fontSize: 12, fontWeight: 700,
                      border: 'none', cursor: aiParsing || !aiText.trim() ? 'default' : 'pointer',
                      background: aiParsing || !aiText.trim() ? C.border : 'linear-gradient(135deg,#a78bfa,#388bfd)',
                      color: aiParsing || !aiText.trim() ? C.textMuted : '#fff',
                    }}
                  >
                    {aiParsing ? (isKo ? '분석 중...' : 'Parsing...') : (isKo ? '분석하기' : 'Parse')}
                  </button>
                  {aiResult && (
                    <span style={{ fontSize: 11, color: aiResult.confidence >= 60 ? C.green : C.yellow }}>
                      {aiResult.fallback
                        ? (isKo ? '⚠ 기본 파싱 적용됨' : '⚠ Basic parsing applied')
                        : (isKo ? `✓ 신뢰도 ${aiResult.confidence}%` : `✓ Confidence ${aiResult.confidence}%`)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {formState.preferredFactoryId && (
              <div style={{
                padding: '10px 14px', borderRadius: 8, marginBottom: 16,
                background: '#388bfd15', border: '1px solid #388bfd40', color: C.accent,
                fontSize: 12, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>🏭</span>
                <span style={{ flex: 1 }}>
                  {isKo
                    ? `마켓플레이스에서 선택한 제조사(ID: ${formState.preferredFactoryId.slice(0, 8)})로 견적을 요청합니다.`
                    : `Requesting quote for manufacturer selected from marketplace (ID: ${formState.preferredFactoryId.slice(0, 8)}).`}
                </span>
                <button
                  type="button"
                  onClick={() => setFormState(s => ({ ...s, preferredFactoryId: '' }))}
                  style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
                >✕</button>
              </div>
            )}

            {submitSuccess && (
              <div style={{
                padding: '10px 14px', borderRadius: 8, marginBottom: 16,
                background: '#3fb95020', border: '1px solid #3fb95040', color: C.green, fontSize: 13,
              }}>
                {isKo ? '견적 요청이 제출됐습니다.' : 'RFQ submitted successfully.'}
              </div>
            )}
            {formErrors._submit && (
              <div style={{
                padding: '10px 14px', borderRadius: 8, marginBottom: 16,
                background: '#f8514920', border: '1px solid #f8514940', color: C.red, fontSize: 13,
              }}>
                {formErrors._submit}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              {/* Part name (optional) */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textDim, marginBottom: 6 }}>
                  {isKo ? '부품명 (선택)' : 'Part name (optional)'}
                </label>
                <input
                  type="text"
                  value={formState.shapeName}
                  onChange={e => setFormState(s => ({ ...s, shapeName: e.target.value }))}
                  placeholder={isKo ? '예: 브라켓 A' : 'e.g. Bracket A'}
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13, boxSizing: 'border-box',
                    background: C.card, color: C.text, border: `1px solid ${C.border}`, outline: 'none',
                  }}
                />
              </div>

              {/* Quantity */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textDim, marginBottom: 6 }}>
                  {isKo ? '수량 *' : 'Quantity *'}
                </label>
                <input
                  type="number" min={1}
                  value={formState.quantity}
                  onChange={e => { setFormState(s => ({ ...s, quantity: e.target.value })); setFormErrors(s => ({ ...s, quantity: '' })); }}
                  placeholder={isKo ? '예: 100' : 'e.g. 100'}
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13, boxSizing: 'border-box',
                    background: C.card, color: C.text, outline: 'none',
                    border: `1px solid ${formErrors.quantity ? C.red : C.border}`,
                  }}
                />
                {formErrors.quantity && <p style={{ margin: '4px 0 0', fontSize: 11, color: C.red }}>
                  {formErrors.quantity === 'QTY_REQUIRED' ? (isKo ? '수량을 입력하세요.' : 'Quantity is required.') :
                   formErrors.quantity === 'QTY_MIN' ? (isKo ? '수량은 1 이상이어야 합니다.' : 'Quantity must be at least 1.') :
                   formErrors.quantity}
                </p>}
              </div>

              {/* Material */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textDim, marginBottom: 6 }}>
                  {isKo ? '재질 *' : 'Material *'}
                </label>
                <select
                  value={formState.material}
                  onChange={e => { setFormState(s => ({ ...s, material: e.target.value })); setFormErrors(s => ({ ...s, material: '' })); }}
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13, boxSizing: 'border-box',
                    background: C.card, color: formState.material ? C.text : C.textMuted,
                    outline: 'none', cursor: 'pointer',
                    border: `1px solid ${formErrors.material ? C.red : C.border}`,
                  }}
                >
                  <option value="">{isKo ? '재질 선택...' : 'Select material...'}</option>
                  {MATERIAL_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {isKo ? opt.labelKo : opt.labelEn}
                    </option>
                  ))}
                </select>
                {formErrors.material && <p style={{ margin: '4px 0 0', fontSize: 11, color: C.red }}>
                  {formErrors.material === 'MAT_REQUIRED' ? (isKo ? '재질을 선택하세요.' : 'Material is required.') : formErrors.material}
                </p>}
              </div>

              {/* Deadline (optional) */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textDim, marginBottom: 6 }}>
                  {isKo ? '납기 희망일 (선택)' : 'Desired deadline (optional)'}
                </label>
                <input
                  type="date"
                  value={formState.deadline}
                  onChange={e => { setFormState(s => ({ ...s, deadline: e.target.value })); setFormErrors(s => ({ ...s, deadline: '' })); }}
                  min={new Date().toISOString().split('T')[0]}
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13, boxSizing: 'border-box',
                    background: C.card, color: formState.deadline ? C.text : C.textMuted, outline: 'none',
                    border: `1px solid ${formErrors.deadline ? C.red : C.border}`,
                    colorScheme: 'dark',
                  }}
                />
                {formErrors.deadline && <p style={{ margin: '4px 0 0', fontSize: 11, color: C.red }}>
                  {formErrors.deadline === 'DEADLINE_PAST' ? (isKo ? '마감기한은 오늘 이후여야 합니다.' : 'Deadline must be today or later.') : formErrors.deadline}
                </p>}
              </div>
            </div>

            {/* Note */}
            <div style={{ marginTop: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textDim, marginBottom: 6 }}>
                {isKo ? '메모 (선택)' : 'Note (optional)'}
              </label>
              <textarea
                value={formState.note}
                onChange={e => setFormState(s => ({ ...s, note: e.target.value }))}
                placeholder={isKo ? '추가 요구사항이나 참고사항을 입력하세요...' : 'Add any special requirements or notes...'}
                rows={3}
                style={{
                  width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13, boxSizing: 'border-box',
                  background: C.card, color: C.text, border: `1px solid ${C.border}`,
                  outline: 'none', resize: 'vertical', fontFamily: 'inherit',
                }}
              />
            </div>

            <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => { setShowNewForm(false); setFormErrors({}); setFormState({ quantity: '', material: '', deadline: '', note: '', shapeName: '', preferredFactoryId: '' }); }}
                style={{
                  padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  border: `1px solid ${C.border}`, background: 'transparent', color: C.textDim, cursor: 'pointer',
                }}
              >
                {isKo ? '취소' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  padding: '9px 24px', borderRadius: 8, fontSize: 13, fontWeight: 700, border: 'none',
                  cursor: submitting ? 'default' : 'pointer',
                  background: submitting ? '#388bfd88' : 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                  color: '#fff',
                }}
              >
                {submitting ? (isKo ? '제출 중...' : 'Submitting...') : (isKo ? '견적 요청 제출' : 'Submit RFQ')}
              </button>
            </div>
          </form>
        )}

        {/* ── Status filter bar ───────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          {STATUS_FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => handleStatusFilter(opt.value)}
              style={{
                padding: '8px 14px', minHeight: 36, borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${statusFilter === opt.value ? C.accent : C.border}`,
                background: statusFilter === opt.value ? `${C.accent}20` : 'transparent',
                color: statusFilter === opt.value ? C.accent : C.textDim,
                transition: 'all 0.12s',
              }}
            >
              {isKo ? opt.labelKo : opt.labelEn}
            </button>
          ))}
        </div>

        {/* ── List ────────────────────────────────────────────────────────── */}
        {loading ? (
          <LoadingState isKo={isKo} />
        ) : error ? (
          <ErrorState message={error} isKo={isKo} onRetry={() => loadRfqs(page, statusFilter)} />
        ) : rfqs.length === 0 ? (
          <EmptyState isKo={isKo} lang={lang} router={router} hasFilter={!!statusFilter} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rfqs.map(rfq => (
              <RFQCard
                key={rfq.rfqId}
                rfq={rfq}
                isKo={isKo}
                expanded={expandedId === rfq.rfqId}
                onToggle={() => setExpandedId(prev => (prev === rfq.rfqId ? null : rfq.rfqId))}
                onCompare={() => setCompareRfq({ id: rfq.rfqId, name: rfq.shapeName })}
                onCancel={handleCancel}
                isCancelling={cancellingId === rfq.rfqId}
                onAccept={(rfqId, amount, factoryName) => setRfqs(prev => prev.map(r =>
                  r.rfqId === rfqId ? { ...r, status: 'accepted', quoteAmount: amount, manufacturerNote: factoryName } : r,
                ))}
                showCadFiles={!demoActive}
              />
            ))}
          </div>
        )}

        {/* ── Pagination ──────────────────────────────────────────────────── */}
        {pagination && pagination.totalPages > 1 && (
          <div style={{
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            gap: 8, marginTop: 28,
          }}>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={!pagination.hasPrev}
              style={{ ...selectStyle, padding: '7px 14px', opacity: pagination.hasPrev ? 1 : 0.4, cursor: pagination.hasPrev ? 'pointer' : 'not-allowed' }}
            >
              ← {isKo ? '이전' : 'Prev'}
            </button>
            <span style={{ fontSize: 12, color: C.textMuted }}>
              {page} / {pagination.totalPages}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={!pagination.hasNext}
              style={{ ...selectStyle, padding: '7px 14px', opacity: pagination.hasNext ? 1 : 0.4, cursor: pagination.hasNext ? 'pointer' : 'not-allowed' }}
            >
              {isKo ? '다음' : 'Next'} →
            </button>
          </div>
        )}

        {/* Quote compare modal */}
        {compareRfq && (
          <QuoteCompareModal
            rfqId={compareRfq.id}
            rfqName={compareRfq.name}
            isKo={isKo}
            onClose={() => setCompareRfq(null)}
          />
        )}
      </div>
    </div>
  );
}

// ─── RFQ Timeline ─────────────────────────────────────────────────────────────

const TIMELINE_STEPS: {
  statusKey: RFQEntry['status'];
  labelKo: string;
  labelEn: string;
  icon: string;
}[] = [
  { statusKey: 'pending',  labelKo: '접수',   labelEn: 'Received', icon: '📋' },
  { statusKey: 'assigned', labelKo: '배정',   labelEn: 'Assigned', icon: '🏭' },
  { statusKey: 'quoted',   labelKo: '견적',   labelEn: 'Quoted',   icon: '💬' },
  { statusKey: 'accepted', labelKo: '수락',   labelEn: 'Accepted', icon: '✅' },
];

const STATUS_ORDER: Record<RFQEntry['status'], number> = {
  pending: 0, assigned: 1, quoted: 2, accepted: 3, rejected: -1,
};

function RFQTimeline({ rfq, isKo }: { rfq: RFQEntry; isKo: boolean }) {
  const currentOrder = STATUS_ORDER[rfq.status] ?? 0;
  const isRejected = rfq.status === 'rejected';

  return (
    <div style={{ margin: '4px 0 8px' }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <div style={{
          position: 'absolute', top: '50%', left: '10%', right: '10%', height: 2,
          background: C.border, transform: 'translateY(-50%)', zIndex: 0,
        }} />
        {!isRejected && currentOrder > 0 && (
          <div style={{
            position: 'absolute', top: '50%', left: '10%',
            width: `${(currentOrder / (TIMELINE_STEPS.length - 1)) * 80}%`,
            height: 2, background: C.accent, transform: 'translateY(-50%)', zIndex: 1,
            transition: 'width 0.4s ease',
          }} />
        )}
        {TIMELINE_STEPS.map((step, i) => {
          const stepOrder = STATUS_ORDER[step.statusKey];
          const done = !isRejected && currentOrder >= stepOrder;
          const active = !isRejected && currentOrder === stepOrder;
          return (
            <div key={step.statusKey} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, zIndex: 2,
            }}>
              <div style={{
                width: active ? 32 : 26, height: active ? 32 : 26, borderRadius: '50%',
                background: isRejected && i === 0 ? C.red : done ? (active ? C.accent : C.green) : C.card,
                border: `2px solid ${isRejected && i === 0 ? C.red : done ? (active ? C.accent : C.green) : C.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: active ? 14 : 11, transition: 'all 0.2s',
                boxShadow: active ? `0 0 0 4px ${C.accent}30` : 'none',
              }}>
                {isRejected && i > 0 ? '' : (done ? (active ? step.icon : '✓') : step.icon)}
              </div>
              <span style={{
                fontSize: 10, fontWeight: active ? 700 : 500,
                color: active ? C.accent : done ? C.text : C.textMuted, whiteSpace: 'nowrap',
              }}>
                {isKo ? step.labelKo : step.labelEn}
              </span>
            </div>
          );
        })}
        {isRejected && (
          <div style={{
            position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
            padding: '3px 10px', borderRadius: 12, background: `${C.red}20`,
            border: `1px solid ${C.red}40`, color: C.red, fontSize: 10, fontWeight: 700, zIndex: 3,
          }}>
            {isKo ? '취소됨' : 'Cancelled'}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Quote Accept/Reject Section ─────────────────────────────────────────────

interface QuoteForRFQ {
  id: string;
  factoryName: string;
  estimatedAmount: number;
  estimatedDays: number | null;
  note: string | null;
  status: string;
  validUntil: string | null;
}

function QuoteAcceptSection({
  rfqId, isKo, onAccepted,
}: { rfqId: string; isKo: boolean; onAccepted: (amount: number, factoryName: string) => void }) {
  const [quotes, setQuotes] = useState<QuoteForRFQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/nexyfab/rfq/${rfqId}/quotes`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((d: { quotes?: QuoteForRFQ[] } | null) => {
        setQuotes((d?.quotes ?? []).filter(q => q.status !== 'rejected'));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [rfqId]);

  async function handleAction(quoteId: string, action: 'accept' | 'reject') {
    setActingId(quoteId);
    try {
      const r = await fetch(`/api/nexyfab/rfq/${rfqId}/quotes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ quoteId, action }),
      });
      if (!r.ok) throw new Error();
      if (action === 'accept') {
        const q = quotes.find(x => x.id === quoteId);
        if (q) onAccepted(q.estimatedAmount, q.factoryName);
        setDone(true);
      } else {
        setQuotes(prev => prev.filter(q => q.id !== quoteId));
      }
    } catch {
      alert(isKo ? '처리 중 오류가 발생했습니다.' : 'An error occurred.');
    } finally {
      setActingId(null);
    }
  }

  if (done) {
    return (
      <div style={{ background: `${C.green}12`, border: `1px solid ${C.green}30`, borderRadius: 8, padding: '12px 16px', textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.green }}>
          ✅ {isKo ? '견적을 수락했습니다. 제조사에 알림을 보냈습니다.' : 'Quote accepted. Manufacturer notified.'}
        </p>
      </div>
    );
  }

  return (
    <div style={{ background: `#388bfd10`, border: `1px solid ${C.accent}30`, borderRadius: 10, padding: '12px 14px' }}>
      <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 800, color: C.accent }}>
        💬 {isKo ? '제조사 견적이 도착했습니다. 수락 또는 거절해주세요.' : 'Manufacturer quote(s) arrived. Accept or decline.'}
      </p>

      {loading && <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>{isKo ? '불러오는 중...' : 'Loading...'}</p>}
      {!loading && quotes.length === 0 && (
        <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>
          {isKo ? '견적이 없습니다.' : 'No quotes available.'}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {quotes.map(q => (
          <div key={q.id} style={{
            background: C.card, borderRadius: 8, padding: '10px 12px',
            border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: C.text }}>{q.factoryName}</p>
              <p style={{ margin: 0, fontSize: 12, color: C.textMuted }}>
                {q.estimatedAmount.toLocaleString('ko-KR')}원
                {q.estimatedDays ? ` · ${q.estimatedDays}${isKo ? '일' : 'd'}` : ''}
                {q.note ? ` · ${q.note}` : ''}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => void handleAction(q.id, 'accept')}
                disabled={actingId === q.id}
                style={{
                  padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 800,
                  border: 'none', background: C.green, color: '#fff',
                  cursor: actingId === q.id ? 'wait' : 'pointer', opacity: actingId === q.id ? 0.6 : 1,
                }}
              >
                {actingId === q.id ? '...' : (isKo ? '✓ 수락' : '✓ Accept')}
              </button>
              <button
                onClick={() => void handleAction(q.id, 'reject')}
                disabled={!!actingId}
                style={{
                  padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                  border: `1px solid ${C.red}55`, background: 'transparent', color: C.red,
                  cursor: actingId ? 'not-allowed' : 'pointer', opacity: actingId ? 0.5 : 1,
                }}
              >
                {isKo ? '✕ 거절' : '✕ Decline'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LoadingState({ isKo }: { isKo: boolean }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 0', color: C.textMuted }}>
      <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>⏳</div>
      <p style={{ margin: 0 }}>{isKo ? '불러오는 중...' : 'Loading...'}</p>
    </div>
  );
}

function ErrorState({ message, isKo, onRetry }: { message: string; isKo: boolean; onRetry: () => void }) {
  return (
    <div style={{
      textAlign: 'center', padding: '60px 0', color: C.red,
      background: '#f8514912', borderRadius: 12, border: `1px solid ${C.red}30`,
    }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
      <p style={{ margin: '0 0 12px' }}>
        {message === 'LOAD_FAILED' ? (isKo ? '데이터를 불러오지 못했습니다.' : 'Failed to load RFQs.') : message}
      </p>
      <button
        onClick={onRetry}
        style={{
          padding: '6px 16px', borderRadius: 7, fontSize: 12, cursor: 'pointer',
          border: `1px solid ${C.red}`, background: 'transparent', color: C.red,
        }}
      >
        {isKo ? '다시 시도' : 'Retry'}
      </button>
    </div>
  );
}

function EmptyState({
  isKo, lang, router, hasFilter,
}: {
  isKo: boolean;
  lang: string;
  router: ReturnType<typeof useRouter>;
  hasFilter: boolean;
}) {
  if (hasFilter) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: C.textMuted }}>
        <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.4 }}>🔍</div>
        <p style={{ margin: 0, fontSize: 14 }}>
          {isKo ? '해당 상태의 견적 요청이 없습니다.' : 'No RFQs match the selected filter.'}
        </p>
      </div>
    );
  }
  return (
    <div style={{ textAlign: 'center', padding: '80px 0' }}>
      <div style={{ fontSize: 52, marginBottom: 16, opacity: 0.5 }}>📋</div>
      <h2 style={{ margin: '0 0 10px', fontSize: 18, color: C.text }}>
        {isKo ? '아직 견적 요청이 없습니다' : 'No quote requests yet'}
      </h2>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: C.textMuted }}>
        {isKo
          ? '형상 생성기에서 형상을 설계한 뒤 견적을 요청하세요.'
          : 'Design a shape in the shape generator and submit an RFQ.'}
      </p>
      <button
        onClick={() => router.push(`/${lang}/shape-generator`)}
        style={{
          padding: '10px 26px', borderRadius: 8, border: 'none',
          background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
          color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
        }}
      >
        {isKo ? '형상 생성기로 이동' : 'Go to Shape Generator'}
      </button>
    </div>
  );
}

// ─── RFQ Card ─────────────────────────────────────────────────────────────────

interface RFQCardProps {
  rfq: RFQEntry;
  isKo: boolean;
  expanded: boolean;
  onToggle: () => void;
  onCompare?: () => void;
  onCancel: (rfq: RFQEntry) => void;
  isCancelling: boolean;
  onAccept: (rfqId: string, amount: number, factoryName: string) => void;
  /** 데모 RFQ는 CAD 파일 API가 없어 패널 숨김 */
  showCadFiles?: boolean;
}

function RFQCard({ rfq, isKo, expanded, onToggle, onCompare, onCancel, isCancelling, onAccept, showCadFiles = true }: RFQCardProps) {
  const meta = STATUS_META[rfq.status];
  const date = new Date(rfq.createdAt).toLocaleDateString(isKo ? 'ko-KR' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
  const bestEst = rfq.costEstimates?.[0];
  const canCancel = rfq.status === 'pending' || rfq.status === 'assigned';

  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${expanded ? C.accent : C.border}`,
      borderRadius: 12, overflow: 'hidden', transition: 'border-color 0.15s',
    }}>
      {/* Card header */}
      <button
        onClick={onToggle}
        style={{
          width: '100%', background: 'none', border: 'none',
          padding: '16px 20px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', color: C.text,
        }}
      >
        <div style={{
          width: 42, height: 42, borderRadius: 10, background: C.card,
          border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 20, flexShrink: 0,
        }}>
          🧊
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 14, color: C.text }}>
            {rfq.shapeName || (isKo ? '부품명 미입력' : 'Unnamed part')}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: C.textMuted }}>
            {isKo ? '소재: ' : 'Material: '}{rfq.materialId}
            {' · '}
            {isKo ? '수량: ' : 'Qty: '}{rfq.quantity.toLocaleString()}
            {rfq.volume_cm3 > 0 && ` · ${rfq.volume_cm3.toFixed(1)} cm³`}
            {rfq.deadline && ` · ${isKo ? '납기: ' : 'Deadline: '}${rfq.deadline}`}
          </p>
        </div>
        {bestEst && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: C.accent }}>
              ${(bestEst.unitCost * rfq.quantity).toLocaleString()}
            </p>
            <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>
              {isKo ? '예상 금액' : 'Est. total'}
            </p>
          </div>
        )}
        <div style={{
          padding: '4px 10px', borderRadius: 20, background: meta.bg, color: meta.color,
          fontSize: 11, fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap',
        }}>
          {isKo ? meta.labelKo : meta.labelEn}
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, flexShrink: 0 }}>{date}</div>
        <div style={{
          fontSize: 10, color: C.textMuted, flexShrink: 0,
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s',
        }}>▼</div>
      </button>

      {/* 진행 단계 미니 바 — 항상 표시 */}
      {rfq.status !== 'rejected' && (
        <div style={{ height: 3, background: C.border, position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', left: 0, top: 0, height: '100%',
            width: `${Math.min(100, ((STATUS_ORDER[rfq.status] ?? 0) / (TIMELINE_STEPS.length - 1)) * 100)}%`,
            background: rfq.status === 'accepted' ? C.green : C.accent,
            transition: 'width 0.4s ease',
          }} />
        </div>
      )}
      {rfq.status === 'rejected' && (
        <div style={{ height: 3, background: `${C.red}66` }} />
      )}

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          borderTop: `1px solid ${C.border}`, padding: '16px 20px',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          <RFQTimeline rfq={rfq} isKo={isKo} />

          {showCadFiles && (
            <div>
              <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: C.textDim }}>
                {isKo ? 'CAD 파일 (버전 관리)' : 'CAD files (version history)'}
              </p>
              <RfqCadFilesPanel rfqId={rfq.rfqId} isKo={isKo} compact />
            </div>
          )}

          {rfq.costEstimates && rfq.costEstimates.length > 0 && (
            <div>
              <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: C.textDim }}>
                {isKo ? '공정별 예상 비용' : 'Cost Estimates by Process'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {rfq.costEstimates.map((est, i) => {
                  const pLabel = PROCESS_LABELS[est.process];
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: C.card, borderRadius: 8, padding: '8px 12px',
                    }}>
                      <span style={{ fontSize: 12, color: C.text, flex: 1 }}>
                        {pLabel ? (isKo ? pLabel.ko : pLabel.en) : est.process}
                      </span>
                      <span style={{ fontSize: 12, color: C.textMuted }}>
                        ${est.unitCost.toFixed(2)}{isKo ? '/개' : '/unit'}
                      </span>
                      <span style={{ fontSize: 12, color: C.textMuted }}>{est.leadTime}</span>
                      <ConfidenceBadge confidence={est.confidence} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {rfq.status === 'quoted' && (
            <QuoteAcceptSection
              rfqId={rfq.rfqId}
              isKo={isKo}
              onAccepted={(amount, factoryName) => onAccept(rfq.rfqId, amount, factoryName)}
            />
          )}

          {rfq.status === 'assigned' && rfq.assignedFactoryName && (
            <div style={{
              background: '#a78bfa15', border: '1px solid #a78bfa30', borderRadius: 8, padding: '10px 14px',
            }}>
              <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: '#a78bfa' }}>
                {isKo ? '담당 제조사' : 'Assigned Manufacturer'}
              </p>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: C.text }}>
                {rfq.assignedFactoryName}
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: C.textMuted }}>
                {isKo
                  ? '제조사가 배정됐습니다. 견적서 작성 중입니다.'
                  : 'A manufacturer has been assigned and is preparing your quote.'}
              </p>
            </div>
          )}

          {rfq.quoteAmount !== undefined && (
            <div style={{
              background: '#3fb95015', border: '1px solid #3fb95030', borderRadius: 8, padding: '10px 14px',
            }}>
              <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: C.green }}>
                {isKo ? '제조사 견적가' : 'Manufacturer Quote'}
              </p>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.text }}>
                ${rfq.quoteAmount.toLocaleString()}
              </p>
            </div>
          )}

          {rfq.manufacturerNote && (
            <div style={{ background: C.card, borderRadius: 8, padding: '10px 14px' }}>
              <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: C.textMuted }}>
                {isKo ? '제조사 메모' : 'Manufacturer Note'}
              </p>
              <p style={{ margin: 0, fontSize: 13, color: C.text }}>{rfq.manufacturerNote}</p>
            </div>
          )}

          {rfq.note && (
            <div>
              <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: C.textMuted }}>
                {isKo ? '요청 메모' : 'Request Note'}
              </p>
              <p style={{ margin: 0, fontSize: 13, color: C.text }}>{rfq.note}</p>
            </div>
          )}

          <div style={{
            borderTop: `1px solid ${C.border}`, paddingTop: 10,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
          }}>
            <span style={{ fontSize: 10, color: C.textMuted, fontFamily: 'monospace' }}>
              RFQ #{rfq.rfqId.slice(0, 8).toUpperCase()}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {canCancel && (
                <button
                  onClick={e => { e.stopPropagation(); onCancel(rfq); }}
                  disabled={isCancelling}
                  style={{
                    padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    border: `1px solid ${C.red}55`, background: 'transparent',
                    color: isCancelling ? C.textMuted : C.red,
                    cursor: isCancelling ? 'not-allowed' : 'pointer',
                    opacity: isCancelling ? 0.5 : 1,
                  }}
                >
                  {isCancelling ? '...' : (isKo ? '요청 취소' : 'Cancel RFQ')}
                </button>
              )}
              {(rfq.status === 'quoted' || rfq.status === 'accepted') && onCompare && (
                <button
                  onClick={e => { e.stopPropagation(); onCompare(); }}
                  style={{
                    padding: '4px 12px', borderRadius: 6,
                    border: `1px solid ${C.accent}`,
                    background: `${C.accent}15`, color: C.accent,
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = C.accent; e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = `${C.accent}15`; e.currentTarget.style.color = C.accent; }}
                >
                  {isKo ? '견적 비교' : 'Compare Quotes'}
                </button>
              )}
              <span style={{ fontSize: 10, color: C.textMuted }}>
                {isKo ? '응답 예정: 24-48시간' : 'Est. response: 24-48h'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Quote Compare Modal ──────────────────────────────────────────────────────

interface QuoteForRFQ {
  id: string;
  factoryName: string;
  estimatedAmount: number;
  estimatedDays: number | null;
  note: string | null;
  validUntil: string | null;
}

function QuoteCompareModal({
  rfqId, rfqName, isKo, onClose,
}: {
  rfqId: string; rfqName: string; isKo: boolean; onClose: () => void;
}) {
  const [quotes, setQuotes] = useState<QuoteForRFQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [showNegotiator, setShowNegotiator] = useState(false);

  useEffect(() => {
    fetch(`/api/nexyfab/rfq/${rfqId}/quotes`)
      .then(r => r.json())
      .then((d: { quotes?: QuoteForRFQ[] }) => { setQuotes(d.quotes ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [rfqId]);

  const min = quotes.reduce((m, q) => q.estimatedAmount < m ? q.estimatedAmount : m, Infinity);
  const max = quotes.reduce((m, q) => q.estimatedAmount > m ? q.estimatedAmount : m, 0);

  return (
    <>
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, padding: 20,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`,
        width: '100%', maxWidth: 'min(calc(100vw - 32px), 680px)', maxHeight: '85vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.text }}>
              {isKo ? '견적 비교' : 'Quote Comparison'}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: C.textMuted }}>{rfqName}</p>
          </div>
          {quotes.length > 1 && (
            <button
              onClick={() => setShowNegotiator(true)}
              style={{
                padding: '5px 12px', borderRadius: 7, border: `1px solid ${C.accent}`,
                background: `${C.accent}15`, color: C.accent,
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}
            >
              ⚖️ {isKo ? 'AI 협상' : 'AI Negotiate'}
            </button>
          )}
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
          >✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: C.textMuted, padding: '40px 0' }}>
              {isKo ? '불러오는 중...' : 'Loading...'}
            </p>
          ) : quotes.length === 0 ? (
            <p style={{ textAlign: 'center', color: C.textMuted, padding: '40px 0' }}>
              {isKo ? '아직 수신된 견적이 없습니다' : 'No quotes received yet'}
            </p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                {[
                  { label: isKo ? '총 견적 수' : 'Quotes',   value: quotes.length.toString(), color: C.accent },
                  { label: isKo ? '최저가' : 'Lowest',        value: `$${min.toLocaleString()}`, color: C.green },
                  { label: isKo ? '최고가' : 'Highest',       value: `$${max.toLocaleString()}`, color: C.red },
                  { label: isKo ? '차이' : 'Spread',          value: `$${(max - min).toLocaleString()}`, color: C.yellow },
                ].map((s, i) => (
                  <div key={i} style={{
                    flex: 1, background: C.card, borderRadius: 8, padding: '8px 10px', textAlign: 'center',
                    border: `1px solid ${C.border}`,
                  }}>
                    <p style={{ margin: '0 0 2px', fontSize: 10, color: C.textMuted }}>{s.label}</p>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: s.color }}>{s.value}</p>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {quotes.map((q, i) => {
                  const isLowest = q.estimatedAmount === min;
                  const vsMin = min > 0 ? Math.round(((q.estimatedAmount - min) / min) * 100) : 0;
                  const expired = q.validUntil ? new Date(q.validUntil) < new Date() : false;
                  const barW = max > 0 ? Math.max(8, Math.round((q.estimatedAmount / max) * 100)) : 8;

                  return (
                    <div
                      key={q.id}
                      onClick={() => setSelected(selected === q.id ? null : q.id)}
                      style={{
                        background: C.card, borderRadius: 10, padding: '12px 14px',
                        border: `1px solid ${selected === q.id ? C.accent : isLowest ? C.green + '55' : C.border}`,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, width: 18 }}>#{i + 1}</span>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.text }}>{q.factoryName}</span>
                        {isLowest && (
                          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: `${C.green}22`, color: C.green, fontWeight: 700 }}>
                            {isKo ? '최저가' : 'BEST'}
                          </span>
                        )}
                        {expired && (
                          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: `${C.red}22`, color: C.red, fontWeight: 700 }}>
                            {isKo ? '만료' : 'EXPIRED'}
                          </span>
                        )}
                        <span style={{ fontSize: 16, fontWeight: 800, color: isLowest ? C.green : C.text }}>
                          ${q.estimatedAmount.toLocaleString()}
                        </span>
                      </div>
                      <div style={{ height: 5, background: '#0d1117', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
                        <div style={{
                          width: `${barW}%`, height: '100%', borderRadius: 3,
                          background: isLowest ? C.green : C.accent,
                        }} />
                      </div>
                      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: C.textMuted }}>
                        {!isLowest && vsMin > 0 && <span style={{ color: C.yellow }}>+{vsMin}% {isKo ? '대비 최저가' : 'vs lowest'}</span>}
                        {q.estimatedDays && <span>⏱ {q.estimatedDays}{isKo ? '일' : 'd'}</span>}
                        {q.validUntil && (
                          <span>📅 {new Date(q.validUntil).toLocaleDateString(isKo ? 'ko-KR' : 'en-US', { month: 'short', day: 'numeric' })}</span>
                        )}
                      </div>
                      {selected === q.id && q.note && (
                        <div style={{
                          marginTop: 8, padding: '8px 10px', borderRadius: 6,
                          background: '#0d1117', border: `1px solid ${C.border}`,
                          fontSize: 12, color: C.textMuted, lineHeight: 1.5,
                        }}>
                          {q.note}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>

    {showNegotiator && (
      <QuoteNegotiatorPanel
        rfq={{ rfqId, projectName: rfqName }}
        quotes={quotes.map(q => ({
          id: q.id,
          factoryName: q.factoryName,
          estimatedAmount: q.estimatedAmount,
          estimatedDays: q.estimatedDays,
          note: q.note,
          validUntil: q.validUntil,
        }))}
        isKo={isKo}
        onClose={() => setShowNegotiator(false)}
      />
    )}
    </>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const colorMap: Record<string, string> = { high: '#3fb950', medium: '#d29922', low: '#f85149' };
  const color = colorMap[confidence.toLowerCase()] ?? '#8b949e';
  return (
    <span style={{
      fontSize: 10, padding: '2px 6px', borderRadius: 4,
      background: `${color}20`, color, fontWeight: 700,
    }}>
      {confidence.toUpperCase()}
    </span>
  );
}
