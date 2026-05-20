import { describe, it, expect } from 'vitest';
import {
  createBook,
  addSheet,
  removeSheet,
  reorderSheet,
  addEntityToSheet,
  removeEntityFromSheet,
  findSheetForEntity,
  addReference,
  validateReferences,
  getPrintOrder,
  summarize,
} from './multiSheetManager';

describe('addSheet', () => {
  it('first sheet has number 1', () => {
    const book = createBook();
    const s = addSheet(book, 's1');
    expect(s.sheetNumber).toBe(1);
  });

  it('default paper size A3 landscape', () => {
    const book = createBook();
    const s = addSheet(book, 's1');
    expect(s.paperSize).toBe('A3');
    expect(s.orientation).toBe('landscape');
  });

  it('duplicate id throws', () => {
    const book = createBook();
    addSheet(book, 's1');
    expect(() => addSheet(book, 's1')).toThrow();
  });

  it('options override defaults', () => {
    const book = createBook();
    const s = addSheet(book, 's1', { title: 'Cover', paperSize: 'A4', orientation: 'portrait' });
    expect(s.title).toBe('Cover');
    expect(s.paperSize).toBe('A4');
  });
});

describe('removeSheet', () => {
  it('returns true on success', () => {
    const book = createBook();
    addSheet(book, 's1');
    expect(removeSheet(book, 's1')).toBe(true);
  });

  it('renumbers remaining sheets', () => {
    const book = createBook();
    addSheet(book, 's1');
    addSheet(book, 's2');
    addSheet(book, 's3');
    removeSheet(book, 's1');
    expect(book.sheets.get('s2')!.sheetNumber).toBe(1);
    expect(book.sheets.get('s3')!.sheetNumber).toBe(2);
  });

  it('returns false for unknown id', () => {
    expect(removeSheet(createBook(), 'ghost')).toBe(false);
  });
});

describe('reorderSheet', () => {
  it('moves sheet to new position', () => {
    const book = createBook();
    addSheet(book, 'a');
    addSheet(book, 'b');
    addSheet(book, 'c');
    reorderSheet(book, 'c', 0);
    expect(book.order[0]).toBe('c');
  });

  it('updates sheet numbers after move', () => {
    const book = createBook();
    addSheet(book, 'a');
    addSheet(book, 'b');
    reorderSheet(book, 'a', 1);
    expect(book.sheets.get('b')!.sheetNumber).toBe(1);
    expect(book.sheets.get('a')!.sheetNumber).toBe(2);
  });
});

describe('entities', () => {
  it('addEntityToSheet adds id', () => {
    const book = createBook();
    addSheet(book, 's1');
    addEntityToSheet(book, 's1', 'e1');
    expect(book.sheets.get('s1')!.entityIds.has('e1')).toBe(true);
  });

  it('removeEntityFromSheet removes', () => {
    const book = createBook();
    addSheet(book, 's1');
    addEntityToSheet(book, 's1', 'e1');
    expect(removeEntityFromSheet(book, 's1', 'e1')).toBe(true);
  });

  it('findSheetForEntity walks all sheets', () => {
    const book = createBook();
    addSheet(book, 's1');
    addSheet(book, 's2');
    addEntityToSheet(book, 's2', 'e1');
    expect(findSheetForEntity(book, 'e1')?.id).toBe('s2');
  });
});

describe('references', () => {
  it('valid reference passes validation', () => {
    const book = createBook();
    addSheet(book, 's1');
    addSheet(book, 's2');
    addReference(book, 's1', { refId: 'r1', targetSheetId: 's2' });
    expect(validateReferences(book)).toEqual([]);
  });

  it('broken target sheet flagged', () => {
    const book = createBook();
    addSheet(book, 's1');
    addReference(book, 's1', { refId: 'r1', targetSheetId: 'ghost' });
    const broken = validateReferences(book);
    expect(broken).toHaveLength(1);
  });

  it('broken target entity flagged', () => {
    const book = createBook();
    addSheet(book, 's1');
    addSheet(book, 's2');
    addReference(book, 's1', { refId: 'r1', targetSheetId: 's2', targetEntityId: 'missing' });
    expect(validateReferences(book).length).toBe(1);
  });
});

describe('getPrintOrder', () => {
  it('returns sheets in book order', () => {
    const book = createBook();
    addSheet(book, 'a');
    addSheet(book, 'b');
    const order = getPrintOrder(book);
    expect(order.map(s => s.id)).toEqual(['a', 'b']);
  });
});

describe('summarize', () => {
  it('empty book', () => {
    const s = summarize(createBook());
    expect(s.sheetCount).toBe(0);
  });

  it('reports counts and paper sizes', () => {
    const book = createBook();
    addSheet(book, 's1', { paperSize: 'A4' });
    addSheet(book, 's2', { paperSize: 'A3' });
    addEntityToSheet(book, 's1', 'e1');
    const s = summarize(book);
    expect(s.sheetCount).toBe(2);
    expect(s.totalEntities).toBe(1);
    expect(s.paperSizes.sort()).toEqual(['A3', 'A4']);
  });
});
