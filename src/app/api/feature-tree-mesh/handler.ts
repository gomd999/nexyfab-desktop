import { replayTree, validateTree, type FeatureTree } from '@/lib/cad/featureTree';

export type TreeMeshRenderer = (scad: string) => Promise<{ ok: true; bytes: Buffer } | { ok: false; code: string; message: string }>;

export async function handleFeatureTreeMesh(
  tree: FeatureTree,
  render: TreeMeshRenderer,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  if (!tree || !Array.isArray(tree.nodes)) return { status: 400, payload: { ok: false, code: 'BAD_REQUEST', message: 'tree.nodes is required' } };
  if (tree.nodes.length === 0) return { status: 422, payload: { ok: false, code: 'EMPTY_TREE', message: 'feature tree is empty' } };
  if (tree.nodes.length > 250) return { status: 413, payload: { ok: false, code: 'TOO_LARGE', message: 'feature tree exceeds 250 nodes' } };
  try { validateTree(tree); } catch (error) {
    return { status: 422, payload: { ok: false, code: 'INVALID_TREE', message: error instanceof Error ? error.message : 'invalid feature tree' } };
  }
  let scad: string;
  try { scad = replayTree(tree).scad; } catch (error) {
    return { status: 422, payload: { ok: false, code: 'REPLAY_FAILED', message: error instanceof Error ? error.message : 'feature replay failed' } };
  }
  const result = await render(scad);
  if (!result.ok) return { status: result.code === 'ENOENT' ? 503 : 500, payload: { ok: false, code: result.code, message: result.message } };
  return { status: 200, payload: { ok: true, stl: result.bytes.toString('base64'), nodeCount: tree.nodes.length } };
}
