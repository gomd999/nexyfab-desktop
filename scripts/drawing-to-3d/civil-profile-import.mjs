/** Independent fail-closed parser/verifier for the internal profile artifact. */
import { createHash } from 'node:crypto';
const SCHEMA = 'nexyfab.civil-profile-artifact.v1';
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  const text = JSON.stringify(value); return text === undefined ? 'null' : text;
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const fail = (reason) => { throw new Error(`CIVIL_PROFILE_PARSE_INVALID:${reason}`); };
const keys = (value, expected, name) => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name}_MALFORMED`); const actual = Object.keys(value).sort(); const wanted = [...expected].sort(); if (actual.length !== wanted.length || actual.some((key, i) => key !== wanted[i])) fail(`${name}_UNKNOWN_KEY`); };
const decode = (input) => { if (!(input instanceof Uint8Array) || input.length === 0) fail('EMPTY'); let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(input); } catch { fail('UTF8_INVALID'); } return text; };
const increasing = (values) => values.every((value, index) => finite(value) && (index === 0 || value > values[index - 1]));
const pointGeometry = (value, name) => { if (!Array.isArray(value) || value.length !== 2 || !value.every(finite)) fail(`${name}_GEOMETRY`); };
const validateSegment = (value) => {
  if (value.kind === 'line') keys(value, ['id', 'kind', 'startStationM', 'endStationM', 'startM', 'endM'], 'LINE');
  else if (value.kind === 'arc') keys(value, ['id', 'kind', 'startStationM', 'endStationM', 'centerM', 'radiusM', 'startAngleDeg', 'endAngleDeg', 'clockwise'], 'ARC');
  else if (value.kind === 'spiral') keys(value, ['id', 'kind', 'startStationM', 'endStationM', 'startM', 'endM', 'startRadiusM', 'endRadiusM'], 'SPIRAL');
  else fail('SEGMENT_KIND');
  if (!ID.test(value.id) || !finite(value.startStationM) || !finite(value.endStationM) || value.endStationM <= value.startStationM) fail('SEGMENT_STATION');
  if (value.kind === 'line' || value.kind === 'spiral') { pointGeometry(value.startM, value.kind); pointGeometry(value.endM, value.kind); if (value.kind === 'spiral' && (value.startRadiusM !== null && (!finite(value.startRadiusM) || value.startRadiusM <= 0) || value.endRadiusM !== null && (!finite(value.endRadiusM) || value.endRadiusM <= 0))) fail('SPIRAL_RADIUS'); }
  if (value.kind === 'arc') { pointGeometry(value.centerM, 'ARC'); if (!finite(value.radiusM) || value.radiusM <= 0 || !finite(value.startAngleDeg) || !finite(value.endAngleDeg) || value.startAngleDeg === value.endAngleDeg || typeof value.clockwise !== 'boolean') fail('ARC_GEOMETRY'); }
};
export function parseCivilProfileArtifact(input, expected = {}) {
  const text = decode(input); let artifact; try { artifact = JSON.parse(text); } catch { fail('MALFORMED_JSON'); }
  if (canonical(artifact) !== text) fail('NON_CANONICAL');
  keys(artifact, ['payload', 'contentHash'], 'ENVELOPE'); if (!SHA256.test(artifact.contentHash)) fail('CONTENT_HASH');
  const p = artifact.payload; keys(p, ['schema', 'binding', 'coordinateSystemId', 'crs', 'alignments', 'profiles', 'counts'], 'PAYLOAD'); if (p.schema !== SCHEMA) fail('SCHEMA');
  keys(p.binding, ['projectId', 'revisionId', 'revisionSha256', 'sourceDocumentSha256'], 'BINDING'); if (!ID.test(p.binding.projectId) || !ID.test(p.binding.revisionId) || !SHA256.test(p.binding.revisionSha256) || !SHA256.test(p.binding.sourceDocumentSha256)) fail('BINDING');
  if (expected.projectId !== undefined && expected.projectId !== p.binding.projectId || expected.revisionId !== undefined && expected.revisionId !== p.binding.revisionId || expected.revisionSha256 !== undefined && expected.revisionSha256 !== p.binding.revisionSha256) fail('REVISION_MISMATCH');
  keys(p.crs, ['epsg', 'horizontalDatum', 'verticalDatum', 'units'], 'CRS'); if (!ID.test(p.coordinateSystemId) || !Number.isSafeInteger(p.crs.epsg) || p.crs.epsg <= 0 || !ID.test(p.crs.horizontalDatum) || !ID.test(p.crs.verticalDatum) || p.crs.units !== 'm') fail('CRS');
  if (!Array.isArray(p.alignments) || !Array.isArray(p.profiles)) fail('COLLECTIONS');
  const alignmentIds = new Set(); const segmentIds = new Set(); let segmentCount = 0;
  for (const alignment of p.alignments) { keys(alignment, ['id', 'name', 'startStationM', 'endStationM', 'segments'], 'ALIGNMENT'); if (!ID.test(alignment.id) || alignmentIds.has(alignment.id) || typeof alignment.name !== 'string' || !finite(alignment.startStationM) || !finite(alignment.endStationM) || alignment.endStationM <= alignment.startStationM || !Array.isArray(alignment.segments) || alignment.segments.length === 0) fail('ALIGNMENT'); alignmentIds.add(alignment.id); let station = alignment.startStationM; for (const segment of alignment.segments) { validateSegment(segment); if (segment.startStationM !== station) fail('SEGMENT_COVERAGE'); station = segment.endStationM; if (segmentIds.has(segment.id)) fail('DUPLICATE_ID'); segmentIds.add(segment.id); segmentCount++; } if (station !== alignment.endStationM) fail('ALIGNMENT_COVERAGE'); }
  const profileIds = new Set(); const pviIds = []; let pviCount = 0;
  for (const profile of p.profiles) { keys(profile, ['id', 'alignmentId', 'kind', 'startStationM', 'endStationM', 'points'], 'PROFILE'); if (!ID.test(profile.id) || profileIds.has(profile.id) || !alignmentIds.has(profile.alignmentId) || !['existing', 'proposed'].includes(profile.kind) || !Array.isArray(profile.points) || profile.points.length < 2) fail('PROFILE'); profileIds.add(profile.id); const stations = profile.points.map((point) => { keys(point, ['stationM', 'elevationM'], 'PVI'); if (!finite(point.stationM) || !finite(point.elevationM)) fail('PVI_GEOMETRY'); return point.stationM; }); if (!increasing(stations) || profile.startStationM !== stations[0] || profile.endStationM !== stations.at(-1)) fail('PVI_STATION'); const alignment = p.alignments.find((item) => item.id === profile.alignmentId); if (profile.startStationM > alignment.startStationM || profile.endStationM < alignment.endStationM) fail('PROFILE_COVERAGE'); profile.points.forEach((_, index) => pviIds.push(`${profile.id}:pvi-${String(index).padStart(4, '0')}`)); pviCount += profile.points.length; }
  const counts = { alignmentCount: p.alignments.length, segmentCount, profileCount: p.profiles.length, pviCount }; if (canonical(p.counts) !== canonical(counts)) fail('COUNTS'); if (sha256(canonical(p)) !== artifact.contentHash) fail('CONTENT_HASH_MISMATCH');
  return { artifact, stableIds: { alignments: [...alignmentIds], segments: [...segmentIds], profiles: [...profileIds], pvis: pviIds }, artifactSha256: sha256(input), parserOutput: canonical(p) };
}
