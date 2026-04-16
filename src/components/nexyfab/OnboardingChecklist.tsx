'use client';

import { useEffect, useState } from 'react';

interface OnboardingChecklistProps {
  lang: string;
  projects: { id: string }[];
  rfqCount?: number;
  user: { plan: string } | null;
  onDismiss: () => void;
}

interface ChecklistItem {
  label: string;
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
  const [visitedMarketplace, setVisitedMarketplace] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setVisitedMarketplace(!!localStorage.getItem('nf_visited_marketplace'));
    }
  }, []);

  const items: ChecklistItem[] = [
    {
      label: '첫 3D 프로젝트 만들기',
      href: `/${lang}/shape-generator`,
      done: projects.length > 0,
    },
    {
      label: 'RFQ 견적 요청 보내기',
      href: `/${lang}/nexyfab/rfq`,
      done: rfqCount > 0,
    },
    {
      label: '제조사 둘러보기',
      href: `/${lang}/nexyfab/marketplace`,
      done: visitedMarketplace,
    },
    {
      label: 'Pro 플랜 알아보기',
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
          🚀 시작하기 / Get Started
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
          <span style={{ fontSize: 11, color: '#8b949e' }}>진행 상황</span>
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
          <a
            key={item.label}
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
              {item.label}
            </span>
          </a>
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
          🎉 모든 단계 완료! Pro 플랜으로 더 많은 기능을 경험하세요.
        </div>
      )}
    </div>
  );
}
