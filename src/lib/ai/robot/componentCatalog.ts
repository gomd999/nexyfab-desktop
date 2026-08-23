import { DIN_BALL_BEARINGS } from '@/lib/openscad-render/standardsLibrary';

export type MountingInterface = {
  axisRef: string; mountingPlaneRef: string; pilotDiameterMm?: number;
  shaftDiameterMm?: number; boltPattern?: { count: number; circleDiameterMm: number; holeDiameterMm: number };
};
export type AuxiliaryComponentKind = 'brake' | 'encoder' | 'harness' | 'tool_connector';
export const AUXILIARY_COMPONENT_KINDS: readonly AuxiliaryComponentKind[] = ['brake', 'encoder', 'harness', 'tool_connector'];
type CatalogBase = {
  id: string; kind: 'motor' | 'reducer' | 'bearing' | AuxiliaryComponentKind; manufacturer: string; model: string; revision: string;
  source: string; artifactHash: string; massKg: number; massSource: 'confirmed' | 'estimated'; envelopeMm: { x: number; y: number; z: number };
  interface: MountingInterface;
};
export type MotorComponent = CatalogBase & { kind: 'motor'; ratedTorqueNm: number; peakTorqueNm: number; maxRpm: number; rotorInertiaKgM2: number };
export type ReducerComponent = CatalogBase & { kind: 'reducer'; ratio: number; ratedOutputTorqueNm: number; peakOutputTorqueNm: number; maxInputRpm: number; efficiency: number; backlashArcmin: number };
export type BearingComponent = CatalogBase & { kind: 'bearing'; boreMm: number; odMm: number; widthMm: number; dynamicLoadN: number; staticLoadN: number; limitingRpm: number };
export type BrakeComponent = CatalogBase & { kind: 'brake'; holdingTorqueNm: number; maxRpm: number; ratedVoltageV: number; releasePowerW: number; responseTimeMs: number };
export type EncoderComponent = CatalogBase & { kind: 'encoder'; resolutionBits: number; accuracyArcsec: number; maxRpm: number; supplyVoltageV: number };
export type HarnessComponent = CatalogBase & { kind: 'harness'; conductorCount: number; ratedVoltageV: number; ratedCurrentA: number; outerDiameterMm: number; minimumBendRadiusMm: number; flexLifeCycles: number };
export type ToolConnectorComponent = CatalogBase & { kind: 'tool_connector'; contactCount: number; ratedVoltageV: number; ratedCurrentA: number; matingCycles: number; ipRating: string };
export type AuxiliaryCatalogComponent = BrakeComponent | EncoderComponent | HarnessComponent | ToolConnectorComponent;
export type CatalogComponent = MotorComponent | ReducerComponent | BearingComponent | AuxiliaryCatalogComponent;

export type CatalogIssue = { id: string; message: string };
export type CatalogArtifactRecord = { sha256: string; byteLength: number; source: string; mediaType?: string };
export function validateCatalog(components: readonly CatalogComponent[]): CatalogIssue[] {
  const issues: CatalogIssue[] = []; const ids = new Set<string>();
  for (const c of components) {
    if (ids.has(c.id)) issues.push({ id: c.id, message: 'duplicate component id' }); ids.add(c.id);
    if (![c.id, c.manufacturer, c.model, c.revision].every(value => value.trim())) issues.push({ id: c.id, message: 'component identity fields are required' });
    if (!c.source.trim() || !/^[a-f0-9]{8,}$/i.test(c.artifactHash)) issues.push({ id: c.id, message: 'traceable source and artifact hash are required' });
    if (!(c.massKg > 0) || Object.values(c.envelopeMm).some(v => !(v > 0))) issues.push({ id: c.id, message: 'positive mass and envelope are required' });
    if (!c.interface.axisRef || !c.interface.mountingPlaneRef) issues.push({ id: c.id, message: 'axis and mounting plane references are required' });
    if (c.kind === 'motor' && (!(c.ratedTorqueNm > 0) || c.peakTorqueNm < c.ratedTorqueNm || !(c.maxRpm > 0) || !(c.rotorInertiaKgM2 > 0))) issues.push({ id: c.id, message: 'invalid motor ratings' });
    if (c.kind === 'reducer' && (!(c.ratio > 1) || !(c.ratedOutputTorqueNm > 0) || !(c.maxInputRpm > 0) || !(c.efficiency > 0 && c.efficiency <= 1) || c.peakOutputTorqueNm < c.ratedOutputTorqueNm || !(c.backlashArcmin >= 0))) issues.push({ id: c.id, message: 'invalid reducer ratings' });
    if (c.kind === 'bearing' && (!(c.boreMm > 0) || c.odMm <= c.boreMm || !(c.widthMm > 0) || !(c.dynamicLoadN > 0) || !(c.staticLoadN > 0) || !(c.limitingRpm > 0))) issues.push({ id: c.id, message: 'invalid bearing dimensions or rating' });
    if (c.kind === 'brake' && (!(c.holdingTorqueNm > 0) || !(c.maxRpm > 0) || !(c.ratedVoltageV > 0) || !(c.releasePowerW > 0) || !(c.responseTimeMs > 0))) issues.push({ id: c.id, message: 'invalid brake ratings' });
    if (c.kind === 'encoder' && (!(Number.isInteger(c.resolutionBits) && c.resolutionBits > 0 && c.resolutionBits <= 64) || !(c.accuracyArcsec > 0) || !(c.maxRpm > 0) || !(c.supplyVoltageV > 0))) issues.push({ id: c.id, message: 'invalid encoder ratings' });
    if (c.kind === 'harness' && (!(Number.isInteger(c.conductorCount) && c.conductorCount > 0) || !(c.ratedVoltageV > 0) || !(c.ratedCurrentA > 0) || !(c.outerDiameterMm > 0) || c.minimumBendRadiusMm < c.outerDiameterMm || !(Number.isSafeInteger(c.flexLifeCycles) && c.flexLifeCycles > 0))) issues.push({ id: c.id, message: 'invalid harness ratings' });
    if (c.kind === 'tool_connector' && (!(Number.isInteger(c.contactCount) && c.contactCount > 0) || !(c.ratedVoltageV > 0) || !(c.ratedCurrentA > 0) || !(Number.isSafeInteger(c.matingCycles) && c.matingCycles > 0) || !/^IP[0-6X][0-9X]$/.test(c.ipRating))) issues.push({ id: c.id, message: 'invalid tool connector ratings' });
  }
  return issues;
}

/** Production gate: every catalog claim must bind to a full-hash evidence artifact. */
export function validateProductionCatalog(
  components: readonly CatalogComponent[],
  artifacts: readonly CatalogArtifactRecord[],
): CatalogIssue[] {
  const issues = [...validateCatalog(components)];
  const byHash = new Map<string, CatalogArtifactRecord>();
  for (const artifact of artifacts) {
    const hash = artifact.sha256.toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) issues.push({ id: artifact.sha256, message: 'artifact SHA-256 must be 64 hexadecimal characters' });
    if (byHash.has(hash)) issues.push({ id: artifact.sha256, message: 'duplicate artifact SHA-256' });
    if (!(Number.isSafeInteger(artifact.byteLength) && artifact.byteLength > 0)) issues.push({ id: artifact.sha256, message: 'artifact byteLength must be a positive safe integer' });
    if (!artifact.source.trim()) issues.push({ id: artifact.sha256, message: 'artifact source is required' });
    byHash.set(hash, artifact);
  }
  for (const component of components) {
    const hash = component.artifactHash.toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) issues.push({ id: component.id, message: 'production artifactHash must be a full SHA-256' });
    if (!byHash.has(hash)) issues.push({ id: component.id, message: 'production artifact evidence is missing' });
    if (component.massSource !== 'confirmed') issues.push({ id: component.id, message: 'production component mass must be confirmed' });
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
