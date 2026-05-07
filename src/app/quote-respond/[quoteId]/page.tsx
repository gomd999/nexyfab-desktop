/**
 * /quote-respond/[quoteId]?t=<token>
 *
 * 공급사가 이메일 링크에서 접근하는 공개 견적 제출 페이지. 로그인 없이 토큰 기반.
 */

'use client';

import { useEffect, useState, use } from 'react';
import { useSearchParams } from 'next/navigation';

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
  const { quoteId } = use(params);
  const searchParams = useSearchParams();
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
    if (!token) { setLoadError('유효하지 않은 링크입니다 (토큰 누락)'); return; }
    fetch(`/api/nexyfab/quote-response/${encodeURIComponent(quoteId)}?t=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          const msg = data.error === 'not_found' ? '견적을 찾을 수 없습니다'
            : data.error === 'invalid_token' ? '유효하지 않은 접근 토큰'
            : data.error || '불러오기 실패';
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
      .catch(() => setLoadError('네트워크 오류'));
  }, [quoteId, token]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const amt = Number(amount);
    const d = Number(days);
    if (!Number.isFinite(amt) || amt <= 0) { setSubmitError('견적 금액을 확인해 주세요'); return; }
    if (!Number.isFinite(d) || d < 1 || d > 365) { setSubmitError('납기는 1~365일'); return; }

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
      if (!r.ok) { setSubmitError(data.error || '제출 실패'); return; }
      setSubmitted(true);
    } catch {
      setSubmitError('네트워크 오류');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <div style={{ maxWidth: 520, margin: '64px auto', padding: 24, fontFamily: 'system-ui' }}>
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>견적 제출</h1>
        <div style={{ padding: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b' }}>
          {loadError}
        </div>
      </div>
    );
  }

  if (!info) {
    return <div style={{ maxWidth: 520, margin: '64px auto', padding: 24, fontFamily: 'system-ui', color: '#6b7280' }}>불러오는 중…</div>;
  }

  if (submitted || info.status === 'submitted' || info.status === 'accepted') {
    return (
      <div style={{ maxWidth: 520, margin: '64px auto', padding: 24, fontFamily: 'system-ui' }}>
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>견적 제출 완료</h1>
        <div style={{ padding: 20, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 10, color: '#065f46' }}>
          <p style={{ margin: '0 0 8px' }}>✓ {info.factoryName} 귀사의 견적이 전달되었습니다.</p>
          <p style={{ margin: 0, fontSize: 13, color: '#047857' }}>
            고객 검토 결과는 {info.partnerEmail ?? '등록된 이메일'} 로 알려드립니다.
          </p>
        </div>
      </div>
    );
  }

  if (info.status === 'rejected' || info.status === 'expired') {
    return (
      <div style={{ maxWidth: 520, margin: '64px auto', padding: 24, fontFamily: 'system-ui' }}>
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>마감된 견적</h1>
        <div style={{ padding: 16, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, color: '#4b5563' }}>
          이 견적 요청은 더 이상 응답을 받지 않습니다 (상태: {info.status}).
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: '40px auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px', fontWeight: 800 }}>견적 제출</h1>
      <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: 13 }}>
        NexyFab 파트너 응답 — {info.factoryName}
      </p>

      <div style={{ padding: 16, background: '#f0f4ff', border: '1px solid #c7d7fe', borderRadius: 10, marginBottom: 20, fontSize: 13 }}>
        <div><strong>부품:</strong> {info.projectName}</div>
        {info.rfq?.quantity && <div><strong>수량:</strong> {info.rfq.quantity.toLocaleString()}개</div>}
        {info.rfq?.materialId && <div><strong>소재:</strong> {info.rfq.materialId}</div>}
        {info.validUntil && <div><strong>응답 유효:</strong> {info.validUntil} 까지</div>}
      </div>

      <form onSubmit={onSubmit}>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>견적 금액 (KRW)</div>
          <input
            type="number" min={0} step={1000} required value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="예: 1250000"
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>납기 (일)</div>
          <input
            type="number" min={1} max={365} required value={days}
            onChange={(e) => setDays(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>메모 (선택)</div>
          <textarea
            value={note} onChange={(e) => setNote(e.target.value)} rows={4}
            placeholder="추가 조건, 납기 근거, 필수 사양 확인 등"
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
          {submitting ? '제출 중…' : '견적 제출'}
        </button>

        <p style={{ margin: '16px 0 0', color: '#9ca3af', fontSize: 12, textAlign: 'center' }}>
          RFQ: {info.rfqId ?? '-'} · Quote: {info.quoteId}
        </p>
      </form>
    </div>
  );
}
