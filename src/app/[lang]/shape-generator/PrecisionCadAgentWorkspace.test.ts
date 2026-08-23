import { describe, expect, it } from 'vitest';
import { dirnameFromDesktopFilePath, loadRemotePrecisionCadBinding } from './PrecisionCadAgentWorkspace';

describe('dirnameFromDesktopFilePath', () => {
  it('extracts Windows parents without using Node path APIs', () => {
    expect(dirnameFromDesktopFilePath(String.raw`C:\Users\Ada\part.nfab`)).toBe(String.raw`C:\Users\Ada`);
    expect(dirnameFromDesktopFilePath(String.raw`C:/Users/Ada/part.nfab`)).toBe('C:/Users/Ada');
  });

  it('extracts POSIX parents and preserves the filesystem root', () => {
    expect(dirnameFromDesktopFilePath('/Users/ada/part.nfab')).toBe('/Users/ada');
    expect(dirnameFromDesktopFilePath('/part.nfab')).toBe('/');
  });

  it('fails closed for missing or non-path values', () => {
    expect(dirnameFromDesktopFilePath(null)).toBeNull();
    expect(dirnameFromDesktopFilePath('')).toBeNull();
    expect(dirnameFromDesktopFilePath('part.nfab')).toBeNull();
  });
});

describe('loadRemotePrecisionCadBinding', () => {
  it('combines only authoritative project and CAD revision responses', async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/cad-revisions')) {
        return new Response(JSON.stringify({
          ok: true,
          envelope: { workspace: { projectId: 'project-1', revision: 7 } },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ project: { id: 'project-1', updatedAt: 1_700_000_000_000 } }), { status: 200 });
    };
    await expect(loadRemotePrecisionCadBinding('project-1', fetcher)).resolves.toEqual({
      projectId: 'project-1',
      revision: 7,
      updatedAt: 1_700_000_000_000,
    });
  });

  it('fails closed for a missing or cross-project CAD revision', async () => {
    const missing = async (input: RequestInfo | URL) => String(input).endsWith('/cad-revisions')
      ? new Response('{}', { status: 404 })
      : new Response(JSON.stringify({ project: { id: 'project-1', updatedAt: 1 } }), { status: 200 });
    await expect(loadRemotePrecisionCadBinding('project-1', missing)).resolves.toBeNull();

    const mismatched = async (input: RequestInfo | URL) => String(input).endsWith('/cad-revisions')
      ? new Response(JSON.stringify({ envelope: { workspace: { projectId: 'project-2', revision: 1 } } }), { status: 200 })
      : new Response(JSON.stringify({ project: { id: 'project-1', updatedAt: 1 } }), { status: 200 });
    await expect(loadRemotePrecisionCadBinding('project-1', mismatched)).rejects.toThrow('REMOTE_BINDING_INVALID');
  });
});
