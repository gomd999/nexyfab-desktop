/**
 * gltfWriter.ts — glTF 2.0 export (JSON form only — binary glb
 * packaging is a follow-up).
 *
 * Three.js / Babylon / WebXR / Hubs / Mozilla / Quest browsers all
 * read glTF 2.0. The format is JSON + binary buffers (`.bin`) +
 * optional textures. This module emits the JSON manifest and a
 * sidecar binary buffer; the caller packages them as `.glb` if
 * needed.
 *
 * Materials: PBR Metallic-Roughness (the glTF core extension).
 * Mapping is straight-forward from NexyFab's PBR params.
 */

export interface GltfMesh {
  name: string;
  positions: number[];
  indices: number[];
  normals?: number[];
  uvs?: number[];
  material?: GltfMaterial;
}

export interface GltfMaterial {
  name: string;
  baseColor: [number, number, number, number]; // RGBA, A=1 for opaque
  metalness: number;
  roughness: number;
  doubleSided?: boolean;
}

export interface GltfDocument {
  /** JSON body — written as glTF / scene description. */
  json: object;
  /** Binary buffer body — appended in glb container. */
  bin: ArrayBuffer;
}

/** Build a glTF 2.0 JSON + binary buffer. */
export function writeGltf(meshes: GltfMesh[]): GltfDocument {
  // Lay out the binary buffer: per mesh, [positions, indices, normals?, uvs?]
  // Each accessor knows its offset + length.
  const segments: Array<{ data: Float32Array | Uint32Array; bufferView: number }> = [];
  const bufferViews: Array<{ byteOffset: number; byteLength: number; target: number }> = [];
  const accessors: Array<{
    bufferView: number;
    componentType: number;
    count: number;
    type: string;
    min?: number[];
    max?: number[];
  }> = [];
  const meshDefs: Array<{
    primitives: Array<{
      attributes: Record<string, number>;
      indices?: number;
      material?: number;
    }>;
    name: string;
  }> = [];
  const materials: object[] = [];

  let byteOffset = 0;

  for (const mesh of meshes) {
    const primitive: { attributes: Record<string, number>; indices?: number; material?: number } = {
      attributes: {},
    };

    // POSITION
    const posData = new Float32Array(mesh.positions);
    const posBV = pushBufferView(bufferViews, segments, posData, byteOffset, 34962);
    byteOffset += posData.byteLength;
    const posMin = computeMin(mesh.positions, 3);
    const posMax = computeMax(mesh.positions, 3);
    primitive.attributes.POSITION = accessors.length;
    accessors.push({
      bufferView: posBV,
      componentType: 5126, // FLOAT
      count: mesh.positions.length / 3,
      type: 'VEC3',
      min: posMin,
      max: posMax,
    });

    // NORMAL (optional)
    if (mesh.normals) {
      const normData = new Float32Array(mesh.normals);
      const normBV = pushBufferView(bufferViews, segments, normData, byteOffset, 34962);
      byteOffset += normData.byteLength;
      primitive.attributes.NORMAL = accessors.length;
      accessors.push({
        bufferView: normBV,
        componentType: 5126,
        count: mesh.normals.length / 3,
        type: 'VEC3',
      });
    }

    // TEXCOORD (optional)
    if (mesh.uvs) {
      const uvData = new Float32Array(mesh.uvs);
      const uvBV = pushBufferView(bufferViews, segments, uvData, byteOffset, 34962);
      byteOffset += uvData.byteLength;
      primitive.attributes.TEXCOORD_0 = accessors.length;
      accessors.push({
        bufferView: uvBV,
        componentType: 5126,
        count: mesh.uvs.length / 2,
        type: 'VEC2',
      });
    }

    // INDICES
    const idxData = new Uint32Array(mesh.indices);
    const idxBV = pushBufferView(bufferViews, segments, idxData, byteOffset, 34963);
    byteOffset += idxData.byteLength;
    primitive.indices = accessors.length;
    accessors.push({
      bufferView: idxBV,
      componentType: 5125, // UNSIGNED_INT
      count: mesh.indices.length,
      type: 'SCALAR',
    });

    // MATERIAL (optional)
    if (mesh.material) {
      primitive.material = materials.length;
      materials.push({
        name: mesh.material.name,
        pbrMetallicRoughness: {
          baseColorFactor: mesh.material.baseColor,
          metallicFactor: mesh.material.metalness,
          roughnessFactor: mesh.material.roughness,
        },
        doubleSided: mesh.material.doubleSided ?? false,
      });
    }

    meshDefs.push({ primitives: [primitive], name: mesh.name });
  }

  // Assemble binary buffer.
  const bin = new ArrayBuffer(byteOffset);
  const binView = new Uint8Array(bin);
  let cursor = 0;
  for (const seg of segments) {
    const bytes = new Uint8Array(seg.data.buffer, seg.data.byteOffset, seg.data.byteLength);
    binView.set(bytes, cursor);
    cursor += seg.data.byteLength;
  }

  const json: object = {
    asset: { version: '2.0', generator: 'NexyFab' },
    scene: 0,
    scenes: [{ nodes: meshDefs.map((_, i) => i) }],
    nodes: meshDefs.map((_, i) => ({ mesh: i })),
    meshes: meshDefs,
    accessors,
    bufferViews,
    buffers: [{ byteLength: byteOffset }],
    ...(materials.length > 0 ? { materials } : {}),
  };

  return { json, bin };
}

function pushBufferView(
  bufferViews: Array<{ byteOffset: number; byteLength: number; target: number }>,
  segments: Array<{ data: Float32Array | Uint32Array; bufferView: number }>,
  data: Float32Array | Uint32Array,
  offset: number,
  target: number,
): number {
  const idx = bufferViews.length;
  bufferViews.push({
    byteOffset: offset,
    byteLength: data.byteLength,
    target,
  });
  segments.push({ data, bufferView: idx });
  return idx;
}

function computeMin(values: number[], components: number): number[] {
  const result = new Array(components).fill(Infinity);
  for (let i = 0; i < values.length; i += components) {
    for (let k = 0; k < components; k++) {
      if (values[i + k]! < result[k]) result[k] = values[i + k]!;
    }
  }
  return result;
}

function computeMax(values: number[], components: number): number[] {
  const result = new Array(components).fill(-Infinity);
  for (let i = 0; i < values.length; i += components) {
    for (let k = 0; k < components; k++) {
      if (values[i + k]! > result[k]) result[k] = values[i + k]!;
    }
  }
  return result;
}
