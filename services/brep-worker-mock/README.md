# BREP worker (mock / dev)

Minimal HTTP service implementing the contract expected by `src/lib/brep-bridge/processBrepStep.ts`:

- `POST /tessellate` — body JSON `{ filename, base64, jobId }`
- Response JSON `{ previewMeshBase64?, previewStlBase64?, artifactUrl?, brepSessionToken?, error? }`

## Run locally

```bash
cd services/brep-worker-mock
npm run start
```

Set `BREP_WORKER_URL=http://127.0.0.1:8787` on the Next.js app.

Production should swap this for an OCCT or ParaSolid-backed worker; keep the same JSON contract.
