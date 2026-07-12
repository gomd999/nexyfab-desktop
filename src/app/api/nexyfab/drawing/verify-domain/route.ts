/**
 * GET  /api/nexyfab/drawing/verify-domain  → 분야·계산기·입력 명세(정적 메타)
 * POST /api/nexyfab/drawing/verify-domain  → { intent, domain, calculatorId, memberRef?, params?, standardId? }
 *                                            → 형상 파생 + 사용자 하중/재료 → 진짜 계산기 실행 결과
 *
 * ②(분야 상시검증). 형상이 줄 수 있는 입력(단면특성·경간)은 section-props로 결정론
 * 파생, 하중·재료만 사용자 입력. engineering-core의 실제 계산기를 돌려 verdict/checks/
 * refs/disclaimer를 그대로 반환. 하중 누락 시 needInputs로 폼 유도(값 지어내지 않음).
 *
 * 구현: domain-verify.mjs를 webpackIgnore 런타임 import(다른 drawing 라우트와 동일).
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type DomainModule = {
  listDomains: () => unknown;
  verifyDomain: (spec: {
    intent: unknown; domain: string; calculatorId: string;
    memberRef?: string | number; params?: Record<string, number>; standardId?: string;
  }) => unknown;
};

let _mod: DomainModule | null = null;
async function loadDomain(): Promise<DomainModule> {
  if (_mod) return _mod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'domain-verify.mjs');
  _mod = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as DomainModule;
  return _mod;
}

export async function GET(): Promise<NextResponse> {
  try {
    const mod = await loadDomain();
    return NextResponse.json({ ok: true, domains: mod.listDomains() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'load failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-verify-domain:${ip}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: {
    list?: boolean; intent?: unknown; domain?: string; calculatorId?: string;
    memberRef?: string | number; params?: Record<string, number>; standardId?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  let mod: DomainModule;
  try {
    mod = await loadDomain();
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'load failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }

  if (body.list) return NextResponse.json({ ok: true, domains: mod.listDomains() });

  if (!body.intent || !body.domain || !body.calculatorId) {
    return NextResponse.json({ ok: false, error: 'intent, domain, calculatorId가 필요합니다.' }, { status: 400 });
  }

  try {
    const result = mod.verifyDomain({
      intent: body.intent,
      domain: body.domain,
      calculatorId: body.calculatorId,
      memberRef: body.memberRef,
      params: body.params ?? {},
      standardId: body.standardId ?? 'KDS',
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'verify failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 502 });
  }
}
