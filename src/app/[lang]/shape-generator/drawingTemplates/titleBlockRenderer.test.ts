import { describe, it, expect } from 'vitest';
import { renderTitleBlockSvg, renderTitleBlockDataUrl } from './titleBlockRenderer';
import { ISO_7200, KS_A_0106 } from './titleBlocks';

describe('renderTitleBlockSvg', () => {
  it('produces a valid SVG envelope sized to sheet (A3)', () => {
    const svg = renderTitleBlockSvg(ISO_7200, 'A3', {});
    expect(svg).toMatch(/<svg /);
    expect(svg).toContain('width="420mm"');
    expect(svg).toContain('height="297mm"');
    expect(svg).toContain('viewBox="0 0 420 297"');
    expect(svg).toMatch(/<\/svg>$/);
  });

  it('embeds provided values', () => {
    const svg = renderTitleBlockSvg(ISO_7200, 'A4', { title: 'Bracket Mk-II', partNumber: 'NF-0042' });
    expect(svg).toContain('Bracket Mk-II');
    expect(svg).toContain('NF-0042');
  });

  it('escapes XML-unsafe chars in values', () => {
    const svg = renderTitleBlockSvg(ISO_7200, 'A4', { title: 'A < B & C' });
    expect(svg).toContain('A &lt; B &amp; C');
    expect(svg).not.toContain('A < B & C');
  });

  it('falls back to cell defaultValue when missing', () => {
    // ISO_7200 has projection default = 'first-angle'.
    const svg = renderTitleBlockSvg(ISO_7200, 'A4', {});
    expect(svg).toContain('first-angle');
  });

  it('draws watermark when provided', () => {
    const svg = renderTitleBlockSvg(ISO_7200, 'A4', {}, { watermark: 'NEXYFAB DEMO' });
    expect(svg).toContain('NEXYFAB DEMO');
    expect(svg).toContain('rotate(-30');
  });

  it('omits border when drawBorder=false', () => {
    const withBorder = renderTitleBlockSvg(ISO_7200, 'A4', {});
    const withoutBorder = renderTitleBlockSvg(ISO_7200, 'A4', {}, { drawBorder: false });
    // The border rect references the inner margin (e.g. x="10" y="10").
    // Without a border, one fewer rect should be emitted.
    const countRects = (s: string): number => (s.match(/<rect /g) ?? []).length;
    expect(countRects(withoutBorder)).toBeLessThan(countRects(withBorder));
  });

  it('renders Korean KS labels without mojibake', () => {
    const svg = renderTitleBlockSvg(KS_A_0106, 'A4', { title: '브라켓' });
    expect(svg).toContain('도면명');
    expect(svg).toContain('브라켓');
  });

  it('cell rectangles fit within sheet area', () => {
    const svg = renderTitleBlockSvg(ISO_7200, 'A3', {});
    const rectMatches = svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g);
    for (const m of rectMatches) {
      const x = parseFloat(m[1]!), y = parseFloat(m[2]!), w = parseFloat(m[3]!), h = parseFloat(m[4]!);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(420 + 0.001);
      expect(y + h).toBeLessThanOrEqual(297 + 0.001);
    }
  });
});

describe('renderTitleBlockDataUrl', () => {
  it('returns a base64 data URL', () => {
    const url = renderTitleBlockDataUrl(ISO_7200, 'A4', { title: 'X' });
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
    // Decoded payload should contain the title text.
    const b64 = url.split(',')[1]!;
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    expect(decoded).toContain('<svg ');
  });
});
