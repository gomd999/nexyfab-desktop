/**
 * Material-aware all-in cost in KRW per cm³ of part volume, derived
 * transparently as density(g/cm³) × price(KRW/kg) ÷ 1000 × waste-factor (CNC
 * removes stock; FDM barely wastes). Replaces order-priority's old flat
 * 200/cm³ that priced gold and aluminium identically. Returns the UNKNOWN
 * default + `known:false` when the material isn't given, so the caller can flag
 * the margin as approximate rather than presenting a fake-precise number.
 *
 * In its own module (not the route) because Next.js route files may only export
 * handler symbols.
 */
const MATERIAL_KRW_PER_CM3: Record<string, number> = {
  // density × KRW/kg ÷ 1000 × waste
  aluminum: 32,    // 2.70 × 4000 /1000 × 3.0
  steel: 35,       // 7.85 × 1800 /1000 × 2.5
  stainless: 139,  // 7.93 × 7000 /1000 × 2.5
  titanium: 1063,  // 4.43 × 60000 /1000 × 4.0
  brass: 255,      // 8.50 × 12000 /1000 × 2.5
  copper: 269,     // 8.96 × 12000 /1000 × 2.5
  abs: 48,         // 1.05 × 40000 /1000 × 1.15
  pla: 50,         // 1.24 × 35000 /1000 × 1.15
  nylon: 75,       // 1.14 × 55000 /1000 × 1.20
};
const MATERIAL_KRW_PER_CM3_UNKNOWN = 60; // mid metal/plastic estimate (was a flat 200)

export function materialCostKrwPerCm3(material?: string | null): { perCm3: number; known: boolean } {
  if (!material) return { perCm3: MATERIAL_KRW_PER_CM3_UNKNOWN, known: false };
  const key = material.toLowerCase().replace(/[^a-z]/g, '');
  for (const [name, cost] of Object.entries(MATERIAL_KRW_PER_CM3)) {
    if (key.includes(name)) return { perCm3: cost, known: true };
  }
  return { perCm3: MATERIAL_KRW_PER_CM3_UNKNOWN, known: false };
}
