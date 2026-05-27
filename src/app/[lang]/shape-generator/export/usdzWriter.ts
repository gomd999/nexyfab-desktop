/**
 * usdzWriter.ts — USDZ export for iOS AR Quick Look.
 *
 * USDZ is the Apple-pushed AR format (Pixar Universal Scene Description,
 * zipped). iOS Safari / Messages / Mail render a USDZ link as a tap-to-
 * preview AR scene. For customer-facing CAD products this is the
 * cheapest way to put a part "in the room" on iPhones.
 *
 * Format layers:
 *
 *   1. **USD text payload** (.usda): scene graph with mesh primitives
 *      and material binds.
 *   2. **PNG textures** (optional): referenced by material `inputs:
 *      diffuseColor.connect`.
 *   3. **ZIP package** (.usdz): uncompressed ZIP wrapping the .usda
 *      + assets. The ZIP must use the STORED (not DEFLATE) method.
 *
 * This module produces the USDA text + a ZIP byte stream. We do
 * NOT validate against Apple's strict USDZ schema check — production
 * pipelines should run through `usdchecker` before shipping.
 */

export type Vec3 = [number, number, number];

export interface MeshArrays {
  positions: number[];
  indices: number[];
  /** Per-vertex normals (optional). */
  normals?: number[];
  /** Per-vertex UVs (optional). */
  uvs?: number[];
}

export interface UsdMaterial {
  id: string;
  /** Display name. */
  name: string;
  /** Diffuse RGB (0..1). */
  diffuseColor: Vec3;
  /** Roughness 0..1. */
  roughness?: number;
  /** Metallic 0..1. */
  metallic?: number;
  /** Optional texture file name (must be packed into zip). */
  diffuseTexture?: string;
}

export interface UsdMeshNode {
  /** Display name (must be valid USD identifier). */
  name: string;
  mesh: MeshArrays;
  /** Material bound to this mesh. */
  materialId?: string;
  /** Transform (4×4 row-major). Identity if omitted. */
  transformMatrix?: number[];
}

export interface UsdScene {
  /** Scene unit, default = 0.01 (cm) so Three.js mm models read correctly. */
  metersPerUnit?: number;
  /** Up axis. iOS expects "Y". */
  upAxis?: 'Y' | 'Z';
  /** All mesh nodes in the scene. */
  nodes: UsdMeshNode[];
  /** Material library. */
  materials: UsdMaterial[];
}

// ── USDA text emission ─────────────────────────────────────────

export function buildUsdaText(scene: UsdScene): string {
  const metersPerUnit = scene.metersPerUnit ?? 0.001;
  const upAxis = scene.upAxis ?? 'Y';
  const lines: string[] = [];
  lines.push('#usda 1.0');
  lines.push('(');
  lines.push(`    defaultPrim = "Root"`);
  lines.push(`    metersPerUnit = ${metersPerUnit}`);
  lines.push(`    upAxis = "${upAxis}"`);
  lines.push(')');
  lines.push('');
  lines.push('def Xform "Root"');
  lines.push('{');
  for (const node of scene.nodes) {
    emitMesh(node, scene, lines);
  }
  if (scene.materials.length > 0) {
    lines.push('    def Scope "Materials"');
    lines.push('    {');
    for (const mat of scene.materials) emitMaterial(mat, lines);
    lines.push('    }');
  }
  lines.push('}');
  return lines.join('\n');
}

function emitMesh(node: UsdMeshNode, scene: UsdScene, lines: string[]): void {
  const safeName = sanitizeIdentifier(node.name);
  lines.push(`    def Mesh "${safeName}"`);
  lines.push('    {');
  if (node.transformMatrix) {
    lines.push(`        matrix4d xformOp:transform = ${formatMatrix4(node.transformMatrix)}`);
    lines.push(`        uniform token[] xformOpOrder = ["xformOp:transform"]`);
  }
  // Points.
  const vertCount = node.mesh.positions.length / 3;
  const pts: string[] = [];
  for (let i = 0; i < vertCount; i++) {
    pts.push(`(${node.mesh.positions[i * 3]}, ${node.mesh.positions[i * 3 + 1]}, ${node.mesh.positions[i * 3 + 2]})`);
  }
  lines.push(`        point3f[] points = [${pts.join(', ')}]`);
  // FaceVertexCounts (3 each for triangle mesh).
  const triCount = node.mesh.indices.length / 3;
  lines.push(`        int[] faceVertexCounts = [${Array(triCount).fill(3).join(', ')}]`);
  // FaceVertexIndices.
  lines.push(`        int[] faceVertexIndices = [${node.mesh.indices.join(', ')}]`);
  // Normals (per-vertex).
  if (node.mesh.normals) {
    const ns: string[] = [];
    for (let i = 0; i < vertCount; i++) {
      ns.push(`(${node.mesh.normals[i * 3]}, ${node.mesh.normals[i * 3 + 1]}, ${node.mesh.normals[i * 3 + 2]})`);
    }
    lines.push(`        normal3f[] primvars:normals = [${ns.join(', ')}] (interpolation = "vertex")`);
  }
  // UVs.
  if (node.mesh.uvs) {
    const us: string[] = [];
    const uvCount = node.mesh.uvs.length / 2;
    for (let i = 0; i < uvCount; i++) {
      us.push(`(${node.mesh.uvs[i * 2]}, ${node.mesh.uvs[i * 2 + 1]})`);
    }
    lines.push(`        texCoord2f[] primvars:st = [${us.join(', ')}] (interpolation = "vertex")`);
  }
  // Material binding.
  if (node.materialId) {
    lines.push(`        rel material:binding = </Root/Materials/${sanitizeIdentifier(node.materialId)}>`);
  }
  lines.push('    }');
  void scene;
}

function emitMaterial(mat: UsdMaterial, lines: string[]): void {
  const safeId = sanitizeIdentifier(mat.id);
  lines.push(`        def Material "${safeId}"`);
  lines.push('        {');
  lines.push('            token outputs:surface.connect = <shader.outputs:surface>');
  lines.push('            def Shader "shader"');
  lines.push('            {');
  lines.push('                uniform token info:id = "UsdPreviewSurface"');
  lines.push(`                color3f inputs:diffuseColor = (${mat.diffuseColor[0]}, ${mat.diffuseColor[1]}, ${mat.diffuseColor[2]})`);
  if (mat.roughness !== undefined) lines.push(`                float inputs:roughness = ${mat.roughness}`);
  if (mat.metallic !== undefined) lines.push(`                float inputs:metallic = ${mat.metallic}`);
  lines.push('                token outputs:surface');
  lines.push('            }');
  lines.push('        }');
}

function sanitizeIdentifier(s: string): string {
  // USD identifiers: alphanumeric + underscore, must start with letter/underscore.
  let out = s.replace(/[^A-Za-z0-9_]/g, '_');
  if (/^[^A-Za-z_]/.test(out)) out = `_${out}`;
  return out || '_';
}

function formatMatrix4(m: number[]): string {
  if (m.length !== 16) return '((1,0,0,0), (0,1,0,0), (0,0,1,0), (0,0,0,1))';
  return `((${m[0]},${m[1]},${m[2]},${m[3]}), (${m[4]},${m[5]},${m[6]},${m[7]}), (${m[8]},${m[9]},${m[10]},${m[11]}), (${m[12]},${m[13]},${m[14]},${m[15]}))`;
}

// ── Package build (USDZ = uncompressed ZIP) ────────────────────

export interface UsdzAsset {
  /** File path inside the archive (e.g. "model.usda" or "tex/diffuse.png"). */
  name: string;
  /** Raw bytes. */
  data: Uint8Array;
}

export interface UsdzPackage {
  /** Raw bytes of the .usdz file. */
  bytes: Uint8Array;
  /** Assets included. */
  assets: UsdzAsset[];
}

/** Build a USDZ archive. The first asset MUST be the entry .usda. */
export function buildUsdzPackage(assets: UsdzAsset[]): UsdzPackage {
  const bytes = buildStoredZip(assets);
  return { bytes, assets };
}

/** ZIP file format (PKZIP) using STORED (no compression). */
function buildStoredZip(assets: UsdzAsset[]): Uint8Array {
  // Pre-pad each file to 4-byte alignment required by Apple's USDZ spec.
  const localHeaders: Array<{ headerBytes: number[]; padBytes: number; offset: number }> = [];
  const fileChunks: Uint8Array[] = [];
  let cursor = 0;
  const encoder = new TextEncoder();

  for (const asset of assets) {
    const nameBytes = encoder.encode(asset.name);
    const crc = crc32(asset.data);
    // Local file header.
    const headerSize = 30 + nameBytes.length;
    // Padding so the file data starts on a 4-byte boundary.
    const padBytes = (4 - ((cursor + headerSize) % 4)) % 4;

    const header: number[] = [];
    pushU32(header, 0x04034b50); // local file header signature
    pushU16(header, 20);          // version needed
    pushU16(header, 0);           // general purpose flag
    pushU16(header, 0);           // STORED
    pushU16(header, 0);           // last mod time
    pushU16(header, 0);           // last mod date
    pushU32(header, crc);
    pushU32(header, asset.data.length); // compressed
    pushU32(header, asset.data.length); // uncompressed
    pushU16(header, nameBytes.length);
    pushU16(header, padBytes);    // extra field length used as padding

    const arr = new Uint8Array(headerSize);
    arr.set(header);
    arr.set(nameBytes, 30);

    localHeaders.push({ headerBytes: header, padBytes, offset: cursor });
    fileChunks.push(arr);
    cursor += arr.length;
    if (padBytes > 0) {
      const pad = new Uint8Array(padBytes);
      fileChunks.push(pad);
      cursor += padBytes;
    }
    fileChunks.push(asset.data);
    cursor += asset.data.length;
  }

  // Central directory.
  const centralChunks: Uint8Array[] = [];
  let centralSize = 0;
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i]!;
    const header = localHeaders[i]!;
    const nameBytes = encoder.encode(asset.name);
    const central: number[] = [];
    pushU32(central, 0x02014b50);
    pushU16(central, 20);
    pushU16(central, 20);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU32(central, crc32(asset.data));
    pushU32(central, asset.data.length);
    pushU32(central, asset.data.length);
    pushU16(central, nameBytes.length);
    pushU16(central, 0); // extra field
    pushU16(central, 0); // comment
    pushU16(central, 0); // disk
    pushU16(central, 0); // internal attrs
    pushU32(central, 0); // external attrs
    pushU32(central, header.offset);
    const arr = new Uint8Array(46 + nameBytes.length);
    arr.set(central);
    arr.set(nameBytes, 46);
    centralChunks.push(arr);
    centralSize += arr.length;
  }
  const centralOffset = cursor;

  // End of central directory.
  const eocd: number[] = [];
  pushU32(eocd, 0x06054b50);
  pushU16(eocd, 0);
  pushU16(eocd, 0);
  pushU16(eocd, assets.length);
  pushU16(eocd, assets.length);
  pushU32(eocd, centralSize);
  pushU32(eocd, centralOffset);
  pushU16(eocd, 0);

  const eocdBytes = new Uint8Array(eocd);
  // Assemble.
  const totalSize = cursor + centralSize + eocdBytes.length;
  const out = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of fileChunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  for (const chunk of centralChunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  out.set(eocdBytes, offset);
  return out;
}

function pushU16(arr: number[], v: number): void {
  arr.push(v & 0xff, (v >>> 8) & 0xff);
}

function pushU32(arr: number[], v: number): void {
  arr.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
}

// ── CRC-32 (IEEE) ──────────────────────────────────────────────

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── Convenience: scene → USDZ bytes ────────────────────────────

export function exportSceneToUsdz(scene: UsdScene, entryName: string = 'model.usda'): UsdzPackage {
  const text = buildUsdaText(scene);
  const usdaBytes = new TextEncoder().encode(text);
  return buildUsdzPackage([{ name: entryName, data: usdaBytes }]);
}
