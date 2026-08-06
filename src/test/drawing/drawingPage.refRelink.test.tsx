/** @vitest-environment jsdom */
/**
 * drawingPage.refRelink.test.tsx — R5 named-channel relink wiring on the
 * production drawing page.
 *
 * Reproduced loss path (실제 재현 경로): the pentagon prism has `e.vert.4`
 * but the cube does not (its profile has 4 vertices), so a dimension
 * authored on the pentagon against `e.vert.4` becomes an EXPLICIT
 * `unresolved-ref` loss on a pentagon → cube part switch. The page must:
 *
 *   1. show the ⚠ row a 재지정(Relink) button — only for unresolved-ref
 *      losses, never for other explicit failures (not-parallel etc., whose
 *      refs resolve fine);
 *   2. open the props-injected RefRelinkPanel with candidates ranked by
 *      distance to the ref's PRIOR anchor (pentagon topology, kept one part
 *      switch behind), honestly labelled: no confident candidate, distance
 *      ranking is approximate;
 *   3. on user-confirmed apply, substitute the ref (applyRelink), after
 *      which the dimension RE-MEASURES on render (= 50 on the cube) — the
 *      relink writes a name, never a value — and the audit-trail toast
 *      shows the applied record.
 *
 * Geometry numbers asserted below are derived from sampleGeometry.ts:
 *   pentagon: side 30 → R = 15/sin(36°) ≈ 25.5195, depth 40
 *     v4 = (R·cos288°, R·sin288°) ≈ (7.886, −24.271), e.vert.4 mid z = 20
 *     v2 = (R·cos144°, R·sin144°) ≈ (−20.646, 15.000)
 *     front-view span |v4.x − v2.x| ≈ 28.53
 *   cube: 50 mm — nearest 'e.*' edge to the prior anchor is e.vert.0
 *     (mid (0,0,25), dist ≈ 26.0 mm; runner-up e.bottom.0-1 ≈ 35.8 mm),
 *     and e.vert.0 ↔ e.vert.2 measures 50 in the front view.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
import { DrawingPageContent } from '@/app/[lang]/shape-generator/drawing/_content';

function mount(lang = 'en') {
  return render(<DrawingPageContent lang={lang} />);
}

function addDimension(ref0: string, ref1: string): void {
  fireEvent.click(screen.getByTestId('drawing-add-annotation-button'));
  fireEvent.change(screen.getByTestId('solver-dim-ref-0-input'), { target: { value: ref0 } });
  fireEvent.change(screen.getByTestId('solver-dim-ref-1-input'), { target: { value: ref1 } });
  fireEvent.click(screen.getByTestId('solver-dim-submit'));
}

describe('drawing page named-channel relink (R5)', () => {
  it('pentagon→cube loss: ⚠ row gets Relink, candidates are prior-anchor ranked and never confident, apply re-measures', () => {
    mount();

    // Author the dimension on the pentagon: e.vert.4 ↔ e.vert.2 (both exist).
    fireEvent.change(screen.getByTestId('drawing-part-select'), {
      target: { value: 'sample-pentagon' },
    });
    addDimension('e.vert.4', 'e.vert.2');

    // Measured for real on the pentagon — no ⚠, no relink button.
    let list = screen.getByTestId('drawing-page-annotation-list');
    expect(list.textContent).toContain('= 28.53');
    expect(list.textContent).not.toContain('⚠');
    expect(within(list).queryByRole('button', { name: 'Relink' })).toBeNull();

    // Part switch: cube has no e.vert.4 → explicit unresolved-ref loss.
    fireEvent.change(screen.getByTestId('drawing-part-select'), {
      target: { value: 'sample-cube' },
    });
    list = screen.getByTestId('drawing-page-annotation-list');
    expect(list.textContent).not.toContain('= 28.53');

    // Reference-review partition (260807): the unresolved dimension is
    // excluded from the rendered sheet and surfaces in the review queue,
    // which owns the Relink entry point (was: inline ⚠ row in the list).
    const review = screen.getByTestId('drawing-reference-review');
    expect(review.textContent).toContain('e.vert.4');
    fireEvent.click(within(review).getByRole('button', { name: 'Relink' }));
    const panel = screen.getByTestId('refrelink-panel');
    expect(panel.textContent).toContain('e.vert.4');

    // Honesty labels: no gate-confident candidate, distance-only ranking.
    expect(screen.getByTestId('refrelink-0-noconfident')).toBeTruthy();
    expect(screen.getByTestId('refrelink-0-approx')).toBeTruthy();

    // Prior-anchor ranking: nearest cube edge to pentagon e.vert.4's old
    // midpoint (7.886, −24.271, 20) is e.vert.0 (dist ≈ 26.0 mm) — and it
    // must NOT be promoted to confident (midpoint ranking is not the gate).
    const top = screen.getByTestId('refrelink-0-candidate-0');
    expect(top.textContent).toContain('e.vert.0');
    expect(top.getAttribute('data-confident')).toBe('false');
    // Kind filter: a lost edge ref is never offered a face substitute.
    expect(panel.textContent).not.toContain('f.side');
    expect(panel.textContent).not.toContain('f.cap');

    // User-confirmed apply → refs substituted, dimension re-measures.
    fireEvent.click(top);
    list = screen.getByTestId('drawing-page-annotation-list');
    expect(list.textContent).toContain('= 50'); // e.vert.0 ↔ e.vert.2 on the cube
    expect(list.textContent).not.toContain('⚠');
    expect(within(list).queryByRole('button', { name: 'Relink' })).toBeNull();

    // Panel unmounts itself (no lost refs left); audit toast shows the record.
    expect(screen.queryByTestId('refrelink-panel')).toBeNull();
    const toast = screen.getByTestId('drawing-relink-toast');
    expect(toast.textContent).toContain('e.vert.4 → e.vert.0');
    expect(toast.textContent).toContain('user-confirmed');
  });

  it('non-relinkable explicit failure (refs resolve, e.g. not-parallel) gets NO relink button', () => {
    mount();
    // Cube: f.side.3 ↔ f.side.1 measures 50 (associative suite baseline).
    addDimension('f.side.3', 'f.side.1');
    let list = screen.getByTestId('drawing-page-annotation-list');
    expect(list.textContent).toContain('= 50');

    // Cube → cylinder: both refs STILL resolve on the 16-gon prism but are
    // no longer parallel — an explicit refusal with nothing to relink.
    fireEvent.change(screen.getByTestId('drawing-part-select'), {
      target: { value: 'sample-cylinder' },
    });
    list = screen.getByTestId('drawing-page-annotation-list');
    expect(list.textContent).toContain('⚠');
    expect(within(list).queryByRole('button', { name: 'Relink' })).toBeNull();
  });
});
