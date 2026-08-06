import { describe, expect, it, vi } from 'vitest';
import type { OcctShape } from '@/lib/occt/types';
import { importStepWithRecovery } from './stepRecoveryPipeline';

const shape = { id: 's' } as OcctShape;
const repairable = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('x'),'2;1');
FILE_NAME(
/* name */ 'a',
/* time */ '',
(''),(''),'','',
/* authorisation */ $);
FILE_SCHEMA(('AP242'));
ENDSEC;
DATA;
#1=PRODUCT('a','a','',());
ENDSEC;
END-ISO-10303-21;
`;

describe('STEP recovery pipeline', () => {
  it('stops after the original successful import', async () => {
    const importer = vi.fn(async () => ({ ok: true, shape, warnings: [] }));
    const result = await importStepWithRecovery('STEP', importer, vi.fn());
    expect(result.attempts).toEqual([{ stage: 'original', status: 'pass' }]);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('performs one safe header-only retry and preserves the original source', async () => {
    const importer = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'header authorisation invalid', warnings: [] })
      .mockResolvedValueOnce({ ok: true, shape, warnings: [] });
    const result = await importStepWithRecovery(repairable, importer, vi.fn());
    expect(result.shape).toBe(shape);
    expect(result.repair?.kind).toBe('file-name-authorisation-unset-to-empty-string');
    expect(result.attempts.map(item => item.status)).toEqual(['fail', 'pass']);
    expect(importer.mock.calls[0]?.[0]).toBe(repairable);
    expect(importer.mock.calls[1]?.[0]).not.toBe(repairable);
  });

  it('does not loop or invent a repair for an inapplicable failure', async () => {
    const importer = vi.fn(async () => ({ ok: false, error: 'no transferable roots', warnings: [] }));
    const result = await importStepWithRecovery('NOT STEP', importer, vi.fn());
    expect(result.attempts).toEqual([
      { stage: 'original', status: 'fail', failure: expect.objectContaining({ code: 'NO_TRANSFERABLE_ROOTS' }) },
      { stage: 'header-normalize', status: 'not_applicable' },
    ]);
    expect(importer).toHaveBeenCalledTimes(1);
  });
});
