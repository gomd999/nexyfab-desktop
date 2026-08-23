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
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_BODY_BYTES = 32 * 1024 * 1024;

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
    format?: string; title?: string;
  };
  try {
    body = await readBoundedJson<typeof body>(req, MAX_BODY_BYTES);
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, error: '검증 입력이 너무 큽니다.' }, { status: 413 });
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
    // format=html — 옹벽 안정 검토 인쇄양식 리포트 (chain-reports)
    if (body.format === 'html' && body.calculatorId === 'retaining_wall_stability') {
      const { join: j2 } = await import('node:path');
      const { pathToFileURL: p2 } = await import('node:url');
      const rpt = (await import(/* webpackIgnore: true */ p2(j2(process.cwd(), 'scripts', 'drawing-to-3d', 'chain-reports.mjs')).href)) as { retainingWallReport: (r: unknown, o?: Record<string, unknown>) => string };
      let svg = '';
      try {
        const sp3 = j2(process.cwd(), 'scripts', 'drawing-to-3d', 'section-drawings.mjs');
        const sd = (await import(/* webpackIgnore: true */ p2(sp3).href)) as { retainingWallSectionSvg: (p: unknown, o?: Record<string, unknown>) => string };
        const wall = (body as { assembly?: { parts?: Array<{ role?: string; params?: unknown }> } }).assembly?.parts?.find((x) => x.role === 'wall' || x.role === 'stem');
        const meta = (body as { assembly?: { wallParams?: unknown } }).assembly?.wallParams ?? (body as { wallParams?: unknown }).wallParams ?? wall?.params;
        if (meta) svg = sd.retainingWallSectionSvg(meta);
      } catch { /* 도면 실패는 비치명 */ }
      const { designNet } = await import('@/lib/design-net');
      const { net, rev } = await designNet((body as { assembly?: unknown }).assembly, 'civil');
      return NextResponse.json({ result, html: rpt.retainingWallReport(result, { title: body.title ?? '옹벽 안정 검토', svg, net, rev }) });
    }
    // 옹벽: 입력 기하 5키가 모두 있으면 편집형 단면도 동봉(m→mm 변환 — 기본값 날조 방지 위해 부분입력 시 미동봉)
    // 단, 게이트 실패(ok:false — 범위위반 등) 결과엔 미동봉: 퇴화 기하로 "999000" 같은 깨진 SVG가 나오므로.
    let drawingSvg: string | null = null;
    const resultOk = (result as { ok?: boolean } | null)?.ok !== false;
    if (resultOk && body.calculatorId === 'retaining_wall_stability' && body.params) {
      const pr = body.params as Record<string, number>;
      const keys = ['H', 'baseWidth', 'baseThickness', 'stemThickness', 'toeLength'];
      if (keys.every((k) => Number(pr[k]) > 0)) {
        try {
          const sp3 = join(process.cwd(), 'scripts', 'drawing-to-3d', 'section-drawings.mjs');
          const sd = (await import(/* webpackIgnore: true */ pathToFileURL(sp3).href)) as { retainingWallSectionSvg: (p: unknown) => string };
          drawingSvg = sd.retainingWallSectionSvg({
            H: pr.H * 1000, baseWidth: pr.baseWidth * 1000, baseThickness: pr.baseThickness * 1000,
            stemThickness: pr.stemThickness * 1000, toeLength: pr.toeLength * 1000,
          });
        } catch { /* 도면 실패는 비치명 */ }
      }
    }
    return NextResponse.json(drawingSvg ? { ...(result as Record<string, unknown>), drawingSvg } : result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'verify failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 502 });
  }
}
