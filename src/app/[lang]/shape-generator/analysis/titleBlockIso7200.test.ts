import { describe, it, expect } from 'vitest';
import {
  buildIso7200Layout,
  fieldValue,
  type TitleBlockIso7200Data,
} from './titleBlockIso7200';

const sampleData: TitleBlockIso7200Data = {
  title: 'BRACKET ASSY',
  drawingNumber: 'NF-12345',
  revision: 'B',
  designer: 'A. Kim',
  designerDate: '2026-05-17',
  approver: 'J. Lee',
  approverDate: '2026-05-18',
  sheet: '1/1',
  format: 'A3',
  material: 'AL6061-T6',
  massKg: 0.452,
  scale: '1:2',
  owner: 'NexyFab',
  toleranceClass: 'm',
};

describe('buildIso7200Layout · geometry', () => {
  it('produces the standard 180 × 60 mm outer rectangle', () => {
    const g = buildIso7200Layout({ x: 420, y: 297 }); // A3 bottom-right
    expect(g.width).toBe(180);
    expect(g.height).toBe(60);
    expect(g.x).toBe(420 - 180);
    expect(g.y).toBe(297 - 60);
  });

  it('lays out all required ISO 7200 fields', () => {
    const g = buildIso7200Layout({ x: 420, y: 297 });
    const ids = new Set(g.fields.map(f => f.id));
    // Required: title, drawingNumber, revision, designer, designerDate.
    for (const required of ['title', 'drawingNumber', 'revision', 'designer', 'designerDate']) {
      expect(ids.has(required)).toBe(true);
    }
    // Recommended: sheet, format, material, scale, toleranceClass.
    for (const recommended of ['sheet', 'format', 'material', 'scale', 'toleranceClass']) {
      expect(ids.has(recommended)).toBe(true);
    }
  });

  it('every field rectangle stays inside the outer block', () => {
    const g = buildIso7200Layout({ x: 0, y: 0 });
    for (const f of g.fields) {
      expect(f.x).toBeGreaterThanOrEqual(g.x - 1e-6);
      expect(f.y).toBeGreaterThanOrEqual(g.y - 1e-6);
      expect(f.x + f.width).toBeLessThanOrEqual(g.x + g.width + 1e-6);
      expect(f.y + f.height).toBeLessThanOrEqual(g.y + g.height + 1e-6);
    }
  });

  it('fields do not overlap (their interiors are disjoint)', () => {
    const g = buildIso7200Layout({ x: 0, y: 0 });
    for (let i = 0; i < g.fields.length; i++) {
      for (let j = i + 1; j < g.fields.length; j++) {
        const a = g.fields[i];
        const b = g.fields[j];
        // Two rectangles overlap iff they're not disjoint along any axis.
        const disjoint =
          a.x + a.width <= b.x + 1e-6 ||
          b.x + b.width <= a.x + 1e-6 ||
          a.y + a.height <= b.y + 1e-6 ||
          b.y + b.height <= a.y + 1e-6;
        expect(disjoint).toBe(true);
      }
    }
  });

  it('emits a sensible number of partition lines (>= 10)', () => {
    // 2 horizontal row separators + 1 main vertical split + sub-dividers.
    const g = buildIso7200Layout({ x: 0, y: 0 });
    expect(g.partitions.length).toBeGreaterThanOrEqual(10);
  });

  it('title field font size is largest (≥ 5pt)', () => {
    const g = buildIso7200Layout({ x: 0, y: 0 });
    const title = g.fields.find(f => f.id === 'title');
    expect(title?.valueFontSize).toBeGreaterThanOrEqual(5);
  });
});

describe('fieldValue · data binding', () => {
  it('returns the title verbatim', () => {
    expect(fieldValue(sampleData, 'title')).toBe('BRACKET ASSY');
  });

  it('renders ISO 2768 tolerance class with the class prefix', () => {
    expect(fieldValue(sampleData, 'toleranceClass')).toBe('Class m');
  });

  it('formats mass to 2 decimal places', () => {
    expect(fieldValue(sampleData, 'massKg')).toBe('0.45');
  });

  it('defaults sheet to 1/1 when unset', () => {
    const minimal: TitleBlockIso7200Data = {
      title: '', drawingNumber: '', revision: '', designer: '', designerDate: '',
    };
    expect(fieldValue(minimal, 'sheet')).toBe('1/1');
  });

  it('defaults scale to 1:1 when unset', () => {
    const minimal: TitleBlockIso7200Data = {
      title: '', drawingNumber: '', revision: '', designer: '', designerDate: '',
    };
    expect(fieldValue(minimal, 'scale')).toBe('1:1');
  });

  it('returns empty string for unset optional fields', () => {
    const minimal: TitleBlockIso7200Data = {
      title: '', drawingNumber: '', revision: '', designer: '', designerDate: '',
    };
    expect(fieldValue(minimal, 'owner')).toBe('');
    expect(fieldValue(minimal, 'toleranceClass')).toBe('');
    expect(fieldValue(minimal, 'massKg')).toBe('');
  });

  it('returns empty string for unknown field ids', () => {
    expect(fieldValue(sampleData, 'nonexistent')).toBe('');
  });
});
