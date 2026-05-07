'use client';
// ─── UpgradePrompt ────────────────────────────────────────────────────────────
// Modal shown when a Free user tries to access a Pro/Team feature.

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import type { UserPlan } from '@/hooks/useAuth';

interface UpgradePromptProps {
  open: boolean;
  onClose: () => void;
  feature: string;         // human-readable feature name
  featureKo?: string;
  requiredPlan?: UserPlan;
  lang?: string;
  onLogin?: () => void;
}

type FeatureItem = { icon: string; plan: string; labels: Record<'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar', string> };

const PLAN_FEATURES: Record<string, FeatureItem[]> = {
  pro: [
    { icon: '🔬', plan: 'Pro', labels: { ko: 'DFM 제조 분석', en: 'DFM Analysis', ja: 'DFM 製造分析', zh: 'DFM 制造分析', es: 'Análisis DFM', ar: 'تحليل DFM' } },
    { icon: '⚗️', plan: 'Pro', labels: { ko: 'FEA 응력 해석', en: 'FEA Stress Analysis', ja: 'FEA 応力解析', zh: 'FEA 应力分析', es: 'Análisis de Tensión FEA', ar: 'تحليل الإجهاد FEA' } },
    { icon: '💰', plan: 'Pro', labels: { ko: '비용 자동 추정', en: 'Cost Estimation', ja: 'コスト自動推定', zh: '成本估算', es: 'Estimación de Costos', ar: 'تقدير التكلفة' } },
    { icon: '📤', plan: 'Pro', labels: { ko: 'STEP/DXF/GLTF 내보내기', en: 'STEP/DXF/GLTF Export', ja: 'STEP/DXF/GLTF エクスポート', zh: 'STEP/DXF/GLTF 导出', es: 'Exportar STEP/DXF/GLTF', ar: 'تصدير STEP/DXF/GLTF' } },
    { icon: '☁️', plan: 'Pro', labels: { ko: '클라우드 저장', en: 'Cloud Save', ja: 'クラウド保存', zh: '云存储', es: 'Guardado en la Nube', ar: 'حفظ سحابي' } },
    { icon: '🔒', plan: 'Pro', labels: { ko: 'IP 보호 공유 링크', en: 'IP-Protected Share Link', ja: 'IP 保護共有リンク', zh: '受 IP 保护的共享链接', es: 'Enlace Compartido con Protección IP', ar: 'رابط مشاركة محمي بـ IP' } },
    { icon: '💬', plan: 'Pro', labels: { ko: '제조사 견적 요청', en: 'Quote Requests', ja: '見積依頼', zh: '报价请求', es: 'Solicitudes de Cotización', ar: 'طلبات عروض الأسعار' } },
  ],
};

const dict = {
  ko: {
    dialogLabel: '업그레이드 플랜 선택',
    heading: (f: string) => `"${f}" — Pro 전용 기능`,
    subhead: 'Pro로 업그레이드하면 아래 기능을 모두 사용할 수 있습니다',
    period: '/월', periodSeat: '/월/seat',
    processing: '처리 중...', upgradePro: 'Pro로 업그레이드',
    alreadyPro: '이미 Pro이신가요? 로그인',
    closeAria: '닫기', upgradeAria: 'Pro 플랜으로 업그레이드',
  },
  en: {
    dialogLabel: 'Upgrade plan',
    heading: (f: string) => `"${f}" is a Pro feature`,
    subhead: 'Upgrade to Pro to unlock all features below',
    period: '/mo', periodSeat: '/mo/seat',
    processing: 'Processing...', upgradePro: 'Upgrade to Pro',
    alreadyPro: 'Already Pro? Log in',
    closeAria: 'Close dialog', upgradeAria: 'Upgrade to Pro plan',
  },
  ja: {
    dialogLabel: 'プランをアップグレード',
    heading: (f: string) => `"${f}" は Pro 専用機能です`,
    subhead: 'Pro にアップグレードして以下の機能をすべて利用しましょう',
    period: '/月', periodSeat: '/月/seat',
    processing: '処理中...', upgradePro: 'Pro にアップグレード',
    alreadyPro: 'すでに Pro ですか？ ログイン',
    closeAria: '閉じる', upgradeAria: 'Pro プランにアップグレード',
  },
  zh: {
    dialogLabel: '升级套餐',
    heading: (f: string) => `"${f}" 是 Pro 专属功能`,
    subhead: '升级到 Pro 以解锁下方所有功能',
    period: '/月', periodSeat: '/月/座位',
    processing: '处理中...', upgradePro: '升级到 Pro',
    alreadyPro: '已经是 Pro？登录',
    closeAria: '关闭对话框', upgradeAria: '升级到 Pro 套餐',
  },
  es: {
    dialogLabel: 'Actualizar plan',
    heading: (f: string) => `"${f}" es una función Pro`,
    subhead: 'Actualiza a Pro para desbloquear todas las funciones',
    period: '/mes', periodSeat: '/mes/asiento',
    processing: 'Procesando...', upgradePro: 'Actualizar a Pro',
    alreadyPro: '¿Ya eres Pro? Inicia sesión',
    closeAria: 'Cerrar diálogo', upgradeAria: 'Actualizar al plan Pro',
  },
  ar: {
    dialogLabel: 'ترقية الخطة',
    heading: (f: string) => `"${f}" ميزة Pro حصرية`,
    subhead: 'قم بالترقية إلى Pro لإلغاء قفل جميع الميزات أدناه',
    period: '/شهر', periodSeat: '/شهر/مقعد',
    processing: 'جارٍ المعالجة...', upgradePro: 'الترقية إلى Pro',
    alreadyPro: 'هل أنت Pro بالفعل؟ تسجيل الدخول',
    closeAria: 'إغلاق الحوار', upgradeAria: 'الترقية إلى خطة Pro',
  },
};

export default function UpgradePrompt({
  open, onClose, feature, featureKo, requiredPlan = 'pro', lang = 'ko', onLogin,
}: UpgradePromptProps) {
  const [hoveredPlan, setHoveredPlan] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang;
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const langKey = langMap[seg] ?? 'en';
  const t = dict[langKey];
  const isoLang = langKey;
  const isKo = langKey === 'ko';

  const handleUpgrade = async (plan: 'pro' | 'team') => {
    setCheckoutLoading(plan);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan, lang: isoLang }),
      });
      const data = await res.json() as { url?: string; ok?: boolean };
      if (data.url) window.location.href = data.url;
    } catch {
      // fallback
    } finally {
      setCheckoutLoading(null);
    }
  };

  if (!open) return null;

  const featureLabel = isKo ? (featureKo ?? feature) : feature;
  const planFeatures = PLAN_FEATURES[requiredPlan] ?? PLAN_FEATURES.pro;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.dialogLabel}
      style={{
        position: 'fixed', inset: 0, zIndex: 9500,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }} onClick={onClose}>
      <div style={{
        background: '#161b22', border: '1px solid #30363d',
        borderRadius: 16, padding: '32px 28px', width: 440,
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        fontFamily: 'system-ui, sans-serif',
        position: 'relative',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>⚡</div>
          <h2 style={{ margin: '0 0 6px', fontSize: 18, color: '#e6edf3', fontWeight: 800 }}>
            {t.heading(featureLabel)}
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: '#6e7681' }}>
            {t.subhead}
          </p>
        </div>

        {/* Feature list */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: 8, marginBottom: 24,
        }}>
          {planFeatures.map(item => (
            <div key={item.labels.en} style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '8px 10px', borderRadius: 8,
              background: '#0d1117', border: '1px solid #21262d',
            }}>
              <span style={{ fontSize: 14 }}>{item.icon}</span>
              <span style={{ fontSize: 11, color: '#8b949e' }}>
                {item.labels[langKey]}
              </span>
            </div>
          ))}
        </div>

        {/* Pricing */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          {[
            { plan: 'pro' as const, label: 'Pro', price: '₩29,000', priceEn: '$20', priceJa: '¥3,500', period: t.period, color: '#388bfd' },
            { plan: 'team' as const, label: 'Team', price: '₩79,000', priceEn: '$57', priceJa: '¥8,500', period: t.periodSeat, color: '#a371f7' },
          ].map(item => (
            <div
              key={item.plan}
              onClick={() => void handleUpgrade(item.plan)}
              onMouseEnter={() => setHoveredPlan(item.plan)}
              onMouseLeave={() => setHoveredPlan(null)}
              style={{
                flex: 1, padding: '14px 16px', borderRadius: 10,
                border: `1px solid ${hoveredPlan === item.plan ? item.color : '#30363d'}`,
                background: hoveredPlan === item.plan ? `${item.color}0d` : '#0d1117',
                cursor: 'pointer', transition: 'all 0.15s', textAlign: 'center',
                opacity: checkoutLoading === item.plan ? 0.7 : 1,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 800, color: item.color, marginBottom: 4 }}>
                {checkoutLoading === item.plan ? '...' : item.label}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#e6edf3' }}>
                {isKo ? item.price : isoLang === 'ja' ? item.priceJa : item.priceEn}
              </div>
              <div style={{ fontSize: 10, color: '#6e7681' }}>
                {item.period}
              </div>
            </div>
          ))}
        </div>

        {/* CTA buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={() => void handleUpgrade('pro')}
            disabled={!!checkoutLoading}
            aria-label={t.upgradeAria}
            style={{
              width: '100%', padding: '11px 0', borderRadius: 8, border: 'none',
              background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
              color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              opacity: checkoutLoading ? 0.7 : 1,
            }}>
            ⚡ {checkoutLoading === 'pro' ? t.processing : t.upgradePro}
          </button>
          {onLogin && (
            <button onClick={onLogin} style={{
              padding: '9px 0', borderRadius: 8,
              border: '1px solid #30363d', background: 'transparent',
              color: '#8b949e', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>
              {t.alreadyPro}
            </button>
          )}
        </div>

        <button
          onClick={onClose}
          aria-label={t.closeAria}
          style={{
            position: 'absolute', top: 12, right: 14,
            background: 'none', border: 'none', color: '#6e7681',
            fontSize: 18, cursor: 'pointer',
          }}>✕</button>
      </div>
    </div>
  );
}
