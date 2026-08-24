# NexyFab

NexyFab is a Next.js 16 manufacturing platform that combines quoting,
production workflows, collaboration, CAD/AI tools, and supporting workers.
This repository is organized as a workspace with independently owned scopes and
an integration branch that controls shared release infrastructure.

## Prerequisites

- Node.js 22
- npm
- Docker for container and runtime checks
- PostgreSQL and Redis for features that depend on persistent state or queues

Install dependencies with the repository lockfile:

```powershell
npm ci --legacy-peer-deps
Copy-Item .env.example .env.local
```

Keep real credentials out of the repository. Customer uploads and generated
manufacturing files must use private object storage; `public/uploads/` is not an
approved storage location.

## Local development

```powershell
npm run dev
```

The main web application is available at `http://localhost:3000`. Individual
services and workers document their own environment variables and health
contracts in their local README files.

## Verification

Use the scope check before handing platform work to integration:

```powershell
npm run workspace:check -- platform
node workspaces/platform/run-quality.mjs
```

For a wider repository check, run the relevant lint, type, security, test, and
build commands:

```powershell
npm run lint:ci
npm run typecheck
npm run security:check
npm run build
```

The build succeeding does not mean a release is ready. Staging origins, immutable
build identifiers, readiness probes, rollback evidence, and live runtime evidence
must all pass before deployment is enabled.

## Workspace ownership

- `scope/platform`: web/backend platform, services, workers, and compatibility boundaries
- `scope/precision-cad`: Precision CAD product implementation
- `scope/ai-design`: AI Design product implementation
- `integration/nexyfab`: shared configuration, packages, CI, release workflows, and final verification

Read the matching `workspaces/<scope>/AGENTS.md` and `CURRENT.md` before making
changes. Shared paths listed in `workspaces/registry.json` require an explicit
integration decision.

## Repository map

- `src/`: legacy Next.js application and API routes
- `apps/`: isolated application/runtime boundaries
- `services/`: independently operated backend services
- `workers/`: queue and edge workers
- `collab-worker/`: real-time collaboration relay
- `packages/`: shared, versioned contracts and libraries
- `scripts/`: verification, security, migration, and operations tooling
- `docs/evidence/`: generated audit and release evidence
- `workspaces/`: scope ownership, current state, decisions, and handoffs

## Deployment safety

- Production gateways and relays fail closed when secrets, origins, or host
  allowlists are missing.
- Liveness reports process health; readiness includes required dependencies and
  immutable build identity.
- Deployment remains disabled while release-health evidence is `HOLD` or
  `BLOCKED`.
- Secrets discovered in tracked files require rotation and coordinated history
  cleanup, even after the working-tree files are removed.
- Generated reports are evidence, not substitutes for a staging restore and
  rollback drill.
