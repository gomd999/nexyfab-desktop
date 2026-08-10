import * as THREE from 'three';
import { strToU8, zipSync } from 'fflate';
import { downloadBlob } from '@/lib/platform';
import { buildBinaryStl } from './stlEncode';
import { buildBomCSVString } from './bomExport';
import type { BomRow } from './bomExport';
import { cadExportBlockers, type CadReleaseStatus } from '@/lib/cad-release-status';
import type { CadDeliverableReleaseDecision } from '@/lib/cad-deliverable-release';

/** Metadata shipped beside .step for shops / RFQ (machine + human readable). */
export interface ManufacturingSidecarMeta {
  partLabel: string;
  shapeTemplateId?: string;
  bbox: { w: number; h: number; d: number };
  volume_cm3: number;
  surface_area_cm2: number;
  unitSystem: 'mm' | 'inch';
  materialKey?: string;
  generatedAt: string;
  /** Set when a ZIP bundle includes a BOM CSV companion file. */
  hasBom?: boolean;
  releaseEvidence?: {
    revisionManifestSha256: string;
    kernelStackIdentitySha256: string;
    kernelEvidenceSha256: string;
    drawingStatus: 'pass' | 'limited' | 'not-run';
    pmiStatus: 'limited' | 'verified';
    workflowStatus: CadReleaseStatus;
    /** Exact decision returned by /api/cad/v1/release/decision. */
    deliverableDecision: CadDeliverableReleaseDecision;
  };
}

const SHA256 = /^[a-f0-9]{64}$/;

async function contentSha256(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', owned.buffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function triangleCount(geometry: THREE.BufferGeometry): number {
  if (geometry.index) return geometry.index.count / 3;
  const pos = geometry.attributes.position;
  return pos ? pos.count / 3 : 0;
}

function buildManifest(
  geometry: THREE.BufferGeometry,
  baseFilename: string,
  meta: ManufacturingSidecarMeta,
  options: { zipArchiveName: string | null; hasBom?: boolean },
): Record<string, unknown> {
  const tri = Math.round(triangleCount(geometry));
  const lenUnit = meta.unitSystem === 'inch' ? 'in' : 'mm';

  const manifest: Record<string, unknown> = {
    nexyfabManufacturingManifestVersion: 2,
    generatedAt: meta.generatedAt,
    application: 'NexyFab Shape Generator',
    part: {
      displayLabel: meta.partLabel,
      shapeTemplateId: meta.shapeTemplateId ?? null,
    },
    units: {
      length: lenUnit,
      volume: 'cm3',
      surface: 'cm2',
    },
    coordinateSystem: {
      convention: 'right-handed',
      upAxis: 'Y',
      note:
        'Web viewer uses Y-up (Three.js). Many CAM systems use Z-up — verify orientation after import.',
    },
    envelope: {
      width: meta.bbox.w,
      height: meta.bbox.h,
      depth: meta.bbox.d,
      unit: lenUnit,
    },
    massPropertiesApproximate: {
      volume_cm3: meta.volume_cm3,
      surface_area_cm2: meta.surface_area_cm2,
    },
    mesh: {
      triangleCount: tri,
      stlNote: 'Binary STL matches the same tessellation used for display export.',
      stepNote:
        'STEP uses tessellated (triangulated) solid interchange. Validate for production use.',
    },
    disclaimer:
      'For quotation and technical review. Production requires facility validation, tolerances, finishing, and material certification as applicable.',
    companionFiles: {
      step: `${baseFilename}.step`,
      stl: `${baseFilename}.stl`,
      manifest: `${baseFilename}-manufacturing.json`,
      readme: `${baseFilename}-MANUFACTURING.txt`,
    },
  };

  if (meta.materialKey) {
    manifest.materialIntent = { uiMaterialPreset: meta.materialKey };
  }

  if (options.zipArchiveName) {
    const delivery = {
      format: 'application/zip',
      archiveFile: options.zipArchiveName,
      contains: [
        `${baseFilename}.step`,
        `${baseFilename}.stl`,
        `${baseFilename}-manufacturing.json`,
        `${baseFilename}-MANUFACTURING.txt`,
      ],
    };
    manifest.delivery = delivery;
    if (options.hasBom) {
      delivery.contains.push(`${baseFilename}-BOM.csv`);
    }
  }

  return manifest;
}

function buildReadme(
  meta: ManufacturingSidecarMeta,
  tri: number,
  base: string,
  lenUnit: string,
  zipMode: boolean,
): string {
  const lines: string[] = [
    'NexyFab — Manufacturing handoff',
    '================================',
    `Part / template: ${meta.partLabel}`,
  ];
  if (meta.shapeTemplateId) lines.push(`Shape template ID: ${meta.shapeTemplateId}`);
  lines.push(
    `Generated (UTC): ${meta.generatedAt}`,
    '',
    `Envelope (W × H × D), ${lenUnit}:`,
    `  ${meta.bbox.w.toFixed(3)} × ${meta.bbox.h.toFixed(3)} × ${meta.bbox.d.toFixed(3)}`,
    '',
    'Approximate mesh analytics:',
    `  Volume: ${meta.volume_cm3.toFixed(4)} cm³`,
    `  Surface area: ${meta.surface_area_cm2.toFixed(4)} cm²`,
    `  Triangle count: ${tri}`,
    '',
  );
  if (meta.materialKey) {
    lines.push(`UI material preset (intent only): ${meta.materialKey}`, '');
  }
  lines.push(
    'Coordinate system: right-handed, Y-up in NexyFab viewer. Re-orient in CAM if required.',
    '',
  );
  if (zipMode) {
    lines.push(
      'This archive is a single ZIP. Extract to obtain:',
      `  • ${base}.step — tessellated STEP (CAD interchange)`,
      `  • ${base}.stl — binary STL (CAM / rapid prototyping)`,
      `  • ${base}-manufacturing.json — structured metadata`,
      `  • ${base}-MANUFACTURING.txt — this summary`,
    );
    if (meta.hasBom) {
      lines.push(`  • ${base}-BOM.csv — Assembly Bill of Materials`);
    }
    lines.push('');
  } else {
    lines.push(
      'Files in this export:',
      `  • ${base}.step — 3D solid (tessellated STEP)`,
      `  • ${base}.stl — binary STL`,
      `  • ${base}-manufacturing.json — structured metadata for tooling / RFQ systems`,
      `  • ${base}-MANUFACTURING.txt — this summary`,
      '',
    );
  }
  lines.push(
    'Disclaimer:',
    '  For quotation and design review. Not a substitute for engineering drawings,',
    '  geometric tolerances, or supplier process sign-off.',
    '',
  );
  return lines.join('\n');
}

/**
 * Single ZIP: STEP + binary STL + JSON manifest + TXT readme (manufacturing handoff).
 */
export async function exportManufacturingZipBundle(
  geometry: THREE.BufferGeometry,
  baseFilename: string,
  meta: ManufacturingSidecarMeta,
  bomRows?: BomRow[],
  exactStepText?: string,
  releaseArtifacts: Record<string, Uint8Array> = {},
): Promise<void> {
  const reserved = new Set([`${baseFilename}.step`, `${baseFilename}.stl`, `${baseFilename}-manufacturing.json`, `${baseFilename}-MANUFACTURING.txt`, `${baseFilename}-BOM.csv`]);
  for (const [file, bytes] of Object.entries(releaseArtifacts)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(file) || file.includes('..')) throw new Error(`MANUFACTURING_PACKAGE_ARTIFACT_NAME_INVALID:${file}`);
    if (reserved.has(file)) throw new Error(`MANUFACTURING_PACKAGE_ARTIFACT_RESERVED:${file}`);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error(`MANUFACTURING_PACKAGE_ARTIFACT_EMPTY:${file}`);
  }
  const stepText = exactStepText ?? await (async () => {
    const { exportToStepAsync } = await import('./stepExporter');
    return exportToStepAsync(geometry, baseFilename);
  })();
  const stlBuffer = buildBinaryStl(geometry);
  const tri = Math.round(triangleCount(geometry));
  const lenUnit = meta.unitSystem === 'inch' ? 'in' : 'mm';

  const zipName = `${baseFilename}-manufacturing-bundle.zip`;
  const readme = buildReadme({ ...meta, hasBom: !!bomRows }, tri, baseFilename, lenUnit, true);

  const filesToZip: Record<string, Uint8Array> = {
    [`${baseFilename}.step`]: strToU8(stepText),
    [`${baseFilename}.stl`]: new Uint8Array(stlBuffer),
    [`${baseFilename}-MANUFACTURING.txt`]: strToU8(readme),
    ...releaseArtifacts,
  };

  if (bomRows && bomRows.length > 0) {
    const csvStr = buildBomCSVString(bomRows);
    const bomPrefix = '\uFEFF';
    filesToZip[`${baseFilename}-BOM.csv`] = strToU8(bomPrefix + csvStr);
  }

  const artifacts = await Promise.all(Object.entries(filesToZip).sort(([a], [b]) => a.localeCompare(b)).map(async ([file, bytes]) => ({
    file,
    bytes: bytes.byteLength,
    sha256: await contentSha256(bytes),
    role: file.endsWith('.step') ? (exactStepText !== undefined ? 'exact-brep-step' : 'tessellated-step') : 'companion',
  })));
  const evidence = meta.releaseEvidence;
  const evidenceHashesValid = evidence !== undefined && [evidence.revisionManifestSha256, evidence.kernelStackIdentitySha256, evidence.kernelEvidenceSha256].every(value => SHA256.test(value));
  const blockers = [
    ...(exactStepText === undefined ? ['exact-brep-step-missing'] : []),
    ...(!evidenceHashesValid ? ['release-evidence-missing-or-invalid'] : []),
    ...(evidence?.drawingStatus !== 'pass' ? ['exact-drawing-not-passed'] : []),
    ...(evidence?.pmiStatus !== 'verified' ? ['ap242-pmi-limited'] : []),
    ...cadExportBlockers(evidence?.workflowStatus ?? 'ai_draft', 'manufacturing_or_construction'),
    ...(evidence?.deliverableDecision?.status !== 'pass'
      || evidence.deliverableDecision.purpose !== 'manufacturing_or_construction'
      || evidence.deliverableDecision.workflowStatus !== evidence.workflowStatus
      || evidence.deliverableDecision.blockers.length > 0
      ? ['deliverable-roundtrip-review-decision-missing-or-blocked'] : []),
  ];
  // A blocked manufacturing package must never reach the browser as a ZIP.
  // Previously the manifest said `blocked` but downloadBlob still ran, which
  // made the policy informational rather than an export gate.
  if (blockers.length > 0) {
    throw new Error(`MANUFACTURING_EXPORT_BLOCKED:${blockers.join(',')}`);
  }
  const packageContentSha256 = await contentSha256(strToU8(JSON.stringify(artifacts)));
  const manifest = {
    ...buildManifest(geometry, baseFilename, meta, { zipArchiveName: zipName, hasBom: !!bomRows }),
    nexyfabManufacturingManifestVersion: 3,
    immutableArtifacts: artifacts,
    packageContentSha256,
    releaseEvidence: evidence ?? null,
    releaseDecision: {
      status: blockers.length === 0 ? 'pass' : 'blocked',
      purpose: blockers.length === 0 ? 'manufacturing_or_construction' : 'expert_review_only',
      workflowStatus: evidence?.workflowStatus ?? 'ai_draft',
      blockers,
    },
  };
  filesToZip[`${baseFilename}-manufacturing.json`] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const zipped = zipSync(filesToZip, { level: 6 });

  await downloadBlob(
    zipName,
    new Blob([new Uint8Array(zipped)], { type: 'application/zip' }),
  );
}

/**
 * Loose files (no ZIP): STEP must be downloaded separately by caller, or use {@link exportManufacturingZipBundle}.
 * Downloads JSON + TXT + STL. Kept for callers that need split downloads.
 */
export async function exportManufacturingSidecars(
  geometry: THREE.BufferGeometry,
  baseFilename: string,
  meta: ManufacturingSidecarMeta,
): Promise<void> {
  const blockers = cadExportBlockers(meta.releaseEvidence?.workflowStatus ?? 'ai_draft', 'design_review');
  if (blockers.length > 0) {
    throw new Error(`CAD_SIDECAR_EXPORT_BLOCKED:${blockers.join(',')}`);
  }
  const tri = Math.round(triangleCount(geometry));
  const lenUnit = meta.unitSystem === 'inch' ? 'in' : 'mm';
  const manifest = buildManifest(geometry, baseFilename, meta, { zipArchiveName: null });
  const json = JSON.stringify(manifest, null, 2);
  const readme = buildReadme(meta, tri, baseFilename, lenUnit, false);

  await downloadBlob(`${baseFilename}-manufacturing.json`, new Blob([json], { type: 'application/json' }));
  await downloadBlob(`${baseFilename}-MANUFACTURING.txt`, new Blob([readme], { type: 'text/plain;charset=utf-8' }));

  const stlBuffer = buildBinaryStl(geometry);
  await downloadBlob(`${baseFilename}.stl`, new Blob([stlBuffer], { type: 'application/octet-stream' }));
}
