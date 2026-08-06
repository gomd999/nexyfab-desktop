import type { MountingInterface } from './componentCatalog';
import type { Mate } from '@/lib/assembly/mate';

export type MechanicalInterface = { id: string; parentPartId: string; componentPartId: string; parent: MountingInterface; component: MountingInterface; fit: 'clearance' | 'transition' | 'press'; fitAllowanceMm: number };
export function compileMechanicalInterface(i: MechanicalInterface): { mates: Mate[]; intendedContact?: { partA: string; partB: string; justification: string } } {
  if (i.parentPartId === i.componentPartId) throw new Error('interface requires different parts');
  if (i.fit === 'press' && !(i.fitAllowanceMm > 0)) throw new Error('press fit requires positive interference');
  const axis = (partId: string, refId: string) => ({ partId, refId, refKind: 'axis' as const });
  const plane = (partId: string, refId: string) => ({ partId, refId, refKind: 'plane' as const });
  return { mates: [
    { id: `${i.id}:axis`, kind: 'concentric', a: axis(i.parentPartId, i.parent.axisRef), b: axis(i.componentPartId, i.component.axisRef) },
    { id: `${i.id}:mount`, kind: 'coincident', a: plane(i.parentPartId, i.parent.mountingPlaneRef), b: plane(i.componentPartId, i.component.mountingPlaneRef) },
  ], ...(i.fit === 'press' ? { intendedContact: { partA: i.parentPartId, partB: i.componentPartId, justification: `${i.id} press fit, diametral interference ${i.fitAllowanceMm} mm` } } : {}) };
}
