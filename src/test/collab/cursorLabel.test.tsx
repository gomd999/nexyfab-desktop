/** @vitest-environment jsdom */
/**
 * CursorLabel — rendering tests.
 *
 * Covers:
 *   - userId rendered as visible text when no name override is provided
 *   - explicit `name` overrides the userId in the rendered text
 *   - transform encodes the position as `translate(Xpx, Ypx)`
 *   - colour is applied to the background
 *   - testid follows `cursor-label-{userId}`
 *   - aria-hidden + pointer-events: none (a11y / non-interactive)
 *   - className passthrough
 *   - data-user-id + data-color exposed for outer queries
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { CursorLabel } from '@/app/[lang]/shape-generator/_shared/CursorLabel';

afterEach(() => cleanup());

describe('CursorLabel — text content', () => {
  it('renders the userId as visible text by default', () => {
    render(<CursorLabel userId="alice" color="#10b981" position={{ x: 0, y: 0 }} />);
    const el = screen.getByTestId('cursor-label-alice');
    expect(el).toBeInTheDocument();
    expect(el.textContent).toBe('alice');
  });

  it('explicit name overrides the userId in rendered text', () => {
    render(
      <CursorLabel
        userId="alice"
        name="Alice Park"
        color="#10b981"
        position={{ x: 0, y: 0 }}
      />,
    );
    expect(screen.getByTestId('cursor-label-alice').textContent).toBe('Alice Park');
  });
});

describe('CursorLabel — positioning', () => {
  it('applies translate(x, y) via transform', () => {
    render(<CursorLabel userId="alice" color="#3b82f6" position={{ x: 123, y: 45 }} />);
    const el = screen.getByTestId('cursor-label-alice');
    expect(el.style.transform).toBe('translate(123px, 45px)');
  });

  it('zero coordinates render at the origin', () => {
    render(<CursorLabel userId="alice" color="#3b82f6" position={{ x: 0, y: 0 }} />);
    expect(screen.getByTestId('cursor-label-alice').style.transform).toBe(
      'translate(0px, 0px)',
    );
  });

  it('negative coordinates are preserved verbatim', () => {
    render(
      <CursorLabel userId="alice" color="#3b82f6" position={{ x: -10, y: -5 }} />,
    );
    expect(screen.getByTestId('cursor-label-alice').style.transform).toBe(
      'translate(-10px, -5px)',
    );
  });
});

describe('CursorLabel — styling', () => {
  it('background colour is the supplied color prop', () => {
    render(<CursorLabel userId="bob" color="#ef4444" position={{ x: 1, y: 2 }} />);
    const el = screen.getByTestId('cursor-label-bob');
    expect(el.style.background).toBe('rgb(239, 68, 68)');
    expect(el.getAttribute('data-color')).toBe('#ef4444');
  });

  it('exposes data-user-id for outer queries', () => {
    render(<CursorLabel userId="carol" color="#10b981" position={{ x: 0, y: 0 }} />);
    expect(
      screen.getByTestId('cursor-label-carol').getAttribute('data-user-id'),
    ).toBe('carol');
  });
});

describe('CursorLabel — a11y / passthrough', () => {
  it('is aria-hidden — peer labels do not pollute the screen reader stream', () => {
    render(<CursorLabel userId="alice" color="#10b981" position={{ x: 0, y: 0 }} />);
    expect(screen.getByTestId('cursor-label-alice').getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('is pointer-events: none — never intercepts clicks on the viewport', () => {
    render(<CursorLabel userId="alice" color="#10b981" position={{ x: 0, y: 0 }} />);
    expect(screen.getByTestId('cursor-label-alice').style.pointerEvents).toBe('none');
  });

  it('className passes through to the element', () => {
    render(
      <CursorLabel
        userId="alice"
        color="#10b981"
        position={{ x: 0, y: 0 }}
        className="my-label"
      />,
    );
    expect(screen.getByTestId('cursor-label-alice').className).toBe('my-label');
  });
});
