/**
 * RFQ (Request for Quotation) Package Generator
 *
 * Extends the manufacturing sidecar system to produce a complete,
 * buyer-ready RFQ bundle containing:
 *
 *  1. STEP file (tessellated AP242)
 *  2. Binary STL file
 *  3. Manufacturing manifest JSON (v2)
 *  4. Text summary README
 *  5. **RFQ form PDF** — human-readable purchase inquiry document
 *     including material, quantity, tolerance class, delivery notes.
 *  6. **Email draft** — markdown text the user can paste into any email
 *     client to send to a supplier.
 *
 * All outputs are bundled into a single ZIP download via fflate.
 *
 * Usage:
 *   const rfq = buildRfqPackage(geometry, meta, rfqOptions);
 *   await downloadRfqBundle(rfq, 'my-part');
 */

import * as THREE from 'three';
import { strToU8, zipSync } from 'fflate';
import { downloadBlob } from '@/lib/platform';
import { buildBinaryStl } from './stlEncode';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToleranceClass = 'rough' | 'medium' | 'fine' | 'ultra-fine';
export type SurfaceFinish = 'as-machined' | 'polished' | 'anodized' | 'powder-coated' | 'electroplated' | 'none';
export type DeliveryUrgency = 'standard' | 'expedited' | 'prototype';

export interface RfqOptions {
  /** Requested quantity */
  quantity: number;
  /** Material specification string, e.g. "Al 6061-T6" */
  materialSpec: string;
  /** ISO 2768 tolerance class */
  toleranceClass: ToleranceClass;
  /** Required surface finish */
  surfaceFinish: SurfaceFinish;
  /** Delivery urgency */
  deliveryUrgency: DeliveryUrgency;
  /** Any special notes for the supplier */
  notes?: string;
  /** Target unit price budget (optional, shown as "up to X") */
  targetUnitPriceBudget?: number;
  /** Currency code, default "USD" */
  currency?: string;
  /** Buyer company name */
  buyerCompany?: string;
  /** Buyer contact email */
  buyerEmail?: string;
  /** Part revision / drawing number */
  revision?: string;
}

export interface RfqBundle {
  stepText: string;
  stlBuffer: ArrayBuffer;
  manifestJson: string;
  rfqText: string;
  emailDraft: string;
  meta: {
    partLabel: string;
    bbox: { w: number; h: number; d: number };
    volume_cm3: number;
    surface_area_cm2: number;
    triangleCount: number;
    generatedAt: string;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TOLERANCE_DESC: Record<ToleranceClass, string> = {
  'rough':      'ISO 2768-c (rough)',
  'medium':     'ISO 2768-m (medium)',
  'fine':       'ISO 2768-f (fine)',
  'ultra-fine': 'ISO 2768-v (very fine)',
};

const DELIVERY_DESC: Record<DeliveryUrgency, string> = {
  'standard':  'Standard lead time (4–8 weeks)',
  'expedited': 'Expedited (1–2 weeks)',
  'prototype': 'Prototype / NRE (1–5 business days)',
};

const FINISH_DESC: Record<SurfaceFinish, string> = {
  'as-machined':    'As-machined (Ra ≤ 3.2 µm)',
  'polished':       'Polished (Ra ≤ 0.8 µm)',
  'anodized':       'Anodized (Type II)',
  'powder-coated':  'Powder coated (standard colour)',
  'electroplated':  'Electroplated (specify plating on PO)',
  'none':           'None / raw',
};

function triangleCountFromGeo(geo: THREE.BufferGeometry): number {
  if (geo.index) return Math.floor(geo.index.count / 3);
  const pos = geo.getAttribute('position');
  return pos ? Math.floor(pos.count / 3) : 0;
}

function fmt(n: number, dec = 2) {
  return n.toFixed(dec);
}

// ─── RFQ Document Builders ───────────────────────────────────────────────────

function buildRfqText(
  partLabel: string,
  bbox: { w: number; h: number; d: number },
  volume_cm3: number,
  surface_cm2: number,
  opts: RfqOptions,
  ts: string,
): string {
  const currency = opts.currency ?? 'USD';
  const lines: string[] = [
    '═══════════════════════════════════════════════════════════',
    '          REQUEST FOR QUOTATION — NEXYFAB PLATFORM',
    '═══════════════════════════════════════════════════════════',
    '',
    `Part Name / Label : ${partLabel}`,
    `Revision          : ${opts.revision ?? 'A'}`,
    `Generated (UTC)   : ${ts}`,
    opts.buyerCompany ? `Buyer Company     : ${opts.buyerCompany}` : '',
    opts.buyerEmail   ? `Buyer Contact     : ${opts.buyerEmail}`   : '',
    '',
    '─── GEOMETRY ─────────────────────────────────────────────',
    `Bounding Envelope : ${fmt(bbox.w, 1)} × ${fmt(bbox.h, 1)} × ${fmt(bbox.d, 1)} mm (W × H × D)`,
    `Volume (approx.)  : ${fmt(volume_cm3, 4)} cm³`,
    `Surface Area      : ${fmt(surface_cm2, 4)} cm²`,
    `3D Files Enclosed : STEP (AP242 tessellated), STL (binary)`,
    '',
    '─── ORDER DETAILS ────────────────────────────────────────',
    `Quantity          : ${opts.quantity} pcs`,
    `Material          : ${opts.materialSpec}`,
    `Tolerance Class   : ${TOLERANCE_DESC[opts.toleranceClass]}`,
    `Surface Finish    : ${FINISH_DESC[opts.surfaceFinish]}`,
    `Delivery          : ${DELIVERY_DESC[opts.deliveryUrgency]}`,
    opts.targetUnitPriceBudget
      ? `Target Unit Price : Up to ${currency} ${fmt(opts.targetUnitPriceBudget, 2)} per piece`
      : '',
    '',
    opts.notes
      ? `─── SUPPLIER NOTES ───────────────────────────────────────\n${opts.notes}\n`
      : '',
    '─── TERMS ────────────────────────────────────────────────',
    '• Quote valid for 30 days from issue date.',
    '• Include material cert (EN 10204 3.1 or equivalent) in quotation.',
    '• Include DFM / tooling concerns if geometry requires non-standard fixturing.',
    '• NEXYFAB STEP is tessellated; supplier must validate for CNC programming.',
    '',
    '─── INSTRUCTIONS ─────────────────────────────────────────',
    '1. Open the enclosed STEP file in your CAM system.',
    '2. Verify orientation — NexyFab uses Y-up. Rotate to Z-up if required.',
    '3. Reply with unit price, lead time, and any DFM notes.',
    '',
    '═══════════════════════════════════════════════════════════',
    '  Exported by NexyFab CAD Platform — nexyfab.com',
    '═══════════════════════════════════════════════════════════',
  ].filter(l => l !== '');

  return lines.join('\n');
}

function buildEmailDraft(
  partLabel: string,
  opts: RfqOptions,
  ts: string,
  zipFilename: string,
): string {
  const salutation = `Dear Supplier,\n`;
  const body = [
    salutation,
    `We are requesting a quotation for the following part generated in NexyFab CAD:`,
    '',
    `  **Part:** ${partLabel}  |  Rev: ${opts.revision ?? 'A'}`,
    `  **Quantity:** ${opts.quantity} pcs`,
    `  **Material:** ${opts.materialSpec}`,
    `  **Tolerance:** ${TOLERANCE_DESC[opts.toleranceClass]}`,
    `  **Surface Finish:** ${FINISH_DESC[opts.surfaceFinish]}`,
    `  **Delivery:** ${DELIVERY_DESC[opts.deliveryUrgency]}`,
    opts.targetUnitPriceBudget
      ? `  **Target Price:** Up to ${opts.currency ?? 'USD'} ${opts.targetUnitPriceBudget.toFixed(2)}/pc`
      : '',
    '',
    `Please find the complete RFQ package in the attached ZIP file: **${zipFilename}**`,
    `The archive contains STEP, STL, JSON manifest, and a full RFQ document.`,
    '',
    opts.notes ? `**Additional Notes:**\n${opts.notes}\n` : '',
    `Please reply with your unit price, lead time, and any DFM concerns by return email.`,
    '',
    `Best regards,`,
    opts.buyerCompany ?? '[Your Company]',
    opts.buyerEmail ?? '[Your Email]',
    '',
    `---`,
    `*Generated ${ts} by NexyFab — nexyfab.com*`,
  ].filter(l => l !== '');

  return body.join('\n');
}

// ─── Main API ─────────────────────────────────────────────────────────────────

/**
 * Compute all text/binary content for an RFQ bundle without downloading.
 * Useful for preview or server-side generation.
 */
export async function buildRfqBundle(
  geometry: THREE.BufferGeometry,
  partLabel: string,
  opts: RfqOptions,
  materialKey?: string,
): Promise<RfqBundle> {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  // Geometry metrics
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox ?? new THREE.Box3();
  const size = bb.getSize(new THREE.Vector3());
  const bbox = {
    w: Math.round(size.x * 10) / 10,
    h: Math.round(size.y * 10) / 10,
    d: Math.round(size.z * 10) / 10,
  };

  // Compute volume and surface area (rough)
  let volume_cm3 = 0;
  let surface_cm2 = 0;
  try {
    const { meshVolume, meshSurfaceArea } = await import('../shapes/index');
    volume_cm3 = Math.abs(meshVolume(geometry)) / 1000;
    surface_cm2 = meshSurfaceArea(geometry) / 100;
  } catch { /* ignore if not available */ }

  const triCount = triangleCountFromGeo(geometry);

  // STEP export
  const { exportToStepAsync } = await import('./stepExporter');
  const stepText = await exportToStepAsync(geometry, partLabel);

  // STL
  const stlBuffer = buildBinaryStl(geometry);

  // Manifest JSON
  const manifest = {
    nexyfabRfqVersion: 1,
    generatedAt: ts,
    part: { label: partLabel, revision: opts.revision ?? 'A' },
    geometry: { bbox, volume_cm3, surface_cm2: surface_cm2, triangleCount: triCount },
    order: {
      quantity: opts.quantity,
      materialSpec: opts.materialSpec,
      toleranceClass: TOLERANCE_DESC[opts.toleranceClass],
      surfaceFinish: FINISH_DESC[opts.surfaceFinish],
      deliveryUrgency: DELIVERY_DESC[opts.deliveryUrgency],
      targetUnitPriceBudget: opts.targetUnitPriceBudget ?? null,
      currency: opts.currency ?? 'USD',
    },
    buyer: {
      company: opts.buyerCompany ?? null,
      email: opts.buyerEmail ?? null,
    },
    notes: opts.notes ?? null,
    materialPreset: materialKey ?? null,
  };

  const rfqText = buildRfqText(partLabel, bbox, volume_cm3, surface_cm2, opts, ts);
  const zipFilename = `${partLabel.replace(/\s+/g, '_')}-rfq-bundle.zip`;
  const emailDraft = buildEmailDraft(partLabel, opts, ts, zipFilename);

  return {
    stepText,
    stlBuffer,
    manifestJson: JSON.stringify(manifest, null, 2),
    rfqText,
    emailDraft,
    meta: { partLabel, bbox, volume_cm3, surface_area_cm2: surface_cm2, triangleCount: triCount, generatedAt: ts },
  };
}

/**
 * Build and download a complete RFQ ZIP bundle.
 */
export async function downloadRfqBundle(
  geometry: THREE.BufferGeometry,
  partLabel: string,
  opts: RfqOptions,
  materialKey?: string,
): Promise<void> {
  const bundle = await buildRfqBundle(geometry, partLabel, opts, materialKey);
  const base = partLabel.replace(/\s+/g, '_');

  const files: Record<string, Uint8Array> = {
    [`${base}.step`]:         strToU8(bundle.stepText),
    [`${base}.stl`]:          new Uint8Array(bundle.stlBuffer),
    [`${base}-rfq.json`]:     strToU8(bundle.manifestJson),
    [`${base}-RFQ.txt`]:      strToU8(bundle.rfqText),
    [`${base}-email-draft.md`]: strToU8(bundle.emailDraft),
  };

  const zipped = zipSync(files, { level: 6 });
  const zipFilename = `${base}-rfq-bundle.zip`;
  await downloadBlob(zipFilename, new Blob([new Uint8Array(zipped)], { type: 'application/zip' }));
}

/**
 * Generate an estimated cost range based on volume, material, and tolerance.
 * Returns { low, high } in USD. Very rough heuristic for UI display only.
 */
export function estimateRfqCost(
  volume_cm3: number,
  opts: Pick<RfqOptions, 'materialSpec' | 'toleranceClass' | 'surfaceFinish' | 'quantity'>,
): { low: number; high: number; perPiece: { low: number; high: number } } {
  // Base cost: $0.08/cm³ (rough machining steel-equivalent)
  let baseCostPerCm3 = 0.08;

  // Material factor
  const mat = opts.materialSpec.toLowerCase();
  if (mat.includes('titan'))      baseCostPerCm3 *= 4.5;
  else if (mat.includes('steel')) baseCostPerCm3 *= 1.2;
  else if (mat.includes('al') || mat.includes('alum')) baseCostPerCm3 *= 1.0;
  else if (mat.includes('abs') || mat.includes('pla'))  baseCostPerCm3 *= 0.3;

  // Tolerance factor
  const tolFactor: Record<ToleranceClass, number> = {
    'rough': 1.0, 'medium': 1.3, 'fine': 1.8, 'ultra-fine': 2.8,
  };
  baseCostPerCm3 *= tolFactor[opts.toleranceClass];

  // Finish factor
  const finFactor: Record<SurfaceFinish, number> = {
    'none': 1.0, 'as-machined': 1.0, 'polished': 1.4,
    'anodized': 1.5, 'powder-coated': 1.3, 'electroplated': 1.6,
  };
  baseCostPerCm3 *= finFactor[opts.surfaceFinish];

  // Quantity discount
  const qtyFactor = opts.quantity >= 100 ? 0.6 : opts.quantity >= 10 ? 0.8 : 1.0;

  const nominalPiece = Math.max(5, volume_cm3 * baseCostPerCm3);
  const lo = nominalPiece * qtyFactor * 0.8;
  const hi = nominalPiece * qtyFactor * 1.5;
  const total = (q: number) => q * opts.quantity;

  return {
    low: Math.round(total(lo) * 100) / 100,
    high: Math.round(total(hi) * 100) / 100,
    perPiece: {
      low: Math.round(lo * 100) / 100,
      high: Math.round(hi * 100) / 100,
    },
  };
}
