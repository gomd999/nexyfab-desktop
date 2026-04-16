/**
 * 3MF (3D Manufacturing Format) exporter.
 *
 * 3MF is a ZIP container with three required parts:
 *   - [Content_Types].xml
 *   - _rels/.rels
 *   - 3D/3dmodel.model    (OPC-style XML with mesh data)
 *
 * We emit a minimal-but-valid 3MF that opens in Bambu Studio, PrusaSlicer,
 * Cura, Windows 3D Viewer, and Microsoft 3D Builder. The ZIP is written with
 * the "store" method (no compression) so we don't need a DEFLATE implementation.
 */

import * as THREE from 'three';

// ─── CRC32 (IEEE 802.3) ─────────────────────────────────────────────────────

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ─── Minimal ZIP writer (store method) ──────────────────────────────────────

interface ZipEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  offset: number;
}

function encodeUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function buildZip(files: Array<{ name: string; content: string }>): Blob {
  const entries: ZipEntry[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;

  // Local file records
  for (const f of files) {
    const nameBytes = encodeUtf8(f.name);
    const data = encodeUtf8(f.content);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);     // local file header signature
    view.setUint16(4, 20, true);              // version needed
    view.setUint16(6, 0, true);               // general purpose flags
    view.setUint16(8, 0, true);               // compression (0 = store)
    view.setUint16(10, 0, true);              // mod time
    view.setUint16(12, 0x21, true);           // mod date (1980-01-01 ish)
    view.setUint32(14, crc, true);            // CRC-32
    view.setUint32(18, data.length, true);    // compressed size
    view.setUint32(22, data.length, true);    // uncompressed size
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);              // extra length
    local.set(nameBytes, 30);

    entries.push({ name: f.name, data, crc, offset });
    chunks.push(local);
    chunks.push(data);
    offset += local.length + data.length;
  }

  // Central directory
  const centralStart = offset;
  for (const e of entries) {
    const nameBytes = encodeUtf8(e.name);
    const central = new Uint8Array(46 + nameBytes.length);
    const view = new DataView(central.buffer);
    view.setUint32(0, 0x02014b50, true);      // central dir signature
    view.setUint16(4, 20, true);              // version made by
    view.setUint16(6, 20, true);              // version needed
    view.setUint16(8, 0, true);               // flags
    view.setUint16(10, 0, true);              // compression
    view.setUint16(12, 0, true);              // mod time
    view.setUint16(14, 0x21, true);           // mod date
    view.setUint32(16, e.crc, true);
    view.setUint32(20, e.data.length, true);  // compressed size
    view.setUint32(24, e.data.length, true);  // uncompressed size
    view.setUint16(28, nameBytes.length, true);
    view.setUint16(30, 0, true);              // extra length
    view.setUint16(32, 0, true);              // comment length
    view.setUint16(34, 0, true);              // disk number
    view.setUint16(36, 0, true);              // internal attrs
    view.setUint32(38, 0, true);              // external attrs
    view.setUint32(42, e.offset, true);       // local header offset
    central.set(nameBytes, 46);
    chunks.push(central);
    offset += central.length;
  }
  const centralSize = offset - centralStart;

  // End of central directory record
  const eocd = new Uint8Array(22);
  const v = new DataView(eocd.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(4, 0, true);               // disk number
  v.setUint16(6, 0, true);               // disk where central dir starts
  v.setUint16(8, entries.length, true);  // entries on this disk
  v.setUint16(10, entries.length, true); // total entries
  v.setUint32(12, centralSize, true);
  v.setUint32(16, centralStart, true);
  v.setUint16(20, 0, true);              // comment length
  chunks.push(eocd);

  return new Blob(chunks as BlobPart[], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
}

// ─── 3MF XML emission ───────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Slicer-friendly metadata. Most slicers (PrusaSlicer, Cura, OrcaSlicer)
 * read free-form `<metadata name="...">` entries from 3MF and surface them
 * in the project info panel. We use prefix `nexyfab:*` so they don't collide
 * with the standard core metadata names.
 */
export interface SliceMetadata {
  process?: string;          // 'fdm' | 'sla' | 'sls'
  layerHeight?: number;      // mm
  infillPercent?: number;    // 0–100
  printSpeed?: number;       // mm/s
  buildDirection?: [number, number, number];
  materialId?: string;
  estimatedTimeMin?: number;
  estimatedCostUsd?: number;
}

function buildModelXml(geometry: THREE.BufferGeometry, name: string, meta?: SliceMetadata): string {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = geo.attributes.position;
  if (!pos) throw new Error('Geometry has no position attribute');

  const triCount = Math.floor(pos.count / 3);

  // Deduplicate vertices (3MF cares about shared vertices for manifold meshes).
  // Key by rounded coordinates to collapse float jitter.
  const vertices: number[] = [];
  const indexOf = new Map<string, number>();
  const triangles: Array<[number, number, number]> = [];

  const fmt = (n: number): string => {
    if (!Number.isFinite(n)) return '0';
    const r = Math.round(n * 1e6) / 1e6;
    return Object.is(r, -0) ? '0' : r.toString();
  };

  for (let t = 0; t < triCount; t++) {
    const idx: number[] = [];
    for (let j = 0; j < 3; j++) {
      const i = t * 3 + j;
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const key = `${fmt(x)},${fmt(y)},${fmt(z)}`;
      let vid = indexOf.get(key);
      if (vid === undefined) {
        vid = vertices.length / 3;
        vertices.push(x, y, z);
        indexOf.set(key, vid);
      }
      idx.push(vid);
    }
    // Drop degenerate triangles (two or more shared indices).
    if (idx[0] !== idx[1] && idx[1] !== idx[2] && idx[0] !== idx[2]) {
      triangles.push([idx[0], idx[1], idx[2]]);
    }
  }

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">');
  lines.push('  <metadata name="Application">NexyFab Shape Generator</metadata>');
  lines.push(`  <metadata name="Title">${xmlEscape(name)}</metadata>`);
  lines.push(`  <metadata name="CreationDate">${new Date().toISOString()}</metadata>`);
  if (meta) {
    if (meta.process)            lines.push(`  <metadata name="nexyfab:process">${xmlEscape(meta.process)}</metadata>`);
    if (meta.layerHeight != null) lines.push(`  <metadata name="nexyfab:layer_height_mm">${meta.layerHeight}</metadata>`);
    if (meta.infillPercent != null) lines.push(`  <metadata name="nexyfab:infill_percent">${meta.infillPercent}</metadata>`);
    if (meta.printSpeed != null) lines.push(`  <metadata name="nexyfab:print_speed_mm_s">${meta.printSpeed}</metadata>`);
    if (meta.buildDirection)     lines.push(`  <metadata name="nexyfab:build_direction">${meta.buildDirection.join(',')}</metadata>`);
    if (meta.materialId)         lines.push(`  <metadata name="nexyfab:material">${xmlEscape(meta.materialId)}</metadata>`);
    if (meta.estimatedTimeMin != null) lines.push(`  <metadata name="nexyfab:estimated_time_min">${meta.estimatedTimeMin.toFixed(1)}</metadata>`);
    if (meta.estimatedCostUsd != null) lines.push(`  <metadata name="nexyfab:estimated_cost_usd">${meta.estimatedCostUsd.toFixed(2)}</metadata>`);
  }
  lines.push('  <resources>');
  lines.push('    <object id="1" type="model">');
  lines.push('      <mesh>');
  lines.push('        <vertices>');
  for (let i = 0; i < vertices.length; i += 3) {
    lines.push(`          <vertex x="${fmt(vertices[i])}" y="${fmt(vertices[i + 1])}" z="${fmt(vertices[i + 2])}"/>`);
  }
  lines.push('        </vertices>');
  lines.push('        <triangles>');
  for (const tri of triangles) {
    lines.push(`          <triangle v1="${tri[0]}" v2="${tri[1]}" v3="${tri[2]}"/>`);
  }
  lines.push('        </triangles>');
  lines.push('      </mesh>');
  lines.push('    </object>');
  lines.push('  </resources>');
  lines.push('  <build>');
  lines.push('    <item objectid="1"/>');
  lines.push('  </build>');
  lines.push('</model>');
  return lines.join('\n');
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

// ─── Public API ─────────────────────────────────────────────────────────────

export function build3MFBlob(geometry: THREE.BufferGeometry, name = 'model', meta?: SliceMetadata): Blob {
  const modelXml = buildModelXml(geometry, name, meta);
  return buildZip([
    { name: '[Content_Types].xml', content: CONTENT_TYPES_XML },
    { name: '_rels/.rels', content: RELS_XML },
    { name: '3D/3dmodel.model', content: modelXml },
  ]);
}

export function export3MF(geometry: THREE.BufferGeometry, filename = 'model', meta?: SliceMetadata): void {
  const blob = build3MFBlob(geometry, filename, meta);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.3mf`;
  a.click();
  URL.revokeObjectURL(url);
}
