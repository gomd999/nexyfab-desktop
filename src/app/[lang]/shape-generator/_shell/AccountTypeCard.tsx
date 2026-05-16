'use client';

// Onboarding account-type card — shown once after signup. Asks individual
// vs business, optional company name. Skippable. Subsequent flips happen
// in Settings. Storage gated by `nexyfab.account-type-asked.v1` so it
// never re-fires.

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/hooks/useAuth';

const STORAGE_KEY = 'nexyfab.account-type-asked.v1';

export interface AccountTypeCardProps {
  isKo: boolean;
}

export function AccountTypeCard({ isKo }: AccountTypeCardProps) {
  const user = useAuthStore(s => s.user);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'individual' | 'business' | null>(null);
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || typeof window === 'undefined') return;
    if (window.localStorage.getItem(STORAGE_KEY) === '1') return;
    // Pull current status — if onboardingCompleted on server, skip.
    void fetch('/api/nexyfab/account-type', { method: 'GET' })
      .then(r => r.ok ? r.json() : null)
      .then((data: { onboardingCompleted?: boolean } | null) => {
        if (data?.onboardingCompleted) {
          window.localStorage.setItem(STORAGE_KEY, '1');
        } else {
          // Slight delay so OnboardingTutorial fires first; this card
          // appears once the tour is dismissed (or immediately on existing
          // users who already saw the tour).
          setTimeout(() => setOpen(true), 1200);
        }
      })
      .catch(() => { /* network — show anyway */ setOpen(true); });
  }, [user]);

  const close = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, '1');
    }
    setOpen(false);
  };

  const save = async () => {
    if (!type) return;
    setBusy(true);
    try {
      await fetch('/api/nexyfab/account-type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountType: type,
          companyName: type === 'business' && company.trim() ? company.trim() : undefined,
        }),
      });
      close();
    } catch {
      // Even on failure, dismiss locally — user can flip in Settings later.
      close();
    } finally {
      setBusy(false);
    }
  };

  if (!open || !user) return null;

  return (
    <>
      <div
        onClick={close}
        aria-hidden="true"
        style={{
          position: 'fixed', inset: 0, zIndex: 8800,
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(2px)',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="nx-account-type-title"
        aria-describedby="nx-account-type-desc"
        style={{
          position: 'fixed', zIndex: 8801,
          left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(440px, 92vw)',
          background: 'var(--nx-panel)',
          border: '1px solid var(--nx-border)',
          borderRadius: 10,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          padding: 24,
          color: 'var(--nx-text)',
        }}
      >
        <h2 id="nx-account-type-title" style={{ margin: 0, fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
          {isKo ? 'NexyFab 을 어떻게 사용하시나요?' : 'How will you use NexyFab?'}
        </h2>
        <p id="nx-account-type-desc" style={{ margin: 0, fontSize: 12, color: 'var(--nx-text-2)', lineHeight: 1.5, marginBottom: 16 }}>
          {isKo
            ? '사용 환경에 맞게 기능을 최적화해 드립니다. 나중에 설정에서 언제든 변경 가능합니다.'
            : 'So we can tailor features. You can change this any time in Settings.'}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          <ChoiceCard
            active={type === 'individual'}
            title={isKo ? '개인 / 메이커' : 'Individual / Maker'}
            desc={isKo ? '개인 프로젝트, 학습, 취미' : 'Personal projects, learning, hobby'}
            icon="👤"
            onClick={() => setType('individual')}
          />
          <ChoiceCard
            active={type === 'business'}
            title={isKo ? '사업자 / 회사' : 'Business / Company'}
            desc={isKo ? '제품 개발, 양산, 견적' : 'Product dev, production, quotes'}
            icon="🏢"
          onClick={() => setType('business')}
          />
        </div>

        {type === 'business' && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: 'var(--nx-text-2)', display: 'block', marginBottom: 4 }}>
              {isKo ? '회사명 (선택)' : 'Company name (optional)'}
            </label>
            <input
              type="text"
              value={company}
              onChange={e => setCompany(e.target.value)}
              placeholder={isKo ? '예: Acme Robotics' : 'e.g. Acme Robotics'}
              style={{
                width: '100%', height: 32, padding: '0 10px',
                border: '1px solid var(--nx-border)', borderRadius: 6,
                background: 'var(--nx-bg)', color: 'var(--nx-text)',
                fontSize: 13, outline: 'none',
              }}
            />
            <p style={{ margin: '6px 0 0', fontSize: 10, color: 'var(--nx-text-3)', lineHeight: 1.5 }}>
              {isKo
                ? 'Pro 사업자 플랜 (세금계산서 발행, 제조 파트너 매칭) 가입 시 사업자등록번호를 추가로 받습니다.'
                : 'Business registration details are collected later when upgrading to the Business plan.'}
            </p>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={close}
            style={{
              padding: '8px 14px', height: 32,
              border: 0, background: 'transparent',
              color: 'var(--nx-text-3)', fontSize: 12, cursor: 'pointer',
            }}
          >
            {isKo ? '건너뛰기' : 'Skip'}
          </button>
          <span style={{ flex: 1 }} />
          <button
            onClick={save}
            disabled={!type || busy}
            style={{
              padding: '8px 18px', height: 32,
              border: 0, borderRadius: 6,
              background: !type || busy ? 'var(--nx-text-3)' : 'var(--nx-accent)',
              color: '#fff', fontSize: 12, fontWeight: 700,
              cursor: !type || busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? (isKo ? '저장…' : 'Saving…') : (isKo ? '계속' : 'Continue')}
          </button>
        </div>
      </div>
    </>
  );
}

function ChoiceCard({ active, title, desc, icon, onClick }: {
  active: boolean;
  title: string;
  desc: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
        gap: 4, padding: 14,
        border: `1px solid ${active ? 'var(--nx-accent)' : 'var(--nx-border)'}`,
        borderRadius: 6,
        background: active ? 'var(--nx-accent-soft)' : 'var(--nx-panel-2)',
        color: 'var(--nx-text)',
        cursor: 'pointer', textAlign: 'left',
      }}
    >
      <span style={{ fontSize: 20 }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
      <span style={{ fontSize: 10, color: 'var(--nx-text-2)', lineHeight: 1.4 }}>{desc}</span>
    </button>
  );
}
