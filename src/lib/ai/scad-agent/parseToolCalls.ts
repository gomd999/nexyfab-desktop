/**
 * Extract tool_call JSON envelopes from model text.
 *
 * The system prompt instructs the model to emit:
 *
 *   ```tool_call
 *   { "id": "call_x", "name": "render", "args": {} }
 *   ```
 *
 * We accept lenient variants: ```tool_call ... ``` blocks, ```json ... ```
 * blocks containing { name, args }, and bare top-level JSON objects with
 * those fields. The model's free-text outside the blocks is preserved as
 * the assistant's narration.
 */
import type { ToolCall, ToolName } from './types';

const VALID_TOOL_NAMES = new Set<ToolName>([
  'write_scad', 'apply_diff', 'render', 'get_geometry',
  'add_feature_intent', 'add_composite_intent', 'search_bosl2', 'read_dfm',
  // Stage 1 — assembly tools
  'plan_design', 'write_module', 'list_modules', 'compose_assembly',
  // Stage 2 — multimodal visual verification
  'view_render',
  // B2 — checkpoint / revert
  'list_checkpoints', 'revert_to_checkpoint',
  // A (Stage 3) — OCCT B-rep
  'brep_primitive', 'brep_boolean', 'brep_fillet', 'brep_chamfer',
  'brep_shell', 'brep_to_mesh', 'brep_export_step', 'list_breps',
  // Stage 4 — sweep/loft/draft/helix + sketches + mates + drawing
  'brep_sweep', 'brep_loft', 'brep_draft', 'brep_helix',
  'sketch_create', 'sketch_add_constraint', 'sketch_solve', 'sketch_to_brep_extrude',
  'add_mate', 'list_mates', 'solve_mates',
  'brep_to_drawing', 'brep_export_drawing',
  // Stage 4 K — collab
  'collab_presence', 'collab_lock',
  // Stage 4 N — sheet metal calc
  'sheet_metal_bend_allowance', 'sheet_metal_box_flat',
  // Stage 4 P — GD&T
  'add_gdt_frame', 'list_gdt_frames',
  // Stage 4 Q — kinematics
  'check_gear_mesh', 'check_interference',
  // Stage 4 R — multi-doc refs
  'import_doc_ref', 'list_doc_refs',
  // Stage 4 T — FEA
  'fea_setup', 'fea_solve', 'fea_stress',
  // Stage 4 U — sheet metal multi-bend unfold
  'sheet_metal_unfold',
  // A3 — Stable face tags
  'list_face_tags',
  // Y1 — Clarification turn
  'ask_user',
  // Y3 — Multi-turn user preferences
  'set_user_pref', 'get_user_prefs', 'forget_user_pref',
  // Z1 — Parametric feature tree
  'tree_summary', 'tree_set_param', 'tree_remove_node',
  // Z4 — Standards library lookups
  'lookup_imperial_fastener', 'select_bearing', 'select_key',
  'select_retaining_ring', 'select_drill',
  // Z5 — PMI extensions + AP242 export
  'add_datum_target', 'add_surface_finish', 'add_annotated_dimension',
  'export_pmi_step_ap242',
  // Z6 — Engineering catalog RAG
  'query_engineering_catalog',
  // Σ — Simulation suite
  'sim_cfd', 'sim_mbd', 'sim_cam', 'sim_mold_fill', 'sim_optics', 'sim_thermal',
  // Ω — Generative design
  'topology_optimize', 'auto_mesh', 'find_design_patterns',
  // A3 — Standards library round 2
  'lookup_socket_head_cap', 'lookup_countersunk_screw',
  'lookup_dowel_pin', 'select_tapered_bearing',
]);

interface Parsed {
  /** Free-text narration with tool_call blocks stripped. */
  narration: string;
  toolCalls: ToolCall[];
}

let callIdCounter = 0;
function nextCallId(): string {
  return `call_${Date.now().toString(36)}_${(++callIdCounter).toString(36)}`;
}

function tryParseToolCall(raw: string, fallbackId?: string): ToolCall | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const name = obj.name;
  if (typeof name !== 'string' || !VALID_TOOL_NAMES.has(name as ToolName)) return null;
  const args = (obj.args && typeof obj.args === 'object') ? obj.args as Record<string, unknown> : {};
  const id = typeof obj.id === 'string' && obj.id.length > 0 ? obj.id : (fallbackId ?? nextCallId());
  return { id, name: name as ToolName, args };
}

export function parseToolCalls(text: string): Parsed {
  const toolCalls: ToolCall[] = [];
  let narration = text;

  // Match ```tool_call ... ``` and ```json ... ``` blocks with greedy strip.
  const blockRe = /```(tool_call|json)\s*\n([\s\S]*?)```/g;
  narration = narration.replace(blockRe, (_match, _lang: string, body: string) => {
    const tc = tryParseToolCall(body.trim());
    if (tc) {
      toolCalls.push(tc);
      return '';
    }
    return _match; // unrecognized — leave it in narration so caller can see
  });

  // Also tolerate inline JSON objects on their own line that look like a
  // tool call. This happens when smaller models forget code-fences.
  const inlineLines = narration.split('\n');
  const kept: string[] = [];
  for (const line of inlineLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}') && trimmed.includes('"name"')) {
      const tc = tryParseToolCall(trimmed);
      if (tc) {
        toolCalls.push(tc);
        continue;
      }
    }
    kept.push(line);
  }
  narration = kept.join('\n').trim();

  return { narration, toolCalls };
}
