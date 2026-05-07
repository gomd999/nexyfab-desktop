export type Face = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

export interface Material {
  name: string;
  E: number;
  nu: number;
  density: number;
}

export const MATERIALS: Record<string, Material> = {
  aluminum: { name: 'Aluminum 6061', E: 69e9, nu: 0.33, density: 2700 },
  steel: { name: 'Steel', E: 200e9, nu: 0.3, density: 7850 },
  titanium: { name: 'Titanium Ti-6Al-4V', E: 114e9, nu: 0.34, density: 4430 },
  abs: { name: 'ABS Plastic', E: 2.3e9, nu: 0.35, density: 1040 },
  nylon: { name: 'Nylon PA12', E: 1.7e9, nu: 0.4, density: 1010 },
};

export interface BoundaryCondition {
  fixedFaces: Face[];
  loads: Array<{
    face: Face;
    force: [number, number, number];
  }>;
  // For custom domains, specify fixed/loaded node indices directly
  fixedNodeIndices?: number[];
  loadNodeEntries?: Array<{
    nodeIndices: number[];
    force: [number, number, number];
  }>;
}

export interface OptConfig {
  dimX: number;
  dimY: number;
  dimZ: number;
  nx: number;
  ny: number;
  nz: number;
  volfrac: number;
  penal: number;
  rmin: number;
  maxIter: number;
  material: Material;
  boundary: BoundaryCondition;
  domainType?: 'box' | 'custom'; // default 'box'
  domainMask?: Uint8Array; // length nx*ny*nz, 1=active 0=void
}

export interface OptProgress {
  iteration: number;
  maxIteration: number;
  compliance: number;
  volumeFraction: number;
  change: number;
  densities: Float64Array;
}

export interface OptResult {
  densities: Float64Array;
  nx: number;
  ny: number;
  nz: number;
  dimX: number;
  dimY: number;
  dimZ: number;
  finalCompliance: number;
  finalVolumeFraction: number;
  iterations: number;
  convergenceHistory: number[];
}
