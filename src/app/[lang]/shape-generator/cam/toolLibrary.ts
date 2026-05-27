/**
 * toolLibrary.ts — Standard ISO tool catalogue for CAM preview.
 *
 * Three families:
 *   - **endmill** (flat / ball / corner-radius) for milling pockets.
 *   - **drill** for hole-making.
 *   - **faceMill** for surface-finishing large flats.
 *
 * Each tool carries the parameters CAM needs: diameter, flute count,
 * max cutting depth, recommended feed/speed per workpiece material.
 * Recipe values come from typical hardware-store endmill cards
 * (Carbide3D / Kennametal / Garr) — they're industry middle-of-the-road
 * and meant for hobbyist + small-shop CNC, NOT high-speed production.
 */

export type ToolFamily = 'endmill' | 'drill' | 'faceMill';

export interface ToolDefinition {
  /** Stable id used in URL params + serialised toolpath state. */
  id: string;
  family: ToolFamily;
  /** Display name. */
  name: string;
  /** Cutter diameter (mm). */
  diameter: number;
  /** Number of flutes / cutting edges. */
  flutes: number;
  /** Maximum recommended axial depth-of-cut (mm). */
  maxDepthOfCutMm: number;
  /** Material the tool is made of. */
  toolMaterial: 'HSS' | 'carbide' | 'carbide-coated';
  /** Endmill type — flat / ball / corner-radius. */
  endmillType?: 'flat' | 'ball' | 'cornerRadius';
}

export const TOOL_LIBRARY: ToolDefinition[] = [
  // ── Endmills ─────────────────────────────────────────────────────────
  { id: 'em-1mm-2f',  family: 'endmill', name: '1 mm 2-flute flat',  diameter: 1.0, flutes: 2, maxDepthOfCutMm: 1.0, toolMaterial: 'carbide', endmillType: 'flat' },
  { id: 'em-3mm-2f',  family: 'endmill', name: '3 mm 2-flute flat',  diameter: 3.0, flutes: 2, maxDepthOfCutMm: 3.0, toolMaterial: 'carbide', endmillType: 'flat' },
  { id: 'em-6mm-2f',  family: 'endmill', name: '6 mm 2-flute flat',  diameter: 6.0, flutes: 2, maxDepthOfCutMm: 6.0, toolMaterial: 'carbide', endmillType: 'flat' },
  { id: 'em-6mm-4f',  family: 'endmill', name: '6 mm 4-flute flat',  diameter: 6.0, flutes: 4, maxDepthOfCutMm: 6.0, toolMaterial: 'carbide', endmillType: 'flat' },
  { id: 'em-10mm-4f', family: 'endmill', name: '10 mm 4-flute flat', diameter: 10.0, flutes: 4, maxDepthOfCutMm: 10.0, toolMaterial: 'carbide', endmillType: 'flat' },
  { id: 'em-6mm-2f-ball', family: 'endmill', name: '6 mm 2-flute ball', diameter: 6.0, flutes: 2, maxDepthOfCutMm: 3.0, toolMaterial: 'carbide', endmillType: 'ball' },

  // ── Drills ──────────────────────────────────────────────────────────
  { id: 'dr-2mm',  family: 'drill', name: '2 mm HSS drill',  diameter: 2.0, flutes: 2, maxDepthOfCutMm: 15.0, toolMaterial: 'HSS' },
  { id: 'dr-3mm',  family: 'drill', name: '3 mm HSS drill',  diameter: 3.0, flutes: 2, maxDepthOfCutMm: 22.0, toolMaterial: 'HSS' },
  { id: 'dr-5mm',  family: 'drill', name: '5 mm HSS drill',  diameter: 5.0, flutes: 2, maxDepthOfCutMm: 38.0, toolMaterial: 'HSS' },
  { id: 'dr-8mm',  family: 'drill', name: '8 mm HSS drill',  diameter: 8.0, flutes: 2, maxDepthOfCutMm: 60.0, toolMaterial: 'HSS' },

  // ── Face mills ──────────────────────────────────────────────────────
  { id: 'fm-25mm-5f',  family: 'faceMill', name: '25 mm 5-insert face mill',  diameter: 25.0, flutes: 5, maxDepthOfCutMm: 3.0, toolMaterial: 'carbide-coated' },
  { id: 'fm-50mm-8f',  family: 'faceMill', name: '50 mm 8-insert face mill',  diameter: 50.0, flutes: 8, maxDepthOfCutMm: 4.0, toolMaterial: 'carbide-coated' },
];

/** Look up a tool by id. Returns null when not in the catalogue. */
export function findTool(id: string): ToolDefinition | null {
  return TOOL_LIBRARY.find(t => t.id === id) ?? null;
}

/** Filter the catalogue by family. */
export function listTools(family?: ToolFamily): ToolDefinition[] {
  if (!family) return TOOL_LIBRARY.slice();
  return TOOL_LIBRARY.filter(t => t.family === family);
}

/** Recommend feed + speed for a given tool / workpiece combination.
 *  Returns mm/min feed + RPM. Values are conservative hobbyist
 *  recipes (Carbide3D / Onsrud handbook range). */
export interface FeedSpeed {
  feedMmPerMin: number;
  spindleRpm: number;
}

export type WorkpieceMaterial = 'aluminum' | 'mildSteel' | 'stainless304' | 'abs' | 'wood';

const SFM_BY_MATERIAL: Record<WorkpieceMaterial, number> = {
  // Surface feet per minute, conservative.
  aluminum: 400,
  mildSteel: 80,
  stainless304: 50,
  abs: 250,
  wood: 600,
};

/** Compute spindle RPM from surface speed (SFM) + tool diameter.
 *  RPM = 12 × SFM / (π × D in inches). */
function rpmFromSfm(sfm: number, diameterMm: number): number {
  const dIn = diameterMm / 25.4;
  if (dIn <= 0) return 0;
  return Math.round((12 * sfm) / (Math.PI * dIn));
}

export function recommendFeedSpeed(
  tool: ToolDefinition,
  workpiece: WorkpieceMaterial,
): FeedSpeed {
  const sfm = SFM_BY_MATERIAL[workpiece];
  const rpm = rpmFromSfm(sfm, tool.diameter);
  // Chip load per flute, mm — empirical defaults.
  const chipLoad = workpiece === 'aluminum' ? 0.025
                : workpiece === 'wood' ? 0.04
                : workpiece === 'abs' ? 0.03
                : 0.015; // steels / stainless
  const feed = rpm * tool.flutes * chipLoad;
  return { feedMmPerMin: Math.round(feed), spindleRpm: rpm };
}
