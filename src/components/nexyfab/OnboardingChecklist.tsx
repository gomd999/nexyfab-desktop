'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

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

const COPY: Record<IsoLang, { title: string; close: string; progress: string; complete: string; items: [string, string, string, string] }> = {
  ko: { title: '시작하기', close: '닫기', progress: '진행 상황', complete: '🎉 모든 단계 완료! Pro 플랜으로 더 많은 기능을 경험하세요.', items: ['첫 3D 프로젝트 만들기', '첫 RFQ 견적 요청 보내기', '제조사 둘러보기', 'Pro 플랜 알아보기'] },
  en: { title: 'Get Started', close: 'Close', progress: 'Progress', complete: '🎉 All done! Upgrade to Pro for more features.', items: ['Create your first 3D project', 'Send your first RFQ', 'Explore manufacturers', 'Learn about Pro plan'] },
  ja: { title: 'はじめる', close: '閉じる', progress: '進捗', complete: '🎉 すべて完了しました！Proプランでさらに多くの機能を利用できます。', items: ['最初の3Dプロジェクトを作成', '最初のRFQを送信', 'メーカーを探す', 'Proプランを見る'] },
  zh: { title: '开始使用', close: '关闭', progress: '进度', complete: '🎉 全部完成！升级至 Pro 可使用更多功能。', items: ['创建第一个3D项目', '发送第一个RFQ', '浏览制造商', '了解 Pro 方案'] },
  es: { title: 'Primeros pasos', close: 'Cerrar', progress: 'Progreso', complete: '🎉 ¡Todo listo! Mejora a Pro para acceder a más funciones.', items: ['Crea tu primer proyecto 3D', 'Envía tu primera RFQ', 'Explora fabricantes', 'Conoce el plan Pro'] },
  ar: { title: 'البدء', close: 'إغلاق', progress: 'التقدم', complete: '🎉 اكتملت جميع الخطوات! قم بالترقية إلى Pro للحصول على مزيد من الميزات.', items: ['أنشئ أول مشروع ثلاثي الأبعاد', 'أرسل أول طلب عرض سعر', 'استكشف المصنّعين', 'تعرّف على خطة Pro'] },
};

export default function OnboardingChecklist({
  lang,
  projects,
  rfqCount = 0,
  user,
  onDismiss,
}: OnboardingChecklistProps) {
  const copy = COPY[toIsoLang(lang)];
  const [visitedMarketplace, setVisitedMarketplace] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      if (typeof window !== 'undefined') {
        setVisitedMarketplace(!!localStorage.getItem('nf_visited_marketplace'));
      }
    });
  }, []);

  const items: ChecklistItem[] = [
    {
      label: copy.items[0],
      href: `/${lang}/shape-generator`,
      done: projects.length > 0,
    },
    {
      label: copy.items[1],
      href: `/${lang}/nexyfab/rfq`,
      done: rfqCount > 0,
    },
    {
      label: copy.items[2],
      href: `/${lang}/nexyfab/marketplace`,
      done: visitedMarketplace,
    },
    {
      label: copy.items[3],
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
        background: 'var(--nx-panel)',
        border: '1px solid var(--nx-border)',
        borderRadius: 12,
        padding: 20,
        marginBottom: 24,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--nx-text)' }}>
          🚀 {copy.title}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={onDismiss}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--nx-text-3)',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: '2px 6px',
          }}
          aria-label={copy.close}
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
          <span style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>{copy.progress}</span>
          <span style={{ fontSize: 11, color: 'var(--nx-text)', fontWeight: 700 }}>
            {doneCount} / {items.length}
          </span>
        </div>
        <div
          style={{
            height: 4,
            background: 'var(--nx-panel-2)',
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
            key={item.label}
            href={item.href}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 8,
              background: item.done ? '#1a2e1a' : 'var(--nx-bg)',
              border: `1px solid ${item.done ? '#2d4a2d' : 'var(--nx-panel-2)'}`,
              textDecoration: 'none',
              color: item.done ? 'var(--nx-text-2)' : 'var(--nx-text)',
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
                color: item.done ? 'var(--nx-text-3)' : 'var(--nx-text)',
              }}
            >
              {item.label}
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
          {copy.complete}
        </div>
      )}
    </div>
  );
}
