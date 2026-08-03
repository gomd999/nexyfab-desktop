/**
 * constraint-wiring.test.ts — **엔진이 있는데 닿지 않았다** (260803).
 *
 * ## 발견
 * `assembly-constraints.mjs` 의 관계 배치 리졸버(offset·concentric·onFace·mirror·centerline)는
 * **이미 있었고 `buildAssembly` 가 실제로 호출**하고 있었다. 그런데:
 * ```
 *   ASSEMBLY_SCHEMA 의 constraints  →  0건
 *   라우트 프롬프트의 constraints    →  0건
 *   템플릿 54종의 constraints        →  0건
 * ```
 * **아무도 안 쓰고 있었다.** 그래서 LLM 은 `at` 절대좌표를 직접 계산할 수밖에 없었고,
 * 그것이 부유 28/42 의 근본 원인이었다 — 엔진이 없는 게 아니라 **닿지 않았다.**
 *
 * ⚠ 구조화 출력은 **스키마에 없는 키를 조용히 떨군다.** 프롬프트로만 알려 주면 소용없다
 *   (260802 `h_section` · 260803 `description` 과 같은 함정, 세 번째).
 *
 * 실측(카탈로그에 없는 제품 3종으로 자유형 강제): 부품 13 중 **구속 9건 선언** ·
 * 부유 2 — 종전 42부품 중 28 부유(67%)에서 **15%** 로.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSEMBLY_SCHEMA } from './from-text.mjs';
import { resolveConstraints } from './assembly-constraints.mjs';
import { autoPlaceCorrect, buildAssembly } from './assembly.mjs';

const routeSrc = readFileSync(
  join(process.cwd(), 'src', 'app', 'api', 'nexyfab', 'drawing', 'assemble', 'route.ts'),
  'utf8',
);
const partProps = (ASSEMBLY_SCHEMA as unknown as {
  properties: { parts: { items: { properties: Record<string, { items?: { properties: Record<string, { enum?: string[] }> } }> } } };
}).properties.parts.items.properties;

describe('★스키마가 constraints 를 허용한다 — 없으면 조용히 떨어진다', () => {
  it('parts[].constraints 가 스키마에 있다', () => {
    expect(partProps.constraints).toBeTruthy();
  });

  it('구속 타입 enum 이 리졸버가 지원하는 5종과 같다', () => {
    const got = partProps.constraints!.items!.properties.type.enum!;
    expect([...got].sort()).toEqual(['centerline', 'concentric', 'mirror', 'offset', 'onFace']);
  });

  it('면 이름 enum 이 리졸버 규약과 같다 — 이름이 갈리면 해석이 실패한다', () => {
    const faces = partProps.constraints!.items!.properties.face.enum!;
    expect([...faces].sort()).toEqual(['back', 'bottom', 'front', 'left', 'right', 'top']);
  });
});

describe('★프롬프트가 관계 배치를 권장한다', () => {
  it('구속 어휘가 프롬프트에 있다', () => {
    for (const t of ['onFace', 'concentric', 'offset', 'centerline', 'mirror']) {
      expect(routeSrc, t).toContain(t);
    }
  });

  it('★좌표 직접 계산의 위험을 실측으로 경고한다', () => {
    expect(routeSrc).toMatch(/42부품 중 28개 부유|좌표를 직접 계산하면/);
  });

  it('★출력 예시가 구속을 쓴다 — 말만 하고 예시가 절대좌표면 모델이 예시를 따른다', () => {
    // 출력 형식 예시 = `{"name":"..","parts":[...]}` 를 담은 줄. 설명문의 templateMiss 언급과 구별한다.
    const exampleLine = routeSrc.split('\n').find((l) => l.startsWith('{"name":"...","parts":['));
    expect(exampleLine, '출력 예시 줄을 못 찾았다').toBeTruthy();
    expect(exampleLine!).toContain('constraints');
    expect(exampleLine!).toContain('onFace');
  });
});

describe('★리졸버가 실제로 좌표를 확정한다', () => {
  const asm = {
    name: 't',
    parts: [
      { id: 'base', type: 'plate_with_holes', params: { width: 400, depth: 300, thickness: 12 }, at: { tx: 0, ty: 0, tz: 0 } },
      // at 을 주지 않는다 — 구속만으로 배치돼야 한다
      { id: 'post', type: 'box', params: { width: 60, depth: 60, height: 200 }, constraints: [{ type: 'onFace', to: 'base', face: 'top' }] },
    ],
  };

  it('at 없이 구속만 준 부품이 배치된다', () => {
    const r = (resolveConstraints as unknown as (a: unknown) => { parts: Array<{ id: string; at?: { tz?: number } }> })(asm);
    const post = r.parts.find((p) => p.id === 'post')!;
    expect(post.at?.tz).toBe(12); // base 상면
  });

  it('★buildAssembly 가 구속을 해석하고 부유 0 이 된다', () => {
    const b = (buildAssembly as unknown as (a: unknown) => { ok: boolean; support?: { floating: string[] } })(asm);
    expect(b.ok).toBe(true);
    expect(b.support?.floating ?? []).toEqual([]);
  });

  /**
   * ⚠ 260803 — **판정을 바꿨다.** 종전에는 이런 구속 하나가 게이트 에러가 되어 조립 전체를
   * 잃었다. 실측에서 29부품짜리 피난계단이 `face:undefined` **한 건**으로 결과 0 이 됐다 —
   * 나머지 28부품은 멀쩡했다. 「고객은 error 만 나는 서비스를 쓰지 않는다」.
   * 지금은 **그 구속만 버리고 보고**한다. 이 테스트가 지키려던 것(「조용히 넘기지 않는다」)은
   * 그대로다 — 수단이 게이트 에러에서 **보고 + 부유 노출**로 바뀌었을 뿐이다.
   */
  it('★알 수 없는 to 는 조용히 넘기지 않는다 — 그 구속만 버리고 보고한다', () => {
    const bad = {
      name: 't',
      parts: [
        { id: 'base', type: 'plate_with_holes', params: { width: 400, depth: 300, thickness: 12 }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'a', type: 'box', params: { width: 100, depth: 100, height: 100 }, at: { tx: 0, ty: 0, tz: 12 }, constraints: [{ type: 'onFace', to: '없는부품', face: 'top' }] },
      ],
    };
    const b = (buildAssembly as unknown as (a: unknown) => { ok: boolean; parts?: unknown[]; constraintConflicts?: string[] })(bad);
    expect(b.ok, '한 구속 때문에 조립 전체를 잃으면 안 된다').toBe(true);
    expect(b.parts).toHaveLength(2);
    expect((b.constraintConflicts ?? []).join(' ')).toMatch(/알 수 없는 to id '없는부품'/);
  });

  /**
   * ★`anchor:'center'` — 5도메인 자유형 실측에서 **부유 41건의 주된 형태**였다.
   * 「3000×3000 슬래브 위 기둥 4개」를 모델이 `offset{dx:±750}` 로 쓰는데, 사람 기준은
   * 슬래브 **중심**이고 우리 기준은 **원점(최소 모서리)** 이라 기둥이 판 밖(-750)에 놓였다.
   */
  const slabCols = (anchor?: string) => ({
    name: 't',
    parts: [
      { id: 'slab', type: 'plate_with_holes', role: 'slab', material: 'concrete', params: { width: 3000, depth: 3000, thickness: 200 }, at: { tx: 0, ty: 0, tz: 0 } },
      ...([[-750, -750], [750, -750], [-750, 750], [750, 750]] as const).map(([dx, dy], n) => ({
        id: `col_${n + 1}`, type: 'box', role: 'column', material: 'concrete',
        params: { width: 400, depth: 400, height: 1200 },
        constraints: [{ type: 'onFace', to: 'slab', face: 'top' }, { type: 'offset', to: 'slab', dx, dy, ...(anchor ? { anchor } : {}) }],
      })),
    ],
  });
  type B = { designOk?: boolean; support?: { floating: string[] } };

  it('★anchor:center 면 대칭 배치가 대상 안에 들어온다 — 부유 0', () => {
    const b = (buildAssembly as unknown as (a: unknown) => B)(slabCols('center'));
    expect(b.support?.floating ?? []).toEqual([]);
    expect(b.designOk).toBe(true);
  });

  it('anchor 없으면 원점 기준이다 — 기존 선언의 의미를 바꾸지 않는다', () => {
    const b = (buildAssembly as unknown as (a: unknown) => B)(slabCols());
    expect((b.support?.floating ?? []).length, '원점 기준이면 음수 좌표 기둥이 판 밖으로 나간다').toBeGreaterThan(0);
  });

  it('★스키마·프롬프트가 anchor 를 알려 준다 — 스키마에 없으면 조용히 떨어진다', () => {
    expect(partProps.constraints!.items!.properties.anchor?.enum).toEqual(['origin', 'center']);
    expect(routeSrc).toContain('"anchor":"center"');
    expect(routeSrc).toMatch(/부품 원점은 최소 모서리다/);
  });

  /**
   * ★**보정기가 배치보다 먼저 돌던 버그** — 5도메인 자유형 부유의 최대 원인이었다.
   * `autoPlaceCorrect` 는 구속 해석 **전에** 돌아서, `at` 이 빈 부품을 전부 원점으로 보고
   * 「부유 드롭」을 계산해 의미 없는 절대 좌표를 써 넣었다. 그 뒤 구속 해석은 자기 축만
   * 덮으므로 나머지 축에 엉터리 값이 남았다.
   * 실측(벤치 좌판 5장 연쇄 offset): 부유 7 → **0**, 보정 7 → **0**.
   */
  it('★autoPlaceCorrect 가 구속을 먼저 푼다 — 연쇄 offset 이 그대로 선다', () => {
    const bench = {
      name: '벤치',
      parts: [
        { id: 'leg_left', type: 'box', role: 'frame', material: 'concrete', params: { width: 400, depth: 450, height: 400 }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'leg_right', type: 'box', role: 'frame', material: 'concrete', params: { width: 400, depth: 450, height: 400 }, at: { tx: 1400, ty: 0, tz: 0 } },
        { id: 'seat_1', type: 'box', role: 'board', material: 'timber', params: { width: 60, depth: 1800, height: 40 }, constraints: [{ type: 'onFace', to: 'leg_left', face: 'top' }, { type: 'offset', to: 'leg_left', dx: 20, dy: 0, dz: 0 }] },
        ...[2, 3, 4, 5].map((n) => ({
          id: `seat_${n}`, type: 'box', role: 'board', material: 'timber',
          params: { width: 60, depth: 1800, height: 40 },
          constraints: [{ type: 'offset', to: `seat_${n - 1}`, dx: 70, dy: 0, dz: 0 }],
        })),
      ],
    };
    const pc = (autoPlaceCorrect as unknown as (a: unknown) => { assembly: unknown; corrections: unknown[] })(bench);
    // ★보정이 0 이어야 한다 — 보정이 붙었다면 그건 배치 전 좌표로 계산한 엉터리다
    expect(pc.corrections, '배치가 정해진 뒤라면 고칠 것이 없다').toEqual([]);
    const b = (buildAssembly as unknown as (a: unknown) => {
      designOk?: boolean; support?: { floating: string[] }; interferences?: unknown[];
      parts?: Array<{ id: string; aabb: { min: number[]; max: number[] } }>;
    })(pc.assembly);
    expect(b.support?.floating ?? []).toEqual([]);
    expect(b.interferences ?? []).toEqual([]);
    expect(b.designOk).toBe(true);
    // 좌판 5장이 70mm 피치로 나란히, 다리 상면(z=400)에
    const seats = b.parts!.filter((p) => p.id.startsWith('seat_'));
    expect(seats.map((p) => p.aabb.min[0])).toEqual([20, 90, 160, 230, 300]);
    expect(new Set(seats.map((p) => p.aabb.min[2]))).toEqual(new Set([400]));
  });

  it('순환 구속은 여전히 게이트 에러다 — 무엇을 버릴지 우리가 정할 수 없다', () => {
    const cyc = {
      name: 't',
      parts: [
        { id: 'a', type: 'box', params: { width: 10, depth: 10, height: 10 }, constraints: [{ type: 'onFace', to: 'b', face: 'top' }] },
        { id: 'b', type: 'box', params: { width: 10, depth: 10, height: 10 }, constraints: [{ type: 'onFace', to: 'a', face: 'top' }] },
      ],
    };
    const b = (buildAssembly as unknown as (a: unknown) => { ok: boolean; gateErrors?: string[] })(cyc);
    expect(b.ok).toBe(false);
    expect((b.gateErrors ?? []).join(' ')).toMatch(/순환 구속/);
  });
});
