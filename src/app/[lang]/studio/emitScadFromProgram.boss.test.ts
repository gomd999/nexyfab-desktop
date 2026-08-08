// @vitest-environment node
/**
 * F-1 — SCAD 방출기의 보스 지원: 판 위 원통 보스가 union 블록에 실제로
 * 방출되는지(누락 시 SCAD 산출물과 3D 뷰가 어긋나는 조용한 결손) 고정한다.
 */
import { describe, expect, it } from 'vitest';
import { emitScadFromProgram, type FeatureProgram } from './emitScadFromProgram';

describe('emitScadFromProgram — boss (F-1)', () => {
  it('emits a bottom-anchored cylinder on the base top for each boss', () => {
    const program: FeatureProgram = {
      part: 'plate-with-boss',
      features: [
        { id: 'f1', type: 'sketchExtrude', shape: 'rect', width: 100, depth: 60, height: 8 },
        { id: 'b1', type: 'boss', diameter: 20, height: 15, posX: -20, posY: 0 },
      ],
    } as FeatureProgram;
    const scad = emitScadFromProgram(program);
    // 보스 = 베이스 상면(z=베이스 두께 변수)에서 위로 서는 원통, 중심좌표 그대로.
    expect(scad).toContain('/* [Bosses] */');
    expect(scad).toMatch(/translate\(\[-20, 0, [a-z_0-9]+\]\) cyl\(d=boss_diameter, h=boss_height, anchor=BOTTOM\)/);
    // 파라미터 슬라이더로 노출(치수 연동).
    expect(scad).toContain('boss_diameter = 20;');
    expect(scad).toContain('boss_height = 15;');
  });

  it('no bosses → no boss section (no phantom params)', () => {
    const program: FeatureProgram = {
      part: 'plain-plate',
      features: [{ id: 'f1', type: 'sketchExtrude', shape: 'rect', width: 100, depth: 60, height: 8 }],
    } as FeatureProgram;
    const scad = emitScadFromProgram(program);
    expect(scad).not.toContain('[Bosses]');
    expect(scad).not.toContain('boss_diameter');
  });
});
