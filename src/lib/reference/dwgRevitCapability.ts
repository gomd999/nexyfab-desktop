export type DwgRevitExecutor = 'autocad-com' | 'oda-file-converter' | 'revit-worker';

export interface DwgRevitRuntimeProbe {
  platform: string;
  registeredProgIds: string[];
  odaCommandConfigured: boolean;
  revitWorkerConfigured: boolean;
}

export interface DwgRevitCapabilityVerdict {
  executor: DwgRevitExecutor;
  status: 'ready' | 'not_run';
  reason: string;
  matchedProgId: string | null;
}

export function evaluateDwgRevitCapability(executor: DwgRevitExecutor, probe: DwgRevitRuntimeProbe): DwgRevitCapabilityVerdict {
  if (executor === 'oda-file-converter') {
    return probe.odaCommandConfigured
      ? { executor, status: 'ready', reason: 'oda_converter_command_configured', matchedProgId: null }
      : { executor, status: 'not_run', reason: 'oda_converter_command_unconfigured', matchedProgId: null };
  }
  if (executor === 'revit-worker') {
    return probe.revitWorkerConfigured
      ? { executor, status: 'ready', reason: 'revit_native_worker_configured', matchedProgId: null }
      : { executor, status: 'not_run', reason: 'revit_native_worker_unconfigured', matchedProgId: null };
  }
  if (probe.platform !== 'win32') return { executor, status: 'not_run', reason: 'autocad_com_requires_windows', matchedProgId: null };
  const matchedProgId = probe.registeredProgIds.find(item => item === 'AutoCAD.Application' || /^AutoCAD\.Application\.\d+$/.test(item)) ?? null;
  return matchedProgId
    ? { executor, status: 'ready', reason: 'autocad_com_registered', matchedProgId }
    : { executor, status: 'not_run', reason: 'autocad_com_unregistered', matchedProgId: null };
}
