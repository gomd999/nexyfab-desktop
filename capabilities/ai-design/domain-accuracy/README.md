# AI Design domain-accuracy slice

This is the first AI Design extraction boundary. It exposes the fail-closed
accuracy assessment contract without moving model providers or API routes yet.

- Current implementation: compatibility adapter over `src/lib/ai/domainAccuracyProgram.ts`
- Required evidence: approved cases, independent reviewers, repeated campaigns, and gate pass rate
- Release state: NOT_READY until external evidence is current and complete
- Next extraction: move one design request behind auth/job/artifact contracts
