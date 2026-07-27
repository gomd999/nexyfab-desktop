/**
 * drawingGate 가 뷰 내 구멍 원 마크를 실제로 내보내는가 (260728).
 * 렌더링 쪽은 `SheetRenderer.holeMarks.test.tsx` 가 본다 — 여기는 **발생지**만.
 */
import { describe, it, expect } from 'vitest';
import { buildDrawingArtifact } from '../drawingGate';
import { holedPlatePlan } from '../fixturePlanner';
import type { DesignPlan, PlanPart } from '../types';

describe('drawingGate — holeMarks 발생', () => {
  it('둥근 구멍이 top 뷰 마크로 나가고 좌표·지름이 선언과 일치한다', () => {
    const plan = holedPlatePlan();
    const art = buildDrawingArtifact(plan);
    const part = plan.parts[0]!;
    const sheet = art.sheets.get(part.partId);
    expect(sheet).toBeTruthy();
    const marks = sheet!.holeMarks ?? [];
    const round = (part.holes ?? []).filter((h) => h.shape !== 'rect');
    expect(marks).toHaveLength(round.length);
    expect(marks.length).toBeGreaterThan(0);
    for (const m of marks) expect(m.viewportId).toBe('top'); // 프로파일 평면을 보여주는 뷰
    for (const h of round) {
      const m = marks.find((q) => q.tag === h.id);
      expect(m, h.id).toBeTruthy();
      expect(m!.xMm).toBe(h.at.x);
      expect(m!.yMm).toBe(h.at.y);
      expect(m!.diameterMm).toBe(h.diameterMm);
    }
  });

  it('사각 컷아웃은 마크에서 제외된다 — ⌀ 개념이 없다(표와 같은 기준)', () => {
    const plan = holedPlatePlan();
    const part = plan.parts[0]!;
    const rectOnly: PlanPart = {
      ...part,
      holes: [{ id: 'bore', kind: 'through', shape: 'rect', widthMm: 20, heightMm: 20, at: { x: 60, y: 40 } } as NonNullable<PlanPart['holes']>[number]],
    };
    const p: DesignPlan = { ...plan, parts: [rectOnly] };
    const sheet = buildDrawingArtifact(p).sheets.get(rectOnly.partId);
    expect(sheet?.holeMarks).toBeUndefined();
  });

  it('구멍이 없는 부품의 시트에는 holeMarks 키 자체가 없다 (하위호환)', () => {
    const plan = holedPlatePlan();
    const part = plan.parts[0]!;
    const noHoles: PlanPart = { ...part };
    delete (noHoles as { holes?: unknown }).holes;
    const sheet = buildDrawingArtifact({ ...plan, parts: [noHoles] }).sheets.get(noHoles.partId);
    expect(sheet?.holeMarks).toBeUndefined();
  });
});
