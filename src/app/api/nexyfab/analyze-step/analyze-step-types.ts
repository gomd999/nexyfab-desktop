// ─── Types ────────────────────────────────────────────────────────────────────

export interface StepAnalysisStats {
  faceCount: number;
  edgeCount: number;
  shellCount: number;
  volume_cm3: number;
  surfaceArea_cm2: number;
  bbox: { w: number; h: number; d: number };
  isSolid: boolean;
  isManifold: boolean;
}
