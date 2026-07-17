/**
 * design-net.ts — 체인 리포트용 "설계 타당성 그물" 요약 + REV.
 * 위시빌더 정합 원칙의 체인 확장: 체인 HTML(하중경로·피난·조경·옹벽)에도 설계 패키지와
 * 동일한 어셈블리 해시(REV)와 그물 판정(부유·간섭·배관·슬리브)을 박아, 문서 간 기준
 * 불일치(REV B 카드 vs REV C 도면 류)를 눈으로 잡을 수 있게 한다.
 * REV 산식은 package 라우트와 동일: sha1({a: assembly, d: domain}) 상위 8자.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export type DesignNet = {
  designOk: boolean | null;
  floating: string[];
  interferences: number;
  routes: number;
  sleeves: number;
  pipeErrors: number;
};

type BuiltLite = {
  ok: boolean;
  designOk?: boolean | null;
  support?: { floating: string[] };
  interferences?: unknown[];
  pipes?: { routes: unknown[]; sleeves?: unknown[]; errors: string[] } | null;
};

export async function designNet(assembly: unknown, domain: string): Promise<{ net: DesignNet | null; rev: string }> {
  let net: DesignNet | null = null;
  let rev = '';
  if (!assembly || typeof assembly !== 'object') return { net, rev };
  try {
    rev = createHash('sha1').update(JSON.stringify({ a: assembly, d: domain })).digest('hex').slice(0, 8);
    const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'assembly.mjs');
    const am = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as { buildAssembly: (a: unknown) => BuiltLite };
    const built = am.buildAssembly(assembly);
    if (built.ok) {
      net = {
        designOk: built.designOk ?? null,
        floating: built.support?.floating ?? [],
        interferences: built.interferences?.length ?? 0,
        routes: built.pipes?.routes?.length ?? 0,
        sleeves: built.pipes?.sleeves?.length ?? 0,
        pipeErrors: built.pipes?.errors?.length ?? 0,
      };
    }
  } catch { /* 그물 요약 실패는 리포트를 막지 않음 — net=null 로 정직 생략 */ }
  return { net, rev };
}
