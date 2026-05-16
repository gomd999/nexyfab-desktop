'use client';

// Preference-center unsubscribe page. Reached from an email-link
// (?token=...&cat=...) or from Settings → "Email preferences". Token path
// auto-unsubs the named category; Settings path lets the user toggle each
// category individually.

import { use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { isKorean } from '@/lib/i18n/normalize';

type Cat = 'transactional' | 'billing' | 'product_updates' | 'marketing' | 'collab';

const CATEGORY_LABELS: Record<Cat, { ko: string; en: string; desc: { ko: string; en: string }; lock?: boolean }> = {
  transactional: {
    ko: '거래 안내', en: 'Transactional',
    desc: {
      ko: '인보이스, 비밀번호 재설정 등 — 법적으로 발송이 필요합니다.',
      en: 'Receipts, password resets — legally required, cannot be turned off.',
    },
    lock: true,
  },
  billing: {
    ko: '결제 알림', en: 'Billing',
    desc: { ko: '결제 실패, 카드 만료, 환불 처리 결과', en: 'Failed payments, card expiry, refund updates' },
  },
  product_updates: {
    ko: '제품 업데이트', en: 'Product updates',
    desc: { ko: '새 기능, 개선 사항, 릴리스 노트', en: 'New features, improvements, release notes' },
  },
  marketing: {
    ko: '마케팅 / 프로모션', en: 'Marketing',
    desc: { ko: '할인, 이벤트, 케이스 스터디', en: 'Discounts, events, case studies' },
  },
  collab: {
    ko: '협업 알림', en: 'Collaboration',
    desc: { ko: '코멘트, 멘션, 공유 받은 프로젝트', en: 'Comments, mentions, shared projects' },
  },
};

export default function UnsubscribePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const isKo = isKorean(lang);
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') ?? null;
  const initialCat = (searchParams?.get('cat') ?? null) as Cat | null;

  const [prefs, setPrefs] = useState<Record<Cat, boolean>>({
    transactional: true, billing: true, product_updates: true, marketing: false, collab: true,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Token + cat path: auto-unsubscribe + show the rest of the preference center.
    if (token && initialCat) {
      void (async () => {
        try {
          const res = await fetch('/api/nexyfab/email-preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, unsubscribe: initialCat }),
          });
          if (res.ok) {
            setPrefs(prev => ({ ...prev, [initialCat]: false }));
            setDone(isKo ? `${CATEGORY_LABELS[initialCat].ko} 메일 수신을 해제했습니다.` : `Unsubscribed from ${CATEGORY_LABELS[initialCat].en}.`);
          } else {
            const data = await res.json().catch(() => ({}));
            setError(data.error ?? (isKo ? '처리에 실패했습니다' : 'Could not process the unsubscribe link'));
          }
        } catch {
          setError(isKo ? '네트워크 오류' : 'Network error');
        } finally {
          setLoading(false);
        }
      })();
      return;
    }

    // Logged-in path — fetch current preferences from the API.
    void fetch('/api/nexyfab/email-preferences')
      .then(r => r.ok ? r.json() : null)
      .then((data: { preferences?: Record<Cat, boolean> } | null) => {
        if (data?.preferences) setPrefs(data.preferences);
      })
      .catch(() => { /* show defaults */ })
      .finally(() => setLoading(false));
  }, [token, initialCat, isKo]);

  const togglePref = async (cat: Cat) => {
    if (CATEGORY_LABELS[cat].lock) return;
    const next = { ...prefs, [cat]: !prefs[cat] };
    setPrefs(next);
    setBusy(true);
    try {
      await fetch('/api/nexyfab/email-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { [cat]: next[cat] } }),
      });
    } catch {
      // Revert on failure.
      setPrefs(prefs);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ minHeight: '100vh', background: '#0c0f14', color: '#d8dee5', padding: '40px 24px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 8px' }}>
          {isKo ? '이메일 수신 설정' : 'Email preferences'}
        </h1>
        <p style={{ color: '#8a93a3', fontSize: 14, margin: '0 0 24px', lineHeight: 1.6 }}>
          {isKo
            ? '카테고리별로 어떤 이메일을 받을지 직접 설정하세요. 변경은 즉시 반영됩니다.'
            : 'Choose which email categories you want to receive. Changes save immediately.'}
        </p>

        {done && (
          <div style={{ padding: 12, borderRadius: 6, background: 'rgba(16, 185, 129, 0.13)', border: '1px solid #10b981', color: '#10b981', fontSize: 13, marginBottom: 20 }}>
            ✓ {done}
          </div>
        )}
        {error && (
          <div style={{ padding: 12, borderRadius: 6, background: 'rgba(239, 68, 68, 0.13)', border: '1px solid #ef4444', color: '#ef4444', fontSize: 13, marginBottom: 20 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#5b6373' }}>
            {isKo ? '불러오는 중…' : 'Loading…'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(Object.keys(CATEGORY_LABELS) as Cat[]).map(cat => {
              const meta = CATEGORY_LABELS[cat];
              return (
                <label
                  key={cat}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    padding: 16, borderRadius: 8,
                    border: '1px solid #262d38', background: '#14181f',
                    cursor: meta.lock ? 'not-allowed' : 'pointer',
                    opacity: meta.lock ? 0.6 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={prefs[cat]}
                    disabled={meta.lock || busy}
                    onChange={() => togglePref(cat)}
                    style={{ marginTop: 2, width: 18, height: 18, accentColor: '#4f8bff' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {isKo ? meta.ko : meta.en}
                      {meta.lock && (
                        <span style={{ marginLeft: 8, fontSize: 10, padding: '2px 6px', borderRadius: 3, background: '#262d38', color: '#8a93a3' }}>
                          {isKo ? '필수' : 'Required'}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#8a93a3', marginTop: 4, lineHeight: 1.5 }}>
                      {isKo ? meta.desc.ko : meta.desc.en}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}

        <p style={{ marginTop: 32, fontSize: 11, color: '#5b6373', lineHeight: 1.6 }}>
          {isKo
            ? '거래 안내 (영수증, 비밀번호 재설정 등) 는 법적으로 발송이 필요하여 끌 수 없습니다.'
            : 'Transactional emails (receipts, password resets) are legally required and cannot be disabled.'}
        </p>
      </div>
    </main>
  );
}
