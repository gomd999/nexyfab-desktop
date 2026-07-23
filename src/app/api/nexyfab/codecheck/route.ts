/**
 * GET  /api/nexyfab/codecheck  → 룰 카탈로그(정적 메타: id·category·clause·source·requirement)
 * POST /api/nexyfab/codecheck  → { features } → 결정론 코드체크 리포트
 *                                { results[], passCount, failCount, naCount, violations[], disclaimer }
 *
 * 차별화: 학습모델 감리가 아니라 실제 공개 법령 조항을 인용하는 결정론 규칙. 피처 미제공 = NA
 * (준수로 가정하지 않음). 비법정 감리 보조 — disclaimer를 항상 동봉.
 *
 * 순수 로직(eng-domain/codecheck)만 사용 — OCCT/파일 I/O 없음. webpackIgnore 불필요.
 */
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { CODECHECK_RULES, runCodeCheck, sanitizeCodeCheckFeatures, type CodeCheckFeatures } from '@/lib/eng-domain/codecheck';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** static catalog: what each rule checks + which clause it cites (traceability). */
function catalog() {
  return CODECHECK_RULES.map((r) => ({
    id: r.id,
    category: r.category,
    clause: r.clause,
    source: r.source,
    requirement: r.requirement,
  }));
}

export function GET(): NextResponse {
  return NextResponse.json({ ok: true, rules: catalog() });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`codecheck:${ip}`, 60, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: { list?: boolean; features?: CodeCheckFeatures };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  if (body.list) return NextResponse.json({ ok: true, rules: catalog() });

  const features = body.features;
  if (!features || typeof features !== 'object') {
    return NextResponse.json({ ok: false, error: 'features 객체가 필요합니다.' }, { status: 400 });
  }

  // sanitize: finite numbers / known enums / booleans only. A non-numeric string on a
  // numeric field (a typo) is DROPPED → NA, never a fabricated NaN-driven FAIL.
  const clean = sanitizeCodeCheckFeatures(features as Record<string, unknown>);

  const report = runCodeCheck(clean);
  return NextResponse.json({ ok: true, ...report });
}
