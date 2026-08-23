/**
 * /quote-respond/[quoteId]?t=<token>
 *
 * 공급사가 이메일 링크에서 접근하는 공개 견적 제출 페이지. 로그인 없이 토큰 기반.
 */

'use client';

import { Suspense, useEffect, useState, use, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useClientLocale } from '@/lib/i18n/clientLocale';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

interface QuoteInfo {
  quoteId: string;
  rfqId: string | null;
  projectName: string;
  factoryName: string;
  validUntil: string | null;
  status: string;
  partnerEmail: string | null;
  existing: { estimatedAmount: number; estimatedDays: number | null; note: string | null } | null;
  rfq: { shapeName: string | null; quantity: number; materialId: string | null } | null;
}

export default function QuoteRespondPage({ params }: { params: Promise<{ quoteId: string }> }) {
  return (
    <Suspense fallback={null}>
      <QuoteRespondContent params={params} />
    </Suspense>
  );
}

function QuoteRespondContent({ params }: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = use(params);
  const searchParams = useSearchParams();
  const lang = useClientLocale();
  const L = useMemo(() => createCommercialLocalizer(lang), [lang]);
  const token = searchParams?.get('t') ?? '';

  const [info, setInfo] = useState<QuoteInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('14');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setLoadError(L('유효하지 않은 링크입니다 (토큰 누락)', 'This link is invalid (missing token).')); return; }
    fetch(`/api/nexyfab/quote-response/${encodeURIComponent(quoteId)}?t=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          const msg = data.error === 'not_found' ? L('견적을 찾을 수 없습니다', 'Quote not found.')
            : data.error === 'invalid_token' ? L('유효하지 않은 접근 토큰', 'Invalid access token.')
            : data.error || L('불러오기 실패', 'Failed to load.');
          setLoadError(msg);
          return;
        }
        const data = (await r.json()) as QuoteInfo;
        setInfo(data);
        if (data.existing) {
          setAmount(String(data.existing.estimatedAmount));
          setDays(String(data.existing.estimatedDays ?? 14));
          setNote(data.existing.note ?? '');
        }
      })
      .catch(() => setLoadError(L('네트워크 오류', 'Network error.')));
  }, [quoteId, token, L]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const amt = Number(amount);
    const d = Number(days);
    if (!Number.isFinite(amt) || amt <= 0) { setSubmitError(L('견적 금액을 확인해 주세요', 'Please check the quote amount.')); return; }
    if (!Number.isFinite(d) || d < 1 || d > 365) { setSubmitError(L('납기는 1~365일', 'Lead time must be 1–365 days.')); return; }

    setSubmitting(true);
    try {
      const r = await fetch(
        `/api/nexyfab/quote-response/${encodeURIComponent(quoteId)}?t=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ estimatedAmount: amt, estimatedDays: d, note }),
        },
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setSubmitError(data.error || L('제출 실패', 'Submission failed.')); return; }
      setSubmitted(true);
    } catch {
      setSubmitError(L('네트워크 오류', 'Network error.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <div style={{ maxWidth: 520, margin: '64px auto', padding: 24, fontFamily: 'system-ui' }}>
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>{L('견적 제출', 'Submit quote')}</h1>
        <div style={{ padding: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b' }}>
          {loadError}
        </div>
      </div>
    );
  }

  if (!info) {
    return <div style={{ maxWidth: 520, margin: '64px auto', padding: 24, fontFamily: 'system-ui', color: '#6b7280' }}>{L('불러오는 중…', 'Loading…')}</div>;
  }

  if (submitted || info.status === 'submitted' || info.status === 'accepted') {
    return (
      <div style={{ maxWidth: 520, margin: '64px auto', padding: 24, fontFamily: 'system-ui' }}>
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>{L('견적 제출 완료', 'Quote submitted')}</h1>
        <div style={{ padding: 20, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 10, color: '#065f46' }}>
          <p style={{ margin: '0 0 8px' }}>✓ {info.factoryName} {L('귀사의 견적이 전달되었습니다.', 'Your quote has been delivered.')}</p>
          <p style={{ margin: 0, fontSize: 13, color: '#047857' }}>
            {L('고객 검토 결과는', 'The customer review result will be sent to')} {info.partnerEmail ?? L('등록된 이메일', 'the registered email')}.
          </p>
        </div>
      </div>
    );
  }

  if (info.status === 'rejected' || info.status === 'expired') {
    return (
      <div style={{ maxWidth: 520, margin: '64px auto', padding: 24, fontFamily: 'system-ui' }}>
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>{L('마감된 견적', 'Closed quote')}</h1>
        <div style={{ padding: 16, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, color: '#4b5563' }}>
          {L('이 견적 요청은 더 이상 응답을 받지 않습니다', 'This quote request no longer accepts responses')} ({L('상태', 'status')}: {info.status}).
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: '40px auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px', fontWeight: 800 }}>{L('견적 제출', 'Submit quote')}</h1>
      <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: 13 }}>
        {L('NexyFab 파트너 응답', 'NexyFab partner response')} — {info.factoryName}
      </p>

      <div style={{ padding: 16, background: '#f0f4ff', border: '1px solid #c7d7fe', borderRadius: 10, marginBottom: 20, fontSize: 13 }}>
        <div><strong>{L('부품:', 'Part:')}</strong> {info.projectName}</div>
        {info.rfq?.quantity && <div><strong>{L('수량:', 'Quantity:')}</strong> {info.rfq.quantity.toLocaleString()} {L('개', 'pcs')}</div>}
        {info.rfq?.materialId && <div><strong>{L('소재:', 'Material:')}</strong> {info.rfq.materialId}</div>}
        {info.validUntil && <div><strong>{L('응답 유효:', 'Valid until:')}</strong> {info.validUntil}</div>}
      </div>

      <form onSubmit={onSubmit}>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{L('견적 금액 (KRW)', 'Quote amount (KRW)')}</div>
          <input
            type="number" min={0} step={1000} required value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={L('예: 1250000', 'e.g. 1250000')}
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{L('납기 (일)', 'Lead time (days)')}</div>
          <input
            type="number" min={1} max={365} required value={days}
            onChange={(e) => setDays(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{L('메모 (선택)', 'Note (optional)')}</div>
          <textarea
            value={note} onChange={(e) => setNote(e.target.value)} rows={4}
            placeholder={L('추가 조건, 납기 근거, 필수 사양 확인 등', 'Additional conditions, lead-time notes, required specifications, etc.')}
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </label>

        {submitError && (
          <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, color: '#991b1b', fontSize: 13, marginBottom: 12 }}>
            {submitError}
          </div>
        )}

        <button
          type="submit" disabled={submitting}
          style={{
            width: '100%', padding: 13, background: submitting ? '#9ca3af' : '#2563eb',
            color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700,
            cursor: submitting ? 'default' : 'pointer',
          }}
        >
          {submitting ? L('제출 중…', 'Submitting…') : L('견적 제출', 'Submit quote')}
        </button>

        <p style={{ margin: '16px 0 0', color: '#9ca3af', fontSize: 12, textAlign: 'center' }}>
          RFQ: {info.rfqId ?? '-'} · Quote: {info.quoteId}
        </p>
      </form>
    </div>
  );
}
