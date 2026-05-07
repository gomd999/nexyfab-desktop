import { NextRequest, NextResponse } from 'next/server';
import { sanitizeText } from '@/app/lib/sanitize';
import { sendNotificationEmail } from '@/app/lib/mailer';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { recordMetric } from '@/lib/partner-metrics';
import { normPartnerEmail } from '@/lib/partner-factory-access';

export const dynamic = 'force-dynamic';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@nexyfab.com';


type ReviewRow = {
  id: string; contract_id: string; partner_email: string; reviewer_email: string;
  rating: number; cat_deadline: number; cat_quality: number; cat_communication: number;
  comment: string; reviewed_at: string;
};

function rowToReview(r: ReviewRow) {
  return {
    id: r.id,
    contractId: r.contract_id,
    partnerEmail: r.partner_email,
    reviewerEmail: r.reviewer_email,
    rating: r.rating,
    categories: { deadline: r.cat_deadline, quality: r.cat_quality, communication: r.cat_communication },
    comment: r.comment,
    reviewedAt: r.reviewed_at,
  };
}


// ── GET /api/reviews ──────────────────────────────────────────────────────────
// ?partnerEmail=xxx
// ?summary=1&partnerEmail=xxx
// ?contractId=xxx

export async function GET(req: NextRequest) {

  const db = getDbAdapter();
  const { searchParams } = req.nextUrl;
  const partnerEmail = searchParams.get('partnerEmail');
  const contractId = searchParams.get('contractId');
  const summary = searchParams.get('summary');

  if (contractId) {
    const row = await db.queryOne<ReviewRow>(
      'SELECT * FROM nf_reviews WHERE contract_id = ?', contractId,
    ).catch(() => null);
    return NextResponse.json({ review: row ? rowToReview(row) : null });
  }

  if (partnerEmail) {
    const pe = normPartnerEmail(partnerEmail);
    const rows = await db.queryAll<ReviewRow>(
      `SELECT * FROM nf_reviews
       WHERE partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?
       ORDER BY reviewed_at DESC`,
      pe,
    ).catch((): ReviewRow[] => []);

    if (summary === '1') {
      const count = rows.length;
      if (count === 0) {
        return NextResponse.json({ avgRating: 0, avgDeadline: 0, avgQuality: 0, avgCommunication: 0, count: 0 });
      }
      const avg = (vals: number[]) => Math.round((vals.reduce((s, v) => s + v, 0) / count) * 10) / 10;
      return NextResponse.json({
        avgRating: avg(rows.map(r => r.rating)),
        avgDeadline: avg(rows.map(r => r.cat_deadline)),
        avgQuality: avg(rows.map(r => r.cat_quality)),
        avgCommunication: avg(rows.map(r => r.cat_communication)),
        count,
      });
    }

    return NextResponse.json({ reviews: rows.map(rowToReview) });
  }

  const rows = await db.queryAll<ReviewRow>(
    'SELECT * FROM nf_reviews ORDER BY reviewed_at DESC LIMIT 200',
  ).catch((): ReviewRow[] => []);
  return NextResponse.json({ reviews: rows.map(rowToReview) });
}

// ── POST /api/reviews ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: '요청 데이터가 올바르지 않습니다.' }, { status: 400 });
  }

  const { contractId, partnerEmail, rating, categories, comment } = body;
  const reviewerEmail = authUser.email;

  if (!contractId || !partnerEmail || !rating) {
    return NextResponse.json({ error: 'contractId, partnerEmail, rating은 필수입니다.' }, { status: 400 });
  }
  if (rating < 1 || rating > 5) {
    return NextResponse.json({ error: '평점은 1~5 사이여야 합니다.' }, { status: 400 });
  }

  // Verify contract/order exists
  const db = getDbAdapter();
  const contractRow = await db.queryOne<{ status: string }>(
    'SELECT status FROM nf_contracts WHERE id = ?', contractId,
  ).catch(() => null);

  // nf_contracts에 없으면 nf_orders에서 검색 (주문 기반 리뷰)
  if (!contractRow) {
    const orderRow = await db.queryOne<{ status: string; partner_email: string | null; manufacturer_name: string }>(
      'SELECT status, partner_email, manufacturer_name FROM nf_orders WHERE id = ?', contractId,
    ).catch(() => null);
    if (!orderRow) {
      return NextResponse.json({ error: '해당 계약 또는 주문을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (orderRow.status !== 'delivered') {
      return NextResponse.json({ error: '납품 완료된 주문에만 리뷰를 작성할 수 있습니다.' }, { status: 403 });
    }
    // partnerEmail을 주문에서 자동 추출
    if (!partnerEmail) {
      body.partnerEmail = orderRow.partner_email ?? orderRow.manufacturer_name;
    }
  } else if (contractRow.status !== 'completed') {
    return NextResponse.json({ error: '완료된 계약에만 리뷰를 작성할 수 있습니다.' }, { status: 403 });
  }


  // Duplicate check
  const duplicate = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_reviews WHERE contract_id = ?', contractId,
  ).catch(() => null);
  if (duplicate) {
    return NextResponse.json({ error: '이미 해당 계약에 대한 리뷰가 존재합니다.' }, { status: 409 });
  }

  const id = `REV-${Date.now()}`;
  const now = new Date().toISOString();
  const safeComment = comment ? sanitizeText(comment, 1000) : '';
  const partnerEmailNorm = normPartnerEmail(partnerEmail);

  await db.execute(
    `INSERT INTO nf_reviews
     (id, contract_id, partner_email, reviewer_email, rating, cat_deadline, cat_quality, cat_communication, comment, reviewed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id, contractId, partnerEmailNorm, reviewerEmail, rating,
    categories?.deadline ?? rating,
    categories?.quality ?? rating,
    categories?.communication ?? rating,
    safeComment, now,
  );

  const newReview = {
    id, contractId, partnerEmail: partnerEmailNorm, reviewerEmail, rating,
    categories: {
      deadline: categories?.deadline ?? rating,
      quality: categories?.quality ?? rating,
      communication: categories?.communication ?? rating,
    },
    comment: safeComment, reviewedAt: now,
  };

  // 제조사 평점 업데이트 (fire-and-forget)
  const finalPartnerEmail = normPartnerEmail(body.partnerEmail ?? partnerEmail);
  if (finalPartnerEmail) {
    db.queryAll<{ rating: number }>(
      `SELECT rating FROM nf_reviews
       WHERE partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?`,
      finalPartnerEmail,
    ).then(rows => {
      if (!rows.length) return;
      const avg = rows.reduce((s, r) => s + r.rating, 0) / rows.length;
      const rounded = Math.round(avg * 10) / 10;
      db.execute(
        `UPDATE nf_factories SET rating = ?, review_count = ?, updated_at = ?
         WHERE (contact_email IS NOT NULL AND LOWER(TRIM(contact_email)) = ?)
            OR (partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?)`,
        rounded, rows.length, Date.now(), finalPartnerEmail, finalPartnerEmail,
      ).catch(() => {});
    }).catch(() => {});

    // 다차원 지표 로깅 — getPartnerMetrics() 가 읽는 append-only 이벤트
    void recordMetric({
      partnerEmail:         finalPartnerEmail,
      kind:                 'review_received',
      reviewId:             id,
      rating,
      qualityRating:        categories?.quality        ?? rating,
      communicationRating:  categories?.communication  ?? rating,
      deadlineRating:       categories?.deadline       ?? rating,
    });
  }

  // Admin notification (fire-and-forget)
  sendNotificationEmail(
    ADMIN_EMAIL,
    `[NexyFab] 파트너 평가 접수 - ${partnerEmail} (${rating}점)`,
    `<h2 style="color:#1a56db">파트너 평가가 접수되었습니다</h2>
<table style="border-collapse:collapse;width:100%;font-size:14px">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;background:#f9fafb;width:130px">계약 ID</td><td style="padding:8px;border:1px solid #e5e7eb">${contractId}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;background:#f9fafb">파트너 이메일</td><td style="padding:8px;border:1px solid #e5e7eb">${partnerEmail}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;background:#f9fafb">평점</td><td style="padding:8px;border:1px solid #e5e7eb">★ ${rating} / 5</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;background:#f9fafb">평가자</td><td style="padding:8px;border:1px solid #e5e7eb">${reviewerEmail}</td></tr>
  ${safeComment ? `<tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;background:#f9fafb">코멘트</td><td style="padding:8px;border:1px solid #e5e7eb">${safeComment.slice(0, 200)}</td></tr>` : ''}
</table>
<p style="margin-top:16px;color:#6b7280;font-size:12px">— NexyFab 어드민 자동 알림</p>`,
  ).catch(e => console.error('[reviews POST] 어드민 알림 발송 실패:', e));

  return NextResponse.json({ review: newReview }, { status: 201 });
}

// ── DELETE /api/reviews?id=xxx (admin use) ────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDbAdapter();
  const result = await db.execute('DELETE FROM nf_reviews WHERE id = ?', id);
  if (result.changes === 0) return NextResponse.json({ error: '리뷰를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
