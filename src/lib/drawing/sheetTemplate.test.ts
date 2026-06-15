/**
 * sheetTemplate — template registry + applyTemplate / buildSheetFromTemplate tests.
 */
import { describe, it, expect } from 'vitest';
import { standardThreeViewSheet, validateSheet, type Sheet } from './sheet';
import {
  applyTemplate,
  buildSheetFromTemplate,
  TEMPLATES,
  type SheetTemplate,
  type TemplatedSheet,
} from './sheetTemplate';

// ─── TEMPLATES registry ──────────────────────────────────────────────────

describe('TEMPLATES registry', () => {
  it('defines exactly the 4 default templates', () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual(
      ['architectural', 'engineering', 'isoA3', 'minimal'].sort(),
    );
  });

  it('engineering template targets A3 with a titleblock + border', () => {
    const t = TEMPLATES.engineering;
    expect(t.name).toBe('engineering');
    expect(t.paperSize).toBe('A3');
    expect(t.titleblock).toBeDefined();
    expect(t.titleblock?.scale).toBe('1:1');
    expect(t.border?.margin).toBeGreaterThan(0);
  });

  it('architectural template targets A1 with architectural scale', () => {
    const t = TEMPLATES.architectural;
    expect(t.paperSize).toBe('A1');
    expect(t.titleblock?.scale).toBe('1:50');
    expect(t.titleblock?.sheetNumber).toMatch(/^A-/);
  });

  it('minimal template has no titleblock, no border, no revisions', () => {
    const t = TEMPLATES.minimal;
    expect(t.paperSize).toBe('A4');
    expect(t.titleblock).toBeUndefined();
    expect(t.border).toBeUndefined();
    expect(t.revisionHistory).toBeUndefined();
  });

  it('iso-a3 template advertises ISO 7200 in its titleblock title', () => {
    const t = TEMPLATES.isoA3;
    expect(t.paperSize).toBe('A3');
    expect(t.titleblock?.title).toBe('ISO 7200');
    expect(t.border?.strokeWidth).toBeCloseTo(0.35);
  });

  it('TEMPLATES is frozen — direct mutation is rejected', () => {
    expect(() => {
      // @ts-expect-error — intentional runtime check
      TEMPLATES.engineering = { name: 'x', paperSize: 'A4' };
    }).toThrow();
  });
});

// ─── applyTemplate ───────────────────────────────────────────────────────

function freshSheet(paperSize: 'A3' | 'A4' = 'A3'): Sheet {
  return standardThreeViewSheet({
    id: 'sheet-1',
    name: 'Test',
    sourceId: 'part-1',
    paperSize,
    scale: 1,
  });
}

describe('applyTemplate', () => {
  it('preserves viewports verbatim', () => {
    const sheet = freshSheet();
    const out = applyTemplate(sheet, TEMPLATES.engineering);
    expect(out.viewports).toBe(sheet.viewports);
    expect(out.viewports.map((v) => v.id)).toEqual(['front', 'top', 'right', 'iso']);
  });

  it('attaches the template metadata to the returned sheet', () => {
    const out = applyTemplate(freshSheet(), TEMPLATES.engineering);
    expect(out.template?.name).toBe('engineering');
    expect(out.template?.titleblock?.scale).toBe('1:1');
  });

  it('overrides paperSize to the template paperSize', () => {
    const sheet = freshSheet('A4');
    const out = applyTemplate(sheet, TEMPLATES.architectural);
    expect(out.paperSize).toBe('A1');
  });

  it('drops customPaper when applying a standard-size template', () => {
    const sheet: Sheet = {
      id: 's',
      name: 'n',
      paperSize: 'custom',
      customPaper: { width: 500, height: 300 },
      viewports: [],
    };
    const out = applyTemplate(sheet, TEMPLATES.engineering);
    expect(out.paperSize).toBe('A3');
    expect(out.customPaper).toBeUndefined();
  });

  it('does not mutate the input sheet', () => {
    const sheet = freshSheet('A4');
    const originalPaper = sheet.paperSize;
    applyTemplate(sheet, TEMPLATES.engineering);
    expect(sheet.paperSize).toBe(originalPaper);
    expect((sheet as TemplatedSheet).template).toBeUndefined();
  });

  it('deep-clones the template — registry stays untouched if sheet.template is mutated', () => {
    const out = applyTemplate(freshSheet(), TEMPLATES.engineering);
    if (out.template?.titleblock) {
      out.template.titleblock.title = 'MUTATED';
    }
    expect(TEMPLATES.engineering.titleblock?.title).toBe('UNTITLED');
  });

  it('produces a sheet that still passes validateSheet', () => {
    const out = applyTemplate(freshSheet(), TEMPLATES.engineering);
    expect(() => validateSheet(out)).not.toThrow();
  });

  it('preserves dimensions + GD&T arrays when present', () => {
    const sheet: Sheet = {
      ...freshSheet(),
      dimensions: [],
      gdtCallouts: [],
    };
    const out = applyTemplate(sheet, TEMPLATES.engineering);
    expect(out.dimensions).toBe(sheet.dimensions);
    expect(out.gdtCallouts).toBe(sheet.gdtCallouts);
  });
});

// ─── buildSheetFromTemplate ──────────────────────────────────────────────

describe('buildSheetFromTemplate', () => {
  it('engineering → A3 sheet with titleblock attached', () => {
    const out = buildSheetFromTemplate(TEMPLATES.engineering, 'part-42');
    expect(out.paperSize).toBe('A3');
    expect(out.template?.titleblock?.scale).toBe('1:1');
    expect(out.viewports).toHaveLength(4);
  });

  it('embeds the sourceId in every viewport', () => {
    const out = buildSheetFromTemplate(TEMPLATES.engineering, 'part-42');
    for (const vp of out.viewports) {
      expect(vp.sourceId).toBe('part-42');
    }
  });

  it('architectural template builds an A1 sheet', () => {
    const out = buildSheetFromTemplate(TEMPLATES.architectural, 'house');
    expect(out.paperSize).toBe('A1');
    expect(out.template?.name).toBe('architectural');
  });

  it('minimal template builds an A4 sheet with no titleblock metadata', () => {
    const out = buildSheetFromTemplate(TEMPLATES.minimal, 'p');
    expect(out.paperSize).toBe('A4');
    expect(out.template?.titleblock).toBeUndefined();
    expect(out.template?.border).toBeUndefined();
  });

  it('names the sheet from titleblock.title when present', () => {
    const out = buildSheetFromTemplate(TEMPLATES.isoA3, 'p');
    expect(out.name).toBe('ISO 7200');
  });

  it('falls back to template.name for the sheet name when titleblock has no title', () => {
    const out = buildSheetFromTemplate(TEMPLATES.minimal, 'p');
    expect(out.name).toBe('minimal');
  });

  it('result passes validateSheet', () => {
    const out = buildSheetFromTemplate(TEMPLATES.engineering, 'p');
    expect(() => validateSheet(out)).not.toThrow();
  });
});

// ─── revisionHistory + border specifics ──────────────────────────────────

describe('revisionHistory and border', () => {
  it('applyTemplate carries revisionHistory entries through', () => {
    const template: SheetTemplate = {
      name: 'rev-test',
      paperSize: 'A3',
      revisionHistory: [
        { rev: 'A', description: 'Initial release', date: '2026-06-01', by: 'kim' },
        { rev: 'B', description: 'Tolerance update', date: '2026-06-02', by: 'lee' },
      ],
    };
    const out = applyTemplate(freshSheet(), template);
    expect(out.template?.revisionHistory).toHaveLength(2);
    expect(out.template?.revisionHistory?.[1].rev).toBe('B');
    expect(out.template?.revisionHistory?.[1].by).toBe('lee');
  });

  it('border metadata is copied with margin + strokeWidth', () => {
    const template: SheetTemplate = {
      name: 'border-test',
      paperSize: 'A3',
      border: { margin: 12.5, strokeWidth: 0.8 },
    };
    const out = applyTemplate(freshSheet(), template);
    expect(out.template?.border?.margin).toBeCloseTo(12.5);
    expect(out.template?.border?.strokeWidth).toBeCloseTo(0.8);
  });

  it('mutating returned revisionHistory does not leak into source template', () => {
    const template: SheetTemplate = {
      name: 'rev-isolate',
      paperSize: 'A3',
      revisionHistory: [{ rev: 'A', description: 'init', date: 'd', by: 'me' }],
    };
    const out = applyTemplate(freshSheet(), template);
    if (out.template?.revisionHistory) {
      // Cast away readonly for the mutation test.
      (out.template.revisionHistory as unknown as Array<{ rev: string }>)[0].rev = 'ZZ';
    }
    expect(template.revisionHistory?.[0].rev).toBe('A');
  });
});
