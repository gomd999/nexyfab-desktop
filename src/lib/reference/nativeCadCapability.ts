export type NativeCadExecutor = 'solidworks-com' | 'inventor-com' | 'parasolid-cad-exchanger' | 'creo-or-solid-edge-native' | 'catia-com-or-cad-exchanger';
export interface NativeCadRuntimeProbe { platform: string; registeredProgIds: string[]; exchangerConfigured: boolean; }
export interface NativeCadCapabilityVerdict { executor: NativeCadExecutor; status: 'ready' | 'not_run'; reason: string; matchedProgId: string | null; }

const PROG_IDS: Record<NativeCadExecutor, string[]> = {
  'solidworks-com': ['SldWorks.Application'],
  'inventor-com': ['Inventor.Application'],
  'parasolid-cad-exchanger': [],
  'creo-or-solid-edge-native': ['SolidEdge.Application', 'Creo.Application'],
  'catia-com-or-cad-exchanger': ['CATIA.Application'],
};

export function evaluateNativeCadCapability(executor: NativeCadExecutor, probe: NativeCadRuntimeProbe): NativeCadCapabilityVerdict {
  if (probe.platform !== 'win32') return { executor, status: 'not_run', reason: 'native_cad_com_requires_windows', matchedProgId: null };
  const matchedProgId = PROG_IDS[executor].find(item => probe.registeredProgIds.includes(item)) ?? null;
  if (matchedProgId) return { executor, status: 'ready', reason: 'native_cad_com_registered', matchedProgId };
  if (probe.exchangerConfigured && ['parasolid-cad-exchanger', 'catia-com-or-cad-exchanger'].includes(executor)) return { executor, status: 'ready', reason: 'licensed_cad_exchanger_configured', matchedProgId: null };
  return { executor, status: 'not_run', reason: executor.includes('exchanger') ? 'native_cad_or_licensed_exchanger_unavailable' : 'native_cad_com_unregistered', matchedProgId: null };
}
