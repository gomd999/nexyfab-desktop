/** Canonical JSON used by both browser review guards and server draft CAS. */
export function stableSpatialCadJson(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (Array.isArray(value)) return `[${value.map(stableSpatialCadJson).join(',')}]`;
    return JSON.stringify(value) ?? 'null';
  }
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stableSpatialCadJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

/** `updatedBy` is audit provenance, not editable CAD content. Revision and
 * parameters bind the mutation while allowing a reconstructed UI snapshot to
 * match the persisted document after an AI-authored revision. */
export function stableSpatialCadDocumentJson(document: object): string {
  const { updatedBy: _updatedBy, ...content } = document as Record<string, unknown>;
  return stableSpatialCadJson(content);
}
