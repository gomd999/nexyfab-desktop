'use client';

// Q6/Q7 — Public partner onboarding page.
//
// Lands here from a magic link the operator sent via KakaoTalk/email.
// One-page form: pre-filled name/company/email, partner enters
// 사업자 등록 번호 + 담당자 번호 + password, accepts agreement, done.
//
// Required fields per partner agreement v1.0:
//   - 사업자 등록 번호 (Korean business registration number, 10 digits, validated)
//   - 담당자 번호 (contact phone)
//   - 회사명
//   - 비밀번호 (≥10 chars)
//   - 약관 동의 (checkbox + link to full agreement)

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { usePartnerLang } from '../_lib/partnerLang';
import { onboardDict } from '../_lib/dicts/onboard';

interface Prefill {
  email: string | null;
  name: string | null;
  company: string | null;
  phone: string | null;
  bizRegNo: string | null;
}

const AGREEMENT_VERSION = 'v1.0';

function PartnerOnboardInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params?.get('invite') ?? '';
  const lang = usePartnerLang();
  const t = onboardDict(lang);

  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // Form state
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [bizRegNo, setBizRegNo] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [showAgreement, setShowAgreement] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setLoadErr(t.noToken); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/partner/onboard?token=${encodeURIComponent(token)}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json() as { invite: { prefill: Prefill } };
        if (cancelled) return;
        setPrefill(data.invite.prefill);
        setEmail(data.invite.prefill.email ?? '');
        setName(data.invite.prefill.name ?? '');
        setCompany(data.invite.prefill.company ?? '');
        setPhone(data.invite.prefill.phone ?? '');
        setBizRegNo(data.invite.prefill.bizRegNo ?? '');
      } catch (e) {
        if (!cancelled) setLoadErr((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [token, t]);

  const submit = async () => {
    if (submitting) return;
    if (!agreed) { setSubmitErr(t.needAgree); return; }
    if (password.length < 10) { setSubmitErr(t.pwTooShort); return; }
    setSubmitting(true); setSubmitErr(null);
    try {
      const res = await fetch('/api/partner/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token, email, name, company, phone, bizRegNo, password,
          agreementVersion: AGREEMENT_VERSION,
          agreementAccepted: true,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { redirectTo: string };
      router.push(data.redirectTo);
    } catch (e) {
      setSubmitErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadErr) {
    return (
      <main style={page}>
        <h1 style={title}>{t.headerError}</h1>
        <div style={errBox}>❌ {loadErr}</div>
        <p style={muted}>{t.contactOps}: <a href="mailto:nexyfab@nexysys.com" style={link}>nexyfab@nexysys.com</a></p>
      </main>
    );
  }
  if (!prefill) return <main style={page}><div style={muted}>{t.loading}</div></main>;

  return (
    <main style={page}>
      <h1 style={title}>{t.title}</h1>
      <p style={subtitle}>{t.subtitle}</p>

      <div style={card}>
        <Field label={t.email}>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required style={input} />
        </Field>
        <Field label={t.contactName}>
          <input value={name} onChange={e => setName(e.target.value)} required style={input} />
        </Field>
        <Field label={t.company}>
          <input value={company} onChange={e => setCompany(e.target.value)} required style={input} />
        </Field>
        <Field label={t.phone}>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="010-1234-5678"
            required style={input}
          />
        </Field>
        <Field label={t.bizRegNo}>
          <input
            value={bizRegNo}
            onChange={e => setBizRegNo(e.target.value)}
            placeholder="123-45-67890"
            required style={input}
          />
          <div style={hintStyle}>{t.bizRegHint}</div>
        </Field>
        <Field label={t.password}>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required style={input} />
        </Field>

        <div style={agreementBlock}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
            <span style={{ fontSize: 13, color: '#374151' }}>
              <strong>NexyFab Partner Agreement v1.0</strong>{t.agreeText}{' '}
              <button type="button" onClick={() => setShowAgreement(s => !s)} style={agreementToggleBtn}>
                {showAgreement ? t.agreeHide : t.agreeShow}
              </button>
            </span>
          </label>
          <div style={agreementBulletList}>
            <div>• <strong>{t.rule1Title}</strong>: {t.rule1Body}</div>
            <div>• <strong>{t.rule2Title}</strong>: {t.rule2Body}</div>
            <div>• <strong>{t.rule3Title}</strong>: {t.rule3Body}</div>
            <div>• <strong>{t.rule4Title}</strong>: {t.rule4Body}</div>
          </div>
          {showAgreement && (
            <div style={agreementFullBlock}>
              <a href="/legal/partner-agreement" target="_blank" rel="noreferrer" style={link}>
                {t.fullAgreement}
              </a>
            </div>
          )}
        </div>

        {submitErr && <div style={errBox}>{submitErr}</div>}

        <button onClick={submit} disabled={submitting || !agreed} style={submitBtn(submitting || !agreed)}>
          {submitting ? t.submitting : t.submit}
        </button>

        <p style={footerNote}>
          {t.footer} {t.inquiry}: <a href="mailto:nexyfab@nexysys.com" style={link}>nexyfab@nexysys.com</a>
        </p>
      </div>
    </main>
  );
}

export default function Page() {
  return <Suspense fallback={<div style={muted}>…</div>}><PartnerOnboardInner /></Suspense>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  );
}

const page: React.CSSProperties = {
  maxWidth: 540, margin: '0 auto', padding: '40px 20px',
  fontFamily: 'system-ui, sans-serif', color: '#1f2937',
};
const title: React.CSSProperties = { fontSize: 24, fontWeight: 800, marginBottom: 4 };
const subtitle: React.CSSProperties = { color: '#6b7280', margin: '0 0 24px' };
const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
  padding: 20, display: 'flex', flexDirection: 'column', gap: 14,
};
const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#374151' };
const input: React.CSSProperties = {
  padding: '8px 10px', fontSize: 13,
  border: '1px solid #d1d5db', borderRadius: 6,
  outline: 'none', fontFamily: 'inherit',
};
const hintStyle: React.CSSProperties = { fontSize: 11, color: '#9ca3af', marginTop: 2 };
const agreementBlock: React.CSSProperties = {
  marginTop: 8, padding: 12,
  background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8,
};
const agreementToggleBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: '#3b82f6',
  fontSize: 12, cursor: 'pointer', textDecoration: 'underline', padding: 0,
};
const agreementBulletList: React.CSSProperties = {
  marginTop: 8, fontSize: 11, color: '#475569', lineHeight: 1.7,
};
const agreementFullBlock: React.CSSProperties = {
  marginTop: 8, padding: 8, background: '#fff',
  border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12,
};
const submitBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '10px 16px', fontSize: 14, fontWeight: 700,
  background: disabled ? '#9ca3af' : '#3b82f6',
  color: '#fff', border: 'none', borderRadius: 8,
  cursor: disabled ? 'not-allowed' : 'pointer',
});
const footerNote: React.CSSProperties = {
  marginTop: 4, fontSize: 11, color: '#6b7280', textAlign: 'center',
};
const muted: React.CSSProperties = { padding: 40, textAlign: 'center', color: '#6b7280' };
const errBox: React.CSSProperties = {
  padding: 10, fontSize: 12, color: '#dc2626',
  background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6,
};
const link: React.CSSProperties = { color: '#3b82f6', textDecoration: 'underline' };
