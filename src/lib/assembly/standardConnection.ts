import type { Mate, MateRef } from './mate';

type PairRefs = { a: MateRef; b: MateRef };
export type StandardConnection =
  | ({ id: string; kind: 'shaft_bearing'; fit: 'sliding' | 'transition' | 'press'; radialClearanceMm: number } & PairRefs)
  | ({ id: string; kind: 'bolt'; nominalDiameterMm: number; clearanceMm: number } & PairRefs)
  | ({ id: string; kind: 'pin'; fit: 'sliding' | 'press'; clearanceMm: number } & PairRefs)
  | ({ id: string; kind: 'press_fit'; interferenceMm: number; justification: string } & PairRefs);

export type CompiledStandardConnection = {
  mates: Mate[];
  intendedContact?: { partA: string; partB: string; justification: string };
  warnings: string[];
};

export function compileStandardConnection(connection: StandardConnection): CompiledStandardConnection {
  validateConnection(connection);
  const concentric: Mate = { id: `${connection.id}:axis`, kind: 'concentric', a: connection.a, b: connection.b };
  switch (connection.kind) {
    case 'shaft_bearing': return { mates: [concentric], ...(connection.fit === 'press' ? { intendedContact: contact(connection, `Bearing press fit; declared radial clearance ${connection.radialClearanceMm} mm.`) } : {}), warnings: connection.fit === 'sliding' && connection.radialClearanceMm <= 0 ? ['Sliding bearing fit requires positive clearance.'] : [] };
    case 'bolt': return { mates: [concentric], warnings: connection.clearanceMm <= 0 ? ['Bolt clearance is non-positive; verify tapped-hole intent.'] : [] };
    case 'pin': return { mates: [concentric], ...(connection.fit === 'press' ? { intendedContact: contact(connection, `Press-fit pin; declared clearance ${connection.clearanceMm} mm.`) } : {}), warnings: [] };
    case 'press_fit': return { mates: [concentric], intendedContact: contact(connection, `${connection.justification}; diametral interference ${connection.interferenceMm} mm.`), warnings: [] };
  }
}

function contact(connection: StandardConnection, justification: string) {
  return { partA: connection.a.partId, partB: connection.b.partId, justification };
}

function validateConnection(connection: StandardConnection): void {
  if (!connection.id.trim()) throw new Error('connection id is required');
  if (connection.a.partId === connection.b.partId) throw new Error('connection must reference two different parts');
  if (connection.a.refKind !== 'axis' || connection.b.refKind !== 'axis') throw new Error(`${connection.kind} requires two axis references`);
  if (connection.kind === 'shaft_bearing' && !Number.isFinite(connection.radialClearanceMm)) throw new Error('radialClearanceMm must be finite');
  if ((connection.kind === 'bolt' || connection.kind === 'pin') && !Number.isFinite(connection.clearanceMm)) throw new Error('clearanceMm must be finite');
  if (connection.kind === 'bolt' && connection.nominalDiameterMm <= 0) throw new Error('nominalDiameterMm must be positive');
  if (connection.kind === 'press_fit' && (!(connection.interferenceMm > 0) || !connection.justification.trim())) throw new Error('press fit requires positive interference and justification');
}
