/**
 * featureTreeAssistant — Phase 6 of NexyFab Pro own-CAD (ADR-013).
 *
 * Natural-language interface to the FeatureTree edit ops (Phase 2.6).
 * Same architecture as sketchAssistant: deterministic rule-based stub +
 * LLM upgrade path (Phase 6.2) sharing the same SuggestedTreeOp output.
 *
 * Scope (Phase 6 minimal):
 *   - 6 canonical commands recognized by the stub:
 *     - "change extrude depth to N" / "두께 N으로"
 *     - "delete <node name>" / "<이름> 삭제"
 *     - "suppress <node name>" / "<이름> 끄기"
 *     - "rename <node name> to <new name>" / "<이름> 이름을 <새이름>"
 *     - "move <node name> up" / "<이름> 위로"
 *     - "show all" / "모두 보이기" (un-suppress every node)
 *
 * Out of scope (Phase 6.2+):
 *   - LLM-based intent extraction for free-form prompts
 *   - Multi-step plans (e.g., "fillet all sharp edges then chamfer the top")
 *   - Voice input
 *   - Undo-aware command suggestions
 */

import type { FeatureNode, FeatureTree } from '@/lib/cad/featureTree';
import type { EditOp } from '@/lib/cad/featureTreeEdit';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

export interface SuggestedTreeOp {
  op: EditOp;
  confidence: number;
  rationale: string;
}

export interface TreeAssistantRequest {
  prompt: string;
  tree: FeatureTree;
  /**
   * Optional multi-turn conversation memory (Phase 6.3). The LLM wrapper
   * trims this to the last `MAX_HISTORY_TURNS` user/assistant pairs and
   * inserts them between the system prompt and the current user prompt.
   * The deterministic stub ignores history.
   */
  history?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
}

export interface TreeAssistantResponse {
  suggestions: ReadonlyArray<SuggestedTreeOp>;
  matched: boolean;
}

export function interpretTreeCommand(req: TreeAssistantRequest): TreeAssistantResponse {
  const text = req.prompt.trim();
  const lower = text.toLowerCase();
  const out: SuggestedTreeOp[] = [];

  // ── change extrude depth ────────────────────────────────────────────
  const depthMatch =
    text.match(/change\s+(?:extrude\s+)?depth\s+(?:to\s+)?(\d+(?:\.\d+)?)/i) ??
    text.match(/(?:두께|깊이)\s+(\d+(?:\.\d+)?)\s*(?:으?로|로)?/) ??
    text.match(/depth\s*=\s*(\d+(?:\.\d+)?)/i);
  if (depthMatch) {
    const newDepth = Number(depthMatch[1]!);
    const extrudeNode = req.tree.nodes.find((n) => n.payload.kind === 'extrude');
    if (extrudeNode && Number.isFinite(newDepth) && newDepth > 0) {
      const cur = extrudeNode.payload as ExtrudeFeature;
      const newPayload: ExtrudeFeature = { ...cur, depth: newDepth };
      out.push({
        op: { type: 'set_payload', nodeId: extrudeNode.id, payload: newPayload },
        confidence: 0.95,
        rationale: `Change ${extrudeNode.name} extrude depth to ${newDepth}mm.`,
      });
    }
  }

  // ── delete / suppress by node name ──────────────────────────────────
  const deleteMatch =
    text.match(/delete\s+["']?([^"']+)["']?/i) ??
    text.match(/(.+?)\s+(?:삭제|제거)/);
  if (deleteMatch) {
    const target = findByNameLoose(req.tree, deleteMatch[1]!);
    if (target) {
      out.push({
        op: { type: 'remove_node', nodeId: target.id },
        confidence: 0.9,
        rationale: `Remove node '${target.name}'.`,
      });
    }
  }

  const suppressMatch =
    text.match(/(?:suppress|turn\s+off|hide)\s+["']?([^"']+)["']?/i) ??
    text.match(/(.+?)\s+(?:끄기|숨기기)/);
  if (suppressMatch) {
    const target = findByNameLoose(req.tree, suppressMatch[1]!);
    if (target) {
      out.push({
        op: { type: 'set_suppressed', nodeId: target.id, suppressed: true },
        confidence: 0.9,
        rationale: `Suppress node '${target.name}'.`,
      });
    }
  }

  // ── rename ───────────────────────────────────────────────────────────
  const renameMatch =
    text.match(/rename\s+["']?([^"']+?)["']?\s+to\s+["']?([^"']+)["']?/i) ??
    text.match(/(.+?)\s+(?:이름을|을)\s+([^으]+?)(?:으?로|로)\s*(?:변경|바꾸)/);
  if (renameMatch) {
    const target = findByNameLoose(req.tree, renameMatch[1]!);
    const newName = renameMatch[2]!.trim();
    if (target && newName) {
      out.push({
        op: { type: 'set_name', nodeId: target.id, name: newName },
        confidence: 0.9,
        rationale: `Rename '${target.name}' to '${newName}'.`,
      });
    }
  }

  // ── show all / un-suppress every node ───────────────────────────────
  if (lower.includes('show all') || lower.includes('un-suppress all') || text.includes('모두 보이기') || text.includes('모두 켜기')) {
    for (const node of req.tree.nodes) {
      if (node.suppressed) {
        out.push({
          op: { type: 'set_suppressed', nodeId: node.id, suppressed: false },
          confidence: 1,
          rationale: `Unsuppress '${node.name}'.`,
        });
      }
    }
  }

  return { suggestions: out, matched: out.length > 0 };
}

// ─── helpers ──────────────────────────────────────────────────────────────

function findByNameLoose(tree: FeatureTree, query: string): FeatureNode | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  // Exact name match first, then substring.
  const exact = tree.nodes.find((n) => n.name.toLowerCase() === q);
  if (exact) return exact;
  return tree.nodes.find((n) => n.name.toLowerCase().includes(q));
}
