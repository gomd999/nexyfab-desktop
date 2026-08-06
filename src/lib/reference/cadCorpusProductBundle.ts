import { createHash } from 'node:crypto';
import path from 'node:path';

export type CadProductBundleRole = 'authoritative_geometry' | 'exchange_assembly' | 'native_assembly' | 'native_part' | 'mesh_part' | 'drawing' | 'documentation' | 'motion_reference' | 'reference_visual' | 'unknown';
export interface CadProductBundleSource { relativePath: string; bytes: Uint8Array; }
export interface CadProductBundleMember { relativePath: string; extension: string; role: CadProductBundleRole; sizeBytes: number; sha256: string; }
export interface CadProductBundleManifest { schema: 'nexyfab.cad-product-bundle.v1'; lineageId: string; members: CadProductBundleMember[]; roles: Partial<Record<CadProductBundleRole, number>>; warnings: string[]; }

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const normalized = (value: string) => value.replaceAll('\\', '/');

export function cadProductLineageId(relativePath: string): string | null {
  const segments = normalized(relativePath).split('/').filter(Boolean);
  const snapshotIndex = segments.findIndex(segment => /\.snapshot\.\d+(?:\s*\(\d+\))?$/i.test(segment));
  if (snapshotIndex < 0) return null;
  return segments.slice(0, snapshotIndex + 1).join('/').toLowerCase();
}

export function classifyCadProductBundleRole(relativePath: string): CadProductBundleRole {
  const extension = path.extname(relativePath).slice(1).toLowerCase();
  if (extension === 'x_t' || extension === 'x_b' || extension === 'xmt_txt') return 'authoritative_geometry';
  if (extension === 'step' || extension === 'stp') return 'exchange_assembly';
  if (extension === 'sldasm' || extension === 'iam') return 'native_assembly';
  if (extension === 'sldprt' || extension === 'ipt') return 'native_part';
  if (extension === 'stl' || extension === 'obj' || extension === '3mf') return 'mesh_part';
  if (extension === 'dxf' || extension === 'dwg') return 'drawing';
  if (extension === 'pdf' || extension === 'md' || extension === 'txt') return 'documentation';
  if (extension === 'gif' || extension === 'mp4' || extension === 'mov') return 'motion_reference';
  if (extension === 'png' || extension === 'jpg' || extension === 'jpeg' || extension === 'webp') return 'reference_visual';
  return 'unknown';
}

export function buildCadProductBundleManifest(sources: readonly CadProductBundleSource[]): CadProductBundleManifest {
  if (!sources.length) throw new Error('product_bundle_sources_required');
  const lineages = new Set(sources.map(source => cadProductLineageId(source.relativePath)));
  if (lineages.has(null) || lineages.size !== 1) throw new Error('cross_lineage_product_bundle_forbidden');
  const seenPaths = new Set<string>(), members: CadProductBundleMember[] = [];
  for (const source of sources) {
    const relativePath = normalized(source.relativePath);
    const key = relativePath.toLowerCase();
    if (seenPaths.has(key)) throw new Error(`duplicate_product_bundle_path:${relativePath}`);
    seenPaths.add(key);
    members.push({ relativePath, extension: path.extname(relativePath).slice(1).toLowerCase(), role: classifyCadProductBundleRole(relativePath), sizeBytes: source.bytes.byteLength, sha256: hash(source.bytes) });
  }
  members.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const roles: Partial<Record<CadProductBundleRole, number>> = {};
  for (const member of members) roles[member.role] = (roles[member.role] ?? 0) + 1;
  const warnings: string[] = [];
  if (!roles.authoritative_geometry && !roles.exchange_assembly && !roles.native_part) warnings.push('no_authoritative_or_exchange_geometry');
  if (!roles.native_assembly && !roles.exchange_assembly) warnings.push('assembly_semantics_unavailable');
  if (!roles.motion_reference) warnings.push('motion_reference_unavailable');
  return { schema: 'nexyfab.cad-product-bundle.v1', lineageId: [...lineages][0]!, members, roles, warnings };
}
