/**
 * 2D→3D 브리지 정식 연결 테스트 — scripts/drawing-to-3d/to-intent.mjs 산출물이
 * ComponentIntent로서 emitOpenScad를 통과하고 subtract(difference)가 올바른지.
 */
import { describe, it, expect } from 'vitest';
// JS bridge module under scripts/ (resolves as untyped); validated structurally
// against ComponentIntent below.
import { toComponentIntent } from '../../../../../scripts/drawing-to-3d/to-intent.mjs';
import { emitComponent } from './emitOpenScad';
import type { ComponentIntent } from './schema';

const SAMPLES: Record<string, object> = {
  plate_with_holes: { type: 'plate_with_holes', width: 100, depth: 50, thickness: 14, holes: [{ x: 12, y: 12, d: 8 }, { x: 88, y: 12, d: 8 }], confidence: 1 },
  stepped_plate: { type: 'stepped_plate', width: 120, depth: 60, thickness: 16, stepWidth: 40, stepThickness: 10, confidence: 1 },
  l_bracket: { type: 'l_bracket', legA: 80, legB: 60, width: 40, thickness: 6, confidence: 1 },
  flange: { type: 'flange', outerDia: 150, boreDia: 50, thickness: 14, bcd: 100, boltHoleD: 10, boltCount: 6, confidence: 1 },
  bent_sheet: { type: 'bent_sheet', webWidth: 60, flangeHeight: 30, length: 100, thickness: 2, confidence: 1 },
};

describe('drawing-to-3d bridge → ComponentIntent → emitOpenScad', () => {
  for (const [type, sample] of Object.entries(SAMPLES)) {
    it(`${type}: emits valid, deterministic SCAD`, () => {
      const intent = toComponentIntent(sample, `t-${type}`) as ComponentIntent;
      expect(intent.features.length).toBeGreaterThan(0);
      const scad = emitComponent(intent);
      // 결정론: 동일 입력 → 동일 출력
      expect(emitComponent(toComponentIntent(sample, `t-${type}`) as ComponentIntent)).toBe(scad);
      // 구조 건전성: 중괄호 짝
      const open = (scad.match(/\{/g) ?? []).length;
      const close = (scad.match(/\}/g) ?? []).length;
      expect(open).toBe(close);
      expect(scad).toContain('module comp_');
    });
  }

  it('subtract features wrap in difference() — holes/bore', () => {
    const plate = emitComponent(toComponentIntent(SAMPLES.plate_with_holes, 'p') as ComponentIntent);
    expect(plate).toContain('difference() {');
    expect((plate.match(/cylinder/g) ?? []).length).toBe(2); // 구멍 2개
    const flange = emitComponent(toComponentIntent(SAMPLES.flange, 'f') as ComponentIntent);
    expect(flange).toContain('difference() {');
    expect(flange).toContain('for (a ='); // 볼트 원형 패턴
  });

  it('additive-only parts do NOT introduce difference()', () => {
    const scad = emitComponent(toComponentIntent(SAMPLES.l_bracket, 'l') as ComponentIntent);
    expect(scad).not.toContain('difference()');
  });

  it('bridge rejects unknown types', () => {
    expect(() => toComponentIntent({ type: 'gear' })).toThrow(/unsupported/);
  });
});
