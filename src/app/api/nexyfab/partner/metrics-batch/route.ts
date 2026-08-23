/**
 * POST /api/nexyfab/partner/metrics-batch
 *
 * 여러 공급사 이메일을 한 번에 받아 다차원 지표를 반환.
 * supplier-matcher 결과 UI 에서 top-3 / top-8 공급사 지표를 동시에 렌더링할 때
 * N번 개별 호출 대신 이 배치 엔드포인트 사용.
 *
 * Body: { emails: string[], windowDays?: number }
 *       emails 최대 20건
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPartnerMetrics } from '@/lib/partner-metrics';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync, rateLimitHeaders } from '@/lib/rate-limit';
import { checkPlan } from '@/lib/plan-guard';
import { resolveServerLocale } from '@/lib/i18n/serverLocale';
import type { IsoLang } from '@/lib/i18n/normalize';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_PARTNER_METRICS_BODY_BYTES = 16 * 1024;

export const dynamic = 'force-dynamic';

const MAX_EMAILS = 20;

interface FactoryPublicRow {
  partner_email: string | null;
  contact_email: string | null;
  name: string;
  rating: number | null;
  certifications: string | null;
  created_at: number | null;
}

const COPY: Record<IsoLang, { emailsRequired: string; noValidEmails: string; rateLimited: string; forbidden: string; certification: (count: number) => string; experience: (years: number) => string; newPartner: string }> = {
  ko: { emailsRequired: '이메일 배열이 필요합니다.', noValidEmails: '유효한 이메일이 없습니다.', rateLimited: '요청이 너무 많습니다.', forbidden: '허용되지 않은 요청 출처입니다.', certification: n => `인증 ${n}개 보유`, experience: n => `경력 ${n}년+`, newPartner: '신규 파트너' },
  en: { emailsRequired: 'An email array is required.', noValidEmails: 'No valid emails were provided.', rateLimited: 'Too many requests.', forbidden: 'The request origin is not allowed.', certification: n => `${n} certification${n === 1 ? '' : 's'}`, experience: n => `${n}+ years of experience`, newPartner: 'New partner' },
  ja: { emailsRequired: 'メールアドレスの配列が必要です。', noValidEmails: '有効なメールアドレスがありません。', rateLimited: 'リクエストが多すぎます。', forbidden: '許可されていないリクエスト元です。', certification: n => `認証 ${n}件`, experience: n => `経験 ${n}年以上`, newPartner: '新規パートナー' },
  zh: { emailsRequired: '需要电子邮件数组。', noValidEmails: '没有有效的电子邮件。', rateLimited: '请求过多。', forbidden: '不允许该请求来源。', certification: n => `${n} 项认证`, experience: n => `${n} 年以上经验`, newPartner: '新合作伙伴' },
  es: { emailsRequired: 'Se requiere una lista de correos.', noValidEmails: 'No se proporcionaron correos válidos.', rateLimited: 'Demasiadas solicitudes.', forbidden: 'El origen de la solicitud no está permitido.', certification: n => `${n} certificación${n === 1 ? '' : 'es'}`, experience: n => `${n}+ años de experiencia`, newPartner: 'Socio nuevo' },
  ar: { emailsRequired: 'مصفوفة البريد الإلكتروني مطلوبة.', noValidEmails: 'لم يتم تقديم عناوين بريد صالحة.', rateLimited: 'طلبات كثيرة جدًا.', forbidden: 'مصدر الطلب غير مسموح.', certification: n => `${n} شهادة`, experience: n => `خبرة ${n}+ سنوات`, newPartner: 'شريك جديد' },
};

export async function POST(req: NextRequest) {
  let body: { emails?: unknown; windowDays?: unknown; lang?: unknown } = {};
  try { body = await readBoundedJson(req, MAX_PARTNER_METRICS_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  }
  const locale = resolveServerLocale(req, body.lang);
  const copy = COPY[locale.iso];
  if (!checkOrigin(req)) return NextResponse.json({ error: copy.forbidden }, { status: 403 });
  const plan = await checkPlan(req, 'free');
  if (!plan.ok) return plan.response;
  const limit = await rateLimitAsync(
    `partner-metrics:${getTrustedClientIp(req.headers)}`, 60, 60 * 1000,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: copy.rateLimited },
      { status: 429, headers: rateLimitHeaders(limit, 60) },
    );
  }
  if (!Array.isArray(body.emails) || body.emails.length === 0) {
    return NextResponse.json({ error: copy.emailsRequired }, { status: 400 });
  }

  const emails = body.emails
    .filter((e): e is string => typeof e === 'string' && e.length <= 254 && e.includes('@'))
    .map((email) => email.trim().toLowerCase())
    .slice(0, MAX_EMAILS);

  if (emails.length === 0) {
    return NextResponse.json({ error: copy.noValidEmails }, { status: 400 });
  }

  const windowDaysRaw = Number(body.windowDays ?? 90);
  const windowDays = Number.isFinite(windowDaysRaw) && windowDaysRaw >= 7 && windowDaysRaw <= 365
    ? windowDaysRaw : 90;

  // 공급사 기본 정보 배치 조회 — 단일 쿼리로 처리
  const db = getDbAdapter();
  const placeholders = emails.map(() => '?').join(', ');
  const factories = await db.queryAll<FactoryPublicRow>(
    `SELECT partner_email, contact_email, name, rating, certifications, created_at
       FROM nf_factories
       WHERE partner_email IN (${placeholders}) OR contact_email IN (${placeholders})`,
    ...emails, ...emails,
  ).catch((): FactoryPublicRow[] => []);

  const factoryByEmail = new Map<string, FactoryPublicRow>();
  for (const f of factories) {
    if (f.partner_email) factoryByEmail.set(f.partner_email, f);
    if (f.contact_email && !factoryByEmail.has(f.contact_email)) {
      factoryByEmail.set(f.contact_email, f);
    }
  }

  // 지표는 병렬 조회 — getPartnerMetrics 는 read-only 이므로 경합 없음
  const results = await Promise.all(emails.map(async (email) => {
    const factory = factoryByEmail.get(email);
    const metrics = await getPartnerMetrics(email, windowDays);

    let certs: string[] = [];
    try { certs = factory?.certifications ? JSON.parse(factory.certifications) : []; } catch { /* ignore */ }

    const ageDays = factory?.created_at
      ? Math.floor((Date.now() - Number(factory.created_at)) / 86_400_000)
      : 0;
    const isColdStart = metrics.reviewCount === 0 && metrics.onTimeCount === 0;

    const coldStartBadges: string[] = [];
    if (isColdStart) {
      if (certs.length > 0) coldStartBadges.push(copy.certification(certs.length));
      if (ageDays >= 365) coldStartBadges.push(copy.experience(Math.floor(ageDays / 365)));
      if (coldStartBadges.length === 0) coldStartBadges.push(copy.newPartner);
    }

    return {
      partnerEmail:  email,
      displayName:   factory?.name ?? null,
      metrics: {
        onTimeRate:         metrics.onTimeRate,
        onTimeCount:        metrics.onTimeCount,
        lateCount:          metrics.lateCount,
        avgLeadTimeDays:    metrics.avgLeadTimeDays,
        avgResponseMinutes: metrics.avgResponseMinutes,
        responseSamples:    metrics.responseSamples,
        qualityAvg:         metrics.qualityAvg,
        communicationAvg:   metrics.communicationAvg,
        deadlineRatingAvg:  metrics.deadlineRatingAvg,
        reviewCount:        metrics.reviewCount,
        reorderRate:        metrics.reorderRate,
        defectCount:        metrics.defectCount,
        defectResolvedCount:metrics.defectResolvedCount,
        defectResolutionRate: metrics.defectResolutionRate,
      },
      coldStart: {
        isColdStart,
        badges: coldStartBadges,
        certifications: certs,
        ageDays,
      },
    };
  }));

  return NextResponse.json({
    windowDays,
    partners: results,
  });
}
