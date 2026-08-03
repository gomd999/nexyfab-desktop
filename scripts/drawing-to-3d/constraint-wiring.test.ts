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
import { buildAssembly } from './assembly.mjs';

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

  it('알 수 없는 to 는 조용히 넘기지 않고 게이트 에러가 된다', () => {
    const bad = { name: 't', parts: [{ id: 'a', type: 'box', params: { width: 10, depth: 10, height: 10 }, constraints: [{ type: 'onFace', to: '없는부품', face: 'top' }] }] };
    const b = (buildAssembly as unknown as (a: unknown) => { ok: boolean; gateErrors?: string[] })(bad);
    expect(b.ok).toBe(false);
    expect((b.gateErrors ?? []).join(' ')).toMatch(/구속 해석 실패/);
  });
});
