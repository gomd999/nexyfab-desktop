# Platform decisions

- 2026-08-23: Platform is the default owner of paths not explicitly assigned to Precision CAD, AI Design, or shared integration ownership.
- 2026-08-24: Customer uploads and generated manufacturing files must not be committed or served from `public/uploads/`; use private object storage with explicit access control and retention instead.
- 2026-08-24: Edge gateway, collaboration relay, and FEA readiness fail closed when required production configuration, dependency health, or immutable build identity is missing.
- 2026-08-24: Release promotion remains disabled until staging origin, current-image, live-runtime, restore, and rollback evidence are captured and pass.
- 2026-08-24: CI/release workflow hardening, dependency manifest changes, shared contract extraction, and Git history cleanup are integration-owned follow-up work.
