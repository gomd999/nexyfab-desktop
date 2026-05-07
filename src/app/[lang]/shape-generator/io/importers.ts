import * as THREE from 'three';
import { publicWasmUrl } from '../lib/publicWasmUrl';
import { trackGeometry } from '../hooks/useGeometryGC';

// ─── STL Parser ─────────────────────────────────────────────────────────────

function isBinarySTL(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 84) return false;
  const view = new DataView(buffer);
  const faceCount = view.getUint32(80, true);
  const expectedSize = 84 + faceCount * 50;
  // Binary STL: header(80) + faceCount(4) + faces(50 each)
  if (Math.abs(buffer.byteLength - expectedSize) < 10) return true;
  // Check if starts with "solid" (ASCII STL)
  const header = new Uint8Array(buffer, 0, 5);
  const text = String.fromCharCode(...header);
  if (text === 'solid') {
    // Could still be binary if "solid" appears in header
    const decoder = new TextDecoder();
    const first1k = decoder.decode(new Uint8Array(buffer, 0, Math.min(1024, buffer.byteLength)));
    return !first1k.includes('facet');
  }
  return true;
}

function parseBinarySTL(buffer: ArrayBuffer): THREE.BufferGeometry {
  const view = new DataView(buffer);
  const faceCount = view.getUint32(80, true);
  const positions = new Float32Array(faceCount * 9);
  const normals = new Float32Array(faceCount * 9);

  for (let i = 0; i < faceCount; i++) {
    const offset = 84 + i * 50;
    const nx = view.getFloat32(offset, true);
    const ny = view.getFloat32(offset + 4, true);
    const nz = view.getFloat32(offset + 8, true);
    for (let v = 0; v < 3; v++) {
      const vOffset = offset + 12 + v * 12;
      const idx = i * 9 + v * 3;
      positions[idx] = view.getFloat32(vOffset, true);
      positions[idx + 1] = view.getFloat32(vOffset + 4, true);
      positions[idx + 2] = view.getFloat32(vOffset + 8, true);
      normals[idx] = nx;
      normals[idx + 1] = ny;
      normals[idx + 2] = nz;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geo;
}

function parseASCIISTL(text: string): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  let currentNormal = [0, 0, 0];

  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('facet normal')) {
      const parts = trimmed.split(/\s+/);
      currentNormal = [parseFloat(parts[2]), parseFloat(parts[3]), parseFloat(parts[4])];
    } else if (trimmed.startsWith('vertex')) {
      const parts = trimmed.split(/\s+/);
      positions.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
      normals.push(...currentNormal);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  return geo;
}

export function parseSTL(buffer: ArrayBuffer): THREE.BufferGeometry {
  if (isBinarySTL(buffer)) {
    return parseBinarySTL(buffer);
  }
  const decoder = new TextDecoder();
  return parseASCIISTL(decoder.decode(buffer));
}

// ─── OBJ Parser ─────────────────────────────────────────────────────────────

export function parseOBJ(text: string): THREE.BufferGeometry {
  const vertices: number[][] = [];
  const vertexNormals: number[][] = [];
  const positions: number[] = [];
  const normals: number[] = [];

  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed.length === 0) continue;

    const parts = trimmed.split(/\s+/);
    const type = parts[0];

    if (type === 'v') {
      vertices.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
    } else if (type === 'vn') {
      vertexNormals.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
    } else if (type === 'f') {
      const faceVerts: { v: number; n: number }[] = [];
      for (let i = 1; i < parts.length; i++) {
        const indices = parts[i].split('/');
        const vi = parseInt(indices[0]) - 1;
        const ni = indices[2] ? parseInt(indices[2]) - 1 : -1;
        faceVerts.push({ v: vi, n: ni });
      }
      // Triangulate (fan from first vertex)
      for (let i = 1; i < faceVerts.length - 1; i++) {
        const tri = [faceVerts[0], faceVerts[i], faceVerts[i + 1]];
        for (const fv of tri) {
          const vert = vertices[fv.v];
          if (!vert) continue;
          positions.push(vert[0], vert[1], vert[2]);
          if (fv.n >= 0 && vertexNormals[fv.n]) {
            normals.push(vertexNormals[fv.n][0], vertexNormals[fv.n][1], vertexNormals[fv.n][2]);
          } else {
            normals.push(0, 0, 0);
          }
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  if (normals.some(n => n === 0)) geo.computeVertexNormals();
  return geo;
}

// ─── PLY Parser ─────────────────────────────────────────────────────────────

export function parsePLY(buffer: ArrayBuffer): THREE.BufferGeometry {
  const decoder = new TextDecoder();
  const text = decoder.decode(buffer);
  const headerEnd = text.indexOf('end_header');
  if (headerEnd === -1) throw new Error('Invalid PLY: no end_header found');

  const header = text.substring(0, headerEnd);
  const lines = header.split('\n');

  let vertexCount = 0;
  let faceCount = 0;
  let isBinary = false;
  const vertexProps: string[] = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'format') {
      isBinary = parts[1] !== 'ascii';
    } else if (parts[0] === 'element' && parts[1] === 'vertex') {
      vertexCount = parseInt(parts[2]);
    } else if (parts[0] === 'element' && parts[1] === 'face') {
      faceCount = parseInt(parts[2]);
    } else if (parts[0] === 'property' && vertexCount > 0 && faceCount === 0) {
      vertexProps.push(parts[2]);
    }
  }

  if (isBinary) {
    return parseBinaryPLY(buffer, headerEnd + 'end_header\n'.length, vertexCount, faceCount, vertexProps);
  }

  // ASCII PLY
  const body = text.substring(headerEnd + 'end_header\n'.length);
  const bodyLines = body.trim().split('\n');

  const vertices: number[][] = [];
  const hasNormals = vertexProps.includes('nx');

  for (let i = 0; i < vertexCount; i++) {
    const parts = bodyLines[i].trim().split(/\s+/).map(Number);
    vertices.push(parts);
  }

  const positions: number[] = [];
  const normals: number[] = [];

  for (let i = 0; i < faceCount; i++) {
    const parts = bodyLines[vertexCount + i].trim().split(/\s+/).map(Number);
    const count = parts[0];
    // Triangulate
    for (let j = 1; j < count - 1; j++) {
      const tri = [parts[1], parts[j + 1], parts[j + 2]];
      for (const vi of tri) {
        const v = vertices[vi];
        if (!v) continue;
        positions.push(v[0], v[1], v[2]);
        if (hasNormals && v.length >= 6) {
          const nxi = vertexProps.indexOf('nx');
          normals.push(v[nxi], v[nxi + 1], v[nxi + 2]);
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  if (normals.length > 0) {
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  } else {
    geo.computeVertexNormals();
  }
  return geo;
}

function parseBinaryPLY(
  buffer: ArrayBuffer, dataStart: number,
  vertexCount: number, faceCount: number, vertexProps: string[],
): THREE.BufferGeometry {
  const view = new DataView(buffer);
  const floatSize = 4;
  const propsPerVertex = vertexProps.length;
  const hasNormals = vertexProps.includes('nx');

  const vertices: Float32Array = new Float32Array(vertexCount * 3);
  const vertNormals: Float32Array | null = hasNormals ? new Float32Array(vertexCount * 3) : null;

  let offset = dataStart;
  const nxi = vertexProps.indexOf('nx');

  for (let i = 0; i < vertexCount; i++) {
    vertices[i * 3] = view.getFloat32(offset, true);
    vertices[i * 3 + 1] = view.getFloat32(offset + 4, true);
    vertices[i * 3 + 2] = view.getFloat32(offset + 8, true);
    if (vertNormals && nxi >= 0) {
      vertNormals[i * 3] = view.getFloat32(offset + nxi * floatSize, true);
      vertNormals[i * 3 + 1] = view.getFloat32(offset + (nxi + 1) * floatSize, true);
      vertNormals[i * 3 + 2] = view.getFloat32(offset + (nxi + 2) * floatSize, true);
    }
    offset += propsPerVertex * floatSize;
  }

  const positions: number[] = [];
  const normals: number[] = [];

  for (let i = 0; i < faceCount; i++) {
    const count = view.getUint8(offset); offset += 1;
    const indices: number[] = [];
    for (let j = 0; j < count; j++) {
      indices.push(view.getInt32(offset, true)); offset += 4;
    }
    for (let j = 1; j < count - 1; j++) {
      const tri = [indices[0], indices[j], indices[j + 1]];
      for (const vi of tri) {
        positions.push(vertices[vi * 3], vertices[vi * 3 + 1], vertices[vi * 3 + 2]);
        if (vertNormals) {
          normals.push(vertNormals[vi * 3], vertNormals[vi * 3 + 1], vertNormals[vi * 3 + 2]);
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  if (normals.length > 0) {
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  } else {
    geo.computeVertexNormals();
  }
  return geo;
}

// ─── STEP / IGES / BREP Parser (occt-import-js) ───────────────────────────

async function parseOCCT(
  buffer: ArrayBuffer,
  reader: 'ReadIgesFile' | 'ReadBrepFile',
): Promise<THREE.BufferGeometry> {
  const occtimport = (await import('occt-import-js')).default;
  const occt = await occtimport({
    locateFile: (p: string) => (p.endsWith('.wasm') ? publicWasmUrl('occt-import-js.wasm') : p),
  });

  const fileBuffer = new Uint8Array(buffer);
  const result = occt[reader](fileBuffer, null);

  if (!result.success || !result.meshes || result.meshes.length === 0) {
    throw new Error(`OCCT import failed: no meshes produced`);
  }

  const allPositions: number[] = [];
  const allNormals: number[] = [];
  const allIndices: number[] = [];
  let indexOffset = 0;

  for (const mesh of result.meshes) {
    const pos = mesh.attributes.position.array;
    const norm = mesh.attributes.normal?.array;
    const idx = mesh.index?.array;

    for (let i = 0; i < pos.length; i++) allPositions.push(pos[i]);
    if (norm) {
      for (let i = 0; i < norm.length; i++) allNormals.push(norm[i]);
    }

    if (idx) {
      for (let i = 0; i < idx.length; i++) allIndices.push(idx[i] + indexOffset);
    }
    indexOffset += pos.length / 3;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(allPositions), 3));
  if (allNormals.length > 0) {
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(allNormals), 3));
  }
  if (allIndices.length > 0) {
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(allIndices), 1));
  }
  return geo;
}

export async function parseSTEP(buffer: ArrayBuffer) {
  const { importStepFile } = await import('./stepImporter');
  const result = await importStepFile(buffer);
  return result;
}

export async function parseIGES(buffer: ArrayBuffer): Promise<THREE.BufferGeometry> {
  return parseOCCT(buffer, 'ReadIgesFile');
}

export async function parseBREP(buffer: ArrayBuffer): Promise<THREE.BufferGeometry> {
  return parseOCCT(buffer, 'ReadBrepFile');
}

// ─── DXF → 3D geometry (extrude 2D profile) ──────────────────────────────

import { parseDXF } from './dxfParser';
import type { DXFEntity, DXFParseResult } from './dxfParser';

export { parseDXF } from './dxfParser';
export type { DXFEntity, DXFParseResult } from './dxfParser';

/**
 * Parse a DXF file and convert to a 3D BufferGeometry by extruding the 2D profile.
 * @param text  Raw DXF file content (ASCII)
 * @param extrudeDepth  Depth to extrude in mm (default 10)
 */
export function parseDXFFile(text: string, extrudeDepth = 10): THREE.BufferGeometry {
  const { entities, bounds } = parseDXF(text);
  if (entities.length === 0) {
    throw new Error('DXF file contains no supported entities');
  }

  // Build a THREE.Shape from the DXF entities
  const shape = new THREE.Shape();
  let started = false;

  for (const entity of entities) {
    if (entity.points.length < 2) continue;

    if (entity.type === 'CIRCLE' && entity.center && entity.radius) {
      // Full circle → create a separate shape via absarc
      const circleShape = new THREE.Shape();
      circleShape.absarc(entity.center[0], entity.center[1], entity.radius, 0, Math.PI * 2, false);
      // If there are only circles, use the first one
      if (!started) {
        shape.absarc(entity.center[0], entity.center[1], entity.radius, 0, Math.PI * 2, false);
        started = true;
      }
      continue;
    }

    // For line-like entities, trace the path
    for (let i = 0; i < entity.points.length; i++) {
      const [x, y] = entity.points[i];
      if (!started && i === 0) {
        shape.moveTo(x, y);
        started = true;
      } else {
        shape.lineTo(x, y);
      }
    }
  }

  if (!started) {
    throw new Error('DXF file contains no geometry that could be converted');
  }

  // Extrude the 2D shape into 3D
  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    depth: extrudeDepth,
    bevelEnabled: false,
  };
  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  return geometry;
}

// ─── Universal importer ────────────────────────────────────────────────────

/** Import mesh/CAD from filename + buffer (Tauri native open or unified picker). */
export async function importPayload(
  filename: string,
  buffer: ArrayBuffer,
): Promise<{
  geometry: THREE.BufferGeometry;
  format: string;
  filename: string;
  parts?: { geometry: THREE.BufferGeometry; name: string }[];
}> {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  let geometry: THREE.BufferGeometry;
  let parts: { geometry: THREE.BufferGeometry; name: string }[] | undefined;
  const textDecoder = new TextDecoder();

  if (ext === 'stl') {
    geometry = parseSTL(buffer);
  } else if (ext === 'obj') {
    geometry = parseOBJ(textDecoder.decode(buffer));
  } else if (ext === 'ply') {
    geometry = parsePLY(buffer);
  } else if (ext === 'step' || ext === 'stp') {
    const res = await parseSTEP(buffer);
    geometry = res.geometry;
    parts = res.parts;
  } else if (ext === 'iges' || ext === 'igs') {
    geometry = await parseIGES(buffer);
  } else if (ext === 'brep') {
    geometry = await parseBREP(buffer);
  } else if (ext === 'dxf') {
    geometry = parseDXFFile(textDecoder.decode(buffer));
  } else {
    throw new Error(`Unsupported format: .${ext}. Supported: STEP, IGES, BREP, STL, OBJ, PLY, DXF`);
  }

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  
  trackGeometry(geometry);
  if (parts) {
    parts.forEach(p => trackGeometry(p.geometry));
  }
  
  return { geometry, format: ext.toUpperCase(), filename, parts };
}

export async function importFile(file: File): Promise<{
  geometry: THREE.BufferGeometry;
  format: string;
  filename: string;
  parts?: { geometry: THREE.BufferGeometry; name: string }[];
}> {
  const buffer = await file.arrayBuffer();
  return importPayload(file.name, buffer);
}
