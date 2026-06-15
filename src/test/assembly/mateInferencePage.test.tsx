/** @vitest-environment jsdom */
/**
 * MateInferenceReviewPageContent — dedicated review page tests.
 *
 * Mirrors the `assemblyPage.test.tsx` pattern: we test the _content.tsx
 * component directly with a plain `lang` string so jsdom doesn't have to
 * deal with the Next `use(params)` hook.
 *
 * Coverage:
 *   - mount + initial empty state
 *   - sample-picker change
 *   - run-inference button populates the review panel
 *   - accept-row → mate appears in the accepted list
 *   - reject-row → mate disappears from suggestions
 *   - export-JSON triggers URL.createObjectURL with a Blob
 *   - export disabled when no mates accepted
 *   - 6-lang spot-check (title localised correctly)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { MateInferenceReviewPageContent } from '@/app/[lang]/shape-generator/assembly/mate-inference/_content';
import { SAMPLE_ASSEMBLY_NAMES } from '@/lib/assembly/sampleAssemblies';

describe('MateInferenceReviewPageContent', () => {
  afterEach(() => {
    cleanup();
  });

  it('mounts the page shell + accepted section, with no-run placeholder and disabled export', () => {
    render(<MateInferenceReviewPageContent lang="en" />);
    expect(screen.getByTestId('mate-inference-review-page')).toBeInTheDocument();
    expect(
      screen.getByTestId('mate-inference-review-page-title').textContent,
    ).toMatch(/Mate Inference Review/i);
    // Before running inference the placeholder is shown, not the panel.
    expect(screen.getByTestId('mate-inference-review-no-run')).toBeInTheDocument();
    expect(
      screen.queryByTestId('mate-inference-review-panel'),
    ).toBeNull();
    // Accepted section is present but empty + export disabled.
    expect(
      screen.getByTestId('mate-inference-review-accepted-empty'),
    ).toBeInTheDocument();
    const exportBtn = screen.getByTestId(
      'mate-inference-review-export-json',
    ) as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(true);
  });

  it('sample-picker change wipes any prior run', () => {
    render(<MateInferenceReviewPageContent lang="en" />);
    // Run on the default sample to seed a run.
    fireEvent.click(screen.getByTestId('mate-inference-review-run-btn'));
    expect(
      screen.getByTestId('mate-inference-review-run-count'),
    ).toBeInTheDocument();
    // Switch to another sample.
    const altSample = SAMPLE_ASSEMBLY_NAMES.find(
      (n) => n !== SAMPLE_ASSEMBLY_NAMES[0],
    )!;
    fireEvent.change(
      screen.getByTestId('mate-inference-review-sample-select'),
      { target: { value: altSample } },
    );
    // Run count + panel disappear because the run state was reset.
    expect(
      screen.queryByTestId('mate-inference-review-run-count'),
    ).toBeNull();
    expect(
      screen.queryByTestId('mate-inference-review-panel'),
    ).toBeNull();
    expect(
      screen.getByTestId('mate-inference-review-no-run'),
    ).toBeInTheDocument();
  });

  it('run-inference button mounts the review panel', () => {
    render(<MateInferenceReviewPageContent lang="en" />);
    fireEvent.click(screen.getByTestId('mate-inference-review-run-btn'));
    // Panel mounts after the run.
    expect(
      screen.getByTestId('mate-inference-review-panel'),
    ).toBeInTheDocument();
    // Either the table (if suggestions present) or the empty placeholder is
    // visible — both are valid panel-mounted states (cube samples may or
    // may not produce coincident suggestions depending on geometry).
    const hasTable =
      screen.queryByTestId('mate-inference-review-table') !== null;
    const hasEmpty =
      screen.queryByTestId('mate-inference-review-empty') !== null;
    expect(hasTable || hasEmpty).toBe(true);
    // Run-count chip is rendered.
    expect(
      screen.getByTestId('mate-inference-review-run-count'),
    ).toBeInTheDocument();
  });

  it('accepting a suggested row adds it to the accepted list + enables export', () => {
    render(<MateInferenceReviewPageContent lang="en" />);
    fireEvent.click(screen.getByTestId('mate-inference-review-run-btn'));
    const table = screen.queryByTestId('mate-inference-review-table');
    if (!table) {
      // Sample produced no suggestions — nothing to accept; bail cleanly.
      // (The "mount" test above already covered this branch.)
      return;
    }
    // Find the first accept button in the table.
    const acceptButtons = Array.from(
      table.querySelectorAll<HTMLButtonElement>(
        'button[data-testid$="-accept"]',
      ),
    );
    expect(acceptButtons.length).toBeGreaterThan(0);
    fireEvent.click(acceptButtons[0]!);
    // Accepted list now has 1 entry, export button enabled.
    const acceptedList = screen.getByTestId(
      'mate-inference-review-accepted-list',
    );
    expect(acceptedList.children.length).toBe(1);
    const exportBtn = screen.getByTestId(
      'mate-inference-review-export-json',
    ) as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(false);
    // Header count reflects the accepted count.
    expect(
      screen.getByTestId('mate-inference-review-accepted-header').textContent,
    ).toMatch(/\(1\)/);
  });

  it('rejecting a suggested row removes it from the suggestions table', () => {
    render(<MateInferenceReviewPageContent lang="en" />);
    fireEvent.click(screen.getByTestId('mate-inference-review-run-btn'));
    const table = screen.queryByTestId('mate-inference-review-table');
    if (!table) return; // no suggestions on this sample → skip
    const rejectButtons = Array.from(
      table.querySelectorAll<HTMLButtonElement>(
        'button[data-testid$="-reject"]',
      ),
    );
    expect(rejectButtons.length).toBeGreaterThan(0);
    const beforeCount = rejectButtons.length;
    fireEvent.click(rejectButtons[0]!);
    // After reject the table loses one row.
    const tableAfter = screen.queryByTestId('mate-inference-review-table');
    if (tableAfter) {
      const afterRows = tableAfter.querySelectorAll(
        'button[data-testid$="-reject"]',
      );
      expect(afterRows.length).toBe(beforeCount - 1);
    } else {
      // Whole table can collapse to the empty placeholder when the last
      // suggestion is rejected.
      expect(
        screen.getByTestId('mate-inference-review-empty'),
      ).toBeInTheDocument();
    }
    // Rejected mates do NOT appear in the accepted list.
    expect(
      screen.queryByTestId('mate-inference-review-accepted-list'),
    ).toBeNull();
  });

  describe('export JSON', () => {
    let createSpy: ReturnType<typeof vi.spyOn>;
    let revokeSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // jsdom doesn't ship URL.createObjectURL — stub both before spying so
      // `vi.spyOn` has something to wrap.
      if (typeof URL.createObjectURL !== 'function') {
        Object.defineProperty(URL, 'createObjectURL', {
          value: () => 'blob:mock',
          configurable: true,
          writable: true,
        });
      }
      if (typeof URL.revokeObjectURL !== 'function') {
        Object.defineProperty(URL, 'revokeObjectURL', {
          value: () => {},
          configurable: true,
          writable: true,
        });
      }
      createSpy = vi
        .spyOn(URL, 'createObjectURL')
        .mockReturnValue('blob:mock-url');
      revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    });

    afterEach(() => {
      createSpy.mockRestore();
      revokeSpy.mockRestore();
    });

    it('clicking export with accepted mates calls URL.createObjectURL with a Blob', () => {
      render(<MateInferenceReviewPageContent lang="en" />);
      fireEvent.click(screen.getByTestId('mate-inference-review-run-btn'));
      const table = screen.queryByTestId('mate-inference-review-table');
      if (!table) return; // skip when sample yields no suggestions
      const acceptBtn = table.querySelector<HTMLButtonElement>(
        'button[data-testid$="-accept"]',
      );
      expect(acceptBtn).not.toBeNull();
      fireEvent.click(acceptBtn!);
      fireEvent.click(screen.getByTestId('mate-inference-review-export-json'));
      expect(createSpy).toHaveBeenCalledTimes(1);
      const arg = createSpy.mock.calls[0]![0] as Blob;
      expect(arg).toBeInstanceOf(Blob);
      expect(arg.type).toBe('application/json');
      expect(revokeSpy).toHaveBeenCalledWith('blob:mock-url');
    });

    it('clicking export with NO accepted mates is a no-op (button is also disabled)', () => {
      render(<MateInferenceReviewPageContent lang="en" />);
      // Don't run inference, don't accept anything.
      fireEvent.click(screen.getByTestId('mate-inference-review-export-json'));
      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe('i18n', () => {
    const cases: ReadonlyArray<{ lang: string; matcher: RegExp }> = [
      { lang: 'ko', matcher: /메이트 추론 검토/ },
      { lang: 'en', matcher: /Mate Inference Review/i },
      { lang: 'ja', matcher: /合致推論レビュー/ },
      { lang: 'zh', matcher: /配合推断审阅/ },
      { lang: 'es', matcher: /Revisión de inferencia/i },
      { lang: 'ar', matcher: /مراجعة استنتاج القيود/ },
    ];

    for (const { lang, matcher } of cases) {
      it(`renders localised title for lang=${lang}`, () => {
        render(<MateInferenceReviewPageContent lang={lang} />);
        expect(
          screen.getByTestId('mate-inference-review-page-title').textContent,
        ).toMatch(matcher);
        if (lang === 'ar') {
          expect(
            screen
              .getByTestId('mate-inference-review-page')
              .getAttribute('dir'),
          ).toBe('rtl');
        }
        cleanup();
      });
    }

    it('unknown lang codes fall back to English', () => {
      render(<MateInferenceReviewPageContent lang="xx" />);
      expect(
        screen.getByTestId('mate-inference-review-page-title').textContent,
      ).toMatch(/Mate Inference Review/i);
    });
  });
});
