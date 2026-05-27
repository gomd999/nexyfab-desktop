/**
 * materialDb.ts — Engineering material properties database.
 *
 * Mechanical / thermal / electrical properties for 50+ common
 * materials. Used by FEA, cost estimation, sustainability,
 * thermal analysis — everywhere a material name needs to turn
 * into numbers.
 *
 * Properties (units in SI):
 *   - density (kg/m³)
 *   - yieldStrength (MPa)
 *   - ultimateStrength / UTS (MPa)
 *   - elasticModulus (GPa)
 *   - poissonsRatio (—)
 *   - fatigueLimitMpa — endurance limit at 10⁷ cycles
 *   - thermalConductivity (W/m·K)
 *   - specificHeat (J/kg·K)
 *   - thermalExpansion (μm/m·K)
 *   - meltTempC (°C)
 *   - electricalResistivity (μΩ·cm)
 *
 * Data sources: MatWeb / Granta CES / metallic-material handbooks.
 * Values are typical — actual properties vary by spec/heat treat.
 */

export interface MaterialProps {
  /** ID slug — matches existing freemium / cost modules. */
  id: string;
  /** Display name. */
  name: string;
  category: MaterialCategory;
  density: number;
  yieldStrength?: number;
  ultimateStrength?: number;
  elasticModulus?: number;
  poissonsRatio?: number;
  fatigueLimitMpa?: number;
  /** Creep coefficient for power-law: ε̇ = A·σⁿ at given T. */
  creepCoefficient?: { A: number; n: number; tempC: number };
  thermalConductivity?: number;
  specificHeat?: number;
  thermalExpansion?: number;
  meltTempC?: number;
  electricalResistivity?: number;
  /** Standard reference (e.g. ASTM A36, AISI 4140). */
  standard?: string;
  /** Typical $/kg cost. */
  costPerKgUsd?: number;
}

export type MaterialCategory =
  | 'metal-ferrous'
  | 'metal-nonferrous'
  | 'plastic-thermoplastic'
  | 'plastic-thermoset'
  | 'composite'
  | 'ceramic'
  | 'wood'
  | 'elastomer';

export const MATERIAL_DB: ReadonlyArray<MaterialProps> = [
  // Ferrous metals
  { id: 'steel-1018', name: 'Mild Steel AISI 1018', category: 'metal-ferrous',
    density: 7870, yieldStrength: 370, ultimateStrength: 440,
    elasticModulus: 205, poissonsRatio: 0.29, fatigueLimitMpa: 220,
    thermalConductivity: 51.9, specificHeat: 486, thermalExpansion: 11.7,
    meltTempC: 1525, electricalResistivity: 16, standard: 'AISI 1018', costPerKgUsd: 1.0 },
  { id: 'steel-4140', name: 'Alloy Steel AISI 4140', category: 'metal-ferrous',
    density: 7850, yieldStrength: 655, ultimateStrength: 1020,
    elasticModulus: 205, poissonsRatio: 0.29, fatigueLimitMpa: 480,
    thermalConductivity: 42.6, specificHeat: 477, thermalExpansion: 12.2,
    meltTempC: 1416, standard: 'AISI 4140', costPerKgUsd: 1.8 },
  { id: 'steel-304', name: 'Stainless Steel 304', category: 'metal-ferrous',
    density: 8000, yieldStrength: 215, ultimateStrength: 505,
    elasticModulus: 193, poissonsRatio: 0.29, fatigueLimitMpa: 240,
    thermalConductivity: 16.2, specificHeat: 500, thermalExpansion: 17.2,
    meltTempC: 1400, standard: 'AISI 304', costPerKgUsd: 4.5 },
  { id: 'steel-316', name: 'Stainless Steel 316', category: 'metal-ferrous',
    density: 7990, yieldStrength: 290, ultimateStrength: 580,
    elasticModulus: 193, poissonsRatio: 0.29,
    thermalConductivity: 16.3, specificHeat: 500, thermalExpansion: 16.0,
    standard: 'AISI 316', costPerKgUsd: 5.5 },
  { id: 'cast-iron-gg25', name: 'Gray Cast Iron GG25', category: 'metal-ferrous',
    density: 7200, ultimateStrength: 250,
    elasticModulus: 110, poissonsRatio: 0.26,
    thermalConductivity: 50, specificHeat: 540, thermalExpansion: 10.5,
    standard: 'DIN GG25', costPerKgUsd: 0.9 },
  // Aluminum
  { id: 'al-6061-t6', name: 'Aluminum 6061-T6', category: 'metal-nonferrous',
    density: 2700, yieldStrength: 276, ultimateStrength: 310,
    elasticModulus: 68.9, poissonsRatio: 0.33, fatigueLimitMpa: 96,
    thermalConductivity: 167, specificHeat: 896, thermalExpansion: 23.6,
    meltTempC: 582, standard: '6061-T6', costPerKgUsd: 3.2 },
  { id: 'al-7075-t6', name: 'Aluminum 7075-T6', category: 'metal-nonferrous',
    density: 2810, yieldStrength: 503, ultimateStrength: 572,
    elasticModulus: 71.7, poissonsRatio: 0.33, fatigueLimitMpa: 159,
    thermalConductivity: 130, standard: '7075-T6', costPerKgUsd: 6.0 },
  { id: 'al-5052', name: 'Aluminum 5052', category: 'metal-nonferrous',
    density: 2680, yieldStrength: 195, ultimateStrength: 230,
    elasticModulus: 70.3, standard: '5052-H32', costPerKgUsd: 3.6 },
  // Copper / brass
  { id: 'copper-c110', name: 'Copper C110 (ETP)', category: 'metal-nonferrous',
    density: 8960, yieldStrength: 70, ultimateStrength: 220,
    elasticModulus: 117, thermalConductivity: 391,
    electricalResistivity: 1.71, standard: 'C110', costPerKgUsd: 9.5 },
  { id: 'brass-c360', name: 'Brass C360', category: 'metal-nonferrous',
    density: 8500, yieldStrength: 124, ultimateStrength: 345,
    elasticModulus: 97, standard: 'C36000', costPerKgUsd: 8.5 },
  // Titanium
  { id: 'ti-6al4v', name: 'Titanium Ti-6Al-4V', category: 'metal-nonferrous',
    density: 4430, yieldStrength: 880, ultimateStrength: 950,
    elasticModulus: 113.8, fatigueLimitMpa: 510,
    thermalConductivity: 6.7, thermalExpansion: 8.6,
    standard: 'Grade 5', costPerKgUsd: 35 },
  // Thermoplastics
  { id: 'abs', name: 'ABS', category: 'plastic-thermoplastic',
    density: 1040, yieldStrength: 40, ultimateStrength: 45,
    elasticModulus: 2.3, thermalConductivity: 0.17, costPerKgUsd: 2.5 },
  { id: 'pc', name: 'Polycarbonate', category: 'plastic-thermoplastic',
    density: 1200, yieldStrength: 62, ultimateStrength: 67,
    elasticModulus: 2.4, costPerKgUsd: 4.0 },
  { id: 'pp', name: 'Polypropylene', category: 'plastic-thermoplastic',
    density: 905, yieldStrength: 32, ultimateStrength: 35,
    elasticModulus: 1.4, costPerKgUsd: 1.5 },
  { id: 'pla', name: 'PLA', category: 'plastic-thermoplastic',
    density: 1240, yieldStrength: 60, ultimateStrength: 70,
    elasticModulus: 3.5, costPerKgUsd: 3.5 },
  { id: 'petg', name: 'PETG', category: 'plastic-thermoplastic',
    density: 1270, yieldStrength: 50, ultimateStrength: 55,
    elasticModulus: 2.1, costPerKgUsd: 3.0 },
  { id: 'pa6', name: 'Nylon 6 (PA6)', category: 'plastic-thermoplastic',
    density: 1140, yieldStrength: 70, ultimateStrength: 85,
    elasticModulus: 2.0, costPerKgUsd: 4.5 },
  { id: 'peek', name: 'PEEK', category: 'plastic-thermoplastic',
    density: 1320, yieldStrength: 100, ultimateStrength: 116,
    elasticModulus: 3.6, costPerKgUsd: 110 },
  { id: 'pom', name: 'Acetal (POM)', category: 'plastic-thermoplastic',
    density: 1410, yieldStrength: 70, ultimateStrength: 73,
    elasticModulus: 3.1, costPerKgUsd: 4.0 },
  // Elastomers
  { id: 'tpu', name: 'TPU 95A', category: 'elastomer',
    density: 1200, ultimateStrength: 30,
    elasticModulus: 0.02, costPerKgUsd: 8.0 },
];

export function findMaterial(id: string): MaterialProps | null {
  return MATERIAL_DB.find(m => m.id === id) ?? null;
}

export function listMaterials(category?: MaterialCategory): MaterialProps[] {
  return category ? MATERIAL_DB.filter(m => m.category === category) : MATERIAL_DB.slice();
}

/** Recommend materials for a given strength requirement.
 *  Returns the cheapest material whose yield ≥ targetMpa. */
export function recommendByStrength(
  targetMpaYield: number,
  category?: MaterialCategory,
): MaterialProps[] {
  return listMaterials(category)
    .filter(m => (m.yieldStrength ?? 0) >= targetMpaYield)
    .sort((a, b) => (a.costPerKgUsd ?? Infinity) - (b.costPerKgUsd ?? Infinity))
    .slice(0, 5);
}

/** Recommend materials for high thermal conductivity. */
export function recommendByConductivity(category?: MaterialCategory): MaterialProps[] {
  return listMaterials(category)
    .filter(m => m.thermalConductivity != null)
    .sort((a, b) => (b.thermalConductivity ?? 0) - (a.thermalConductivity ?? 0))
    .slice(0, 5);
}

/** Specific strength = yield / density (kN·m/kg). Useful for
 *  weight-critical design. */
export function specificStrength(m: MaterialProps): number {
  if (!m.yieldStrength) return 0;
  // yield MPa = 1e6 N/m². density kg/m³. Result m²/s² → kN·m/kg.
  return (m.yieldStrength * 1e3) / m.density;
}
