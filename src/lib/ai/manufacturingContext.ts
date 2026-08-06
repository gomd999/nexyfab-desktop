import { createHash } from 'node:crypto';
import { PROCESS_WALL_MIN_MM, type ProcessForDfm } from './scad-agent/specVerification';
import type { CadFeatureProgram } from './cadFeatureProgram';

export interface ManufacturingVerificationContext {
  promptHash: string;
  inputRef: string;
  privacyCompliant: true;
  intentResolved: boolean;
  process?: ProcessForDfm;
  material?: string;
}

export function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt.normalize('NFKC')).digest('hex');
}

export function extractManufacturingContext(prompt: string): ManufacturingVerificationContext {
  const text = prompt.toLowerCase();
  const process: ProcessForDfm | undefined =
    /\b(cnc|machin(?:e|ing)|밀링|절삭)\b/.test(text) ? 'cnc_mill'
      : /\b(fdm|fff|3d\s*print(?:ing)?|적층)\b/.test(text) ? 'fdm'
        : /\b(sla|resin|광경화)\b/.test(text) ? 'sla'
          : /\b(sheet\s*metal|판금|절곡)\b/.test(text) ? 'sheet'
            : /\b(injection\s*mold(?:ing)?|사출)\b/.test(text) ? 'injection_molding'
              : /\b(die\s*cast(?:ing)?|다이캐스팅)\b/.test(text) ? 'die_cast'
                : undefined;
  const material =
    /\b(al(?:uminum|uminium)?\s*6061|al6061|알루미늄\s*6061)\b/.test(text) ? 'aluminum_6061'
      : /\b(stainless(?:\s*steel)?\s*304|sus\s*304|스테인리스\s*304)\b/.test(text) ? 'stainless_304'
        : /\b(pla)\b/.test(text) ? 'pla'
          : /\b(abs)\b/.test(text) ? 'abs'
            : /\b(steel|강철|ss400|a36)\b/.test(text) ? 'steel'
              : undefined;
  const hash = promptHash(prompt);
  return { promptHash: hash, inputRef: `prompt:sha256:${hash}`, privacyCompliant: true, intentResolved: true, process, material };
}

export function evaluateProgramDfm(
  program: CadFeatureProgram,
  context: ManufacturingVerificationContext | undefined,
): { process: string; material: string; passed: boolean; violations: string[] } | undefined {
  if (!context?.process || !context.material) return undefined;
  const violations: string[] = [];
  const metal = ['aluminum_6061', 'stainless_304', 'steel'].includes(context.material);
  const plastic = ['pla', 'abs'].includes(context.material);
  if (metal && (context.process === 'fdm' || context.process === 'sla')) violations.push('Metal material is incompatible with the selected polymer printing process.');
  if (plastic && context.process === 'die_cast') violations.push('Plastic material is incompatible with die casting.');
  const base = program.features.find(feature => feature.type === 'sketchExtrude');
  const shell = program.features.find(feature => feature.type === 'shell');
  const thickness = shell?.wallThickness ?? base?.height;
  const minimum = PROCESS_WALL_MIN_MM[context.process];
  if (typeof thickness !== 'number') violations.push('No measurable wall or base thickness exists for DFM screening.');
  else if (minimum > 0 && thickness < minimum) violations.push(`Thickness ${thickness}mm is below the ${minimum}mm minimum for ${context.process}.`);
  return { process: context.process, material: context.material, passed: violations.length === 0, violations };
}
