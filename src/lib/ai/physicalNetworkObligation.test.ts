import { describe, expect, it } from 'vitest';
import { derivePhysicalNetworkObligation } from './physicalNetworkObligation';

describe('physical network obligation derivation', () => {
  it('requires a typed signal route for PT100 instead of accepting a simplified solid', () => {
    expect(derivePhysicalNetworkObligation('PT100 온도센서와 케이블을 포함한 조립품')).toMatchObject({
      required: true,
      obligations: expect.arrayContaining([
        { id: 'sensor_signal', acceptableSystems: ['electrical', 'data'] },
        { id: 'electrical', acceptableSystems: ['electrical'] },
      ]),
    });
  });

  it('requires independent physical systems when a product combines coolant and pneumatic routes', () => {
    const result = derivePhysicalNetworkObligation('Machine skid with coolant piping and pneumatic air line');
    expect(result.obligations.map(item => item.id)).toEqual(expect.arrayContaining(['cold_water', 'fluid', 'air']));
  });

  it('does not invent a service route for an ordinary solid bracket', () => {
    expect(derivePhysicalNetworkObligation('CNC aluminum mounting bracket')).toEqual({ required: false, obligations: [] });
  });
});
