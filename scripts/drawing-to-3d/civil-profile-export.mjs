/** Deterministic internal CivilDocument alignment/profile JSON exporter. */
import { createHash } from 'node:crypto';

export const SCHEMA = 'nexyfab.civil-profile-artifact.v1';
export const CAPABILITY_ID = 'civil.profile.internal';
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
export const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  const text = JSON.stringify(value); return text === undefined ? 'null' : text;
};
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const fail = (reason) => { throw new Error(`CIVIL_PROFILE_EXPORT_INVALID:${reason}`); };
const length = (segment) => segment.kind === 'arc' ? Math.abs((segment.endAngleDeg - segment.startAngleDeg) * Math.PI / 180) * segment.radiusM : Math.hypot(segment.endM[0] - segment.startM[0], segment.endM[1] - segment.startM[1]);
const validateHeader = (document, options) => {
  if (!document || typeof document !== 'object' || document.schema !== 'nexyfab.civil.v1') fail('DOCUMENT_SCHEMA');
  if (!ID.test(options?.projectId ?? '') || !ID.test(options?.revisionId ?? '') || !SHA256.test(options?.revisionSha256 ?? '') || options.revisionId !== options.expectedRevisionId || options.revisionSha256 !== options.expectedRevisionSha256) fail('REVISION_BINDING');
  if (!ID.test(document.coordinateSystemId ?? '') || !document.crs || !Number.isSafeInteger(document.crs.epsg) || document.crs.epsg <= 0 || document.crs.units !== 'm') fail('CRS');
  if (!Array.isArray(document.alignments) || document.alignments.length === 0 || !Array.isArray(document.profiles) || document.profiles.length === 0) fail('DATA_REQUIRED');
};
const segment = (value, endStationM) => {
  if (!value || !ID.test(value.id ?? '') || !['line', 'arc', 'spiral'].includes(value.kind) || !finite(value.startStationM) || !finite(endStationM) || endStationM <= value.startStationM) fail('SEGMENT');
  if (value.kind === 'arc') return { id: value.id, kind: value.kind, startStationM: value.startStationM, endStationM, centerM: value.centerM, radiusM: value.radiusM, startAngleDeg: value.startAngleDeg, endAngleDeg: value.endAngleDeg, clockwise: value.clockwise };
  return value.kind === 'line' ? { id: value.id, kind: value.kind, startStationM: value.startStationM, endStationM, startM: value.startM, endM: value.endM } : { id: value.id, kind: value.kind, startStationM: value.startStationM, endStationM, startM: value.startM, endM: value.endM, startRadiusM: value.startRadiusM, endRadiusM: value.endRadiusM };
};
export function exportCivilProfileArtifact(document, options) {
  validateHeader(document, options);
  const alignments = [...document.alignments].sort((a, b) => a.id.localeCompare(b.id)).map((alignment) => {
    if (!ID.test(alignment.id ?? '') || typeof alignment.name !== 'string' || !Array.isArray(alignment.segments) || alignment.segments.length === 0) fail('ALIGNMENT');
    const segments = alignment.segments.map((item, index) => { if (index === alignment.segments.length - 1 && item.kind === 'spiral') fail('TERMINAL_SPIRAL_COVERAGE_UNKNOWN'); return segment(item, alignment.segments[index + 1]?.startStationM ?? item.startStationM + length(item)); });
    return { id: alignment.id, name: alignment.name, startStationM: segments[0].startStationM, endStationM: segments.at(-1).endStationM, segments };
  });
  const alignmentIds = new Set(alignments.map((item) => item.id));
  const profiles = [...document.profiles].sort((a, b) => a.id.localeCompare(b.id)).map((profile) => {
    if (!ID.test(profile.id ?? '') || !alignmentIds.has(profile.alignmentId) || !['existing', 'proposed'].includes(profile.kind) || !Array.isArray(profile.points) || profile.points.length < 2 || profile.points.some((point) => !finite(point.stationM) || !finite(point.elevationM))) fail('PROFILE');
    const points = profile.points.map((point) => ({ stationM: point.stationM, elevationM: point.elevationM }));
    return { id: profile.id, alignmentId: profile.alignmentId, kind: profile.kind, startStationM: points[0].stationM, endStationM: points.at(-1).stationM, points };
  });
  const payload = { schema: SCHEMA, binding: { projectId: options.projectId, revisionId: options.revisionId, revisionSha256: options.revisionSha256, sourceDocumentSha256: sha256(canonical(document)) }, coordinateSystemId: document.coordinateSystemId, crs: document.crs, alignments, profiles, counts: { alignmentCount: alignments.length, segmentCount: alignments.reduce((n, a) => n + a.segments.length, 0), profileCount: profiles.length, pviCount: profiles.reduce((n, p) => n + p.points.length, 0) } };
  const contentHash = sha256(canonical(payload));
  return canonical({ payload, contentHash });
}
