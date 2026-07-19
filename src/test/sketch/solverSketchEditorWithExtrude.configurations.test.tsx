/** @vitest-environment jsdom */
/**
 * solverSketchEditorWithExtrude.configurations.test.tsx — W1-E R4 wiring.
 *
 * `ConfigurationsPanel` (sketch/) and `ConfigurationsManagerPanel`
 * (configurations/) were both fully implemented + unit-tested, but neither
 * had an importer outside its own test file — there was no route by which a
 * user could open them. This suite covers the toggle that closes that gap.
 *
 * What is actually being proven here (beyond "it renders"):
 *   - the panels MOUNT inside the real wrapper, not a bespoke harness — a
 *     lazy-import path or prop-shape mismatch would surface as a crash;
 *   - the two panels share ONE store: a config created in the manager
 *     appears as a row in the overlay panel;
 *   - the overlay panel's validation banner stays clear, i.e. the derived
 *     ConfigurationSet is well-formed against the live FeatureTree. This
 *     is the assertion that would catch the "master has no matching
 *     config entry" class of wiring bug.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import SolverSketchEditorWithExtrude from '@/app/[lang]/shape-generator/sketch/SolverSketchEditorWithExtrude';

async function mountReady(lang: 'en' | 'ko' = 'en') {
  render(<SolverSketchEditorWithExtrude lang={lang} extrudeFetcher={vi.fn()} />);
  const editor = await screen.findByTestId('solver-sketch-editor');
  await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
}

/** Open the panels and wait out the dynamic() chunk boundary. */
async function openConfigurations() {
  fireEvent.click(screen.getByTestId('solver-configurations-toggle'));
  await screen.findByTestId('solver-configurations-panel-host');
  await screen.findByTestId('configurations-manager-panel');
  await screen.findByTestId('configurations-panel');
}

describe('SolverSketchEditorWithExtrude — configurations wiring', () => {
  it('renders a configurations toggle, collapsed by default', async () => {
    await mountReady();
    expect(screen.getByTestId('solver-configurations-toggle')).toBeInTheDocument();
    // Default-off — the panels must not be mounted until asked for.
    expect(screen.queryByTestId('solver-configurations-panel-host')).toBeNull();
    expect(screen.queryByTestId('configurations-panel')).toBeNull();
  });

  it('mounts BOTH configuration panels when toggled on', async () => {
    await mountReady();
    await openConfigurations();
    expect(screen.getByTestId('configurations-manager-panel')).toBeInTheDocument();
    expect(screen.getByTestId('configurations-panel')).toBeInTheDocument();
  });

  it('starts on master with a clean validation banner', async () => {
    await mountReady();
    await openConfigurations();
    // Manager: no configs yet.
    expect(screen.getByTestId('cfgmgr-empty')).toBeInTheDocument();
    // Overlay panel: the derived set must still validate (master is
    // projected as a real zero-override configuration), so NO error banner.
    expect(screen.queryByTestId('configurations-error')).toBeNull();
    // Master row is the active one.
    const masterRow = screen.getByTestId('cfgmgr-row-master');
    expect(masterRow.textContent ?? '').toMatch(/Master/i);
  });

  it('shares one store: a config added in the manager appears in the overlay panel', async () => {
    await mountReady();
    await openConfigurations();

    // The manager is the only surface that can create a configuration.
    // Its add flow goes through window.prompt.
    const promptSpy = vi
      .spyOn(window, 'prompt')
      .mockReturnValue('Heavy Duty');

    fireEvent.click(screen.getByTestId('cfgmgr-add'));
    expect(promptSpy).toHaveBeenCalled();

    // Manager row appeared...
    await waitFor(() => {
      expect(screen.queryByTestId('cfgmgr-empty')).toBeNull();
    });

    // ...and the overlay panel, fed by the DERIVED set, shows it too.
    // This is the assertion that proves both panels read one store.
    await waitFor(() => {
      expect(screen.getByTestId('configurations-row-Heavy Duty')).toBeInTheDocument();
    });

    // Still valid against the live FeatureTree.
    expect(screen.queryByTestId('configurations-error')).toBeNull();

    promptSpy.mockRestore();
  });

  it('the overlay panel exposes a working Apply control', async () => {
    await mountReady();
    await openConfigurations();

    const apply = screen.getByTestId('configurations-apply') as HTMLButtonElement;
    // onApply is wired, so the button renders; the set validates, so it is
    // enabled rather than inert.
    expect(apply).toBeInTheDocument();
    expect(apply.disabled).toBe(false);

    // Applying the master config resolves to the (empty) tree and must not
    // throw — resolveActive throws when `active` names a missing config, so
    // a silent wiring bug would blow up right here.
    fireEvent.click(apply);
    expect(screen.getByTestId('configurations-panel')).toBeInTheDocument();
  });

  it('closes via the manager close chrome', async () => {
    await mountReady();
    await openConfigurations();
    fireEvent.click(screen.getByTestId('cfgmgr-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('solver-configurations-panel-host')).toBeNull();
    });
  });

  it('labels the toggle in Korean and English', async () => {
    await mountReady('en');
    expect(screen.getByTestId('solver-configurations-toggle').textContent ?? '')
      .toMatch(/Configurations/);
    screen.getByTestId('solver-configurations-toggle');

    // Remount in Korean.
    document.body.innerHTML = '';
    await mountReady('ko');
    const koToggles = screen.getAllByTestId('solver-configurations-toggle');
    expect(koToggles.some((b) => /구성/.test(b.textContent ?? ''))).toBe(true);
  });
});
