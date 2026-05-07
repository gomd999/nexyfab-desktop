import { describe, it, expect } from 'vitest';
import { shouldSkipTelemetryDuplicateForCadAudit, CAD_EXPORT_TELEMETRY_SOURCES } from '@/lib/telemetryCadDedupe';

describe('telemetryCadDedupe', () => {
  it('lists export-related telemetry sources', () => {
    expect(CAD_EXPORT_TELEMETRY_SOURCES.has('drawing_export')).toBe(true);
    expect(CAD_EXPORT_TELEMETRY_SOURCES.has('mesh_export')).toBe(true);
    expect(CAD_EXPORT_TELEMETRY_SOURCES.has('cam_toolpath')).toBe(true);
  });

  it('skips duplicate telemetry for Pro+ info export events', () => {
    expect(
      shouldSkipTelemetryDuplicateForCadAudit({
        authUser: { plan: 'pro' },
        level: 'info',
        source: 'drawing_export',
      }),
    ).toBe(true);
    expect(
      shouldSkipTelemetryDuplicateForCadAudit({
        authUser: { plan: 'team' },
        level: 'info',
        source: 'mesh_export',
      }),
    ).toBe(true);
    expect(
      shouldSkipTelemetryDuplicateForCadAudit({
        authUser: { plan: 'enterprise' },
        level: 'info',
        source: 'cam_toolpath',
      }),
    ).toBe(true);
  });

  it('does not skip for anonymous / free', () => {
    expect(
      shouldSkipTelemetryDuplicateForCadAudit({
        authUser: null,
        level: 'info',
        source: 'drawing_export',
      }),
    ).toBe(false);
    expect(
      shouldSkipTelemetryDuplicateForCadAudit({
        authUser: { plan: 'free' },
        level: 'info',
        source: 'cam_toolpath',
      }),
    ).toBe(false);
  });

  it('does not skip errors or unrelated sources', () => {
    expect(
      shouldSkipTelemetryDuplicateForCadAudit({
        authUser: { plan: 'pro' },
        level: 'error',
        source: 'drawing_export',
      }),
    ).toBe(false);
    expect(
      shouldSkipTelemetryDuplicateForCadAudit({
        authUser: { plan: 'pro' },
        level: 'info',
        source: 'feature_pipeline',
      }),
    ).toBe(false);
  });
});
