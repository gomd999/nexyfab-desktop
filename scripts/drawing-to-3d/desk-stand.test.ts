/**
 * desk-stand.test.ts — **소비재 기구류 첫 아키타입 + 선언 예외가 번지지 않는가** (260803, B3).
 *
 * ## 두 가지를 지킨다
 * ① `desk_stand` 가 §10.4 수용 조건을 만족하는가 (형상이 아니라 **판정**으로)
 * ② 이 템플릿을 위해 코어 검사기에 넣은 **선언 예외 2개가 번지지 않는가**
 *
 * ⚠ ②가 더 중요하다. `support-check.mjs` 와 `assembly.mjs` 에 `role:'fastener'` 예외를
 *   넣었다 — 검사기를 건드렸다는 뜻이다. 예외가 선언 없이도 먹으면 **게이트가 느슨해진 것**이고,
 *   그건 이 세션 §11.5 가 경계한 「루프가 스스로를 속인다」의 코드판이다.
 */

import { describe, expect, it } from 'vitest';
import { buildAssemblyTemplate, listAssemblyTemplates } from './domain-assemblies.mjs';
import { buildAssembly } from './assembly.mjs';
import { auditTemplate } from './domain-audit.mjs';
import { supportCheck } from './support-check.mjs';

type Part = { id: string; type: string; role?: string; at?: Record<string, number>; params: Record<string, unknown> };
type Built = {
  ok: boolean; designOk?: boolean; gateErrors?: string[]; interferences?: unknown[];
  support?: { floating: string[] }; structural?: { totalMassKg?: number; tipover?: { seismicFS?: number; staticAngleDeg?: number } };
};
const build = (id: string, p: Record<string, number> = {}) =>
  (buildAssemblyTemplate as unknown as (d: string, i: string, p: unknown) => { parts: Part[]; standMeta?: Record<string, unknown> })('mech', id, p);
const assemble = (a: unknown) => (buildAssembly as unknown as (a: unknown) => Built)(a);
const audit = (id: string) => (auditTemplate as unknown as (d: string, i: string, p: unknown) => { real: number; reached: boolean; unjudged: number; englishLabels: string[] })('mech', id, {});

describe('★§10.4 수용 시험 — 감이 아니라 판정으로', () => {
  const asm = build('desk_stand');
  const b = assemble(asm);

  it('① 게이트 에러 0', () => {
    expect(b.gateErrors ?? []).toEqual([]);
  });

  it('★designOk — 부유 0 · 간섭 0. 이것이 B3 의 목표였다', () => {
    expect(b.support?.floating ?? []).toEqual([]);
    expect(b.interferences ?? []).toEqual([]);
    expect(b.designOk).toBe(true);
  });

  it('② 걸림턱이 **전면**에 있다 — 경사면에서 노트북은 앞으로 미끄러진다', () => {
    const lips = asm.parts.filter((p) => p.role === 'stop');
    expect(lips.length).toBeGreaterThan(0);
    // 전부 −Y(전면)여야 한다. 뒤쪽에 있으면 기능이 반대다(GPT 모델의 실제 오류, 계획서 §10.0 #1)
    expect(lips.every((p) => Number(p.at?.ty ?? 0) < 0)).toBe(true);
  });

  it('② 힌지 2조 + 높이 조절 3부품이 실재한다 — 선언이 아니라 부품으로 센다', () => {
    expect(asm.parts.filter((p) => /hinge_.*_pin$/.test(p.id))).toHaveLength(2);
    const need = (asm.standMeta?.heightAdjustParts ?? []) as string[];
    expect(need.length).toBeGreaterThan(0);
    for (const k of need) expect(asm.parts.some((p) => p.id === k), k).toBe(true);
  });

  it('③ 전도 — 지진 FS ≥ 1.5', () => {
    expect(b.structural?.tipover?.seismicFS ?? 0).toBeGreaterThanOrEqual(1.5);
  });

  it('④ 판정이 소비자에 닿는다 — 형상만 나오고 검증이 없는 템플릿을 만들지 않는다', () => {
    const r = audit('desk_stand');
    expect(r.real).toBeGreaterThan(0);
    expect(r.reached).toBe(true);
    expect(r.englishLabels, '판정 라벨이 영문 코드면 읽을 수 없다').toEqual([]);
  });

  it('④ 못 하는 것은 못 한다고 남긴다 — 마찰 토크는 계산기 미보유', () => {
    expect(audit('desk_stand').unjudged).toBeGreaterThan(0);
  });

  it('마찰 와셔가 washer 어휘다 — flange 가 아니다(라이브 60건의 원인)', () => {
    expect(asm.parts.filter((p) => p.type === 'washer').length).toBeGreaterThanOrEqual(8);
    expect(asm.parts.some((p) => p.type === 'flange')).toBe(false);
  });

  it('사각 통풍구가 slab_with_openings 다 — 원형 holes 로 못 낸다', () => {
    const plate = asm.parts.find((p) => p.id === 'laptop_plate');
    expect(plate?.type).toBe('slab_with_openings');
    expect((plate?.params.openings as unknown[])?.length).toBe(1);
  });
});

describe('★선언 예외가 번지지 않는가 — 게이트를 느슨하게 만들지 않았다', () => {
  const sc = supportCheck as unknown as (
    items: Array<{ label: string; min: number[]; max: number[]; base?: boolean; role?: string }>,
  ) => { supported: string[]; floating: string[] };

  // 지면 위 지지된 판 + 그 안에 박힌 작은 부품(⌀8 핀 크기)
  const plate = { label: 'plate', min: [-100, -100, 0], max: [100, 100, 10], base: true };
  const pin = (role?: string) => ({ label: 'pin', min: [-4, -50, 2], max: [4, 50, 10], role });

  it('★role 선언이 없으면 관통해도 여전히 부유다', () => {
    const r = sc([plate, pin(undefined)]);
    expect(r.floating).toContain('pin');
  });

  it('role:"fastener" 를 선언해야 체결로 인정된다', () => {
    const r = sc([plate, pin('fastener')]);
    expect(r.floating).toEqual([]);
  });

  it('★fastener 라도 **관통하지 않으면**(겹침 0) 부유다 — 공중의 볼트는 여전히 부유', () => {
    const floating = { label: 'pin', min: [-4, -50, 200], max: [4, 50, 208], role: 'fastener' };
    const r = sc([plate, floating]);
    expect(r.floating).toContain('pin');
  });
});

describe('★다른 템플릿의 판정이 변하지 않았다 — 예외 추가가 기존을 흔들지 않았다', () => {
  it('designOk 템플릿 수가 줄지 않는다 (예외 추가 전 47/54 · desk_stand 포함 48/55)', () => {
    const list = (listAssemblyTemplates as unknown as () => Array<{ domain: string; id: string }>)();
    const ok = list.filter((t) => {
      try {
        const b = assemble((buildAssemblyTemplate as unknown as (d: string, i: string, p: unknown) => unknown)(t.domain, t.id, {}));
        return b.ok && b.designOk !== false;
      } catch { return false; }
    }).length;
    // ⚠ 래칫이다 — 줄면 실패한다. 늘어나는 것은 막지 않는다.
    expect(ok).toBeGreaterThanOrEqual(48);
  });
});
