/**
 * M2 — Partner profile preview.
 *
 * GET /api/nexyfab/partner/{email}/preview
 *   → { partner: { name, region, processes, certifications, ageDays,
 *                  metrics: { onTimeRate, qualityAvg, ... },
 *                  recentReviewSnippets } }
 *
 * Designed for the "before you send the RFQ, who is this manufacturer?"
 * card. Combines factory directory data + multi-dim metrics + a few
 * recent review excerpts so the buyer can decide in 5 seconds whether
 * to include this partner in the RFQ.
 *
 * Public endpoint (no auth) — partner profiles are listed in the public
 * factory directory anyway, this just adds metric context.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getPartnerMetrics } from '@/lib/partner-metrics';
import { normPartnerEmail } from '@/lib/partner-factory-access';
import { resolveServerLocale } from '@/lib/i18n/serverLocale';
import type { IsoLang } from '@/lib/i18n/normalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface FactoryRow {
  id: string;
  name: string;
  region: string | null;
  industry: string | null;
  processes: string | null;       // JSON array
  certifications: string | null;  // JSON array
  partner_email: string | null;
  contact_email: string | null;
  rating: number | null;
  created_at: number | null;
  description: string | null;
}

interface ReviewSnippetRow {
  rating: number;
  cat_deadline: number;
  cat_quality: number;
  cat_communication: number;
  comment: string | null;
  reviewed_at: string;
}

const COPY: Record<IsoLang, {
  invalid: string;
  notFound: string;
  certification: (count: number) => string;
  experience: (years: number) => string;
  newPartner: string;
}> = {
  ko: { invalid: '유효한 이메일 또는 공장 ID가 필요합니다.', notFound: '파트너를 찾을 수 없습니다.', certification: n => `인증 ${n}개`, experience: n => `경력 ${n}년+`, newPartner: '신규 파트너' },
  en: { invalid: 'A valid email or factory ID is required.', notFound: 'Partner not found.', certification: n => `${n} certification${n === 1 ? '' : 's'}`, experience: n => `${n}+ years of experience`, newPartner: 'New partner' },
  ja: { invalid: '有効なメールアドレスまたは工場IDが必要です。', notFound: 'パートナーが見つかりません。', certification: n => `認証 ${n}件`, experience: n => `経験 ${n}年以上`, newPartner: '新規パートナー' },
  zh: { invalid: '需要有效的电子邮件或工厂 ID。', notFound: '未找到合作伙伴。', certification: n => `${n} 项认证`, experience: n => `${n} 年以上经验`, newPartner: '新合作伙伴' },
  es: { invalid: 'Se requiere un correo o ID de fábrica válido.', notFound: 'No se encontró el socio.', certification: n => `${n} certificación${n === 1 ? '' : 'es'}`, experience: n => `${n}+ años de experiencia`, newPartner: 'Socio nuevo' },
  ar: { invalid: 'يلزم بريد إلكتروني أو معرّف مصنع صالح.', notFound: 'لم يتم العثور على الشريك.', certification: n => `${n} شهادة`, experience: n => `خبرة ${n}+ سنوات`, newPartner: 'شريك جديد' },
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ email: string }> }) {
  const locale = resolveServerLocale(req, req.nextUrl.searchParams.get('lang'));
  const copy = COPY[locale.iso];
  const { email } = await params;
  const decoded = decodeURIComponent(email);
  const norm = normPartnerEmail(decoded);
  // Accept either an email or a factory id in the path. The factory
  // directory at /factories knows the id but not always the email; the
  // RFQ thread flow knows the email but not always the id. We resolve
  // by trying both.
  const looksLikeEmail = norm.includes('@');
  const looksLikeId = !looksLikeEmail && /^[a-zA-Z0-9_-]{4,80}$/.test(decoded);
  if (!looksLikeEmail && !looksLikeId) {
    return NextResponse.json({ error: copy.invalid }, { status: 400 });
  }

  const db = getDbAdapter();
  const factory = await db.queryOne<FactoryRow>(
    `SELECT id, name, region, industry, processes, certifications, partner_email,
            contact_email, rating, created_at, description
       FROM nf_factories
      WHERE LOWER(TRIM(partner_email)) = ? OR LOWER(TRIM(contact_email)) = ? OR id = ?
      LIMIT 1`,
    norm, norm, decoded,
  ).catch(() => null);

  if (!factory) {
    return NextResponse.json({ error: copy.notFound }, { status: 404 });
  }

  let processes: string[] = [];
  let certs: string[] = [];
  try { processes = factory.processes ? JSON.parse(factory.processes) : []; } catch { /* skip */ }
  try { certs = factory.certifications ? JSON.parse(factory.certifications) : []; } catch { /* skip */ }

  const ageDays = factory.created_at
    ? Math.floor((Date.now() - Number(factory.created_at)) / 86_400_000)
    : 0;

  const metrics = await getPartnerMetrics(norm, 90);

  // Pull up to 3 most-recent review snippets — gives the buyer a flavor
  // beyond raw scores.
  const reviewRows = await db.queryAll<ReviewSnippetRow>(
    `SELECT rating, cat_deadline, cat_quality, cat_communication, comment, reviewed_at
       FROM nf_reviews
      WHERE LOWER(TRIM(partner_email)) = ?
        AND comment IS NOT NULL AND LENGTH(comment) > 5
   ORDER BY reviewed_at DESC LIMIT 3`,
    norm,
  ).catch((): ReviewSnippetRow[] => []);

  // Cold-start logic: when no metrics exist, surface trust signals
  // (certifications, age) so a brand-new partner isn't dismissed.
  const isColdStart = metrics.reviewCount === 0 && metrics.onTimeCount === 0;
  const coldStartBadges: string[] = [];
  if (isColdStart) {
    if (certs.length > 0) coldStartBadges.push(copy.certification(certs.length));
    if (ageDays >= 365) coldStartBadges.push(copy.experience(Math.floor(ageDays / 365)));
    if (coldStartBadges.length === 0) coldStartBadges.push(copy.newPartner);
  }

  return NextResponse.json({
    ok: true,
    partner: {
      id: factory.id,
      name: factory.name,
      region: factory.region,
      industry: factory.industry,
      description: factory.description,
      processes,
      certifications: certs,
      partnerEmail: factory.partner_email ?? factory.contact_email,
      ageDays,
      isColdStart,
      coldStartBadges,
      metrics: {
        onTimeRate: metrics.onTimeRate,
        avgLeadTimeDays: metrics.avgLeadTimeDays,
        avgResponseMinutes: metrics.avgResponseMinutes,
        responseSamples: metrics.responseSamples,
        qualityAvg: metrics.qualityAvg,
        communicationAvg: metrics.communicationAvg,
        deadlineRatingAvg: metrics.deadlineRatingAvg,
        reviewCount: metrics.reviewCount,
        reorderRate: metrics.reorderRate,
        defectResolutionRate: metrics.defectResolutionRate,
      },
      recentReviews: reviewRows.map(r => ({
        rating: r.rating,
        deadline: r.cat_deadline,
        quality: r.cat_quality,
        communication: r.cat_communication,
        comment: r.comment,
        reviewedAt: r.reviewed_at,
      })),
    },
  });
}
