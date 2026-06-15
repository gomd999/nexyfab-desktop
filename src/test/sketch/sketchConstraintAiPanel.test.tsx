/** @vitest-environment jsdom */
/**
 * SketchConstraintAiPanel — Phase A standalone NL panel tests.
 *
 * Covers:
 *   - Renders panel with input + send button.
 *   - Send disabled when input empty / whitespace.
 *   - Successful regex detection → preview rendered + Apply enabled.
 *   - Apply invokes onApplyConstraints with intent, clears input + preview.
 *   - "Could not understand" status surfaces when regex fails.
 *   - selectionCounts feeds "Apply N horizontal constraints" preview.
 *   - fix_distance preview surfaces captured numeric value.
 *   - 6-lang label rendering smoke checks.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import SketchConstraintAiPanel from '@/app/[lang]/shape-generator/sketch/SketchConstraintAiPanel';
import { SELECTED_PLACEHOLDER } from '@/lib/ai/sketchConstraintIntent';

function typeInto(testId: string, value: string): void {
  const el = screen.getByTestId(testId) as HTMLTextAreaElement;
  fireEvent.change(el, { target: { value } });
}

describe('SketchConstraintAiPanel', () => {
  it('renders panel with input + send button', () => {
    render(
      <SketchConstraintAiPanel lang="en" onApplyConstraints={vi.fn()} />,
    );
    expect(screen.getByTestId('sketch-ai-panel')).toBeInTheDocument();
    expect(screen.getByTestId('sketch-ai-input')).toBeInTheDocument();
    expect(screen.getByTestId('sketch-ai-send')).toBeInTheDocument();
  });

  it('Send is disabled when input is empty', () => {
    render(
      <SketchConstraintAiPanel lang="en" onApplyConstraints={vi.fn()} />,
    );
    expect(screen.getByTestId('sketch-ai-send')).toBeDisabled();
  });

  it('Send stays disabled when input is whitespace only', () => {
    render(
      <SketchConstraintAiPanel lang="en" onApplyConstraints={vi.fn()} />,
    );
    typeInto('sketch-ai-input', '   ');
    expect(screen.getByTestId('sketch-ai-send')).toBeDisabled();
  });

  it('Send enables once non-whitespace input is typed', () => {
    render(
      <SketchConstraintAiPanel lang="en" onApplyConstraints={vi.fn()} />,
    );
    typeInto('sketch-ai-input', 'make all lines horizontal');
    expect(screen.getByTestId('sketch-ai-send')).not.toBeDisabled();
  });

  it('"make all lines horizontal" → preview rendered, Apply enabled', () => {
    render(
      <SketchConstraintAiPanel lang="en" onApplyConstraints={vi.fn()} />,
    );
    typeInto('sketch-ai-input', 'make all lines horizontal');
    fireEvent.click(screen.getByTestId('sketch-ai-send'));

    const preview = screen.getByTestId('sketch-ai-preview');
    expect(preview.textContent).toMatch(/horizontal/i);
    expect(screen.getByTestId('sketch-ai-apply')).not.toBeDisabled();
  });

  it('selectionCounts.lines feeds "Apply N horizontal constraints" preview', () => {
    render(
      <SketchConstraintAiPanel
        lang="en"
        onApplyConstraints={vi.fn()}
        selectionCounts={{ lines: 5 }}
      />,
    );
    typeInto('sketch-ai-input', 'make all lines horizontal');
    fireEvent.click(screen.getByTestId('sketch-ai-send'));

    expect(screen.getByTestId('sketch-ai-preview').textContent).toContain('5');
  });

  it('"set distance 50" → preview shows 50, intent carries distance', () => {
    const onApply = vi.fn();
    render(
      <SketchConstraintAiPanel lang="en" onApplyConstraints={onApply} />,
    );
    typeInto('sketch-ai-input', 'set distance 50');
    fireEvent.click(screen.getByTestId('sketch-ai-send'));

    expect(screen.getByTestId('sketch-ai-preview').textContent).toContain('50');

    fireEvent.click(screen.getByTestId('sketch-ai-apply'));
    expect(onApply).toHaveBeenCalledTimes(1);
    const intent = onApply.mock.calls[0]![0];
    expect(intent.kind).toBe('fix_distance');
    expect(intent.distance).toBe(50);
    expect(intent.pointAId).toBe(SELECTED_PLACEHOLDER);
    expect(intent.pointBId).toBe(SELECTED_PLACEHOLDER);
  });

  it('Apply clears the input and removes the preview', () => {
    const onApply = vi.fn();
    render(
      <SketchConstraintAiPanel lang="en" onApplyConstraints={onApply} />,
    );
    typeInto('sketch-ai-input', 'merge points');
    fireEvent.click(screen.getByTestId('sketch-ai-send'));
    expect(screen.getByTestId('sketch-ai-preview')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sketch-ai-apply'));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByTestId('sketch-ai-input') as HTMLTextAreaElement).value,
    ).toBe('');
    expect(screen.queryByTestId('sketch-ai-preview')).toBeNull();
  });

  it('Unrecognized prompt shows "Could not understand" status', () => {
    const onApply = vi.fn();
    render(
      <SketchConstraintAiPanel lang="en" onApplyConstraints={onApply} />,
    );
    typeInto('sketch-ai-input', 'banana cupcake fiesta');
    fireEvent.click(screen.getByTestId('sketch-ai-send'));

    const status = screen.getByTestId('sketch-ai-status');
    expect(status.textContent).toMatch(/could not understand/i);
    expect(screen.queryByTestId('sketch-ai-apply')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('renders Korean labels when lang="ko"', () => {
    render(
      <SketchConstraintAiPanel lang="ko" onApplyConstraints={vi.fn()} />,
    );
    // Panel title is rendered as the first label — query by text instead
    // of test-id since the title doesn't carry one.
    expect(screen.getByText('스케치 제약 AI')).toBeInTheDocument();
    expect(screen.getByText('전송')).toBeInTheDocument();
  });

  it('renders Japanese/Chinese/Spanish/Arabic labels (6-lang smoke)', () => {
    const langs: Array<['ja' | 'zh' | 'es' | 'ar', string]> = [
      ['ja', '送信'],
      ['zh', '发送'],
      ['es', 'Enviar'],
      ['ar', 'إرسال'],
    ];
    for (const [lang, sendLabel] of langs) {
      const { unmount } = render(
        <SketchConstraintAiPanel lang={lang} onApplyConstraints={vi.fn()} />,
      );
      expect(screen.getByText(sendLabel)).toBeInTheDocument();
      // Arabic panel should have RTL dir attribute.
      if (lang === 'ar') {
        expect(screen.getByTestId('sketch-ai-panel').getAttribute('dir')).toBe(
          'rtl',
        );
      } else {
        expect(screen.getByTestId('sketch-ai-panel').getAttribute('dir')).toBe(
          'ltr',
        );
      }
      unmount();
    }
  });
});
