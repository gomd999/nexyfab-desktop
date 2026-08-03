/**
 * fastener-fit.test.ts — **체결·끼워맞춤이 오탐 없이 서는가** (260803).
 *
 * ## 왜
 * 「템플릿이 없어도 모든 것을 만들 수 있어야 하고, 체결도 모두 되어야 한다」는 요구다.
 * 그런데 우리 판정은 AABB 기반이라 **정상 조립을 간섭·부유로 오탐**하는 자리가 셋 있다:
 *
 * ```
 *   ① 관통 체결구   볼트·핀·리벳이 두 판을 꿰뚫는다. 상대 어휘에 홀이 없어 AABB 는 겹침으로 본다.
 *   ② 보어 끼워맞춤 기어·베어링·커플링이 축에 끼워진다. boreDia 는 숫자 하나라 속찬 원기둥과 구별 불가.
 *   ③ 접지 면적    ⌀8 핀·t1 와셔는 minBear=15 를 절대 못 넘겨 영원히 「부유」다.
 *
 *   실측 계기: 「기어박스 입력축」 자유형 5부품에서 **간섭 10건** — 전부 정상 조립이었다.
 * ```
 *
 * ⚠ 셋 다 **면제이지 무시가 아니다.** 접촉(`contacts`)으로 옮겨 사유를 붙여 남긴다.
 * ⚠ 그리고 **면제가 지나치면 진짜 간섭을 놓친다** — 그래서 이 파일은 면제가 걸리는 경우와
 *   **안 걸려야 하는 경우**를 짝으로 잰다. 한쪽만 재면 「전부 통과」가 되고 판정이 공허해진다.
 */

import { describe, expect, it } from 'vitest';
import { autoPlaceCorrect, buildAssembly } from './assembly.mjs';

type Built = {
  ok: boolean; designOk?: boolean; gateErrors?: string[];
  interferences?: Array<{ a: string; b: string; note: string }>;
  contacts?: Array<{ a: string; b: string; note: string }>;
  support?: { floating: string[] };
};
const build = buildAssembly as unknown as (a: unknown) => Built;
const noteOf = (b: Built, a: string, c: string) =>
  (b.contacts ?? []).find((x) => (x.a === a && x.b === c) || (x.a === c && x.b === a))?.note ?? '';

describe('★① 볼트·와셔·너트 세트 — 체결이 통째로 선다', () => {
  const set = {
    name: 't',
    parts: [
      { id: 'plate_a', type: 'plate_with_holes', role: 'plate', params: { width: 200, depth: 200, thickness: 12, holes: [{ x: 100, y: 100, d: 18 }] }, at: { tx: 0, ty: 0, tz: 0 } },
      { id: 'plate_b', type: 'plate_with_holes', role: 'plate', params: { width: 200, depth: 200, thickness: 12, holes: [{ x: 100, y: 100, d: 18 }] }, at: { tx: 0, ty: 0, tz: 12 } },
      { id: 'washer_1', type: 'washer', role: 'fastener', params: { outerDia: 34, boreDia: 18, thickness: 3 }, at: { tx: 100, ty: 100, tz: 24 } },
      { id: 'bolt_1', type: 'hex_bolt', role: 'fastener', params: { threadDia: 16, length: 60 }, at: { tx: 100, ty: 100, tz: -9 } },
      { id: 'nut_1', type: 'hex_nut', role: 'fastener', params: { af: 24, thickness: 13, boreDia: 16 }, at: { tx: 100, ty: 100, tz: 27 } },
    ],
  };

  it('부유 0 · 간섭 0 · designOk — 체결구가 「떠 있다」로 잡히면 모든 조립이 실패한다', () => {
    const b = build(set);
    expect(b.gateErrors ?? []).toEqual([]);
    expect(b.support?.floating ?? []).toEqual([]);
    expect(b.interferences ?? []).toEqual([]);
    expect(b.designOk).toBe(true);
  });

  it('★무시가 아니라 접촉으로 기록된다 — 사유가 남아야 사람이 확인할 수 있다', () => {
    const b = build(set);
    expect((b.contacts ?? []).length).toBeGreaterThan(0);
  });
});

describe('★② 보어 끼워맞춤 — 축에 끼운 것은 간섭이 아니다', () => {
  const shaftAsm = (gearBore: number) => ({
    name: 't',
    parts: [
      { id: 'shaft', type: 'cylinder', role: 'shaft', params: { diameter: 40, length: 400 }, at: { tx: 0, ty: 0, tz: 0 } },
      { id: 'gear', type: 'spur_gear', role: 'joint', params: { module: 3, teeth: 40, thickness: 25, boreDia: gearBore }, at: { tx: 0, ty: 0, tz: 150 } },
    ],
  });

  it('⌀40 축 → ⌀40 보어: 조립이다(접촉으로 기록)', () => {
    const b = build(shaftAsm(40));
    expect(b.interferences ?? []).toEqual([]);
    // 260718d 의 「핀-보어 관통」(수직 cylinder × 홀 선언 부재)이 먼저 잡을 수도 있다 —
    // 둘 중 어느 규칙이 잡든 **간섭이 아니라 접촉으로, 사유를 달고** 남는 것이 요건이다.
    expect(noteOf(b, 'shaft', 'gear')).toMatch(/보어 끼워맞춤|핀-보어 관통/);
  });

  it('★⌀40 축 → ⌀20 보어: **안 들어간다** — 진짜 간섭으로 남아야 한다', () => {
    const b = build(shaftAsm(20));
    expect((b.interferences ?? []).length, '보어가 작은데 면제하면 판정이 공허하다').toBeGreaterThan(0);
  });

  /**
   * ⚠ `pillow_block` 은 원점이 **모서리**이고 보어가 **로컬 y축**을 따라 뚫린다
   * (`assemblyToComposeIntent` 의 `rotate:[-90,0,0]` 보어 실린더). 그래서 축은 **수평(y)** 이고
   * 블록은 보어 중심이 축선에 오도록 tx=-width/2 · tz=-height 로 놓아야 한다.
   * 어휘 기하를 모르고 「z축 원점중심」으로 가정하면 면제가 안 걸린다 — 실제로 그렇게 틀렸다.
   */
  it('필로우블록이 수평축에 앉는다 — 보어 축·중심이 어휘마다 다르다', () => {
    const b = build({
      name: 't',
      parts: [
        // ry:-90 → cylinder 길이축이 y 로 (수평축)
        { id: 'shaft', type: 'cylinder', role: 'shaft', params: { diameter: 40, length: 400 }, at: { tx: 0, ty: 0, tz: 0, rx: -90 } },
        { id: 'pb_1', type: 'pillow_block', role: 'bearing', params: { boreDia: 40, width: 140, height: 70, depth: 35 }, at: { tx: -70, ty: 100, tz: -70 } },
      ],
    });
    expect(b.interferences ?? []).toEqual([]);
    expect(noteOf(b, 'shaft', 'pb_1')).toMatch(/보어 끼워맞춤/);
  });

  it('커플링 플랜지가 축 끝에 앉는다', () => {
    const b = build({
      name: 't',
      parts: [
        { id: 'shaft', type: 'cylinder', role: 'shaft', params: { diameter: 40, length: 400 }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'coupling', type: 'flange', role: 'joint', params: { outerDia: 120, boreDia: 40, thickness: 18, bcd: 90, boltHoleD: 11, boltCount: 6 }, at: { tx: 0, ty: 0, tz: 340 } },
      ],
    });
    expect(b.interferences ?? []).toEqual([]);
    expect(noteOf(b, 'shaft', 'coupling')).toMatch(/보어 끼워맞춤/);
  });

  it('★축이 보어 중심에서 벗어나면 면제하지 않는다 — 위치를 안 보면 판정이 공허하다', () => {
    const b = build({
      name: 't',
      parts: [
        { id: 'shaft', type: 'cylinder', role: 'shaft', params: { diameter: 40, length: 400 }, at: { tx: 0, ty: 0, tz: 0 } },
        // 보어는 ⌀40 이지만 플랜지가 옆으로 40mm 밀려 축이 보어를 안 지난다
        { id: 'coupling', type: 'flange', role: 'joint', params: { outerDia: 120, boreDia: 40, thickness: 18, bcd: 90, boltHoleD: 11, boltCount: 6 }, at: { tx: 40, ty: 0, tz: 340 } },
      ],
    });
    expect((b.interferences ?? []).length).toBeGreaterThan(0);
  });
});

/**
 * ★결정론 교정 3종(260803) — 고정 코퍼스 A/B 에서 **부유 22→1 · 간섭 34→5** 를 만든 것들.
 * 셋 다 「지어내지 않는다」를 지킨다: 치수 불변 · 답이 하나뿐인 정렬 · 개선될 때만 채택.
 */
describe('★④ 자동 교정 — 결과가 나오게 하되 지어내지 않는다', () => {
  type PC = { assembly: unknown; corrections: Array<{ id: string; fix: string }> };
  const correct = autoPlaceCorrect as unknown as (a: unknown) => PC;

  it('★보어 정렬 — z 보어 기어를 x축 축에 물리면 동축으로 돌려 맞춘다', () => {
    // 실측 계기: 모델이 축만 ry:90 으로 눕히고 기어·플랜지는 무회전으로 뒀다(간섭 3건).
    const pc = correct({
      name: 't',
      parts: [
        { id: 'shaft', type: 'cylinder', role: 'shaft', params: { diameter: 40, length: 400 }, at: { tx: 0, ty: 0, tz: 0, ry: 90 } },
        { id: 'gear', type: 'spur_gear', role: 'joint', params: { module: 3, teeth: 40, thickness: 25, boreDia: 40 }, at: {} },
      ],
    });
    expect(pc.corrections.find((c) => c.id === 'gear')?.fix).toBe('bore-align-x');
    const b = build(pc.assembly);
    expect(b.interferences ?? [], '동축으로 맞춘 뒤에는 간섭이 아니다').toEqual([]);
    // 회전 뒤 기어의 보어 축이 축과 같아졌는지 — 판정의 근거를 직접 확인한다
    const gear = (pc.assembly as { parts: Array<{ id: string; at?: Record<string, number> }> }).parts.find((p) => p.id === 'gear')!;
    expect(gear.at?.ry, '축이 ry:90(x축)이므로 기어도 같아야 한다').toBe(90);
  });

  it('★긴 축이 어긋난 부재를 90° 돌려 얹는다 — 치수는 그대로', () => {
    // 다리는 x 로 1400 떨어져 있는데 좌판의 긴 축(1800)이 y 였다 → 어디에도 안 걸린다.
    const pc = correct({
      name: 't',
      parts: [
        { id: 'leg_l', type: 'box', role: 'frame', params: { width: 400, depth: 450, height: 400 }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'leg_r', type: 'box', role: 'frame', params: { width: 400, depth: 450, height: 400 }, at: { tx: 1400, ty: 0, tz: 0 } },
        { id: 'seat', type: 'box', role: 'board', params: { width: 60, depth: 1800, height: 40 }, at: { tx: 870, ty: -855, tz: 400 } },
      ],
    });
    expect(pc.corrections.find((c) => c.id === 'seat')?.fix).toMatch(/^rotate-[xyz]90$/);
    const b = build(pc.assembly);
    expect(b.support?.floating ?? []).toEqual([]);
  });

  it('★서로 얹힌 두 부품을 「지지받았다」로 보지 않는다 — 지면 체인만 받침이다', () => {
    // 실측: 책상 상판 4장이 서로 닿아 종전 보정기는 「접촉」으로 통과시켰지만
    // 판정기(supportCheck)는 지면까지의 체인이 없어 전부 부유로 잡았다 — 기준이 갈렸다.
    const pc = correct({
      name: 't',
      parts: [
        { id: 'floor', type: 'plate_with_holes', role: 'floor', params: { width: 3000, depth: 3000, thickness: 20 }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'top_a', type: 'box', role: 'table', params: { width: 1400, depth: 700, height: 25 }, at: { tx: 200, ty: 170, tz: 2240 } },
        { id: 'top_b', type: 'box', role: 'table', params: { width: 1400, depth: 700, height: 25 }, at: { tx: 1400, ty: 170, tz: 2264.5 } },
      ],
    });
    const b = build(pc.assembly);
    expect(b.support?.floating ?? [], '공중에서 서로 기대고 있으면 안 된다').toEqual([]);
    expect(pc.corrections.filter((c) => c.fix.startsWith('drop')).length).toBeGreaterThan(0);
  });

  it('★교정은 개선될 때만 채택한다 — 이미 제자리인 것은 건드리지 않는다', () => {
    const pc = correct({
      name: 't',
      parts: [
        { id: 'base', type: 'plate_with_holes', role: 'slab', params: { width: 1000, depth: 1000, thickness: 50 }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'blk', type: 'box', role: 'frame', params: { width: 200, depth: 300, height: 100 }, at: { tx: 100, ty: 100, tz: 50 } },
      ],
    });
    expect(pc.corrections, '정상 배치에 보정이 붙으면 그게 잡음이다').toEqual([]);
  });
});

describe('★③ 면제는 선언·기하에 근거한다 — 아무 겹침이나 통과시키지 않는다', () => {
  it('role 을 안 붙인 봉이 판을 파고들면 간섭이다', () => {
    const b = build({
      name: 't',
      parts: [
        { id: 'plate', type: 'plate_with_holes', role: 'plate', params: { width: 200, depth: 200, thickness: 40 }, at: { tx: 0, ty: 0, tz: 0 } },
        // role 없음 + 두 축 내포도 아님(판 옆구리를 파고든다)
        { id: 'rod', type: 'box', params: { width: 300, depth: 30, height: 30 }, at: { tx: -50, ty: 20, tz: 5 } },
      ],
    });
    expect((b.interferences ?? []).length).toBeGreaterThan(0);
  });

  it('두 블록이 절반씩 겹치면 간섭이다 — 체결 어휘를 써도 예외가 아니다', () => {
    const b = build({
      name: 't',
      parts: [
        { id: 'blk_a', type: 'box', role: 'frame', params: { width: 200, depth: 200, height: 200 }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'blk_b', type: 'box', role: 'fastener', params: { width: 200, depth: 200, height: 200 }, at: { tx: 100, ty: 100, tz: 0 } },
      ],
    });
    expect((b.interferences ?? []).length, 'role:fastener 만으로 통과하면 안 된다(두 축 내포 조건)').toBeGreaterThan(0);
  });
});
