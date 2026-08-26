import { type NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { rateLimit } from '@/lib/rate-limit';
import {
  AI_DESIGN_WORKSPACE_COMMAND_MAX_BYTES,
  parseAiDesignWorkspaceClientCommandV2,
} from '@/lib/ai/aiDesignWorkspaceCommandV2';
import {
  advanceServerAiDesignGeneration,
  executeAiDesignWorkspaceClientCommand,
  type AiDesignWorkspaceActionServiceResult,
} from '@/lib/ai/aiDesignWorkspaceActionService';
import { createAiDesignServerGenerationWorker } from '@/lib/ai/aiDesignServerGenerationWorker';
import { aiDesignServerRuntimeArtifacts } from '@/lib/ai/aiDesignServerRuntimeArtifacts';
import { loadServerAiDesignWorkspaceRuntime } from '@/lib/ai/aiDesignWorkspaceRuntimeStore';
import { evaluateAiDesignComplexCandidateSet } from '@/lib/ai/aiDesignComplexEvaluationService';

export const runtime = 'nodejs';

function serviceResponse(result: AiDesignWorkspaceActionServiceResult): NextResponse {
  if (result.ok) {
    return NextResponse.json({
      state: result.state,
      replayed: result.replayed,
      receipts: result.receipts,
      generationRequested: result.generationRequested,
    }, { status: result.generationRequested ? 202 : 200, headers: { 'Cache-Control': 'private, no-store' } });
  }
  const conflict = result.code === 'AI_DESIGN_WORKSPACE_REVISION_CONFLICT';
  const notFound = result.code === 'AI_DESIGN_WORKSPACE_NOT_FOUND';
  return NextResponse.json({ error: result.code, issues: result.issues, state: conflict ? result.state : undefined }, {
    status: conflict ? 409 : notFound ? 404 : 400,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

function storeError(error: unknown): NextResponse {
  const code = error instanceof Error ? error.message : 'AI_DESIGN_ACTION_FAILED';
  if (code === 'AI_DESIGN_WORKSPACE_NOT_FOUND') return NextResponse.json({ error: code }, { status: 404 });
  if (code === 'AI_DESIGN_WORKSPACE_REVISION_CONFLICT') return NextResponse.json({ error: code }, { status: 409 });
  if (code === 'AI_DESIGN_WORKSPACE_POSTGRES_AUTHORITATIVE_REQUIRED' || code.includes('SIGNING_SECRET')) return NextResponse.json({ error: code }, { status: 503 });
  if (code.includes('worker_') || code.includes('PROVIDER')) return NextResponse.json({ error: 'AI_DESIGN_GENERATION_WORKER_FAILED' }, { status: 502 });
  return NextResponse.json({ error: 'AI_DESIGN_ACTION_FAILED' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!rateLimit(`ai-design-workspace-action:${authUser.userId}`, 90, 60_000).allowed) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  let raw: unknown;
  try { raw = await readBoundedJson(req, AI_DESIGN_WORKSPACE_COMMAND_MAX_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    raw = null;
  }
  const parsed = parseAiDesignWorkspaceClientCommandV2(raw);
  if (!parsed.ok) return NextResponse.json({ error: 'INVALID_AI_DESIGN_WORKSPACE_COMMAND', issues: parsed.issues }, { status: 400 });
  const access = await resolveProjectAccess(getDbAdapter(), parsed.command.projectId, authUser);
  if (!access) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: 'Editor role required' }, { status: 403 });
  const ownerKey = `${authUser.userId}:${parsed.command.projectId}`;
  const signingSecret = process.env.GENERATION_EVIDENCE_SIGNING_SECRET ?? '';
  try {
    if (parsed.command.type === 'RUN_GENERATION_STAGE_REQUEST') {
      if (Buffer.byteLength(signingSecret, 'utf8') < 32) return NextResponse.json({ error: 'AI_DESIGN_EVIDENCE_SIGNING_SECRET_REQUIRED' }, { status: 503 });
      const worker = createAiDesignServerGenerationWorker({
        plan: authUser.plan,
        userId: authUser.userId,
        loadCheckpoint: async () => (await loadServerAiDesignWorkspaceRuntime(ownerKey, parsed.command.projectId, parsed.command.sessionId)).checkpoint,
        artifactSink: aiDesignServerRuntimeArtifacts,
      });
      return serviceResponse(await advanceServerAiDesignGeneration(
        ownerKey, parsed.command.projectId, parsed.command.sessionId,
        {
          worker, receiptSink: aiDesignServerRuntimeArtifacts, signingSecret,
          loadStageArtifactByOutputDigest: digest => aiDesignServerRuntimeArtifacts.getStageArtifactByOutputDigest(digest),
          putCandidateArtifactImmutable: artifact => aiDesignServerRuntimeArtifacts.putCandidateArtifactImmutable(artifact),
          evaluatePublishedConcepts: async ({ state, candidates, artifacts }) => evaluateAiDesignComplexCandidateSet({
            projectId: state.projectId,
            sessionId: state.session.sessionId,
            runId: state.generation!.runId,
            checkpointDigest: state.checkpoint.projectContentHash,
            candidates: artifacts.map(artifact => {
              const candidate = candidates.find(item => item.candidateId === artifact.candidateId);
              if (!candidate) throw new Error('AI_DESIGN_CANDIDATE_CRITIC_BINDING_FAILED');
              return { artifact, title: candidate.title, summary: candidate.summary };
            }),
            productStructure: null,
            crossDomainGraph: null,
          }, { sink: aiDesignServerRuntimeArtifacts, signingSecret }),
        },
        parsed.command.expectedRuntimeRevision,
      ));
    }
    return serviceResponse(await executeAiDesignWorkspaceClientCommand(ownerKey, authUser.plan, parsed.command, {
      receiptSink: aiDesignServerRuntimeArtifacts,
      signingSecret,
    }));
  } catch (error) { return storeError(error); }
}
