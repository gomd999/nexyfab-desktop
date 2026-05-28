/**
 * threadCatalog.test.ts — Wave 2 Phase 2 Track D5 (W5) catalog regression.
 *
 * Verifies:
 *   - Each of the seven series has the expected row count + non-empty designations.
 *   - `findThreadRow` resolves canonical designations across every series.
 *   - `pitchToTpi` / `tpiToPitch` round-trip within numeric precision.
 *   - `defaultThreadClass` matches the spec §3.3 defaults.
 *   - **Cross-check vs holeStandards** — every designation that exists in both
 *     catalogs MUST agree on pitch + nominal diameter + tap drill. This is the
 *     "single source of truth" invariant — drift fails the suite.
 */

import { describe, it, expect } from 'vitest';
import {
  THREAD_CATALOG,
  ALL_THREAD_ROWS,
  ISO_M_COARSE_TABLE,
  ISO_M_FINE_TABLE,
  UNC_TABLE,
  UNF_TABLE,
  NPT_TABLE,
  BSP_PARALLEL_TABLE,
  BSP_TAPERED_TABLE,
  findThreadRow,
  findThreadRowAnySeries,
  allRowsInSeries,
  pitchToTpi,
  tpiToPitch,
  defaultThreadClass,
  type ThreadSeries,
  type ThreadStandardRow,
} from '../threadCatalog';
import {
  ISO_METRIC,
  KS_B_0201_METRIC,
  UNC_INCH,
  UNF_INCH,
  NPT_PIPE,
  BSP_PIPE,
} from '../../holeStandards';

describe('threadCatalog — row counts + integrity', () => {
  it('ISO_M_COARSE has every nominal from M2 through M64', () => {
    const designations = ISO_M_COARSE_TABLE.map((r) => r.designation);
    expect(designations).toEqual(expect.arrayContaining(['M2', 'M3', 'M6', 'M8', 'M12', 'M20', 'M30', 'M64']));
    expect(ISO_M_COARSE_TABLE.length).toBeGreaterThanOrEqual(20);
  });

  it('ISO_M_FINE has at least M8×1 / M10×1.25 / M12×1.5 / M16×1.5 / M20×1.5', () => {
    const designations = ISO_M_FINE_TABLE.map((r) => r.designation);
    expect(designations).toEqual(
      expect.arrayContaining(['M8×1', 'M10×1.25', 'M12×1.5', 'M16×1.5', 'M20×1.5']),
    );
  });

  it('UNC table covers the canonical hole-standards inch series', () => {
    expect(UNC_TABLE.length).toBeGreaterThanOrEqual(10);
    const ds = UNC_TABLE.map((r) => r.designation);
    // Designation should append ' UNC' to the inch name
    expect(ds).toEqual(
      expect.arrayContaining(['1/4-20 UNC', '5/16-18 UNC', '3/8-16 UNC', '1/2-13 UNC']),
    );
  });

  it('UNF table covers the canonical fine inch series', () => {
    expect(UNF_TABLE.length).toBeGreaterThanOrEqual(10);
    const ds = UNF_TABLE.map((r) => r.designation);
    expect(ds).toEqual(
      expect.arrayContaining(['#10-32 UNF', '1/4-28 UNF', '5/16-24 UNF', '1/2-20 UNF']),
    );
  });

  it('NPT table covers 1/16 through 2 (10 sizes)', () => {
    const ds = NPT_TABLE.map((r) => r.designation);
    expect(ds).toEqual(
      expect.arrayContaining([
        'NPT 1/16', 'NPT 1/8', 'NPT 1/4', 'NPT 3/8', 'NPT 1/2',
        'NPT 3/4', 'NPT 1', 'NPT 1-1/4', 'NPT 1-1/2', 'NPT 2',
      ]),
    );
    expect(NPT_TABLE.length).toBeGreaterThanOrEqual(10);
  });

  it('BSP_PARALLEL covers G 1/8 through G 2', () => {
    const ds = BSP_PARALLEL_TABLE.map((r) => r.designation);
    expect(ds).toEqual(
      expect.arrayContaining(['G 1/8', 'G 1/4', 'G 3/8', 'G 1/2', 'G 3/4', 'G 1', 'G 2']),
    );
  });

  it('BSP_TAPERED covers Rc 1/8 through Rc 2 (mirrors BSP_PARALLEL)', () => {
    const ds = BSP_TAPERED_TABLE.map((r) => r.designation);
    expect(ds).toEqual(
      expect.arrayContaining(['Rc 1/8', 'Rc 1/4', 'Rc 3/8', 'Rc 1/2', 'Rc 3/4', 'Rc 1', 'Rc 2']),
    );
    expect(BSP_TAPERED_TABLE.length).toBe(BSP_PARALLEL_TABLE.length);
  });

  it('no series has an empty designation', () => {
    for (const row of ALL_THREAD_ROWS) {
      expect(row.designation.length, `series=${row.series}`).toBeGreaterThan(0);
    }
  });

  it('every row has positive numerics', () => {
    for (const row of ALL_THREAD_ROWS) {
      expect(row.nominalDia, row.designation).toBeGreaterThan(0);
      expect(row.pitch, row.designation).toBeGreaterThan(0);
      expect(row.tpi, row.designation).toBeGreaterThan(0);
      expect(row.threadHeight, row.designation).toBeGreaterThan(0);
      expect(row.pitchDiameter, row.designation).toBeGreaterThan(0);
      expect(row.minorDiameter, row.designation).toBeGreaterThan(0);
      expect(row.tapDrill, row.designation).toBeGreaterThan(0);
    }
  });

  it('every series has at least one class candidate', () => {
    const series: ThreadSeries[] = ['ISO_M_COARSE', 'ISO_M_FINE', 'UNC', 'UNF', 'NPT', 'BSP_PARALLEL', 'BSP_TAPERED'];
    for (const s of series) {
      for (const row of allRowsInSeries(s)) {
        expect(row.classCandidates.length, `${s}/${row.designation}`).toBeGreaterThan(0);
      }
    }
  });

  it('pipe rows are tagged as such', () => {
    for (const r of NPT_TABLE) expect(r.isPipe, r.designation).toBe(true);
    for (const r of BSP_PARALLEL_TABLE) expect(r.isPipe, r.designation).toBe(true);
    for (const r of BSP_TAPERED_TABLE) expect(r.isPipe, r.designation).toBe(true);
  });

  it('NPT + BSP_TAPERED rows carry a 1:16 taper', () => {
    for (const r of NPT_TABLE) {
      expect(r.isTapered).toBe(true);
      expect(r.taper?.ratio).toBeCloseTo(1 / 16, 6);
      expect(r.taper?.angle).toBeCloseTo(1.7833, 3);
    }
    for (const r of BSP_TAPERED_TABLE) {
      expect(r.isTapered).toBe(true);
      expect(r.taper?.ratio).toBeCloseTo(1 / 16, 6);
    }
  });

  it('BSP_PARALLEL rows are NOT tapered (despite isPipe=true)', () => {
    for (const r of BSP_PARALLEL_TABLE) {
      expect(r.isTapered, r.designation).toBe(false);
      expect(r.taper).toBeUndefined();
    }
  });

  it('NPT engagement lengths L1 and L2 are populated', () => {
    for (const r of NPT_TABLE) {
      expect(r.engagement, r.designation).toBeDefined();
      expect(r.engagement!.L1, r.designation).toBeGreaterThan(0);
      expect(r.engagement!.L2, r.designation).toBeGreaterThan(r.engagement!.L1);
    }
  });
});

describe('threadCatalog — lookups', () => {
  it('findThreadRow returns M8 from ISO_M_COARSE', () => {
    const m8 = findThreadRow('ISO_M_COARSE', 'M8');
    expect(m8).not.toBeNull();
    expect(m8!.nominalDia).toBe(8);
    expect(m8!.pitch).toBe(1.25);
  });

  it('findThreadRow returns "1/4-20 UNC" from UNC', () => {
    const row = findThreadRow('UNC', '1/4-20 UNC');
    expect(row).not.toBeNull();
    expect(row!.tpi).toBe(20);
    expect(row!.nominalDia).toBeCloseTo(6.35, 2);
  });

  it('findThreadRow returns "NPT 1/2" from NPT', () => {
    const row = findThreadRow('NPT', 'NPT 1/2');
    expect(row).not.toBeNull();
    expect(row!.tpi).toBe(14);
    expect(row!.isTapered).toBe(true);
  });

  it('findThreadRow returns "G 1/4" from BSP_PARALLEL', () => {
    const row = findThreadRow('BSP_PARALLEL', 'G 1/4');
    expect(row).not.toBeNull();
    expect(row!.tpi).toBeCloseTo(19, 0);
    expect(row!.isTapered).toBe(false);
  });

  it('findThreadRow returns "Rc 1/4" from BSP_TAPERED', () => {
    const row = findThreadRow('BSP_TAPERED', 'Rc 1/4');
    expect(row).not.toBeNull();
    expect(row!.isTapered).toBe(true);
  });

  it('findThreadRow returns null for unknown designation', () => {
    expect(findThreadRow('ISO_M_COARSE', 'M9.999')).toBeNull();
  });

  it('findThreadRow returns null for designation in wrong series', () => {
    expect(findThreadRow('UNC', 'M8')).toBeNull();
    expect(findThreadRow('NPT', '1/4-20 UNC')).toBeNull();
  });

  it('findThreadRowAnySeries resolves a designation without knowing the series', () => {
    const row = findThreadRowAnySeries('M8');
    expect(row).not.toBeNull();
    expect(row!.series).toBe('ISO_M_COARSE');
  });

  it('findThreadRowAnySeries returns null when no series matches', () => {
    expect(findThreadRowAnySeries('M-bogus')).toBeNull();
  });
});

describe('threadCatalog — pitch ↔ tpi conversions', () => {
  it('pitchToTpi(1.25 mm) ≈ 20.32', () => {
    expect(pitchToTpi(1.25)).toBeCloseTo(20.32, 2);
  });

  it('tpiToPitch(20) ≈ 1.27 mm', () => {
    expect(tpiToPitch(20)).toBeCloseTo(1.27, 2);
  });

  it('tpiToPitch ↔ pitchToTpi round-trip for typical values', () => {
    for (const tpi of [8, 13, 16, 20, 24, 28, 32]) {
      expect(pitchToTpi(tpiToPitch(tpi))).toBeCloseTo(tpi, 1);
    }
  });

  it('pitchToTpi guards against pitch ≤ 0', () => {
    expect(pitchToTpi(0)).toBe(Infinity);
    expect(pitchToTpi(-1)).toBe(Infinity);
  });

  it('tpiToPitch guards against tpi ≤ 0', () => {
    expect(tpiToPitch(0)).toBe(Infinity);
    expect(tpiToPitch(-5)).toBe(Infinity);
  });
});

describe('threadCatalog — default class per series', () => {
  it('ISO_M_COARSE default class is 6H (internal default)', () => {
    expect(defaultThreadClass('ISO_M_COARSE')).toBe('6H');
  });

  it('ISO_M_FINE default class is 6H', () => {
    expect(defaultThreadClass('ISO_M_FINE')).toBe('6H');
  });

  it('UNC + UNF default class is 2B', () => {
    expect(defaultThreadClass('UNC')).toBe('2B');
    expect(defaultThreadClass('UNF')).toBe('2B');
  });

  it('NPT default class is A', () => {
    expect(defaultThreadClass('NPT')).toBe('A');
  });

  it('BSP_PARALLEL default class is B', () => {
    expect(defaultThreadClass('BSP_PARALLEL')).toBe('B');
  });

  it('BSP_TAPERED default class is Rc', () => {
    expect(defaultThreadClass('BSP_TAPERED')).toBe('Rc');
  });

  it('default class is the first entry in classCandidates for every row', () => {
    for (const row of ALL_THREAD_ROWS) {
      expect(row.classCandidates[0], `${row.series}/${row.designation}`)
        .toBe(defaultThreadClass(row.series));
    }
  });
});

describe('threadCatalog — cross-check vs holeStandards (no data drift)', () => {
  /**
   * Single-source-of-truth invariant: every designation that appears in BOTH
   * the hole-standards catalog and the thread catalog must agree on pitch,
   * nominal diameter, and tap drill. Augmented rows (in only one of the two
   * catalogs) are skipped.
   */

  function cross(
    label: string,
    hole: { name: string; nominal: number; pitch?: number; tpi?: number; tapDrill: number },
    thread: ThreadStandardRow | null,
  ): void {
    expect(thread, `${label}: thread row missing for ${hole.name}`).not.toBeNull();
    expect(thread!.nominalDia, `${label} nominalDia drift on ${hole.name}`).toBeCloseTo(hole.nominal, 3);
    // Skip pitch cross-check when hole-standards row carries pitch=0 sentinel
    // (NPT rows: pitch is computed from tpi rather than stored explicitly).
    if (hole.pitch !== undefined && hole.pitch > 0) {
      expect(thread!.pitch, `${label} pitch drift on ${hole.name}`).toBeCloseTo(hole.pitch, 3);
    }
    if (hole.tpi !== undefined) {
      expect(thread!.tpi, `${label} tpi drift on ${hole.name}`).toBeCloseTo(hole.tpi, 1);
    }
    expect(thread!.tapDrill, `${label} tapDrill drift on ${hole.name}`).toBeCloseTo(hole.tapDrill, 3);
  }

  it('ISO_METRIC ↔ ISO_M_COARSE — every shared row matches', () => {
    for (const h of ISO_METRIC) {
      const t = findThreadRow('ISO_M_COARSE', h.name);
      cross('ISO_METRIC↔ISO_M_COARSE', h, t);
    }
  });

  it('KS_B_0201_METRIC fine-pitch ↔ ISO_M_FINE — every shared row matches', () => {
    for (const h of KS_B_0201_METRIC.filter((r) => r.name.includes('x'))) {
      const canonicalName = h.name.replace(/x/, '×');
      const t = findThreadRow('ISO_M_FINE', canonicalName);
      cross('KS_B_0201_FINE↔ISO_M_FINE', h, t);
    }
  });

  it('UNC_INCH ↔ UNC_TABLE — every shared row matches', () => {
    for (const h of UNC_INCH) {
      const t = findThreadRow('UNC', `${h.name} UNC`);
      cross('UNC_INCH↔UNC_TABLE', h, t);
    }
  });

  it('UNF_INCH ↔ UNF_TABLE — every shared row matches', () => {
    for (const h of UNF_INCH) {
      const t = findThreadRow('UNF', `${h.name} UNF`);
      cross('UNF_INCH↔UNF_TABLE', h, t);
    }
  });

  it('NPT_PIPE ↔ NPT_TABLE — every shared row matches', () => {
    for (const h of NPT_PIPE) {
      const t = findThreadRow('NPT', h.name);
      cross('NPT_PIPE↔NPT_TABLE', h, t);
    }
  });

  it('BSP_PIPE ↔ BSP_PARALLEL_TABLE — every shared row matches', () => {
    for (const h of BSP_PIPE) {
      const t = findThreadRow('BSP_PARALLEL', h.name);
      cross('BSP_PIPE↔BSP_PARALLEL_TABLE', h, t);
    }
  });

  it('M8 pitch agrees between holeStandards and threadCatalog (canonical spot-check)', () => {
    const holeM8 = ISO_METRIC.find((r) => r.name === 'M8')!;
    const threadM8 = findThreadRow('ISO_M_COARSE', 'M8')!;
    expect(holeM8.pitch).toBe(threadM8.pitch);
    expect(holeM8.tapDrill).toBe(threadM8.tapDrill);
  });
});

describe('threadCatalog — designation uniqueness within series', () => {
  it('no series has duplicate designations', () => {
    for (const series of Object.keys(THREAD_CATALOG) as ThreadSeries[]) {
      const ds = THREAD_CATALOG[series].map((r) => r.designation);
      const set = new Set(ds);
      expect(set.size, `${series} has duplicates`).toBe(ds.length);
    }
  });

  it('ALL_THREAD_ROWS equals the sum of the seven series', () => {
    const sum =
      ISO_M_COARSE_TABLE.length +
      ISO_M_FINE_TABLE.length +
      UNC_TABLE.length +
      UNF_TABLE.length +
      NPT_TABLE.length +
      BSP_PARALLEL_TABLE.length +
      BSP_TAPERED_TABLE.length;
    expect(ALL_THREAD_ROWS.length).toBe(sum);
  });
});

describe('threadCatalog — derived numerics (60° V profile geometry)', () => {
  it('M8 threadHeight = 0.866 × 1.25 mm ≈ 1.0825 mm', () => {
    const m8 = findThreadRow('ISO_M_COARSE', 'M8')!;
    expect(m8.threadHeight).toBeCloseTo(0.866 * 1.25, 3);
  });

  it('M8 pitchDiameter = 8 − 0.6495 × 1.25 ≈ 7.188 mm', () => {
    const m8 = findThreadRow('ISO_M_COARSE', 'M8')!;
    expect(m8.pitchDiameter).toBeCloseTo(8 - 0.6495 * 1.25, 3);
  });

  it('M8 minorDiameter = 8 − 1.0825 × 1.25 ≈ 6.647 mm', () => {
    const m8 = findThreadRow('ISO_M_COARSE', 'M8')!;
    expect(m8.minorDiameter).toBeCloseTo(8 - 1.0825 * 1.25, 3);
  });
});
