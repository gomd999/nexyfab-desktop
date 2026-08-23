# AI Design domain-accuracy slice

This is the first AI Design extraction boundary. It exposes the fail-closed
accuracy assessment contract without moving model providers or API routes yet.

- Current implementation: isolated deterministic assessment service with parity coverage against `src/lib/ai/domainAccuracyProgram.ts`
- Required evidence: approved cases, independent reviewers, repeated campaigns, and gate pass rate
- Release state: NOT_READY until external evidence is current and complete
- Next extraction: move one design request behind auth/job/artifact contracts

The slice folder is now a complete Docker build context. It exposes `/health/*`
and `POST /contract/assess`; it never invokes a live model. `AI_LIVE_ENABLED`
must be explicitly `false` for readiness until a separate model-release decision
exists. The Analysis dependency must also report `MODEL_NOT_RUN`.
