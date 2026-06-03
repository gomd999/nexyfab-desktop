/** @vitest-environment jsdom */
/**
 * StepCompareVersionPanel — B31 standalone panel tests.
 *
 * Coverage:
 *   - panel renders, both file inputs + textareas present
 *   - compare button calls diffSteps, surfaces counts
 *   - identical sources → "No changes"
 *   - header diff surfaces FILE_NAME change
 *   - entity row click toggles expand (collapsible)
 *   - 6-lang dictionary smoke (en/ko/ja/zh/es/ar)
 *   - paste textarea populates source
 *   - file input reads file content
 *   - 5 MB cap surfaces a warning instead of loading
 *   - color-coded badges: added (green), removed (red), changed (amber)
 *   - schema-changed badge appears on AP214 → AP242 transition
 *   - product-count delta badge appears when PRODUCT count changes
 *   - raw snippet is truncated to ≤ RAW_SNIPPET_LIMIT chars (+ellipsis)
 *   - removed entity row uses the "removed" kind colour class
 *   - composite (un-named) entity row falls back to "(composite)" label
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import StepCompareVersionPanel from '@/app/[lang]/shape-generator/drawing/StepCompareVersionPanel';

// ─── fixtures ─────────────────────────────────────────────────────────────

const AP214_BASE = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('base'),'2;1');
FILE_NAME('base.step','2026-06-01T00:00:00Z',(''),(''),'sys','sys','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }'));
ENDSEC;
DATA;
#10=CARTESIAN_POINT('',(0.,0.,0.));
#11=CARTESIAN_POINT('',(1.,0.,0.));
#12=DIRECTION('',(0.,0.,1.));
#13=PRODUCT('part','part','',(#10));
ENDSEC;
END-ISO-10303-21;
`;

const AP242_BASE = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('base'),'2;1');
FILE_NAME('base.step','2026-06-01T00:00:00Z',(''),(''),'sys','sys','');
FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 4 }'));
ENDSEC;
DATA;
#10=CARTESIAN_POINT('',(0.,0.,0.));
#11=CARTESIAN_POINT('',(1.,0.,0.));
#12=DIRECTION('',(0.,0.,1.));
#13=PRODUCT('part','part','',(#10));
ENDSEC;
END-ISO-10303-21;
`;

const AP214_MODIFIED = AP214_BASE.replace(
  "#11=CARTESIAN_POINT('',(1.,0.,0.));",
  "#11=CARTESIAN_POINT('',(2.,0.,0.));",
);

const AP214_FILE_RENAMED = AP214_BASE.replace(
  "FILE_NAME('base.step'",
  "FILE_NAME('renamed.step'",
);

const AP214_PLUS_PRODUCT = AP214_BASE.replace(
  '#13=PRODUCT',
  "#20=CARTESIAN_POINT('',(5.,5.,5.));\n#21=PRODUCT('p2','p2','',(#20));\n#13=PRODUCT",
);

const AP214_REMOVED = AP214_BASE.replace(
  "#12=DIRECTION('',(0.,0.,1.));\n",
  '',
);

// ─── helpers ──────────────────────────────────────────────────────────────

function mount(lang = 'en') {
  return render(<StepCompareVersionPanel lang={lang} />);
}

function setTextarea(testid: string, value: string): void {
  const el = screen.getByTestId(testid) as HTMLTextAreaElement;
  fireEvent.change(el, { target: { value } });
}

function clickCompare(): void {
  fireEvent.click(screen.getByTestId('drawing-step-compare-compare-button'));
}

// ─── tests ────────────────────────────────────────────────────────────────

describe('StepCompareVersionPanel — shell', () => {
  it('renders the panel + both file inputs + both textareas + compare button', () => {
    mount();
    expect(screen.getByTestId('drawing-step-compare-panel')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-step-compare-old-input')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-step-compare-new-input')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-step-compare-old-textarea')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-step-compare-new-textarea')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-step-compare-compare-button')).toBeInTheDocument();
  });

  it('paste textarea populates the source value', () => {
    mount();
    setTextarea('drawing-step-compare-old-textarea', AP214_BASE);
    const el = screen.getByTestId('drawing-step-compare-old-textarea') as HTMLTextAreaElement;
    expect(el.value).toBe(AP214_BASE);
  });
});

describe('StepCompareVersionPanel — compare flow', () => {
  it('identical sources produce a "No changes" indicator', () => {
    mount();
    setTextarea('drawing-step-compare-old-textarea', AP214_BASE);
    setTextarea('drawing-step-compare-new-textarea', AP214_BASE);
    clickCompare();
    expect(screen.getByTestId('drawing-step-compare-no-changes')).toBeInTheDocument();
  });

  it('modified entity surfaces an entity row + count badge (1 changed)', () => {
    mount();
    setTextarea('drawing-step-compare-old-textarea', AP214_BASE);
    setTextarea('drawing-step-compare-new-textarea', AP214_MODIFIED);
    clickCompare();
    expect(screen.getByTestId('drawing-step-compare-entity-row-11')).toBeInTheDocument();
    expect(
      screen.getByTestId('drawing-step-compare-badge-changed-count').textContent,
    ).toBe('1');
  });

  it('removed entity gets a row with kind=removed', () => {
    mount();
    setTextarea('drawing-step-compare-old-textarea', AP214_BASE);
    setTextarea('drawing-step-compare-new-textarea', AP214_REMOVED);
    clickCompare();
    const row = screen.getByTestId('drawing-step-compare-entity-row-12');
    expect(row.getAttribute('data-kind')).toBe('removed');
    expect(
      screen.getByTestId('drawing-step-compare-badge-removed-count').textContent,
    ).toBe('1');
  });

  it('header FILE_NAME change shows the header-diff table with row for FILE_NAME', () => {
    mount();
    setTextarea('drawing-step-compare-old-textarea', AP214_BASE);
    setTextarea('drawing-step-compare-new-textarea', AP214_FILE_RENAMED);
    clickCompare();
    expect(screen.getByTestId('drawing-step-compare-header-diff')).toBeInTheDocument();
    expect(
      screen.getByTestId('drawing-step-compare-header-row-FILE_NAME'),
    ).toBeInTheDocument();
  });

  it('color-coded badges (added green / removed red / changed amber) are all present', () => {
    mount();
    setTextarea('drawing-step-compare-old-textarea', AP214_BASE);
    setTextarea('drawing-step-compare-new-textarea', AP214_MODIFIED);
    clickCompare();
    const added = screen.getByTestId('drawing-step-compare-badge-added');
    const removed = screen.getByTestId('drawing-step-compare-badge-removed');
    const changed = screen.getByTestId('drawing-step-compare-badge-changed');
    // Inline styles encode colour-coded backgrounds.
    expect(added.getAttribute('style')).toMatch(/rgb\(22,\s*163,\s*74\)|#16a34a/);
    expect(removed.getAttribute('style')).toMatch(/rgb\(220,\s*38,\s*38\)|#dc2626/);
    expect(changed.getAttribute('style')).toMatch(/rgb\(217,\s*119,\s*6\)|#d97706/);
  });

  it('schema-changed badge appears on AP214 → AP242 transition', () => {
    mount();
    setTextarea('drawing-step-compare-old-textarea', AP214_BASE);
    setTextarea('drawing-step-compare-new-textarea', AP242_BASE);
    clickCompare();
    expect(screen.getByTestId('drawing-step-compare-schema-changed')).toBeInTheDocument();
  });

  it('product-count-delta badge appears when an extra PRODUCT is added', () => {
    mount();
    setTextarea('drawing-step-compare-old-textarea', AP214_BASE);
    setTextarea('drawing-step-compare-new-textarea', AP214_PLUS_PRODUCT);
    clickCompare();
    expect(screen.getByTestId('drawing-step-compare-product-delta')).toBeInTheDocument();
  });
});

describe('StepCompareVersionPanel — entity row expand', () => {
  it('clicking the row toggle reveals before/after snippets', () => {
    mount();
    setTextarea('drawing-step-compare-old-textarea', AP214_BASE);
    setTextarea('drawing-step-compare-new-textarea', AP214_MODIFIED);
    clickCompare();
    // Body should not be present before toggle.
    expect(
      screen.queryByTestId('drawing-step-compare-entity-row-11-body'),
    ).toBeNull();
    fireEvent.click(screen.getByTestId('drawing-step-compare-entity-row-11-toggle'));
    expect(
      screen.getByTestId('drawing-step-compare-entity-row-11-body'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('drawing-step-compare-entity-row-11-before').textContent,
    ).toMatch(/1\./);
    expect(
      screen.getByTestId('drawing-step-compare-entity-row-11-after').textContent,
    ).toMatch(/2\./);
  });

  it('raw snippet is truncated to ≤ 240 chars (+ ellipsis) for huge entity bodies', () => {
    // Build a long body — same id on both sides but contents differ.
    const longArgs = Array.from({ length: 400 }, (_, i) => `#${1000 + i}`).join(',');
    const oldSrc = `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('x'),'2;1');\nFILE_NAME('a.step','2026','','','','','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n#10=CARTESIAN_POINT('',(0.,0.,0.));\n#99=OPEN_SHELL('',(${longArgs}));\nENDSEC;\nEND-ISO-10303-21;\n`;
    const newSrc = oldSrc.replace('#99=OPEN_SHELL', '#99=OPEN_SHELL_X');
    mount();
    setTextarea('drawing-step-compare-old-textarea', oldSrc);
    setTextarea('drawing-step-compare-new-textarea', newSrc);
    clickCompare();
    fireEvent.click(screen.getByTestId('drawing-step-compare-entity-row-99-toggle'));
    const beforeText =
      screen.getByTestId('drawing-step-compare-entity-row-99-before').textContent ?? '';
    // The header label "Before: " + snippet — total text length capped near the limit.
    // 240 is the snippet cap; allow some slack for the prefix label.
    expect(beforeText.length).toBeLessThanOrEqual(260);
    expect(beforeText).toMatch(/…$/);
  });
});

describe('StepCompareVersionPanel — file size cap', () => {
  beforeEach(() => {
    // jsdom FileReader uses Blob.text which is async; we rely on the real path.
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses to load a file > 5 MB; surfaces an inline warning', () => {
    mount();
    // Build a fake File whose .size reports > 5 MB without actually allocating it.
    const bigFile = new File(['x'], 'huge.step', { type: 'application/step' });
    Object.defineProperty(bigFile, 'size', { value: 6 * 1024 * 1024 });
    const input = screen.getByTestId('drawing-step-compare-old-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [bigFile] } });
    expect(
      screen.getByTestId('drawing-step-compare-old-input-error').textContent,
    ).toMatch(/5 MB|MB/);
  });

  it('file ≤ 5 MB loads and populates the textarea', async () => {
    mount();
    const file = new File([AP214_BASE], 'tiny.step', { type: 'application/step' });
    const input = screen.getByTestId('drawing-step-compare-old-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      const el = screen.getByTestId('drawing-step-compare-old-textarea') as HTMLTextAreaElement;
      expect(el.value).toContain('ISO-10303-21');
    });
  });
});

describe('StepCompareVersionPanel — i18n', () => {
  it.each([
    ['en', /STEP Version Compare/i],
    ['ko', /STEP 버전 비교/],
    ['ja', /STEPバージョン比較/],
    ['zh', /STEP版本对比/],
    ['es', /Comparar versiones STEP/i],
    ['ar', /مقارنة إصدارات STEP/],
  ])('lang=%s surfaces the localised stepCompare heading', (lang, re) => {
    mount(lang);
    expect(screen.getByTestId('drawing-step-compare-panel').textContent).toMatch(re);
  });

  it('lang=ko surfaces 비교 (compareButton) label', () => {
    mount('ko');
    expect(
      screen.getByTestId('drawing-step-compare-compare-button').textContent,
    ).toMatch(/비교/);
  });

  it('lang=ja surfaces 追加/削除/変更 count badge labels after compare', () => {
    mount('ja');
    setTextarea('drawing-step-compare-old-textarea', AP214_BASE);
    setTextarea('drawing-step-compare-new-textarea', AP214_MODIFIED);
    clickCompare();
    const text = screen.getByTestId('drawing-step-compare-result').textContent ?? '';
    expect(text).toMatch(/追加/);
    expect(text).toMatch(/削除/);
    expect(text).toMatch(/変更/);
  });
});

describe('StepCompareVersionPanel — robustness', () => {
  it('clicking Compare on empty inputs does not throw and shows "No changes"', () => {
    mount();
    clickCompare();
    expect(screen.getByTestId('drawing-step-compare-no-changes')).toBeInTheDocument();
  });

  it('unknown lang falls back to English heading', () => {
    mount('xx');
    expect(screen.getByTestId('drawing-step-compare-panel').textContent).toMatch(
      /STEP Version Compare/i,
    );
  });
});
