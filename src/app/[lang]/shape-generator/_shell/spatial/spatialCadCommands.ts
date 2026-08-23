export const SPATIAL_CAD_COMMAND_EVENT = 'nexyfab:spatial-cad-command' as const;

export interface SpatialCadCommandDetail {
  id: string;
}

export function dispatchSpatialCadCommand(id: string): boolean {
  if (typeof window === 'undefined' || !id.startsWith('spatial.')) return false;
  window.dispatchEvent(new CustomEvent<SpatialCadCommandDetail>(SPATIAL_CAD_COMMAND_EVENT, { detail: { id } }));
  return true;
}

