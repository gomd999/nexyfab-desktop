'use client';

// OP1 — Partner-side incoming invitations.
//
// The first thing a freshly-onboarded partner sees after the magic link
// flow. Lists RFQs where the operator has marked them as a recommended
// factory and they haven't quoted yet. Each row has the spec snapshot +
// an inline quote form so the partner can respond in one click.

import React, { useCallback, useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import PartnerProBadge from '@/components/nexyfab/PartnerProBadge';
import { usePartnerLang } from '../_lib/partnerLang';
import { invitationsDict, type InvitationsDict } from '../_lib/dicts/invitations';

interface Invitation {
  rfqId: string;
  shapeName: string | null;
  materialId: string;
  quantity: number;
  volumeCm3: number;
  surfaceAreaCm2: number;
  bbox: { w: number; h: number; d: number };
  note: string | null;
  deadline: string | null;
  rfqStatus: string;
  rfqCreatedAt: number;
  conciergeStatus: string;
  conciergeLastAction: number;
}

interface InvitationsResp {
  invitations: Invitation[];
  state?: 'no_factory_linked' | string;
  hint?: string;
}

const CONCIERGE_STATUS_COLOR: Record<string, string> = {
  recommended:    '#8b949e',
  contacted:      '#d29922',
  responded:      '#79c0ff',
  quote_drafting: '#a371f7',
};

function conciergeLabel(s: string, t: InvitationsDict): string {
  const key = `status_${s}` as keyof InvitationsDict;
  const v = t[key];
  return typeof v === 'string' ? v : s;
}

function InvitationsInner() {
  const params = useSearchParams();
  const rfqHighlight = params?.get('rfq') ?? null;
  const lang = usePartnerLang();
  const t = invitationsDict(lang);

  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [stateHint, setStateHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openRfqId, setOpenRfqId] = useState<string | null>(rfqHighlight);
  const [form, setForm] = useState<Record<string, { amount: string; days: string; note: string }>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [submittedRfqs, setSubmittedRfqs] = useState<Set<string>>(new Set());

  const fetchInvitations = useCallback(async () => {
    try {
      const session = typeof window !== 'undefined' ? localStorage.getItem('partnerSession') ?? '' : '';
      if (!session) { setLoading(false); return; }
      const res = await fetch('/api/partner/invitations', {
        headers: { Authorization: `Bearer ${session}` },
      });
      if (!res.ok) return;
      const data = await res.json() as InvitationsResp;
      setInvitations(data.invitations);
      setStateHint(data.hint ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchInvitations(); }, [fetchInvitations]);

  const updateForm = (rfqId: string, key: 'amount' | 'days' | 'note', value: string) => {
    setForm(prev => ({
      ...prev,
      [rfqId]: { ...(prev[rfqId] ?? { amount: '', days: '', note: '' }), [key]: value },
    }));
  };

  const submitQuote = useCallback(async (inv: Invitation) => {
    if (submitting) return;
    const f = form[inv.rfqId] ?? { amount: '', days: '', note: '' };
    const amount = parseInt(f.amount, 10);
    const days = parseInt(f.days, 10);
    if (!Number.isFinite(amount) || amount <= 0) { setSubmitErr(t.errPrice); return; }
    if (!Number.isFinite(days) || days < 1) { setSubmitErr(t.errDays); return; }
    setSubmitting(inv.rfqId); setSubmitErr(null);
    try {
      const session = typeof window !== 'undefined' ? localStorage.getItem('partnerSession') ?? '' : '';
      const res = await fetch('/api/partner/quotes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { Authorization: `Bearer ${session}` } : {}),
        },
        body: JSON.stringify({
          rfqId: inv.rfqId,
          estimatedAmount: amount,
          estimatedDays: days,
          note: f.note || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setSubmittedRfqs(prev => new Set(prev).add(inv.rfqId));
      setOpenRfqId(null);
    } catch (e) {
      setSubmitErr((e as Error).message);
    } finally {
      setSubmitting(null);
    }
  }, [form, submitting, t.errPrice, t.errDays]);

  const LOCALE: Record<string, string> = {
    ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', cn: 'zh-CN', es: 'es-ES', ar: 'ar-SA',
  };
  const fmt = (n: number) => n.toLocaleString(LOCALE[lang] ?? 'en-US');

  return (
    <main style={pageStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={titleStyle}>{t.title}</h1>
          <p style={subtitleStyle}>{t.subtitle}</p>
        </div>
        <PartnerProBadge lang={lang} session={typeof window !== 'undefined' ? localStorage.getItem('partnerSession') ?? '' : ''} />
      </div>

      {loading && <div style={mutedStyle}>{t.loading}</div>}
      {!loading && invitations.length === 0 && (
        <div style={emptyStyle}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
          <div style={{ fontSize: 14, color: '#374151', marginBottom: 6, fontWeight: 700 }}>{t.empty}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 18 }}>{t.emptyHint}</div>
          {stateHint && (
            <div style={{
              marginTop: 8, marginBottom: 18, padding: 12, maxWidth: 500,
              marginLeft: 'auto', marginRight: 'auto',
              background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8,
              fontSize: 12, color: '#92400e', textAlign: 'left',
            }}>
              ⚠️ {stateHint}
            </div>
          )}

          <div style={{
            marginTop: 16, padding: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
            textAlign: 'left', maxWidth: 500, marginLeft: 'auto', marginRight: 'auto',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 10 }}>
              {t.guideTitle}
            </div>
            <ol style={{ fontSize: 12, color: '#374151', paddingLeft: 18, margin: 0, lineHeight: 1.7 }}>
              <li>{t.guide1}</li>
              <li>{t.guide2}</li>
              <li>{t.guide3}</li>
              <li>{t.guide4}</li>
              <li>{t.guide5}</li>
            </ol>
            <div style={{ marginTop: 10, padding: 8, background: '#fef3c7', borderRadius: 6, fontSize: 11, color: '#92400e' }}>
              {t.antiPoach}{' '}
              <Link href="/legal/partner-agreement" style={{ color: '#92400e', textDecoration: 'underline' }}>{t.viewAgreement}</Link>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {invitations.map(inv => {
          const isOpen = openRfqId === inv.rfqId;
          const isSubmitted = submittedRfqs.has(inv.rfqId);
          const statusColor = CONCIERGE_STATUS_COLOR[inv.conciergeStatus] ?? '#6b7280';
          const statusLabel = conciergeLabel(inv.conciergeStatus, t);
          const f = form[inv.rfqId] ?? { amount: '', days: '', note: '' };
          return (
            <div key={inv.rfqId} style={{
              ...cardStyle,
              borderColor: rfqHighlight === inv.rfqId ? '#3b82f6' : '#e5e7eb',
              boxShadow: rfqHighlight === inv.rfqId ? '0 0 0 2px #dbeafe' : '0 1px 2px rgba(0,0,0,0.04)',
            }}>
              <div style={cardHeaderStyle}>
                <div style={{ flex: 1 }}>
                  <div style={cardTitleStyle}>{inv.shapeName ?? `RFQ ${inv.rfqId.slice(0, 8)}`}</div>
                  <div style={cardMetaStyle}>
                    <span>{t.qty} {fmt(inv.quantity)}</span>
                    <span> · {inv.materialId}</span>
                    {inv.bbox && <span> · {inv.bbox.w}×{inv.bbox.h}×{inv.bbox.d}mm</span>}
                    {inv.deadline && <span> · {t.deadlineLabel} {inv.deadline}</span>}
                  </div>
                  {inv.note && <div style={cardNoteStyle}>📝 {inv.note}</div>}
                </div>
                <span style={{ ...chipStyle, background: `${statusColor}22`, color: statusColor }}>
                  {statusLabel}
                </span>
              </div>

              {isSubmitted ? (
                <div style={successStyle}>{t.submitted}</div>
              ) : isOpen ? (
                <div style={formStyle}>
                  <div style={formRowStyle}>
                    <label style={labelStyle}>{t.priceLabel}
                      <input
                        type="number" inputMode="numeric"
                        value={f.amount}
                        onChange={e => updateForm(inv.rfqId, 'amount', e.target.value)}
                        placeholder={t.pricePlaceholder}
                        style={inputStyle}
                      />
                    </label>
                    <label style={labelStyle}>{t.daysLabel}
                      <input
                        type="number" inputMode="numeric"
                        value={f.days}
                        onChange={e => updateForm(inv.rfqId, 'days', e.target.value)}
                        placeholder={t.daysPlaceholder}
                        style={inputStyle}
                      />
                    </label>
                  </div>
                  <label style={labelStyle}>{t.noteLabel}
                    <textarea
                      value={f.note}
                      onChange={e => updateForm(inv.rfqId, 'note', e.target.value)}
                      placeholder={t.notePlaceholder}
                      rows={2}
                      style={textareaStyle}
                    />
                  </label>
                  {submitErr && <div style={errStyle}>{submitErr}</div>}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                    <button onClick={() => setOpenRfqId(null)} style={cancelBtnStyle}>{t.cancel}</button>
                    <button
                      onClick={() => void submitQuote(inv)}
                      disabled={submitting === inv.rfqId}
                      style={submitBtnStyle}
                    >
                      {submitting === inv.rfqId ? t.submitting : t.submitQuote}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setOpenRfqId(inv.rfqId)} style={openBtnStyle}>
                  {t.openForm}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div style={footerLinkStyle}>
        <Link href={`/partner/quotes?lang=${lang}`} style={linkStyle}>{t.seeExisting}</Link>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div style={mutedStyle}>…</div>}>
      <InvitationsInner />
    </Suspense>
  );
}

const pageStyle: React.CSSProperties = {
  maxWidth: 760, margin: '0 auto', padding: '32px 20px',
  fontFamily: 'system-ui, sans-serif', color: '#1f2937',
};
const titleStyle: React.CSSProperties = { fontSize: 24, fontWeight: 800, marginBottom: 4 };
const subtitleStyle: React.CSSProperties = { color: '#6b7280', margin: '0 0 24px', fontSize: 13 };
const cardStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
  padding: 16, transition: 'all 0.15s',
};
const cardHeaderStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12,
};
const cardTitleStyle: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: '#111827' };
const cardMetaStyle: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginTop: 2 };
const cardNoteStyle: React.CSSProperties = { fontSize: 12, color: '#374151', marginTop: 6, padding: '6px 10px', background: '#f9fafb', borderRadius: 6 };
const chipStyle: React.CSSProperties = {
  padding: '3px 10px', fontSize: 11, fontWeight: 700,
  borderRadius: 12, whiteSpace: 'nowrap', flexShrink: 0,
};
const openBtnStyle: React.CSSProperties = {
  width: '100%', padding: '8px 14px', fontSize: 13, fontWeight: 700,
  background: '#3b82f6', color: '#fff',
  border: 'none', borderRadius: 6, cursor: 'pointer',
};
const formStyle: React.CSSProperties = {
  marginTop: 8, padding: 12,
  background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8,
};
const formRowStyle: React.CSSProperties = {
  // auto-fit + minmax avoids the inline-style media-query gap: at narrow
  // viewports columns wrap to single-column; at ≥320px they sit side-by-side.
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 8, marginBottom: 8,
};
const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
  fontSize: 11, fontWeight: 700, color: '#374151',
};
const inputStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: 13,
  border: '1px solid #d1d5db', borderRadius: 6, outline: 'none',
  fontFamily: 'inherit',
};
const textareaStyle: React.CSSProperties = {
  ...inputStyle, resize: 'vertical', fontFamily: 'inherit',
};
const cancelBtnStyle: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, fontWeight: 600,
  background: 'transparent', color: '#6b7280',
  border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer',
};
const submitBtnStyle: React.CSSProperties = {
  padding: '6px 16px', fontSize: 12, fontWeight: 700,
  background: '#3b82f6', color: '#fff',
  border: 'none', borderRadius: 6, cursor: 'pointer',
};
const errStyle: React.CSSProperties = {
  marginTop: 8, padding: '6px 10px', fontSize: 11, color: '#dc2626',
  background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6,
};
const successStyle: React.CSSProperties = {
  padding: 10, fontSize: 13, fontWeight: 700,
  background: '#dcfce7', color: '#166534', borderRadius: 6, textAlign: 'center',
};
const mutedStyle: React.CSSProperties = { color: '#6b7280', fontSize: 13, padding: 24, textAlign: 'center' };
const emptyStyle: React.CSSProperties = {
  padding: 40, textAlign: 'center', background: '#f9fafb', borderRadius: 10,
};
const footerLinkStyle: React.CSSProperties = { marginTop: 24, textAlign: 'center' };
const linkStyle: React.CSSProperties = { color: '#3b82f6', fontSize: 13, textDecoration: 'underline' };
