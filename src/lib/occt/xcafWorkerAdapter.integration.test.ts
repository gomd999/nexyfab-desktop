import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createXcafWorker } from '../../../containers/occt-xcaf/src/workerClient';
import { adaptXcafInspectionToCanonicalDraft } from './xcafDocumentAdapter';

const source = Buffer.from('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n');

describe('GP-04 native worker to canonical adapter', () => {
  it('consumes the complete current producer receipt without a hybrid fixture', async () => {
    const native = path.join(process.cwd(), 'containers/occt-xcaf/src/mock-native.mjs');
    const worker = createXcafWorker({
      nativeCommand: { file: process.execPath, args: [native] },
      maxBytes: 1024 * 1024,
      defaultTimeoutMs: 1_000,
    });
    const inspection = await worker.inspect({ inputBytes: source });
    const result = adaptXcafInspectionToCanonicalDraft({
      projectId: 'project-1',
      documentId: 'document-1',
      namespace: 'mechanical',
      revisionId: 'revision-1',
      sequence: 0,
      sourceFormat: 'STEP',
      inspection,
    });

    expect(result).toMatchObject({ ok: true, release: 'HOLD', verification: 'NOT_RUN' });
    if (!result.ok) throw new Error(result.issues.join(','));
    expect(result.binding.workerIdentity).toMatchObject({
      status: 'PASS_NATIVE_INVOCATION_BOUND',
      nativeBinarySha256: inspection.nativeBinarySha256,
      program: { name: 'occt-xcaf-inspect', version: '2' },
    });
    expect(result.binding.kernelIdentity).toMatchObject({
      status: 'NATIVE_CLAIM_DYNAMIC_LINKAGE_UNBOUND',
      kernel: { name: 'OpenCASCADE', version: '7.6.3' },
    });
    expect(result.binding.objects[0]!.payload).toMatchObject({
      geometryIdentity: 'NOT_EXPOSED_BY_BINDING',
      validity: { status: 'PASS_NATIVE', nonManifoldEdgeCount: 0 },
      tolerance: { status: 'PASS_NATIVE', maxToleranceMm: 0.001 },
    });
  });
});
