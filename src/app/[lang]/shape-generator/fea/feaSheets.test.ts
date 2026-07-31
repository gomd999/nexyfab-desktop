/**
 * feaSheets — **내보낸 파일이 맥락을 잃지 않는가** (260801).
 *
 * 여기서 잡는 것은 「시트가 만들어지나」가 아니라 **숫자만 나가서 스크리닝 추정값이
 * 인증급 결과로 읽히는 것**이다. 파일은 원래 맥락에서 떨어져 나가 돌아다닌다.
 */
import { describe, expect, it } from 'vitest';
import { feaResultSheets } from './feaSheets';
import type { FeaPackageOutput } from '../analysis/feaPackage';

function fake(over: Partial<FeaPackageOutput> = {}): FeaPackageOutput {
  return {
    result: {
      maxStress: 123.456, maxDisplacement: 0.5, minStress: 1, safetyFactor: 1.9,
      method: 'linear-fem-tet', elementCount: 4200, dofCount: 9000, converged: true,
      vonMisesStress: new Float32Array(), displacement: new Float32Array(), displacementVectors: new Float32Array(),
    },
    material: { youngsModulus: 200, poissonRatio: 0.3, yieldStrength: 235, density: 7.85, alpha: 12e-6, label: '일반구조강', strengthNote: '항복강도 235 MPa' },
    materialKey: 'steel', loadN: 981, loadNote: '사용자 지정 100 kg × g',
    mesh: { triangles: 100, fixedTris: 10, loadTris: 10 },
    ...over,
  } as unknown as FeaPackageOutput;
}

describe('요약 시트', () => {
  it('핵심 수치와 단위를 담는다', () => {
    const { sheets } = feaResultSheets(fake());
    const rows = sheets.요약!;
    expect(rows.find((r) => r.항목 === '최대 von Mises 응력')?.값).toBeCloseTo(123.456, 3);
    expect(rows.find((r) => r.항목 === '안전율 (항복/최대응력)')?.값).toBeCloseTo(1.9, 3);
    // 하중을 지어낸 값이 아니라 근거와 함께 싣는다
    expect(rows.find((r) => r.항목 === '하중 근거')?.값).toContain('사용자 지정');
  });
});

describe('★한계 시트 — 이 모듈의 존재 이유', () => {
  it('★한계 시트는 **항상** 있다 — 문제가 없어도 「검사했고 없음」을 적는다', () => {
    const { sheets } = feaResultSheets(fake());
    expect(sheets.한계).toBeDefined();
    expect(sheets.한계!.length).toBeGreaterThan(0);
  });

  it('★스크리닝 등급이면 「과소평가」라고 명시한다 — 숫자만 보고 인증급으로 읽지 않게', () => {
    const { sheets } = feaResultSheets(fake({
      raiser: { detected: true, applied: false, grade: 'screening', dofCount: 100, converged: true },
    } as Partial<FeaPackageOutput>));
    const text = JSON.stringify(sheets.한계);
    expect(text).toContain('과소평가');
  });

  it('★수렴하지 않은 해는 「신뢰할 수 없다」고 적는다', () => {
    const bad = fake();
    (bad.result as { converged: boolean }).converged = false;
    const text = JSON.stringify(feaResultSheets(bad).sheets.한계);
    expect(text).toContain('수렴하지 않');
    expect(text).toContain('신뢰할 수 없다');
  });

  it('gmsh 미사용 사유가 있으면 그대로 싣는다 — 왜 정밀 해석이 안 됐는지 알아야 한다', () => {
    const { sheets } = feaResultSheets(fake({
      raiser: { detected: true, applied: false, grade: 'engineering', dofCount: 1, converged: true, gmshError: 'binary absent' },
    } as Partial<FeaPackageOutput>));
    expect(JSON.stringify(sheets.한계)).toContain('binary absent');
  });

  it('★해석 가정(선형 등방)은 등급과 무관하게 항상 적는다', () => {
    const text = JSON.stringify(feaResultSheets(fake()).sheets.한계);
    expect(text).toContain('선형 등방');
    expect(text).toContain('소성');
  });
});

describe('재료 시트', () => {
  it('물성과 강도 근거를 함께 싣는다 — 숫자만으로는 무엇을 가정했는지 모른다', () => {
    const rows = feaResultSheets(fake()).sheets.재료!;
    expect(rows.find((r) => r.물성 === '항복강도')?.값).toBe(235);
    expect(rows.find((r) => r.물성 === '강도 근거')?.값).toContain('235 MPa');
  });
});
