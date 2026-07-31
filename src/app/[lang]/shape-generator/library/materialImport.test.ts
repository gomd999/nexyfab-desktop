/**
 * materialImport — **틀린 물성이 조용히 통과하지 않는가** (260801).
 *
 * 이 값들은 그대로 FEA 로 들어가 안전율이 된다. 그래서 여기서 잡는 것은
 * 「파싱이 되나」가 아니라 **관대한 파서가 만드는 거짓 통과**다.
 */
import { describe, expect, it } from 'vitest';
import { importMaterialsCsv } from './materialImport';

const HDR = 'id,nameKo,densityKgM3,tensileStrengthMPa,yieldStrengthMPa';

describe('정상 인입', () => {
  it('기본 열을 읽는다', () => {
    const r = importMaterialsCsv(`${HDR}\nS45C,탄소강,7850,570,343`);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]!.yieldStrengthMPa).toBe(343);
    expect(r.rejected).toHaveLength(0);
  });

  it('한국어 헤더와 탭 구분자를 받는다', () => {
    const r = importMaterialsCsv('코드\t재료명\t밀도\t인장강도\t항복강도\nAL6061\t알루미늄\t2700\t310\t276');
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]!.id).toBe('AL6061');
  });

  it('헤더 단위를 환산한다 — g/cm³ → kg/m³ · GPa → MPa', () => {
    const r = importMaterialsCsv('id,nameKo,밀도(g/cm3),인장강도(GPa),항복강도(GPa)\nX,시료,7.85,0.57,0.343');
    expect(r.accepted[0]!.densityKgM3).toBeCloseTo(7850, 0);
    expect(r.accepted[0]!.tensileStrengthMPa).toBeCloseTo(570, 0);
  });

  it('모르는 열은 무시하되 거부 사유로 삼지 않는다', () => {
    const r = importMaterialsCsv(`${HDR},비고\nS45C,탄소강,7850,570,343,사내표준`);
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });
});

describe('★채우지 않는다 — 빈 칸·비수치', () => {
  it('★필수 수치가 비면 0 으로 채우지 않고 거부한다', () => {
    const r = importMaterialsCsv(`${HDR}\nS45C,탄소강,7850,570,`);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0]!.field).toBe('yieldStrengthMPa');
    expect(r.rejected[0]!.reason).toContain('0 으로 채우지 않는다');
  });

  it('★숫자가 아니면 NaN 으로 통과시키지 않는다 — NaN 은 비교를 전부 통과한다', () => {
    const r = importMaterialsCsv(`${HDR}\nS45C,탄소강,7850,570,미상`);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0]!.reason).toContain('숫자가 아니다');
  });

  it('선택 항목이 비면 거부하지 않고 **없는 채로** 둔다', () => {
    const r = importMaterialsCsv(`${HDR},연신율\nS45C,탄소강,7850,570,343,`);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]!.elongationPct).toBeUndefined();
  });
});

describe('★추측하지 않는다 — 단위', () => {
  it('★모르는 단위는 거부한다 — psi 를 MPa 로 지레짐작하면 6.9배 틀린다', () => {
    const r = importMaterialsCsv('id,nameKo,밀도,인장강도(psi),항복강도\nX,시료,7850,82000,343');
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0]!.reason).toContain('모르는 단위');
  });
});

describe('★물리적으로 불가능한 값을 막는다', () => {
  it('★항복강도 > 인장강도 는 거부 — 통과하면 안전율이 과대평가된다', () => {
    const r = importMaterialsCsv(`${HDR}\nX,시료,7850,300,500`);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0]!.reason).toContain('물리적으로 불가능');
  });

  it('★자릿수 오타를 범위로 잡는다 — 밀도 785000 kg/m³', () => {
    const r = importMaterialsCsv(`${HDR}\nX,시료,785000,570,343`);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0]!.reason).toContain('물리적 범위');
  });

  it('경계값은 통과시킨다 — 과탐으로 멀쩡한 재료를 막지 않는다', () => {
    const r = importMaterialsCsv(`${HDR}\n폼,경량폼,20,0.5,0.4\n텅스텐,텅스텐,19300,1500,1300`);
    expect(r.accepted).toHaveLength(2);
  });
});

describe('★부분 성공을 정직하게 보고한다', () => {
  it('한 줄이 틀려도 나머지는 인입하고, 무엇이 왜 빠졌는지 남긴다', () => {
    const r = importMaterialsCsv(`${HDR}\nA,좋음,7850,570,343\nB,나쁨,7850,570,없음\nC,좋음,2700,310,276`);
    expect(r.accepted).toHaveLength(2);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.row).toBe(2);
    expect(r.summary).toContain('거부');
  });

  it('★필수 열이 헤더에 없으면 한 행도 인입하지 않는다', () => {
    const r = importMaterialsCsv('id,nameKo,밀도\nX,시료,7850');
    expect(r.accepted).toHaveLength(0);
    expect(r.summary).toContain('필수 열 누락');
  });

  it('★빈 파일·헤더만 있는 파일을 「성공」이라 하지 않는다', () => {
    expect(importMaterialsCsv('').summary).toContain('성공이 아니다');
    expect(importMaterialsCsv(HDR).summary).toContain('성공이 아니다');
  });
});
