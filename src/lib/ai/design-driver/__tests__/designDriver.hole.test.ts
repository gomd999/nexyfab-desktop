/**
 * designDriver.hole.test.ts — WB-9 구멍(OCCT boolean cut) 편입 acceptance.
 *
 * 구멍 뚫린 부품이 드라이버 전 구간을 통과한다: plan → build → geometry 게이트
 * (구멍 전 판재) → hole 게이트(실 BRepAlgoAPI_Cut + BRepGProp 순부피 실측) → 패키지.
 *
 * 이 갭이 실제로 무엇을 막고 있었는지: 260723 A-4 실측(n=12, 실 DeepSeek)에서
 * 계획이 통과한 브리프의 **5/12가 구멍 하나 때문에** verify에서 떨어졌다. 스키마에
 * 구멍이 없어 LLM이 구멍을 별도 body로 만들었고, geometry 게이트가 "AABB 겹침 —
 * 부피 합 정의 불가"로 정확히 거부했기 때문(모델 잘못이 아니라 표현 수단 부재).
 *
 * OCCT 의존 케이스는 wasm 미가용 시 스킵(형제 nodeOcctBridge 테스트와 동일 규약).
 * 블라인드·비-extrude 거부 케이스는 커널 로드 전에 끝나므로 무조건 실행된다.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runDesignDriver } from '../index';
import { fixturePlanner, holedPlatePlan } from '../fixturePlanner';
import { makeLlmPlanner } from '../llmPlanner';
import { buildHoleArtifact, holeGate } from '../holeGate';
import { loadOcctNode } from '@/lib/occt/nodeOcctLoader';
import type { DriverResult, PlanPart } from '../types';

function expectOk(res: DriverResult): asserts res is Extract<DriverResult, { ok: true }> {
  if (!res.ok) throw new Error(`driver refused: ${res.refusal.stage} — ${res.refusal.reason}`);
}

let occtOk = false;
beforeAll(async () => {
  const r = await loadOcctNode();
  occtOk = r.ok;
  if (!r.ok) console.warn(`[WB-9 hole] OCCT unavailable — kernel cases skipped: ${r.reason}`);
  // 부하가 걸린 머신에서 wasm 로드가 60s를 넘겨 beforeAll이 죽는 일이 있었다 —
  // 벽시계 예산에 머신 속도 가정을 넣지 않는다(gmsh 테스트에서 배운 것과 같은 부류).
}, 180_000);

describe('WB-9 driver integration — 구멍이 커널 cut으로 뚫리고 실측된다', () => {
  it('holed-plate 픽스처 → 전 게이트 통과 → 커널이 실측한 순부피가 패키지에 실린다', async () => {
    if (!occtOk) return;
    const res = await runDesignDriver(
      { id: 'holed-plate', text: '네 모서리에 ⌀6.5 구멍이 있는 마운팅 플레이트', params: { fixture: 'holed-plate' } },
      { planner: fixturePlanner },
    );
    expectOk(res);
    for (const g of res.gates) expect(g.pass, `${g.id}: ${g.reason ?? ''}`).toBe(true);

    const hg = res.gates.find((g) => g.id === 'hole:plate');
    expect(hg, 'hole 게이트가 있어야 한다').toBeTruthy();
    expect(hg!.kind).toBe('hole');
    expect(hg!.metrics.holeCount).toBe(4);
    // 소재 = 120×80×10 = 96000 mm³ (커널 실측)
    expect(hg!.metrics.baseVolumeMm3).toBeCloseTo(96000, 3);
    // 구멍 4개가 실제로 재료를 제거했다 — 근사 πr²t 기준 4×π×3.25²×10 ≈ 1327 mm³
    const removed = hg!.metrics.removedVolumeMm3;
    expect(removed).toBeGreaterThan(1300);
    expect(removed).toBeLessThan(1340);
    expect(hg!.metrics.netVolumeMm3).toBeLessThan(96000);
    // 커널 순부피 ↔ 선언한 절삭이 함의하는 부피가 1e-6 이내로 일치
    expect(hg!.metrics.netVolumeRelError).toBeLessThan(1e-6);
    // 원형 홀은 다각형 근사가 아니라 분석형 OCCT 원통이다.
    expect(hg!.metrics.tessellationAreaRelDev).toBe(0);
    expect(removed).toBeCloseTo(4 * Math.PI * 3.25 * 3.25 * 10, 3);

    const holes = res.package.parts[0]!.holes!;
    expect(holes.count).toBe(4);
    expect(holes.schedule).toHaveLength(4);
    for (const c of holes.schedule) {
      expect(c.removedMm3).toBeGreaterThan(0);
      expect(c.shape).toBe('round');
      expect(c.depthMm).toBeNull();          // 관통
      expect(Number.isFinite(c.atX)).toBe(true);
      expect(Number.isFinite(c.atY)).toBe(true);
    }
    expect(holes.netVolumeMm3).toBeCloseTo(hg!.metrics.netVolumeMm3, 6);
    if (holes.step) expect(holes.step.startsWith('ISO-10303-21')).toBe(true);

    // geometry 게이트는 여전히 구멍 전 판재를 잰다 — 두 수치가 서로 다른 것을
    // 재고 있다는 사실이 노트로 드러나야 한다(둘 중 하나를 조용히 덮어쓰면 안 됨).
    expect(hg!.notes.join(' ')).toContain('구멍 반영 전 총량');
  }, 120_000);

  it('구멍 일람표가 도면 시트에 실린다 — 태그·좌표·⌀·THRU/깊이(도면 계층 holeTable 소비)', async () => {
    if (!occtOk) return;
    const res = await runDesignDriver(
      { id: 'holed-plate', text: '4구멍 플레이트', params: { fixture: 'holed-plate' } },
      { planner: fixturePlanner },
    );
    expectOk(res);
    const sheet = res.package.parts[0]!.sheet as { holes?: ReadonlyArray<{ id: string; x: number; y: number; diameter: number; depth?: number }> };
    expect(sheet.holes, '시트에 구멍 행이 실려야 한다').toBeTruthy();
    expect(sheet.holes!).toHaveLength(4);
    for (const h of sheet.holes!) {
      expect(h.diameter).toBeCloseTo(6.5, 6);
      expect(h.depth).toBeUndefined();       // 관통 → THRU
      expect(Number.isFinite(h.x)).toBe(true);
    }
    // 실제 표 렌더러가 이 IR을 먹는지까지 확인(도면 계층 재사용 증명)
    const { buildHoleTable } = await import('@/lib/drawing/holeTable');
    const rows = buildHoleTable(sheet.holes!);
    expect(rows).toHaveLength(4);            // 기본은 구멍당 한 행(A1..A4)
    expect(rows.map((r) => r.tag)).toEqual(['A1', 'A2', 'A3', 'A4']);
    for (const r of rows) expect(r.depthLabel).toBe('THRU');
    // 동일 ⌀·깊이는 옵션으로 한 행에 묶인다(도면 관례)
    const grouped = buildHoleTable(sheet.holes!, { groupIdentical: true });
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.count).toBe(4);
    expect(grouped[0]!.diameter).toBeCloseTo(6.5, 6);
  }, 120_000);

  it('블라인드는 표에 깊이 라벨로, 사각 컷아웃은 표에서 제외된다(⌀ 개념 없음)', async () => {
    const base = holedPlatePlan().parts[0]!;
    const { buildDrawingArtifact } = await import('../drawingGate');
    const plan = holedPlatePlan();
    plan.parts[0] = {
      ...base,
      holes: [
        { id: 'b1', kind: 'blind', diameterMm: 8, at: { x: 20, y: 20 }, depthMm: 4 },
        { id: 'r1', shape: 'rect', widthMm: 20, heightMm: 10, at: { x: 60, y: 40 } },
      ],
    };
    const art = buildDrawingArtifact(plan);
    const sheet = art.sheets.get('plate') as { holes?: ReadonlyArray<{ id: string; depth?: number }> };
    expect(sheet.holes).toHaveLength(1);     // rect 제외
    expect(sheet.holes![0]!.id).toBe('b1');
    expect(sheet.holes![0]!.depth).toBe(4);
  });

  it('사각 컷아웃 — 각파이프 보어를 커널이 정확히 깎는다(테셀레이션 없음)', async () => {
    if (!occtOk) return;
    // 50×50 각파이프, 벽 4 mm, 길이 120 → 보어 42×42.
    // 사각 공구는 정확하므로 순부피 = 50²×120 − 42²×120 = 300000 − 211680 = 88320.
    const base = holedPlatePlan().parts[0]!;
    const part: PlanPart = {
      ...base,
      partId: 'tube',
      bodies: [{
        bodyId: 'b0',
        feature: {
          kind: 'extrude',
          loop: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }],
          depth: 120,
          direction: 'one_sided',
          mode: 'add',
        } as unknown as PlanPart['bodies'][number]['feature'],
      }],
      holes: [{ id: 'bore', shape: 'rect', widthMm: 42, heightMm: 42, at: { x: 25, y: 25 } }],
    };
    const art = await buildHoleArtifact(part);
    expect(art!.ok, art!.reason).toBe(true);
    expect(art!.baseVolumeMm3).toBeCloseTo(300000, 3);
    expect(art!.netVolumeMm3).toBeCloseTo(88320, 3);       // 커널 실측
    expect(art!.expectedNetVolumeMm3).toBeCloseTo(88320, 6); // 선언 절삭이 함의하는 값
    // 사각 공구는 테셀레이션이 없다 — 근사 편차 0으로 정직 보고
    expect(art!.tessellationAreaRelDev).toBe(0);
    expect(art!.cuts[0]!.label).toBe('42×42 rect');
    expect(holeGate(part, art).pass).toBe(true);
  }, 120_000);

  it('사각 컷아웃에 width/height가 없으면 커널 전에 거부', async () => {
    const part: PlanPart = {
      ...holedPlatePlan().parts[0]!,
      holes: [{ id: 'bad', shape: 'rect', at: { x: 10, y: 10 } }],
    };
    const art = await buildHoleArtifact(part);
    expect(art!.ok).toBe(false);
    expect(art!.reason).toMatch(/positive widthMm and heightMm/);
  });

  it('부품 밖에 찍힌 구멍은 재료를 안 깎으므로 거부된다 (도면엔 있고 실물엔 없는 부품 방지)', async () => {
    if (!occtOk) return;
    const plan = holedPlatePlan();
    plan.parts[0]!.holes![0]!.at = { x: 500, y: 500 }; // 판재(120×80) 바깥
    const mockLlm = makeLlmPlanner({ complete: async () => JSON.stringify(plan) });
    const res = await runDesignDriver({ id: 'llm-hole-outside', text: 'x' }, { planner: mockLlm });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal.stage).toBe('verify');
    expect(res.refusal.failedGateIds).toContain('hole:plate');
    expect(res.refusal.reason).toMatch(/removed no material/);
  }, 120_000);

  it('블라인드 홀 — 윗면에서 선언 깊이만큼만 커널이 파낸다(관통 아님)', async () => {
    if (!occtOk) return;
    // 120×80×10 판재에 ⌀10 블라인드 4 mm → 제거량 = 정확한 πr² × 4.
    const part: PlanPart = {
      ...holedPlatePlan().parts[0]!,
      holes: [{ id: 'h1', kind: 'blind', diameterMm: 10, at: { x: 30, y: 30 }, depthMm: 4 }],
    };
    const art = await buildHoleArtifact(part);
    expect(art!.ok, art!.reason).toBe(true);
    const circleArea = Math.PI * 5 * 5;
    expect(art!.cuts[0]!.removedMm3).toBeCloseTo(circleArea * 4, 3);   // 깊이 4만큼만
    expect(art!.cuts[0]!.depthMm).toBe(4);
    expect(art!.netVolumeMm3).toBeCloseTo(96000 - circleArea * 4, 3);
    expect(art!.netVolumeMm3).toBeGreaterThan(96000 - circleArea * 10); // 관통이었다면 이보다 작다
    expect(holeGate(part, art).pass).toBe(true);
  }, 120_000);

  it('블라인드 깊이가 두께 이상이면 관통으로 둔갑시키지 않고 거부', async () => {
    const part: PlanPart = {
      ...holedPlatePlan().parts[0]!,
      holes: [{ id: 'h1', kind: 'blind', diameterMm: 6, at: { x: 20, y: 20 }, depthMm: 10 }],
    };
    const art = await buildHoleArtifact(part);
    expect(art!.ok).toBe(false);
    expect(art!.reason).toMatch(/that is a through hole/);
  });

  it('블라인드에 깊이가 없으면 커널 전에 거부', async () => {
    const part: PlanPart = {
      ...holedPlatePlan().parts[0]!,
      holes: [{ id: 'h1', kind: 'blind', diameterMm: 6, at: { x: 20, y: 20 } }],
    };
    const art = await buildHoleArtifact(part);
    expect(art!.ok).toBe(false);
    expect(art!.reason).toMatch(/positive depthMm/);
  });

  it('extrude가 아닌 bodies[0]에 구멍을 선언하면 거부 (커널 경로가 없는 형상)', async () => {
    const base = holedPlatePlan().parts[0]!;
    const part: PlanPart = {
      ...base,
      bodies: [{ bodyId: 'b0', feature: { kind: 'revolve', loop: [{ x: 1, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }], angleDegrees: 360, mode: 'add' } }],
    };
    const art = await buildHoleArtifact(part);
    expect(art!.ok).toBe(false);
    expect(art!.reason).toMatch(/extrude solid/);
  });

  it('지름이 0 이하이면 커널을 부르기도 전에 거부', async () => {
    const part: PlanPart = { ...holedPlatePlan().parts[0]!, holes: [{ id: 'h1', diameterMm: 0, at: { x: 10, y: 10 } }] };
    const art = await buildHoleArtifact(part);
    expect(art!.ok).toBe(false);
    expect(art!.reason).toMatch(/diameter must be positive/);
  });

  it('구멍을 선언하지 않은 파트는 게이트가 적용되지 않는다(커널 로드도 없음)', async () => {
    const part = holedPlatePlan().parts[0]!;
    const noHoles: PlanPart = { ...part };
    delete noHoles.holes;
    expect(await buildHoleArtifact(noHoles)).toBeNull();
    expect(holeGate(noHoles, null).pass).toBe(true);
  });
});
