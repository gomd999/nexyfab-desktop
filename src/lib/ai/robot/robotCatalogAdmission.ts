import { createHash } from 'node:crypto';
import { z } from 'zod';
import { validateProductionCatalog, type CatalogArtifactRecord, type CatalogComponent } from './componentCatalog';

const vec3Schema = z.object({ x: z.number().positive().finite(), y: z.number().positive().finite(), z: z.number().positive().finite() }).strict();
const interfaceSchema = z.object({
  axisRef: z.string().min(1), mountingPlaneRef: z.string().min(1), pilotDiameterMm: z.number().positive().finite().optional(), shaftDiameterMm: z.number().positive().finite().optional(),
  boltPattern: z.object({ count: z.number().int().positive(), circleDiameterMm: z.number().positive().finite(), holeDiameterMm: z.number().positive().finite() }).strict().optional(),
}).strict();
const common = z.object({
  id: z.string().min(1), manufacturer: z.string().min(1), model: z.string().min(1), revision: z.string().min(1), source: z.string().min(1), artifactHash: z.string().regex(/^[a-f0-9]{64}$/i),
  massKg: z.number().positive().finite(), massSource: z.enum(['confirmed', 'estimated']), envelopeMm: vec3Schema, interface: interfaceSchema,
});
const componentSchema = z.discriminatedUnion('kind', [
  common.extend({ kind: z.literal('motor'), ratedTorqueNm: z.number().positive().finite(), peakTorqueNm: z.number().positive().finite(), maxRpm: z.number().positive().finite(), rotorInertiaKgM2: z.number().positive().finite() }).strict(),
  common.extend({ kind: z.literal('reducer'), ratio: z.number().gt(1).finite(), ratedOutputTorqueNm: z.number().positive().finite(), peakOutputTorqueNm: z.number().positive().finite(), maxInputRpm: z.number().positive().finite(), efficiency: z.number().positive().max(1), backlashArcmin: z.number().nonnegative().finite() }).strict(),
  common.extend({ kind: z.literal('bearing'), boreMm: z.number().positive().finite(), odMm: z.number().positive().finite(), widthMm: z.number().positive().finite(), dynamicLoadN: z.number().positive().finite(), staticLoadN: z.number().positive().finite(), limitingRpm: z.number().positive().finite() }).strict(),
  common.extend({ kind: z.literal('brake'), holdingTorqueNm: z.number().positive().finite(), maxRpm: z.number().positive().finite(), ratedVoltageV: z.number().positive().finite(), releasePowerW: z.number().positive().finite(), responseTimeMs: z.number().positive().finite() }).strict(),
  common.extend({ kind: z.literal('encoder'), resolutionBits: z.number().int().min(1).max(64), accuracyArcsec: z.number().positive().finite(), maxRpm: z.number().positive().finite(), supplyVoltageV: z.number().positive().finite() }).strict(),
  common.extend({ kind: z.literal('harness'), conductorCount: z.number().int().positive(), ratedVoltageV: z.number().positive().finite(), ratedCurrentA: z.number().positive().finite(), outerDiameterMm: z.number().positive().finite(), minimumBendRadiusMm: z.number().positive().finite(), flexLifeCycles: z.number().int().positive().safe() }).strict(),
  common.extend({ kind: z.literal('tool_connector'), contactCount: z.number().int().positive(), ratedVoltageV: z.number().positive().finite(), ratedCurrentA: z.number().positive().finite(), matingCycles: z.number().int().positive().safe(), ipRating: z.string().regex(/^IP[0-6X][0-9X]$/) }).strict(),
]);
export const robotCatalogManifestSchema = z.object({
  schema: z.literal('nexyfab.robot-component-catalog.v1'),
  components: z.array(componentSchema).min(1).max(500),
  artifacts: z.array(z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/i), source: z.string().min(1), mediaType: z.string().min(1).optional() }).strict()).min(1).max(25),
}).strict();

export type RobotCatalogManifest = z.infer<typeof robotCatalogManifestSchema>;
export type RobotCatalogAdmissionReport = {
  schema: 'nexyfab.robot-component-catalog-admission.v1'; valid: boolean; productionEligible: boolean;
  selectionReady: false; selectionStatus: 'not_run';
  manifestSha256: string; artifactSetSha256: string;
  componentCount: number; artifactCount: number; totalArtifactBytes: number;
  artifacts: Array<{ name: string; expectedSha256: string | null; actualSha256: string; byteLength: number; verified: boolean }>;
  errors: string[]; sideEffects: { persisted: false; catalogActivated: false; quoteCreated: false; rfqSent: false };
};

export function parseRobotCatalogManifestBytes(bytes: Uint8Array): { manifest: RobotCatalogManifest | null; errors: string[] } {
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { return { manifest: null, errors: ['manifest must be valid UTF-8 JSON'] }; }
  const parsed = robotCatalogManifestSchema.safeParse(raw);
  return parsed.success ? { manifest: parsed.data, errors: [] } : { manifest: null, errors: parsed.error.issues.map(issue => `${issue.path.join('.') || '$'}: ${issue.message}`) };
}

export function admitRobotCatalogBytes(manifestBytes: Uint8Array, uploaded: ReadonlyArray<{ name: string; bytes: Uint8Array }>): RobotCatalogAdmissionReport {
  const manifestSha256 = sha256(manifestBytes);
  const parsed = parseRobotCatalogManifestBytes(manifestBytes);
  if (!parsed.manifest) return report([], 0, parsed.errors, manifestSha256);
  const manifest = parsed.manifest; const errors: string[] = [];
  const manifestNames = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (!safeBasename(artifact.path)) errors.push(`${artifact.path}: artifact path must be a safe basename without directories`);
    if (manifestNames.has(artifact.path)) errors.push(`${artifact.path}: duplicate manifest artifact path`);
    manifestNames.add(artifact.path);
  }
  const uploadedByName = new Map<string, { name: string; bytes: Uint8Array }>();
  for (const artifact of uploaded) {
    if (!safeBasename(artifact.name)) errors.push(`${artifact.name}: uploaded artifact name is unsafe`);
    if (uploadedByName.has(artifact.name)) errors.push(`${artifact.name}: duplicate uploaded artifact name`);
    else uploadedByName.set(artifact.name, artifact);
    if (!manifestNames.has(artifact.name)) errors.push(`${artifact.name}: uploaded artifact is not declared by manifest`);
  }
  const artifactRecords: CatalogArtifactRecord[] = [];
  const artifacts = manifest.artifacts.map(item => {
    const file = uploadedByName.get(item.path); const expectedSha256 = item.sha256.toLowerCase();
    if (!file) { errors.push(`${item.path}: declared artifact file is missing`); return { name: item.path, expectedSha256, actualSha256: '', byteLength: 0, verified: false }; }
    const actualSha256 = createHash('sha256').update(file.bytes).digest('hex');
    if (actualSha256 !== expectedSha256) errors.push(`${item.path}: SHA-256 mismatch`);
    artifactRecords.push({ sha256: expectedSha256, byteLength: file.bytes.byteLength, source: item.source, mediaType: item.mediaType });
    return { name: item.path, expectedSha256, actualSha256, byteLength: file.bytes.byteLength, verified: actualSha256 === expectedSha256 };
  });
  errors.push(...validateProductionCatalog(manifest.components as CatalogComponent[], artifactRecords).map(issue => `${issue.id}: ${issue.message}`));
  return report(artifacts, manifest.components.length, errors, manifestSha256);
}

function safeBasename(value: string) { return value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\') && /^[^\u0000-\u001f]{1,180}$/.test(value); }
function report(artifacts: RobotCatalogAdmissionReport['artifacts'], componentCount: number, errors: string[], manifestSha256: string): RobotCatalogAdmissionReport {
  const digest = createHash('sha256');
  for (const item of [...artifacts].sort((a, b) => a.name.localeCompare(b.name))) digest.update(`${item.name}\0${item.actualSha256}\0${item.byteLength}\n`);
  return { schema: 'nexyfab.robot-component-catalog-admission.v1', manifestSha256, artifactSetSha256: digest.digest('hex'), valid: errors.length === 0, productionEligible: errors.length === 0, selectionReady: false, selectionStatus: 'not_run', componentCount, artifactCount: artifacts.length, totalArtifactBytes: artifacts.reduce((sum, item) => sum + item.byteLength, 0), artifacts, errors, sideEffects: { persisted: false, catalogActivated: false, quoteCreated: false, rfqSent: false } };
}
function sha256(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
