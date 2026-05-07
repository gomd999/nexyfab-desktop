'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { isKorean } from '@/lib/i18n/normalize';

interface OnboardingChecklistProps {
  lang: string;
  projects: { id: string }[];
  rfqCount?: number;
  user: { plan: string } | null;
  onDismiss: () => void;
}

interface ChecklistItem {
  labelKo: string;
  labelEn: string;
  href: string;
  done: boolean;
}

export default function OnboardingChecklist({
  lang,
  projects,
  rfqCount = 0,
  user,
  onDismiss,
}: OnboardingChecklistProps) {
  const isKo = isKorean(lang);
  const [visitedMarketplace, setVisitedMarketplace] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setVisitedMarketplace(!!localStorage.getItem('nf_visited_marketplace'));
    }
  }, []);

  const items: ChecklistItem[] = [
    {
      labelKo: '첫 3D 프로젝트 만들기',
      labelEn: 'Create your first 3D project',
      href: `/${lang}/shape-generator`,
      done: projects.length > 0,
    },
    {
      labelKo: 'RFQ 견적 요청 보내기',
      labelEn: 'Send your first RFQ',
      href: `/${lang}/nexyfab/rfq`,
      done: rfqCount > 0,
    },
    {
      labelKo: '제조사 둘러보기',
      labelEn: 'Explore manufacturers',
      href: `/${lang}/nexyfab/marketplace`,
      done: visitedMarketplace,
    },
    {
      labelKo: 'Pro 플랜 알아보기',
      labelEn: 'Learn about Pro plan',
      href: `/${lang}/nexyfab/pricing`,
      done: user != null && user.plan !== 'free',
    },
  ];

  const doneCount = items.filter((i) => i.done).length;
  const allDone = doneCount === items.length;

  useEffect(() => {
    if (allDone && typeof window !== 'undefined') {
      const timer = setTimeout(() => {
        localStorage.setItem('nf_onboarding_done', '1');
        onDismiss();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [allDone, onDismiss]);

  return (
    <div
      style={{
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: 12,
        padding: 20,
        marginBottom: 24,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3' }}>
          🚀 {isKo ? '시작하기' : 'Get Started'}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={onDismiss}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#6e7681',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: '2px 6px',
          }}
          aria-label="닫기"
        >
          ✕
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 6,
          }}
        >
          <span style={{ fontSize: 11, color: '#8b949e' }}>{isKo ? '진행 상황' : 'Progress'}</span>
          <span style={{ fontSize: 11, color: '#e6edf3', fontWeight: 700 }}>
            {doneCount} / {items.length}
          </span>
        </div>
        <div
          style={{
            height: 4,
            background: '#21262d',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              borderRadius: 2,
              width: `${(doneCount / items.length) * 100}%`,
              background: allDone ? '#3fb950' : '#388bfd',
              transition: 'width 0.3s',
            }}
          />
        </div>
      </div>

      {/* Items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item) => (
          <Link
            prefetch={item.href.includes('shape-generator')}
            key={item.labelKo}
            href={item.href}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 8,
              background: item.done ? '#1a2e1a' : '#0d1117',
              border: `1px solid ${item.done ? '#2d4a2d' : '#21262d'}`,
              textDecoration: 'none',
              color: item.done ? '#8b949e' : '#e6edf3',
              fontSize: 13,
              transition: 'border-color 0.15s',
            }}
          >
            <span style={{ fontSize: 16, flexShrink: 0 }}>
              {item.done ? '✅' : '⭕'}
            </span>
            <span
              style={{
                textDecoration: item.done ? 'line-through' : 'none',
                color: item.done ? '#6e7681' : '#e6edf3',
              }}
            >
              {isKo ? item.labelKo : item.labelEn}
            </span>
          </Link>
        ))}
      </div>

      {/* All done message */}
      {allDone && (
        <div
          style={{
            marginTop: 16,
            padding: '12px 14px',
            background: '#1a2e1a',
            border: '1px solid #3fb950',
            borderRadius: 8,
            fontSize: 13,
            color: '#3fb950',
            fontWeight: 600,
          }}
        >
          {isKo ? '🎉 모든 단계 완료! Pro 플랜으로 더 많은 기능을 경험하세요.' : '🎉 All done! Upgrade to Pro for more features.'}
        </div>
      )}
    </div>
  );
}
