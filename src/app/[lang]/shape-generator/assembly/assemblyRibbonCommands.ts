export const ASSEMBLY_RIBBON_COMMAND_EVENT = 'nexyfab:assembly-ribbon-command';

export type AssemblyRibbonCommandId =
  | 'asm.insert'
  | 'mate.coincident'
  | 'mate.concentric'
  | 'mate.distance'
  | 'mate.angle'
  | 'mate.hinge'
  | 'mate.gear'
  | 'mate.limitDistance'
  | 'mate.width'
  | 'asm.solve'
  | 'motion.drive'
  | 'asm.interference'
  | 'bom.show'
  | 'bom.export';

export type AssemblyRibbonCommandDetail = {
  id: AssemblyRibbonCommandId;
};

export type AssemblyRibbonNavigation = {
  workspace: 'assembly' | 'verify';
  task: 'parts' | 'mates' | 'solve';
  targetTestId: string;
  activateTarget?: boolean;
  openDetails?: boolean;
};

export function getAssemblyRibbonNavigation(id: AssemblyRibbonCommandId): AssemblyRibbonNavigation {
  if (id === 'asm.insert') {
    return { workspace: 'assembly', task: 'parts', targetTestId: 'solver-assembly-add-part' };
  }
  if (id.startsWith('mate.')) {
    return { workspace: 'assembly', task: 'mates', targetTestId: 'solver-assembly-add-mate' };
  }
  if (id === 'asm.solve') {
    return { workspace: 'assembly', task: 'solve', targetTestId: 'solver-assembly-task-solve' };
  }
  if (id === 'motion.drive') {
    return { workspace: 'verify', task: 'solve', targetTestId: 'solver-assembly-motion-tools', openDetails: true };
  }
  if (id === 'asm.interference') {
    return { workspace: 'verify', task: 'solve', targetTestId: 'solver-assembly-commercial-verify' };
  }
  return {
    workspace: 'assembly',
    task: 'parts',
    targetTestId: 'solver-assembly-export-bom',
    activateTarget: true,
  };
}

export function dispatchAssemblyRibbonCommand(id: string): boolean {
  if (typeof window === 'undefined' || !isAssemblyRibbonCommandId(id)) return false;
  window.dispatchEvent(new CustomEvent<AssemblyRibbonCommandDetail>(
    ASSEMBLY_RIBBON_COMMAND_EVENT,
    { detail: { id } },
  ));
  return true;
}

const IDS: ReadonlySet<string> = new Set<AssemblyRibbonCommandId>([
  'asm.insert',
  'mate.coincident',
  'mate.concentric',
  'mate.distance',
  'mate.angle',
  'mate.hinge',
  'mate.gear',
  'mate.limitDistance',
  'mate.width',
  'asm.solve',
  'motion.drive',
  'asm.interference',
  'bom.show',
  'bom.export',
]);

export function isAssemblyRibbonCommandId(value: string): value is AssemblyRibbonCommandId {
  return IDS.has(value);
}
