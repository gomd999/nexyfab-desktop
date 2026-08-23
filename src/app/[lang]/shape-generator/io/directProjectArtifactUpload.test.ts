import { describe, expect, it, vi } from 'vitest';
import { hashProjectArtifactFile, uploadProjectCadArtifact } from './directProjectArtifactUpload';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

describe('project artifact browser uploader', () => {
  it('hashes a Blob incrementally with the standard SHA-256 result', async () => {
    await expect(hashProjectArtifactFile(new Blob(['abc']))).resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('uploads a small object directly and rejects server evidence that does not match', async () => {
    const file = new File(['abc'], 'part.step');
    const hash = await hashProjectArtifactFile(file);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ uploadId: 'upload-1', method: 'PUT', contentType: 'application/step', resumable: false, uploadUrl: 'https://r2.test/put' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(json({ ok: true, idempotent: false, artifact: { artifactId: 'artifact-1', projectId: 'project-1', objectKey: 'private/key', byteLength: file.size, contentSha256: hash } }, 201));
    await expect(uploadProjectCadArtifact('project-1', file, { fetchImpl })).resolves.toMatchObject({ artifact: { artifactId: 'artifact-1' } });
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({ method: 'PUT', body: file });
  });

  it('resumes multipart upload from authoritative part state', async () => {
    const file = new File(['abcdefgh'], 'building.ifc');
    const hash = await hashProjectArtifactFile(file);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === 'https://r2.test/part-2') return new Response(null, { status: 200 });
      const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string; partNumber?: number };
      if (body.action === 'intent') return json({ uploadId: 'upload-2', method: 'MULTIPART_PUT', contentType: 'application/x-step', resumable: true, partSizeBytes: 4, totalParts: 2 });
      if (body.action === 'status') return json({ uploadedParts: [{ partNumber: 1, size: 4 }] });
      if (body.action === 'part-url' && body.partNumber === 2) return json({ uploadUrl: 'https://r2.test/part-2', alreadyUploaded: false });
      if (body.action === 'complete') return json({ ok: true, idempotent: false, artifact: { artifactId: 'artifact-2', projectId: 'project-1', objectKey: 'private/key-2', byteLength: file.size, contentSha256: hash } }, 201);
      return json({ code: 'UNEXPECTED' }, 500);
    });
    await expect(uploadProjectCadArtifact('project-1', file, { fetchImpl })).resolves.toMatchObject({ artifact: { artifactId: 'artifact-2' } });
    const partPuts = fetchImpl.mock.calls.filter(call => String(call[0]).startsWith('https://r2.test/part-'));
    expect(partPuts).toHaveLength(1);
    expect(partPuts[0]?.[0]).toBe('https://r2.test/part-2');
  });
});
