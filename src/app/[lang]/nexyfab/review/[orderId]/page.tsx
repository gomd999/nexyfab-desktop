'use client';

// B8 — Standalone review submission page (deep-linkable from email).
//
// The orders detail page already has an inline review form, but a
// standalone URL lets us send "your part arrived, leave a review →"
// links in shipping-complete emails. Lower friction than navigating
// to the order detail page first.

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ReviewForm from '@/components/nexyfab/ReviewForm';
import { toIsoLang, toRouteLang } from '@/lib/i18n/normalize';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

interface OrderInfo {
  id: string;
  partNameKo?: string;
  partName: string;
  manufacturerName: string;
  status: string;
  partnerEmail: string | null;
}

export default function StandaloneReviewPage() {
  const params = useParams();
  const router = useRouter();
  const routeLang = params?.lang as string;
  const lang = toIsoLang(routeLang);
  const route = toRouteLang(routeLang);
  const orderId = params?.orderId as string;
  const [order, setOrder] = useState<OrderInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/nexyfab/orders/${encodeURIComponent(orderId)}`, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { order: OrderInfo };
        if (!cancelled) setOrder(data.order);
      } catch (e) {
        if (!cancelled) setLoadErr((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [orderId]);

  const L = createCommercialLocalizer(lang);
  const t = {
    title: L('주문 리뷰', 'Order Review'),
    loading: L('주문 정보를 불러오는 중…', 'Loading order info…'),
    notFound: L('주문을 찾을 수 없습니다.', 'Order not found.'),
    notDelivered: L('배송 완료 후에 리뷰를 작성할 수 있습니다.', 'You can review after the order is delivered.'),
    forOrder: L('주문', 'For order'),
    backToOrders: L('← 주문 목록으로', '← Back to orders'),
    partnerEmailMissing: L('주문에 연결된 파트너 이메일이 없어 리뷰를 제출할 수 없습니다.', 'Partner email missing on this order — cannot submit review.'),
  };

  if (loadErr) {
    return (
      <main style={pageStyle}>
        <div style={{ color: '#f85149', fontSize: 14, padding: 24 }}>
          {t.notFound} ({loadErr})
        </div>
      </main>
    );
  }
  if (!order) {
    return <main style={pageStyle}><div style={{ color: 'var(--nx-text-2)', padding: 24 }}>{t.loading}</div></main>;
  }
  if (order.status !== 'delivered') {
    return (
      <main style={pageStyle}>
        <h1 style={titleStyle}>{t.title}</h1>
        <div style={{ color: '#d29922', padding: 16, background: 'rgba(210,153,34,0.12)', borderRadius: 8, fontSize: 13 }}>
          ⚠ {t.notDelivered}
        </div>
        <a href={`/${route}/nexyfab/orders`} style={backLinkStyle}>{t.backToOrders}</a>
      </main>
    );
  }
  if (!order.partnerEmail) {
    return (
      <main style={pageStyle}>
        <div style={{ color: '#f85149', padding: 16 }}>{t.partnerEmailMissing}</div>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <h1 style={titleStyle}>{t.title}</h1>
      <div style={{ marginBottom: 16, fontSize: 12, color: 'var(--nx-text-2)' }}>
        {t.forOrder} <code style={{ background: 'var(--nx-panel)', padding: '2px 6px', borderRadius: 4, color: 'var(--nx-text)' }}>{order.id}</code>
        {' · '}
        <strong style={{ color: 'var(--nx-text)' }}>{lang === 'ko' && order.partNameKo ? order.partNameKo : order.partName}</strong>
        {' · '}
        {order.manufacturerName}
      </div>

      <ReviewForm
        lang={lang}
        contractId={order.id}
        partnerEmail={order.partnerEmail}
        onSubmitted={() => {
          // Send back to orders list after a short delay so the success
          // message has a chance to render.
          setTimeout(() => router.push(`/${route}/nexyfab/orders`), 1800);
        }}
      />

      <a href={`/${route}/nexyfab/orders`} style={backLinkStyle}>{t.backToOrders}</a>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  maxWidth: 580, margin: '0 auto', padding: '40px 20px',
  fontFamily: 'system-ui, sans-serif',
  color: 'var(--nx-text)',
};
const titleStyle: React.CSSProperties = {
  fontSize: 24, fontWeight: 800, margin: '0 0 16px',
};
const backLinkStyle: React.CSSProperties = {
  display: 'inline-block', marginTop: 24,
  fontSize: 12, color: '#79c0ff', textDecoration: 'none',
};
