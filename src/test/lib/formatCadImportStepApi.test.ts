import { describe, it, expect } from 'vitest';
import { formatCadImportError } from '@/app/[lang]/shape-generator/io/formatCadImportError';
import { StepImportApiError } from '@/app/[lang]/shape-generator/io/stepImportApiError';

describe('formatCadImportError server STEP API', () => {
  it('passes through StepImportApiError message', () => {
    const msg = formatCadImportError(new StepImportApiError('한도 초과', 'MONTHLY_LIMIT', 403));
    expect(msg).toBe('한도 초과');
  });
});
