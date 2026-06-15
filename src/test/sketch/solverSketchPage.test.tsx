/** @vitest-environment jsdom */
/**
 * Solver sketch page content — basic render test.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/app/[lang]/shape-generator/sketch/SolverSketchEditorWithExtrude', () => ({
  default: ({ lang }: { lang: string }) => (
    <div data-testid="mocked-solver-editor" data-lang={lang}>
      mocked editor for {lang}
    </div>
  ),
}));

import { SolverSketchPageContent } from '@/app/[lang]/shape-generator/sketch/solver/_content';

describe('SolverSketchPageContent', () => {
  it('renders English heading + mounts the editor for lang=en', () => {
    render(<SolverSketchPageContent lang="en" />);
    expect(screen.getByText(/Solver Sketch \+ Extrude \(beta\)/)).toBeInTheDocument();
    expect(screen.getByTestId('mocked-solver-editor').getAttribute('data-lang')).toBe('en');
  });

  it('renders Korean heading for lang=ko', () => {
    render(<SolverSketchPageContent lang="ko" />);
    expect(screen.getByText(/Solver Sketch \+ Extrude \(베타\)/)).toBeInTheDocument();
    expect(screen.getByTestId('mocked-solver-editor').getAttribute('data-lang')).toBe('ko');
  });

  it('normalizes lang=cn to zh', () => {
    render(<SolverSketchPageContent lang="cn" />);
    expect(screen.getByTestId('mocked-solver-editor').getAttribute('data-lang')).toBe('zh');
  });

  it('falls back to en for unknown lang', () => {
    render(<SolverSketchPageContent lang="xx" />);
    expect(screen.getByTestId('mocked-solver-editor').getAttribute('data-lang')).toBe('en');
  });

  it('shows subtitle describing the pipeline', () => {
    render(<SolverSketchPageContent lang="en" />);
    expect(screen.getByText(/planegcs-backed/i)).toBeInTheDocument();
  });
});
