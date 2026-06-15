/** @vitest-environment jsdom */
/**
 * SketchEditor (v1.lite) — render-level regression for the sibling
 * sketch editor at `src/app/[lang]/shape-generator/sketch/SketchEditor.tsx`.
 *
 * Scope mirrors the brief: 4 tools (select/line/circle/rect), click-to-create
 * primitives, click-to-select, Delete-to-remove. Anything richer (snap,
 * constraints, undo, multi-profile) lives in the full SketchCanvas and is
 * NOT covered here — by design.
 *
 * jsdom note: SVGSVGElement.createSVGPoint / getScreenCTM are not
 * implemented in jsdom, so SketchEditor's coord helper falls back to
 * raw clientX/clientY. We pass clientX/clientY directly on every event.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import SketchEditor from '@/app/[lang]/shape-generator/sketch/SketchEditor';

function clickAt(el: Element, x: number, y: number): void {
  fireEvent.click(el, { clientX: x, clientY: y });
}

function moveAt(el: Element, x: number, y: number): void {
  fireEvent.mouseMove(el, { clientX: x, clientY: y });
}

describe('SketchEditor (v1.lite)', () => {
  it('renders 4 tool buttons and the canvas surface', () => {
    render(<SketchEditor lang="en" />);
    expect(screen.getByTestId('sketch-editor')).toBeInTheDocument();
    expect(screen.getByTestId('sketch-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('sketch-tool-select')).toBeInTheDocument();
    expect(screen.getByTestId('sketch-tool-line')).toBeInTheDocument();
    expect(screen.getByTestId('sketch-tool-circle')).toBeInTheDocument();
    expect(screen.getByTestId('sketch-tool-rect')).toBeInTheDocument();
  });

  it('line tool: click-click adds a line entity', () => {
    render(<SketchEditor lang="en" />);
    fireEvent.click(screen.getByTestId('sketch-tool-line'));
    const canvas = screen.getByTestId('sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 200, 200);

    const lines = Array.from(document.querySelectorAll('[data-testid^="sketch-entity-ln"]'));
    expect(lines.length).toBe(1);
    const line = lines[0]!;
    expect(line.tagName.toLowerCase()).toBe('line');
    expect(line.getAttribute('x1')).toBe('100');
    expect(line.getAttribute('y2')).toBe('200');
  });

  it('circle tool: click-click adds a circle entity with computed radius', () => {
    render(<SketchEditor lang="en" />);
    fireEvent.click(screen.getByTestId('sketch-tool-circle'));
    const canvas = screen.getByTestId('sketch-canvas');
    clickAt(canvas, 300, 300);    // center
    clickAt(canvas, 330, 340);    // radius = sqrt(30^2 + 40^2) = 50

    const circles = Array.from(document.querySelectorAll('[data-testid^="sketch-entity-cr"]'));
    expect(circles.length).toBe(1);
    const c = circles[0]!;
    expect(c.tagName.toLowerCase()).toBe('circle');
    expect(c.getAttribute('cx')).toBe('300');
    expect(c.getAttribute('cy')).toBe('300');
    expect(Number(c.getAttribute('r'))).toBeCloseTo(50, 5);
  });

  it('rect tool: click-click adds a rectangle (normalized x/y/w/h)', () => {
    render(<SketchEditor lang="en" />);
    fireEvent.click(screen.getByTestId('sketch-tool-rect'));
    const canvas = screen.getByTestId('sketch-canvas');
    // Click bottom-right first to confirm normalization.
    clickAt(canvas, 150, 220);
    clickAt(canvas, 50, 80);

    const rects = Array.from(document.querySelectorAll('[data-testid^="sketch-entity-rc"]'));
    expect(rects.length).toBe(1);
    const r = rects[0]!;
    expect(r.tagName.toLowerCase()).toBe('rect');
    expect(r.getAttribute('x')).toBe('50');
    expect(r.getAttribute('y')).toBe('80');
    expect(r.getAttribute('width')).toBe('100');
    expect(r.getAttribute('height')).toBe('140');
  });

  it('preview line follows cursor between first click and second click', () => {
    render(<SketchEditor lang="en" />);
    fireEvent.click(screen.getByTestId('sketch-tool-line'));
    const canvas = screen.getByTestId('sketch-canvas');
    clickAt(canvas, 10, 10);
    moveAt(canvas, 80, 60);

    // Preview is a dashed line; no entity committed yet.
    expect(document.querySelectorAll('[data-testid^="sketch-entity-"]').length).toBe(0);
    const dashed = Array.from(canvas.querySelectorAll('line')).filter(
      l => l.getAttribute('stroke-dasharray'),
    );
    expect(dashed.length).toBeGreaterThan(0);
  });

  it('select tool: clicking an entity selects it (aria-selected="true")', () => {
    render(<SketchEditor lang="en" />);
    // Create a circle first.
    fireEvent.click(screen.getByTestId('sketch-tool-circle'));
    const canvas = screen.getByTestId('sketch-canvas');
    clickAt(canvas, 200, 200);
    clickAt(canvas, 230, 240);

    // Switch to select and click the entity.
    fireEvent.click(screen.getByTestId('sketch-tool-select'));
    const entity = document.querySelector('[data-testid^="sketch-entity-cr"]')!;
    fireEvent.click(entity, { clientX: 200, clientY: 200 });
    expect(entity.getAttribute('aria-selected')).toBe('true');

    // Clicking empty canvas deselects.
    clickAt(canvas, 600, 500);
    expect(entity.getAttribute('aria-selected')).toBe('false');
  });

  it('Delete key removes the selected entity', () => {
    render(<SketchEditor lang="en" />);
    fireEvent.click(screen.getByTestId('sketch-tool-line'));
    const canvas = screen.getByTestId('sketch-canvas');
    clickAt(canvas, 10, 10);
    clickAt(canvas, 50, 50);
    expect(document.querySelectorAll('[data-testid^="sketch-entity-"]').length).toBe(1);

    fireEvent.click(screen.getByTestId('sketch-tool-select'));
    const entity = document.querySelector('[data-testid^="sketch-entity-ln"]')!;
    fireEvent.click(entity, { clientX: 30, clientY: 30 });
    expect(entity.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(screen.getByTestId('sketch-editor'), { key: 'Delete' });
    expect(document.querySelectorAll('[data-testid^="sketch-entity-"]').length).toBe(0);
  });

  it('switching tools clears any in-progress preview', () => {
    render(<SketchEditor lang="en" />);
    fireEvent.click(screen.getByTestId('sketch-tool-line'));
    const canvas = screen.getByTestId('sketch-canvas');
    clickAt(canvas, 10, 10);
    moveAt(canvas, 80, 60);

    // Switch tools.
    fireEvent.click(screen.getByTestId('sketch-tool-rect'));
    const dashed = Array.from(canvas.querySelectorAll('line, rect, circle')).filter(
      el => el.getAttribute('stroke-dasharray'),
    );
    expect(dashed.length).toBe(0);
  });

  it('renders i18n title in Korean when lang="ko"', () => {
    render(<SketchEditor lang="ko" />);
    expect(screen.getByText('스케치 (미리보기)')).toBeInTheDocument();
    const toolbar = screen.getByRole('toolbar');
    expect(within(toolbar).getByText('선')).toBeInTheDocument();
    expect(within(toolbar).getByText('원')).toBeInTheDocument();
    expect(within(toolbar).getByText('사각형')).toBeInTheDocument();
  });
});
