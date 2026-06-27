/** sketch radial menu item builders — i18n + structure. Coverage-gap closure. */
import { describe, it, expect } from 'vitest';
import { getSketchRadialMainItems, getSketchRadialInnerItems, getSketchRadialLinearItems, getSketchRadialItems } from './sketchRadialItems';
describe('sketch radial items', () => {
  for (const lang of ['en', 'ko']) {
    it(`builds non-empty radial menus with ids (${lang})`, () => {
      for (const items of [getSketchRadialMainItems(lang), getSketchRadialInnerItems(lang), getSketchRadialLinearItems(lang), getSketchRadialItems(lang)]) {
        expect(items.length).toBeGreaterThan(0);
        expect(items.every(i => !!i.id)).toBe(true);
      }
    });
  }
});
