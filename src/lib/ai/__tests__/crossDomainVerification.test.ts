import { describe, expect, it } from 'vitest';
import { verifyCrossDomainDesign } from '../crossDomainVerification';

describe('cross-domain verification', () => {
  it('releases only complete mechanical and interior evidence', () => {
    const result = verifyCrossDomainDesign({
      structure: { valid: true }, placement: { required: 3, resolved: 3, invalid: 0 },
      assembly: { applicable: true, authoritativeDof: { ran: true, accepted: true }, preciseInterference: { ran: true, collisions: 0, missingGeometry: 0 } },
      interior: { applicable: true, spaceBoundary: { ran: true, openBoundaries: 0, conservative: true }, egress: { ran: true, passed: true, conservative: true }, doorSwing: { ran: true, clear: true, conservative: true }, mepInterference: { ran: true, collisions: 0, missingGeometry: 0, conservative: true } },
    });
    expect(result.releaseReady).toBe(true);
    expect(result.gates.every(gate => gate.status === 'passed')).toBe(true);
  });

  it('does not turn absent precise geometry, egress or placement into success', () => {
    const result = verifyCrossDomainDesign({
      structure: { valid: true }, placement: { required: 3, resolved: 2, invalid: 0 },
      assembly: { applicable: true }, interior: { applicable: true },
    });
    expect(result.releaseReady).toBe(false);
    expect(result.gates.filter(gate => gate.status === 'not_run').map(gate => gate.id)).toEqual([
      'placement', 'assembly-dof', 'precise-interference', 'space-boundary', 'egress', 'door-swing', 'mep-interference',
    ]);
  });

  it('fails measured collisions and invalid transforms', () => {
    const result = verifyCrossDomainDesign({
      structure: { valid: true }, placement: { required: 1, resolved: 0, invalid: 1 },
      assembly: { applicable: true, authoritativeDof: { ran: true, accepted: false }, preciseInterference: { ran: true, collisions: 2, missingGeometry: 0 } },
    });
    expect(result.gates.filter(gate => gate.status === 'failed')).toHaveLength(3);
    expect(result.releaseReady).toBe(false);
  });
});
