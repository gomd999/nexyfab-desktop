import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { validateProductionCatalog, type CatalogArtifactRecord, type CatalogComponent } from '../../src/lib/ai/robot/componentCatalog';
import { robotCatalogManifestSchema } from '../../src/lib/ai/robot/robotCatalogAdmission';

export type RobotCatalogValidationReport = {
  schema: 'nexyfab.robot-component-catalog-validation.v1';
  manifestSchema: string | null;
  valid: boolean;
  productionEligible: boolean;
  componentCount: number;
  artifactCount: number;
  artifacts: Array<{ path: string; expectedSha256: string; actualSha256: string | null; byteLength: number | null; verified: boolean }>;
  errors: string[];
};

export function validateRobotComponentCatalogManifest(manifestPath: string): RobotCatalogValidationReport {
  const errors: string[] = [];
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(manifestPath, 'utf8')); }
  catch (error) { return emptyReport([`manifest_read_failed: ${error instanceof Error ? error.message : String(error)}`]); }
  const parsed = robotCatalogManifestSchema.safeParse(raw);
  if (!parsed.success) return emptyReport(parsed.error.issues.map(issue => `${issue.path.join('.') || '$'}: ${issue.message}`), typeof (raw as { schema?: unknown })?.schema === 'string' ? String((raw as { schema: string }).schema) : null);

  const base = realpathSync(path.dirname(path.resolve(manifestPath)));
  const artifactRecords: CatalogArtifactRecord[] = [];
  const artifactResults: RobotCatalogValidationReport['artifacts'] = [];
  for (const artifact of parsed.data.artifacts) {
    let actualSha256: string | null = null; let byteLength: number | null = null;
    try {
      const candidate = path.resolve(base, artifact.path);
      const resolved = realpathSync(candidate);
      const relative = path.relative(base, resolved);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('artifact path must resolve to a file below the manifest directory');
      const stat = statSync(resolved);
      if (!stat.isFile()) throw new Error('artifact is not a regular file');
      const bytes = readFileSync(resolved);
      actualSha256 = createHash('sha256').update(bytes).digest('hex');
      byteLength = bytes.length;
      if (actualSha256 !== artifact.sha256.toLowerCase()) errors.push(`${artifact.path}: SHA-256 mismatch`);
      artifactRecords.push({ sha256: artifact.sha256, byteLength, source: artifact.source, mediaType: artifact.mediaType });
    } catch (error) { errors.push(`${artifact.path}: ${error instanceof Error ? error.message : String(error)}`); }
    artifactResults.push({ path: artifact.path.replaceAll('\\', '/'), expectedSha256: artifact.sha256.toLowerCase(), actualSha256, byteLength, verified: actualSha256 === artifact.sha256.toLowerCase() });
  }
  errors.push(...validateProductionCatalog(parsed.data.components as CatalogComponent[], artifactRecords).map(issue => `${issue.id}: ${issue.message}`));
  return {
    schema: 'nexyfab.robot-component-catalog-validation.v1', manifestSchema: parsed.data.schema,
    valid: errors.length === 0, productionEligible: errors.length === 0,
    componentCount: parsed.data.components.length, artifactCount: parsed.data.artifacts.length,
    artifacts: artifactResults, errors,
  };
}

function emptyReport(errors: string[], manifestSchema: string | null = null): RobotCatalogValidationReport {
  return { schema: 'nexyfab.robot-component-catalog-validation.v1', manifestSchema, valid: false, productionEligible: false, componentCount: 0, artifactCount: 0, artifacts: [], errors };
}
