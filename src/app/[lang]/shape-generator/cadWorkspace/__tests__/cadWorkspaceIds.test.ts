import { describe, it, expect } from 'vitest';
import { CAD_WORKSPACE_ORDER, isCadWorkspaceId } from '../cadWorkspaceIds';

describe('cadWorkspaceIds', () => {
  it('has drawing at index 9 and electronics at 10 for Alt+0 / Alt+- shortcuts', () => {
    expect(CAD_WORKSPACE_ORDER[9]).toBe('drawing');
    expect(CAD_WORKSPACE_ORDER[10]).toBe('electronics');
  });

  it('isCadWorkspaceId accepts known ids and rejects unknown', () => {
    expect(isCadWorkspaceId('simulation')).toBe(true);
    expect(isCadWorkspaceId('drawing')).toBe(true);
    expect(isCadWorkspaceId('nope')).toBe(false);
  });
});
