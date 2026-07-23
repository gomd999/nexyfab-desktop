/**
 * feaPackage 테스트 (#7) — 설계 패키지 FEA 정밀화 체인.
 * STL 파싱 → 자동 경계조건(바닥고정·상면하중) → runSimpleFEA → 리포트 HTML.
 * STL은 합성(직육면체 12삼각형) — openscad 렌더 없이 결정론 검증.
 */
import { describe, it, expect } from 'vitest';
import { stlToGeometry, autoConditions, feaFromStl, feaReportHtml, FEA_MATERIALS } from './feaPackage';

/** w×d×h 직육면체 바이너리 STL(12 tri) 합성 — z=0 바닥, z=h 상면. */
function boxStl(w: number, d: number, h: number): Uint8Array {
  const quads: Array<[number[], number[], number[], number[]]> = [
    [[0, 0, 0], [w, d, 0], [w, 0, 0], [0, d, 0]],       // 바닥 (z=0)
    [[0, 0, h], [w, 0, h], [w, d, h], [0, d, h]],       // 상면 (z=h)
    [[0, 0, 0], [w, 0, 0], [w, 0, h], [0, 0, h]],       // y=0
    [[0, d, 0], [w, d, h], [w, d, 0], [0, d, h]],       // y=d
    [[0, 0, 0], [0, 0, h], [0, d, h], [0, d, 0]],       // x=0
    [[w, 0, 0], [w, d, 0], [w, d, h], [w, 0, h]],       // x=w
  ];
  const tris: number[][][] = [];
  for (const [a, b, c, dd] of quads) { tris.push([a, b, c]); tris.push([a, c, dd]); }
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, i) => {
    const o = 84 + i * 50 + 12;
    t.flat().forEach((v, k) => dv.setFloat32(o + k * 4, v, true));
  });
  return new Uint8Array(buf);
}

describe('feaPackage', () => {
  it('STL 파싱: 삼각형 수·정점 좌표 보존', () => {
    const g = stlToGeometry(boxStl(100, 50, 20));
    expect(g.getAttribute('position').count).toBe(36); // 12 tri × 3
  });

  it('자동 경계조건: 바닥 고정 2tri + 상면 하중 2tri', () => {
    const g = stlToGeometry(boxStl(100, 50, 20));
    const { conditions, fixedTris, loadTris } = autoConditions(g, 1000);
    expect(fixedTris).toBe(2);
    expect(loadTris).toBe(2);
    expect(conditions[0].type).toBe('fixed');
    expect(conditions[1].type).toBe('force');
    expect(conditions[1].value).toEqual([0, 0, -1000]);
  });

  it('압축 블록 FEA: 응력·변위·안전율 유한값 + 방법 표기', () => {
    const out = feaFromStl({ stl: boxStl(100, 100, 100), materialKey: 'steel', loadN: 100_000, loadNote: '테스트 100kN' });
    expect(['linear-fem-tet', 'beam-theory']).toContain(out.result.method);
    expect(out.result.maxStress).toBeGreaterThan(0);
    expect(Number.isFinite(out.result.maxDisplacement)).toBe(true);
    expect(out.result.safetyFactor).toBeGreaterThan(0);
    // sanity: 100kN / (100×100mm²) = 10 MPa 공칭 — 같은 자릿수여야 한다(성긴 메시 허용폭)
    expect(out.result.maxStress).toBeGreaterThan(1);
    expect(out.result.maxStress).toBeLessThan(100);
  });

  it('비표준 재료 키 → STS316 폴백, 콘크리트는 압축강도 기준', () => {
    expect(FEA_MATERIALS.concrete.yieldStrength).toBe(24);
    const out = feaFromStl({ stl: boxStl(50, 50, 50), materialKey: 'unobtainium', loadN: 1000 });
    expect(out.materialKey).toBe('STS316');
  });

  it('리포트 HTML: 안전율·가정·비법정 문구 포함', () => {
    const out = feaFromStl({ stl: boxStl(100, 100, 100), materialKey: 'steel', loadN: 50_000, loadNote: '총질량 상당' });
    const html = feaReportHtml(out, { title: '테스트' });
    expect(html).toContain('안전율');
    expect(html).toContain('총질량 상당');
    expect(html).toContain('비법정');
    expect(html).toContain('von Mises');
  });

  // 5차 dogfooding(260723): beam-theory 폴백이 근-제로 단면(I~crossDim⁴)에서
  // 조 단위 MPa를 지어내던 결함 — 실측 189.6 TRILLION MPa on a 0.05mm sliver.
  it('극박 슬리버(200×200×0.05) → 조단위 응력 대신 정직한 implausibleGeometry 플래그', () => {
    const out = feaFromStl({ stl: boxStl(200, 200, 0.05), materialKey: 'steel', loadN: 100_000, loadNote: 'sliver' });
    if (out.result.method === 'beam-theory') {
      expect(out.result.implausibleGeometry).toBeTruthy();
      expect(out.result.maxStress).toBeLessThan(1e6); // was ~1.9e14 before the fix
      expect(out.result.safetyFactor).toBe(0);
    }
  });

  it('극박 슬리버 리포트 HTML → 응력 개산 불가 배너, 정상 박스는 배너 없음', () => {
    const thin = feaFromStl({ stl: boxStl(200, 200, 0.05), materialKey: 'steel', loadN: 100_000, loadNote: 'sliver' });
    const thinHtml = feaReportHtml(thin, { title: 't' });
    if (thin.result.method === 'beam-theory') {
      expect(thinHtml).toContain('응력 개산 불가');
    }
    const normal = feaFromStl({ stl: boxStl(100, 100, 100), materialKey: 'steel', loadN: 50_000 });
    expect(feaReportHtml(normal, { title: 't' })).not.toContain('응력 개산 불가');
  });
});
