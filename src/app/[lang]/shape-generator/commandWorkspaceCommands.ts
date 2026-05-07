import type { Command } from './CommandPalette';
import { CAD_WORKSPACE_LABELS } from './constants/labels';
import { applyCadWorkspace } from './cadWorkspace/applyCadWorkspace';
import { CAD_WORKSPACE_ORDER, type CadWorkspaceId } from './cadWorkspace/cadWorkspaceIds';

const ALT_SHORTCUTS = [
  'Alt+1', 'Alt+2', 'Alt+3', 'Alt+4', 'Alt+5', 'Alt+6', 'Alt+7', 'Alt+8', 'Alt+9',
  'Alt+0',
  'Alt+-',
] as const;

/** Alt+1…9, Alt+0, Alt+- match `useKeyboardShortcuts` workspace order. */
export function buildWorkspaceCommands(opts: {
  lang: string;
  isSketchMode: boolean;
  onOptimizeBlockedBySketch?: () => void;
  onAfterSelect?: () => void;
}): Command[] {
  const L = CAD_WORKSPACE_LABELS[opts.lang] ?? CAD_WORKSPACE_LABELS.en;
  const Lko = CAD_WORKSPACE_LABELS.ko;
  const slice = CAD_WORKSPACE_ORDER.slice(0, ALT_SHORTCUTS.length) as readonly CadWorkspaceId[];
  return slice.map((id, i) => ({
    id: `workspace-${id}`,
    label: `Workspace: ${L[id]}`,
    labelKo: `작업공간: ${Lko[id]}`,
    category: 'Workspace',
    icon: '🧭',
    shortcut: ALT_SHORTCUTS[i],
    action: () => {
      const r = applyCadWorkspace(id, { isSketchMode: opts.isSketchMode });
      if (!r.ok && r.reason === 'sketch') opts.onOptimizeBlockedBySketch?.();
      opts.onAfterSelect?.();
    },
  }));
}
