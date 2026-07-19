import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseLandXml, parseLandXmlFile } from './landxml-import.mjs';

// 합성 스니펫(구조만 재현 — 코퍼스 미포함): 미터 단위, L-C-L 체인 + PVI
const SNIPPET = `<?xml version="1.0"?>
<LandXML><Units><Metric linearUnit="meter"/></Units>
<Alignments><Alignment name="A1" length="300." staStart="0.">
<CoordGeom>
<Line dir="0" length="100."><Start>0. 0.</Start><End>100. 0.</End></Line>
<Curve rot="ccw" crvType="arc" radius="50." length="78.539816"><Start>100. 0.</Start><End>150. 50.</End></Curve>
<Line dir="90" length="100."><Start>150. 50.</Start><End>150. 150.</End></Line>
<Spiral length="20."><Start>150. 150.</Start><End>151. 170.</End></Spiral>
</CoordGeom>
<Profile name="A1"><ProfAlign name="L"><PVI>0. 100.</PVI><ParaCurve length="60.">150. 103.</ParaCurve><PVI>300. 101.</PVI></ProfAlign></Profile>
</Alignment></Alignments></LandXML>`;

describe('landxml-import — 도로 선형(R2-③)', () => {
  it('L-C-L 체인 → IP/R(mm 환산) + 검산 + 비지원 정직 보고', () => {
    const r = parseLandXml(SNIPPET) as {
      alignments: Array<{ ips: number[][]; curves: Array<{ ip: number; R: number }>; checks: { lengthMatch: boolean | null; elemLengthSumMm: number }; unsupported: unknown[]; unitScaleToMm: number }>;
      profiles: Array<{ pvis: Array<{ kind: string; staMm: number; elevMm: number }> }>;
    };
    const a = r.alignments[0];
    expect(a.unitScaleToMm).toBe(1000); // meter → mm
    expect(a.ips.length).toBe(3); // 시점 + IP + 종점
    // IP = 두 탄젠트 무한직선 교점: x축 직선 ∩ x=150 수직선 → (150000, 0)
    expect(a.ips[1]).toEqual([150000, 0]);
    expect(a.curves).toEqual([{ ip: 1, R: 50000 }]);
    expect(a.checks.elemLengthSumMm).toBeCloseTo(278539.816, 0); // Spiral 은 length 합산 제외
    expect(a.unsupported.length).toBe(1); // Spiral=clothoid 정직 거부
    expect(r.profiles[0].pvis.length).toBe(3);
    expect(r.profiles[0].pvis[1]).toMatchObject({ kind: 'paracurve', staMm: 150000, elevMm: 103000 });
  });

  const SAMPLE = 'C:/Users/gomd9/Downloads/참고파일들/LandXML-samples/landxml_road_sample.xml';
  it.skipIf(!existsSync(SAMPLE))('실파일(로컬 코퍼스) — 길이 검산 일치 + 엔진 투입 형식', () => {
    const r = parseLandXmlFile(SAMPLE) as { alignments: Array<{ ips: number[][]; curves: unknown[]; checks: { lengthMatch: boolean | null } }> };
    const a = r.alignments[0];
    expect(a.checks.lengthMatch).toBe(true);
    expect(a.ips.length).toBeGreaterThanOrEqual(3);
    expect(a.curves.length).toBeGreaterThanOrEqual(1);
  });
});
