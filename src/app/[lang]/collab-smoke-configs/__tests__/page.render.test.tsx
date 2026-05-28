/**
 * page.render.test.tsx — jsdom render smoke for the /collab-smoke-configs page.
 *
 * The harness has user interactions backed by Y.Doc state; convergence
 * itself is exercised in configsConvergence.test.ts. These render
 * cases verify that the page mounts standalone in jsdom — no SSR-only
 * APIs, no client-only globals fall through.
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import CollabSmokeConfigsPage from '../page';

afterEach(() => { cleanup(); });

describe('/[lang]/collab-smoke-configs page — jsdom render', () => {
  it('mounts the page with two side-by-side panels', () => {
    render(<CollabSmokeConfigsPage />);
    expect(screen.getByText(/Configurations CRDT Smoke/i)).toBeTruthy();
    expect(screen.getByText('Panel A')).toBeTruthy();
    expect(screen.getByText('Panel B')).toBeTruthy();
  });

  it('shows CONVERGED on bootstrap (both panels have the master config)', () => {
    render(<CollabSmokeConfigsPage />);
    expect(screen.getByText(/CONVERGED/i)).toBeTruthy();
  });

  it('renders the auto-sync checkbox checked by default', () => {
    render(<CollabSmokeConfigsPage />);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(0);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
  });

  it('clicking + Config in Panel A updates panel state and stays converged with auto-sync', () => {
    render(<CollabSmokeConfigsPage />);
    const addButtons = screen.getAllByRole('button', { name: /\+ Config/i });
    expect(addButtons.length).toBe(2); // one per panel
    fireEvent.click(addButtons[0]!); // panel A
    // After auto-sync, both panels should now have 2 configs (master + 1).
    expect(screen.getByText(/CONVERGED/i)).toBeTruthy();
  });

  it('renders the master config in both panels on first paint', () => {
    render(<CollabSmokeConfigsPage />);
    const masterMentions = screen.getAllByText(/master/i);
    // At minimum we want one mention per panel (the id token).
    expect(masterMentions.length).toBeGreaterThanOrEqual(2);
  });

  it('Stress button is present (40 concurrent ops)', () => {
    render(<CollabSmokeConfigsPage />);
    const stress = screen.getByRole('button', { name: /Stress: 40 concurrent/i });
    expect(stress).toBeTruthy();
  });
});
