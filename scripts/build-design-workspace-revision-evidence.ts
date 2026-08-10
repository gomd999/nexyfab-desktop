import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  commitDesignWorkspaceRevision,
  commitWorkspaceAndArtifactModelChange,
  createDesignWorkspaceRevision,
  switchWorkspaceMode,
} from '../src/lib/ai/designWorkspaceRevision';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA, type DesignArtifactGraph } from '../src/lib/ai/designArtifactGraph';

const hash = (value: string) => value.repeat(64);
const passed = (id: string) => ({ status: 'passed' as const, verifierId: id, evidenceHash: hash('e'), issues: [] });
const output = resolve(process.argv[2] ?? 'docs/evidence/workspace/design-workspace-revision-260810.json');

const initial = createDesignWorkspaceRevision({
  projectId: 'wp7-evidence-project', lineageId: 'wp7-shared-lineage', domain: 'mechanical', documentHash: hash('a'),
});
const precision = switchWorkspaceMode(initial, { experience: 'expert', workMode: 'precision_cad' });
const manual = commitDesignWorkspaceRevision(precision.workspace, {
  baseRevision: 0, actor: 'expert', mode: 'precision_cad', documentHash: hash('b'),
  changedTargets: [{ kind: 'parameter', objectId: 'shaft-1', field: 'diameter' }],
  addLocks: [{
    id: 'expert-shaft-diameter', target: { kind: 'parameter', objectId: 'shaft-1', field: 'diameter' },
    source: 'expert', reason: 'Expert-approved fit dimension', valueHash: hash('b'),
  }],
});
const blockedAi = commitDesignWorkspaceRevision(manual.workspace, {
  baseRevision: 1, actor: 'ai', mode: 'ai_assisted', documentHash: hash('c'),
  changedTargets: [{ kind: 'parameter', objectId: 'shaft-1', field: 'diameter' }],
});

const graph: DesignArtifactGraph = {
  schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'wp7-evidence-project', revision: 1,
  artifacts: [
    { id: 'model', kind: 'model', revision: 1, contentHash: hash('a'), state: 'current', inputs: [], verification: passed('model-v1'), staleBecause: [] },
    { id: 'drawing', kind: 'drawing', revision: 1, contentHash: hash('d'), state: 'current', inputs: [{ artifactId: 'model', revision: 1, contentHash: hash('a') }], verification: passed('drawing-v1'), staleBecause: [] },
    { id: 'quantity', kind: 'quantity', revision: 1, contentHash: hash('3'), state: 'current', inputs: [{ artifactId: 'model', revision: 1, contentHash: hash('a') }], verification: passed('quantity-v1'), staleBecause: [] },
  ],
  dependencies: [
    { id: 'model-drawing', sourceId: 'model', targetId: 'drawing', policy: 'invalidate' },
    { id: 'model-quantity', sourceId: 'model', targetId: 'quantity', policy: 'invalidate' },
  ],
};
const aiAddition = commitWorkspaceAndArtifactModelChange(initial, graph, {
  baseRevision: 0, actor: 'ai', mode: 'ai_assisted', documentHash: hash('f'),
  changedTargets: [{ kind: 'feature', objectId: 'ai-rib-1' }],
  modelArtifactId: 'model', modelExpectedRevision: 1, modelContentHash: hash('f'), modelVerification: passed('model-v2'),
});

const evidence = {
  schema: 'nexyfab.design-workspace-revision-evidence.v1',
  generatedAt: new Date().toISOString(),
  claims: {
    externalCadInstallationRequired: false,
    guidedAndExpertShareLineage: precision.committed && precision.workspace.lineageId === initial.lineageId && precision.workspace.revision === initial.revision,
    manualAndExpertValuesOverrideAi: !blockedAi.committed && blockedAi.blockedLockIds.includes('expert-shaft-diameter'),
    modelAndArtifactCommitIsAtomic: aiAddition.committed && aiAddition.workspace.revision === 1 && aiAddition.graph.revision === 2,
    dependentArtifactsBecomeStale: aiAddition.staleArtifactIds,
  },
  checks: {
    modeSwitch: { committed: precision.committed, experience: precision.workspace.experience, workMode: precision.workspace.workMode },
    manualLockCommit: { committed: manual.committed, lockIds: manual.workspace.locks.map(lock => lock.id) },
    blockedAiChange: { committed: blockedAi.committed, issues: blockedAi.issues, blockedLockIds: blockedAi.blockedLockIds },
    artifactTransaction: { committed: aiAddition.committed, staleArtifactIds: aiAddition.staleArtifactIds, issues: aiAddition.issues },
  },
  releaseScope: 'WP7 behavioral evidence only; independent holdout and technical release audit remain WP9.',
};

async function writeEvidence(): Promise<void> {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(`${output}\n`);
}

void writeEvidence().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
