'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { toIsoLang, toRouteLang, type IsoLang } from '@/lib/i18n/normalize';

const BETA_COPY: Record<IsoLang, {
  aria: string; primary: (href: string) => ReactNode; secondary: (contactHref: string, refundHref: string) => ReactNode;
}> = {
  ko: { aria: '유료 베타 안내', primary: href => <>현재 NexyFab은 <strong style={{ color: '#79c0ff' }}>유료 베타</strong> 단계입니다. 서비스 안정화 과정에서 일부 기능이 제한될 수 있으며, 모든 피드백은 <Link href={href} style={{ color: '#58a6ff', fontWeight: 700, textDecoration: 'underline' }}>공식 지원 채널</Link>을 통해 우선 처리됩니다.</>, secondary: (contact, refund) => <>베타 기간 중 대량 주문 시 관리자 확인 절차가 추가될 수 있습니다. 급한 용건은 <Link href={contact} style={{ color: '#58a6ff', fontWeight: 600 }}>지원 티켓(문의)</Link>을 이용해 주세요. · <Link href={refund} style={{ color: '#8b949e', textDecoration: 'underline' }}>환불 안내</Link></> },
  en: { aria: 'Paid beta notice', primary: href => <>NexyFab is in a <strong style={{ color: '#79c0ff' }}>paid beta</strong>. Some features may be limited while we stabilize the service; feedback is prioritized through <Link href={href} style={{ color: '#58a6ff', fontWeight: 700, textDecoration: 'underline' }}>official support</Link>.</>, secondary: (contact, refund) => <>Large orders may require extra admin verification during beta. For urgent issues, use the <Link href={contact} style={{ color: '#58a6ff', fontWeight: 600 }}>support ticket</Link> form. · <Link href={refund} style={{ color: '#8b949e', textDecoration: 'underline' }}>Refund policy</Link></> },
  ja: { aria: '有料ベータのお知らせ', primary: href => <>NexyFabは<strong style={{ color: '#79c0ff' }}>有料ベータ</strong>段階です。サービス安定化中は一部機能が制限される場合があります。フィードバックは<Link href={href} style={{ color: '#58a6ff', fontWeight: 700, textDecoration: 'underline' }}>公式サポート窓口</Link>で優先対応します。</>, secondary: (contact, refund) => <>ベータ期間中、大口注文には追加の管理者確認が必要な場合があります。お急ぎの場合は<Link href={contact} style={{ color: '#58a6ff', fontWeight: 600 }}>サポートチケット</Link>をご利用ください。 · <Link href={refund} style={{ color: '#8b949e', textDecoration: 'underline' }}>返金ポリシー</Link></> },
  zh: { aria: '付费测试通知', primary: href => <>NexyFab目前处于<strong style={{ color: '#79c0ff' }}>付费测试</strong>阶段。服务稳定期间部分功能可能受限；反馈将通过<Link href={href} style={{ color: '#58a6ff', fontWeight: 700, textDecoration: 'underline' }}>官方支持渠道</Link>优先处理。</>, secondary: (contact, refund) => <>测试期间大额订单可能需要额外的管理员审核。如有紧急问题，请使用<Link href={contact} style={{ color: '#58a6ff', fontWeight: 600 }}>支持工单</Link>。 · <Link href={refund} style={{ color: '#8b949e', textDecoration: 'underline' }}>退款政策</Link></> },
  es: { aria: 'Aviso de beta de pago', primary: href => <>NexyFab está en una fase de <strong style={{ color: '#79c0ff' }}>beta de pago</strong>. Algunas funciones pueden estar limitadas mientras estabilizamos el servicio; los comentarios se priorizan mediante el <Link href={href} style={{ color: '#58a6ff', fontWeight: 700, textDecoration: 'underline' }}>soporte oficial</Link>.</>, secondary: (contact, refund) => <>Durante la beta, los pedidos grandes pueden requerir una verificación administrativa adicional. Para asuntos urgentes, usa el <Link href={contact} style={{ color: '#58a6ff', fontWeight: 600 }}>ticket de soporte</Link>. · <Link href={refund} style={{ color: '#8b949e', textDecoration: 'underline' }}>Política de reembolsos</Link></> },
  ar: { aria: 'إشعار الإصدار التجريبي المدفوع', primary: href => <>NexyFab في مرحلة <strong style={{ color: '#79c0ff' }}>تجريبية مدفوعة</strong>. قد تكون بعض الميزات محدودة أثناء استقرار الخدمة؛ وتُعالج الملاحظات عبر <Link href={href} style={{ color: '#58a6ff', fontWeight: 700, textDecoration: 'underline' }}>الدعم الرسمي</Link> بأولوية.</>, secondary: (contact, refund) => <>قد تتطلب الطلبات الكبيرة أثناء المرحلة التجريبية تحققًا إداريًا إضافيًا. للمسائل العاجلة استخدم <Link href={contact} style={{ color: '#58a6ff', fontWeight: 600 }}>تذكرة الدعم</Link>. · <Link href={refund} style={{ color: '#8b949e', textDecoration: 'underline' }}>سياسة الاسترداد</Link></> },
};

/**
 * Site-wide notice when `NEXT_PUBLIC_PAID_BETA=1` at build time.
 * Korean copy for `kr`; other `[lang]` routes use English for the banner.
 */
export function PaidBetaBanner({ lang }: { lang: string }) {
  if (process.env.NEXT_PUBLIC_PAID_BETA !== '1') return null;

  const routeLang = toRouteLang(lang);
  const copy = BETA_COPY[toIsoLang(routeLang)];
  const contactHref = `/${routeLang}/contact`;
  const refundHref = `/${routeLang}/refund-policy`;

  return (
    <div
      role="region"
      aria-label={copy.aria}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        fontSize: 13,
        lineHeight: 1.55,
        borderBottom: '1px solid rgba(56,139,253,0.35)',
      }}
    >
      <div
        style={{
          background: 'linear-gradient(90deg, #0d1f3c 0%, #132a4a 50%, #0d1f3c 100%)',
          color: '#e6edf3',
          padding: '10px 16px',
          textAlign: 'center',
        }}
      >
        {copy.primary(contactHref)}
      </div>
      <div
        style={{
          background: '#161b22',
          color: '#8b949e',
          padding: '8px 16px',
          textAlign: 'center',
          fontSize: 12,
        }}
      >
        {copy.secondary(contactHref, refundHref)}
      </div>
    </div>
  );
}
