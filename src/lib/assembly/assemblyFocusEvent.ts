export const ASSEMBLY_FOCUS_PARTS_EVENT = 'nexyfab:assembly-focus-parts';
export const ASSEMBLY_FOCUS_RESULT_EVENT = 'nexyfab:assembly-focus-result';

export type AssemblyFocusPartsDetail = {
  partIds: string[];
  source: 'robot-evidence';
  queueItemId: string;
};

export type AssemblyFocusResultDetail = {
  queueItemId: string;
  selectedPartIds: string[];
  missingPartIds: string[];
};

export function resolveAssemblyFocusPartIds(requestedIds: readonly string[], availableIds: ReadonlySet<string>, latestSourceMap: ReadonlyMap<string, string>): Pick<AssemblyFocusResultDetail, 'selectedPartIds' | 'missingPartIds'> {
  const requested = [...new Set(requestedIds.filter(id => typeof id === 'string' && id.length > 0))];
  const resolved = requested.map(sourceId => ({ sourceId, documentId: latestSourceMap.get(sourceId) ?? sourceId }));
  return {
    selectedPartIds: resolved.filter(item => availableIds.has(item.documentId)).map(item => item.documentId),
    missingPartIds: resolved.filter(item => !availableIds.has(item.documentId)).map(item => item.sourceId),
  };
}
