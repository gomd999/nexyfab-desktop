import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { getPartnerAuth } from '@/lib/partner-auth';
import { normPartnerEmail } from '@/lib/partner-factory-access';

export const dynamic = 'force-dynamic';

function won(n: number) { return n.toLocaleString('ko-KR'); }
function fmtDate(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}년 ${String(d.getMonth() + 1).padStart(2, '0')}월 ${String(d.getDate()).padStart(2, '0')}일`;
}
function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface OrderRow {
  id: string;
  part_name: string;
  manufacturer_name: string;
  quantity: number;
  total_price_krw: number;
  status: string;
  created_at: number;
  estimated_delivery_at: number;
  user_id: string | null;
  user_email: string | null;
  partner_email: string | null;
  payment_status: string | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params;
  const db = getDbAdapter();

  const authUser = await getAuthUser(req);
  const partnerAuth = !authUser ? await getPartnerAuth(req) : null;

  if (!authUser && !partnerAuth) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const order = await db.queryOne<OrderRow>(
    `SELECT id, part_name, manufacturer_name, quantity, total_price_krw,
            status, created_at, estimated_delivery_at, user_id, user_email,
            partner_email, payment_status
     FROM nf_orders WHERE id = ?`,
    orderId,
  ).catch(() => null);

  if (!order) return new NextResponse('Not Found', { status: 404 });

  if (authUser) {
    const isAdmin = authUser.globalRole === 'super_admin';
    const userEmailOk =
      order.user_email != null && normPartnerEmail(order.user_email) === normPartnerEmail(authUser.email);
    if (!isAdmin && order.user_id !== authUser.userId && !userEmailOk) {
      return new NextResponse('Forbidden', { status: 403 });
    }
  } else if (partnerAuth) {
    const co = (partnerAuth.company ?? '').trim().toLowerCase();
    const peOk = normPartnerEmail(order.partner_email) === normPartnerEmail(partnerAuth.email);
    const nameOk = co.length > 0 && order.manufacturer_name.trim().toLowerCase() === co;
    if (!peOk && !nameOk) {
      return new NextResponse('Forbidden', { status: 403 });
    }
  }

  const supplyAmt = Math.round(order.total_price_krw / 1.1);
  const vatAmt = order.total_price_krw - supplyAmt;
  const issueDate = fmtDate(Date.now());
  const orderDate = fmtDate(order.created_at);

  // 공급자 (NexyFab / 파트너사)
  const supplierName = esc(order.manufacturer_name);
  const buyerName = order.user_email ? esc(order.user_email) : '구매자';

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"/>
<title>세금계산서 — ${orderId}</title>
<style>
  @media print { .no-print { display:none!important } body { margin:0 } }
  * { box-sizing:border-box; margin:0; padding:0 }
  body { font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif; background:#f9fafb; padding:24px; color:#111 }
  .page { max-width:820px; margin:0 auto; background:#fff; border:2px solid #111; padding:0 }
  .title-bar { background:#1e3a5f; color:#fff; text-align:center; padding:14px; font-size:22px; font-weight:900; letter-spacing:6px }
  .sub-title { text-align:center; font-size:13px; color:#555; padding:6px 0; border-bottom:2px solid #111 }
  .section { border-bottom:1px solid #ccc }
  table.info { width:100%; border-collapse:collapse }
  table.info td, table.info th { border:1px solid #ccc; padding:6px 10px; font-size:12px; vertical-align:top }
  table.info th { background:#f3f4f6; font-weight:700; width:100px; text-align:center }
  .half { display:inline-block; width:49%; vertical-align:top }
  .items th { background:#1e3a5f; color:#fff; text-align:center; padding:8px 6px; font-size:12px; font-weight:700 }
  .items td { text-align:center; padding:7px 6px; font-size:12px; border-bottom:1px solid #e5e7eb }
  .items tr:nth-child(even) td { background:#f9fafb }
  .total-row td { font-weight:700; background:#f0f4ff; border-top:2px solid #1e3a5f }
  .stamp { border:3px solid #dc2626; color:#dc2626; border-radius:50%; width:70px; height:70px; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:900; text-align:center; line-height:1.3; margin:auto }
  .watermark { opacity:0.08; font-size:80px; font-weight:900; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-30deg); pointer-events:none; color:#1e3a5f; white-space:nowrap }
  .footer-note { font-size:10px; color:#9ca3af; text-align:center; padding:8px }
</style>
</head>
<body>
<div class="page">
  <div class="title-bar">세 금 계 산 서</div>
  <div class="sub-title">Tax Invoice (공급받는 자 보관용)</div>

  <div style="padding:16px 20px; position:relative">
    <div class="watermark">NexyFab</div>

    <!-- 기본 정보 -->
    <table class="info" style="margin-bottom:12px">
      <tr>
        <th>계산서번호</th>
        <td><strong>${esc(orderId)}</strong></td>
        <th>발행일자</th>
        <td>${issueDate}</td>
        <th>주문일자</th>
        <td>${orderDate}</td>
      </tr>
    </table>

    <!-- 공급자 / 공급받는자 -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
      <tr>
        <td style="width:50%;padding-right:6px;vertical-align:top">
          <table class="info" style="width:100%">
            <tr><th colspan="2" style="background:#1e3a5f;color:#fff;text-align:center">공 급 자</th></tr>
            <tr><th>상호</th><td>${supplierName}</td></tr>
            <tr><th>사업자번호</th><td>— (파트너사 정보)</td></tr>
            <tr><th>주소</th><td>대한민국</td></tr>
            <tr><th>업태/종목</th><td>제조업 / 부품가공</td></tr>
          </table>
        </td>
        <td style="width:50%;padding-left:6px;vertical-align:top">
          <table class="info" style="width:100%">
            <tr><th colspan="2" style="background:#374151;color:#fff;text-align:center">공급받는 자</th></tr>
            <tr><th>상호/성명</th><td>${buyerName}</td></tr>
            <tr><th>이메일</th><td>${order.user_email ? esc(order.user_email) : '—'}</td></tr>
            <tr><th>결제상태</th><td>${order.payment_status === 'paid' ? '✅ 결제완료' : '⏳ 미결제'}</td></tr>
            <tr><th>납기예정</th><td>${fmtDate(order.estimated_delivery_at)}</td></tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- 품목 내역 -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px" class="items">
      <thead>
        <tr>
          <th style="width:40%">품목명</th>
          <th>수량</th>
          <th>단가 (원)</th>
          <th>공급가액 (원)</th>
          <th>세액 (원)</th>
          <th>합계 (원)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="text-align:left;padding-left:10px">${esc(order.part_name)}</td>
          <td>${won(order.quantity)}개</td>
          <td>${won(Math.round(supplyAmt / order.quantity))}</td>
          <td>${won(supplyAmt)}</td>
          <td>${won(vatAmt)}</td>
          <td>${won(order.total_price_krw)}</td>
        </tr>
        <tr class="total-row">
          <td colspan="3" style="text-align:right;padding-right:10px">합 계</td>
          <td>${won(supplyAmt)}</td>
          <td>${won(vatAmt)}</td>
          <td style="color:#1e3a5f;font-size:14px">${won(order.total_price_krw)}</td>
        </tr>
      </tbody>
    </table>

    <!-- 금액 요약 -->
    <table class="info" style="margin-bottom:16px">
      <tr>
        <th>공급가액 합계</th>
        <td><strong>₩${won(supplyAmt)}</strong></td>
        <th>부가세 (10%)</th>
        <td><strong>₩${won(vatAmt)}</strong></td>
        <th>청구금액 합계</th>
        <td style="color:#1e3a5f;font-size:15px;font-weight:900">₩${won(order.total_price_krw)}</td>
      </tr>
    </table>

    <!-- 직인 -->
    <div style="display:flex;justify-content:flex-end;padding-right:40px;margin-bottom:16px">
      <div style="text-align:center">
        <div style="font-size:11px;color:#555;margin-bottom:6px">공급자 확인</div>
        <div class="stamp">발행<br>완료</div>
        <div style="font-size:10px;color:#9ca3af;margin-top:4px">${esc(order.manufacturer_name)}</div>
      </div>
    </div>

    <div class="footer-note">
      본 세금계산서는 NexyFab 플랫폼을 통해 발행되었습니다. 문의: nexyfab@nexysys.com<br>
      주문번호: ${esc(orderId)} | 주문상태: ${esc(order.status)}
    </div>
  </div>
</div>

<div class="no-print" style="max-width:820px;margin:16px auto;display:flex;gap:10px">
  <button onclick="window.print()"
    style="flex:1;padding:12px;background:#1e3a5f;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">
    🖨️ PDF로 저장 / 인쇄
  </button>
  <button onclick="window.close()"
    style="padding:12px 20px;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;border-radius:8px;font-size:14px;cursor:pointer">
    닫기
  </button>
</div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="tax-invoice-${orderId}.html"`,
    },
  });
}
