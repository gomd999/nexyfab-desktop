import { describe, expect, it } from 'vitest';
import { evaluateDwgRevitCapability } from './dwgRevitCapability';

const absent = { platform: 'win32', registeredProgIds: [] as string[], odaCommandConfigured: false, revitWorkerConfigured: false };

describe('DWG/Revit native capability', () => {
  it('fails closed when AutoCAD COM is absent', () => expect(evaluateDwgRevitCapability('autocad-com', absent)).toMatchObject({ status: 'not_run', reason: 'autocad_com_unregistered' }));
  it('recognizes versioned AutoCAD COM registration', () => expect(evaluateDwgRevitCapability('autocad-com', { ...absent, registeredProgIds: ['AutoCAD.Application.25'] })).toMatchObject({ status: 'ready', matchedProgId: 'AutoCAD.Application.25' }));
  it('does not infer ODA readiness from platform', () => expect(evaluateDwgRevitCapability('oda-file-converter', absent)).toMatchObject({ status: 'not_run' }));
  it('requires an explicit Revit worker contract', () => expect(evaluateDwgRevitCapability('revit-worker', absent)).toMatchObject({ status: 'not_run', reason: 'revit_native_worker_unconfigured' }));
  it('accepts explicit external worker configuration', () => {
    expect(evaluateDwgRevitCapability('oda-file-converter', { ...absent, odaCommandConfigured: true }).status).toBe('ready');
    expect(evaluateDwgRevitCapability('revit-worker', { ...absent, revitWorkerConfigured: true }).status).toBe('ready');
  });
});
