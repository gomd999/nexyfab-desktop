/**
 * grooveTurningCycle.ts — Generate a lathe grooving / parting peck cycle
 * (Fanuc G75) for cutting a radial groove (or parting off) on a turned
 * part, with chip-breaking pecks.
 *
 * A grooving tool of width w plunges radially in pecks of depth `peck`,
 * retracting a small clearance between pecks to break chips. For a wide
 * groove (groove width > tool width) the tool also steps over axially.
 *
 *   radial pecks      = ceil(grooveDepth / peck)
 *   axial steps       = ceil((grooveWidth − toolWidth) / stepover) + 1
 *
 * Parting off is the special case where the groove depth = full radius
 * (cut to centre) and groove width = tool width.
 */

export interface GrooveTurningInput {
  startDiameterMm: number;
  grooveDepthMm: number;   // radial depth from start diameter
  grooveWidthMm: number;   // axial width of the groove
  toolWidthMm: number;
  axialStartZMm: number;   // Z position of the groove's first wall
  peckDepthMm?: number;    // default = toolWidth (1:1)
  retractMm?: number;      // chip-break retract, default 0.5
  parting?: boolean;
}

export interface GroovePass {
  zMm: number;          // axial position of this plunge
  finalDiameterMm: number;
  pecks: number;
}

export interface GrooveTurningResult {
  passes: GroovePass[];
  radialPecksPerPlunge: number;
  axialSteps: number;
  gCode: string;
  warnings: string[];
}

export function generate(input: GrooveTurningInput): GrooveTurningResult {
  const warnings: string[] = [];
  if (input.toolWidthMm <= 0) warnings.push('Tool width must be positive.');
  if (input.grooveDepthMm <= 0) warnings.push('Groove depth must be positive.');
  if (input.grooveWidthMm < input.toolWidthMm) warnings.push('Groove width is narrower than the tool.');

  const peck = input.peckDepthMm && input.peckDepthMm > 0 ? input.peckDepthMm : input.toolWidthMm;
  const radialPecks = Math.max(1, Math.ceil(input.grooveDepthMm / peck));

  // Axial stepover so adjacent plunges overlap a little (~90% of tool width).
  const stepover = input.toolWidthMm * 0.9;
  const extraWidth = Math.max(0, input.grooveWidthMm - input.toolWidthMm);
  const axialSteps = 1 + Math.ceil(extraWidth / stepover);

  const finalDia = input.startDiameterMm - 2 * input.grooveDepthMm;
  const passes: GroovePass[] = [];
  for (let i = 0; i < axialSteps; i++) {
    const z = input.axialStartZMm - Math.min(extraWidth, i * stepover);
    passes.push({ zMm: z, finalDiameterMm: finalDia, pecks: radialPecks });
  }

  const retract = input.retractMm ?? 0.5;
  const code = `G75 R${retract.toFixed(2)}\nG75 X${finalDia.toFixed(3)} Z${(input.axialStartZMm - extraWidth).toFixed(3)} P${(peck * 1000).toFixed(0)} Q${(stepover * 1000).toFixed(0)} F0.1`;

  if (input.parting && Math.abs(finalDia) > 1e-6) {
    warnings.push('Parting cut should reach the centreline (final diameter ≈ 0).');
  }

  return {
    passes,
    radialPecksPerPlunge: radialPecks,
    axialSteps,
    gCode: code,
    warnings,
  };
}

/** Total material volume removed (mm³) — annular groove approximation. */
export function removedVolume(input: GrooveTurningInput): number {
  const rOuter = input.startDiameterMm / 2;
  const rInner = rOuter - input.grooveDepthMm;
  if (rInner < 0) {
    // parting through centre
    return Math.PI * rOuter * rOuter * input.grooveWidthMm;
  }
  return Math.PI * (rOuter * rOuter - rInner * rInner) * input.grooveWidthMm;
}

export function summarize(r: GrooveTurningResult): { axialSteps: number; radialPecks: number; passCount: number } {
  return { axialSteps: r.axialSteps, radialPecks: r.radialPecksPerPlunge, passCount: r.passes.length };
}
