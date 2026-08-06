export type NativeWorkerKind =
  | 'freecad-exchange'
  | 'ifc-native'
  | 'solidworks-native'
  | 'inventor-native'
  | 'catia-native'
  | 'creo-native'
  | 'parasolid-native'
  | 'dwg-exact'
  | 'revit-native';

export type NativeWorkerAvailability = 'local' | 'external-required';

export interface NativeWorkerRoute {
  workerKind: NativeWorkerKind;
  availability: NativeWorkerAvailability;
  nativeSemanticsRequired: boolean;
}

const ROUTES: Record<string, NativeWorkerRoute> = {
  step: { workerKind: 'freecad-exchange', availability: 'local', nativeSemanticsRequired: false },
  stp: { workerKind: 'freecad-exchange', availability: 'local', nativeSemanticsRequired: false },
  iges: { workerKind: 'freecad-exchange', availability: 'local', nativeSemanticsRequired: false },
  igs: { workerKind: 'freecad-exchange', availability: 'local', nativeSemanticsRequired: false },
  ifc: { workerKind: 'ifc-native', availability: 'local', nativeSemanticsRequired: true },
  sldasm: { workerKind: 'solidworks-native', availability: 'external-required', nativeSemanticsRequired: true },
  sldprt: { workerKind: 'solidworks-native', availability: 'external-required', nativeSemanticsRequired: true },
  iam: { workerKind: 'inventor-native', availability: 'external-required', nativeSemanticsRequired: true },
  ipt: { workerKind: 'inventor-native', availability: 'external-required', nativeSemanticsRequired: true },
  catproduct: { workerKind: 'catia-native', availability: 'external-required', nativeSemanticsRequired: true },
  catpart: { workerKind: 'catia-native', availability: 'external-required', nativeSemanticsRequired: true },
  asm: { workerKind: 'creo-native', availability: 'external-required', nativeSemanticsRequired: true },
  prt: { workerKind: 'creo-native', availability: 'external-required', nativeSemanticsRequired: true },
  x_t: { workerKind: 'parasolid-native', availability: 'external-required', nativeSemanticsRequired: false },
  x_b: { workerKind: 'parasolid-native', availability: 'external-required', nativeSemanticsRequired: false },
  dwg: { workerKind: 'dwg-exact', availability: 'external-required', nativeSemanticsRequired: false },
  rvt: { workerKind: 'revit-native', availability: 'external-required', nativeSemanticsRequired: true },
  rfa: { workerKind: 'revit-native', availability: 'external-required', nativeSemanticsRequired: true },
};

export const normalizeCadExtension = (value: string) => value.trim().toLowerCase().replace(/^\./, '');

export function routeNativeCadExtension(extension: string): NativeWorkerRoute | null {
  return ROUTES[normalizeCadExtension(extension)] ?? null;
}

export const supportedNativeCadExtensions = () => Object.keys(ROUTES).sort();
