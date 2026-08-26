import { describe, expect, it } from 'vitest';
import { formatDfmPdfExportError } from './dfmPdfClientI18n';

const LOCALES = ['ko', 'en', 'ja', 'zh', 'es', 'ar'] as const;

describe('DFM PDF client errors', () => {
  it.each(LOCALES)('maps stable server errors to actionable %s copy', locale => {
    expect(formatDfmPdfExportError(locale, 'UNAUTHORIZED')).not.toBe(formatDfmPdfExportError(locale, 'UNKNOWN'));
    expect(formatDfmPdfExportError(locale, 'PAYLOAD_TOO_LARGE')).not.toBe(formatDfmPdfExportError(locale, 'UNKNOWN'));
    expect(formatDfmPdfExportError(locale, 'INVALID_DFM_PDF_REQUEST')).not.toBe(formatDfmPdfExportError(locale, 'UNKNOWN'));
  });

  it('normalizes public route aliases and does not expose an unknown server error', () => {
    expect(formatDfmPdfExportError('kr', 'HTTP_401')).toBe(formatDfmPdfExportError('ko', 'UNAUTHORIZED'));
    expect(formatDfmPdfExportError('cn', 'HTTP_413')).toBe(formatDfmPdfExportError('zh', 'PAYLOAD_TOO_LARGE'));
    expect(formatDfmPdfExportError('en', 'DATABASE_PASSWORD_LEAK')).not.toContain('DATABASE_PASSWORD_LEAK');
  });
});
