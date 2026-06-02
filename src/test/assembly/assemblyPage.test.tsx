/** @vitest-environment jsdom */
/**
 * Assembly Browser route — page content tests.
 *
 * The Next.js page (page.tsx) just unwraps the params promise and renders
 * AssemblyBrowserPageContent — we test the _content.tsx component directly
 * with a plain `lang` string so jsdom doesn't have to deal with the
 * use(params) hook.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { AssemblyBrowserPageContent } from '@/app/[lang]/shape-generator/assembly/_content';
import { IDENTITY_QUAT, type AssemblyState } from '@/lib/assembly/assemblyState';

describe('AssemblyBrowserPageContent', () => {
  it('mounts the modal inside a page wrapper', () => {
    render(<AssemblyBrowserPageContent lang="en" onSolve={vi.fn()} />);
    expect(screen.getByTestId('solver-assembly-page')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-modal')).toBeInTheDocument();
  });

  it('default initial state has no parts and no mates', () => {
    render(<AssemblyBrowserPageContent lang="en" onSolve={vi.fn()} />);
    expect(screen.getByTestId('solver-assembly-parts-empty')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-mates-empty')).toBeInTheDocument();
  });

  it('respects the lang prop (en → English title)', () => {
    render(<AssemblyBrowserPageContent lang="en" onSolve={vi.fn()} />);
    expect(screen.getByTestId('solver-assembly-title').textContent).toMatch(
      /Assembly Browser/i,
    );
  });

  it('respects the lang prop (ko → Korean title)', () => {
    render(<AssemblyBrowserPageContent lang="ko" onSolve={vi.fn()} />);
    expect(screen.getByTestId('solver-assembly-title').textContent).toMatch(
      /어셈블리 브라우저/,
    );
  });

  it('normalizes unknown lang codes to English', () => {
    render(<AssemblyBrowserPageContent lang="xx" onSolve={vi.fn()} />);
    expect(screen.getByTestId('solver-assembly-title').textContent).toMatch(
      /Assembly Browser/i,
    );
  });

  it('renders a seeded initialState', () => {
    const seeded: AssemblyState = {
      parts: [
        {
          id: 'p1',
          name: 'P1',
          partTemplateId: 't',
          position: { x: 0, y: 0, z: 0 },
          orientation: IDENTITY_QUAT,
          fixed: true,
        },
      ],
      mates: [],
    };
    render(<AssemblyBrowserPageContent lang="en" initialState={seeded} onSolve={vi.fn()} />);
    expect(screen.getByTestId('solver-assembly-part-row-p1')).toBeInTheDocument();
  });
});
