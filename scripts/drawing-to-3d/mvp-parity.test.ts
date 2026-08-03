/**
 * mvp-parity.test.ts — 「MVP 처럼 복합적으로 다 되나」를 실측으로 고정한다 (260803).
 *
 * ## 발단
 * 외부에서 받은 Assembly Studio MVP 는 replicad 원시 연산을 직접 쓴다(하드코딩). 그 출력이
 * SOLIDWORKS 에서 제대로 열리는 것을 보고, **같은 것이 우리 어휘로도 표현되는가**를 쟀다.
 * MVP 가 쓰는 원시 연산 실측: makeBox 21 · makeCylinder 13 · ring 9 · safeCut 4 ·
 * safeFuse 3 · roundedPlate 3 · makeEllipsoid 2 · makeSphere 1 · rotate 5 · translate 1.
 *
 * ## 그 대조에서 나온 결함 3건 — 이 파일이 그것들을 잠근다
 *  ① `centerline` 이 자기 축 외 두 축을 덮어써 **앞선 `onFace` 의 접촉면을 파괴**했다.
 *     그리고 라우트 프롬프트의 출력 예시가 하필 그 조합이라, AI 가 만든 조립마다
 *     기둥이 판 속으로 박혔다. 부유 검사는 통과하므로 **조용히** 틀렸다.
 *  ② `filletR: 0`(=필렛 없음)이 게이트 에러였다. 빌더는 `Number(filletR) || 0` 로 0 을
 *     정상 취급하는데 게이트만 `>0` 을 요구해 정상 입력이 막혔다.
 *  ③ 어휘에 `sphere`·`ellipsoid` 가 없었다. 구·타원체를 `revolve` 로 흉내 내면 다각형
 *     근사라 부피가 선언식과 갈린다(원환에서 이미 겪은 함정).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_TYPES, TYPE_HINTS } from './schemas.mjs';
import { gate } from './reconstruct.mjs';
import { buildAssembly } from './assembly.mjs';
import { resolveConstraints } from './assembly-constraints.mjs';
import { autoFixPart } from './auto-fix.mjs';
import { partVolume } from './structural.mjs';

type Part = { id: string; type: string; params: Record<string, unknown>; at?: Record<string, number>; constraints?: unknown[] };
type Built = { gateErrors?: string[]; interferences?: unknown[]; support?: { floating: string[] }; structural?: { totalMassKg: number }; openscad: string };
const build = buildAssembly as unknown as (a: { name: string; parts: Part[] }) => Built;
const resolve = resolveConstraints as unknown as (a: { name: string; parts: Part[] }) => { parts: Part[]; constraintConflicts?: string[] };
const gateOf = gate as unknown as (i: Record<string, unknown>) => string[];
const partVol = partVolume as unknown as (t: string, p: Record<string, number>) => number;

const PLATE: Part = { id: 'base', type: 'plate_with_holes', params: { width: 260, depth: 220, thickness: 6 }, at: { tx: 0, ty: 0, tz: 0 } };
const withCons = (cons: unknown[]) => ({
  name: 't',
  parts: [PLATE, { id: 'h', type: 'box', params: { width: 50, depth: 35, height: 30 }, constraints: cons }] as Part[],
});

describe('★① 축 소유권 — 약한 구속이 접촉면을 못 덮는다', () => {
  it('onFace 뒤에 centerline 을 써도 접촉 tz 가 유지된다', () => {
    const r = resolve(withCons([{ type: 'onFace', to: 'base', face: 'top' }, { type: 'centerline', axis: 'x' }]));
    expect(r.parts[1].at!.tz).toBe(6); // 판 상면. 종전에는 -15(판 속 15mm)
  });

  it('★선언 순서를 바꿔도 같다 — 순서가 결과를 바꾸면 사용자는 이유를 알 수 없다', () => {
    const a = resolve(withCons([{ type: 'onFace', to: 'base', face: 'top' }, { type: 'centerline', axis: 'x' }]));
    const b = resolve(withCons([{ type: 'centerline', axis: 'x' }, { type: 'onFace', to: 'base', face: 'top' }]));
    expect(b.parts[1].at).toEqual(a.parts[1].at);
  });

  it('무시된 축은 조용히 넘어가지 않고 conflicts 로 보고된다', () => {
    const r = resolve(withCons([{ type: 'onFace', to: 'base', face: 'top' }, { type: 'centerline', axis: 'x' }]));
    expect((r.constraintConflicts ?? []).join(' ')).toMatch(/tz .*onFace/);
  });

  it('실제 조립에서 간섭 0 · 부유 0 이 된다', () => {
    const b = build(withCons([{ type: 'onFace', to: 'base', face: 'top' }, { type: 'centerline', axis: 'x' }]));
    expect(b.interferences ?? []).toEqual([]);
    expect(b.support?.floating ?? []).toEqual([]);
  });

  it('★프롬프트 예시가 이 함정을 다시 심지 않는다', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'app', 'api', 'nexyfab', 'drawing', 'assemble', 'route.ts'), 'utf8');
    const example = src.split('\n').find((l) => l.startsWith('{"name":"...","parts":['));
    expect(example, '출력 예시 줄을 못 찾았다').toBeTruthy();
    // onFace 와 centerline 을 한 부품에 같이 쓰는 예시는 금지 — 그게 ① 을 낳았다.
    expect(example!.includes('onFace') && example!.includes('centerline')).toBe(false);
    expect(src).toMatch(/centerline 은 지정한 축이 \*\*아닌 나머지 두 축\*\*/);
  });
});

describe('★② filletR 0 은 정상 입력이다', () => {
  const profile = [[0, 0], [260, 0], [260, 220], [0, 220]];
  it('filletR: 0 은 통과한다 (모서리를 안 굴리겠다는 뜻)', () => {
    expect(gateOf({ type: 'extrude_profile', profile, depth: 6, filletR: 0 })).toEqual([]);
  });
  it('음수는 여전히 막는다', () => {
    expect(gateOf({ type: 'extrude_profile', profile, depth: 6, filletR: -1 }).join(' ')).toMatch(/filletR/);
  });
});

describe('★③ 구·타원체 어휘', () => {
  it('둘 다 어휘에 있고 힌트가 붙어 있다', () => {
    for (const t of ['sphere', 'ellipsoid']) {
      expect(ALL_TYPES, t).toContain(t);
      expect((TYPE_HINTS as Record<string, string>)[t], `${t} 힌트`).toBeTruthy();
    }
  });

  it('게이트를 통과한다', () => {
    expect(gateOf({ type: 'sphere', diameter: 100 })).toEqual([]);
    expect(gateOf({ type: 'ellipsoid', dx: 120, dy: 80, dz: 60 })).toEqual([]);
  });

  /**
   * ⚠ `structural.totalMassKg` 는 **반올림된 표시값**이라 정확식 검증에 못 쓴다
   *   (구 4.2kg / 타원체 2.4kg — 소수 첫째 자리에서 잘린다). 부피를 직접 잰다.
   */
  it('★부피가 정확식이다 — 회전체 근사로 대체하면 여기서 갈린다', () => {
    expect(partVol('sphere', { diameter: 100 })).toBeCloseTo((Math.PI / 6) * 1e6, 6);
    expect(partVol('ellipsoid', { dx: 120, dy: 80, dz: 60 })).toBeCloseTo((Math.PI / 6) * 120 * 80 * 60, 6);
  });

  it('★세 축이 같은 타원체는 막되, 자동수정이 구로 옮긴다 — 사용자에겐 에러가 아니다', () => {
    expect(gateOf({ type: 'ellipsoid', dx: 50, dy: 50, dz: 50 }).join(' ')).toMatch(/구다/);
    const fixed = (autoFixPart as unknown as (p: Part) => { part: Part; correction: { rule: string } | null })(
      { id: 'x', type: 'ellipsoid', params: { dx: 50, dy: 50, dz: 50 } },
    );
    expect(fixed.correction?.rule).toBe('ellipsoid_equal_axes→sphere');
    expect(fixed.part.type).toBe('sphere');
    expect(fixed.part.params.diameter).toBe(50); // 치수 불변
    expect(gateOf({ type: 'sphere', ...(fixed.part.params as Record<string, number>) })).toEqual([]);
  });

  it('AABB 규약이 torus 와 같다 — 밑점이 z=0 (구속 배치가 이 규약에 얹힌다)', () => {
    const r = resolve({
      name: 't',
      parts: [PLATE, { id: 's', type: 'sphere', params: { diameter: 100 }, constraints: [{ type: 'onFace', to: 'base', face: 'top' }] }],
    });
    expect(r.parts[1].at!.tz).toBe(6);
  });
});
