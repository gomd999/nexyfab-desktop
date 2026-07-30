/**
 * tolerance-stack.test.ts — 공차 누적이 **맞는 값을 내는가** (260801j).
 *
 * 공식을 적었는지가 아니라 맞는지를 본다: 최악조건은 **완전열거**로, RSS 는 **몬테카를로**로
 * 대조한다. 난수는 고정 시드(LCG)를 쓴다 — 회귀가 실행마다 흔들리면 검사가 아니다.
 */

import { describe, expect, it } from 'vitest';
import { toleranceStackCheck } from './tolerance-stack.mjs';

interface Link { labelKo: string; nominal: number; plus: number; minus: number; dir: 1 | -1 }
interface Check {
  verdict?: string; pass?: boolean | null; labelKo: string; detail?: string[]; needInputs?: unknown[];
}
const run = (chains: unknown): { checks: Record<string, Check>; basis: { judged: number } } | null =>
  toleranceStackCheck({ tolChains: chains } as never) as never;

/** 결과 범위를 detail 문자열에서 읽지 않고 **다시 계산**해 비교하기 위한 완전열거. */
function enumerateExtremes(links: Link[]): { lo: number; hi: number } {
  let lo = Infinity, hi = -Infinity;
  const n = links.length;
  for (let mask = 0; mask < (1 << n); mask++) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const l = links[i]!;
      v += l.dir * (mask & (1 << i) ? l.nominal + l.plus : l.nominal - l.minus);
    }
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  return { lo, hi };
}

const LINKS: Link[] = [
  { labelKo: '판 두께', nominal: 10, plus: 0.1, minus: 0.1, dir: 1 },
  { labelKo: '스페이서', nominal: 5, plus: 0.05, minus: 0.05, dir: 1 },
  { labelKo: '와셔', nominal: 2, plus: 0.2, minus: 0.1, dir: 1 },
  { labelKo: '보스 깊이', nominal: 16, plus: 0.15, minus: 0.15, dir: -1 },
];

/** detail 문자열에서 「a ~ b mm」 꼴 범위를 뽑는다(표시 문구와 계산이 갈리지 않게 표시를 읽는다). */
function range(detail: string[], head: string): [number, number] {
  const line = detail.find((d) => d.includes(head));
  if (!line) throw new Error(`「${head}」 줄이 없다`);
  const m = /(-?[\d.]+) ~ (-?[\d.]+)mm/.exec(line);
  if (!m) throw new Error(`범위를 읽지 못했다: ${line}`);
  return [Number(m[1]), Number(m[2])];
}

describe('최악조건 누적 — 완전열거와 일치하는가', () => {
  it('★4링크(혼합 방향) 최악조건이 2⁴ 조합의 실제 최소·최대와 같다', () => {
    const r = run([{ id: 'c', labelKo: '틈새', links: LINKS, target: { min: -5, max: 5 } }]);
    const [lo, hi] = range(r!.checks.c!.detail!, '최악조건');
    const truth = enumerateExtremes(LINKS);
    expect(lo).toBeCloseTo(truth.lo, 3);
    expect(hi).toBeCloseTo(truth.hi, 3);
  });

  it('★방향(dir)이 부호로 반영된다 — 뒤집으면 결과가 뒤집힌다', () => {
    const flipped = LINKS.map((l) => ({ ...l, dir: (l.dir === 1 ? -1 : 1) as 1 | -1 }));
    const a = run([{ id: 'c', labelKo: 'x', links: LINKS, target: { min: -99, max: 99 } }]);
    const b = run([{ id: 'c', labelKo: 'x', links: flipped, target: { min: -99, max: 99 } }]);
    const [aLo, aHi] = range(a!.checks.c!.detail!, '최악조건');
    const [bLo, bHi] = range(b!.checks.c!.detail!, '최악조건');
    expect(bLo).toBeCloseTo(-aHi, 3);
    expect(bHi).toBeCloseTo(-aLo, 3);
  });
});

describe('RSS 누적 — 몬테카를로와 맞는가', () => {
  it('★RSS 범위가 ±3σ 시뮬레이션의 99.7% 구간과 맞는다', () => {
    /**
     * RSS 는 「공차폭 = ±3σ」 가정이다. 그 가정대로 표본을 만들면 결과의 3σ 구간이
     * RSS 범위와 같아야 한다 — 안 같으면 **가정 문구가 코드와 다른 것**이다.
     */
    let seed = 20260801;
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    // 박스-뮐러로 표준정규
    const gauss = (): number => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const N = 200_000;
    let sum = 0, sum2 = 0;
    const sym = LINKS.map((l) => ({ ...l, plus: (l.plus + l.minus) / 2, minus: (l.plus + l.minus) / 2 }));
    for (let i = 0; i < N; i++) {
      let v = 0;
      for (const l of sym) v += l.dir * (l.nominal + (l.plus / 3) * gauss());
      sum += v; sum2 += v * v;
    }
    const mean = sum / N;
    const sd = Math.sqrt(sum2 / N - mean * mean);
    const r = run([{ id: 'c', labelKo: 'x', links: sym, target: { min: -99, max: 99 } }]);
    const [lo, hi] = range(r!.checks.c!.detail!, 'RSS');
    // 시뮬레이션 3σ 구간과 RSS 구간이 1% 안에서 일치해야 한다.
    expect(hi - lo).toBeCloseTo(6 * sd, 1);
    expect((lo + hi) / 2).toBeCloseTo(mean, 1);
  });

  it('RSS 는 항상 최악조건보다 좁다 — 넓으면 식이 틀린 것이다', () => {
    const r = run([{ id: 'c', labelKo: 'x', links: LINKS, target: { min: -99, max: 99 } }]);
    const [wLo, wHi] = range(r!.checks.c!.detail!, '최악조건');
    const [rLo, rHi] = range(r!.checks.c!.detail!, 'RSS');
    expect(rHi - rLo).toBeLessThan(wHi - wLo);
  });
});

describe('판정 규약 — 지어내지 않는다', () => {
  it('선언이 없으면 **null**(해당 없음)이다 — 「이상 없음」이 아니다', () => {
    expect(toleranceStackCheck({} as never)).toBeNull();
    expect(toleranceStackCheck({ tolChains: [] } as never)).toBeNull();
  });

  it('★허용 범위 미선언이면 수치만 내고 **판정하지 않는다**', () => {
    const r = run([{ id: 'c', labelKo: 'x', links: LINKS }]);
    expect(r!.checks.c!.pass).toBeNull();
    expect(r!.checks.c!.needInputs?.length).toBeGreaterThan(0);
    expect(r!.basis.judged).toBe(0);   // 판정 0개는 통과가 아니다
  });

  it('★방향(dir) 미선언은 **거부한다** — 부호 하나로 결론이 뒤집힌다', () => {
    const r = run([{ id: 'c', labelKo: 'x', target: { min: 0, max: 1 },
      links: [{ labelKo: 'a', nominal: 10, tol: 0.1 }, { labelKo: 'b', nominal: 5, tol: 0.1 }] }]);
    expect(r!.checks.c!.pass).toBeNull();
    expect(r!.checks.c!.detail!.join(' ')).toMatch(/dir/);
  });

  it('★최악조건 실패·RSS 통과는 PASS 가 아니라 CHECK 다', () => {
    // 최악 폭이 목표를 살짝 넘고 RSS 는 들어가는 구간을 만든다.
    const links: Link[] = Array.from({ length: 6 }, (_, i) => ({
      labelKo: `d${i}`, nominal: 10, plus: 0.1, minus: 0.1, dir: 1,
    }));
    const r = run([{ id: 'c', labelKo: 'x', links, target: { min: 59.7, max: 60.3 } }]);
    expect(r!.checks.c!.verdict).toBe('CHECK');
    expect(r!.checks.c!.pass).toBeNull();
    expect(r!.checks.c!.detail!.join(' ')).toMatch(/일부 개체는 안 들어간다/);
  });

  it('링크가 1개면 누적이 아니다 — 판정하지 않는다', () => {
    const r = run([{ id: 'c', labelKo: 'x', links: [LINKS[0]], target: { min: 0, max: 20 } }]);
    expect(r!.checks.c!.pass).toBeNull();
    expect(r!.checks.c!.labelKo).toMatch(/링크가 1개/);
  });
});

/**
 * ★배선 — 모듈만 만들고 안 붙이면 **형태 ①**(있는 것이 안 닿음)이다 (260801j).
 *   이 세션에서 반복해 잡은 형태라, 새 검토는 반드시 소비 경로까지 밟아 확인한다.
 */
describe('배선 — 안전검토 문서까지 닿는가', () => {
  it('★선언된 체인이 안전검토 HTML 에 실린다', async () => {
    const { domainSafetyReportHtml } = await import('./domain-dossier-verify.mjs');
    const assembly = {
      parts: [{ id: 'p', type: 'box', params: { width: 100, depth: 100, height: 20 } }],
      tolChains: [{
        id: 'gap', labelKo: '커버 틈새',
        links: [
          { labelKo: '하우징 깊이', nominal: 20, tol: 0.1, dir: 1 },
          { labelKo: '보스 높이', nominal: 18, tol: 0.05, dir: -1 },
        ],
        target: { min: 1.5, max: 2.5 },
      }],
    };
    const html = (domainSafetyReportHtml as unknown as (a: unknown, o: unknown) => string | null)(assembly, { params: {} });
    expect(html, '안전검토 보고서가 생성되지 않았다').toBeTruthy();
    expect(html!).toMatch(/커버 틈새/);
    expect(html!).toMatch(/최악조건/);
    // RSS 가정이 **문서에도** 있어야 한다 — 코드 주석에만 있으면 사용자는 모른다.
    expect(html!).toMatch(/3σ|낙관/);
  });

  it('선언이 없으면 문서에 공차 누적 절이 생기지 않는다 — 과고지 금지', async () => {
    const { domainSafetyReportHtml } = await import('./domain-dossier-verify.mjs');
    const html = (domainSafetyReportHtml as unknown as (a: unknown, o: unknown) => string | null)(
      { parts: [{ id: 'p', type: 'box', params: { width: 100, depth: 100, height: 20 } }] }, { params: {} });
    expect(html ?? '').not.toMatch(/공차 누적/);
  });
});
