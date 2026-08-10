# Deployment performance and native CAD isolation

## Release invariant

The public web image contains no OpenSCAD, Gmsh, BOSL2, or Radiance executable. Native CAD work is accepted only through bounded Redis jobs and runs in `services/openscad-worker`. Closed-beta database rows, credentials, storage originals, and copyright assets are outside this change and must retain a zero-diff integrity receipt.

Required production variables on the web service:

- `REDIS_URL`
- `OPENSCAD_EXTERNAL_WORKER=1`
- `CAD_RUNTIME_EXTERNAL_WORKER=1`

The worker requires the same `REDIS_URL`; its image fixes `OPENSCAD_WORKER_ISOLATED=1` and `CAD_RUNTIME_WORKER_ISOLATED=1`.

## Railway service split

Web service:

- source: repository root or immutable `*-web:<commit-sha>` image
- Dockerfile: `/Dockerfile`
- start: `node server.js`
- health: `/api/health/live`

CAD runtime worker:

- source root: `/services/openscad-worker`
- Dockerfile: `/services/openscad-worker/Dockerfile`
- start: image `CMD`
- health: `/api/health/live`
- no public domain required

Railway watch paths are configured in the service Build settings, not in `railway.json`. Use these patterns when the service is connected to GitHub:

Web:

```text
/src/**
/public/**
/scripts/drawing-to-3d/**
/scripts/engineering-core/**
/Dockerfile
/.dockerignore
/package.json
/package-lock.json
/next.config.ts
/railway.json
/railway.toml
```

CAD runtime worker:

```text
/services/openscad-worker/**
```

Documentation and evidence-only commits therefore do not rebuild either service.

## Immutable image path

`.github/workflows/container-images.yml` builds the web image once, publishes a checksum-addressable tag to GHCR, publishes a pinned native CAD base, then builds the small worker application layer on that base. Connecting Railway services to those image tags skips Railway's source build phase. Keep the source-Dockerfile deployment path until the registry deployment has passed staging and rollback rehearsal.

## Commands

Timed local build:

```text
npm run build:timed
```

Verified web deployment:

```text
npm run deploy:railway:verified -- --service=nexyfab.com --environment=production --expected-build-id=<build-id>
```

Verified worker deployment (worker health is subsequently checked through the authenticated OpenSCAD health route or Redis smoke):

```text
npm run deploy:railway:verified -- --service=nexyfab-openscad-worker --environment=production --source=services/openscad-worker --path-as-root --site=none
```

The verifier does not treat `railway up` returning zero as success. It waits for the new deployment ID, requires `SUCCESS`/`ACTIVE`, rejects failed/crashed states, and verifies the live health response and optional build ID.

## Rollout order

1. Deploy the CAD worker and confirm both Redis queue lengths are available.
2. Run the OpenSCAD render smoke plus Gmsh/Radiance readiness checks.
3. Deploy the web image with both external-worker flags enabled.
4. Verify the live build ID, authenticated CAD health, daylight status, a precise FEA request, and papercraft DXF.
5. Compare the protected closed-beta snapshot; require zero differences.
6. Retain the previous web and worker deployment IDs until the observation window completes.
