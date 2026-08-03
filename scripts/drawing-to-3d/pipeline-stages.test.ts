/**
 * pipeline-stages.test.ts — **로딩 표시가 거짓말하지 않는가** (260803).
 *
 * ## 왜 단계 표시가 필요한가
 * 이 파이프라인은 AI 왕복 1~2회 + 결정론 검증 여러 단계로 20~60초가 걸린다. 그동안
 * 사용자가 보는 것이 회전하는 원 하나면 **「멈춘 것」과 「도는 것」을 구별할 수 없다.**
 *
 * ## 이 파일이 지키는 것
 * ① **진행률이 지어낸 숫자가 아니다.** 가중치는 실측 상대 소요이고, 단계 시작 시점 값을 쓴다.
 *    끝 시점 값을 쓰면 마지막 단계에서 100%가 되어 **끝나기 전에 다 된 것처럼** 보인다.
 * ② **라벨이 단일 소스다.** 라우트에 문자열로 박으면 화면·i18n·MCP 가 각자 다른 말을 한다 —
 *    이 세션에 어휘가 갈려 다섯 번 틀렸다. 표시 계층에서 같은 실수를 반복하지 않는다.
 * ③ **라우트가 실제로 그 단계들을 흘린다.** 어휘만 있고 안 쓰면 「있는데 안 닿는」 것이다.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSEMBLE_STAGES, PACKAGE_STAGES, progressTable } from './pipeline-stages.mjs';

type Stage = { id: string; weight: number; ko: string; en: string; detail?: string };
const asmStages = ASSEMBLE_STAGES as unknown as Stage[];
const table = progressTable as unknown as (s: Stage[]) => {
  pct: (id: string) => number;
  event: (id: string, extra?: Record<string, unknown>) => Record<string, unknown>;
  ids: string[];
};
const routeSrc = readFileSync(join(process.cwd(), 'src', 'app', 'api', 'nexyfab', 'drawing', 'assemble', 'route.ts'), 'utf8');

describe('★① 진행률이 거짓말하지 않는다', () => {
  it('단계 시작 시점 값이라 첫 단계는 0%다', () => {
    expect(table(asmStages).pct(asmStages[0].id)).toBe(0);
  });

  it('★마지막 단계 시작이 100% 가 아니다 — 끝나기 전에 다 된 것처럼 보이면 안 된다', () => {
    const t = table(asmStages);
    expect(t.pct(asmStages[asmStages.length - 1].id)).toBeLessThan(100);
  });

  it('단조 증가한다 — 되돌아가는 진행바는 신뢰를 잃는다', () => {
    const t = table(asmStages);
    const pcts = asmStages.map((s) => t.pct(s.id));
    for (let i = 1; i < pcts.length; i++) expect(pcts[i]).toBeGreaterThan(pcts[i - 1]);
  });

  it('★AI 호출이 가장 무겁다 — 실측을 반영하지 않으면 92%에서 멈춘 것처럼 보인다', () => {
    const heaviest = [...asmStages].sort((a, b) => b.weight - a.weight)[0];
    expect(heaviest.id).toBe('ai');
  });
});

describe('★② 어휘가 단일 소스다', () => {
  it('전 단계가 한국어·영어 라벨을 갖는다 — 6개국어 사이트다', () => {
    for (const s of [...asmStages, ...(PACKAGE_STAGES as unknown as Stage[])]) {
      expect(s.ko, s.id).toBeTruthy();
      expect(s.en, s.id).toBeTruthy();
    }
  });

  it('id 가 중복되지 않는다 — 같은 id 가 둘이면 진행률이 갈린다', () => {
    const ids = asmStages.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('알 수 없는 단계는 조용히 넘기지 않고 throw 한다', () => {
    expect(() => table(asmStages).event('없는단계')).toThrow(/알 수 없는 단계/);
  });

  it('이벤트가 화면이 쓸 것을 다 담는다', () => {
    const ev = table(asmStages).event('ai', { round: 1 });
    expect(ev).toMatchObject({ stage: 'ai', ko: expect.any(String), en: expect.any(String), round: 1 });
    expect(typeof ev.pct).toBe('number');
  });
});

describe('★③ 라우트가 실제로 흘린다 — 어휘만 있고 안 쓰면 무효다', () => {
  it('라우트가 단계 어휘를 문자열로 다시 박지 않는다', () => {
    expect(routeSrc, 'pipeline-stages.mjs 에서 불러와야 한다').toContain('pipeline-stages.mjs');
    // 라벨을 라우트에 직접 적은 흔적이 없어야 한다
    for (const s of asmStages) expect(routeSrc.includes(`'${s.ko}'`), `${s.id} 라벨이 라우트에 박혔다`).toBe(false);
  });

  it('★주요 단계를 전부 emit 한다 — 하나라도 빠지면 그 구간이 통째로 정지로 보인다', () => {
    for (const id of ['catalog', 'ai', 'place', 'build', 'intent', 'repair']) {
      expect(routeSrc, `emit(PROG.event('${id}')) 가 없다`).toContain(`PROG.event('${id}'`);
    }
  });

  it('SSE 는 요청이 명시할 때만이다 — 기존 JSON 계약을 깨지 않는다', () => {
    expect(routeSrc).toMatch(/wantStream/);
    expect(routeSrc).toMatch(/if \(!wantStream\) return runPipeline/);
    expect(routeSrc).toMatch(/text\/event-stream/);
  });

  it('★최종 결과를 스트림 안에서 준다 — 두 번 기다리게 하지 않는다', () => {
    // 라벨은 `PROG.frame('done')` 이 준다(6언어 단일 소스) — 라우트에 문자열이 없다.
    expect(routeSrc).toMatch(/PROG\.frame\('done'\)[\s\S]{0,60}result: body/);
  });

  it('시작·완료·실패 라벨도 단일 소스에서 온다 — ko/en 만 박으면 4언어가 조용히 영어가 된다', () => {
    for (const k of ['start', 'done', 'error']) expect(routeSrc).toContain(`PROG.frame('${k}')`);
    expect(routeSrc, '라우트가 라벨 문자열을 직접 들면 안 된다').not.toMatch(/ko: '시작'|en: 'Starting'/);
  });

  /**
   * ★화면이 실제로 받아 그리는가 — **서버만 보내고 화면이 안 읽으면 「있는데 안 닿는」 것**이다.
   * 이 세션에 그 형태로 다섯 번 틀렸다(resolveConstraints·autoTagAssembly·material·role·
   * autoPlaceCorrect). 표시 계층에서 여섯 번째를 만들지 않는다.
   */
  it('★프런트가 stream 을 요청하고 SSE 를 파싱한다', () => {
    const ui = readFileSync(join(process.cwd(), 'src', 'app', '[lang]', 'nexyfab', 'design', 'DesignInner.tsx'), 'utf8');
    expect(ui, '요청에 stream:true 가 없다').toMatch(/stream: true/);
    expect(ui, 'SSE 본문을 읽지 않는다').toMatch(/text\/event-stream/);
    expect(ui, 'data: 프레임을 안 뜯는다').toMatch(/startsWith\('data: '\)/);
    expect(ui, '단계 라벨을 화면에 안 쓴다').toMatch(/setStatus\(`\$\{label\}/);
  });

  it('★스트림이 실패하면 기존 JSON 으로 되돌아간다 — 표시를 얻으려 생성을 잃지 않는다', () => {
    const ui = readFileSync(join(process.cwd(), 'src', 'app', '[lang]', 'nexyfab', 'design', 'DesignInner.tsx'), 'utf8');
    expect(ui).toMatch(/streamed\s*\n?\s*\?\?\s*\(\(await res\.json\(\)/);
  });

  it('스트림과 비스트림이 **같은 함수**를 돈다 — 경로가 갈리면 답이 갈린다', () => {
    // 정의는 `const runPipeline = async (emit…` 라 `runPipeline(` 에 안 걸린다 — 호출만 센다.
    expect(routeSrc).toMatch(/const runPipeline = async \(emit/);
    const calls = (routeSrc.match(/runPipeline\(/g) ?? []).length;
    expect(calls, '비스트림 1 + 스트림 1 = 두 곳이 같은 함수를 부른다').toBe(2);
  });
});
