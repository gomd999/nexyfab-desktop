// ─── Weight Block Plugin — Reference mass block sized by target weight ────────
//
// Given a material density and a desired mass, computes the exact box dimensions
// that produce that mass and returns the geometry. Useful as a quick reference
// when checking whether a designed part is in the right ballpark for weight.
//
// Density presets (g/cm³):
//   0.9  — HDPE / PP plastic
//   1.2  — ABS / PLA plastic
//   2.7  — Aluminium (6061)
//   7.85 — Carbon steel
//   8.9  — Copper
//  19.3  — Tungsten (reference weight)

import * as THREE from 'three';
import type { PluginManifest, PluginInitFn } from '../PluginAPI';

export const weightCostManifest: PluginManifest = {
  id: 'nexyfab-weight-block',
  name: 'Weight Block',
  version: '1.0.0',
  author: 'NexyFab',
  description: 'Generates a reference box whose volume exactly corresponds to a target mass at a given material density',
};

/* ─── Common density labels for the toast message ──────────────────────────── */

function densityLabel(density: number): string {
  const d = Math.round(density * 10) / 10;
  if (d <= 1.0)  return `HDPE/PP (${d} g/cm³)`;
  if (d <= 1.35) return `ABS/PLA (${d} g/cm³)`;
  if (d <= 3.0)  return `Aluminium (${d} g/cm³)`;
  if (d <= 8.0)  return `Steel (${d} g/cm³)`;
  if (d <= 9.5)  return `Copper (${d} g/cm³)`;
  return `Heavy alloy (${d} g/cm³)`;
}

/* ─── Plugin Init ─────────────────────────────────────────────────────────── */

export const weightCostInit: PluginInitFn = (ctx) => {
  ctx.registerShape({
    id: 'weight-block',
    name: 'Weight Block',
    icon: '⚖️',
    params: [
      // density in g/cm³ — user slides between common material values
      { key: 'density',     label: 'Density (g/cm³)',  min: 0.9, max: 20,    default: 2.7,  step: 0.1  },
      // desired mass in grams
      { key: 'targetMass',  label: 'Target Mass (g)',  min: 1,   max: 10000, default: 100,  step: 10   },
      // w/h ratio: values >1 produce a wide flat block, <1 produce a tall thin block
      { key: 'aspectRatio', label: 'Width/Height Ratio', min: 0.1, max: 5,  default: 1.0,  step: 0.1  },
    ],
    generate: (p) => {
      const { density, targetMass, aspectRatio } = p;

      // ── Volume calculation ────────────────────────────────────────────────
      // mass (g) = density (g/cm³) × volume (cm³)
      // volume_cm3 = targetMass / density
      // Convert to mm³: 1 cm³ = 1000 mm³
      const volume_cm3 = targetMass / Math.max(0.01, density);
      const volume_mm3 = volume_cm3 * 1000;

      // ── Box dimensions ────────────────────────────────────────────────────
      // Let h = height (Y), w = width (X) = h × aspectRatio, d = depth (Z) = h
      // Then: w × h × d = (h × aspectRatio) × h × h = h³ × aspectRatio = volume_mm3
      // → h = ∛(volume_mm3 / aspectRatio)
      const ratio = Math.max(0.01, aspectRatio);
      const h     = Math.cbrt(volume_mm3 / ratio);
      const w     = h * ratio;
      const d     = h;               // keep depth equal to height for a clean prism

      // Guard against degenerate dimensions (< 0.1 mm each axis)
      const safeW = Math.max(0.1, w);
      const safeH = Math.max(0.1, h);
      const safeD = Math.max(0.1, d);

      const geometry = new THREE.BoxGeometry(safeW, safeH, safeD);
      geometry.computeBoundingBox();

      // ── Informational toast ───────────────────────────────────────────────
      // Recompute actual volume from clamped dims so the message is accurate
      const actualVol_cm3 = (safeW * safeH * safeD) / 1000;
      const actualMass    = actualVol_cm3 * density;

      ctx.showToast(
        'info',
        `Weight Block: ${actualMass.toFixed(1)} g · ${densityLabel(density)} · ` +
        `${safeW.toFixed(1)} × ${safeH.toFixed(1)} × ${safeD.toFixed(1)} mm`,
      );

      return geometry;
    },
  });

  ctx.showToast('info', 'Weight Block plugin loaded');
};
