/* ─── Manufacturing Pipeline: DFM → Quote → Manufacturer ────────────────── */

/* ─── Types ─────────────────────────────────────────────────────────────── */

export type PipelineStage = 'dfm' | 'costing' | 'quoting' | 'matching' | 'complete';

export interface PipelineConfig {
  material: string;
  process: string;
  quantity: number;
  urgency: 'standard' | 'rush' | 'prototype';
  qualityLevel: 'standard' | 'precision' | 'aerospace';
}

export interface CostBreakdown {
  material: number;
  machining: number;
  finishing: number;
  tooling: number;
  setup: number;
  shipping: number;
  total: number;
  currency: string;
}

export interface ManufacturerRecommendation {
  id: string;
  name: string;
  nameKo: string;
  capability: string[];
  leadTimeDays: number;
  costEstimate: number;
  rating: number;
  location: string;
  certifications: string[];
}

export interface PipelineResult {
  stage: PipelineStage;
  dfmScore: number;
  dfmIssues: string[];
  costBreakdown: CostBreakdown;
  leadTimeDays: number;
  recommendations: ManufacturerRecommendation[];
  riskLevel: 'low' | 'medium' | 'high';
  suggestions: string[];
}

/* ─── Constants ─────────────────────────────────────────────────────────── */

const MATERIAL_DB: Record<string, { density: number; pricePerKg: number; machinability: number }> = {
  aluminum:   { density: 2.7,  pricePerKg: 3.5,  machinability: 0.85 },
  steel:      { density: 7.85, pricePerKg: 1.8,  machinability: 0.55 },
  stainless:  { density: 8.0,  pricePerKg: 4.2,  machinability: 0.45 },
  titanium:   { density: 4.5,  pricePerKg: 25.0, machinability: 0.30 },
  brass:      { density: 8.5,  pricePerKg: 6.0,  machinability: 0.90 },
  copper:     { density: 8.96, pricePerKg: 8.5,  machinability: 0.70 },
  abs:        { density: 1.04, pricePerKg: 2.5,  machinability: 1.0  },
  nylon:      { density: 1.14, pricePerKg: 5.0,  machinability: 0.95 },
  pla:        { density: 1.24, pricePerKg: 20.0, machinability: 1.0  },
};

const PROCESS_HOURLY_RATE: Record<string, number> = {
  cnc:         85,
  injection:   45,
  '3dprint':   35,
  sheetmetal:  60,
};

const MANUFACTURERS: ManufacturerRecommendation[] = [
  {
    id: 'mfr-001',
    name: 'PrecisionWorks Asia',
    nameKo: '프리시전웍스 아시아',
    capability: ['cnc', 'sheetmetal'],
    leadTimeDays: 7,
    costEstimate: 0,
    rating: 4.8,
    location: 'Seoul, KR',
    certifications: ['ISO 9001', 'ISO 13485', 'AS9100'],
  },
  {
    id: 'mfr-002',
    name: 'RapidMold Co.',
    nameKo: '래피드몰드',
    capability: ['injection', 'cnc'],
    leadTimeDays: 14,
    costEstimate: 0,
    rating: 4.5,
    location: 'Shenzhen, CN',
    certifications: ['ISO 9001', 'IATF 16949'],
  },
  {
    id: 'mfr-003',
    name: 'AddiFab Solutions',
    nameKo: '애디팹 솔루션즈',
    capability: ['3dprint', 'cnc'],
    leadTimeDays: 3,
    costEstimate: 0,
    rating: 4.3,
    location: 'Tokyo, JP',
    certifications: ['ISO 9001'],
  },
  {
    id: 'mfr-004',
    name: 'MetalForm Industries',
    nameKo: '메탈폼 인더스트리',
    capability: ['sheetmetal', 'cnc'],
    leadTimeDays: 10,
    costEstimate: 0,
    rating: 4.6,
    location: 'Busan, KR',
    certifications: ['ISO 9001', 'ISO 14001'],
  },
  {
    id: 'mfr-005',
    name: 'AeroTech Precision',
    nameKo: '에어로텍 프리시전',
    capability: ['cnc', 'sheetmetal', '3dprint'],
    leadTimeDays: 12,
    costEstimate: 0,
    rating: 4.9,
    location: 'Osaka, JP',
    certifications: ['ISO 9001', 'AS9100', 'Nadcap'],
  },
];

/* ─── Helpers ───────────────────────────────────────────────────────────── */

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/* ─── DFM Analysis ──────────────────────────────────────────────────────── */

function analyzeDFM(
  process: string,
  material: string,
  volumeCm3: number,
  surfaceAreaCm2: number,
  complexity: number,
): { score: number; issues: string[]; suggestions: string[] } {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;

  // Complexity penalty
  if (complexity > 0.8) {
    score -= 25;
    issues.push('Very high geometric complexity detected');
    suggestions.push('Simplify geometry or split into sub-assemblies');
  } else if (complexity > 0.5) {
    score -= 12;
    issues.push('Moderate geometric complexity');
    suggestions.push('Review tight tolerances and small features');
  }

  // Wall thickness viability (ratio heuristic: volume vs surface area)
  const avgThicknessCm = volumeCm3 / (surfaceAreaCm2 / 2);
  const avgThicknessMm = avgThicknessCm * 10;
  if (avgThicknessMm < 0.8) {
    score -= 20;
    issues.push(`Estimated wall thickness (${avgThicknessMm.toFixed(2)}mm) too thin`);
    suggestions.push('Increase wall thickness to at least 1.0mm');
  } else if (avgThicknessMm < 1.2) {
    score -= 8;
    issues.push(`Wall thickness marginal (${avgThicknessMm.toFixed(2)}mm)`);
  }

  // Process-specific checks
  if (process === 'injection' && volumeCm3 > 500) {
    score -= 15;
    issues.push('Part volume may exceed typical injection mold cavity size');
    suggestions.push('Consider splitting into multiple molded parts');
  }
  if (process === 'cnc' && complexity > 0.6) {
    score -= 10;
    issues.push('Complex geometry may require 5-axis machining');
    suggestions.push('Reduce undercuts or add draft angles where possible');
  }
  if (process === '3dprint' && volumeCm3 > 1000) {
    score -= 10;
    issues.push('Large volume increases print time significantly');
    suggestions.push('Consider hollowing or lattice infill');
  }
  if (process === 'sheetmetal' && complexity > 0.4) {
    score -= 12;
    issues.push('Complex bends may not be feasible for sheet metal');
    suggestions.push('Minimize bend count and ensure adequate bend radii');
  }

  // Material-process compatibility
  const mat = MATERIAL_DB[material];
  if (mat && mat.machinability < 0.4 && process === 'cnc') {
    score -= 10;
    issues.push(`${material} has low machinability for CNC`);
    suggestions.push('Consider a more machinable alloy or alternative process');
  }

  // Feature count heuristic from complexity
  const estimatedFeatures = Math.round(complexity * 20);
  if (estimatedFeatures > 15) {
    score -= 8;
    issues.push(`High feature count (~${estimatedFeatures}) increases tooling cost`);
  }

  return { score: clamp(score, 0, 100), issues, suggestions };
}

/* ─── Cost Calculation ──────────────────────────────────────────────────── */

function calculateCost(
  config: PipelineConfig,
  volumeCm3: number,
  surfaceAreaCm2: number,
  complexity: number,
): CostBreakdown {
  const mat = MATERIAL_DB[config.material] ?? MATERIAL_DB.aluminum;
  const hourlyRate = PROCESS_HOURLY_RATE[config.process] ?? 70;

  // Material cost
  const volumeM3 = volumeCm3 / 1e6;
  const massKg = mat.density * 1000 * volumeM3; // density in g/cm3 → kg/m3 * m3
  const materialCost = massKg * mat.pricePerKg * (1 + 0.15); // 15% waste

  // Machining cost
  const estimatedHours = (complexity * 2 + 0.5) * (1 / mat.machinability);
  const machiningCost = estimatedHours * hourlyRate;

  // Finishing cost (surface treatment)
  const finishingCost = surfaceAreaCm2 * 0.08;

  // Tooling cost (injection molding has high tooling)
  let toolingCost = 0;
  if (config.process === 'injection') {
    toolingCost = 2000 + complexity * 8000;
  } else if (config.process === 'cnc') {
    toolingCost = 50 + complexity * 200;
  }

  // Setup cost
  const setupCost = config.process === '3dprint' ? 15 : 120;

  // Shipping
  const shippingCost = 25 + massKg * 5;

  // Quantity discount
  const qtyFactor = config.quantity <= 1 ? 1.0
    : config.quantity <= 10 ? 0.90
    : config.quantity <= 100 ? 0.75
    : config.quantity <= 1000 ? 0.60
    : 0.50;

  // Urgency multiplier
  const urgencyFactor = config.urgency === 'rush' ? 1.5
    : config.urgency === 'prototype' ? 1.2
    : 1.0;

  // Quality multiplier
  const qualityFactor = config.qualityLevel === 'aerospace' ? 1.8
    : config.qualityLevel === 'precision' ? 1.3
    : 1.0;

  const perUnit = (machiningCost + finishingCost) * qtyFactor * urgencyFactor * qualityFactor;
  const totalMaterial = materialCost * config.quantity;
  const totalMachining = perUnit * config.quantity * 0.6;
  const totalFinishing = perUnit * config.quantity * 0.2;
  const totalTooling = toolingCost * qualityFactor;
  const totalSetup = setupCost * urgencyFactor;
  const totalShipping = shippingCost;

  const total = totalMaterial + totalMachining + totalFinishing + totalTooling + totalSetup + totalShipping;

  return {
    material: Math.round(totalMaterial * 100) / 100,
    machining: Math.round(totalMachining * 100) / 100,
    finishing: Math.round(totalFinishing * 100) / 100,
    tooling: Math.round(totalTooling * 100) / 100,
    setup: Math.round(totalSetup * 100) / 100,
    shipping: Math.round(totalShipping * 100) / 100,
    total: Math.round(total * 100) / 100,
    currency: 'USD',
  };
}

/* ─── Manufacturer Matching ─────────────────────────────────────────────── */

function matchManufacturers(
  config: PipelineConfig,
  costBreakdown: CostBreakdown,
  dfmScore: number,
): ManufacturerRecommendation[] {
  const matched = MANUFACTURERS
    .filter(m => m.capability.includes(config.process))
    .map(m => {
      // Adjust lead time by urgency
      let lead = m.leadTimeDays;
      if (config.urgency === 'rush') lead = Math.max(2, Math.round(lead * 0.5));
      if (config.urgency === 'prototype') lead = Math.max(1, Math.round(lead * 0.7));

      // Estimate cost variation per manufacturer (rating-based premium)
      const costMul = 0.85 + (m.rating / 5) * 0.3;
      const estimate = Math.round(costBreakdown.total * costMul * 100) / 100;

      return { ...m, leadTimeDays: lead, costEstimate: estimate };
    })
    .sort((a, b) => b.rating - a.rating);

  return matched.slice(0, 5);
}

/* ─── Risk Assessment ───────────────────────────────────────────────────── */

function assessRisk(
  dfmScore: number,
  complexity: number,
  config: PipelineConfig,
): 'low' | 'medium' | 'high' {
  let riskScore = 0;
  if (dfmScore < 50) riskScore += 3;
  else if (dfmScore < 70) riskScore += 1;

  if (complexity > 0.7) riskScore += 2;
  if (config.urgency === 'rush') riskScore += 1;
  if (config.qualityLevel === 'aerospace') riskScore += 1;
  if (config.quantity > 1000) riskScore += 1;

  if (riskScore >= 4) return 'high';
  if (riskScore >= 2) return 'medium';
  return 'low';
}

/* ─── Lead Time ─────────────────────────────────────────────────────────── */

function estimateLeadTime(config: PipelineConfig, complexity: number): number {
  let base = config.process === '3dprint' ? 3
    : config.process === 'injection' ? 21
    : config.process === 'sheetmetal' ? 10
    : 7; // cnc

  base += Math.round(complexity * 5);

  if (config.quantity > 100) base += 5;
  if (config.quantity > 1000) base += 10;

  if (config.urgency === 'rush') base = Math.max(2, Math.round(base * 0.5));
  if (config.urgency === 'prototype') base = Math.max(1, Math.round(base * 0.6));

  if (config.qualityLevel === 'aerospace') base += 5;
  if (config.qualityLevel === 'precision') base += 2;

  return base;
}

/* ─── Pipeline Runner ───────────────────────────────────────────────────── */

export async function runPipeline(
  config: PipelineConfig,
  volumeCm3: number,
  surfaceAreaCm2: number,
  complexity: number,
  onStageChange: (stage: PipelineStage) => void,
): Promise<PipelineResult> {
  // Stage 1: DFM
  onStageChange('dfm');
  await delay(200);
  const dfm = analyzeDFM(config.process, config.material, volumeCm3, surfaceAreaCm2, complexity);

  // Stage 2: Costing
  onStageChange('costing');
  await delay(200);
  const costBreakdown = calculateCost(config, volumeCm3, surfaceAreaCm2, complexity);

  // Stage 3: Quoting
  onStageChange('quoting');
  await delay(200);
  const leadTimeDays = estimateLeadTime(config, complexity);

  // Stage 4: Matching
  onStageChange('matching');
  await delay(200);
  const recommendations = matchManufacturers(config, costBreakdown, dfm.score);
  const riskLevel = assessRisk(dfm.score, complexity, config);

  // Stage 5: Complete
  onStageChange('complete');

  return {
    stage: 'complete',
    dfmScore: dfm.score,
    dfmIssues: dfm.issues,
    costBreakdown,
    leadTimeDays,
    recommendations,
    riskLevel,
    suggestions: dfm.suggestions,
  };
}
