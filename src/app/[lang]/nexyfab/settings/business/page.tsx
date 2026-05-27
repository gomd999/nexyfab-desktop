'use client';

// Business profile page — 사업자 등록번호 입력 + NTS 자동 검증 + 등록증 첨부.
// Triggered from Settings → "사업자로 전환" or from a Pro 사업자 upgrade
// flow. Optimised for Korean tax/invoicing workflow but bilingual.

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { isKorean } from '@/lib/i18n/normalize';

interface BusinessProfile {
  brn?: string;
  legalName?: string;
  representativeName?: string;
  openedAt?: string;
  industryCode?: string;
  certificateUrl?: string;
  verificationStatus?: 'active' | 'closed' | 'suspended' | 'pending' | 'unknown';
}

export default function BusinessProfilePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const isKo = isKorean(lang);
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [brn, setBrn] = useState('');
  const [legalName, setLegalName] = useState('');
  const [repName, setRepName] = useState('');
  const [openedAt, setOpenedAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; status?: string } | null>(null);
  const [certFile, setCertFile] = useState<File | null>(null);

  useEffect(() => {
    void fetch('/api/nexyfab/business-profile')
      .then(r => r.json())
      .then((data: { profile: BusinessProfile | null }) => {
        if (data.profile) {
          setProfile(data.profile);
          setBrn(data.profile.brn ?? '');
          setLegalName(data.profile.legalName ?? '');
          setRepName(data.profile.representativeName ?? '');
          setOpenedAt(data.profile.openedAt ?? '');
        }
      })
      .catch(() => { /* ignore — empty form */ });
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{3}-?\d{2}-?\d{5}$/.test(brn)) {
      setResult({ ok: false, message: isKo ? '사업자등록번호 10자리 (123-45-67890)' : 'Enter a 10-digit BRN' });
      return;
    }
    if (!legalName.trim()) {
      setResult({ ok: false, message: isKo ? '법인/상호명을 입력하세요' : 'Enter legal entity name' });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const body: Record<string, string> = { brn: brn.trim(), legalName: legalName.trim() };
      if (repName.trim()) body.representativeName = repName.trim();
      if (openedAt.replace(/\D/g, '').length === 8) body.openedAt = openedAt.replace(/\D/g, '');
      const res = await fetch('/api/nexyfab/business-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ ok: true, message: data.note ?? 'Saved', status: data.verificationStatus });
        setProfile({
          brn: data.brn,
          legalName: data.legalName,
          representativeName: repName.trim() || undefined,
          openedAt: body.openedAt,
          verificationStatus: data.verificationStatus,
        });
      } else {
        setResult({ ok: false, message: data.error ?? 'Save failed' });
      }
    } catch {
      setResult({ ok: false, message: isKo ? '네트워크 오류' : 'Network error' });
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = (s?: string) => {
    if (s === 'active') return { text: isKo ? '✓ NTS 검증 완료 · 활성' : '✓ Verified · Active', color: '#10b981' };
    if (s === 'closed') return { text: isKo ? '✕ 폐업 사업자' : '✕ Closed', color: '#ef4444' };
    if (s === 'suspended') return { text: isKo ? '⚠ 휴업 상태' : '⚠ Suspended', color: '#f59e0b' };
    if (s === 'pending') return { text: isKo ? '⌛ 검증 대기' : '⌛ Pending', color: '#6b7280' };
    return null;
  };
  const status = statusLabel(profile?.verificationStatus);

  return (
    <div style={{ minHeight: '100vh', background: '#0c0f14', color: '#d8dee5', padding: 40, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <Link href={`/${lang}/nexyfab/settings`} style={{ color: '#7aa9ff', fontSize: 13, textDecoration: 'none' }}>
          ← {isKo ? '설정으로' : 'Back to Settings'}
        </Link>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginTop: 16, marginBottom: 8 }}>
          {isKo ? '사업자 정보' : 'Business Profile'}
        </h1>
        <p style={{ color: '#8a93a3', fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
          {isKo
            ? 'Pro 사업자 플랜 · 세금계산서 발행 · 제조 파트너 매칭에 사용됩니다. 사업자등록번호는 국세청 API 로 자동 검증됩니다.'
            : 'Used for Pro Business plan, tax invoicing, and manufacturer partner matching. BRN is auto-verified through the NTS API.'}
        </p>

        {status && (
          <div style={{
            padding: 12, borderRadius: 6,
            background: 'rgba(255, 255, 255, 0.04)',
            border: `1px solid ${status.color}`,
            color: status.color,
            fontSize: 13, fontWeight: 600,
            marginBottom: 24,
          }}>
            {status.text}
          </div>
        )}

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <FormRow label={isKo ? '사업자등록번호 (10자리)' : 'Business Registration Number (10 digits)'}>
            <input
              type="text"
              value={brn}
              onChange={e => setBrn(e.target.value.replace(/[^\d-]/g, '').slice(0, 12))}
              placeholder="123-45-67890"
              required
              style={inputStyle}
            />
          </FormRow>
          <FormRow label={isKo ? '법인/상호명' : 'Legal entity name'}>
            <input
              type="text"
              value={legalName}
              onChange={e => setLegalName(e.target.value)}
              placeholder={isKo ? '예: (주)Acme Robotics' : 'e.g. Acme Robotics Inc.'}
              required
              style={inputStyle}
            />
          </FormRow>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <FormRow label={isKo ? '대표자명 (선택)' : 'Representative (optional)'}>
              <input
                type="text"
                value={repName}
                onChange={e => setRepName(e.target.value)}
                placeholder={isKo ? '예: 홍길동' : 'e.g. Jane Doe'}
                style={inputStyle}
              />
            </FormRow>
            <FormRow label={isKo ? '개업일 (YYYYMMDD)' : 'Opened (YYYYMMDD)'}>
              <input
                type="text"
                value={openedAt}
                onChange={e => setOpenedAt(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="20200101"
                style={inputStyle}
              />
            </FormRow>
          </div>
          <FormRow label={isKo ? '사업자등록증 (선택)' : 'Registration certificate (optional)'}>
            <label
              htmlFor="cert-upload"
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', height: 44,
                border: `1px ${certFile ? 'solid' : 'dashed'} ${certFile ? '#4f8bff' : '#262d38'}`,
                borderRadius: 6,
                background: certFile ? 'rgba(79, 139, 255, 0.13)' : '#14181f',
                color: '#d8dee5',
                fontSize: 13, cursor: 'pointer',
              }}
            >
              <span>{certFile ? '📎' : '⬆'}</span>
              <span style={{ flex: 1, color: certFile ? '#7aa9ff' : '#8a93a3' }}>
                {certFile ? certFile.name : (isKo ? 'PDF / PNG / JPG (10MB 이하)' : 'PDF / PNG / JPG (≤ 10MB)')}
              </span>
              {certFile && (
                <button
                  type="button"
                  onClick={e => { e.preventDefault(); setCertFile(null); }}
                  style={{ background: 'transparent', border: 0, color: '#8a93a3', fontSize: 14, cursor: 'pointer' }}
                >×</button>
              )}
              <input
                id="cert-upload"
                type="file"
                accept=".pdf,image/png,image/jpeg"
                onChange={e => setCertFile(e.target.files?.[0] ?? null)}
                style={{ display: 'none' }}
              />
            </label>
            <p style={{ margin: '6px 0 0', fontSize: 11, color: '#5b6373' }}>
              {isKo
                ? 'NTS 검증 후 파트너 인증 배지 발급에 사용됩니다. 등록번호 검증으로 충분한 경우 생략 가능합니다.'
                : 'Used for partner verification badge after NTS check. Optional if BRN verification passes.'}
            </p>
          </FormRow>

          {result && (
            <div style={{
              padding: 12, borderRadius: 6,
              background: result.ok ? 'rgba(16, 185, 129, 0.13)' : 'rgba(239, 68, 68, 0.13)',
              border: `1px solid ${result.ok ? '#10b981' : '#ef4444'}`,
              color: result.ok ? '#10b981' : '#ef4444',
              fontSize: 13,
            }}>
              {result.message}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              type="submit"
              disabled={busy}
              style={{
                padding: '12px 24px', height: 44, border: 0, borderRadius: 6,
                background: busy ? '#262d38' : '#4f8bff',
                color: '#fff', fontSize: 14, fontWeight: 700,
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              {busy ? (isKo ? '검증 중…' : 'Verifying…') : (isKo ? '저장 및 NTS 검증' : 'Save & Verify with NTS')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, color: '#8a93a3', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 44, padding: '0 14px',
  border: '1px solid #262d38', borderRadius: 6,
  background: '#14181f', color: '#d8dee5',
  fontSize: 14, outline: 'none', fontFamily: 'inherit',
};
