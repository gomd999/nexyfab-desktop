// Shared 3-state (under / fully / over-or-conflict) presentation mapping for
// the sketch solver status — used by the TitleBar pill (ModelerShell), the
// SketchLeftPane footer and the SketchRightPane SOLVER section so they all
// agree. SolidWorks convention: under-constrained = blue/default, fully
// constrained = green, over-defined / conflicting = red.

import type { ShellSketchStatus } from './shellBridgeStore';

/** CSS color (var) for a solver status. */
export function sketchStatusColor(status: ShellSketchStatus | null): string {
  switch (status) {
    case 'ok': return 'var(--nx-ok, #3fb950)';
    case 'under-defined': return 'var(--nx-accent)';
    case 'over-defined':
    case 'inconsistent': return 'var(--nx-error, #f85149)';
    default: return 'var(--nx-text-3)';
  }
}

/** Human label, e.g. "Fully constrained · DOF 0" / "Over-defined · 2 redundant".
 *  Returns null when there is nothing to report (empty sketch). */
export function sketchStatusLabel(
  status: ShellSketchStatus | null,
  dof: number | null,
  redundantCount: number,
  isKo: boolean,
): string | null {
  switch (status) {
    case 'ok':
      return isKo ? '완전 정의 · DOF 0' : 'Fully constrained · DOF 0';
    case 'under-defined':
      return isKo ? `미정의 · DOF ${dof ?? '?'}` : `Under-defined · DOF ${dof ?? '?'}`;
    case 'over-defined':
      return redundantCount > 0
        ? (isKo ? `과정의 · 잉여 ${redundantCount}개` : `Over-defined · ${redundantCount} redundant`)
        : (isKo ? '과정의' : 'Over-defined');
    case 'inconsistent':
      return isKo ? '구속조건 충돌' : 'Conflicting constraints';
    default:
      return null;
  }
}
