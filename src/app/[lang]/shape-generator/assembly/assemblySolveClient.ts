import type { AssemblyState } from '@/lib/assembly/assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';
import type {
  AssemblyBrowserOnSolve,
  AssemblyBrowserSolveResult,
  AssemblySolverSelection,
} from './AssemblyBrowserModal';

/** Shared solve client used by embedded CAD workspaces. */
export const solveAssemblyFromBrowser: AssemblyBrowserOnSolve = async (
  state,
  featureTrees,
  solver,
  groupOptions,
) => {
  const incompletePartIds = state.parts
    .filter(part => !featureTrees[part.id] || featureTrees[part.id]!.nodes.length === 0)
    .map(part => part.id);
  if (state.parts.length === 0) {
    throw new Error('[ASSEMBLY_EMPTY] Add at least one part before solving.');
  }
  if (incompletePartIds.length > 0) {
    throw new Error(
      `[FEATURE_TREES_INCOMPLETE] Exact constraint solve requires an active FeatureTree for every part: ${incompletePartIds.join(', ')}`,
    );
  }
  const body: {
    state: AssemblyState;
    featureTrees: Record<string, FeatureTree>;
    solver?: AssemblySolverSelection;
    useGroups?: boolean;
    maxParallel?: number;
  } = { state, featureTrees };
  if (solver !== undefined) body.solver = solver;
  if (groupOptions) {
    body.useGroups = true;
    body.maxParallel = groupOptions.maxParallel;
  }
  const response = await fetch('/api/assembly-solve/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as
    | (AssemblyBrowserSolveResult & { ok: true })
    | { ok: false; code: string; message: string };
  if ('ok' in data && data.ok === false) throw new Error(`[${data.code}] ${data.message}`);
  if (data.phase !== 'real') {
    throw new Error('[AUTHORITATIVE_SOLVER_REQUIRED] The server did not run the real FeatureTree solver.');
  }
  return data;
};
