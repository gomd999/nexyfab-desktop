const ASSEMBLY_MARKERS = [
  'NEXT_ASSEMBLY_USAGE_OCCURRENCE',
  'CONTEXT_DEPENDENT_SHAPE_REPRESENTATION',
] as const;

export interface StepStructureProbe { isAssembly: boolean; markers: string[] }

/** Bounded-memory ASCII probe for standard STEP assembly relationships. */
export function probeStepStructure(buffer: ArrayBuffer): StepStructureProbe {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder('ascii');
  const chunkBytes = 256 * 1024;
  const overlapChars = Math.max(...ASSEMBLY_MARKERS.map(marker => marker.length)) - 1;
  const found = new Set<string>();
  let overlap = '';
  for (let offset = 0; offset < bytes.length && found.size < ASSEMBLY_MARKERS.length; offset += chunkBytes) {
    const upper = (overlap + decoder.decode(bytes.subarray(offset, Math.min(offset + chunkBytes, bytes.length)))).toUpperCase();
    for (const marker of ASSEMBLY_MARKERS) if (upper.includes(marker)) found.add(marker);
    overlap = upper.slice(-overlapChars);
  }
  return { isAssembly: found.size > 0, markers: [...found] };
}
