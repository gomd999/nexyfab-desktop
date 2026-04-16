'use client';

interface WelcomeBannerProps {
  lang: string;
  onStartTutorial: () => void;
  onDismiss: () => void;
}

const COPY: Record<string, { heading: string; sub: string; start: string }> = {
  ko: { heading: '첫 방문이시군요! 🚀', sub: '60초 안에 첫 부품 설계 + 견적까지 안내해 드릴게요', start: '안내 시작' },
  en: { heading: 'First time here? 🚀', sub: 'We\'ll guide you to your first part design and quote in 60 seconds', start: 'Show me' },
  ja: { heading: '初めてご利用ですか？🚀', sub: '60秒でパーツ設計から見積もりまでご案内します', start: 'ガイド開始' },
  cn: { heading: '第一次来访？🚀', sub: '我们将在60秒内引导您完成零件设计和报价', start: '开始引导' },
  es: { heading: '¿Primera visita? 🚀', sub: 'Le guiaremos en el diseño de su primera pieza y presupuesto en 60 segundos', start: 'Mostrarme' },
  ar: { heading: 'زيارتك الأولى؟ 🚀', sub: 'سنرشدك لتصميم أول قطعة والحصول على عرض سعر في 60 ثانية', start: 'ابدأ الإرشاد' },
};

export default function WelcomeBanner({ lang, onStartTutorial, onDismiss }: WelcomeBannerProps) {
  const copy = COPY[lang] ?? COPY.en;
  const isRtl = lang === 'ar';

  return (
    <div
      role="region"
      aria-label={copy.heading}
      dir={isRtl ? 'rtl' : 'ltr'}
      style={{
        position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
        zIndex: 8000, background: 'linear-gradient(135deg, #1c2128, #161b22)',
        border: '1px solid #388bfd55', borderRadius: 14,
        padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14,
        boxShadow: '0 8px 40px rgba(56,139,253,0.18)',
        fontFamily: 'system-ui, sans-serif', minWidth: 360, maxWidth: 540,
        animation: 'wb-slide-up 0.35s cubic-bezier(0.16,1,0.3,1)',
      }}
    >
      <div style={{ fontSize: 30, flexShrink: 0 }} aria-hidden="true">🚀</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3', marginBottom: 3 }}>
          {copy.heading}
        </div>
        <div style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.5 }}>
          {copy.sub}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={onStartTutorial}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none',
            background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
            color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(56,139,253,0.35)',
          }}
        >
          {copy.start}
        </button>
        <button
          onClick={onDismiss}
          style={{
            padding: '8px 10px', borderRadius: 8,
            border: '1px solid #30363d', background: 'transparent',
            color: '#6e7681', fontSize: 13, cursor: 'pointer', lineHeight: 1,
          }}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      <style>{`
        @keyframes wb-slide-up {
          from { opacity: 0; transform: translateX(-50%) translateY(16px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  );
}
