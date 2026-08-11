import { validateAiAssemblyProgram, type AiAssemblyProgram } from '../aiAssemblyProgram';
import type { HingeMate } from '../../assembly/mate';

const SHA256 = /^[a-f0-9]{64}$/;

export type RobotEvidenceSummary = {
  reportHash: string;
  lineageId: string;
  revision: number;
  programHash: string;
  programArtifact: string;
  editableParts: number;
  mates: number;
  rankDoF: number | null;
  allowedDoF: number | null;
  flaggedInterferences: number;
  collisionFrames: number;
  motionFrames: number;
  checkedMotionFrames?: number;
  motionConverged?: boolean;
  motionAxes?: RobotMotionAxisSummary[];
  catalogStatus: string;
  housingStatus: string;
  claimedReleaseReady: boolean;
  effectiveReleaseReady: boolean;
  blockers: string[];
  interferenceQueue: RobotInterferenceQueueItem[];
};

export type RobotMotionAxisSummary = {
  mateId: string;
  rangeDeg: [number, number];
  allConverged: boolean;
  frameCount: number;
  checkedFrames: number;
  collisionFrameCount: number;
  segments: Array<{ direction: 'toward-min' | 'toward-max'; apiOk: boolean; allConverged: boolean; frameCount: number; checkedFrames: number; collisionFrameCount: number; firstFailureFrame: number | null; firstCollisionFrame: number | null; maxPenetrationMm: number | null }>;
};

export type RobotInterferenceQueueItem = {
  id: string;
  pairKey: string;
  partA: string;
  partB: string;
  penetrationMm: number | null;
  category: 'structural-structural' | 'drive-structural' | 'drive-drive';
  priority: 'critical' | 'high' | 'medium';
  recommendedAction: 'redesign_structure' | 'resize_or_reselect_drive' | 'repackage_drive_stack';
};

type JsonObject = Record<string, unknown>;
const object = (value: unknown, path: string): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as JsonObject;
};
const string = (value: unknown, path: string) => { if (typeof value !== 'string') throw new Error(`${path} must be a string`); return value; };
const boolean = (value: unknown, path: string) => { if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`); return value; };
const nonnegativeInteger = (value: unknown, path: string) => { if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${path} must be a non-negative integer`); return value as number; };

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

/**
 * Parses a local demonstrator report and binds it to the exact editable-program
 * bytes. This establishes integrity, not provenance or expert approval.
 */
export async function verifyRobotEvidenceBundle(reportBytes: Uint8Array, programBytes: Uint8Array): Promise<RobotEvidenceSummary> {
  if (!reportBytes.byteLength || reportBytes.byteLength > 5_000_000) throw new Error('report size must be between 1 byte and 5 MB');
  if (!programBytes.byteLength || programBytes.byteLength > 50_000_000) throw new Error('program size must be between 1 byte and 50 MB');
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(reportBytes)); }
  catch { throw new Error('report must be valid UTF-8 JSON'); }
  const report = object(parsed, 'report');
  if (report.schema !== 'nexyfab.ai-complex-product-demonstrator.v1') throw new Error('unsupported report schema');
  const product = object(report.product, 'product');
  const policy = object(report.policy, 'policy');
  const catalog = object(report.catalogSelection, 'catalogSelection');
  const housing = object(report.housingFit, 'housingFit');
  const assembly = object(report.assembly, 'assembly');
  if (assembly.preciseInterferenceStatus !== 'completed' && assembly.preciseInterferenceStatus !== 'not-needed-no-candidates') {
    throw new Error('precise interference verification must be completed or candidate-free');
  }
  const certificate = object(assembly.certificate, 'assembly.certificate');
  const motion = object(report.motionStudy, 'motionStudy');
  const expectedProgramHash = string(product.programSha256, 'product.programSha256');
  if (!SHA256.test(expectedProgramHash)) throw new Error('product.programSha256 must be a lowercase SHA-256');
  const programArtifact = string(product.programArtifact, 'product.programArtifact');
  if (programArtifact !== `editable-program-${expectedProgramHash}.json`) throw new Error('product.programArtifact must be content-addressed by programSha256');
  const actualProgramHash = await sha256(programBytes);
  if (actualProgramHash !== expectedProgramHash) throw new Error('editable program hash does not match report');
  let parsedProgram: unknown;
  try { parsedProgram = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(programBytes)); }
  catch { throw new Error('editable program must be valid UTF-8 JSON'); }
  const programObject = object(parsedProgram, 'program');
  if (!Array.isArray(programObject.parts)) throw new Error('program.parts must be an array');
  const programAssembly = object(programObject.assembly, 'program.assembly');
  if (!Array.isArray(programAssembly.parts) || !Array.isArray(programAssembly.mates)) throw new Error('program.assembly parts and mates must be arrays');
  if (!Array.isArray(programObject.unresolved)) throw new Error('program.unresolved must be an array');
  let programIssues;
  const validatedProgram = parsedProgram as AiAssemblyProgram;
  try { programIssues = validateAiAssemblyProgram(validatedProgram); }
  catch { throw new Error('editable program structure is invalid'); }
  if (programIssues.length) throw new Error(`editable program validation failed: ${programIssues[0]!.path}: ${programIssues[0]!.message}`);
  const editableParts = nonnegativeInteger(product.editableParts, 'product.editableParts');
  const lineageId = string(product.lineageId, 'product.lineageId');
  if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(lineageId)) throw new Error('product.lineageId is invalid');
  const revision = nonnegativeInteger(product.revision, 'product.revision');
  if (revision < 1) throw new Error('product.revision must be at least 1');
  const mates = nonnegativeInteger(product.mates, 'product.mates');
  if (programObject.parts.length !== editableParts || programAssembly.parts.length !== editableParts) throw new Error('report editable part count does not match program');
  if (programAssembly.mates.length !== mates) throw new Error('report mate count does not match program');
  const classification = string(product.classification, 'product.classification');
  if (programObject.classification !== classification) throw new Error('report classification does not match program');
  const unresolvedCatalogComponents = nonnegativeInteger(product.unresolvedCatalogComponents, 'product.unresolvedCatalogComponents');
  if (programObject.unresolved.length !== unresolvedCatalogComponents) throw new Error('report unresolved component count does not match program');
  const flaggedInterferences = nonnegativeInteger(assembly.flaggedInterferences, 'assembly.flaggedInterferences');
  const interferenceAnalysis = object(report.interferenceAnalysis, 'interferenceAnalysis');
  if (!Array.isArray(interferenceAnalysis.pairs)) throw new Error('interferenceAnalysis.pairs must be an array');
  if (interferenceAnalysis.pairs.length !== flaggedInterferences) throw new Error('interference pair count does not match assembly');
  const instanceIds = new Set((programAssembly.parts as Array<JsonObject>).map((part, index) => string(object(part, `program.assembly.parts[${index}]`).id, `program.assembly.parts[${index}].id`)));
  const interferenceQueue = interferenceAnalysis.pairs.map((raw, index): RobotInterferenceQueueItem => {
    const pair = object(raw, `interferenceAnalysis.pairs[${index}]`);
    const partA = string(pair.partA, `interferenceAnalysis.pairs[${index}].partA`);
    const partB = string(pair.partB, `interferenceAnalysis.pairs[${index}].partB`);
    if (partA === partB || !instanceIds.has(partA) || !instanceIds.has(partB)) throw new Error(`interference pair ${index} references invalid program parts`);
    const category = string(pair.category, `interferenceAnalysis.pairs[${index}].category`) as RobotInterferenceQueueItem['category'];
    if (!['structural-structural', 'drive-structural', 'drive-drive'].includes(category)) throw new Error(`interference pair ${index} has invalid category`);
    const penetrationMm = pair.penetrationMm === null ? null : typeof pair.penetrationMm === 'number' && Number.isFinite(pair.penetrationMm) && pair.penetrationMm >= 0 ? pair.penetrationMm : (() => { throw new Error(`interference pair ${index} has invalid penetration`); })();
    return {
      id: `interference-${index + 1}`, pairKey: [partA, partB].sort().join('\u0000'), partA, partB, penetrationMm, category,
      priority: category === 'structural-structural' ? 'critical' : category === 'drive-structural' ? 'high' : 'medium',
      recommendedAction: category === 'structural-structural' ? 'redesign_structure' : category === 'drive-structural' ? 'resize_or_reselect_drive' : 'repackage_drive_stack',
    };
  }).sort((a, b) => {
    const priority = { critical: 3, high: 2, medium: 1 } as const;
    return priority[b.priority] - priority[a.priority] || (b.penetrationMm ?? -1) - (a.penetrationMm ?? -1) || a.id.localeCompare(b.id);
  });
  const collisionFrames = nonnegativeInteger(motion.collisionFrameCount, 'motionStudy.collisionFrameCount');
  const motionFrames = nonnegativeInteger(motion.frameCount, 'motionStudy.frameCount');
  const checkedMotionFrames = motion.checkedFrames === undefined ? 0 : nonnegativeInteger(motion.checkedFrames, 'motionStudy.checkedFrames');
  const motionConverged = motion.allConverged === true;
  if (collisionFrames > motionFrames) throw new Error('collision frame count exceeds motion frame count');
  if (checkedMotionFrames > motionFrames) throw new Error('checked motion frame count exceeds motion frame count');
  const motionAxes = motion.axes === undefined ? undefined : (() => {
    if (!Array.isArray(motion.axes) || motion.axes.length !== 6) throw new Error('motionStudy.axes must contain governed J1..J6 results');
    const axes = motion.axes.map((raw, index): RobotMotionAxisSummary => {
      const axis = object(raw, `motionStudy.axes[${index}]`);
      const mateId = string(axis.mateId, `motionStudy.axes[${index}].mateId`);
      if (mateId !== `J${index + 1}`) throw new Error('motionStudy.axes must be ordered J1..J6');
      if (!Array.isArray(axis.rangeDeg) || axis.rangeDeg.length !== 2 || axis.rangeDeg.some(value => typeof value !== 'number' || !Number.isFinite(value)) || (axis.rangeDeg[0] as number) >= (axis.rangeDeg[1] as number)) throw new Error(`motionStudy axis ${mateId} has an invalid range`);
      const rangeDeg: [number, number] = [axis.rangeDeg[0] as number, axis.rangeDeg[1] as number];
      const governedMate = validatedProgram.assembly.mates.find((mate): mate is HingeMate => mate.id === mateId && mate.kind === 'hinge');
      if (!governedMate?.limit || governedMate.limit.minAngleDeg !== rangeDeg[0] || governedMate.limit.maxAngleDeg !== rangeDeg[1]) throw new Error(`motionStudy axis ${mateId} range does not match the governed hinge limit`);
      const frameCount = nonnegativeInteger(axis.frameCount, `motionStudy.axes[${index}].frameCount`);
      const checkedFrames = nonnegativeInteger(axis.checkedFrames, `motionStudy.axes[${index}].checkedFrames`);
      const collisionFrameCount = nonnegativeInteger(axis.collisionFrameCount, `motionStudy.axes[${index}].collisionFrameCount`);
      if (checkedFrames > frameCount || collisionFrameCount > frameCount) throw new Error(`motionStudy axis ${mateId} frame counts are impossible`);
      if (!Array.isArray(axis.segments) || axis.segments.length !== 2) throw new Error(`motionStudy axis ${mateId} must contain two zero-to-limit segments`);
      const segments = axis.segments.map((rawSegment, segmentIndex) => {
        const segment = object(rawSegment, `motionStudy.axes[${index}].segments[${segmentIndex}]`);
        const direction = string(segment.direction, `motionStudy.axes[${index}].segments[${segmentIndex}].direction`);
        if (direction !== (segmentIndex === 0 ? 'toward-min' : 'toward-max')) throw new Error(`motionStudy axis ${mateId} segments must be ordered toward-min, toward-max`);
        const segmentFrames = nonnegativeInteger(segment.frameCount, `motionStudy.axes[${index}].segments[${segmentIndex}].frameCount`);
        const segmentChecked = nonnegativeInteger(segment.checkedFrames, `motionStudy.axes[${index}].segments[${segmentIndex}].checkedFrames`);
        const segmentCollisions = nonnegativeInteger(segment.collisionFrameCount, `motionStudy.axes[${index}].segments[${segmentIndex}].collisionFrameCount`);
        if (segmentChecked > segmentFrames || segmentCollisions > segmentFrames) throw new Error(`motionStudy axis ${mateId} segment counts are impossible`);
        const frameOrNull = (value: unknown, label: string) => value === null ? null : nonnegativeInteger(value, label);
        const firstFailureFrame = frameOrNull(segment.firstFailureFrame, `motionStudy.axes[${index}].segments[${segmentIndex}].firstFailureFrame`);
        const firstCollisionFrame = frameOrNull(segment.firstCollisionFrame, `motionStudy.axes[${index}].segments[${segmentIndex}].firstCollisionFrame`);
        const maxPenetrationMm = segment.maxPenetrationMm === null ? null : typeof segment.maxPenetrationMm === 'number' && Number.isFinite(segment.maxPenetrationMm) && segment.maxPenetrationMm >= 0 ? segment.maxPenetrationMm : (() => { throw new Error(`motionStudy axis ${mateId} segment penetration is invalid`); })();
        if ((firstFailureFrame !== null && firstFailureFrame >= segmentFrames) || (firstCollisionFrame !== null && firstCollisionFrame >= segmentFrames)) throw new Error(`motionStudy axis ${mateId} diagnostic frame is outside the segment`);
        const allConverged = boolean(segment.allConverged, `motionStudy.axes[${index}].segments[${segmentIndex}].allConverged`);
        if ((allConverged && firstFailureFrame !== null) || (!allConverged && firstFailureFrame === null) || (segmentCollisions === 0 && (firstCollisionFrame !== null || maxPenetrationMm !== 0 && maxPenetrationMm !== null)) || (segmentCollisions > 0 && (firstCollisionFrame === null || maxPenetrationMm === null))) throw new Error(`motionStudy axis ${mateId} diagnostic fields contradict segment status`);
        return { direction: direction as 'toward-min' | 'toward-max', apiOk: boolean(segment.apiOk, `motionStudy.axes[${index}].segments[${segmentIndex}].apiOk`), allConverged, frameCount: segmentFrames, checkedFrames: segmentChecked, collisionFrameCount: segmentCollisions, firstFailureFrame, firstCollisionFrame, maxPenetrationMm };
      });
      const allConverged = boolean(axis.allConverged, `motionStudy.axes[${index}].allConverged`);
      if (segments.reduce((sum, segment) => sum + segment.frameCount, 0) !== frameCount || segments.reduce((sum, segment) => sum + segment.checkedFrames, 0) !== checkedFrames || segments.reduce((sum, segment) => sum + segment.collisionFrameCount, 0) !== collisionFrameCount || segments.every(segment => segment.allConverged) !== allConverged) throw new Error(`motionStudy axis ${mateId} segment aggregates do not match`);
      return { mateId, rangeDeg, allConverged, frameCount, checkedFrames, collisionFrameCount, segments };
    });
    if (motion.axisCount !== 6 || axes.reduce((sum, axis) => sum + axis.frameCount, 0) !== motionFrames || axes.reduce((sum, axis) => sum + axis.checkedFrames, 0) !== checkedMotionFrames || axes.reduce((sum, axis) => sum + axis.collisionFrameCount, 0) !== collisionFrames || axes.every(axis => axis.allConverged) !== motionConverged) throw new Error('motionStudy axis aggregates do not match report totals');
    return axes;
  })();
  const claimedReleaseReady = boolean(report.releaseReady, 'releaseReady');
  const expertApproval = boolean(policy.expertApprovalGranted, 'policy.expertApprovalGranted');
  const corpusModified = boolean(policy.referenceCorpusModified, 'policy.referenceCorpusModified');
  const catalogVerified = boolean(catalog.actualArtifactBytesVerified, 'catalogSelection.actualArtifactBytesVerified');
  const assemblyRelease = boolean(assembly.releaseReady, 'assembly.releaseReady');
  const motionRelease = boolean(motion.releaseEvidence, 'motionStudy.releaseEvidence');
  const blockers = Array.isArray(report.blockers) && report.blockers.every(item => typeof item === 'string') ? [...report.blockers] as string[] : (() => { throw new Error('blockers must be a string array'); })();
  const invariantBlockers = [
    ...(corpusModified ? ['reference_corpus_modified'] : []),
    ...(!expertApproval ? ['expert_approval_not_granted'] : []),
    ...(!catalogVerified ? ['catalog_artifact_bytes_not_verified'] : []),
    ...(!assemblyRelease ? ['assembly_not_release_ready'] : []),
    ...(!motionRelease || collisionFrames > 0 ? ['motion_not_release_ready'] : []),
    ...(flaggedInterferences > 0 ? ['precise_interferences_present'] : []),
  ];
  const effectiveReleaseReady = claimedReleaseReady && invariantBlockers.length === 0 && blockers.length === 0;
  return {
    reportHash: await sha256(reportBytes), lineageId, revision,
    programHash: actualProgramHash,
    programArtifact,
    editableParts, mates,
    rankDoF: typeof certificate.rankDoF === 'number' && Number.isFinite(certificate.rankDoF) ? certificate.rankDoF : null,
    allowedDoF: typeof certificate.allowedDoF === 'number' && Number.isFinite(certificate.allowedDoF) ? certificate.allowedDoF : null,
    flaggedInterferences, collisionFrames, motionFrames, checkedMotionFrames, motionConverged, motionAxes,
    catalogStatus: string(catalog.selectionStatus, 'catalogSelection.selectionStatus'),
    housingStatus: string(housing.status, 'housingFit.status'),
    claimedReleaseReady, effectiveReleaseReady,
    blockers: [...new Set([...blockers, ...invariantBlockers])], interferenceQueue,
  };
}
