// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  ASSEMBLY_RIBBON_COMMAND_EVENT,
  dispatchAssemblyRibbonCommand,
  getAssemblyRibbonNavigation,
  isAssemblyRibbonCommandId,
} from './assemblyRibbonCommands';

describe('assembly ribbon command contract', () => {
  it('routes visible commands into the embedded assembly surface', () => {
    expect(getAssemblyRibbonNavigation('asm.insert')).toMatchObject({ task: 'parts' });
    expect(getAssemblyRibbonNavigation('mate.concentric')).toMatchObject({ task: 'mates' });
    expect(getAssemblyRibbonNavigation('asm.solve')).toMatchObject({ workspace: 'assembly', task: 'solve' });
    expect(getAssemblyRibbonNavigation('motion.drive')).toMatchObject({ openDetails: true });
    expect(getAssemblyRibbonNavigation('bom.export')).toMatchObject({ activateTarget: true });
  });

  it('rejects removed or unimplemented ribbon ids', () => {
    expect(isAssemblyRibbonCommandId('asm.replace')).toBe(false);
    expect(isAssemblyRibbonCommandId('asm.section')).toBe(false);
  });

  it('dispatches one typed browser event for a supported command', () => {
    const listener = vi.fn();
    window.addEventListener(ASSEMBLY_RIBBON_COMMAND_EVENT, listener);
    expect(dispatchAssemblyRibbonCommand('mate.distance')).toBe(true);
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ id: 'mate.distance' });
    expect(dispatchAssemblyRibbonCommand('asm.replace')).toBe(false);
    window.removeEventListener(ASSEMBLY_RIBBON_COMMAND_EVENT, listener);
  });
});
