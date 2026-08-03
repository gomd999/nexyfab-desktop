/**
 * entrypoint-parity.test.ts — **웹만 되는 기능이 없어야 한다** (260803).
 *
 * ## 발견
 * 이번 세션에 만든 배치 교정(구속 해석 → 무리 회전 → 보어 정렬 → 지면 체인 드롭 → 관통 분리)이
 * **웹 라우트에만 걸려 있었다.** `autoPlaceCorrect` 호출자는 웹 2곳과 검증 하네스뿐이고,
 * MCP 서버 30여 도구와 CLI 는 `buildAssembly` 를 직접 부른다. 같은 고정 코퍼스에서:
 * ```
 *   웹 라우트 (보정 있음)   부유  1 · 간섭  5 · designOk 7/11
 *   MCP·CLI  (보정 없음)   부유 22 · 간섭 40 · designOk 0/11
 * ```
 *
 * ## ⚠ 그리고 「코어에서 항상 걸자」는 틀렸다 — 한 번 해 보고 알았다
 * `buildAssembly` 기본값으로 켰더니 **17개 파일 35건**이 깨졌다.
 * `face-contact-gap` 처럼 **일부러 간극·부유를 만들어 판정기를 시험하는** 테스트를
 * 보정기가 고쳐 버렸기 때문이다.
 *
 * > **판정 경로는 입력 그대로를 봐야 하고, 생성 경로만 보정해야 한다.**
 * > 둘을 뭉치면 「검사기가 검사 대상을 고치는」 상태가 된다.
 *
 * 그래서 `{ autoPlace: true }` 를 **생성 경로에만** 준다. 이 파일은 그 세 곳이
 * 계속 그렇게 부르는지를 소스로 확인한다 — 다음에 진입점이 늘어도 여기서 걸린다.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAssembly } from './assembly.mjs';

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');
const mcp = read('scripts', 'drawing-to-3d', 'mcp-server.mjs');
const cli = read('scripts', 'drawing-to-3d', 'cli.mjs');
const route = read('src', 'app', 'api', 'nexyfab', 'drawing', 'assemble', 'route.ts');

/**
 * `buildAssembly(` 를 **부르는 줄**(import·주석 제외).
 * ⚠ 정규식으로 인자를 잘라내려다 `buildAssembly(loadAsm(argv[1]), …)` 의 중첩 괄호에서
 *   앞부분만 잡혀 오탐했다 — 줄 단위로 보는 편이 이 목적에는 맞다.
 */
const callLines = (src: string) => src.split('\n')
  .filter((l) => l.includes('buildAssembly(') && !/^\s*(import|\*|\/\/)/.test(l));

/** 좌판이 다리 사이에 떠 있는 조립 — 보정이 걸리면 앉고, 안 걸리면 뜬다. */
const looseBench = () => ({
  name: 't',
  parts: [
    { id: 'leg_l', type: 'box', role: 'frame', params: { width: 400, depth: 450, height: 400 }, at: { tx: 0, ty: 0, tz: 0 } },
    { id: 'leg_r', type: 'box', role: 'frame', params: { width: 400, depth: 450, height: 400 }, at: { tx: 1400, ty: 0, tz: 0 } },
    { id: 'seat', type: 'box', role: 'board', params: { width: 60, depth: 1800, height: 40 }, at: { tx: 870, ty: -855, tz: 400 } },
  ],
});
type B = { support?: { floating: string[] }; placeCorrections?: unknown[] };
const build = buildAssembly as unknown as (a: unknown, o?: unknown) => B;

/**
 * ⚠ **「전 호출이 켠다」가 아니다** — 그렇게 짰다가 두 번째로 틀렸다.
 * `build_assembly`·`generate_package`·`lod_assembly` 는 **주어진 조립을 분석·발행**하는
 * 경로다. 거기서 보정하면 「부유 부품이 응답에 실린다」 같은 정직성 회귀가 깨진다
 * (실제로 깨졌다 — `mcp-package-publish` 가 floater 를 못 찾았다).
 *
 * > **보정은 「AI 가 좌표를 찍은 직후」한 번만** — 그 뒤 단계는 결과를 그대로 봐야 한다.
 */
describe('★생성 경로만 보정을 켠다', () => {
  it('text_to_assembly(AI 생성)는 켠다', () => {
    const gen = callLines(mcp).filter((l) => l.includes('autoPlace'));
    expect(gen.length, 'AI 생성 경로가 보정을 안 켠다').toBe(1);
  });

  it('★분석·발행 도구는 켜지 않는다 — 검사기가 검사 대상을 고치면 안 된다', () => {
    const src = mcp.split('\n');
    const genLine = src.findIndex((l) => l.includes('textToAssembly('));
    const offenders = src
      .map((l, i) => ({ l, i }))
      .filter(({ l, i }) => l.includes('buildAssembly(') && l.includes('autoPlace') && Math.abs(i - genLine) > 5)
      .map(({ l }) => l.trim());
    expect(offenders, `생성 경로가 아닌데 보정을 켠 호출: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('CLI 의 분석 명령(step·fea)은 입력을 그대로 본다', () => {
    expect(callLines(cli).filter((c) => c.includes('autoPlace'))).toEqual([]);
  });

  it('웹 라우트는 AI 생성 직후 autoPlaceCorrect 를 부른다', () => {
    expect(route).toMatch(/autoPlaceCorrect\(/);
  });
});

describe('★판정 경로는 입력을 그대로 본다', () => {
  it('기본 호출은 보정하지 않는다 — 검사기가 검사 대상을 고치면 안 된다', () => {
    const b = build(looseBench());
    expect(b.placeCorrections, '기본값이 보정이면 판정 테스트들이 무의미해진다').toBeUndefined();
    expect(b.support?.floating ?? []).toContain('seat');
  });

  it('autoPlace 를 켜면 같은 입력이 앉는다 — 기능이 죽은 게 아니다', () => {
    const b = build(looseBench(), { autoPlace: true });
    expect(b.placeCorrections?.length ?? 0).toBeGreaterThan(0);
    expect(b.support?.floating ?? []).toEqual([]);
  });

  it('이미 보정된 어셈블리는 두 번 보정하지 않는다', async () => {
    const { autoPlaceCorrect } = await import('./assembly.mjs');
    const pc = (autoPlaceCorrect as unknown as (a: unknown) => { assembly: unknown })(looseBench());
    const b = build(pc.assembly, { autoPlace: true });
    expect(b.placeCorrections).toBeUndefined();
  });
});
