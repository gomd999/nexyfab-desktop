import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { getPartnerAuth } from '@/lib/partner-auth';
import { formatMoney } from '@/lib/money';
import { calculateTax } from '@/lib/tax-engine';
import { incotermProfile } from '@/lib/shipping';
import type { CountryCode, CurrencyCode } from '@/lib/country-pricing';

export const dynamic = 'force-dynamic';

function fmtTs(ts: number, locale: string) {
  return new Date(ts).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}
function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params;
  const db = getDbAdapter();

  // 인증: 고객(JWT) 또는 파트너 세션
  const authUser = await getAuthUser(req);
  const partnerAuth = !authUser ? await getPartnerAuth(req) : null;

  if (!authUser && !partnerAuth) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const order = await db.queryOne<{
    id: string; rfq_id: string | null; user_id: string; part_name: string;
    manufacturer_name: string; quantity: number; total_price_krw: number;
    total_price: number | null; currency: string | null; buyer_country: string | null;
    hs_code: string | null; incoterm: string | null;
    ship_from_country: string | null; ship_to_country: string | null;
    status: string; steps: string; created_at: number; estimated_delivery_at: number;
    partner_email: string | null; payment_status: string | null;
  }>(
    'SELECT * FROM nf_orders WHERE id = ?', orderId,
  );
  if (!order) return new NextResponse('Not Found', { status: 404 });

  // Locale selection: caller-requested ?lang=en overrides the order's
  // buyer country; domestic KR stays in Korean by default.
  const langParam = req.nextUrl.searchParams.get('lang') ?? '';
  const buyerTaxId = req.nextUrl.searchParams.get('buyerTaxId') ?? null;
  const isKo = langParam === 'en' ? false : (!order.buyer_country || order.buyer_country === 'KR');
  const locale = isKo ? 'ko-KR' : 'en-US';
  const htmlLang = isKo ? 'ko' : 'en';

  const currency = (order.currency ?? 'KRW') as CurrencyCode;
  const amount   = order.total_price ?? order.total_price_krw;
  const subtotalMoney = { value: amount, currency };
  const sellerCountry: CountryCode = 'KR';
  const buyerCountry  = (order.buyer_country ?? 'KR') as CountryCode;

  const tax = calculateTax(subtotalMoney, {
    sellerCountry,
    buyerCountry,
    buyerTaxId,
    isB2B: Boolean(buyerTaxId),
  });

  // 접근 권한 검증
  const isCustomer = authUser?.userId === order.user_id;
  const isPartner = partnerAuth && (
    partnerAuth.email === order.partner_email ||
    partnerAuth.company === order.manufacturer_name
  );
  if (!isCustomer && !isPartner) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const steps: { label: string; labelKo: string; completedAt?: number; estimatedAt?: number }[] = JSON.parse(order.steps ?? '[]');
  const STATUS_KO: Record<string, string> = {
    placed: '주문 접수', production: '생산 중', qc: '품질 검사', shipped: '배송 중', delivered: '납품 완료',
  };
  const STATUS_EN: Record<string, string> = {
    placed: 'Placed', production: 'In Production', qc: 'Quality Check', shipped: 'Shipped', delivered: 'Delivered',
  };
  const STATUS_COLOR: Record<string, string> = {
    placed: '#388bfd', production: '#f0883e', qc: '#e3b341', shipped: '#79c0ff', delivered: '#3fb950',
  };
  const statusLabel = (isKo ? STATUS_KO : STATUS_EN)[order.status] ?? order.status;
  const statusColor = STATUS_COLOR[order.status] ?? '#6e7681';

  const commissionRate = 0.05;
  const commissionMoney = { value: amount * commissionRate, currency };
  const partnerPayoutMoney = { value: amount - commissionMoney.value, currency };

  const t = isKo
    ? {
        title: '주문 확인서 / 인보이스',
        orderInfo: '주문 정보', orderId: '주문 번호', rfq: 'RFQ 번호', orderedAt: '주문일',
        dueAt: '납기 예정일', currentStatus: '현재 상태', paid: '✓ 결제 완료', paidLabel: '결제 상태',
        part: '부품 및 금액', partName: '부품명', mfr: '제조사', qty: '수량', qtyUnit: '개',
        subtotal: '공급가액', tax: (name: string) => `${name} (${(tax.rate * 100).toFixed(0)}%)`,
        total: '합계 금액', commission: (r: string) => `플랫폼 수수료 (${r}%)`, payout: '파트너 수령액',
        steps: '진행 단계', stepCol: '단계', stateCol: '상태', dateCol: '일시',
        done: '✓ 완료', pending: '대기', estimated: '예정',
        buyer: '발주사 (고객)', platform: 'NexyFab 플랫폼', seller: '제조사 (파트너)', signature: '서명 / Signature',
        issued: '발행일', reverseCharge: '세금 주의: 역과세(Reverse Charge) — 구매자가 자국에서 VAT를 신고/납부합니다.',
        exportNote: '세금 주의: 영세율 수출 거래입니다.',
        shipping: '국제 배송 정보', hsCode: 'HS 코드', incoterm: '인코텀즈', shipFrom: '출하국', shipTo: '도착국',
      }
    : {
        title: 'Order Confirmation / Invoice',
        orderInfo: 'Order Information', orderId: 'Order No.', rfq: 'RFQ No.', orderedAt: 'Order Date',
        dueAt: 'Estimated Delivery', currentStatus: 'Status', paid: '✓ Paid', paidLabel: 'Payment',
        part: 'Part & Pricing', partName: 'Part Name', mfr: 'Manufacturer', qty: 'Quantity', qtyUnit: 'units',
        subtotal: 'Subtotal', tax: (name: string) => `${name} (${(tax.rate * 100).toFixed(0)}%)`,
        total: 'Total', commission: (r: string) => `Platform Fee (${r}%)`, payout: 'Partner Payout',
        steps: 'Progress', stepCol: 'Step', stateCol: 'State', dateCol: 'Timestamp',
        done: '✓ Done', pending: 'Pending', estimated: 'est.',
        buyer: 'Buyer', platform: 'NexyFab Platform', seller: 'Manufacturer (Partner)', signature: 'Signature',
        issued: 'Issued', reverseCharge: 'Tax note: Reverse charge applies — the buyer self-assesses VAT in their country.',
        exportNote: 'Tax note: Zero-rated export.',
        shipping: 'International Shipping', hsCode: 'HS Code', incoterm: 'Incoterm', shipFrom: 'Ship From', shipTo: 'Ship To',
      };

  const stepsHtml = steps.map((s, i) => {
    const done = !!s.completedAt;
    const tsStr = s.completedAt
      ? fmtTs(s.completedAt, locale)
      : s.estimatedAt
        ? `${fmtTs(s.estimatedAt, locale)} (${t.estimated})`
        : '';
    const stepLabel = isKo ? s.labelKo : s.label;
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e8ecf0;font-size:13px;color:#374151;font-weight:${i === 0 ? 700 : 400}">
          ${i + 1}. ${esc(stepLabel)}
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #e8ecf0;font-size:12px;color:${done ? '#059669' : '#9ca3af'}">
          ${done ? t.done : t.pending}
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #e8ecf0;font-size:12px;color:#6b7280">
          ${esc(tsStr)}
        </td>
      </tr>`;
  }).join('');

  // Shipping block: only shown if *any* international-shipping field is
  // populated. Keeps the PDF clean for domestic KR orders that never need it.
  const incProfile = incotermProfile(order.incoterm);
  const showShippingBlock = Boolean(order.hs_code || order.incoterm || order.ship_from_country || order.ship_to_country);
  const shippingBlock = showShippingBlock
    ? `
      <h2>${t.shipping}</h2>
      <table class="info-table">
        ${order.hs_code ? `<tr><td>${t.hsCode}</td><td style="font-family:monospace">${esc(order.hs_code)}</td></tr>` : ''}
        ${incProfile ? `<tr><td>${t.incoterm}</td><td><strong>${esc(incProfile.label)}</strong><div style="font-size:11px;color:#6b7280;font-weight:400;margin-top:4px">${esc(incProfile.description)}</div></td></tr>` : ''}
        ${order.ship_from_country ? `<tr><td>${t.shipFrom}</td><td>${esc(order.ship_from_country)}</td></tr>` : ''}
        ${order.ship_to_country ? `<tr><td>${t.shipTo}</td><td>${esc(order.ship_to_country)}</td></tr>` : ''}
      </table>`
    : '';

  const taxNoteBanner =
    tax.treatment === 'reverse_charge'
      ? `<div style="padding:12px 16px;margin:0 0 18px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12px;color:#92400e;">${t.reverseCharge}${buyerTaxId ? ` (VAT ID: ${esc(buyerTaxId)})` : ''}</div>`
      : tax.treatment === 'export_zero_rated'
        ? `<div style="padding:12px 16px;margin:0 0 18px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;font-size:12px;color:#065f46;">${t.exportNote}${buyerTaxId ? ` (Tax ID: ${esc(buyerTaxId)})` : ''}</div>`
        : '';

  const html = `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${t.title} — ${esc(orderId)}</title>
  <style>
    @media print {
      .no-print { display: none !important; }
      body { background: #fff !important; }
    }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; background: #f3f4f6; font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif; color: #111827; }
    .doc { max-width: 760px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 4px 24px #00000018; overflow: hidden; }
    .header { background: linear-gradient(135deg,#1e3a5f,#2563eb); color: #fff; padding: 32px 40px; }
    .logo { font-size: 26px; font-weight: 900; letter-spacing: -0.5px; margin-bottom: 4px; }
    .doc-title { font-size: 14px; opacity: 0.75; }
    .body { padding: 32px 40px; }
    h2 { font-size: 16px; color: #1e3a5f; border-bottom: 2px solid #dbeafe; padding-bottom: 8px; margin: 0 0 16px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 28px; }
    .info-table td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #e5e7eb; }
    .info-table td:first-child { color: #6b7280; width: 140px; font-weight: 500; background: #f9fafb; }
    .info-table td:last-child { color: #111827; font-weight: 600; }
    .amount { font-size: 22px; font-weight: 900; color: #2563eb; }
    .badge { display: inline-block; padding: 3px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; background: ${statusColor}22; color: ${statusColor}; }
    .sig { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-top: 40px; }
    .sig-box { border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; text-align: center; }
    .sig-label { font-size: 11px; color: #9ca3af; margin-bottom: 40px; }
    .sig-line { border-top: 1px solid #d1d5db; padding-top: 6px; font-size: 11px; color: #6b7280; }
    .print-btn { display: block; text-align: center; margin: 20px 0; }
    .print-btn button { padding: 12px 36px; background: linear-gradient(135deg,#2563eb,#7c3aed); color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; }
    .footer { padding: 16px 40px; background: #f9fafb; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <div class="print-btn no-print">
    <button onclick="window.print()">🖨️ PDF 저장 / 인쇄</button>
  </div>
  <div class="doc">
    <div class="header">
      <div class="logo">Nexy<span style="color:#93c5fd">Fab</span></div>
      <div class="doc-title">${t.title}</div>
    </div>
    <div class="body">

      ${taxNoteBanner}

      <h2>${t.orderInfo}</h2>
      <table class="info-table">
        <tr><td>${t.orderId}</td><td style="font-family:monospace;font-size:14px">${esc(order.id)}</td></tr>
        ${order.rfq_id ? `<tr><td>${t.rfq}</td><td style="font-family:monospace">${esc(order.rfq_id)}</td></tr>` : ''}
        <tr><td>${t.orderedAt}</td><td>${fmtTs(order.created_at, locale)}</td></tr>
        <tr><td>${t.dueAt}</td><td>${fmtTs(order.estimated_delivery_at, locale)}</td></tr>
        <tr><td>${t.currentStatus}</td><td><span class="badge">${esc(statusLabel)}</span></td></tr>
        ${order.payment_status === 'paid' ? `<tr><td>${t.paidLabel}</td><td style="color:#059669;font-weight:700">${t.paid}</td></tr>` : ''}
      </table>

      <h2>${t.part}</h2>
      <table class="info-table">
        <tr><td>${t.partName}</td><td>${esc(order.part_name)}</td></tr>
        <tr><td>${t.mfr}</td><td>${esc(order.manufacturer_name)}</td></tr>
        <tr><td>${t.qty}</td><td>${order.quantity.toLocaleString(locale)} ${t.qtyUnit}</td></tr>
        <tr><td>${t.subtotal}</td><td>${formatMoney(subtotalMoney)}</td></tr>
        ${tax.rate > 0 ? `<tr><td>${t.tax(tax.taxName)}</td><td>${formatMoney(tax.tax)}</td></tr>` : ''}
        <tr><td>${t.total}</td><td class="amount">${formatMoney(tax.total)}</td></tr>
        <tr><td>${t.commission((commissionRate * 100).toFixed(0))}</td><td style="color:#6b7280">${formatMoney(commissionMoney)}</td></tr>
        <tr><td>${t.payout}</td><td style="color:#059669;font-weight:700">${formatMoney(partnerPayoutMoney)}</td></tr>
      </table>

      ${shippingBlock}

      <h2>${t.steps}</h2>
      <table>
        <thead>
          <tr style="background:#f9fafb">
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">${t.stepCol}</th>
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">${t.stateCol}</th>
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">${t.dateCol}</th>
          </tr>
        </thead>
        <tbody>
          ${stepsHtml}
        </tbody>
      </table>

      <div class="sig">
        <div class="sig-box">
          <div class="sig-label">${t.buyer}</div>
          <div class="sig-line">${t.signature}</div>
        </div>
        <div class="sig-box">
          <div class="sig-label">${t.platform}</div>
          <div class="sig-line">nexyfab@nexysys.com</div>
        </div>
        <div class="sig-box">
          <div class="sig-label">${t.seller}</div>
          <div class="sig-line">${esc(order.manufacturer_name)}</div>
        </div>
      </div>
    </div>
    <div class="footer">
      <span>NexyFab · nexyfab.com · nexyfab@nexysys.com</span>
      <span>${t.issued}: ${new Date().toLocaleDateString(locale)}</span>
    </div>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
