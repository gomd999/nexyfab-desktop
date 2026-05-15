'use client';

/**
 * First-time tour for newly-signed-up users.
 *
 * Shows a 3-step tooltip walkthrough on the *first* shape-generator visit
 * after signup_complete. localStorage flag prevents repeat showings.
 *
 * Why a separate component (vs reusing the existing HomeClient onboarding):
 *   - HomeClient onboarding is for pre-signup browsers; copy/CTA differ.
 *   - This tour assumes a logged-in user and references signed-in features
 *     (cloud save, AI chat) that don't apply to anonymous landing visitors.
 *
 * Funnel impact: bridges signup_complete → first_shape_created. Round 28
 * /admin/funnel cohort numbers showed this as the largest drop in early
 * tests (50%+ users sign up but never click anything).
 */

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'nexyfab.shapeGenTour.v1';

interface Props {
  /** Logged-in user id. We dedupe per user so multi-account browsers each
   *  get their own first-time tour. */
  userId: string | null | undefined;
  lang?: string;
  /** Optional CTA actions — caller wires these to their store dispatchers. */
  onPickShape?: () => void;
  onOpenChat?: () => void;
}

type LangKey = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';
const langMap: Record<string, LangKey> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

interface TourStep { title: string; body: string; cta?: string }

const dict: Record<LangKey, { steps: TourStep[]; skip: string; next: string; done: string }> = {
  ko: {
    skip: '건너뛰기',
    next: '다음',
    done: '시작하기',
    steps: [
      { title: '환영합니다 👋', body: '브라우저에서 3D를 그리고 분석하고 견적까지. 30초 안에 첫 도형을 만들어 봅시다.' },
      { title: '1. 형상 라이브러리에서 시작', body: '왼쪽 패널에서 박스, 실린더, 기어 같은 기본 형상을 골라 시작하세요.', cta: '라이브러리 열기' },
      { title: '2. AI 채팅에 자연어로 명령', body: '"M5 볼트 4개가 있는 100×60×10 알루미늄 플레이트" — 텍스트로 도형을 설명하면 AI가 만들어 드립니다.', cta: 'AI 채팅 열기' },
    ],
  },
  en: {
    skip: 'Skip',
    next: 'Next',
    done: 'Get started',
    steps: [
      { title: 'Welcome 👋', body: 'Design 3D, run DFM, and get quotes — all in your browser. Let\'s build your first shape in 30 seconds.' },
      { title: '1. Pick from the library', body: 'Choose a starter shape — box, cylinder, gear — from the left panel.', cta: 'Open library' },
      { title: '2. Or describe it to the AI', body: '"100×60×10mm aluminum mounting plate with four M5 bolt holes" — the AI builds it for you.', cta: 'Open AI chat' },
    ],
  },
  ja: {
    skip: 'スキップ',
    next: '次へ',
    done: '始める',
    steps: [
      { title: 'ようこそ 👋', body: 'ブラウザで3Dデザイン・DFM・見積もり。30秒で最初の形状を作りましょう。' },
      { title: '1. ライブラリから選ぶ', body: '左パネルからボックス・シリンダー・ギアなどを選んで開始。', cta: 'ライブラリを開く' },
      { title: '2. AIに自然言語で指示', body: '"M5ボルト4本付き100×60×10アルミ板" — AIが作成します。', cta: 'AIチャットを開く' },
    ],
  },
  zh: {
    skip: '跳过',
    next: '下一步',
    done: '开始',
    steps: [
      { title: '欢迎 👋', body: '浏览器中完成3D设计、DFM分析与报价。30秒构建首个形状。' },
      { title: '1. 从形状库选择', body: '在左侧面板挑选立方体、圆柱、齿轮等基础形状。', cta: '打开库' },
      { title: '2. 用自然语言告诉 AI', body: '"带4颗M5螺栓的100×60×10铝板" — AI 将为您构建。', cta: '打开 AI 聊天' },
    ],
  },
  es: {
    skip: 'Omitir',
    next: 'Siguiente',
    done: 'Empezar',
    steps: [
      { title: 'Bienvenido 👋', body: 'Diseña 3D, ejecuta DFM y obtén cotizaciones — todo en tu navegador. Construye tu primera forma en 30 segundos.' },
      { title: '1. Elige de la biblioteca', body: 'Selecciona caja, cilindro o engranaje del panel izquierdo.', cta: 'Abrir biblioteca' },
      { title: '2. O descríbelo a la IA', body: '"placa de aluminio 100×60×10mm con 4 agujeros M5" — la IA lo construye.', cta: 'Abrir chat IA' },
    ],
  },
  ar: {
    skip: 'تخطي',
    next: 'التالي',
    done: 'ابدأ',
    steps: [
      { title: 'أهلاً 👋', body: 'صمم ثلاثي الأبعاد وحلل DFM واحصل على عروض الأسعار — كل ذلك في متصفحك.' },
      { title: '1. اختر من المكتبة', body: 'اختر من اللوحة اليسرى صندوق أو أسطوانة أو ترس.', cta: 'افتح المكتبة' },
      { title: '2. أو صف للذكاء الاصطناعي', body: '"لوح ألمنيوم 100×60×10 بـ 4 ثقوب M5" — يقوم الذكاء الاصطناعي ببنائه.', cta: 'افتح المحادثة' },
    ],
  },
};

export default function FirstTimeTour({ userId, lang = 'en', onPickShape, onOpenChat }: Props) {
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);
  const t = dict[langMap[lang] ?? 'en'];

  useEffect(() => {
    if (!userId) return;
    const key = `${STORAGE_KEY}.${userId}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch { return; }
    setOpen(true);
  }, [userId]);

  const dismiss = () => {
    if (userId) {
      try { localStorage.setItem(`${STORAGE_KEY}.${userId}`, String(Date.now())); } catch { /* ignore */ }
    }
    setOpen(false);
  };

  if (!open) return null;

  const current = t.steps[step];
  const isLast = step === t.steps.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.title}
      style={{
        position: 'fixed', inset: 0, zIndex: 9300,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={dismiss}
    >
      <div
        style={{
          background: 'var(--nx-panel)', border: '1px solid var(--nx-border)',
          borderRadius: 14, padding: '28px 28px 22px', width: 420, maxWidth: '92vw',
          fontFamily: 'system-ui, sans-serif', color: 'var(--nx-text)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
          {t.steps.map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1, height: 3, borderRadius: 2,
                background: i <= step ? 'var(--nx-accent)' : 'var(--nx-border)',
                transition: 'background 0.2s',
              }}
            />
          ))}
        </div>

        <h2 style={{ margin: '0 0 10px', fontSize: 20, fontWeight: 800 }}>{current.title}</h2>
        <p style={{ margin: '0 0 22px', fontSize: 14, color: 'var(--nx-text)', lineHeight: 1.55 }}>{current.body}</p>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <button
            type="button" onClick={dismiss}
            style={{
              padding: '7px 12px', borderRadius: 6,
              background: 'transparent', color: 'var(--nx-text-2)',
              border: 'none', cursor: 'pointer', fontSize: 12,
            }}
          >{t.skip}</button>

          <div style={{ display: 'flex', gap: 8 }}>
            {current.cta && step === 1 && onPickShape && (
              <button
                type="button"
                onClick={() => { dismiss(); onPickShape(); }}
                style={{
                  padding: '7px 14px', borderRadius: 6,
                  background: 'var(--nx-panel-2)', color: 'var(--nx-text)',
                  border: '1px solid var(--nx-border)', cursor: 'pointer', fontSize: 13,
                }}
              >{current.cta}</button>
            )}
            {current.cta && step === 2 && onOpenChat && (
              <button
                type="button"
                onClick={() => { dismiss(); onOpenChat(); }}
                style={{
                  padding: '7px 14px', borderRadius: 6,
                  background: 'var(--nx-panel-2)', color: 'var(--nx-text)',
                  border: '1px solid var(--nx-border)', cursor: 'pointer', fontSize: 13,
                }}
              >{current.cta}</button>
            )}
            <button
              type="button"
              onClick={() => isLast ? dismiss() : setStep(step + 1)}
              style={{
                padding: '7px 16px', borderRadius: 6,
                background: 'var(--nx-accent)', color: 'var(--nx-text)',
                border: '1px solid var(--nx-accent)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              }}
            >{isLast ? t.done : t.next}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
