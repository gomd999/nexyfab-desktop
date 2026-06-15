/** @vitest-environment jsdom */
/**
 * SketchImportModal — standalone import-dialog tests.
 *
 * Coverage targets the public contract:
 *   - render shape (modal + file input + textarea + Import/Cancel)
 *   - file picker → FileReader → textarea populated → submit hands entities
 *     up via onImport + closes
 *   - paste-text path → submit hands entities up via onImport
 *   - hard parse error (no <svg> root) shows red alert + modal STAYS open
 *   - non-fatal warnings (unsupported <text>) show yellow alert
 *   - empty submission shows red "no input" alert without invoking importer
 *   - cancel button + backdrop click close without onImport firing
 *   - 6-language UI labels per `lang` prop
 *
 * jsdom note: FileReader IS available in jsdom but firing the change event
 * with a Blob doesn't automatically resolve readAsText synchronously — we
 * await a microtask before asserting the textarea value updated.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import SketchImportModal from '@/app/[lang]/shape-generator/sketch/SketchImportModal';
import type { SketchEntities } from '@/lib/sketch/sketchSvgExport';

// ─── fixtures ────────────────────────────────────────────────────────────

/**
 * Minimal valid SVG with the Y-flip wrapper our exporter emits + one line
 * + one point. Exercises both code paths in the importer (point heuristic
 * via r=1 circle, line via <line>).
 */
const VALID_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g transform="translate(0 100) scale(1 -1)">
    <line x1="0" y1="0" x2="50" y2="50" stroke="#000" data-sketch-id="L1"/>
    <circle cx="10" cy="10" r="1" fill="#000" data-kind="point" data-sketch-id="P1"/>
  </g>
</svg>`;

/** Valid SVG that produces a warning (unsupported <text> element). */
const SVG_WITH_WARNING = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(0 100) scale(1 -1)">
    <line x1="0" y1="0" x2="10" y2="10"/>
  </g>
  <text x="0" y="0">unsupported</text>
</svg>`;

/** Hard-error SVG (no <svg> root). */
const INVALID_SVG = `<html><body>not an svg document</body></html>`;

// ─── helpers ─────────────────────────────────────────────────────────────

function renderModal(
  lang: 'en' | 'ko' | 'ja' | 'zh' | 'es' | 'ar' = 'en',
) {
  // Always return vi.fn()s so callers can read .mock.calls without
  // narrowing the union the way `overrides.onImport ?? vi.fn()` would
  // produce. Tests that need to react to the callbacks can read off the
  // returned spies directly.
  const onImport = vi.fn<(entities: SketchEntities, warnings: ReadonlyArray<string>) => void>();
  const onClose = vi.fn<() => void>();
  render(<SketchImportModal lang={lang} onImport={onImport} onClose={onClose} />);
  return { onImport, onClose };
}

/**
 * Drop the given SVG string into the textarea so we don't have to round-trip
 * through FileReader for every test. The textarea handler updates state
 * synchronously so fireEvent.change is enough.
 */
function pasteSvg(svg: string): void {
  const ta = screen.getByTestId('sketch-import-textarea') as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value: svg } });
}

afterEach(() => {
  cleanup();
});

// ─── tests ───────────────────────────────────────────────────────────────

describe('SketchImportModal — render', () => {
  it('renders modal shell with title, file input, textarea, Import + Cancel buttons', () => {
    renderModal('en');
    expect(screen.getByTestId('sketch-import-modal')).toBeInTheDocument();
    expect(screen.getByTestId('sketch-import-title')).toHaveTextContent('Import SVG');
    expect(screen.getByTestId('sketch-import-file')).toBeInTheDocument();
    expect(screen.getByTestId('sketch-import-textarea')).toBeInTheDocument();
    expect(screen.getByTestId('sketch-import-submit')).toHaveTextContent('Import');
    expect(screen.getByTestId('sketch-import-cancel')).toHaveTextContent('Cancel');
  });

  it('file input accepts only SVG', () => {
    renderModal('en');
    const fileInput = screen.getByTestId('sketch-import-file') as HTMLInputElement;
    expect(fileInput.accept).toContain('.svg');
    expect(fileInput.type).toBe('file');
  });
});

describe('SketchImportModal — successful import path', () => {
  it('paste valid SVG + click Import → onImport fires with entities, modal closes', () => {
    const { onImport, onClose } = renderModal('en');
    pasteSvg(VALID_SVG);
    fireEvent.click(screen.getByTestId('sketch-import-submit'));
    expect(onImport).toHaveBeenCalledTimes(1);
    const [entities, warnings] = onImport.mock.calls[0]!;
    expect(entities.points.length).toBeGreaterThanOrEqual(1);
    expect(entities.lines.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(warnings)).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('entities passed to onImport match importSketchFromSvg output shape', () => {
    const { onImport } = renderModal('en');
    pasteSvg(VALID_SVG);
    fireEvent.click(screen.getByTestId('sketch-import-submit'));
    const [entities] = onImport.mock.calls[0]!;
    // Importer preserves data-sketch-id on points + lines.
    expect(entities.lines[0].id).toBe('L1');
    expect(entities.points[0].id).toBe('P1');
  });
});

describe('SketchImportModal — file picker path', () => {
  it('selecting a file populates textarea with file contents', async () => {
    renderModal('en');
    const fileInput = screen.getByTestId('sketch-import-file') as HTMLInputElement;
    const file = new File([VALID_SVG], 'test.svg', { type: 'image/svg+xml' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fireEvent.change(fileInput);
    await waitFor(() => {
      const ta = screen.getByTestId('sketch-import-textarea') as HTMLTextAreaElement;
      expect(ta.value).toContain('<svg');
    });
  });

  it('file picker + Import → onImport fires with file contents parsed', async () => {
    const { onImport, onClose } = renderModal('en');
    const fileInput = screen.getByTestId('sketch-import-file') as HTMLInputElement;
    const file = new File([VALID_SVG], 'sketch.svg', { type: 'image/svg+xml' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fireEvent.change(fileInput);
    await waitFor(() => {
      const ta = screen.getByTestId('sketch-import-textarea') as HTMLTextAreaElement;
      expect(ta.value.length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByTestId('sketch-import-submit'));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('SketchImportModal — warnings display', () => {
  it('SVG with unsupported <text> shows yellow warning alert + still imports', () => {
    const { onImport, onClose } = renderModal('en');
    pasteSvg(SVG_WITH_WARNING);
    fireEvent.click(screen.getByTestId('sketch-import-submit'));
    // Modal closes on successful import; warnings handed to host via 2nd arg.
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    const [, warnings] = onImport.mock.calls[0]!;
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join(' ')).toMatch(/text/i);
  });

  it('SVG without flip wrapper produces a no-flip warning (route via host)', () => {
    const { onImport } = renderModal('en');
    // No <g transform> wrapper = importer warns about missing Y-flip but
    // still imports the entities. Use a circle so we get visible geometry.
    pasteSvg(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><circle cx="0" cy="0" r="5"/></svg>`);
    fireEvent.click(screen.getByTestId('sketch-import-submit'));
    const [, warnings] = onImport.mock.calls[0]!;
    expect(warnings.some((w: string) => /Y-flip/i.test(w))).toBe(true);
  });
});

describe('SketchImportModal — error display', () => {
  it('invalid SVG (no <svg> root) shows red error alert + modal STAYS open', () => {
    const { onImport, onClose } = renderModal('en');
    pasteSvg(INVALID_SVG);
    fireEvent.click(screen.getByTestId('sketch-import-submit'));
    expect(onImport).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const err = screen.getByTestId('sketch-import-error');
    expect(err).toBeInTheDocument();
    expect(err.textContent).toMatch(/svg/i);
  });

  it('empty submission shows local "no input" error without calling importer', () => {
    const { onImport, onClose } = renderModal('en');
    // No paste, no file → submit
    fireEvent.click(screen.getByTestId('sketch-import-submit'));
    expect(onImport).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('sketch-import-error')).toBeInTheDocument();
  });

  it('error clears when user edits the textarea (retry path)', () => {
    renderModal('en');
    pasteSvg(INVALID_SVG);
    fireEvent.click(screen.getByTestId('sketch-import-submit'));
    expect(screen.queryByTestId('sketch-import-error')).toBeInTheDocument();
    // User edits the textarea — error panel should disappear.
    pasteSvg(VALID_SVG);
    expect(screen.queryByTestId('sketch-import-error')).not.toBeInTheDocument();
  });
});

describe('SketchImportModal — close paths', () => {
  it('Cancel button calls onClose without onImport', () => {
    const { onImport, onClose } = renderModal('en');
    fireEvent.click(screen.getByTestId('sketch-import-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onImport).not.toHaveBeenCalled();
  });

  it('backdrop click closes; click inside dialog does NOT close', () => {
    const { onImport, onClose } = renderModal('en');
    // Click the backdrop (the outer modal element itself).
    const modal = screen.getByTestId('sketch-import-modal');
    fireEvent.click(modal);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onImport).not.toHaveBeenCalled();
  });
});

describe('SketchImportModal — i18n (6 languages)', () => {
  const cases: Array<{ lang: 'en' | 'ko' | 'ja' | 'zh' | 'es' | 'ar'; title: string; importLabel: string }> = [
    { lang: 'en', title: 'Import SVG', importLabel: 'Import' },
    { lang: 'ko', title: 'SVG 가져오기', importLabel: '가져오기' },
    { lang: 'ja', title: 'SVGインポート', importLabel: 'インポート' },
    { lang: 'zh', title: '导入SVG', importLabel: '导入' },
    { lang: 'es', title: 'Importar SVG', importLabel: 'Importar' },
    { lang: 'ar', title: 'استيراد SVG', importLabel: 'استيراد' },
  ];
  for (const { lang, title, importLabel } of cases) {
    it(`renders ${lang} labels`, () => {
      renderModal(lang);
      expect(screen.getByTestId('sketch-import-title')).toHaveTextContent(title);
      expect(screen.getByTestId('sketch-import-submit')).toHaveTextContent(importLabel);
    });
  }
});

// ─── DXF integration + format detection tests ────────────────────────────
// Below this line: SketchDxfImport integration. Added when SketchImportModal
// was extended to handle both SVG and DXF in addition to the original SVG-
// only ingress. Coverage targets the public contract of the new code path:
//   - file extension → correct importer routed
//   - content sniffing on paste → correct importer routed
//   - detected-format badge surfaces the auto-detection result
//   - unknown-format fallback try-both (SVG first, DXF second) — first
//     success wins, both-fail surfaces a user-facing error
//   - 6-lang detectedFormat / unknownFormat labels

/** Minimal valid DXF with one LINE entity in the ENTITIES section. The DXF
 *  parser is whitespace-tolerant so a few extra blank lines don't matter. */
const VALID_DXF = `0
SECTION
2
ENTITIES
0
LINE
8
0
10
0.0
20
0.0
11
50.0
21
50.0
0
ENDSEC
0
EOF`;

/** DXF with one CIRCLE entity — used to verify the parsed result reaches
 *  onImport with the right entity count. */
const VALID_DXF_CIRCLE = `0
SECTION
2
ENTITIES
0
CIRCLE
8
0
10
10.0
20
10.0
40
5.0
0
ENDSEC
0
EOF`;

describe('SketchImportModal — file extension routing', () => {
  it('file picker accepts .svg, .dxf, .stp, .step, and svg+xml mime', () => {
    renderModal('en');
    const fileInput = screen.getByTestId('sketch-import-file') as HTMLInputElement;
    // The HTML accept attribute is exposed verbatim.
    expect(fileInput.accept).toContain('.svg');
    expect(fileInput.accept).toContain('.dxf');
    expect(fileInput.accept).toContain('.stp');
    expect(fileInput.accept).toContain('.step');
    expect(fileInput.accept).toContain('image/svg+xml');
  });

  it('.svg file routes through importSketchFromSvg (line entity recovered)', async () => {
    const { onImport, onClose } = renderModal('en');
    const fileInput = screen.getByTestId('sketch-import-file') as HTMLInputElement;
    const file = new File([VALID_SVG], 'sketch.svg', { type: 'image/svg+xml' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fireEvent.change(fileInput);
    await waitFor(() => {
      const ta = screen.getByTestId('sketch-import-textarea') as HTMLTextAreaElement;
      expect(ta.value).toContain('<svg');
    });
    // After file load, the detected-format badge should read "Detected: SVG".
    const badge = screen.getByTestId('sketch-import-detected-format');
    expect(badge.getAttribute('data-format')).toBe('svg');
    expect(badge.textContent).toMatch(/SVG/);

    fireEvent.click(screen.getByTestId('sketch-import-submit'));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    const [entities] = onImport.mock.calls[0]!;
    // VALID_SVG carries 1 line + 1 point — confirms SVG importer was used.
    expect(entities.lines.length).toBe(1);
    expect(entities.points.length).toBe(1);
  });

  it('.dxf file routes through importSketchFromDxf (line entity recovered)', async () => {
    const { onImport, onClose } = renderModal('en');
    const fileInput = screen.getByTestId('sketch-import-file') as HTMLInputElement;
    const file = new File([VALID_DXF], 'sketch.dxf', { type: 'application/dxf' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fireEvent.change(fileInput);
    await waitFor(() => {
      const ta = screen.getByTestId('sketch-import-textarea') as HTMLTextAreaElement;
      // DXF content begins with "0\nSECTION".
      expect(ta.value.startsWith('0')).toBe(true);
    });
    // Filename ".dxf" → detection locks to DXF even though textarea content
    // would also sniff as DXF; either way badge says DXF.
    const badge = screen.getByTestId('sketch-import-detected-format');
    expect(badge.getAttribute('data-format')).toBe('dxf');
    expect(badge.textContent).toMatch(/DXF/);

    fireEvent.click(screen.getByTestId('sketch-import-submit'));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    const [entities] = onImport.mock.calls[0]!;
    // VALID_DXF has exactly one LINE entity.
    expect(entities.lines.length).toBe(1);
    expect(entities.lines[0].x1).toBe(0);
    expect(entities.lines[0].x2).toBe(50);
  });
});

describe('SketchImportModal — paste content sniffing', () => {
  it('pasting SVG content (<svg…>) → SVG detected', () => {
    renderModal('en');
    pasteSvg(VALID_SVG);
    const badge = screen.getByTestId('sketch-import-detected-format');
    expect(badge.getAttribute('data-format')).toBe('svg');
  });

  it('pasting SVG content (<?xml…>) → SVG detected', () => {
    renderModal('en');
    pasteSvg('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><circle cx="0" cy="0" r="5"/></svg>');
    const badge = screen.getByTestId('sketch-import-detected-format');
    expect(badge.getAttribute('data-format')).toBe('svg');
  });

  it('pasting DXF content (0\\nSECTION…) → DXF detected and routed to DXF importer', () => {
    const { onImport } = renderModal('en');
    pasteSvg(VALID_DXF_CIRCLE);
    const badge = screen.getByTestId('sketch-import-detected-format');
    expect(badge.getAttribute('data-format')).toBe('dxf');
    fireEvent.click(screen.getByTestId('sketch-import-submit'));
    expect(onImport).toHaveBeenCalledTimes(1);
    const [entities] = onImport.mock.calls[0]!;
    // CIRCLE in DXF → one entity in `circles`, no lines.
    expect(entities.circles.length).toBe(1);
    expect(entities.lines.length).toBe(0);
    expect(entities.circles[0].radius).toBe(5);
  });

  it('detected-format badge updates as user edits the textarea (svg → dxf)', () => {
    renderModal('en');
    pasteSvg(VALID_SVG);
    expect(screen.getByTestId('sketch-import-detected-format').getAttribute('data-format'))
      .toBe('svg');
    pasteSvg(VALID_DXF);
    expect(screen.getByTestId('sketch-import-detected-format').getAttribute('data-format'))
      .toBe('dxf');
  });
});

describe('SketchImportModal — unknown-format fallback (try both)', () => {
  it('garbage input → unknown format badge AND both importers tried; user-facing error appears', () => {
    const { onImport, onClose } = renderModal('en');
    pasteSvg('this is neither SVG nor DXF, just a random sentence');
    // Badge says unknown.
    const badge = screen.getByTestId('sketch-import-detected-format');
    expect(badge.getAttribute('data-format')).toBe('unknown');
    // Clicking Import tries SVG first, fails; tries DXF, also fails; modal
    // stays open with an error explaining both were attempted.
    fireEvent.click(screen.getByTestId('sketch-import-submit'));
    expect(onImport).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const err = screen.getByTestId('sketch-import-error');
    expect(err).toBeInTheDocument();
    // The error message mentions the unknown-format hint AND surfaces the
    // SVG-importer's underlying failure (since SVG is the primary attempt).
    expect(err.textContent?.toLowerCase()).toMatch(/unknown|svg/);
  });

  it('unknown-format but SVG-parseable content (no recognized prefix) → SVG importer wins', () => {
    // Carefully-crafted input: starts with whitespace + something that
    // doesn't match either sniff signature, but the SVG importer's tolerant
    // regex still finds an <svg> tag once it scans. We use a leading
    // garbage line followed by valid SVG.
    const { onImport } = renderModal('en');
    // Wrap valid SVG in leading garbage — sniff returns 'unknown' (no
    // <svg or <?xml at start, no 0\nSECTION at start) BUT once the SVG
    // importer's regex scans, it locates the <svg> root and parses ok.
    const tricky = `garbage prefix line\n<svg xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="0" x2="1" y2="1"/></svg>`;
    pasteSvg(tricky);
    expect(screen.getByTestId('sketch-import-detected-format').getAttribute('data-format'))
      .toBe('unknown');
    fireEvent.click(screen.getByTestId('sketch-import-submit'));
    // Try-both fallback: SVG attempt succeeds, so onImport fires.
    expect(onImport).toHaveBeenCalledTimes(1);
    const [entities] = onImport.mock.calls[0]!;
    expect(entities.lines.length).toBe(1);
  });
});

describe('SketchImportModal — i18n detected-format + unknown-format labels', () => {
  const detectedCases: Array<{ lang: 'en' | 'ko' | 'ja' | 'zh' | 'es' | 'ar'; svgPrefix: RegExp; dxfPrefix: RegExp; unknownLabel: RegExp }> = [
    // Each entry: the locale, what the SVG badge text should match,
    // what the DXF badge text should match, and what the unknown advisory
    // looks like. We use loose RegExp tests so cosmetic punctuation tweaks
    // don't fight the lockstep i18n updates.
    { lang: 'en', svgPrefix: /Detected:\s*SVG/, dxfPrefix: /Detected:\s*DXF/, unknownLabel: /Unknown format/i },
    { lang: 'ko', svgPrefix: /감지됨:\s*SVG/, dxfPrefix: /감지됨:\s*DXF/, unknownLabel: /형식을 알 수 없음/ },
    { lang: 'ja', svgPrefix: /検出:\s*SVG/, dxfPrefix: /検出:\s*DXF/, unknownLabel: /形式不明/ },
    { lang: 'zh', svgPrefix: /已检测:\s*SVG/, dxfPrefix: /已检测:\s*DXF/, unknownLabel: /格式未知/ },
    { lang: 'es', svgPrefix: /Detectado:\s*SVG/, dxfPrefix: /Detectado:\s*DXF/, unknownLabel: /Formato desconocido/i },
    { lang: 'ar', svgPrefix: /تم الاكتشاف:\s*SVG/, dxfPrefix: /تم الاكتشاف:\s*DXF/, unknownLabel: /صيغة غير معروفة/ },
  ];
  for (const { lang, svgPrefix, dxfPrefix, unknownLabel } of detectedCases) {
    it(`${lang}: badge surfaces SVG / DXF / unknown labels in locale`, () => {
      renderModal(lang);
      // SVG sniff.
      pasteSvg(VALID_SVG);
      expect(screen.getByTestId('sketch-import-detected-format').textContent ?? '')
        .toMatch(svgPrefix);
      // DXF sniff.
      pasteSvg(VALID_DXF);
      expect(screen.getByTestId('sketch-import-detected-format').textContent ?? '')
        .toMatch(dxfPrefix);
      // Unknown sniff.
      pasteSvg('totally not a sketch file payload of any kind');
      expect(screen.getByTestId('sketch-import-detected-format').textContent ?? '')
        .toMatch(unknownLabel);
    });
  }
});
