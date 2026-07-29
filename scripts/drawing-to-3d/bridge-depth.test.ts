/**
 * 교량 판정 깊이 확장 (260729) — 부재력의 **전제**를 먼저 검사한다.
 *
 * 근거 충분성 검사를 넣고 나서야 깊이가 보였다: 교량은 평균 1.0개만 판정했고
 * girder_bridge 는 **0개**였다(철근 미입력 시 단면 검토를 만들지도 않는다).
 *
 * 추가한 것은 전부 **선언 제원끼리의 정의식**이라 가정이 없다. 그리고 이 값들 위에
 * 부재력 계산이 서 있으므로, 어긋나면 아래 계산이 전부 무의미해진다 — 먼저 걸러야 한다.
 */
import { describe, it, expect } from 'vitest';
import { buildAssemblyTemplate, listAssemblyTemplates } from './domain-assemblies.mjs';
import * as bridgeMod from './bridge-check.mjs';

type Chk = { name: string; ok: boolean; declared?: number; computed?: number; note?: string };
type Res = { ok: boolean; checks?: Chk[] };
const META = [
  ['archMeta', 'archBridgeCheck'], ['trussMeta', 'trussBridgeCheck'],
  ['cableStayedMeta', 'cableStayedCheck'], ['suspensionMeta', 'suspensionCheck'],
  ['bridgeMeta', 'bridgeCheck'],
] as const;
const run = (id: string, p?: unknown): Res => {
  const a = buildAssemblyTemplate('bridge', id, {}) as unknown as Record<string, unknown>;
  const hit = META.find(([k]) => a[k])!;
  return (bridgeMod as unknown as Record<string, (x: unknown, y: unknown) => Res>)[hit[1]](a, p ?? {});
};
const chk = (id: string, name: string) => run(id).checks?.find((c) => c.name.includes(name));

describe('girder_bridge — 판정 0개를 벗어난다', () => {
  it('바닥판 폭 = (거더수−1)×간격 + 2×내밈', () => {
    const c = chk('girder_bridge', '바닥판 폭');
    expect(c).toBeTruthy();
    expect(c!.ok).toBe(true);
    expect(c!.declared).toBe(9700);
    expect(c!.computed).toBe(9700);
  });

  it('철근을 주지 않아도 판정된다 — 제원 자기정합은 철근과 무관하다', () => {
    // 종전엔 As 미입력 → section=null → checks 자체가 없어 판정 0개였다.
    expect((run('girder_bridge').checks ?? []).length).toBeGreaterThan(0);
  });
});

describe('부재력의 전제를 먼저 본다', () => {
  it('트러스 지간 = 패널 수 × 패널 길이', () => {
    expect(chk('truss_bridge', '지간 자기정합')?.ok).toBe(true);
  });

  it('현수교 주탑 상부 높이 ≥ 케이블 새그 — 미달이면 케이블이 상판 아래로 처진다', () => {
    const c = chk('suspension_bridge', '주탑 상부 높이');
    expect(c?.ok).toBe(true);
    expect(c?.note).toContain('형상이 성립하지 않는다');
  });

  it('아치 행어 수 = 실제 행어 부품 수 — 장력이 "본당"이라 개수가 전제다', () => {
    const c = chk('arch_bridge', '행어 수 자기정합');
    expect(c?.ok).toBe(true);
    expect(c?.declared).toBe(38);
    expect(c?.computed).toBe(38);
  });
});

describe('규칙이 공허하지 않다', () => {
  it('제원이 어긋나면 잡는다 — 트러스 패널 길이 조작', () => {
    const a = buildAssemblyTemplate('bridge', 'truss_bridge', {}) as unknown as { trussMeta: Record<string, number> };
    const bad = { ...a, trussMeta: { ...a.trussMeta, panelL: 9999 } };
    const r = (bridgeMod as unknown as Record<string, (x: unknown, y: unknown) => Res>).trussBridgeCheck(bad, {});
    expect(r.checks?.find((c) => c.name.includes('지간 자기정합'))?.ok).toBe(false);
  });

  it('현수교 주탑이 새그보다 낮으면 잡는다', () => {
    const a = buildAssemblyTemplate('bridge', 'suspension_bridge', {}) as unknown as { suspensionMeta: Record<string, number> };
    const bad = { ...a, suspensionMeta: { ...a.suspensionMeta, towerAbove: 1000 } };
    const r = (bridgeMod as unknown as Record<string, (x: unknown, y: unknown) => Res>).suspensionCheck(bad, {});
    expect(r.checks?.find((c) => c.name.includes('주탑 상부 높이'))?.ok).toBe(false);
  });
});

describe('출하 교량 전종 — 신규 오탐 0', () => {
  it('평균 판정 3개 이상, 신규 자기정합 항목은 전부 통과', () => {
    let total = 0, n = 0;
    for (const t of (listAssemblyTemplates as unknown as (d: string) => { id: string }[])('bridge')) {
      const r = run(t.id);
      const ck = r.checks ?? [];
      total += ck.length; n += 1;
      // 신규로 넣은 자기정합·기하 항목은 출하 템플릿에서 전부 통과해야 한다.
      const added = ck.filter((c) => /자기정합|주탑 상부 높이/.test(c.name));
      expect(added.every((c) => c.ok), `${t.id}: ${added.filter((c) => !c.ok).map((c) => c.name)}`).toBe(true);
    }
    expect(total / n).toBeGreaterThanOrEqual(3);
  });
});

describe('압축재 좌굴 (260729b) — 명시가 검토를 대신하지 못한다', () => {
  const chk = async (id: string, fn: string, p: Record<string, unknown> = {}) => {
    const bc = await import('./bridge-check.mjs');
    const f = (bc as unknown as Record<string, (a: unknown, p: unknown) => { checks?: Array<Record<string, unknown>> }>)[fn];
    return (f(buildAssemblyTemplate('bridge', id, {}), p).checks ?? []);
  };

  it('트러스 상현재는 격점 간격으로 면내 좌굴을 실제 판정한다', async () => {
    const b = (await chk('truss_bridge', 'trussBridgeCheck')).find((c) => /면내/.test(String(c.name)));
    expect(b?.ok).toBe(true);
    expect(Number(b?.slenderness)).toBeGreaterThan(0);
    expect(String(b?.note)).toContain('KDS 14 31 25');
  });

  it('★면외 좌굴장을 횡브레이싱 간격에서 **파생**한다 (260730)', async () => {
    // ⚠ 종전엔 `Lb_chord_out_mm` 를 무조건 요구했다. 그런데 상부 횡브레이싱이 **부품으로
    //   존재하면**(role='bracing') 그 간격이 곧 면외 비지지길이다 — 지어내는 것이 아니라
    //   형상에 있는 값을 읽는 것이다(tbrace 3개소 → 최대 구간 15,000mm).
    const b = (await chk('truss_bridge', 'trussBridgeCheck')).find((c) => /면외/.test(String(c.name)));
    expect(typeof b?.ok).toBe('boolean');            // 이제 실제로 판정한다
    expect(b?.Lb_mm).toBe(15000);
    expect(String(b?.note)).toContain('횡브레이싱 최대 구간');
  });

  it('브레이싱이 없으면 종전대로 요구한다 — 없는 것을 전장으로 대신하지 않는다', async () => {
    const bc = await import('./bridge-check.mjs');
    const a = buildAssemblyTemplate('bridge', 'truss_bridge', {}) as { parts: { role?: string }[] };
    a.parts = a.parts.filter((p) => p.role !== 'bracing');
    const f = (bc as unknown as Record<string, (x: unknown, p: unknown) => { checks?: Array<Record<string, unknown>> }>).trussBridgeCheck;
    const b = (f(a, {}).checks ?? []).find((c) => /면외/.test(String(c.name)));
    expect(b?.ok).toBeNull();
    expect(JSON.stringify(b?.needInputs)).toContain('Lb_chord_out_mm');
  });

  it('마스트 단면을 **형상에서** 읽는다 — 가정 단면은 3.1배 과대였다', async () => {
    const c = (await chk('cable_stayed_bridge', 'cableStayedCheck')).find((x) => /마스트 축압축/.test(String(x.name)));
    expect(c?.A_mm2).toBe(2500 * 800);              // 부품 실단면. 종전엔 2500² 를 썼다.
  });

  it('좌굴이 항복보다 지배적이다 — 좌굴을 빼면 여유를 6배 과대평가한다', async () => {
    const cs = await chk('cable_stayed_bridge', 'cableStayedCheck');
    const yield_ = cs.find((x) => /마스트 축압축/.test(String(x.name)));
    const buck = cs.find((x) => /마스트 좌굴/.test(String(x.name)));
    expect(Number(buck?.ratio)).toBeGreaterThan(Number(yield_?.ratio) * 3);
  });

  it('RC 주탑에 강재 압축식을 들이대지 않는다 — 다른 조항이다', async () => {
    const b = (await chk('suspension_bridge', 'suspensionCheck')).find((c) => /주탑 좌굴/.test(String(c.name)));
    expect(b?.ok).toBeNull();
    expect(JSON.stringify(b?.needInputs)).toContain('towerSteel');
    const steel = (await chk('suspension_bridge', 'suspensionCheck', { towerSteel: true }))
      .find((c) => /주탑 좌굴/.test(String(c.name)));
    expect(typeof steel?.ok).toBe('boolean');       // 강재로 선언하면 판정한다
  });

  it('아치 리브 좌굴장은 형상에서 정할 수 없다 — 요구한다', async () => {
    const b = (await chk('arch_bridge', 'archBridgeCheck')).find((c) => /리브 좌굴/.test(String(c.name)));
    expect(b?.ok).toBeNull();
    expect(JSON.stringify(b?.needInputs)).toContain('Lb_rib_mm');
  });
});
