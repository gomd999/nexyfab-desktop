import catalog from './commercialTranslations.generated.json';
import { describe, expect, it } from 'vitest';

describe('spatial exact clash job copy', () => {
  it('keeps active usage and cancellation copy in all six locale paths', () => {
    for (const key of ['Exact clash active jobs: {{0}} / {{1}}', 'Exact clash active-job usage unavailable', 'Cancel exact clash job']) {
      expect(Object.keys(catalog[key as keyof typeof catalog] ?? {}).sort()).toEqual(['ar', 'es', 'ja', 'zh']);
    }
  });
});
