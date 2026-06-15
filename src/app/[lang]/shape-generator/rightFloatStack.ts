/**
 * Top-right floating panels share one horizontal stack. SCAD agent adds a base
 * inset; each additional open panel shifts left by one slot (approx. panel width).
 */

export const SCAD_AGENT_DOCK_INSET_PX = 428;
export const FLOAT_STACK_SLOT_PX = 300;
export const FLOAT_STACK_GAP_PX = 12;

export type Col1PanelId =
  | 'gen'
  | 'motion'
  | 'modal'
  | 'buckling'
  | 'tol'
  | 'surf'
  | 'mfgpipe'
  | 'cam'
  | 'mold'
  | 'rfq'
  | 'sweep'
  | 'draw'
  | 'copilot';

/** Returns pixel inset added to `right: 16 + inset` for each panel id (includes SCAD base + stack index). */
export function buildCol1RightInset(
  baseScadInset: number,
  flags: ReadonlyArray<{ id: Col1PanelId; active: boolean }>,
): (id: Col1PanelId) => number {
  const stride = FLOAT_STACK_SLOT_PX + FLOAT_STACK_GAP_PX;
  const active = flags.filter(f => f.active);
  return (id: Col1PanelId) => {
    const idx = active.findIndex(f => f.id === id);
    if (idx < 0) return baseScadInset;
    return baseScadInset + idx * stride;
  };
}
