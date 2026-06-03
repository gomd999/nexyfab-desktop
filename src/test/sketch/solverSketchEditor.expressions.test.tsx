/** @vitest-environment jsdom */
/**
 * SolverSketchEditor + Variables (sketchExpressions) panel integration.
 *
 * Verifies the title-bar "Variables" toggle wires the standalone
 * SketchExpressionsPanel into the editor: default OFF, ON mounts the
 * wrapper, OFF unmounts it, label is localised. The panel's own behaviour
 * is covered by sketchExpressionsPanel.test.tsx.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import SolverSketchEditor, {
  type EditorLang,
} from '@/app/[lang]/shape-generator/sketch/SolverSketchEditor';

async function mountReady(lang: EditorLang = 'en'): Promise<HTMLElement> {
  render(<SolverSketchEditor lang={lang} />);
  const editor = await screen.findByTestId('solver-sketch-editor');
  await waitFor(
    () => expect(editor.getAttribute('data-state')).toBe('ready'),
    { timeout: 10000 },
  );
  return editor;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SolverSketchEditor + Variables panel integration', () => {
  it('Variables toggle is visible and starts OFF (panel not mounted)', async () => {
    await mountReady();
    const toggle = screen.getByTestId('solver-sketch-expressions-toggle') as HTMLButtonElement;
    expect(toggle).toBeInTheDocument();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('solver-sketch-expressions-panel-wrapper')).toBeNull();
  });

  it('ON mounts the panel wrapper + panel; OFF unmounts it', async () => {
    await mountReady();
    const toggle = screen.getByTestId('solver-sketch-expressions-toggle');

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(screen.getByTestId('solver-sketch-expressions-panel-wrapper')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('solver-sketch-expressions-panel')).toBeInTheDocument();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(screen.queryByTestId('solver-sketch-expressions-panel-wrapper')).toBeNull(),
    );
  });

  it('toggle label is localised (ko = 변수, en = Variables)', async () => {
    await mountReady('ko');
    expect(screen.getByTestId('solver-sketch-expressions-toggle').textContent ?? '').toMatch(/변수/);
    cleanup();
    await mountReady('en');
    expect(screen.getByTestId('solver-sketch-expressions-toggle').textContent ?? '').toMatch(/Variables/);
  });

  it('evaluated row exposes an Apply button, disabled with no constraint selected', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-expressions-toggle'));
    await waitFor(() =>
      expect(screen.getByTestId('solver-sketch-expressions-panel')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('solver-sketch-expressions-add'));
    const nameInput = document.querySelector(
      '[data-testid^="solver-sketch-expressions-name-"]',
    ) as HTMLInputElement;
    const defInput = document.querySelector(
      '[data-testid^="solver-sketch-expressions-def-"]',
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'w' } });
    fireEvent.change(defInput, { target: { value: '50' } });
    fireEvent.click(screen.getByTestId('solver-sketch-expressions-evaluate'));
    const apply = document.querySelector(
      '[data-testid^="solver-sketch-expressions-apply-"]',
    ) as HTMLButtonElement | null;
    expect(apply).not.toBeNull();
    // No dimensional constraint is selected → Apply is gated off.
    expect(apply!.disabled).toBe(true);
  });
});
