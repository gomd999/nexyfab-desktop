export const CAD_WORKSPACE_ORDER = [
  'design',
  'optimize',
  'generative',
  'render',
  'animation',
  'simulation',
  'thermal',
  'modal',
  'manufacture',
  'drawing',
  'electronics',
] as const

export type CadWorkspaceId = (typeof CAD_WORKSPACE_ORDER)[number]

export function isCadWorkspaceId(s: string): s is CadWorkspaceId {
  return (CAD_WORKSPACE_ORDER as readonly string[]).includes(s)
}
