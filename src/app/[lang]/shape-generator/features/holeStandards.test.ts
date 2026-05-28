import { describe, it, expect } from 'vitest';
import {
  HOLE_STANDARD_SERIES,
  ALL_HOLE_STANDARD_ROWS,
  ISO_METRIC,
  KS_B_0201_METRIC,
  ISO_273_CLEARANCE,
  ISO_273_FIT_OFFSETS,
  UNC_INCH,
  UNF_INCH,
  ANSI_IMPERIAL,
  NPT_PIPE,
  BSP_PIPE,
  findStandardRow,
  resolveClearance,
  holeParamsFromStandard,
  type HoleStandardSpec,
  type HoleStandardSeries,
} from './holeStandards';

/**
 * Track C1 catalog validation — ensures every standard table is well-formed
 * (positive dimensions, unique designations) and that the new fit-class
 * fields preserve strict close < normal < loose ordering.
 */

function assertRowWellFormed(row: HoleStandardSpec) {
  expect(row.name, `name on row ${JSON.stringify(row)}`).toBeTruthy();
  expect(row.nominal, `nominal > 0 on ${row.name}`).toBeGreaterThan(0);
  expect(row.clearance, `clearance > 0 on ${row.name}`).toBeGreaterThan(0);
  expect(row.tapDrill, `tapDrill > 0 on ${row.name}`).toBeGreaterThan(0);
  expect(row.counterboreDia, `counterboreDia > 0 on ${row.name}`).toBeGreaterThan(0);
  // counterboreDepth can be 0 for clearance-only / pipe rows
  expect(row.counterboreDepth, `counterboreDepth >= 0 on ${row.name}`).toBeGreaterThanOrEqual(0);
  expect(row.countersinkDia, `countersinkDia > 0 on ${row.name}`).toBeGreaterThan(0);
  expect(row.countersinkAngle, `countersinkAngle > 0 on ${row.name}`).toBeGreaterThan(0);
  expect(['mm', 'in']).toContain(row.unit);
}

function assertUniqueDesignations(rows: readonly HoleStandardSpec[], label: string) {
  const names = rows.map((r) => r.name);
  const set = new Set(names);
  expect(set.size, `${label} has duplicate designations`).toBe(names.length);
}

describe('holeStandards — Wave 2 Track C1 catalog extension', () => {
  describe('ISO_METRIC (ISO 4762)', () => {
    it('every row is well-formed and has positive pitch', () => {
      expect(ISO_METRIC.length).toBeGreaterThanOrEqual(9);
      for (const row of ISO_METRIC) {
        assertRowWellFormed(row);
        expect(row.pitch, `${row.name} pitch > 0`).toBeGreaterThan(0);
        expect(row.standard).toBe('ISO');
      }
    });

    it('designations are unique', () => {
      assertUniqueDesignations(ISO_METRIC, 'ISO_METRIC');
    });
  });

  describe('KS B 0201 — Korean ISO metric', () => {
    it('lists at least the coarse M3-M20 set + a couple of fine-pitch rows', () => {
      // 10 coarse + 5 fine = 15
      expect(KS_B_0201_METRIC.length).toBeGreaterThanOrEqual(13);
      const names = KS_B_0201_METRIC.map((r) => r.name);
      // Coarse anchors
      expect(names).toEqual(expect.arrayContaining(['M3', 'M6', 'M10', 'M16', 'M20']));
      // At least one fine-pitch variant
      const finePitchRows = KS_B_0201_METRIC.filter((r) => r.name.includes('x'));
      expect(finePitchRows.length).toBeGreaterThanOrEqual(3);
    });

    it('every row carries the KSB0201 tag and a Korean nameKo', () => {
      for (const row of KS_B_0201_METRIC) {
        expect(row.standard).toBe('KSB0201');
        expect(row.nameKo, `${row.name} should have nameKo`).toBeTruthy();
        assertRowWellFormed(row);
        expect(row.pitch).toBeGreaterThan(0);
      }
    });

    it('designations are unique within the KS table', () => {
      assertUniqueDesignations(KS_B_0201_METRIC, 'KS_B_0201_METRIC');
    });

    it('fine-pitch row tapDrill is larger than its coarse counterpart (smaller thread depth)', () => {
      const m8Coarse = KS_B_0201_METRIC.find((r) => r.name === 'M8')!;
      const m8Fine = KS_B_0201_METRIC.find((r) => r.name === 'M8x1')!;
      expect(m8Fine.tapDrill).toBeGreaterThan(m8Coarse.tapDrill);
      expect(m8Fine.pitch).toBeLessThan(m8Coarse.pitch!);
    });
  });

  describe('ISO 273 — clearance hole table', () => {
    it('every row is well-formed and tagged ISO273', () => {
      expect(ISO_273_CLEARANCE.length).toBeGreaterThanOrEqual(10);
      for (const row of ISO_273_CLEARANCE) {
        assertRowWellFormed(row);
        expect(row.standard).toBe('ISO273');
        expect(row.fits, `${row.name} must expose fits`).toBeTruthy();
      }
    });

    it('fit-class offsets are monotonic close < normal < loose for every nominal', () => {
      for (const [d, off] of Object.entries(ISO_273_FIT_OFFSETS)) {
        const label = `M${d}`;
        expect(off.close, `${label} close > 0`).toBeGreaterThan(0);
        expect(off.normal, `${label} close < normal`).toBeGreaterThan(off.close);
        expect(off.loose, `${label} normal < loose`).toBeGreaterThan(off.normal);
      }
    });

    it('row.fits resolves into strictly monotonic absolute diameters', () => {
      for (const row of ISO_273_CLEARANCE) {
        const f = row.fits!;
        expect(f.close, `${row.name}`).toBeGreaterThan(row.nominal);
        expect(f.normal, `${row.name}`).toBeGreaterThan(f.close);
        expect(f.loose, `${row.name}`).toBeGreaterThan(f.normal);
      }
    });

    it('designations are unique', () => {
      assertUniqueDesignations(ISO_273_CLEARANCE, 'ISO_273_CLEARANCE');
    });
  });

  describe('ANSI / UTS — UNC + UNF inch threads', () => {
    it('UNC covers #0-80 through 1/2-13', () => {
      expect(UNC_INCH.length).toBeGreaterThanOrEqual(10);
      const names = UNC_INCH.map((r) => r.name);
      expect(names).toEqual(expect.arrayContaining(['#0-80', '#4-40', '#10-24', '1/4-20', '1/2-13']));
      for (const row of UNC_INCH) {
        assertRowWellFormed(row);
        expect(row.standard).toBe('ANSI');
        expect(row.tpi, `${row.name} tpi > 0`).toBeGreaterThan(0);
        expect(row.fits).toBeTruthy();
      }
    });

    it('UNF covers fine-pitch sizes #0-80 through 1/2-20', () => {
      expect(UNF_INCH.length).toBeGreaterThanOrEqual(10);
      const names = UNF_INCH.map((r) => r.name);
      expect(names).toEqual(expect.arrayContaining(['#10-32', '1/4-28', '5/16-24', '1/2-20']));
      for (const row of UNF_INCH) {
        assertRowWellFormed(row);
        expect(row.tpi).toBeGreaterThan(0);
      }
    });

    it('ANSI_IMPERIAL back-compat list preserves Wave 1 designations', () => {
      const names = ANSI_IMPERIAL.map((r) => r.name);
      expect(names).toEqual(
        expect.arrayContaining([
          '#4-40', '#6-32', '#8-32', '#10-24', '#10-32',
          '1/4-20', '5/16-18', '3/8-16', '1/2-13',
        ]),
      );
    });

    it('UNC and UNF fits are strictly monotonic close < normal < loose', () => {
      for (const row of [...UNC_INCH, ...UNF_INCH]) {
        const f = row.fits!;
        expect(f.close, `${row.name} close < normal`).toBeLessThan(f.normal);
        expect(f.normal, `${row.name} normal < loose`).toBeLessThan(f.loose);
      }
    });

    it('UNF tapDrill is larger than UNC counterpart for the same nominal', () => {
      // Example: #10-24 (UNC) vs #10-32 (UNF) — UNF has a larger tap drill
      const unc10 = UNC_INCH.find((r) => r.name === '#10-24')!;
      const unf10 = UNF_INCH.find((r) => r.name === '#10-32')!;
      expect(unf10.tapDrill).toBeGreaterThan(unc10.tapDrill);
    });
  });

  describe('PIPE — NPT + BSP', () => {
    it('NPT covers 1/16 through 1/2 and is well-formed', () => {
      expect(NPT_PIPE.length).toBeGreaterThanOrEqual(5);
      const names = NPT_PIPE.map((r) => r.name);
      expect(names).toEqual(
        expect.arrayContaining(['NPT 1/16', 'NPT 1/8', 'NPT 1/4', 'NPT 3/8', 'NPT 1/2']),
      );
      for (const row of NPT_PIPE) {
        assertRowWellFormed(row);
        expect(row.standard).toBe('NPT');
        expect(row.tpi, `${row.name} tpi > 0`).toBeGreaterThan(0);
        expect(row.fits).toBeTruthy();
      }
    });

    it('BSP covers 1/16 through 1/2 and is well-formed', () => {
      expect(BSP_PIPE.length).toBeGreaterThanOrEqual(5);
      const names = BSP_PIPE.map((r) => r.name);
      expect(names).toEqual(
        expect.arrayContaining(['G 1/16', 'G 1/8', 'G 1/4', 'G 3/8', 'G 1/2']),
      );
      for (const row of BSP_PIPE) {
        assertRowWellFormed(row);
        expect(row.standard).toBe('BSP');
        expect(row.pitch, `${row.name} pitch > 0`).toBeGreaterThan(0);
        expect(row.fits).toBeTruthy();
      }
    });

    it('PIPE fit-class triples are still strictly monotonic', () => {
      for (const row of [...NPT_PIPE, ...BSP_PIPE]) {
        const f = row.fits!;
        expect(f.close, `${row.name} close < normal`).toBeLessThan(f.normal);
        expect(f.normal, `${row.name} normal < loose`).toBeLessThan(f.loose);
      }
    });

    it('NPT 1/2 has TPI 14 (ANSI/ASME B1.20.1)', () => {
      const row = NPT_PIPE.find((r) => r.name === 'NPT 1/2')!;
      expect(row.tpi).toBe(14);
    });
  });

  describe('catalog lookup + back-compat', () => {
    it('findStandardRow returns the row for (series, designation)', () => {
      expect(findStandardRow('ISO', 'M6')?.nominal).toBe(6);
      expect(findStandardRow('KSB0201', 'M8x1')?.pitch).toBe(1.0);
      expect(findStandardRow('NPT', 'NPT 1/4')?.tpi).toBe(18);
      expect(findStandardRow('ANSI', '1/4-20')?.tpi).toBe(20);
      expect(findStandardRow('ISO273', 'M10')?.fits?.normal).toBeGreaterThan(10);
      expect(findStandardRow('BSP', 'G 1/2')?.pitch).toBeCloseTo(1.814, 3);
    });

    it('findStandardRow returns undefined for unknown designation', () => {
      expect(findStandardRow('ISO', 'M999')).toBeUndefined();
    });

    it('HOLE_STANDARD_SERIES has all 6 series keys', () => {
      const keys: HoleStandardSeries[] = ['ISO', 'ANSI', 'KSB0201', 'ISO273', 'NPT', 'BSP'];
      for (const k of keys) {
        expect(HOLE_STANDARD_SERIES[k].length).toBeGreaterThan(0);
      }
    });

    it('no two rows within the same standard share a designation', () => {
      for (const [series, rows] of Object.entries(HOLE_STANDARD_SERIES)) {
        assertUniqueDesignations(rows, series);
      }
    });

    it('ALL_HOLE_STANDARD_ROWS covers every per-series row', () => {
      const sum =
        ISO_METRIC.length +
        KS_B_0201_METRIC.length +
        ISO_273_CLEARANCE.length +
        UNC_INCH.length +
        UNF_INCH.length +
        NPT_PIPE.length +
        BSP_PIPE.length;
      expect(ALL_HOLE_STANDARD_ROWS.length).toBe(sum);
    });
  });

  describe('helpers — resolveClearance + holeParamsFromStandard', () => {
    it('resolveClearance returns the requested fit class when fits are present', () => {
      const m6 = findStandardRow('ISO', 'M6')!;
      const close = resolveClearance(m6, 'close');
      const normal = resolveClearance(m6, 'normal');
      const loose = resolveClearance(m6, 'loose');
      expect(close).toBeLessThan(normal);
      expect(normal).toBeLessThan(loose);
    });

    it('resolveClearance falls back to flat .clearance when row has no fits', () => {
      const row: HoleStandardSpec = {
        name: 'X',
        unit: 'mm',
        nominal: 10,
        clearance: 11,
        tapDrill: 8.5,
        counterboreDia: 18,
        counterboreDepth: 10,
        countersinkDia: 22,
        countersinkAngle: 90,
      };
      expect(resolveClearance(row, 'close')).toBe(11);
      expect(resolveClearance(row, 'loose')).toBe(11);
    });

    it('holeParamsFromStandard honours the fit-class arg', () => {
      const m6 = findStandardRow('ISO', 'M6')!;
      const tightHole = holeParamsFromStandard(m6, 'through', 'close');
      const looseHole = holeParamsFromStandard(m6, 'through', 'loose');
      expect(tightHole.diameter).toBeLessThan(looseHole.diameter);
    });

    it('holeParamsFromStandard "tap" ignores fit-class (taps use tapDrill)', () => {
      const m6 = findStandardRow('ISO', 'M6')!;
      const close = holeParamsFromStandard(m6, 'tap', 'close');
      const loose = holeParamsFromStandard(m6, 'tap', 'loose');
      expect(close.diameter).toBe(m6.tapDrill);
      expect(loose.diameter).toBe(m6.tapDrill);
    });
  });
});
