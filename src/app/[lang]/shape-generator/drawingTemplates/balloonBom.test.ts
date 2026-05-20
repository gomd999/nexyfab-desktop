import { describe, it, expect } from 'vitest';
import {
  groupBom,
  autoPlaceBalloons,
  diffBom,
  flattenAssembly,
  type AssemblyItem,
  type AssemblyTree,
} from './balloonBom';

const items: AssemblyItem[] = [
  { instanceId: 'i1', partNumber: 'P-001', description: 'Body',  positionOnSheet: [50, 50] },
  { instanceId: 'i2', partNumber: 'P-002', description: 'Cover', positionOnSheet: [80, 60] },
  { instanceId: 'i3', partNumber: 'P-002', description: 'Cover', positionOnSheet: [80, 100] },
  { instanceId: 'i4', partNumber: 'P-003', description: 'Bolt',  positionOnSheet: [70, 70], unitCostUsd: 0.5 },
  { instanceId: 'i5', partNumber: 'P-003', description: 'Bolt',  positionOnSheet: [70, 90], unitCostUsd: 0.5 },
];

describe('groupBom', () => {
  it('rolls duplicates into qty > 1', () => {
    const r = groupBom(items);
    const bolt = r.rows.find(b => b.partNumber === 'P-003')!;
    expect(bolt.quantity).toBe(2);
    const cover = r.rows.find(b => b.partNumber === 'P-002')!;
    expect(cover.quantity).toBe(2);
  });

  it('item numbers 1..N sequential', () => {
    const r = groupBom(items);
    expect(r.rows.map(b => b.itemNumber)).toEqual([1, 2, 3]);
  });

  it('total cost = qty × unit', () => {
    const r = groupBom(items);
    const bolt = r.rows.find(b => b.partNumber === 'P-003')!;
    expect(bolt.totalCostUsd).toBe(1.0);
  });

  it('totalCostUsd defined when any unitCostUsd present', () => {
    const r = groupBom(items);
    expect(r.totalCostUsd).toBe(1.0);
  });

  it('sort by quantity-desc', () => {
    const r = groupBom(items, 'quantity-desc');
    // P-002 + P-003 both qty=2, P-001 qty=1.
    expect(r.rows[2]!.partNumber).toBe('P-001');
  });

  it('totalCount = total instances', () => {
    expect(groupBom(items).totalCount).toBe(5);
  });
});

describe('autoPlaceBalloons', () => {
  const sheetBbox = { minX: 0, minY: 0, maxX: 297, maxY: 210 };
  const viewBbox = { minX: 50, minY: 50, maxX: 200, maxY: 160 };

  it('places one balloon per unique part', () => {
    const bom = groupBom(items);
    const placements = autoPlaceBalloons(items, bom, { sheetBbox, viewBbox });
    expect(placements).toHaveLength(3); // 3 unique parts
  });

  it('every balloon within sheet bounds', () => {
    const bom = groupBom(items);
    const placements = autoPlaceBalloons(items, bom, { sheetBbox, viewBbox });
    for (const p of placements) {
      expect(p.balloonPosition[0]).toBeGreaterThanOrEqual(sheetBbox.minX);
      expect(p.balloonPosition[0]).toBeLessThanOrEqual(sheetBbox.maxX);
      expect(p.balloonPosition[1]).toBeGreaterThanOrEqual(sheetBbox.minY);
      expect(p.balloonPosition[1]).toBeLessThanOrEqual(sheetBbox.maxY);
    }
  });

  it('leader has ≥ 2 points (balloon + anchor)', () => {
    const bom = groupBom(items);
    const placements = autoPlaceBalloons(items, bom, { sheetBbox, viewBbox });
    expect(placements.every(p => p.leader.length >= 2)).toBe(true);
  });

  it('balloons spread out for distinct parts', () => {
    // 8 distinct parts inside the view bbox.
    const dense: AssemblyItem[] = Array.from({ length: 8 }, (_, i) => ({
      instanceId: `i${i}`, partNumber: `P-${i.toString().padStart(3, '0')}`,
      description: 'Item', positionOnSheet: [100 + i * 10, 100 + (i % 2) * 20],
    }));
    const bom = groupBom(dense);
    const placements = autoPlaceBalloons(dense, bom, { sheetBbox, viewBbox });
    const tuples = new Set(placements.map(p =>
      `${Math.round(p.balloonPosition[0])},${Math.round(p.balloonPosition[1])}`));
    expect(tuples.size).toBeGreaterThan(1);
  });
});

describe('diffBom', () => {
  it('detects added items', () => {
    const prev = groupBom(items.slice(0, 4));
    const curr = groupBom(items);
    const d = diffBom(prev, curr);
    // P-003 was already in prev (qty 1) and now qty 2 → quantityChanged.
    expect(d.quantityChanged.find(c => c.partNumber === 'P-003')).toBeDefined();
  });

  it('detects removed items', () => {
    const prev = groupBom(items);
    const curr = groupBom([items[0]!]);
    const d = diffBom(prev, curr);
    expect(d.removed.length).toBe(2);
  });

  it('no diff when identical', () => {
    const a = groupBom(items);
    const b = groupBom(items);
    const d = diffBom(a, b);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.quantityChanged).toHaveLength(0);
  });
});

describe('flattenAssembly', () => {
  const tree: AssemblyTree = {
    partNumber: 'ROOT', description: 'Top assembly',
    children: [
      { partNumber: 'SUB-A', description: 'Sub A', children: [
        { partNumber: 'PART-1', description: 'Bolt', children: [], unitCostUsd: 0.5 },
      ] },
      { partNumber: 'PART-2', description: 'Plate', children: [], unitCostUsd: 10 },
    ],
  };

  it('emits one row per tree node', () => {
    const r = flattenAssembly(tree);
    expect(r).toHaveLength(4);
  });

  it('records level (depth from root)', () => {
    const r = flattenAssembly(tree);
    expect(r[0]!.level).toBe(0); // ROOT
    expect(r[1]!.level).toBe(1); // SUB-A
    expect(r[2]!.level).toBe(2); // PART-1
    expect(r[3]!.level).toBe(1); // PART-2
  });

  it('parent part numbers link rows', () => {
    const r = flattenAssembly(tree);
    expect(r[2]!.parentPartNumber).toBe('SUB-A');
  });
});
