import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { extractGdt, extractGdtFile } from './gdt-import.mjs';

// 합성 미니 AP242 스니펫(NIST 실측 스키마 형태만 재현 — 코퍼스 기하 미포함, 클린룸)
const SNIPPET = `ISO-10303-21;
DATA;
#37=DATUM('',$,#9,.F.,'A');
#38=DATUM('',$,#9,.F.,'B');
#34=DATUM_FEATURE('Simple Datum.1',$,#9,.T.);
#40=DATUM_REFERENCE_COMPARTMENT('',$,#9,.F.,#37,$);
#51=DATUM_SYSTEM('DS.1',$,#9,.F.,(#40));
#83=( LENGTH_MEASURE_WITH_UNIT() MEASURE_REPRESENTATION_ITEM() MEASURE_WITH_UNIT(LENGTH_MEASURE(1.5),#4) REPRESENTATION_ITEM('') );
#56=PERPENDICULARITY_TOLERANCE('Perp.1','',#83,#298,(#51));
#70=( LENGTH_MEASURE_WITH_UNIT() MEASURE_REPRESENTATION_ITEM() MEASURE_WITH_UNIT(LENGTH_MEASURE(35.),#4) REPRESENTATION_ITEM('nominal value') );
#71=( LENGTH_MEASURE_WITH_UNIT() MEASURE_WITH_UNIT(LENGTH_MEASURE(0.),#4) REPRESENTATION_ITEM('') );
#72=( LENGTH_MEASURE_WITH_UNIT() MEASURE_WITH_UNIT(LENGTH_MEASURE(-0.2),#4) REPRESENTATION_ITEM('') );
#58=TOLERANCE_VALUE(#72,#71);
#104=SHAPE_DIMENSION_REPRESENTATION('',(#70),#5);
#120=DIMENSIONAL_SIZE(#219,'diameter');
#112=DIMENSIONAL_CHARACTERISTIC_REPRESENTATION(#120,#104);
#64=PLUS_MINUS_TOLERANCE(#58,#120);
ENDSEC;
END-ISO-10303-21;
`.replace(/\n/g, '\r\n');

describe('gdt-import — AP242 시맨틱 PMI 판독(R2-①)', () => {
  it('데이텀·기하공차(크기+데이텀 참조)·치수(±리밋) 체인 판독', () => {
    const r = extractGdt(SNIPPET) as {
      datums: string[]; datumFeatureCount: number;
      geoTols: Array<{ kind: string; magnitudeMm: number | null; datums: string[]; symbol: string }>;
      dims: Array<{ name: string; value: number | null; tol: { lower: number; upper: number } | null }>;
      unparsed: unknown[];
    };
    expect(r.datums).toEqual(['A', 'B']);
    expect(r.datumFeatureCount).toBe(1);
    const perp = r.geoTols.find((g) => g.kind === 'PERPENDICULARITY_TOLERANCE')!;
    expect(perp.magnitudeMm).toBe(1.5);
    expect(perp.datums).toEqual(['A']); // DATUM_SYSTEM→컴파트먼트→DATUM 2홉
    expect(perp.symbol).toBe('⊥');
    const dia = r.dims.find((d) => d.name === 'diameter')!;
    expect(dia.value).toBe(35);
    expect(dia.tol).toEqual({ lower: -0.2, upper: 0 });
    expect(r.unparsed.length).toBe(0);
  });

  it('PMI 없는 STEP = 빈 결과(값 날조 없음)', () => {
    const r = extractGdt('ISO-10303-21;\r\nDATA;\r\n#1=CARTESIAN_POINT(\'\',(0.,0.,0.));\r\nENDSEC;\r\n') as { counts: Record<string, number> };
    expect(r.counts).toEqual({ datums: 0, dims: 0, geoTols: 0, plusMinus: 0 });
  });

  const NIST = 'C:/Users/gomd9/Downloads/참고파일들/NIST-PMI/NIST-PMI-STEP-Files/nist_ctc_01_asme1_ap242-e1.stp';
  it.skipIf(!existsSync(NIST))('NIST ctc_01 실파일(로컬 코퍼스) — A/B/C·⊥1.5|A·Ø35(−0.2/0)', () => {
    const r = extractGdtFile(NIST) as {
      datums: string[]; geoTols: Array<{ kind: string; magnitudeMm: number | null; datums: string[] }>;
      dims: Array<{ name: string; value: number | null; tol: { lower: number; upper: number } | null }>;
    };
    expect(r.datums).toEqual(['A', 'B', 'C']);
    const perp = r.geoTols.find((g) => g.kind === 'PERPENDICULARITY_TOLERANCE')!;
    expect(perp.magnitudeMm).toBe(1.5);
    expect(perp.datums).toContain('A');
    expect(r.dims.some((d) => d.name === 'diameter' && d.value === 35 && d.tol?.lower === -0.2)).toBe(true);
  });
});
