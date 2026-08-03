/**
 * part-fields-contract.test.ts — **프롬프트가 시키는 필드를 스키마가 받는가** (260803).
 *
 * ## 발견 — 「스키마에 없는 키는 조용히 사라진다」의 네 번째 판
 * 라우트 프롬프트 `PART_FIELDS` 는 오래전부터 이렇게 시키고 있었다:
 * > `material`: … RC 구조물은 반드시 "concrete", 목구조는 "timber"
 * > `role`: column | beam | slab | … 계통색·도면 라벨에 쓰임
 *
 * 그런데 `ASSEMBLY_SCHEMA.parts[]` 에 **두 필드가 없었다.** 구조화 출력은 스키마에 없는
 * 키를 조용히 떨구므로, 모델이 시킨 대로 채워도 **전부 버려졌다.** 결과:
 * ```
 *   material 유실 →  AI 조립은 전부 강재(7850). 목재 500 → **15.7배**, 콘크리트 2400 → **3.3배** 과대.
 *                    5개 도메인 중 조경·인테리어·토목이 통째로 틀린 질량을 냈다.
 *   role 유실     →  autoTagAssembly 의 SYS_ROLE 이 안 걸려 계통이 전부 '부품'.
 *                    260803 에 만든 STEP 조립 트리가 **템플릿에서만** 갈리고 자유형은 한 덩어리.
 * ```
 * 같은 함정의 앞선 세 건: `h_section`(260802) · `description`(260803) · `constraints`(260803).
 *
 * ## 그래서 이 파일은 **세 곳이 갈리는 것 자체**를 막는다
 * ```
 *   프롬프트 PART_FIELDS  ↔  ASSEMBLY_SCHEMA.parts[]  ↔  실제 소비자(DENSITY · SYS_ROLE)
 * ```
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSEMBLY_SCHEMA, MATERIALS } from './from-text.mjs';
import { DENSITY } from './structural.mjs';
import { SYS_ROLE, autoTagAssembly } from './assembly.mjs';

const routeSrc = readFileSync(
  join(process.cwd(), 'src', 'app', 'api', 'nexyfab', 'drawing', 'assemble', 'route.ts'),
  'utf8',
);
const partProps = (ASSEMBLY_SCHEMA as unknown as {
  properties: { parts: { items: { properties: Record<string, { enum?: string[] }> } } };
}).properties.parts.items.properties;

describe('★① 스키마가 material 을 받는다', () => {
  it('parts[].material 이 있다 — 없으면 프롬프트가 시켜도 버려진다', () => {
    expect(partProps.material).toBeTruthy();
  });

  it('★enum 이 DENSITY 키와 같다(물 제외) — 갈리면 조용히 강재로 떨어진다', () => {
    const dens = Object.keys(DENSITY as Record<string, number>).filter((k) => k !== 'water');
    expect([...(partProps.material!.enum ?? [])].sort()).toEqual([...dens].sort());
    expect([...(MATERIALS as string[])].sort()).toEqual([...dens].sort());
  });

  it('실제 재질별로 질량이 달라진다 — enum 만 있고 안 쓰이면 의미가 없다', async () => {
    const { buildAssembly } = await import('./assembly.mjs');
    const mass = (material?: string) => (buildAssembly as unknown as (a: unknown) => { structural?: { totalMassKg: number } })({
      name: 't',
      parts: [{ id: 'a', type: 'box', params: { width: 1000, depth: 1000, height: 1000 }, at: { tx: 0, ty: 0, tz: 0 }, ...(material ? { material } : {}) }],
    }).structural!.totalMassKg;
    const steel = mass('steel');
    expect(mass('timber')).toBeLessThan(steel / 10);   // 500 vs 7850
    expect(mass('concrete')).toBeLessThan(steel / 2);  // 2400 vs 7850
  });

  it('프롬프트가 콘크리트·목구조를 명시적으로 지시한다', () => {
    expect(routeSrc).toMatch(/RC 구조물[\s\S]{0,80}concrete/);
    expect(routeSrc).toMatch(/목구조[\s\S]{0,60}timber/);
  });
});

describe('★② 스키마가 role 을 받는다 — STEP 조립 트리의 재료다', () => {
  it('parts[].role 이 있다', () => {
    expect(partProps.role).toBeTruthy();
  });

  it('★프롬프트가 나열한 role 이 전부 SYS_ROLE 에 있다 — 모르는 role 은 계통이 안 붙는다', () => {
    // PART_FIELDS 의 role 목록(「아는 값:」 뒤)에서 소문자 단어만 뽑는다 — 한글 분류 라벨은 건너뛴다.
    const start = routeSrc.indexOf('아는 값:', routeSrc.indexOf('- role: 부품의 역할'));
    expect(start, 'PART_FIELDS 의 role 목록을 못 찾았다').toBeGreaterThan(0);
    const block = routeSrc.slice(start, routeSrc.indexOf('`;', start));
    const listed = new Set((block.match(/\b[a-z][a-z_]{2,}\b/g) ?? []).filter((w) => w !== 'role'));
    const unknown = [...listed].filter((r) => !(r in (SYS_ROLE as Record<string, string>)));
    expect(unknown, `프롬프트에만 있고 SYS_ROLE 에 없는 role: ${unknown.join(' ')}`).toEqual([]);
  });

  it('★fastener 는 반드시 알려 준다 — 간섭·부유 면제가 여기 걸린다', () => {
    expect(routeSrc).toMatch(/관통하는 체결구는 반드시 "fastener"/);
    expect((SYS_ROLE as Record<string, string>).fastener).toBeTruthy();
  });

  it('role 을 주면 계통이 갈린다 — 안 주면 전부 「부품」', () => {
    const tag = (parts: unknown[]) => (autoTagAssembly as unknown as (a: unknown) => { parts: Array<{ system: string }> })({ parts });
    const withRole = tag([{ id: 'a', type: 'box', role: 'girder' }, { id: 'b', type: 'box', role: 'bearing' }]);
    expect(new Set(withRole.parts.map((p) => p.system)).size).toBe(2);
    const without = tag([{ id: 'a', type: 'box' }, { id: 'b', type: 'box' }]);
    expect(new Set(without.parts.map((p) => p.system))).toEqual(new Set(['부품']));
  });
});
