import { DIN_BALL_BEARINGS } from '@/lib/openscad-render/standardsLibrary';

export type MountingInterface = {
  axisRef: string; mountingPlaneRef: string; pilotDiameterMm?: number;
  shaftDiameterMm?: number; boltPattern?: { count: number; circleDiameterMm: number; holeDiameterMm: number };
};
type CatalogBase = {
  id: string; kind: 'motor' | 'reducer' | 'bearing'; manufacturer: string; model: string; revision: string;
  source: string; artifactHash: string; massKg: number; massSource: 'confirmed' | 'estimated'; envelopeMm: { x: number; y: number; z: number };
  interface: MountingInterface;
};
export type MotorComponent = CatalogBase & { kind: 'motor'; ratedTorqueNm: number; peakTorqueNm: number; maxRpm: number; rotorInertiaKgM2: number };
export type ReducerComponent = CatalogBase & { kind: 'reducer'; ratio: number; ratedOutputTorqueNm: number; peakOutputTorqueNm: number; maxInputRpm: number; efficiency: number; backlashArcmin: number };
export type BearingComponent = CatalogBase & { kind: 'bearing'; boreMm: number; odMm: number; widthMm: number; dynamicLoadN: number; staticLoadN: number; limitingRpm: number };
export type CatalogComponent = MotorComponent | ReducerComponent | BearingComponent;

export type CatalogIssue = { id: string; message: string };
export function validateCatalog(components: readonly CatalogComponent[]): CatalogIssue[] {
  const issues: CatalogIssue[] = []; const ids = new Set<string>();
  for (const c of components) {
    if (ids.has(c.id)) issues.push({ id: c.id, message: 'duplicate component id' }); ids.add(c.id);
    if (!c.source.trim() || !/^[a-f0-9]{8,}$/i.test(c.artifactHash)) issues.push({ id: c.id, message: 'traceable source and artifact hash are required' });
    if (!(c.massKg > 0) || Object.values(c.envelopeMm).some(v => !(v > 0))) issues.push({ id: c.id, message: 'positive mass and envelope are required' });
    if (!c.interface.axisRef || !c.interface.mountingPlaneRef) issues.push({ id: c.id, message: 'axis and mounting plane references are required' });
    if (c.kind === 'motor' && (!(c.ratedTorqueNm > 0) || c.peakTorqueNm < c.ratedTorqueNm || !(c.maxRpm > 0))) issues.push({ id: c.id, message: 'invalid motor ratings' });
    if (c.kind === 'reducer' && (!(c.ratio > 1) || !(c.efficiency > 0 && c.efficiency <= 1) || c.peakOutputTorqueNm < c.ratedOutputTorqueNm)) issues.push({ id: c.id, message: 'invalid reducer ratings' });
    if (c.kind === 'bearing' && (!(c.boreMm > 0) || c.odMm <= c.boreMm || !(c.dynamicLoadN > 0))) issues.push({ id: c.id, message: 'invalid bearing dimensions or rating' });
  }
  return issues;
}

/** Existing DIN 625 data promoted into the traceable common catalog. */
export function din625BearingCatalog(): BearingComponent[] {
  return Object.values(DIN_BALL_BEARINGS).map(b => ({
    id: `DIN625:${b.designation}`, kind: 'bearing', manufacturer: 'generic-standard', model: b.designation, revision: 'DIN625-fixture-1',
    source: 'DIN 625 dimensional/load fixture in standardsLibrary.ts', artifactHash: `d625${b.designation.padStart(8, '0')}`,
    massKg: Math.max(0.01, Math.PI * (b.odMm ** 2 - b.boreMm ** 2) * b.widthMm * 7.8e-6 * 0.55), massSource: 'estimated',
    envelopeMm: { x: b.odMm, y: b.odMm, z: b.widthMm }, interface: { axisRef: 'bore_axis', mountingPlaneRef: 'side_face', shaftDiameterMm: b.boreMm },
    boreMm: b.boreMm, odMm: b.odMm, widthMm: b.widthMm, dynamicLoadN: b.dynamicLoadN, staticLoadN: b.staticLoadN, limitingRpm: b.limitingRpm,
  }));
}
