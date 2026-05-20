/**
 * usdaWriter.ts — Emit USD (Universal Scene Description) as ASCII.
 *
 * Apple Vision Pro / Meta Quest both consume USD natively. .usdz
 * is the platform-preferred container (a zip of .usda + textures);
 * this module ships the text body and a `package*` helper that
 * pairs with a separate zip step (FormData on the server).
 *
 * Output structure:
 *   #usda 1.0
 *     def Xform "ROOT" {
 *       def Mesh "Body1" {
 *         point3f[] points = [...]
 *         int[]     faceVertexCounts = [...]
 *         int[]     faceVertexIndices = [...]
 *       }
 *     }
 *
 * Material binding uses MaterialX-style preview surface (USD-native).
 */

export interface UsdMesh {
  /** Stable id (becomes the Prim name). */
  name: string;
  positions: number[];   // flat (x, y, z) triples
  /** Triangle indices (3-tuples). */
  indices: number[];
  /** Optional PBR material. */
  material?: UsdMaterial;
  /** Optional UV coords (matching positions). */
  uvs?: number[];
}

export interface UsdMaterial {
  name: string;
  baseColor: [number, number, number];
  metalness: number;
  roughness: number;
  opacity?: number;
}

export function writeUsda(meshes: UsdMesh[], opts: { upAxis?: 'Y' | 'Z' } = {}): string {
  const upAxis = opts.upAxis ?? 'Y';
  const lines: string[] = [];
  lines.push('#usda 1.0');
  lines.push(`(`);
  lines.push(`    upAxis = "${upAxis}"`);
  lines.push(`    metersPerUnit = 0.001`);
  lines.push(`)`);
  lines.push('');
  lines.push(`def Xform "ROOT"`);
  lines.push(`{`);

  for (const mesh of meshes) {
    lines.push(`    def Mesh "${sanitizeName(mesh.name)}"`);
    lines.push(`    {`);
    lines.push(`        point3f[] points = [${groupTriples(mesh.positions)}]`);
    // USD expects 3 per face for triangulated meshes.
    const faceCount = mesh.indices.length / 3;
    lines.push(`        int[] faceVertexCounts = [${Array(faceCount).fill(3).join(', ')}]`);
    lines.push(`        int[] faceVertexIndices = [${mesh.indices.join(', ')}]`);
    if (mesh.uvs) {
      lines.push(`        texCoord2f[] primvars:st = [${groupPairs(mesh.uvs)}] (`);
      lines.push(`            interpolation = "vertex"`);
      lines.push(`        )`);
    }
    if (mesh.material) {
      lines.push(`        rel material:binding = </ROOT/Materials/${sanitizeName(mesh.material.name)}>`);
    }
    lines.push(`    }`);
  }

  if (meshes.some(m => m.material)) {
    lines.push('');
    lines.push(`    def Scope "Materials"`);
    lines.push(`    {`);
    for (const mesh of meshes) {
      if (!mesh.material) continue;
      lines.push(...materialBlock(mesh.material));
    }
    lines.push(`    }`);
  }

  lines.push(`}`);
  return lines.join('\n');
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

function groupTriples(values: number[]): string {
  const triples: string[] = [];
  for (let i = 0; i < values.length; i += 3) {
    triples.push(`(${values[i]!.toFixed(4)}, ${values[i + 1]!.toFixed(4)}, ${values[i + 2]!.toFixed(4)})`);
  }
  return triples.join(', ');
}

function groupPairs(values: number[]): string {
  const pairs: string[] = [];
  for (let i = 0; i < values.length; i += 2) {
    pairs.push(`(${values[i]!.toFixed(4)}, ${values[i + 1]!.toFixed(4)})`);
  }
  return pairs.join(', ');
}

function materialBlock(mat: UsdMaterial): string[] {
  const sanitized = sanitizeName(mat.name);
  return [
    `        def Material "${sanitized}"`,
    `        {`,
    `            token outputs:surface.connect = </ROOT/Materials/${sanitized}/PreviewSurface.outputs:surface>`,
    `            def Shader "PreviewSurface"`,
    `            {`,
    `                uniform token info:id = "UsdPreviewSurface"`,
    `                color3f inputs:diffuseColor = (${mat.baseColor[0].toFixed(3)}, ${mat.baseColor[1].toFixed(3)}, ${mat.baseColor[2].toFixed(3)})`,
    `                float inputs:metallic = ${mat.metalness.toFixed(3)}`,
    `                float inputs:roughness = ${mat.roughness.toFixed(3)}`,
    ...(mat.opacity !== undefined ? [`                float inputs:opacity = ${mat.opacity.toFixed(3)}`] : []),
    `                token outputs:surface`,
    `            }`,
    `        }`,
  ];
}

/** Convenience — combine mesh + material into a USDA scene with a
 *  single body for inline preview. */
export function writeSingleMeshUsda(
  positions: number[],
  indices: number[],
  material?: UsdMaterial,
): string {
  return writeUsda([{ name: 'Part', positions, indices, material }]);
}
