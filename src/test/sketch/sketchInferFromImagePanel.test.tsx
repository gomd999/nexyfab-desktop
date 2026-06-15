/** @vitest-environment jsdom */
/**
 * SketchInferFromImagePanel — Phase 3.AI.UI standalone-panel tests.
 *
 * Coverage targets the public contract:
 *   - render shape (panel root + file input + phase1 note + infer button)
 *   - file picker → image preview <img> renders with the data URL
 *   - "Infer sketch" click → SVG preview shows up + shape count rendered
 *   - "Accept" click → onAccept fires with a SolverViewState shape
 *   - 8 MB oversize file → warning chip + infer button disabled
 *   - 6-language UI labels per `lang` prop
 *   - empty / no-file state: infer button disabled, accept button absent
 *   - infer button disabled until a file is picked
 *   - accept button respects the optional onAccept prop
 *   - SVG overlay encodes inferred entities (lines / circles / arcs)
 *   - oversize file still renders the <img> preview (so user can confirm
 *     what they tried to upload) but blocks inference
 *   - phase1 note is always rendered (deterministic mock fallback warning)
 *
 * jsdom note: FileReader IS available in jsdom but firing the change event
 * with a Blob doesn't automatically resolve readAsDataURL synchronously —
 * we await a microtask via waitFor before asserting downstream UI.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import React from 'react';
import SketchInferFromImagePanel from '@/app/[lang]/shape-generator/sketch/SketchInferFromImagePanel';
import { IMAGE_INFERENCE_MAX_SIZE } from '@/lib/ai/sketchInferenceFromImage';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';

// ─── helpers ─────────────────────────────────────────────────────────────

function renderPanel(
  lang: 'en' | 'ko' | 'ja' | 'zh' | 'es' | 'ar' = 'en',
  onAccept?: (s: SolverViewState) => void,
) {
  const onAcceptSpy =
    onAccept ?? vi.fn<(s: SolverViewState) => void>();
  render(<SketchInferFromImagePanel lang={lang} onAccept={onAcceptSpy} />);
  return { onAccept: onAcceptSpy };
}

/**
 * Build a tiny 1×1 PNG File of an arbitrary byte length. We don't need a
 * real PNG — the panel pipes the raw bytes through FileReader and into
 * `inferSketchFromImage` which, with no detector supplied, returns the
 * deterministic 4-corner fallback grid regardless of input content.
 */
function makeImageFile(bytes: number, name = 'test.png'): File {
  // Buffer of all zeros is fine for the test: jsdom's FileReader will
  // still produce a valid data URL prefix that our component renders.
  const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
  return new File([blob], name, { type: 'image/png' });
}

async function pickFile(file: File): Promise<void> {
  const input = screen.getByTestId('solver-sketch-infer-file-input') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    fireEvent.change(input);
  });
  // FileReader.readAsDataURL is async in jsdom — wait for the data URL to
  // propagate into state by polling for either the image preview (under-cap
  // path) OR the warning chip (oversize path). We accept either so the
  // helper works for both branches; callers that need a specific outcome
  // assert on it explicitly after the call returns.
  await waitFor(() => {
    const hasPreview = screen.queryByTestId('solver-sketch-infer-image-preview');
    const hasWarn = screen.queryByTestId('solver-sketch-infer-warning');
    if (!hasPreview && !hasWarn) {
      throw new Error('file pick has not propagated yet');
    }
  });
}

async function clickInferAndWait(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId('solver-sketch-infer-infer-button'));
  });
  await waitFor(() => {
    expect(screen.getByTestId('solver-sketch-infer-svg-preview')).toBeInTheDocument();
  });
}

afterEach(() => {
  cleanup();
});

// ─── render shape ────────────────────────────────────────────────────────

describe('SketchInferFromImagePanel — render shape', () => {
  it('renders the panel root with the expected testid', () => {
    renderPanel('en');
    expect(screen.getByTestId('solver-sketch-infer-panel')).toBeInTheDocument();
  });

  it('renders the file input with image/* accept', () => {
    renderPanel('en');
    const input = screen.getByTestId('solver-sketch-infer-file-input') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.accept).toContain('image/');
  });

  it('always renders the phase 1 note banner (mock fallback warning)', () => {
    renderPanel('en');
    expect(screen.getByTestId('solver-sketch-infer-phase1-note')).toBeInTheDocument();
  });

  it('renders the Infer button (disabled before a file is picked)', () => {
    renderPanel('en');
    const btn = screen.getByTestId('solver-sketch-infer-infer-button') as HTMLButtonElement;
    expect(btn).toBeInTheDocument();
    expect(btn.disabled).toBe(true);
  });

  it('does NOT render the SVG preview or Accept button before infer is clicked', () => {
    renderPanel('en');
    expect(screen.queryByTestId('solver-sketch-infer-svg-preview')).toBeNull();
    expect(screen.queryByTestId('solver-sketch-infer-accept-button')).toBeNull();
  });

  it('does NOT render the image preview before a file is picked', () => {
    renderPanel('en');
    expect(screen.queryByTestId('solver-sketch-infer-image-preview')).toBeNull();
  });
});

// ─── file picker → image preview ─────────────────────────────────────────

describe('SketchInferFromImagePanel — file picker', () => {
  it('selecting a small image renders the <img> preview with the data URL', async () => {
    renderPanel('en');
    const file = makeImageFile(64);
    await pickFile(file);
    await waitFor(() => {
      const img = screen.getByTestId('solver-sketch-infer-image-preview') as HTMLImageElement;
      expect(img).toBeInTheDocument();
      // FileReader.readAsDataURL produces a "data:image/png;base64,..." URL
      // in jsdom. We assert the prefix is present (don't rely on the exact
      // base64 body which is implementation-defined).
      expect(img.src.startsWith('data:image/png')).toBe(true);
    });
  });

  it('selecting a file enables the Infer button (was disabled)', async () => {
    renderPanel('en');
    await pickFile(makeImageFile(64));
    await waitFor(() => {
      const btn = screen.getByTestId('solver-sketch-infer-infer-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });

  it('image preview is capped to 240×240 via inline style', async () => {
    renderPanel('en');
    await pickFile(makeImageFile(64));
    await waitFor(() => {
      const img = screen.getByTestId('solver-sketch-infer-image-preview') as HTMLImageElement;
      expect(img.style.maxWidth).toBe('240px');
      expect(img.style.maxHeight).toBe('240px');
    });
  });
});

// ─── 8 MB oversize warning ───────────────────────────────────────────────

describe('SketchInferFromImagePanel — 8 MB oversize cap', () => {
  it('selecting an oversize file (>8 MB) shows a warning chip (not a throw)', async () => {
    renderPanel('en');
    // 8 MB + 1 byte triggers the cap. We use a value just over the cap so
    // jsdom doesn't have to allocate a giant ArrayBuffer.
    const file = makeImageFile(IMAGE_INFERENCE_MAX_SIZE + 1);
    await pickFile(file);
    await waitFor(() => {
      const warn = screen.getByTestId('solver-sketch-infer-warning');
      expect(warn).toBeInTheDocument();
      expect(warn.textContent).toMatch(/8/);
    });
  });

  it('oversize file disables the Infer button', async () => {
    renderPanel('en');
    await pickFile(makeImageFile(IMAGE_INFERENCE_MAX_SIZE + 1));
    await waitFor(() => {
      const btn = screen.getByTestId('solver-sketch-infer-infer-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  it('oversize file STILL renders the image preview (user can verify pick)', async () => {
    renderPanel('en');
    await pickFile(makeImageFile(IMAGE_INFERENCE_MAX_SIZE + 1));
    await waitFor(() => {
      expect(screen.getByTestId('solver-sketch-infer-image-preview')).toBeInTheDocument();
    });
  });

  it('under-cap file does NOT show the warning chip', async () => {
    renderPanel('en');
    await pickFile(makeImageFile(64));
    await waitFor(() => {
      expect(screen.getByTestId('solver-sketch-infer-image-preview')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('solver-sketch-infer-warning')).toBeNull();
  });
});

// ─── infer + accept flow ─────────────────────────────────────────────────

describe('SketchInferFromImagePanel — infer + accept flow', () => {
  it('clicking Infer renders the SVG preview', async () => {
    renderPanel('en');
    await pickFile(makeImageFile(64));
    await waitFor(() => {
      const btn = screen.getByTestId('solver-sketch-infer-infer-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    await clickInferAndWait();
    const svg = screen.getByTestId('solver-sketch-infer-svg-preview');
    expect(svg).toBeInTheDocument();
    expect(svg.tagName.toLowerCase()).toBe('svg');
  });

  it('Infer reveals the Accept button (was hidden before inference)', async () => {
    renderPanel('en');
    await pickFile(makeImageFile(64));
    await clickInferAndWait();
    expect(screen.getByTestId('solver-sketch-infer-accept-button')).toBeInTheDocument();
  });

  it('Infer renders the shape-count summary (fallback = 4 points)', async () => {
    renderPanel('en');
    await pickFile(makeImageFile(64));
    await clickInferAndWait();
    const count = screen.getByTestId('solver-sketch-infer-shape-count');
    // Phase 1 fallback emits exactly 4 corner points + 0 lines/circles/arcs.
    expect(count.textContent).toMatch(/4/);
  });

  it('SVG preview contains <circle> elements for the fallback 4 points', async () => {
    renderPanel('en');
    await pickFile(makeImageFile(64));
    await clickInferAndWait();
    const svg = screen.getByTestId('solver-sketch-infer-svg-preview');
    const circles = svg.querySelectorAll('circle');
    // Fallback emits 4 corner points; each renders as a filled <circle>.
    // (No real circles in fallback, so the count is purely from points.)
    expect(circles.length).toBeGreaterThanOrEqual(4);
  });

  it('clicking Accept fires onAccept with a SolverViewState shape', async () => {
    const onAccept = vi.fn<(s: SolverViewState) => void>();
    renderPanel('en', onAccept);
    await pickFile(makeImageFile(64));
    await clickInferAndWait();
    await act(async () => {
      fireEvent.click(screen.getByTestId('solver-sketch-infer-accept-button'));
    });
    expect(onAccept).toHaveBeenCalledTimes(1);
    const arg = onAccept.mock.calls[0]![0];
    expect(arg).toHaveProperty('points');
    expect(arg).toHaveProperty('lines');
    expect(Array.isArray(arg.points)).toBe(true);
    expect(Array.isArray(arg.lines)).toBe(true);
    // Fallback produces 4 corner points + 0 lines.
    expect(arg.points.length).toBe(4);
    expect(arg.lines.length).toBe(0);
    // Each forwarded point retains its id/x/y from the inferer.
    for (const p of arg.points) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.x).toBe('number');
      expect(typeof p.y).toBe('number');
    }
  });

  it('Accept button is rendered even when onAccept is omitted (disabled though)', async () => {
    // Mount WITHOUT onAccept to confirm the panel doesn't crash + the
    // accept button is still rendered (just inert).
    render(<SketchInferFromImagePanel lang="en" />);
    await pickFile(makeImageFile(64));
    await clickInferAndWait();
    const accept = screen.getByTestId('solver-sketch-infer-accept-button') as HTMLButtonElement;
    expect(accept).toBeInTheDocument();
    expect(accept.disabled).toBe(true);
  });
});

// ─── 6-language i18n ─────────────────────────────────────────────────────

describe('SketchInferFromImagePanel — 6-language i18n', () => {
  it('renders English labels for lang="en"', () => {
    renderPanel('en');
    expect(screen.getByTestId('solver-sketch-infer-panel').textContent).toContain('Infer sketch from image');
    expect(screen.getByTestId('solver-sketch-infer-infer-button').textContent).toContain('Infer sketch');
  });

  it('renders Korean labels for lang="ko"', () => {
    renderPanel('ko');
    expect(screen.getByTestId('solver-sketch-infer-panel').textContent).toContain('이미지에서');
    expect(screen.getByTestId('solver-sketch-infer-infer-button').textContent).toContain('추론');
  });

  it('renders Japanese labels for lang="ja"', () => {
    renderPanel('ja');
    expect(screen.getByTestId('solver-sketch-infer-panel').textContent).toContain('画像');
    expect(screen.getByTestId('solver-sketch-infer-infer-button').textContent).toContain('推論');
  });

  it('renders Chinese labels for lang="zh"', () => {
    renderPanel('zh');
    expect(screen.getByTestId('solver-sketch-infer-panel').textContent).toContain('图像');
    expect(screen.getByTestId('solver-sketch-infer-infer-button').textContent).toContain('推断');
  });

  it('renders Spanish labels for lang="es"', () => {
    renderPanel('es');
    expect(screen.getByTestId('solver-sketch-infer-panel').textContent).toContain('Inferir');
    expect(screen.getByTestId('solver-sketch-infer-infer-button').textContent).toContain('Inferir');
  });

  it('renders Arabic labels and RTL dir for lang="ar"', () => {
    renderPanel('ar');
    const panel = screen.getByTestId('solver-sketch-infer-panel');
    expect(panel.textContent).toContain('استنتاج');
    expect(panel.getAttribute('dir')).toBe('rtl');
  });

  it('non-ar languages render LTR dir', () => {
    renderPanel('en');
    expect(screen.getByTestId('solver-sketch-infer-panel').getAttribute('dir')).toBe('ltr');
  });

  it('phase1 note translates per language', () => {
    renderPanel('ko');
    expect(screen.getByTestId('solver-sketch-infer-phase1-note').textContent).toMatch(/Phase 1|페이즈/i);
  });

  it('oversize warning text translates per language', async () => {
    renderPanel('ko');
    await pickFile(makeImageFile(IMAGE_INFERENCE_MAX_SIZE + 1));
    await waitFor(() => {
      const warn = screen.getByTestId('solver-sketch-infer-warning');
      expect(warn.textContent).toMatch(/8MB|초과/);
    });
  });
});
