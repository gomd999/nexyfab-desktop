import { describe, expect, it } from 'vitest';
import { aiDesignDurablePersistenceEnabled } from './aiDesignDeploymentMode';

describe('AI Design deployment mode', () => {
  it('allows durable beta persistence without granting commercial release authority', () => {
    expect(aiDesignDurablePersistenceEnabled({
      NEXYFAB_AI_DESIGN_DURABLE_MODE: '1',
      NEXYFAB_COMMERCIAL_MODE: '0',
    })).toBe(true);
  });

  it('keeps commercial deployments durable and local reference runs ephemeral', () => {
    expect(aiDesignDurablePersistenceEnabled({ NEXYFAB_COMMERCIAL_MODE: '1' })).toBe(true);
    expect(aiDesignDurablePersistenceEnabled({
      NEXYFAB_AI_DESIGN_DURABLE_MODE: '0',
      NEXYFAB_COMMERCIAL_MODE: '0',
    })).toBe(false);
  });
});
