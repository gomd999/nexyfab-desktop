/**
 * Fail-closed document reference adapter.
 *
 * A model-controlled URL or filesystem path would cross SSRF and local-file
 * boundaries. Production must inject a request-scoped adapter that resolves
 * an opaque private-file id only after authenticated ownership is checked.
 */
import type { DocRefAdapter } from './tools';

export const serverDocRefAdapter: DocRefAdapter = {
  async resolve() {
    return {
      ok: false,
      reason: 'Direct URL/path imports are disabled. Upload the CAD file to private storage and use an owner-authorized file reference.',
    };
  },
};
