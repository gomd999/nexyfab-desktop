#!/usr/bin/env node
/**
 * NexyFab 2D→3D — MCP server (stdio, newline-delimited JSON-RPC 2.0).
 * Claude Code / Claude Desktop / 기타 MCP 클라이언트에서 도면→3D 파이프라인을 tool-call.
 *
 * 등록:  claude mcp add nexyfab-drawing -- node <이 파일 절대경로>
 * 도구:
 *   extract_drawing   도면 이미지(PNG 경로) → 파라메트릭 intent 추출 (Gemini Vision)
 *   edit_drawing      추출 intent + 자연어 지시 → 편집된 intent (패치·게이트 검증)
 *   reconstruct_3d    추출 intent → 게이트 검증 + OpenSCAD + ComponentIntent
 *
 * 원칙(방법론): AI는 이해/패치만, 형상 생성·검증은 결정론 코드(reconstruct/gate).
 * 범위(정직, 260731 실측): 어휘 11종. 평가셋 50장(깨끗 25 · 스캔열화 25) 실측 —
 *   타입 50/50 · 파라미터 212/220(96.4%) · 구멍 30/30 · 기하 게이트 49/50.
 *   ⚠ 복잡 조립도·다부품 도면은 여전히 **미대응**이다(단일 부품 정투상 기준).
 *   extract/edit는 GEMINI_API_KEY(.env) 필요.
 */
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { extractDrawingFromImage } from "./extract.mjs";
import { editDrawing } from "./edit.mjs";
import { textToIntent, textToAssembly } from "./from-text.mjs";
import { buildAssembly } from "./assembly.mjs";
import {
  buildAssemblyTemplate,
  listAssemblyTemplates,
} from "./domain-assemblies.mjs";
import { sweepTemplate } from "./sweep.mjs"; // 파라미터 스윕(데이터 트리 대체 — 채팅형)
import { buildCorridor } from "./corridor.mjs"; // 코리더 — 도구로 노출(카탈로그 계약 미충족이라 템플릿 아님)
import { verify3d } from "./verify.mjs";
import { renderHtml } from "./html-render.mjs";
import { composeWithGate, emitComposite } from "./compose.mjs";
import { intentToStep } from "./to-step.mjs";
import { gate, toOpenScad } from "./reconstruct.mjs";
import { toComponentIntent } from "./to-intent.mjs";
import { verifyDomain, listDomains } from "./domain-verify.mjs";
import { analyzeDfm } from "./dfm.mjs";
import { listTemplates, presetWithVerify } from "./preset-registry.mjs";
import { fabSpec, estimateCost, toDxf, DEFAULT_RATES } from "./fab.mjs";
import {
  aiEditPart,
  applyPartPatch,
  faceOfPart,
  faceDragPatch,
  faceDimOf,
  partOps,
} from "./edit-part.mjs";
import { autoTagAssembly, assemblyAtLevel } from "./assembly.mjs";
import { bladeRingMesh } from "./gen-macros.mjs";
import { extractGdt, extractGdtFile } from "./gdt-import.mjs";
import { parseLandXml, parseLandXmlFile } from "./landxml-import.mjs";
import { stepRoundTrip } from "./roundtrip.mjs";
import {
  refineInterferencesMesh,
  applyInterferenceRefinement,
} from "./interference-refine.mjs";
import { runDesignBriefTool } from "./design-brief.mjs";
import { runCodeCheckTool } from "./codecheck.mjs";
import { interiorCheck } from "./interior-check.mjs";
import { landscapeCheck } from "./landscape-check.mjs";
import * as bridgeMod from "./bridge-check.mjs";
import { loadPathCheck, listUsages as loadPathUsages } from "./load-path.mjs";

// bridge_check 자동 디스패치(라우트 CHECK_DISPATCH 와 동일): 어셈블리 meta 필드로
// 아치·트러스·사장·현수·계단 간이 체인을 고르고, 없으면 거더교(bridgeCheck) 폴백.
const BRIDGE_DISPATCH = [
  { meta: "archMeta", fn: "archBridgeCheck" },
  { meta: "trussMeta", fn: "trussBridgeCheck" },
  { meta: "cableStayedMeta", fn: "cableStayedCheck" },
  { meta: "suspensionMeta", fn: "suspensionCheck" },
  { meta: "stairMeta", fn: "stairCheck" },
];

/**
 * ★260731 — 종전 5종은 **텍스트 경로의 어휘**였다. 도면 추출은 11종을 지원하는데
 *   MCP 는 5종만 고지하고 있었다 — 나머지는 있어도 고를 수 없는 것과 같다.
 * ⚠ 고지는 실제 지원과 같아야 한다. 적게 말하는 것도 갈림이다.
 */
const VOCAB =
  "plate_with_holes | stepped_plate | l_bracket | flange | bent_sheet";
const VOCAB_IMAGE =
  VOCAB +
  " | tube | rect_tube | box | cylinder | gusset | base_plate" +
  " | spur_gear | hex_bolt | wall_with_openings | slab_with_openings | tapered_girder";

// ── Remote proxy (analyze_fea·reconstruct_verify·reconstruct_fleet) ───────────
// 이 3종은 호스팅 서버의 바이너리(OpenSCAD·gmsh·OCCT·메시 처리) 또는 AI 함대가 필요 —
// scripts/ 에 로컬 엔진이 없으므로 NEXYFAB_API_KEY(Pro 이상)로 nexyfab.com API 를 호출한다.
// 키가 없으면 조용히 실패하지 않고 명시적으로 원격 전용임을 반환(정직). code_check 는 순수
// 룰셋이라 로컬(오프라인) 실행 — 이 프록시를 쓰지 않는다.
const _apiUrl = () =>
  (process.env.NEXYFAB_API_URL ?? "https://nexyfab.com").replace(/\/$/, "");
async function remoteCall(route, body, toolName) {
  const key = process.env.NEXYFAB_API_KEY;
  if (!key) {
    return {
      ok: false,
      remoteOnly: true,
      error: `'${toolName}' 는 원격 전용 — NEXYFAB_API_KEY 가 필요합니다. 이 도구는 호스팅 서버의 바이너리(OpenSCAD/gmsh/OCCT·LLM)를 사용하므로 로컬 엔진이 없습니다. Pro 이상 계정에서 키를 발급(nexyfab.com → 계정 → API Keys)한 뒤 환경변수 NEXYFAB_API_KEY 로 설정하세요.`,
    };
  }
  let res;
  try {
    res = await fetch(_apiUrl() + route, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return {
      ok: false,
      error: `원격 호출 실패(${_apiUrl()}${route}): ${String(e?.message ?? e)}`,
    };
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  }
  if (!res.ok && json && json.ok === undefined && json.error === undefined)
    json = { ok: false, error: `HTTP ${res.status}`, body: json };
  return json;
}

// reconstruct_verify 입력 정형: 확장자/format 으로 STL↔B-rep 경로와 요청 바디를 결정.
async function shapeReconstructInput(args) {
  const fs = await import("node:fs");
  let fmt = typeof args.format === "string" ? args.format.toLowerCase() : "";
  if (!fmt && typeof args.file === "string")
    fmt = (args.file.split(".").pop() ?? "").toLowerCase();
  if (!fmt)
    fmt = args.stlBase64 ? "stl" : typeof args.step === "string" ? "step" : "";
  if (!fmt)
    return {
      error:
        "file(.stl/.step/.iges/.ifc/.dwg/.sat/.x_t) 또는 format 이 필요합니다.",
    };
  const textFmts = {
    step: "step",
    stp: "step",
    iges: "iges",
    igs: "iges",
    ifc: "ifc",
    x_t: "x_t",
    xt: "x_t",
    xmt_txt: "x_t",
  };
  const binFmts = { dwg: "dwg", sat: "sat", sab: "sab" };
  try {
    if (fmt === "stl") {
      const stlBase64 =
        typeof args.stlBase64 === "string" && args.stlBase64
          ? args.stlBase64
          : fs.readFileSync(args.file).toString("base64");
      return { route: "/api/nexyfab/reverse-engineer/", body: { stlBase64 } };
    }
    if (textFmts[fmt]) {
      const step =
        typeof args.step === "string" && args.step
          ? args.step
          : fs.readFileSync(args.file, "utf8");
      return {
        route: "/api/nexyfab/drawing/import-step/",
        body: {
          step,
          format: textFmts[fmt],
          ...(args.name ? { name: args.name } : {}),
        },
      };
    }
    if (binFmts[fmt]) {
      const stlBase64 =
        typeof args.stlBase64 === "string" && args.stlBase64
          ? args.stlBase64
          : fs.readFileSync(args.file).toString("base64");
      return {
        route: "/api/nexyfab/drawing/import-step/",
        body: {
          stlBase64,
          format: binFmts[fmt],
          ...(args.name ? { name: args.name } : {}),
        },
      };
    }
    return {
      error: `지원하지 않는 포맷 '${fmt}' — stl|step|iges|ifc|dwg|sat|x_t`,
    };
  } catch (e) {
    return { error: `파일 읽기 실패: ${String(e?.message ?? e)}` };
  }
}

// reconstruct_verify 응답 정형: 게이트 판정 + export_step 넛지(정직한 실패를 다음 행동으로).
function finalizeReconstruct(r) {
  if (!r || r.ok === false) return r ?? { ok: false, error: "원격 응답 없음" };
  const gate = r.reconstructionGate;
  let suggestion;
  if (gate && gate.status !== "pass") {
    if (gate.suggestion === "export_step")
      suggestion =
        gate.message ??
        "원본을 STEP(AP242)로 재내보내기 하면 B-rep 충실 측정이 가능합니다.";
    else
      suggestion =
        "재구성 게이트 미통과 — 곡면/복합 형상은 원본 CAD 에서 STEP(AP242)로 재내보내기(export_step) 하면 충실 대조가 가능합니다.";
  }
  return {
    ok: true,
    reconstructionGate: gate ?? {
      status: "unavailable",
      reason: "no_gate_in_response",
    },
    ...(r.observedStats ? { observedStats: r.observedStats } : {}),
    ...(r.stats ? { stats: r.stats } : {}),
    ...(Array.isArray(r.candidates)
      ? { candidateCount: r.candidates.length }
      : {}),
    ...(suggestion ? { suggestion } : {}),
  };
}

export const tools = [
  {
    name: "cad_capabilities",
    description:
      "List the shared CAD v1 operations and their exact API, CLI and MCP mappings, including legacy compatibility status and the guarantee that CAD v1 has no quote/RFQ side effects.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "product_decomposition",
    description:
      "Natural language to a validated real multi-part CAD product: independent FeatureTrees, reusable definitions, instances, subassemblies and mates. Uses the same CAD v1 contract as web and CLI; never creates a quote or RFQ.",
    inputSchema: {
      type: "object",
      required: ["text"],
      additionalProperties: false,
      properties: { text: { type: "string", minLength: 1, maxLength: 8000 } },
    },
  },
  {
    name: "reconcile_topology_references",
    description:
      "Conservatively remap regenerated face/edge/vertex topology and atomically propagate safe references to mates, drawing dimensions, GD&T and PMI. Ambiguous/broken consumers are returned in review lists, never silently guessed.",
    inputSchema: {
      type: "object",
      required: ["previous", "current"],
      additionalProperties: false,
      properties: {
        previous: { type: "array", items: { type: "object" } },
        current: { type: "array", items: { type: "object" } },
        mates: { type: "array", items: { type: "object" } },
        dimensions: { type: "array", items: { type: "object" } },
        gdt: { type: "array", items: { type: "object" } },
        pmi: { type: "array", items: { type: "object" } },
      },
    },
  },
  {
    name: "cad_feature_program",
    description:
      "Create or edit an exact parametric part feature program. Accepts the current complete program and canonical face/edge/feature selection context so chat edits can be scoped to the selected target.",
    inputSchema: {
      type: "object",
      required: ["prompt"],
      additionalProperties: false,
      properties: {
        prompt: { type: "string", minLength: 1 },
        previousProgram: { type: "object" },
        selectionContext: { type: "object" },
        modelId: { type: "string" },
      },
    },
  },
  {
    name: "feature_tree_mesh",
    description:
      "Replay a validated FeatureTree and generate a tessellated STL artifact. Returns STL as base64 and never merges separate assembly parts.",
    inputSchema: {
      type: "object",
      required: ["tree"],
      additionalProperties: false,
      properties: { tree: { type: "object" } },
    },
  },
  {
    name: "export_part_step",
    description:
      "Export an exact analytic B-rep STEP from a validated CAD feature program. Returns base64 STEP plus manufacturing gate and artifact identity metadata.",
    inputSchema: {
      type: "object",
      required: ["program"],
      additionalProperties: false,
      properties: { program: { type: "object" } },
    },
  },
  {
    name: "verify_cad_assembly",
    description:
      "Run the shared CAD v1 assembly verification: real mate solve, approximate DoF, spatial AABB broad phase at rest and across every motion frame, refined by exact triangle SAT plus containment when meshable FeatureTrees are supplied. Unsupported final features retain the conservative failing verdict.",
    inputSchema: {
      type: "object",
      required: ["state"],
      additionalProperties: false,
      properties: {
        state: { type: "object" },
        featureTrees: { type: "object" },
        solver: { type: "string" },
        solverOptions: { type: "object" },
        useGroups: { type: "boolean" },
        maxParallel: { type: "integer" },
        localBoxes: { type: "object" },
        interferenceWhitelist: { type: "array", items: { type: "string" } },
        intendedContacts: { type: "array", items: { type: "object" } },
        allowedDoF: { type: "integer" },
        motion: { type: "object" },
        preciseInterference: { type: "boolean" },
      },
    },
  },
  {
    name: "verify_cad_project",
    description:
      "Run the shared fail-closed mechanical/interior project gates for hierarchy, placement, authoritative assembly DoF, precise interference, closed spaces, egress, MEP interference and continuous door swing clearance. Creates no quote or RFQ.",
    inputSchema: {
      type: "object",
      required: ["structure", "placement"],
      additionalProperties: false,
      properties: {
        structure: { type: "object" },
        placement: { type: "object" },
        assembly: { type: "object" },
        interior: { type: "object" },
      },
    },
  },
  {
    name: "verify_door_swing_clearance",
    description:
      "Verify a finite-thickness hinged door against obstacle polygons over its entire continuous angular sweep. Creates no quote or RFQ.",
    inputSchema: {
      type: "object",
      required: [
        "pivot",
        "closedAngleDeg",
        "openAngleDeg",
        "widthMm",
        "thicknessMm",
        "obstacles",
      ],
      additionalProperties: false,
      properties: {
        pivot: {
          type: "object",
          required: ["x", "y"],
          additionalProperties: false,
          properties: { x: { type: "number" }, y: { type: "number" } },
        },
        closedAngleDeg: { type: "number" },
        openAngleDeg: { type: "number" },
        widthMm: { type: "number", exclusiveMinimum: 0 },
        thicknessMm: { type: "number", exclusiveMinimum: 0 },
        requiredClearanceMm: { type: "number", minimum: 0 },
        obstacles: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "polygon"],
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1 },
              polygon: {
                type: "array",
                minItems: 3,
                items: {
                  type: "object",
                  required: ["x", "y"],
                  additionalProperties: false,
                  properties: { x: { type: "number" }, y: { type: "number" } },
                },
              },
            },
          },
        },
      },
    },
  },
  {
    name: "verify_space_boundary_closure",
    description:
      "Measure room boundary closure using a snapped planar graph, including open, non-manifold, intersecting and degenerate boundaries. Creates no quote or RFQ.",
    inputSchema: {
      type: "object",
      required: ["segments"],
      additionalProperties: false,
      properties: {
        snapToleranceMm: { type: "number", minimum: 0 },
        minimumAreaMm2: { type: "number", minimum: 0 },
        segments: {
          type: "array",
          minItems: 3,
          items: {
            type: "object",
            required: ["id", "start", "end"],
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1 },
              start: {
                type: "object",
                required: ["x", "y"],
                additionalProperties: false,
                properties: { x: { type: "number" }, y: { type: "number" } },
              },
              end: {
                type: "object",
                required: ["x", "y"],
                additionalProperties: false,
                properties: { x: { type: "number" }, y: { type: "number" } },
              },
            },
          },
        },
      },
    },
  },
  {
    name: "verify_egress_routes",
    description:
      "Calculate governed egress paths, bottleneck clear widths, travel distances and reachable independent exits. Criteria must be supplied by the project. Creates no quote or RFQ.",
    inputSchema: {
      type: "object",
      required: [
        "nodes",
        "edges",
        "originNodeIds",
        "exitNodeIds",
        "maximumTravelDistanceMm",
        "minimumClearWidthMm",
      ],
      additionalProperties: false,
      properties: {
        nodes: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["id", "point"],
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1 },
              kind: { type: "string", enum: ["origin", "exit", "junction"] },
              point: {
                type: "object",
                required: ["x", "y"],
                additionalProperties: false,
                properties: { x: { type: "number" }, y: { type: "number" } },
              },
            },
          },
        },
        edges: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "from", "to", "clearWidthMm"],
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1 },
              from: { type: "string" },
              to: { type: "string" },
              clearWidthMm: { type: "number", exclusiveMinimum: 0 },
              blocked: { type: "boolean" },
              oneWay: { type: "boolean" },
            },
          },
        },
        originNodeIds: {
          type: "array",
          minItems: 1,
          items: { type: "string" },
        },
        exitNodeIds: { type: "array", minItems: 1, items: { type: "string" } },
        maximumTravelDistanceMm: { type: "number", exclusiveMinimum: 0 },
        minimumClearWidthMm: { type: "number", exclusiveMinimum: 0 },
        minimumIndependentExits: { type: "integer", minimum: 1 },
      },
    },
  },
  {
    name: "verify_mep_interference",
    description:
      "Check continuous finite-radius MEP runs against other runs and building obstacles, preserving missing geometry as release-blocking evidence. Creates no quote or RFQ.",
    inputSchema: {
      type: "object",
      required: ["runs", "obstacles"],
      additionalProperties: false,
      properties: {
        defaultClearanceMm: { type: "number", minimum: 0 },
        runs: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "system", "centerline", "outerDiameterMm"],
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1 },
              system: { type: "string" },
              outerDiameterMm: { type: "number" },
              requiredClearanceMm: { type: "number", minimum: 0 },
              centerline: {
                type: "array",
                items: {
                  type: "object",
                  required: ["x", "y", "z"],
                  additionalProperties: false,
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                    z: { type: "number" },
                  },
                },
              },
            },
          },
        },
        obstacles: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "min", "max"],
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1 },
              penetrable: { type: "boolean" },
              min: {
                type: "object",
                required: ["x", "y", "z"],
                additionalProperties: false,
                properties: {
                  x: { type: "number" },
                  y: { type: "number" },
                  z: { type: "number" },
                },
              },
              max: {
                type: "object",
                required: ["x", "y", "z"],
                additionalProperties: false,
                properties: {
                  x: { type: "number" },
                  y: { type: "number" },
                  z: { type: "number" },
                },
              },
            },
          },
        },
      },
    },
  },
  {
    name: "verify_manufacturing_evidence",
    description:
      "Evaluate fail-closed CAD manufacturing evidence gates G0-G9. Missing checks are not_run, never passed. Read-only: creates no quote, RFQ, or artifact release.",
    inputSchema: { type: "object", additionalProperties: true, properties: {} },
  },
  {
    name: "evaluate_assembly_animation",
    description:
      "Evaluate a multi-part assembly animation at one frame using the shared deterministic pose/keyframe contract.",
    inputSchema: {
      type: "object",
      required: ["state", "animation", "frame"],
      additionalProperties: false,
      properties: {
        state: { type: "object" },
        animation: { type: "object" },
        frame: { type: "number" },
      },
    },
  },
  {
    name: "apply_assembly_animation_command",
    description:
      "Apply a deterministic, fail-closed timeline command to one assembly part. Supports part id/name, frame range, X/Y/Z translation, and mm; it does not guess unsupported intent.",
    inputSchema: {
      type: "object",
      required: ["state", "animation", "command"],
      additionalProperties: false,
      properties: {
        state: { type: "object" },
        animation: { type: "object" },
        command: { type: "string", minLength: 1 },
      },
    },
  },
  {
    name: "preview_assembly_selection_edit",
    description:
      "Preview a deterministic atomic edit scoped to selected assembly topology or one selected mate. Optionally returns minimally invalidated generationState. Set verifyBrep=true for exact OCCT before/after volume, bounds, topology counts and validity. Never creates a quote or RFQ.",
    inputSchema: {
      type: "object",
      required: ["state", "featureTrees", "selection", "command"],
      additionalProperties: false,
      properties: {
        state: { type: "object" },
        featureTrees: { type: "object" },
        selection: { type: "array", items: { type: "object" } },
        selectedMateIds: { type: "array", items: { type: "string" } },
        command: { type: "string", minLength: 1 },
        verifyBrep: { type: "boolean", default: false },
        generationState: { type: "object" },
      },
    },
  },
  {
    name: "push_pull_step_face",
    description:
      "Push or pull one deterministic planar face reference on an imported STEP B-rep and return a verified STEP artifact. Positive distance adds material; negative removes it. No quote or RFQ.",
    inputSchema: {
      type: "object",
      required: ["step", "faceRef", "distanceMm"],
      additionalProperties: false,
      properties: {
        step: { type: "string" },
        encoding: {
          type: "string",
          enum: ["base64", "utf8"],
          default: "base64",
        },
        faceRef: { type: "string", pattern: "^f\\.import\\.\\d+$" },
        distanceMm: { type: "number", not: { const: 0 } },
      },
    },
  },
  {
    name: "analyze_cad_reference",
    description:
      "Read-only exact STEP reference analysis using the shared CAD evidence contract. Returns evidence and tolerance policy only; never returns source CAD or local paths and never creates a quote or RFQ.",
    inputSchema: {
      type: "object",
      required: ["step", "encoding", "format", "scenarioId", "lengthUnit"],
      additionalProperties: false,
      properties: {
        step: {
          type: "string",
          minLength: 1,
          maxLength: 20000000,
          description:
            "Inline STEP source or base64; local file paths are not accepted. The API enforces the final 20 MiB decoded-byte limit.",
        },
        encoding: { type: "string", enum: ["base64", "utf8"] },
        format: { type: "string", enum: ["step", "stp"] },
        scenarioId: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]*$",
        },
        lengthUnit: {
          oneOf: [
            {
              type: "object",
              required: ["kind"],
              additionalProperties: false,
              properties: { kind: { const: "mm" } },
            },
            {
              type: "object",
              required: ["kind", "scaleToMm"],
              additionalProperties: false,
              properties: {
                kind: { const: "scale-to-mm" },
                scaleToMm: { type: "number", exclusiveMinimum: 0 },
                label: { type: "string", maxLength: 40 },
              },
            },
          ],
        },
        declaredSourceTolerance: {
          type: "object",
          required: ["value"],
          additionalProperties: false,
          properties: { value: { type: "number", exclusiveMinimum: 0 } },
        },
      },
    },
  },
  {
    name: "verify_ifc_semantic_roundtrip",
    description:
      "Compare inline source and re-imported IFC documents for GlobalId, spatial hierarchy, property/quantity/material definitions, and projected georeferencing. Read-only; no quote or RFQ.",
    inputSchema: {
      type: "object",
      required: ["beforeIfc", "afterIfc"],
      additionalProperties: false,
      properties: {
        beforeIfc: { type: "string", minLength: 1, maxLength: 20000000 },
        afterIfc: { type: "string", minLength: 1, maxLength: 20000000 },
      },
    },
  },
  {
    name: "build_ifc_domain_ir",
    description:
      "Build governed alignment or structural-analysis IR from one inline IFC document. Evaluates supported horizontal endpoint/direction geometry, including constrained CUBIC and VIENNESEBEND only when authoritative cant and gravity-center evidence is complete, and fails closed on incomplete evidence.",
    inputSchema: {
      type: "object",
      required: ["ifc", "domain"],
      additionalProperties: false,
      properties: {
        ifc: { type: "string", minLength: 1, maxLength: 20000000 },
        domain: { type: "string", enum: ["alignment", "structural-analysis"] },
        vienneseBendInputs: {
          type: "object",
          additionalProperties: {
            type: "object",
            additionalProperties: false,
            required: ["gravityCenterHeight", "provenance"],
            properties: {
              gravityCenterHeight: { type: "number", minimum: 0 },
              provenance: { type: "string", minLength: 1 },
            },
          },
        },
      },
    },
  },
  {
    name: "build_ifc_spatial_ir",
    description:
      "Build governed IFC occurrence/spatial IR with world transforms, including local, straight-grid, explicit linear and PointByDistanceExpression alignment placements. Returns linear-placement cross-check evidence and fails closed on unresolved transforms.",
    inputSchema: {
      type: "object",
      required: ["ifc"],
      additionalProperties: false,
      properties: {
        ifc: { type: "string", minLength: 1, maxLength: 20000000 },
      },
    },
  },
  {
    name: "analyze_step_mechanical_relations",
    description:
      "Measure STEP assembly cylinder axes, repeated placements, thin panels, and elongated structural members; report relation, pattern, sheet-metal, and weldment evidence without inventing missing manufacturing semantics.",
    inputSchema: {
      type: "object",
      required: ["step"],
      additionalProperties: false,
      properties: {
        step: { type: "string", minLength: 1, maxLength: 20000000 },
        angularToleranceRad: { type: "number", exclusiveMinimum: 0 },
        linearTolerance: { type: "number", exclusiveMinimum: 0 },
      },
    },
  },
  {
    name: "plan_ifc_geometry_recovery",
    description:
      "Return occurrence-scoped missing geometry axes, evidence-based recovery action, and exact authoritative inputs required. Never invents dimensions or creates a quote/RFQ.",
    inputSchema: {
      type: "object",
      required: ["ifc"],
      additionalProperties: false,
      properties: {
        ifc: { type: "string", minLength: 1, maxLength: 20000000 },
      },
    },
  },
  {
    name: "recover_ifc_geometry",
    description:
      "Apply operator-confirmed physical widths only to matching IFC GlobalId occurrences with one missing axis. Returns application evidence and fails closed for unused, invalid, duplicate, or unprovenanced inputs. No quote or RFQ.",
    inputSchema: {
      type: "object",
      required: ["ifc", "authoritativeInputs"],
      additionalProperties: false,
      properties: {
        ifc: { type: "string", minLength: 1, maxLength: 20000000 },
        authoritativeInputs: {
          type: "array",
          maxItems: 1000,
          items: {
            type: "object",
            required: ["globalId", "physicalWidthMm", "provenance"],
            additionalProperties: false,
            properties: {
              globalId: { type: "string", pattern: "^[0-9A-Za-z_$]{22}$" },
              physicalWidthMm: { type: "number", exclusiveMinimum: 0.5 },
              provenance: { type: "string", minLength: 3 },
            },
          },
        },
      },
    },
  },
  {
    name: "verify_assembly_animation",
    description:
      "Verify sampled and continuous animation motion with exact swept-AABB broad phase, FeatureTree/OCCT mesh separation, conservative interval motion bounds, and a left-to-right first-collision time bracket. Unresolved or budget-exceeded CCD/TOI cannot pass release.",
    inputSchema: {
      type: "object",
      required: ["state", "animation", "localBoxes"],
      additionalProperties: false,
      properties: {
        state: { type: "object" },
        animation: { type: "object" },
        localBoxes: { type: "object" },
        featureTrees: { type: "object" },
        frameStep: { type: "integer" },
        rotationalMaxDepth: { type: "integer", minimum: 0, maximum: 16 },
        toiMaxDepth: { type: "integer", minimum: 0, maximum: 24 },
        toiFrameTolerance: { type: "number", exclusiveMinimum: 0 },
        toiMaxEvaluations: { type: "integer", minimum: 1, maximum: 100000 },
      },
    },
  },
  {
    name: "verify_ai_generation",
    description:
      "Fail-closed verification of the complete staged AI CAD process: intent, independent parts, manufacturing gates, mate solve, declared DoF, precise interference, motion and STEP roundtrip. Read-only and never creates a quote or RFQ.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      required: ["intent", "decomposition", "parts"],
      properties: {
        intent: { type: "object" },
        decomposition: { type: "object" },
        parts: { type: "array" },
      },
    },
  },
  {
    name: "transition_ai_generation_state",
    description:
      "Initialize, record, recover, or selection-edit-invalidate the ordered AI CAD generation state with SHA-256 checkpoints and bounded retry evidence. Creates no quote or RFQ.",
    inputSchema: {
      type: "object",
      required: ["action"],
      additionalProperties: true,
      properties: {
        action: {
          type: "string",
          enum: ["initialize", "record", "recover", "invalidate_edit"],
        },
        runId: { type: "string" },
        state: { type: "object" },
        completion: { type: "object" },
        stage: { type: "string" },
        previousFingerprints: { type: "array", items: { type: "string" } },
        maxAttempts: { type: "integer", minimum: 1 },
        transaction: { type: "object" },
      },
    },
  },
  {
    name: "advance_ai_generation",
    description:
      "Build real part collision geometry, verify watertight topology, and obtain an assembly certificate before advancing the ordered AI CAD run. Optional stages remain pending without evidence. No quote or RFQ.",
    inputSchema: {
      type: "object",
      required: ["state", "program"],
      additionalProperties: false,
      properties: {
        state: { type: "object" },
        program: { type: "object" },
        allowedDoF: { type: "integer", minimum: 0, default: 0 },
      },
    },
  },
  {
    name: "finalize_ai_generation",
    description:
      "Server-verify required animation frames, per-part manufacturing G0-G7, caller-supplied reference STEP requirements (flat pattern, bend table, member identity, miter lengths, cut list), STEP export/re-import measurements, and exact-artifact G9 authorization with affected-part-only recovery. Reference STEP pass claims are never trusted from the caller. No quote or RFQ.",
    inputSchema: {
      type: "object",
      required: ["state", "program", "motion", "parts"],
      additionalProperties: false,
      properties: {
        state: { type: "object" },
        program: { type: "object" },
        motion: { type: "object" },
        parts: {
          type: "array",
          items: {
            type: "object",
            description:
              "Per-part evidence. referenceStep may contain raw STEP source and required manufacturing checks; the server derives every verdict.",
          },
        },
      },
    },
  },
  {
    name: "generate_robot_6axis",
    description:
      "Generate a six-axis robot as independent editable structural parts and run workspace, singularity, sampled self-collision, static torque and cable bend/twist checks. Missing catalog components remain explicit blockers. No quote or RFQ.",
    inputSchema: {
      type: "object",
      required: ["spec"],
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        spec: { type: "object" },
        catalog: { type: "array", items: { type: "object" } },
        targets: { type: "array", items: { type: "object" } },
        path: { type: "array", items: { type: "object" } },
        cableRoutes: { type: "array", items: { type: "object" } },
        cableKeepOut: { type: "array", items: { type: "object" } },
        serviceEnvelopes: { type: "array", items: { type: "object" } },
        serviceObstacles: { type: "array", items: { type: "object" } },
      },
    },
  },
  {
    name: "verify_sheet_metal",
    description:
      "Run the real sheet-metal unfold engine and return developed length, bend table, warnings, and flat DXF. Read-only; no quote or RFQ.",
    inputSchema: {
      type: "object",
      required: ["spec"],
      additionalProperties: false,
      properties: { partId: { type: "string" }, spec: { type: "object" } },
    },
  },
  {
    name: "verify_weldment",
    description:
      "Run real structural-member miter measurement and return member cuts, stock length, mass, and cut-list evidence. Read-only; no quote or RFQ.",
    inputSchema: {
      type: "object",
      required: ["spec"],
      additionalProperties: false,
      properties: { partId: { type: "string" }, spec: { type: "object" } },
    },
  },
  {
    name: "analyze_tolerance_stack",
    description:
      "Compute deterministic 1D worst-case and RSS tolerance stack-up; worst-case is the release criterion.",
    inputSchema: {
      type: "object",
      required: ["dimensions"],
      additionalProperties: false,
      properties: {
        dimensions: { type: "array", items: { type: "object" } },
        lowerSpec: { type: "number" },
        upperSpec: { type: "number" },
      },
    },
  },
  {
    name: "verify_cad_pmi",
    description:
      "Validate GD&T callouts and require every target to resolve to supplied stable topology references.",
    inputSchema: {
      type: "object",
      required: ["callouts", "validTopologyRefs"],
      additionalProperties: false,
      properties: {
        callouts: { type: "array", items: { type: "object" } },
        validTopologyRefs: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "design_brief",
    description:
      `★ Wave A AI 설계 드라이버 — 한 문장 brief → **검증된 설계 패키지** 또는 명시 거부. ` +
      `LLM은 계획(DesignPlan)까지만, 그 아래는 전부 결정론: 지오메트리(부피·워터타이트)→조립 수렴→` +
      `DFM→치수 실측 게이트를 모두 실행하고, 전 게이트 통과 시에만 패키지(부품별 3뷰 시트 IR·DXF·` +
      `실측 치수·BOM·검증 리포트)를 낸다. 하나라도 실패하면 패키지 없이 거부 IR(stage·reason·failed ` +
      `게이트 id — 값 날조 없음). API/웹과 동일 계약(결정론 플래너 기준). 현재 플래너는 fixture 3종` +
      `(l-bracket·stepped-shaft·pin-block-assembly); 미지 brief는 정직 거부(LLM 플래너=WA-D1).`,
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", description: "설계 요청 자연어(brief.text)" },
        id: {
          type: "string",
          description: "brief id(생략 시 fixture/text에서 파생)",
        },
        fixture: {
          type: "string",
          description:
            "결정론 플래너 라우팅 키: l-bracket | stepped-shaft | pin-block-assembly",
        },
        params: { type: "object", description: "구조화 파라미터(숫자/문자)" },
      },
    },
  },
  {
    name: "compose_3d",
    description:
      `★ 범용 자유조합 — 고정 어휘(7종) 없이 AI가 범용 프리미티브(revolve/extrude/cylinder/box/sphere ` +
      `+ boolean/pattern/placement)를 조합해 임의 형상을 만든다. "수처리 탱크·용기·축·복합부품" 등 ` +
      `템플릿 밖 형상 대응. 흐름: 텍스트 → AI 조합 → 결정론 게이트(폴리곤 닫힘·회전축·정규화) → ` +
      `게이트 실패 시 AI 교정루프 → 실렌더 manifold 검증. AI=계획, 형상·검증=결정론. ` +
      `반환: {intent, gatePassed, rounds, verify(manifold), scad}. 실증: 200L 원뿔탱크 텍스트→manifold.`,
    inputSchema: {
      type: "object",
      required: ["description"],
      properties: {
        description: {
          type: "string",
          description: "만들 부품/장비 자연어 설명",
        },
        maxRounds: { type: "integer" },
      },
    },
  },
  {
    name: "text_to_intent",
    description:
      `입구 B — 자연어 텍스트만으로 파라메트릭 도면 intent를 생성한다(이미지 불필요). 예: ` +
      `"가로 200 세로 100 두께 10 판, 네 귀퉁이 안쪽 15에 ⌀8 구멍 4개". 어휘 5종. ` +
      `치수 미기입 시 통상값+confidence↓(오라클 아닌 "계획서"). 출력은 extract_drawing과 동일 형식 — ` +
      `edit_drawing/reconstruct_3d로 이어진다. AI는 설명→intent까지만, 형상·검증은 결정론.`,
    inputSchema: {
      type: "object",
      required: ["description"],
      properties: {
        description: { type: "string", description: "부품 자연어 설명" },
        model: { type: "string" },
      },
    },
  },
  {
    name: "text_to_assembly",
    description:
      `자연어로 복합 다부품 제품(어셈블리)을 생성한다. 예: "200×200×10 베이스판 위 네 귀퉁이에 ` +
      `80×60 L브래킷 4개". AI는 어셈블리 계획(부품+배치)까지만; 각 부품은 결정론 재구성, ` +
      `부품별 기하 게이트 + 부품쌍 AABB 간섭검사. 출력: OpenSCAD + 부품 목록 + 간섭 경고. ` +
      `범위=어휘 5종 조합·축정렬 배치(자유 조립 아님).`,
    inputSchema: {
      type: "object",
      required: ["description"],
      properties: {
        description: { type: "string" },
        model: { type: "string" },
      },
    },
  },
  {
    name: "build_assembly",
    description:
      `어셈블리 계획(JSON: {name, parts:[{id,type,params,at}]})을 결정론적으로 3D로 빌드·검증한다 ` +
      `(Gemini 불필요). text_to_assembly 산출을 사람이 수정한 뒤 재빌드하거나, 직접 계획을 넣을 때 사용. ` +
      `출력: OpenSCAD + 부품 AABB + 게이트/간섭 리포트.`,
    inputSchema: {
      type: "object",
      required: ["assembly"],
      properties: {
        assembly: {
          type: "object",
          description:
            "{name, parts:[{id,type,params,at:{tx,ty,tz,rx,ry,rz}}]}",
        },
      },
    },
  },
  {
    name: "export_step",
    description:
      `범용 조합 intent(compose_3d 산출)를 **진짜 B-rep STEP**으로 방출한다(CNC/제조용). ` +
      `OpenSCAD(메시)와 달리 replicad/OCCT로 해석적 B-rep 빌드 — revolve/extrude/cylinder/box/sphere ` +
      `+ boolean(fuse/cut) + pattern. outPath에 .step 저장, 엔티티 수 반환. 실증: 200L탱크→480엔티티.`,
    inputSchema: {
      type: "object",
      required: ["intent", "outPath"],
      properties: {
        intent: { type: "object", description: "compose_3d 범용조합 intent" },
        outPath: { type: "string", description: ".step 절대경로" },
      },
    },
  },
  {
    name: "html_render",
    description:
      `intent 또는 어셈블리를 브라우저에서 바로 열리는 자립형 3D 뷰어 HTML로 렌더한다 ` +
      `(사용자 요청 "html형 랜더링"). 실렌더 STL 임베드 + three.js PBR·조명·궤도컨트롤·📷스크린샷. ` +
      `outPath에 파일로 저장하고 경로·크기 반환. 제안서/공유용 오프라인 파일.`,
    inputSchema: {
      type: "object",
      required: ["outPath"],
      properties: {
        intent: {
          type: "object",
          description: "단품 intent (intent 또는 assembly 중 하나)",
        },
        assembly: { type: "object", description: "어셈블리 계획" },
        outPath: { type: "string", description: "저장할 .html 절대경로" },
        title: { type: "string" },
        subtitle: { type: "string" },
      },
    },
  },
  {
    name: "verify_3d",
    description:
      `정확성 검증 — intent를 실제 openscad-wasm으로 렌더해 STL의 bbox·manifold를 ` +
      `기대 치수와 대조한다. "만들었다"가 아니라 "만든 것이 치수와 맞다"를 기계 확인. ` +
      `반환: {pass, manifold, nonManifoldEdges, dims[{axis,expected,actual,errorMm}], maxErrorMm}. ` +
      `치수 정확도엔 VLM보다 이 결정론 대조가 강함.`,
    inputSchema: {
      type: "object",
      required: ["intent"],
      properties: {
        intent: {
          type: "object",
          description: "extract/text/edit 산출 intent",
        },
        tolMm: { type: "number", description: "허용오차(기본 0.5)" },
      },
    },
  },
  {
    name: "extract_drawing",
    description:
      `기계 제작 도면 이미지(3각법 정투상 PNG)를 읽어 파라메트릭 intent(치수·구멍 등)로 추출한다. ` +
      `Gemini Vision 사용. 지원 어휘: ${VOCAB_IMAGE}. ` +
      `실측(260731, 평가셋 50장 = 깨끗 25 + 스캔열화 25): 타입 50/50 · 파라미터 96.4% · 구멍 30/30 · 게이트 49/50. ` +
      `⚠ 복잡 조립도·다부품 도면은 미대응(단일 부품 정투상 기준). ` +
      `반환: {type, 치수필드…, holes[], confidence, missingFields?, missingNote?}. ` +
      `못 읽은 치수는 지어내지 않고 missingFields 로 알린다 — 그때 confidence 는 0.4 이하로 강등된다. ` +
      `이후 edit_drawing/reconstruct_3d로 이어진다.`,
    inputSchema: {
      type: "object",
      required: ["imagePath"],
      properties: {
        imagePath: {
          type: "string",
          description: "로컬 도면 이미지 절대경로 (png · jpg · webp)",
        },
        model: {
          type: "string",
          description: "Gemini 모델 (기본 gemini-2.5-flash)",
        },
      },
    },
  },
  {
    name: "edit_drawing",
    description:
      `추출된 도면 intent를 자연어 지시로 수정한다. 예: "두께 12로, 구멍 전부 ⌀10, (90,45)에 ⌀6 추가". ` +
      `AI는 구조화 패치(setParams/holes.add·removeNearest·setDiameterAll)만 제안하고, 적용·검증은 결정론. ` +
      `잘못된 편집(판 밖 구멍 등)은 게이트가 거부·롤백한다. 반환: {accepted, extraction, changes, gateErrors, intent}.`,
    inputSchema: {
      type: "object",
      required: ["extraction", "instruction"],
      properties: {
        extraction: {
          type: "object",
          description: "extract_drawing 산출 intent (또는 이전 edit 결과)",
        },
        instruction: { type: "string", description: "자연어 수정 지시" },
      },
    },
  },
  {
    name: "reconstruct_3d",
    description:
      `추출/편집된 intent를 결정론적으로 3D로 재구성한다. 기하 게이트(범위·판재성·구멍 내접) 검증 후 ` +
      `OpenSCAD 텍스트 + shape-generator ComponentIntent(op:subtract 포함)를 반환. 게이트 실패 시 gateErrors만. ` +
      `SCAD는 OpenSCAD/openscad-wasm으로 STL/STEP 렌더 가능.`,
    inputSchema: {
      type: "object",
      required: ["extraction"],
      properties: {
        extraction: {
          type: "object",
          description: "intent (extract 또는 edit 산출)",
        },
      },
    },
  },
  {
    name: "list_domains",
    description:
      `분야별 상시검증(②)에 쓸 수 있는 설계 분야·계산기·입력 명세를 반환한다. ` +
      `분야: 가설·랙·경량철골(좌굴·휨) / 건축 부재(RC 보) / 조경 배수. 각 계산기의 status(draft 등)와 ` +
      `근거(refs), 사용자 입력 필드(하중·재료)를 준다. 형상이 줄 수 있는 입력(단면·경간)은 verify_domain이 자동 파생.`,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "mech_preset",
    description:
      `분야별 **결정론 파라메트릭 프리셋** — AI 없이 파라미터로 형상을 만든다(항상 유효·manifold). ` +
      `domain=mech(원통용기·플레이트·절곡브래킷·각관) | rack(랙포스트·랙빔). templateId 없이 호출하면 ` +
      `그 분야 템플릿·파라미터 명세를 반환. 반환: {intent, scad, verify} (compose와 동일 형식).`,
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "mech | rack (기본 mech)" },
        templateId: { type: "string", description: "생략 시 그 분야 카탈로그" },
        params: {
          type: "object",
          description: "파라미터 — 명세는 templateId 생략 호출로 확인",
        },
      },
    },
  },
  {
    name: "fab_estimate",
    description:
      `판재 레이저 제조 명세(결정론) + 예상비용(추정) + 절단 DXF. spec(절단길이·피어싱·중량·면적)은 정확, ` +
      `estimate.total은 **예상**(편집 단가 × 명세). dxf는 평판 절단용(실사용 가능). 평판만 대상 — 각관·용기는 ` +
      `applicable:false. 반환: {spec, estimate, dxf}. 확정 견적은 RFQ.`,
    inputSchema: {
      type: "object",
      required: ["intent"],
      properties: {
        intent: { type: "object", description: "compose/preset intent" },
        thicknessMm: {
          type: "number",
          description: "두께 명시(생략 시 형상서)",
        },
        rates: {
          type: "object",
          description: `단가표 오버라이드 {materialPerKg,cutPerM,piercePerHole,bendPerOp,setup,marginPct}. 기본=${JSON.stringify(DEFAULT_RATES)}`,
        },
      },
    },
  },
  {
    name: "analyze_dfm",
    description:
      `판금·절삭 제조성(DFM) 검사 — 형상 intent에서 홀·두께·벽을 결정론적으로 읽어 최소 홀·홀-엣지 거리· ` +
      `홀 간격·최소 두께·얇은 벽 규칙을 검사한다(메시 휴리스틱 아님, 파라미터 직독). process=laser|punch로 임계 조정. ` +
      `반환: {checks[{rule,severity,title,message}], worst, thickness}. 비법정 참고(샵 관행값).`,
    inputSchema: {
      type: "object",
      required: ["intent"],
      properties: {
        intent: { type: "object", description: "compose/preset intent" },
        process: { type: "string", description: "laser | punch (기본 laser)" },
        thicknessMm: {
          type: "number",
          description: "두께 명시(생략 시 형상서 파생)",
        },
      },
    },
  },
  {
    name: "edit_part",
    description:
      `🎯 선택 부품만 수정(자율 수정 루프) — AI는 「지시→패치」 이해만, 적용·게이트(어휘·간섭·` +
      `지지·구조)는 결정론. 대상 외 부품 불변은 코드가 보장. face(명명 면 또는 normal)로 면 컨텍스트 ` +
      `전달 가능. REV 이력 자동 축적. GEMINI_API_KEY 필요. 반환: {assembly, patch, interferences, ` +
      `floating, massKg, openscad, parts, composeIntent}.`,
    inputSchema: {
      type: "object",
      required: ["assembly", "partId", "instruction"],
      properties: {
        assembly: {
          type: "object",
          description: "{name, parts:[{id,type,params,at}...]}",
        },
        partId: { type: "string" },
        instruction: {
          type: "string",
          description: '예: "높이를 600으로", "중심 유지하고 폭 160"',
        },
        face: {
          type: "object",
          description: "{face:'z+|axis+|radial'…} 또는 {normal:[x,y,z]}",
        },
      },
    },
  },
  {
    name: "face_drag",
    description:
      `면 푸시풀(AI 없음, 순수 결정론) — 명명 면(box 6면·회전체 축단±/radial, 회전 배치 포함) 또는 ` +
      `픽 노멀 + deltaMm(±) 또는 targetMm(치수 직접 지정) → 파라미터/배치 결정론 패치 + 재빌드 게이트. ` +
      `모호 조합=정직 거부.`,
    inputSchema: {
      type: "object",
      required: ["assembly", "partId"],
      properties: {
        assembly: { type: "object" },
        partId: { type: "string" },
        face: {
          type: "string",
          description: "'z+'|'x-'|'axis+'|'radial'…(faceOfPart 명명)",
        },
        normal: {
          type: "array",
          items: { type: "number" },
          description: "월드 노멀 [x,y,z](face 대신)",
        },
        deltaMm: { type: "number", description: "면 확장(+)/축소(−) mm" },
        targetMm: {
          type: "number",
          description: "해당 면 치수의 목표값(delta 대신)",
        },
      },
    },
  },
  {
    name: "part_op",
    description:
      `부품 일괄 연산(AI 없음) — delete | duplicate(+offset[3]) | translate{dx,dy,dz} | fillet{r}` +
      `(part.filletMm→STEP B-rep 에만 반영, 표시=무필렛 명시). 재빌드 게이트 + REV 축적.`,
    inputSchema: {
      type: "object",
      required: ["assembly", "op", "partIds"],
      properties: {
        assembly: { type: "object" },
        op: {
          type: "string",
          enum: ["delete", "duplicate", "translate", "fillet"],
        },
        partIds: { type: "array", items: { type: "string" } },
        opts: {
          type: "object",
          description: "{offset:[x,y,z]} | {dx,dy,dz} | {r}",
        },
      },
    },
  },
  {
    name: "lod_assembly",
    description:
      `1차 골격→2차 상세(LOD) — 계통/상세 자동 태깅(미지정만, detail2=철물·자유곡면) 후 ` +
      `level 이하 부분집합을 빌드. level=1이면 골격 프리뷰(생성 시간·비용 절약), 2=전체.`,
    inputSchema: {
      type: "object",
      required: ["assembly"],
      properties: {
        assembly: { type: "object" },
        level: { type: "integer", description: "기본 1(골격)" },
      },
    },
  },
  {
    name: "blade_ring",
    description:
      `NACA 4-digit 블레이드 링(자유곡면 생성기, x축 로프트) — 팬/프로펠러/임펠러 블리스크 mesh 부품 ` +
      `생성. 반환 {params(mesh), gen} 을 assembly 부품 {type:'mesh', params, gen} 으로 사용 — 이후 수정은 ` +
      `edit_part 가 gen.params 재생성으로 처리(정점 직접 수정 금지·추적성).`,
    inputSchema: {
      type: "object",
      required: ["nB", "rRoot", "rTip", "chord", "cx", "pitch"],
      properties: {
        nB: { type: "integer", description: "블레이드 수(2~60)" },
        rRoot: { type: "number" },
        rTip: { type: "number" },
        chord: { type: "number" },
        cx: { type: "number", description: "축방향 중심 x" },
        cy: { type: "number" },
        cz: { type: "number" },
        pitch: { type: "number" },
        naca: { type: "string", description: "기본 '4412'" },
      },
    },
  },
  {
    name: "generate_package",
    description:
      `실시 도서 세트 일괄 생성(outDir 에 파일 저장) — GA 2D(완성도 체크리스트 게이트)·GA 3D(오프라인 ` +
      `뷰어)·부품 제작도·BOQ·제작사양서·Dossier·DXF(C9 게이트)·선택 STEP(부품별 B-rep 컴파운드·` +
      `filletMm 반영), 그리고 판정 문서 — 검증.html(KDS 대조)·안전검토.html·실시검도리포트.html` +
      `(M1~M6)·쉬운요약.html. 전 산출물은 단일 REV 로 스탬프되고 문서 간 수치 정합 게이트를 탄다. ` +
      `비법정(제작용 실시도서+검토 계산서 — 인허가 도서=기술사 날인 영역). ` +
      `반환: 파일 목록 + rev + consistency(문서 간 대조) + 완성도/C9 + designOk·support(부유 부품)` +
      `·interferences — **ok:true 는 "생성됐다"이지 "설계가 타당하다"가 아니다. designOk 를 볼 것.** ` +
      `미산출(정직): FEA·xlsx 내역서·P&ID·IFC·SCAD 는 웹 패키지 API 에만 있다.`,
    inputSchema: {
      type: "object",
      required: ["assembly", "outDir"],
      properties: {
        assembly: { type: "object" },
        outDir: { type: "string", description: "저장 디렉터리(절대경로)" },
        title: { type: "string" },
        withStep: {
          type: "boolean",
          description: "STEP 포함(수십 초 소요 가능)",
        },
        verifyParams: {
          type: "object",
          description:
            "검토 파라미터 — 없으면 해당 검토를 실행하지 않고 미실시로 고지한다. seismic:{R(1~8, 필수·구조시스템이 정함), zone, siteClass, importance} · wind:{V0(m/s, 필수·대지 위치), exposure} · usage(활하중 용도) · footing 등. 층높이·층중량·건물외곽은 형상에서 자동 파생된다.",
        },
      },
    },
  },
  {
    /**
     * ★파라미터 스윕(260803) — 데이터 트리(Grasshopper) 효용을 **채팅형으로** 채운다.
     * 노드를 그리는 대신 「기둥 간격 3000~5000 을 500 단위로」를 말로 받는다.
     * 템플릿 파라미터가 전부 min/max·enum 을 갖고 있어 **타입 검증까지 우리가 한다**.
     */
    /**
     * ★코리더(260803) — 횡단면을 선형 따라 스윕. 갭 매트릭스 빈칸 ③.
     * ⚠ **템플릿 카탈로그에 넣지 않는다.** 카탈로그는 「전 종이 소비자에게 판정을 전달한다」를
     *   계약으로 갖는데(`domain-coverage` · `label-and-site-layout` 가드), 도로 기하구조 판정은
     *   KDS 도로설계기준 영역이라 지금 그 계약을 못 지킨다. 기준 계산기가 붙으면 그때 넣는다.
     *   그때까지는 **도구로 노출**한다 — 「닿지 않는 코드」로 두지 않으면서 계약도 안 어긴다.
     */
    name: "build_corridor",
    description:
      "횡단면(offset,height 폴리곤)을 선형(IP·곡선)을 따라 스윕해 3D 본체와 물량을 낸다. " +
      "반환: parts[] + corridorMeta{lengthMm, volumeM3, maxChordSagMm, stationTable}. " +
      "⚠ 곡선은 현 근사이고 최대 이격을 maxChordSagMm 로 낸다(stepMm 를 줄이면 준다). " +
      "⚠ 편경사는 선언한 구간만 반영한다 — 미선언을 표준값으로 채우지 않는다. " +
      "⚠ 도로 기하구조 판정(종단경사·시거 등)은 포함하지 않는다(KDS 도로설계기준 영역).",
    inputSchema: {
      type: "object",
      required: ["ips", "sections"],
      properties: {
        ips: {
          type: "array",
          description: "평면선형 IP 점열 [[x,y], …] (2점 이상)",
        },
        curves: {
          type: "array",
          description: "[{ip, R}] 곡선 삽입(생략=절선)",
        },
        sections: {
          type: "array",
          description: "[{id, points:[[offset,height],…], material, role}]",
        },
        stepMm: { type: "number", description: "스테이션 간격(기본 5000)" },
        startMm: { type: "number" },
        endMm: { type: "number" },
        superelevation: {
          type: "array",
          description: "[{sta, pct}] 선언 구간만 선형 천이",
        },
      },
    },
  },
  {
    name: "sweep_template",
    description:
      "템플릿 파라미터를 훑어 변형 배열을 결정론적으로 생성·평가한다(데이터 트리 대체). " +
      "sweep 은 {파라미터명:{from,to,step}} 또는 {파라미터명:[값들]}. fixed 로 나머지 고정. " +
      "반환: 조합별 designOk·부유·간섭·질량 + 가능/불가능 요약. " +
      "⚠ 범위 밖 값은 클램프하고 clamped[] 로 알린다. 조합이 상한(120)을 넘으면 **자르지 않고 거부**한다. " +
      "⚠ 「최적」을 정하지 않는다 — lightestByMass 는 한 가지 기준일 뿐이다.",
    inputSchema: {
      type: "object",
      required: ["domain", "id", "sweep"],
      properties: {
        domain: {
          type: "string",
          description: "mech|civil|building|interior|landscape|bridge",
        },
        id: { type: "string", description: "list_templates 의 템플릿 id" },
        sweep: {
          type: "object",
          description: "{파라미터명:{from,to,step}} 또는 {파라미터명:[값들]}",
        },
        fixed: {
          type: "object",
          description: "스윕하지 않는 파라미터 고정값(생략=템플릿 기본값)",
        },
        max: { type: "number", description: "조합 상한(기본·최대 120)" },
      },
    },
  },
  {
    name: "list_templates",
    description:
      "분야별 결정론 어셈블리 템플릿 목록(형상 합성기의 앞문). domain 생략 시 전 분야. " +
      "반환 각 항목: { domain, id, labelKo, labelEn, params[] }. " +
      "generate_domain_package 의 domain/templateId/params 로 그대로 사용.",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "예: building|civil|interior|landscape (생략=전 분야)",
        },
      },
    },
  },
  {
    name: "generate_domain_package",
    description:
      "분야 템플릿 → 완제 실시 도서(도시에) 원샷. buildAssemblyTemplate(형상 결정론 합성) 후 " +
      "generate_package 와 동일 산출(GA 2D·GA 3D·부품제작도·BOQ·제작사양서·Dossier·DXF·선택 STEP). " +
      "입력값 불가 시 기본값으로 대체하지 않고 정직 거부(paramErrors). 비법정(기술사 날인=별도).",
    inputSchema: {
      type: "object",
      required: ["domain", "templateId", "outDir"],
      properties: {
        domain: { type: "string" },
        templateId: { type: "string" },
        params: {
          type: "object",
          description: "템플릿 파라미터(치수 등) — 생략 시 기본값",
        },
        outDir: { type: "string", description: "저장 디렉터리(절대경로)" },
        title: { type: "string" },
        withStep: { type: "boolean" },
        verifyParams: {
          type: "object",
          description:
            "검토 파라미터 — 없으면 해당 검토를 실행하지 않고 미실시로 고지한다. seismic:{R(1~8, 필수·구조시스템이 정함), zone, siteClass, importance} · wind:{V0(m/s, 필수·대지 위치), exposure} · usage(활하중 용도) · footing 등. 층높이·층중량·건물외곽은 형상에서 자동 파생된다.",
        },
      },
    },
  },
  {
    name: "loft_part",
    description:
      "ⓒ 로프트/스윕 저작 — 단면을 이어 매끈한 곡면 mesh 생성(박스 아님). " +
      "profile.type=circle|superellipse|naca|roundedRect|polygon. 방식: (a) 로프트=stations[{at:[x,y,z]," +
      'scale,rot}]+axis, (b) 스윕=kind:"sweep"+path[[x,y,z]...]+scale(단면을 경로 따라 압출, 회전최소화 ' +
      "프레임). 다중 바디는 {bodies:[<바디스펙>...]} 또는 배열 → 어셈블리 반환. 반환: assembly + 체적/삼각형수.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        profile: { type: "object", description: "{type, ...params}" },
        stations: {
          type: "array",
          items: { type: "object" },
          description: "로프트",
        },
        path: {
          type: "array",
          items: { type: "array" },
          description: "스윕(kind:sweep) 경로 [[x,y,z]...]",
        },
        kind: { type: "string", enum: ["loft", "sweep"] },
        scale: { type: "number" },
        axis: { type: "string", enum: ["x", "y", "z"] },
        material: { type: "string" },
        role: { type: "string" },
        bodies: {
          type: "array",
          items: { type: "object" },
          description: "다중 바디",
        },
      },
    },
  },
  {
    name: "resolve_constraints",
    description:
      "ⓑ 조립 구속 — 부품을 절대좌표가 아니라 관계로 배치. 각 부품 constraints[](offset·concentric·" +
      "onFace·mirror·centerline)를 to 의존성 위상정렬로 해석해 at 확정. 순환·미지참조 등은 정직 throw. " +
      "반환: at가 확정된 어셈블리(buildAssembly/render_preview/generate_package 에 그대로 투입).",
    inputSchema: {
      type: "object",
      required: ["assembly"],
      properties: { assembly: { type: "object" } },
    },
  },
  {
    name: "render_preview",
    description:
      "헤드리스 렌더→PNG(ⓐ) — 어셈블리를 top/side/iso 그레이스케일 PNG로 (브라우저·GL 없이 " +
      '순수 노드 테셀레이션·투영·z버퍼). 저작 루프의 "눈": 만든 배치를 이미지로 되받아 검증·수정. ' +
      "outDir 지정 시 파일 저장, 미지정 시 뷰별 base64 반환(AI/자동화가 바로 판독).",
    inputSchema: {
      type: "object",
      required: ["assembly"],
      properties: {
        assembly: { type: "object" },
        outDir: {
          type: "string",
          description: "저장 디렉터리(생략 시 base64 반환)",
        },
        views: {
          type: "array",
          items: { type: "string", enum: ["iso", "side", "top", "front"] },
        },
      },
    },
  },
  {
    name: "extract_gdt",
    description:
      `STEP AP242 시맨틱 PMI(GD&T) 판독(결정론 — AI 없음): 데이텀(A/B/C…)·기하공차(⊥⌖⏥… 크기+` +
      `데이텀 참조+MMC/LMC)·치수(공칭±리밋). NIST MBE 검증모델 17파일 전수 무크래시 실측. ` +
      `그래픽 주석·서피스 텍스처=v1 범위 외(unparsed 정직 보고). 값=모델 내장 공차의 판독.`,
    inputSchema: {
      type: "object",
      properties: {
        stepPath: {
          type: "string",
          description: ".stp/.step 절대경로 (stepText 와 택1)",
        },
        stepText: { type: "string", description: "STEP 본문 텍스트" },
      },
    },
  },
  {
    name: "step_roundtrip",
    description:
      `A1 라운드트립 정합 게이트 — 「만든 STEP 이 예측과 맞다」 기계 확인: STEP 직렬화→재임포트→` +
      `부피·AABB 재측정 ↔ 폐형 예측(Σ부품 체적·∪AABB) 대조(밴드 명시·드롭 부품=동일 모집단 제외). ` +
      `실측: 제트 85부품 오차 0.07%. 반환 {verdict, volume, aabb, dropped}.`,
    inputSchema: {
      type: "object",
      required: ["assembly"],
      properties: { assembly: { type: "object" } },
    },
  },
  {
    name: "refine_interferences",
    description:
      `B1 의심쌍 메시 부울 2차 간섭 — AABB/폐형 규칙이 보수로 남긴 간섭쌍만 openscad ` +
      `intersection() 실기하 재판정(회전·사면·revolve·자유곡면 전부 정확). 교집합≤ε=실분리 해제, ` +
      `>ε=확정+실측 부피. build_assembly 의 interferences 를 그대로 넣는다.`,
    inputSchema: {
      type: "object",
      required: ["assembly", "interferences"],
      properties: {
        assembly: { type: "object" },
        interferences: { type: "array" },
        epsMm3: { type: "number" },
      },
    },
  },
  {
    name: "execution_gate",
    description:
      `T2 실시 검도 게이트 M1~M6(260719b) — 「이 도면만으로 제작 착수 가능한가」 결정론 판정: ` +
      `M1 치수충분성(파라미터 자유도↔기입 치수)·M2 구멍표·M3 용접 지시선·M4 나사 표기·` +
      `M5 재질+일반공차·M6 실윤곽. GA/부품도를 내부 생성해 대조. 반환 {score, ok, items, failed, na}.`,
    inputSchema: {
      type: "object",
      required: ["assembly"],
      properties: { assembly: { type: "object" } },
    },
  },
  {
    name: "std_audit",
    description:
      `시판 규격 감사(G1+R2-⑪) — 배관 d·각형강관·T슬롯(알루미늄)·필로우 블록(UCP) 부재를 표준 ` +
      `카탈로그와 대조: 스냅 권고(편차%)·규격 외 정직 경고. 보고 전용(형상 무변경). ` +
      `반환 {items:[{id,kind,input,snap}], warnings}.`,
    inputSchema: {
      type: "object",
      required: ["assembly"],
      properties: { assembly: { type: "object" } },
    },
  },
  {
    name: "dxf_reconcile",
    description:
      `T3 DXF DIMENSION 결정론 판독(260719b) — ASCII DXF 치수 엔티티(실측값 42) 분류(선형H/V·` +
      `지름·반지름) 후 intent 수치 파라미터를 ±tolPct 최근접 실측값으로 교체(추론→판독 격상). ` +
      `교체 이력·unverified(추론 잔존)·coverage 전부 보고. 반환 {seed, reconciled}.`,
    inputSchema: {
      type: "object",
      required: ["dxfText", "intent"],
      properties: {
        dxfText: { type: "string" },
        intent: { type: "object" },
        tolPct: { type: "number" },
      },
    },
  },
  {
    name: "import_landxml",
    description:
      `LandXML 1.x 도로 선형 임포트(결정론): Line/Curve(arc) 체인→엔진 선형 입력({ips, curves}) ` +
      `— IP=탄젠트 교점, 단위 자동 mm 환산(m/ft), 요소장 합↔선언 길이 검산. 종단 PVI 판독. ` +
      `clothoid·복합곡선=unsupported 정직 보고. 반환 ips/curves 를 civil 템플릿에 그대로 투입 가능.`,
    inputSchema: {
      type: "object",
      properties: {
        xmlPath: {
          type: "string",
          description: ".xml 절대경로(xmlText 와 택1)",
        },
        xmlText: { type: "string" },
      },
    },
  },
  {
    name: "verify_domain",
    description:
      `설계 형상 + 분야 → 진짜 공학 계산기(engineering-core) 검증. 형상에서 단면특성(A·Ix·Sx·r)·경간 L을 ` +
      `**결정론 파생**하고, 하중·재료(Fy·Pu·w·P·Mu 등)만 params로 받아 합쳐 계산한다. 반환: {verdict, checks, ` +
      `derived(형상파생), provenance(geometry/user 분리), refs, citations(인용 조항), status, disclaimer}. 하중 누락 ` +
      `시 값을 지어내지 않고 {needInputs}로 필요한 입력을 알려준다. 5개 분야(가설·랙 / 건축RC / 토목 / 인테리어 / ` +
      `조경) 계산기는 전부 draft(비법정 참고). 분야 전체 목록·입력 명세는 list_domains.`,
    inputSchema: {
      type: "object",
      required: ["intent", "domain", "calculatorId"],
      properties: {
        intent: {
          type: "object",
          description: "compose_3d 범용조합 intent(features[])",
        },
        domain: {
          type: "string",
          description:
            "list_domains의 slug: temporary-rack | building-member | civil | interior | landscape",
        },
        calculatorId: {
          type: "string",
          description:
            "분야 내 계산기 id — temporary-rack:column_buckling|simple_beam · building-member:rc_beam|rc_column_pm|isolated_footing · civil:retaining_wall_stability|box_culvert_frame · interior:occupancy_egress · landscape:timber_beam|timber_nail|landscape_drainage",
        },
        memberRef: {
          description:
            "부재 피처 선택(id 또는 index). 생략 시 첫 프리즘형 부재.",
        },
        params: {
          type: "object",
          description: "사용자 입력 하중·재료 {Fy, Pu, w, P, Mu, As, fck, fy…}",
        },
        standardId: { type: "string", description: "기준(기본 KDS)" },
      },
    },
  },
  {
    name: "analyze_fea",
    description:
      `★ 간이 FEA(구조 — 선형정적만) — 형상을 실제 메시로 이산화해 선형정적 응력/안전율을 낸다. ` +
      `AI 없음(결정론+수치해석). 입력=scad(또는 compose_3d intent) + 재료(materialKey) + 상면 등가 하중(loadKg, ` +
      `날조 금지·명시 필수). precise=true 면 gmsh 경계정합 메시(인증후보급, ~수십초). 반환: {method, ` +
      `safetyFactor, maxStressMPa, maxDispMm, material, yieldMPa, mesh, raiser, reportHtml}. ` +
      `⚠ 열/모달/열탄성 해석은 이 도구로 불가(입력에 온도·주파수 파라미터 없음) — 검증된 열/모달 솔버` +
      `(thermalStress.ts/modalSolver.ts)는 브라우저 전용 스튜디오 패널(ModalAnalysisPanel)에서만 접근 가능. ` +
      `⚠원격 전용 — 호스팅 서버의 OpenSCAD/gmsh 바이너리가 필요(NEXYFAB_API_KEY 미설정 시 정직 거부). ` +
      `선형등방·자동 경계조건(스크리닝)·비법정 — 상세 해석은 유자격 기술자.`,
    inputSchema: {
      type: "object",
      required: ["loadKg"],
      properties: {
        scad: { type: "string", description: "OpenSCAD 텍스트(intent 와 택1)" },
        intent: {
          type: "object",
          description:
            "compose_3d 범용조합 intent(scad 미지정 시 로컬 emitComposite 로 변환)",
        },
        materialKey: {
          type: "string",
          description: "재료 키(steel|al|... 기본 steel)",
        },
        loadKg: {
          type: "number",
          description: "상면 등가 하중(kg, 0 초과 — 날조 금지·명시 필수)",
        },
        precise: {
          type: "boolean",
          description: "gmsh 경계정합 정밀 메시(느림)",
        },
      },
    },
  },
  {
    name: "reconstruct_verify",
    description:
      `★ 검증된 역설계 — 실물 형상을 NexyFab 재구성하고 게이트로 「재구성이 원본과 맞다」를 기계 대조. ` +
      `STL(.stl)→reverse-engineer(휴리스틱 분류→렌더 라운드트립), STEP/IGES/IFC/DWG/SAT/X_T→import-step ` +
      `(B-rep 판독→bbox/genus/watertight 대조). 반환: {reconstructionGate:{status:pass|fail|unavailable, ` +
      `mode, checks(bbox/genus/watertight), feedback}, suggestion(export_step)}. 곡면/복합은 정직 실패, ` +
      `측정 불가는 unavailable(가짜 통과 금지). ⚠원격 전용(서버 OCCT/메시 처리·Pro) — 키 미설정 시 거부.`,
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description:
            "입력 파일 절대경로(.stl/.step/.iges/.ifc/.dwg/.sat/.x_t) — 확장자로 포맷 추론",
        },
        format: {
          type: "string",
          description: "포맷 강제(stl|step|iges|ifc|dwg|sat|x_t)",
        },
        stlBase64: {
          type: "string",
          description: "STL/바이너리(dwg·sat) base64(file 대신)",
        },
        step: {
          type: "string",
          description: "STEP/IGES/IFC/X_T 텍스트(file 대신)",
        },
        name: { type: "string" },
      },
    },
  },
  {
    name: "reconstruct_fleet",
    description:
      `★ AI 재구성 함대(lever F) — 휴리스틱이 못 여는 부품을 여러 모델 계열이 파라메트릭 SCAD 를 제안하고 ` +
      `결정론 재구성 게이트가 원본과 대조·통과분만 채택(피드백·계열 전환으로 재시도). 반환: {aiFleet:{passed, ` +
      `verified, attemptsUsed, seriesSwitched, familiesUsed, feedback}}. ⚠원격 전용 + Pro + 비용 예산 소모 ` +
      `(시도마다 LLM+렌더). 정직: 복잡 부품 비통과는 정상이며 날조된 통과는 없음. 키 미설정 시 거부.`,
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "STL 파일 절대경로(.stl)" },
        stlBase64: { type: "string", description: "STL base64(file 대신)" },
        attempts: {
          type: "integer",
          description: "시도 상한 힌트(서버가 자체 상한으로 제한, 현재 3)",
        },
      },
    },
  },
  {
    name: "code_check",
    description:
      `★ 코드체크 / 감리 보조(결정론·LOCAL) — 측정된 설계 피처를 실제 공개 법령/공표기준 조항과 대조해 룰별 ` +
      `PASS/FAIL/NA + 인용 조항 + 실측 vs 요구값을 낸다. 룰셋 41종(웹과 동일 계약) 12개 카테고리: 주차(parking)· ` +
      `피난·방화(egress-fire)·계단·경사로·복도·난간·출입구·승강기·접근로·위생·건축(구조/일조/건폐율·용적률)· ` +
      `실내건축(accessibility/interior). 숫자 날조 없음(피처 미제공=NA, 준수 가정 안 함). ✔로컬 실행(순수 룰셋 — ` +
      `NEXYFAB_API_KEY 불필요, 오프라인 가능). {list:true} 로 41룰 카탈로그. 비법정 감리 보조(면허 감리자·기술사의 ` +
      `법정 감리를 대체하지 않음, disclaimer 항상 동봉).`,
    inputSchema: {
      type: "object",
      properties: {
        features: {
          type: "object",
          description:
            '측정 피처(단위 m·경사=rise/run). 예: {rampSlope:0.09, doorEffectiveWidth_m:0.9, parkingStallWidth_m:2.5, emergencyExitWidth_m:1.5, travelDistanceToStair_m:28, corridorCategory:"school", corridorBothSidesRooms:true, corridorWidth_m:2.1} — 키 목록은 {list:true}',
        },
        list: {
          type: "boolean",
          description:
            "41룰 카탈로그만 반환(id·category·clause·source·requirement)",
        },
      },
    },
  },
  {
    name: "interior_check",
    description:
      `인테리어 피난·마감 체인(결정론·LOCAL) — 어셈블리에서 보행거리 BFS(최원점→출입구, 장애물 우회)· ` +
      `수용인원/피난폭(occupancy_egress, 문폭 형상 파생)·마감 물량(개구 공제)을 한 번에 검토한다. verify_domain(단일 ` +
      `계산기)과 달리 피난 전 과정 체인. 반환 {travel, occupancy, finishes, checks…}. 미입력 값은 지어내지 않음. ` +
      `비법정(건축사 최종 책임). 순수 mjs — 키 불필요·오프라인.`,
    inputSchema: {
      type: "object",
      required: ["assembly"],
      properties: {
        assembly: {
          type: "object",
          description:
            "{name, parts:[{id,type,params,role,at}...]} (문·벽·가구 role 포함)",
        },
        params: {
          type: "object",
          description:
            "용도·점유밀도·출구 등 입력(occupantDensityM2·exitCount 등)",
        },
      },
    },
  },
  {
    name: "landscape_check",
    description:
      `조경 구조 체인(결정론·LOCAL) — 목재 부재 검토(timber_beam, 단면·스팬·간격 형상 파생, KDS 41 50 10) + ` +
      `풍하중 전도(입력 풍압 → FS·앵커 인발). 풍압 미입력 시 전도는 정직 생략(지어내지 않음). ` +
      `반환 {timber, overturning, checks…}. 비법정 검토 초안. 순수 mjs — 키 불필요·오프라인.`,
    inputSchema: {
      type: "object",
      required: ["assembly"],
      properties: {
        assembly: {
          type: "object",
          description: "{name, parts:[...]} (장선·보 등 목재 부재)",
        },
        params: { type: "object", description: "수종·등급·하중·풍압 등 입력" },
      },
    },
  },
  {
    name: "bridge_check",
    description:
      `교량 간이/실시급 검토 체인(결정론·LOCAL) — 어셈블리 meta 로 자동 디스패치: bridgeMeta=거더교(고정하중 ` +
      `형상×밀도 + KL-510 활하중 영향선 + 극한 I 조합 KDS 24 12 11, 선택 rc_beam 단면검토) / archMeta·trussMeta· ` +
      `cableStayedMeta·suspensionMeta·stairMeta=아치·트러스·사장·현수·산업계단 간이 폐형 체인. meta 없으면 거더 폴백. ` +
      `반환 {loads, checks, verdict…}. 비법정(기술사 날인 별도). 순수 mjs — 키 불필요·오프라인.`,
    inputSchema: {
      type: "object",
      required: ["assembly"],
      properties: {
        assembly: {
          type: "object",
          description:
            "{name, parts, bridgeMeta|archMeta|trussMeta|cableStayedMeta|suspensionMeta|stairMeta}",
        },
        params: {
          type: "object",
          description: "경간·거더수·분배계수·재료 등 입력",
        },
      },
    },
  },
  {
    name: "load_path",
    description:
      `건축 하중경로 자동 체인(결정론·LOCAL) — 슬래브 자중(형상)+활하중(KDS 41 12 00 용도표) → 하중조합 → ` +
      `보(rc_beam) → 기둥(rc_column_pm) → 기초(isolated_footing). {list:true} 로 활하중 용도표만 반환. 하중은 ` +
      `지어내지 않음(자중=형상, 활하중=표 선택, 철근·기초·지반=입력). 반환 {loads, beams, columns, footings, ` +
      `checks…}. ⚠슬래브 SLS 처짐(Mindlin)은 웹 전용 부가검토 — 로컬 체인 미포함(웹 라우트에서만). 비법정. ` +
      `순수 mjs — 키 불필요·오프라인.`,
    inputSchema: {
      type: "object",
      properties: {
        assembly: {
          type: "object",
          description: "{name, parts:[{role:slab|beam|column...}]}",
        },
        params: {
          type: "object",
          description: "용도(usage)·fck·철근·기초·지반 등 입력",
        },
        list: {
          type: "boolean",
          description: "활하중 용도표(KDS 41 12 00 표 3.2-1)만 반환",
        },
      },
    },
  },
  /**
   * 260803 — PBAS 0.7.3 이식분 ②③④를 **어셈블리를 안 만들고도** 물어볼 수 있게 연다.
   * `build_assembly` 결과에도 같은 키(`connections`·`buckling`·`mobility.jacobian`)로 실리지만,
   * 「이 볼트군 되나」 한 건만 묻고 싶을 때 전체 조립을 세우게 하면 진입 장벽이 된다.
   */
  {
    name: "check_connection",
    description:
      `체결부 강도 검토(핀·볼트군·용접군·베어링) — 결정론·LOCAL. 단위 mm·MPa·N·N·m. ` +
      `핀=전단/지압/휨/연단찢김 · 볼트군=전단+모멘트분담·인장(프라잉)·조합·미끄럼·판지압/찢김·나사산 · ` +
      `용접=목두께 직응력+모멘트 · 베어링=ISO 281 L10. ⚠**미검토를 통과로 세지 않는다** — 하중이나 ` +
      `제원이 없으면 status=pending(pass=null)이고 무엇이 필요한지 적는다. 부분검토는 conditional. ` +
      `⚠수명비는 응력 안전율과 별도 목표(targetLifeRatio, 기본 1). 비법정 참고. 순수 mjs — 키 불필요.`,
    inputSchema: {
      type: "object",
      properties: {
        connection: {
          type: "object",
          description: "{type, forceN, momentNm, ...제원, ...allowable*MPa}",
        },
        connections: {
          type: "array",
          description: "여러 건 한 번에(요약 counts 포함)",
        },
        targetSafetyFactor: {
          type: "number",
          description: "목표 안전율(기본 2)",
        },
      },
    },
  },
  {
    name: "buckling_precheck",
    description:
      `압축 좌굴 **사전 선별**(Johnson/Euler 전이 + 국부 판좌굴) — 결정론·LOCAL. 형상에서 단면·길이를, ` +
      `joints/connections 선언에서 단부 조건(K)을 유도해 **입력 0개로 전수 훑기**. ` +
      `⚠**법정 검토가 아니다** — 걸린 부재는 engineering-core 의 column_buckling(AISC 360 §E3)으로 확정할 것. ` +
      `⚠항복점 없는 재료(콘크리트·회주철·유리·FRP)는 fy 를 지어내지 않고 pending 을 낸다. ` +
      `⚠약축(주축 최소 2차모멘트)으로 잰다. 부재는 axialN(음수=압축) 또는 compressionN 선언분만. 순수 mjs.`,
    inputSchema: {
      type: "object",
      properties: {
        assembly: {
          type: "object",
          description:
            "{parts:[{id,type,params,material,axialN|compressionN}], joints?, connections?}",
        },
        part: {
          type: "object",
          description:
            "한 부재만 — {lengthMm, section|type+params, material, compressionN, K?, plate?}",
        },
        targetSafetyFactor: {
          type: "number",
          description: "목표 안전율(기본 2)",
        },
      },
    },
  },
  {
    name: "solve_mobility",
    description:
      `구속 야코비안으로 기구 자유도를 **푼다**(Kutzbach 는 세기만 한다) — 결정론·LOCAL. ` +
      `M = 6(n−1) − rank(J) · 여분 구속 = 행수 − rank ← 평행사변형 링크가 여기서 잡힌다(Kutzbach 는 음수로만 말함). ` +
      `조건수로 특이 자세를 본다. ⚠**선형화된 순간 운동학**이라 지금 자세 기준이고 유한 변위 궤적이 아니다. ` +
      `⚠랭크가 공차에 민감하면(borderline) 자유도가 ±1 흔들릴 수 있다고 신고한다. joints 선언이 없으면 null. 순수 mjs.`,
    inputSchema: {
      type: "object",
      properties: {
        assembly: {
          type: "object",
          description:
            "{parts:[{id,role}], joints:[{type,axis,between:[a,b],atMm?}]}",
        },
        ground: {
          type: "array",
          items: { type: "string" },
          description: "접지 부품 id(생략시 role=frame/base/ground/slab/floor)",
        },
      },
    },
  },
];

/**
 * 응답 규약(260728): **모든 툴 응답에 `ok` 가 있어야 한다.**
 *
 * MCP 호출자는 대개 AI 에이전트이고, 에이전트가 읽는 것은 이 JSON 뿐이다. 종전에는 8개 툴이
 * `ok` 없는 알몸 객체를 돌려줘(`{items:[],warnings:[]}` 등) **성공과 실패가 구별되지 않았다.**
 *
 * ⚠ 여기서 `ok` 는 **호출이 성립했는가**이지 "설계가 괜찮은가"가 아니다. 판정은 본문
 * (`pass`·`recognized`·`applicable`·`score`·`warnings`)에 있다. 스탬프를 찍은 응답에는
 * 그 구별을 `okMeaning` 으로 함께 실어, 에이전트가 ok=true 를 합격으로 오독하지 않게 한다.
 * 툴이 스스로 `ok` 를 선언했으면 그 값을 존중한다(덮어쓰지 않는다).
 */
function stampOk(result) {
  if (result === null || typeof result !== "object" || Array.isArray(result))
    return result;
  if ("ok" in result) return result;
  if (result.error) return { ok: false, ...result };
  return {
    ok: true,
    okMeaning: "호출 성공 — 합격 여부가 아니다. 판정은 본문 필드를 볼 것",
    ...result,
  };
}

/**
 * 선언한 inputSchema 를 **실제로 강제한다**(260728).
 *
 * 종전에는 스키마가 장식이었다. `assembly.parts` 에 문자열을 넣으면 툴 안쪽까지 들어가
 * `allParts.filter is not a function` 같은 내부 TypeError 로 터졌고, 호출자(에이전트)는
 * **자기가 무엇을 잘못했는지 알 수 없었다.** 42개 툴 중 7개가 그랬다.
 *
 * ⚠ 여기서 막는 것은 **형식**뿐이다. 값이 설계로서 타당한지는 각 툴의 게이트가 판정한다 —
 * 형식 통과를 내용 통과로 번역하지 않는다.
 * @returns {string[]} 위반 목록(비어 있으면 통과)
 */
function schemaViolations(name, args) {
  const schema = tools.find((t) => t.name === name)?.inputSchema;
  if (!schema) return [];
  const props = schema.properties ?? {};
  const bad = [];
  const typeOk = (v, t) =>
    t === "object"
      ? v !== null && typeof v === "object" && !Array.isArray(v)
      : t === "array"
        ? Array.isArray(v)
        : t === "string"
          ? typeof v === "string"
          : t === "integer"
            ? Number.isInteger(v)
            : t === "number"
              ? typeof v === "number" && Number.isFinite(v)
              : t === "boolean"
                ? typeof v === "boolean"
                : true;
  for (const key of schema.required ?? []) {
    if (args[key] === undefined || args[key] === null) {
      bad.push(`'${key}' 필수 — 없거나 null`);
      continue;
    }
    const t = props[key]?.type;
    if (t && !typeOk(args[key], t))
      bad.push(
        `'${key}' 는 ${t} 여야 한다(받은 것: ${Array.isArray(args[key]) ? "array" : typeof args[key]})`,
      );
  }
  for (const [key, spec] of Object.entries(props)) {
    if (args[key] === undefined || args[key] === null) continue;
    if ((schema.required ?? []).includes(key)) continue; // 위에서 이미 봤다
    if (spec.type && !typeOk(args[key], spec.type))
      bad.push(
        `'${key}' 는 ${spec.type} 여야 한다(받은 것: ${Array.isArray(args[key]) ? "array" : typeof args[key]})`,
      );
  }
  // 스키마에 못 적는 어셈블리 불변식 — parts/pipes 는 배열이다.
  const asm = args.assembly;
  if (asm && typeof asm === "object") {
    for (const k of ["parts", "pipes"]) {
      if (asm[k] != null && !Array.isArray(asm[k]))
        bad.push(`assembly.${k} 는 배열이어야 한다(받은 것: ${typeof asm[k]})`);
    }
  }
  return bad;
}

export async function callTool(name, args = {}) {
  const bad = schemaViolations(name, args ?? {});
  if (bad.length) {
    return {
      ok: false,
      error: `입력 형식 불가: ${bad.join("; ")}`,
      tool: name,
      inputSchema: tools.find((t) => t.name === name)?.inputSchema,
    };
  }
  return stampOk(await callToolInner(name, args));
}

async function callToolInner(name, args = {}) {
  if (name === "cad_capabilities") {
    const key = process.env.NEXYFAB_API_KEY;
    let res;
    try {
      res = await fetch(_apiUrl() + "/api/cad/v1/capabilities", {
        headers: key ? { authorization: `Bearer ${key}` } : {},
      });
      return await res.json();
    } catch (e) {
      return {
        ok: false,
        error: `capabilities call failed: ${String(e?.message ?? e)}`,
      };
    }
  }
  if (name === "product_decomposition") {
    return remoteCall(
      "/api/cad/v1/product-decomposition",
      { text: args.text },
      name,
    );
  }
  if (name === "reconcile_topology_references") {
    return remoteCall(
      "/api/cad/v1/topology/reconcile",
      {
        previous: args.previous,
        current: args.current,
        ...(Array.isArray(args.mates) ? { mates: args.mates } : {}),
        ...(Array.isArray(args.dimensions)
          ? { dimensions: args.dimensions }
          : {}),
        ...(Array.isArray(args.gdt) ? { gdt: args.gdt } : {}),
        ...(Array.isArray(args.pmi) ? { pmi: args.pmi } : {}),
      },
      name,
    );
  }
  if (name === "cad_feature_program") {
    return remoteCall(
      "/api/cad/v1/feature-program",
      {
        prompt: args.prompt,
        ...(args.previousProgram
          ? { previousProgram: args.previousProgram }
          : {}),
        ...(args.selectionContext
          ? { selectionContext: args.selectionContext }
          : {}),
        ...(args.modelId ? { modelId: args.modelId } : {}),
      },
      name,
    );
  }
  if (name === "feature_tree_mesh") {
    return remoteCall(
      "/api/cad/v1/feature-tree-mesh",
      { tree: args.tree },
      name,
    );
  }
  if (name === "export_part_step") {
    return remoteCall("/api/cad/v1/part-step", args.program, name);
  }
  if (name === "verify_cad_assembly") {
    return remoteCall("/api/cad/v1/assembly/verify", args, name);
  }
  if (name === "verify_cad_project") {
    return remoteCall("/api/cad/v1/project/verify", args, name);
  }
  if (name === "verify_door_swing_clearance") {
    return remoteCall("/api/cad/v1/interior/door-swing/verify", args, name);
  }
  if (name === "verify_space_boundary_closure") {
    return remoteCall("/api/cad/v1/interior/space-boundary/verify", args, name);
  }
  if (name === "verify_egress_routes") {
    return remoteCall("/api/cad/v1/interior/egress/verify", args, name);
  }
  if (name === "verify_mep_interference")
    return remoteCall(
      "/api/cad/v1/interior/mep-interference/verify",
      args,
      name,
    );
  if (name === "verify_manufacturing_evidence") {
    return remoteCall("/api/cad/v1/manufacturing/verify", args, name);
  }
  if (name === "evaluate_assembly_animation")
    return remoteCall("/api/cad/v1/assembly/animation/evaluate", args, name);
  if (name === "apply_assembly_animation_command")
    return remoteCall("/api/cad/v1/assembly/animation/command", args, name);
  if (name === "preview_assembly_selection_edit")
    return remoteCall("/api/cad/v1/assembly/selection-edit", args, name);
  if (name === "push_pull_step_face")
    return remoteCall("/api/cad/v1/brep/push-pull", args, name);
  if (name === "analyze_cad_reference") {
    const allowed = new Set([
      "step",
      "encoding",
      "format",
      "scenarioId",
      "lengthUnit",
      "declaredSourceTolerance",
    ]);
    if (Object.keys(args).some((key) => !allowed.has(key))) {
      return {
        ok: false,
        error:
          "CAD reference analysis accepts inline source only; file paths and undeclared fields are forbidden.",
      };
    }
    if (
      typeof args.step !== "string" ||
      args.step.length === 0 ||
      args.step.length > 20_000_000
    ) {
      return {
        ok: false,
        error: "CAD reference source must contain 1 to 20,000,000 characters.",
      };
    }
    if (
      typeof args.scenarioId !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(args.scenarioId) ||
      args.scenarioId.length > 128
    ) {
      return {
        ok: false,
        error:
          "scenarioId must be 1-128 characters using letters, digits, dot, underscore, or hyphen.",
      };
    }
    if (
      !["base64", "utf8"].includes(args.encoding) ||
      !["step", "stp"].includes(args.format)
    ) {
      return {
        ok: false,
        error:
          "Explicit encoding (base64|utf8) and STEP format (step|stp) are required.",
      };
    }
    const unit = args.lengthUnit;
    const unitOk =
      unit &&
      typeof unit === "object" &&
      !Array.isArray(unit) &&
      ((unit.kind === "mm" &&
        Object.keys(unit).every((key) => key === "kind")) ||
        (unit.kind === "scale-to-mm" &&
          Number.isFinite(unit.scaleToMm) &&
          unit.scaleToMm > 0 &&
          Object.keys(unit).every((key) =>
            ["kind", "scaleToMm", "label"].includes(key),
          )));
    if (!unitOk)
      return {
        ok: false,
        error:
          "An explicit millimetre unit or positive scale-to-mm conversion is required.",
      };
    const result = await remoteCall(
      "/api/cad/v1/reference/analyze",
      args,
      name,
    );
    if (!result || result.ok === false) {
      return {
        ok: false,
        error:
          "CAD reference analysis failed; server details were withheld to prevent source or path disclosure.",
      };
    }
    return {
      ok: true,
      evidence: result.evidence,
      tolerancePolicy: result.tolerancePolicy ?? null,
      sourceReturned: false,
      quoteOrRfqSideEffects: false,
    };
  }
  if (name === "verify_ifc_semantic_roundtrip") {
    if (
      Object.keys(args).some(
        (key) => !["beforeIfc", "afterIfc"].includes(key),
      ) ||
      typeof args.beforeIfc !== "string" ||
      typeof args.afterIfc !== "string" ||
      !args.beforeIfc.length ||
      !args.afterIfc.length ||
      args.beforeIfc.length > 20_000_000 ||
      args.afterIfc.length > 20_000_000
    ) {
      return {
        ok: false,
        error:
          "Two inline IFC documents of 1 to 20,000,000 characters are required; paths and undeclared fields are forbidden.",
      };
    }
    const result = await remoteCall(
      "/api/cad/v1/ifc/semantic-roundtrip",
      args,
      name,
    );
    if (!result || result.ok === false)
      return {
        ok: false,
        error:
          "IFC semantic roundtrip verification failed; server details were withheld to prevent source or path disclosure.",
      };
    return {
      ok: true,
      releaseReady: result.releaseReady,
      evidence: result.evidence,
      sourceReturned: false,
      quoteOrRfqSideEffects: false,
    };
  }
  if (name === "build_ifc_domain_ir") {
    if (
      Object.keys(args).some(
        (key) => !["ifc", "domain", "vienneseBendInputs"].includes(key),
      ) ||
      typeof args.ifc !== "string" ||
      !args.ifc.length ||
      args.ifc.length > 20_000_000 ||
      !["alignment", "structural-analysis"].includes(args.domain)
    )
      return {
        ok: false,
        error:
          "One inline IFC document and explicit supported domain are required.",
      };
    const result = await remoteCall("/api/cad/v1/ifc/domain-ir", args, name);
    if (!result || result.ok === false)
      return {
        ok: false,
        error: "IFC domain IR failed; source details were withheld.",
      };
    return {
      ok: true,
      releaseReady: result.releaseReady,
      ir: result.ir,
      sourceReturned: false,
      quoteOrRfqSideEffects: false,
    };
  }
  if (name === "analyze_step_mechanical_relations") {
    if (
      Object.keys(args).some(
        (key) =>
          !["step", "angularToleranceRad", "linearTolerance"].includes(key),
      ) ||
      typeof args.step !== "string" ||
      !args.step.length ||
      args.step.length > 20_000_000
    )
      return {
        ok: false,
        error: "One bounded inline STEP document is required.",
      };
    const result = await remoteCall(
      "/api/cad/v1/step/mechanical-relations",
      args,
      name,
    );
    if (!result || result.ok === false)
      return {
        ok: false,
        error:
          "STEP mechanical relation analysis failed; source details were withheld.",
      };
    return {
      ok: true,
      releaseReady: result.releaseReady,
      evidence: result.evidence,
      sourceReturned: false,
      quoteOrRfqSideEffects: false,
    };
  }
  if (name === "build_ifc_spatial_ir") {
    if (
      Object.keys(args).some((key) => key !== "ifc") ||
      typeof args.ifc !== "string" ||
      !args.ifc.length ||
      args.ifc.length > 20_000_000
    )
      return { ok: false, error: "One inline IFC document is required." };
    const result = await remoteCall("/api/cad/v1/ifc/spatial-ir", args, name);
    if (!result || result.ok === false)
      return {
        ok: false,
        error: "IFC spatial IR failed; source details were withheld.",
      };
    return {
      ok: true,
      releaseReady: result.releaseReady,
      ir: result.ir,
      sourceReturned: false,
      quoteOrRfqSideEffects: false,
    };
  }
  if (name === "plan_ifc_geometry_recovery") {
    if (
      Object.keys(args).some((key) => key !== "ifc") ||
      typeof args.ifc !== "string" ||
      !args.ifc.length ||
      args.ifc.length > 20_000_000
    )
      return { ok: false, error: "One inline IFC document is required." };
    const result = await remoteCall(
      "/api/cad/v1/ifc/recovery-plan",
      args,
      name,
    );
    if (!result || result.ok === false)
      return {
        ok: false,
        error: "IFC recovery planning failed; source details were withheld.",
      };
    return {
      ok: true,
      releaseReady: result.releaseReady,
      elements: result.elements,
      imported: result.imported,
      requests: result.requests,
      errors: result.errors,
      sourceReturned: false,
      quoteOrRfqSideEffects: false,
    };
  }
  if (name === "recover_ifc_geometry") {
    if (
      Object.keys(args).some(
        (key) => !["ifc", "authoritativeInputs"].includes(key),
      ) ||
      typeof args.ifc !== "string" ||
      !args.ifc.length ||
      args.ifc.length > 20_000_000 ||
      !Array.isArray(args.authoritativeInputs) ||
      args.authoritativeInputs.length > 1000
    )
      return {
        ok: false,
        error:
          "One inline IFC document and an authoritativeInputs array are required.",
      };
    const result = await remoteCall(
      "/api/cad/v1/ifc/recover-geometry",
      args,
      name,
    );
    if (!result)
      return {
        ok: false,
        error: "IFC geometry recovery failed; source details were withheld.",
      };
    return {
      ok: result.ok,
      releaseReady: result.releaseReady,
      assembly: result.assembly,
      stats: result.stats,
      applied: result.applied,
      rejected: result.rejected,
      remainingRequests: result.remainingRequests,
      errors: result.errors,
      sourceReturned: false,
      quoteOrRfqSideEffects: false,
    };
  }
  if (name === "verify_assembly_animation")
    return remoteCall("/api/cad/v1/assembly/animation/verify", args, name);
  if (name === "verify_ai_generation") {
    return remoteCall("/api/cad/v1/generation/verify", args, name);
  }
  if (name === "transition_ai_generation_state")
    return remoteCall("/api/cad/v1/generation/state", args, name);
  if (name === "advance_ai_generation")
    return remoteCall("/api/cad/v1/generation/advance", args, name);
  if (name === "finalize_ai_generation")
    return remoteCall("/api/cad/v1/generation/finalize", args, name);
  if (name === "generate_robot_6axis") {
    return remoteCall("/api/cad/v1/robot/generate", args, name);
  }
  if (name === "verify_sheet_metal")
    return remoteCall("/api/cad/v1/sheet-metal/verify", args, name);
  if (name === "verify_weldment")
    return remoteCall("/api/cad/v1/weldment/verify", args, name);
  if (name === "analyze_tolerance_stack")
    return remoteCall("/api/cad/v1/tolerance/analyze", args, name);
  if (name === "verify_cad_pmi")
    return remoteCall("/api/cad/v1/pmi/verify", args, name);
  if (name === "design_brief") {
    // 동일 계약: API 라우트와 같은 shared runner(결정론 플래너)를 tsx 서브프로세스로 실행.
    return runDesignBriefTool({
      text: args.text,
      id: args.id,
      fixture: args.fixture,
      params: args.params,
    });
  }
  if (name === "compose_3d") {
    const r = await composeWithGate(args.description, {
      maxRounds: args.maxRounds ?? 2,
    });
    if (r.gatePassed && !r.scad) r.scad = emitComposite(r.intent);
    return r;
  }
  if (name === "text_to_intent") {
    const { intent, model, repaired } = await textToIntent(args.description, {
      model: args.model,
    });
    return { ...intent, repaired: !!repaired, _model: model };
  }
  if (name === "text_to_assembly") {
    const { assembly, model } = await textToAssembly(args.description, {
      model: args.model,
    });
    const built = buildAssembly(assembly, { autoPlace: true });
    return { assembly, ...built, _model: model };
  }
  if (name === "build_assembly") {
    return buildAssembly(args.assembly);
  }
  if (name === "verify_3d") {
    return verify3d(args.intent, { tolMm: args.tolMm ?? 0.5 });
  }
  if (name === "export_step") {
    const { writeFileSync } = await import("node:fs");
    const { step, entities } = await intentToStep(args.intent);
    writeFileSync(args.outPath, step);
    return {
      path: args.outPath,
      bytes: step.length,
      entities,
      format: "STEP (B-rep, ISO-10303)",
    };
  }
  if (name === "html_render") {
    const { writeFileSync } = await import("node:fs");
    const spec = args.assembly
      ? { assembly: args.assembly }
      : { intent: args.intent };
    const html = await renderHtml(spec, {
      title: args.title ?? "NexyFab 3D",
      subtitle: args.subtitle ?? "",
    });
    writeFileSync(args.outPath, html);
    return {
      path: args.outPath,
      bytes: html.length,
      note: "브라우저로 열어 3D 확인·📷 스크린샷",
    };
  }
  if (name === "extract_drawing") {
    /**
     * ★260731 — **두 추출 경로 중 나쁜 쪽을 쓰고 있었다.**
     *   같은 평가셋 50장 실측:
     *   ```
     *     extractDrawing        (5어휘·단일콜)  파라미터 88.8% · 게이트 79.6% · 측정 49/50
     *     extractDrawingFromImage(11어휘·2단계) 파라미터 96.4% · 게이트 98.0% · 측정 50/50
     *   ```
     *   웹(`/api/nexyfab/drawing/extract`)은 이미 2단계를 쓰는데 **MCP 만 단일콜**이었다 —
     *   클로드에서 도면을 읽히는 사용자가 더 나쁜 경로를 타고 있었다.
     * ⚠ 2단계는 역투영 diff(원본 잉크에 되그려 지지율 검사)까지 돌려 신뢰도를 강등한다 —
     *   단일콜에는 그 검증이 아예 없었다.
     */
    const { readFileSync } = await import("node:fs");
    const p = String(args.imagePath);
    // 확장자로 mime 을 정한다. 모르면 png 로 두되 **추측했다고 적지 않는다** — Gemini 가 거부하면 그 오류가 그대로 올라온다.
    const mime = /\.jpe?g$/i.test(p)
      ? "image/jpeg"
      : /\.webp$/i.test(p)
        ? "image/webp"
        : "image/png";
    const { intent, model, reproject } = await extractDrawingFromImage(
      readFileSync(p).toString("base64"),
      mime,
      args.model ? { model: args.model } : {},
    );
    return { ...intent, _model: model, _reproject: reproject };
  }
  if (name === "edit_drawing") {
    return editDrawing(args.extraction, args.instruction);
  }
  if (name === "reconstruct_3d") {
    const ex = args.extraction;
    const gateErrors = gate(ex);
    if (gateErrors.length) return { gatePassed: false, gateErrors };
    return {
      gatePassed: true,
      gateErrors: [],
      openscad: toOpenScad(ex),
      intent: toComponentIntent(ex),
    };
  }
  if (name === "mech_preset") {
    const domain = args.domain ?? "mech";
    if (!args.templateId) return { domain, templates: listTemplates(domain) };
    return presetWithVerify(domain, args.templateId, args.params ?? {});
  }
  if (name === "analyze_dfm") {
    return analyzeDfm(args.intent, {
      process: args.process,
      thicknessMm: args.thicknessMm,
    });
  }
  if (name === "fab_estimate") {
    const spec = fabSpec(args.intent, { thicknessMm: args.thicknessMm });
    return {
      spec,
      estimate: estimateCost(spec, args.rates ?? {}),
      dxf: toDxf(args.intent),
    };
  }
  if (name === "list_domains") {
    return { domains: listDomains() };
  }
  if (name === "step_roundtrip") {
    return stepRoundTrip(args.assembly);
  }
  if (name === "refine_interferences") {
    return refineInterferencesMesh(args.assembly, args.interferences, {
      epsMm3: args.epsMm3 ?? 1,
    });
  }
  if (name === "execution_gate") {
    // T2(260719b): GA+부품도 내부 생성 → 기입 치수 결정론 대조(도면집과 동일 수학)
    const built = buildAssembly(args.assembly);
    if (!built.ok) return { ok: false, gateErrors: built.gateErrors };
    const pkg = await import("./package.mjs");
    const ps = await import("./part-sheets.mjs");
    const eg = await import("./execution-gate.mjs");
    let gaHtml = "",
      sheetsHtml = "",
      gaFailed = false,
      sheetsFailed = false;
    // 실패를 삼키지 않고 게이트에 알린다 — 그래야 "도면에 없음"과 "도면이 없음"을 가른다(260728).
    try {
      gaHtml = pkg.ga2dDrawing(args.assembly, {
        title: args.assembly.name ?? "gate",
        domain: args.assembly.domain ?? "mech",
        welds: built.welds,
      });
    } catch {
      gaFailed = true;
    }
    try {
      sheetsHtml = ps.partSheets(args.assembly, { title: "gate" });
    } catch {
      sheetsFailed = true;
    }
    return eg.checkExecutionReadiness(args.assembly, {
      gaHtml,
      sheetsHtml,
      welds: built.welds ?? [],
      gaFailed,
      sheetsFailed,
    });
  }
  if (name === "std_audit") {
    const std = await import("./std-snap.mjs");
    return std.auditAssemblyStd(args.assembly);
  }
  if (name === "dxf_reconcile") {
    const dx = await import("./dxf-seed.mjs");
    if (typeof args.dxfText !== "string" || args.dxfText.trim() === "") {
      return {
        ok: false,
        error: "dxfText 가 비어 있다 — 판독할 도면이 없다(빈 도면 판독과 구별)",
      };
    }
    const seed = dx.extractDxfSeed(args.dxfText);
    // 정직 거부: 파싱이 성립하지 않았는데 ok 를 돌려주면 "치수 없는 도면"과 구별되지 않는다.
    const unusable = dx.dxfSeedUnusable(seed);
    if (unusable && unusable.reason !== "empty_entities") {
      return {
        ok: false,
        error: unusable.messageKo,
        reason: unusable.reason,
        seed,
      };
    }
    const reconciled = dx.reconcileIntentWithDxf(
      args.intent,
      seed,
      args.tolPct > 0 ? { tolPct: args.tolPct } : undefined,
    );
    return {
      ok: true,
      seed,
      reconciled,
      ...(reconciled.comparable ? {} : { warning: reconciled.note }),
    };
  }
  if (name === "import_landxml") {
    if (args.xmlPath) return parseLandXmlFile(args.xmlPath);
    if (args.xmlText) return parseLandXml(args.xmlText);
    return { ok: false, error: "xmlPath 또는 xmlText 필요" };
  }
  if (name === "extract_gdt") {
    if (args.stepPath) return extractGdtFile(args.stepPath);
    if (args.stepText) return extractGdt(args.stepText);
    return { ok: false, error: "stepPath 또는 stepText 필요" };
  }
  if (name === "edit_part") {
    return aiEditPart(args.assembly, args.partId, args.instruction, {
      face: args.face ?? null,
    });
  }
  if (name === "face_drag") {
    const part = (args.assembly?.parts ?? []).find((p) => p.id === args.partId);
    if (!part) return { ok: false, error: `부품 '${args.partId}' 없음` };
    const face = args.face
      ? { face: args.face }
      : Array.isArray(args.normal)
        ? faceOfPart(part, args.normal)
        : null;
    if (!face)
      return { ok: false, error: "face 또는 normal 필요(명명 불가=정직 거부)" };
    let d = args.deltaMm;
    if (Number.isFinite(args.targetMm)) {
      const dim = faceDimOf(part, face.face);
      if (!dim)
        return {
          ok: false,
          error: "이 면은 치수 직접 입력 미지원(모호 — 정직 거부)",
          face,
        };
      d = Number(args.targetMm) - dim.value;
    }
    if (!Number.isFinite(d) || d === 0)
      return { ok: false, error: "deltaMm 또는 targetMm 필요(0 제외)" };
    const fp = faceDragPatch(part, face.face, d);
    if (!fp.ok) return { ok: false, error: fp.error, face };
    return {
      ...applyPartPatch(args.assembly, args.partId, fp.patch, {
        kind: "face-drag",
        note: `${face.face} ${d >= 0 ? "+" : ""}${Math.round(d)}mm`,
      }),
      face,
      patch: fp.patch,
    };
  }
  if (name === "part_op") {
    return partOps(args.assembly, args.op, args.partIds, args.opts ?? {});
  }
  if (name === "lod_assembly") {
    const tagged = autoTagAssembly(args.assembly);
    const level = args.level ?? 1;
    const subset = assemblyAtLevel(tagged, level);
    const built = buildAssembly(subset);
    return {
      ok: !!built.ok,
      level,
      assembly: tagged,
      subsetParts: (subset.parts ?? []).length,
      totalParts: (tagged.parts ?? []).length,
      openscad: built.openscad,
      parts: built.parts ?? [],
      gateErrors: built.gateErrors ?? [],
      interferences: built.interferences ?? [],
    };
  }
  if (name === "blade_ring") {
    // 정직 거부: 종전엔 nB=0 에도 mesh 를 만들어 부피·삼각형 수를 돌려줬다 —
    // 날이 없는 블레이드 링은 사양이 아니라 입력 오류다.
    const bad = [];
    if (!Number.isInteger(args.nB) || args.nB < 2 || args.nB > 60)
      bad.push(`nB=${args.nB} (블레이드 수는 2~60 정수)`);
    for (const k of ["rRoot", "rTip", "chord"])
      if (!(Number(args[k]) > 0)) bad.push(`${k}=${args[k]} (> 0 이어야 함)`);
    if (Number(args.rTip) <= Number(args.rRoot))
      bad.push(`rTip(${args.rTip}) ≤ rRoot(${args.rRoot}) — 날 길이가 0 이하`);
    if (bad.length)
      return { ok: false, error: `blade_ring 입력 불가: ${bad.join(", ")}` };
    const genParams = {
      nB: args.nB,
      rRoot: args.rRoot,
      rTip: args.rTip,
      chord: args.chord,
      cx: args.cx,
      cy: args.cy ?? 0,
      cz: args.cz ?? 0,
      pitch: args.pitch,
      naca: args.naca ?? "4412",
    };
    return {
      params: bladeRingMesh(genParams),
      gen: { kind: "blade_ring", params: genParams },
      usage:
        "assembly 부품으로: {id, type:'mesh', params, gen, at:{tx:0,ty:0,tz:0}}",
    };
  }
  if (name === "loft_part") {
    // 단일 바디(loft/sweep) 또는 다중 바디({bodies:[...]}/배열) 통합 처리.
    const { assemblyFromSpec } = await import("./loft.mjs");
    const assembly = assemblyFromSpec(args);
    const volumeMm3 = assembly.parts.reduce(
      (s, p) => s + (p.params.volumeMm3 || 0),
      0,
    );
    const triCount = assembly.parts.reduce(
      (s, p) => s + (p.params.triCount || 0),
      0,
    );
    return {
      ok: true,
      assembly,
      part: assembly.parts[0],
      parts: assembly.parts.length,
      volumeMm3,
      triCount,
    };
  }

  if (name === "resolve_constraints") {
    const { resolveConstraints } = await import("./assembly-constraints.mjs");
    return { ok: true, assembly: resolveConstraints(args.assembly) };
  }

  if (name === "render_preview") {
    const { renderPreview } = await import("./render-preview.mjs");
    const { pngs, triCount } = renderPreview(args.assembly, {
      ...(Array.isArray(args.views) && args.views.length
        ? { views: args.views }
        : {}),
    });
    const res = {
      ok: true,
      triCount,
      parts: args.assembly?.parts?.length ?? 0,
    };
    if (args.outDir) {
      const fs = await import("node:fs"),
        path = await import("node:path");
      fs.mkdirSync(args.outDir, { recursive: true });
      res.files = [];
      for (const [v, buf] of Object.entries(pngs)) {
        const fp = path.join(args.outDir, `preview_${v}.png`);
        fs.writeFileSync(fp, buf);
        res.files.push({ name: `preview_${v}.png`, bytes: buf.length });
      }
      res.outDir = args.outDir;
    } else {
      res.views = {};
      for (const [v, buf] of Object.entries(pngs))
        res.views[v] = buf.toString("base64");
    }
    return res;
  }

  if (name === "sweep_template") {
    return sweepTemplate(args ?? {});
  }
  if (name === "build_corridor") {
    const asm = buildCorridor(args ?? {});
    if ((asm.alignmentErrors ?? []).length)
      return {
        ok: false,
        error: asm.alignmentErrors[0],
        alignmentErrors: asm.alignmentErrors,
      };
    const built = buildAssembly(asm);
    return {
      ok: !!built.ok,
      assembly: asm,
      corridorMeta: asm.corridorMeta,
      ...built,
    };
  }
  if (name === "list_templates") {
    const templates = listAssemblyTemplates(args.domain);
    // 정직 거부: 없는 분야를 "템플릿이 0개인 분야"로 돌려주면 오타가 조용히 통과한다.
    if (args.domain && templates.length === 0) {
      const domains = [
        ...new Set(listAssemblyTemplates().map((t) => t.domain)),
      ];
      return {
        ok: false,
        error: `unknown domain '${args.domain}' — 이 분야는 없다(템플릿이 0개인 것이 아니다)`,
        availableDomains: domains,
      };
    }
    return {
      ok: true,
      ...(args.domain ? { domain: args.domain } : {}),
      templates,
    };
  }

  if (name === "generate_domain_package") {
    // 앞문: 분야 템플릿 → 결정론 어셈블리 → generate_package 와 동일 도시에.
    const asm = buildAssemblyTemplate(
      args.domain,
      args.templateId,
      args.params ?? {},
    );
    if (!asm)
      return {
        ok: false,
        error: `unknown template '${args.domain}/${args.templateId}' — list_templates 로 확인`,
      };
    if (
      asm.ok === false ||
      (Array.isArray(asm.alignmentErrors) && asm.alignmentErrors.length)
    ) {
      // 정직 거부: 입력값 불가를 기본값으로 덮지 않는다.
      return {
        ok: false,
        error: asm.error ?? "invalid_params",
        paramErrors: asm.paramErrors ?? asm.alignmentErrors ?? [],
        message: asm.message,
      };
    }
    // 260729: verifyParams 를 **전달하지 않아** 분야 템플릿 경로에서는 지진(R)·풍(V0)·
    // 옹벽 검토 파라미터를 아무리 넣어도 반영되지 않았다 — 검토가 구현돼 있는데 앞문에서
    // 인자가 끊겨 영영 실행되지 않는 구조였다.
    return callTool("generate_package", {
      assembly: asm,
      outDir: args.outDir,
      title: args.title ?? asm.name,
      withStep: args.withStep,
      ...(args.verifyParams ? { verifyParams: args.verifyParams } : {}),
    });
  }

  if (name === "generate_package") {
    const fs = await import("node:fs");
    const path = await import("node:path");
    fs.mkdirSync(args.outDir, { recursive: true });
    let built = buildAssembly(args.assembly);
    if (!built.ok) return { ok: false, gateErrors: built.gateErrors };
    const title = args.title ?? args.assembly.name ?? "NexyFab 설계";
    const pkg = await import("./package.mjs");
    const boqm = await import("./boq.mjs");
    const pd = await import("./pid_dossier.mjs");
    const dxfm = await import("./dxf-export.mjs");
    const ps = await import("./part-sheets.mjs");
    const fsp = await import("./fab-spec.mjs");
    const dc = await import("./drawing-completeness.mjs");
    const rnd = await import("./html-render.mjs");
    const files = [];
    // 본문을 들고 있어야 발행 직전 REV 스탬프·정합 게이트를 돌릴 수 있다(웹 라우트와 동일 규약).
    // 디스크 기록은 종전대로 즉시 — 중간에 예외가 나도 지금까지 만든 산출물은 남는다.
    const blobs = [];
    // 산출물 생성 실패를 조용히 흘리지 않는다 — 목록에서 빠지면 받는 쪽은 "원래 없는 것"으로
    // 읽는다(260728 §7-5). 실패한 파일 이름을 모아 쉬운요약까지 전달한다.
    const outputsFailed = [];
    const trySave = (nm, make) => {
      try {
        save(nm, make());
      } catch {
        outputsFailed.push(nm);
      }
    };
    const save = (nm, content) => {
      const p = path.join(args.outDir, nm);
      fs.writeFileSync(p, content);
      files.push({ name: nm, bytes: content.length });
      blobs.push({ name: nm, content });
    };
    const revHistory = Array.isArray(args.assembly.revisions)
      ? args.assembly.revisions.map((r, i) => ({
          rev: String(i + 1),
          date: r.at ? new Date(r.at).toISOString().slice(0, 10) : "",
          note: `${r.kind ?? "edit"} ${r.target ?? ""} ${r.note ?? ""}`
            .trim()
            .slice(0, 90),
        }))
      : undefined;
    let completeness = null,
      c9 = null;
    let gaHtml = "",
      sheetsHtml = "";
    try {
      const ga = pkg.ga2dDrawing(args.assembly, {
        title,
        domain: args.assembly.domain ?? "mech",
        welds: built.welds,
        ...(revHistory ? { revHistory } : {}),
      });
      gaHtml = ga;
      save("GA_2D_drawing.html", ga);
      completeness = dc.checkDrawingCompleteness(ga, {
        applicability: dc.completenessApplicability(args.assembly, built),
      });
    } catch (e) {
      files.push({
        name: "GA_2D_drawing.html",
        error: String(e).slice(0, 120),
      });
      outputsFailed.push("GA_2D_drawing.html");
    }
    trySave("structural.html", () =>
      pkg.structuralReport(args.assembly, { title }),
    );
    // ③ 형상+검증: 어셈블리 검증 메타(옹벽 등) → 분야 KDS 계산기 실행값(전도·활동·지지력…). 메타 없으면 미생성(정직).
    // codeVerification: 같은 소스의 압축 판정을 쉬운요약에도 넘긴다 — domainSafety는 담당
    // 도메인이 interior/landscape/bridge/building이라 civil(옹벽·암거)은 어느 쪽으로도
    // 소비자 문서에 도달하지 못했다(260723 A-7 전수감사: 활동 FS 미달 옹벽이 검증.html은
    // FAIL인데 쉬운요약.html은 "구조 안전 이상 없음"으로 나갔다).
    // ⚠ 여기서 예외를 조용히 삼키면 판정이 사라지고 쉬운요약은 "걸린 안전 경고는 없습니다"로
    // 나간다 — 835eec40 이 고친 것과 **같은 결말에 도달하는 다른 경로**다(배선 부재가 아니라
    // 예외). 그래서 삼키지 않고 '확인 못 함'으로 기록해 소비자 문서까지 전달한다(260728).
    const verificationUnavailable = [];
    // 260728: 주 경로는 structuralCheck(asm, {}) 로 부르므로 부재 휨/처짐 검토가 **항상**
    // 안 돌았는데 아무도 말하지 않았다 — 보 8개 가대가 "구조 안전 이상 없음"으로 나갔다.
    if (built.structural?.memberUnavailable) {
      verificationUnavailable.push(
        built.structural.memberUnavailable.messageKo,
      );
    }
    let codeVerification = null;
    try {
      const dv = await import("./domain-dossier-verify.mjs");
      const vh = dv.verificationReportHtml(args.assembly, {
        title,
        params: args.verifyParams ?? {},
      });
      if (vh) save("검증.html", vh);
      codeVerification = dv.codeVerificationVerdict(
        args.assembly,
        args.verifyParams ?? {},
      );
    } catch (e) {
      verificationUnavailable.push(
        `코드 대조 검증(옹벽·암거 KDS): ${String(e?.message ?? e).slice(0, 120)}`,
      );
    }
    // ③b 도메인 안전검토(인테리어 피난·조경 목재·교량 활하중·건축 하중경로) — 도그푸딩 발견:
    // 이 체크들이 예전엔 도세에서 전혀 호출되지 않아 해당 안전검토가 통째로 없는 문서가 나갔다.
    let domainSafety = null;
    try {
      const dv2 = await import("./domain-dossier-verify.mjs");
      const sh = dv2.domainSafetyReportHtml(args.assembly, {
        title,
        params: args.verifyParams ?? {},
      });
      if (sh) save("안전검토.html", sh);
      // 260723 도그푸딩 2차 발견: 안전검토.html엔 FAIL이 정확히 뜨는데, 소비자용 쉬운요약엔
      // 이 판정이 전혀 안 넘어가 "이상 없음"으로 잘못 표시됐다 — FEA와 같은 이유로 별도 전달 필요.
      domainSafety = dv2.domainSafetyVerdict(
        args.assembly,
        args.verifyParams ?? {},
      );
    } catch (e) {
      verificationUnavailable.push(
        `도메인 안전검토(피난·목재·활하중·하중경로): ${String(e?.message ?? e).slice(0, 120)}`,
      );
    }
    trySave("BOQ.html", () =>
      boqm.boqReport(args.assembly, {
        title,
        domain: args.assembly.domain ?? "mech",
      }),
    );
    trySave("Dossier.html", () => pd.dossierReport(args.assembly, { title }));
    let sheetsFailed = false;
    try {
      sheetsHtml = ps.partSheets(args.assembly, {
        title: title + " — 부품 제작도",
      });
      save("부품제작도.html", sheetsHtml);
    } catch {
      sheetsFailed = true;
      outputsFailed.push("부품제작도.html");
    }
    try {
      save(
        "제작사양서.html",
        await fsp.fabricationSpec(args.assembly, {
          title: title + " — 제작 사양서",
        }),
      );
    } catch {
      outputsFailed.push("제작사양서.html");
    }
    try {
      const d = dxfm.dxfPlan(
        args.assembly,
        args.assembly.domain ?? "mech",
        undefined,
        { title, dwgNo: "NX-GA-001" },
      );
      if (d) {
        save("GA_plan.dxf", d);
        c9 = dc.checkDxfLayers(d);
      }
    } catch {
      outputsFailed.push("GA_plan.dxf");
    }
    try {
      save(
        "GA_3D.html",
        await rnd.renderColoredHtml(
          { assembly: args.assembly },
          { title, subtitle: "nexyfab 자동생성 GA(비법정)" },
        ),
      );
    } catch (e) {
      files.push({ name: "GA_3D.html", error: String(e).slice(0, 120) });
      outputsFailed.push("GA_3D.html");
    }
    let step = null;
    let roundtrip = null;
    if (args.withStep) {
      try {
        const r = await intentToStep(built.composeIntent);
        save("model.step", r.step);
        step = { entities: r.entities, dropped: r.fuseReport?.dropped ?? [] };
      } catch (e) {
        step = { error: String(e).slice(0, 120) };
      }
      // A1: STEP 동봉 시 라운드트립 정합 자동(생성≠검증)
      try {
        roundtrip = await stepRoundTrip(args.assembly);
      } catch (e) {
        roundtrip = { error: String(e).slice(0, 120) };
      }
    }
    // B1: 잔여 간섭이 있으면 의심쌍 메시 부울 1패스 자동(과탐 해제·실측 관통량)
    let interferenceRefine = null;
    if ((built.interferences ?? []).length) {
      try {
        interferenceRefine = await refineInterferencesMesh(
          args.assembly,
          built.interferences,
        );
      } catch (e) {
        interferenceRefine = { error: String(e).slice(0, 120) };
      }
      // 260728: 정제를 돌려놓고 응답·쉬운요약은 원본 AABB 과탐을 썼다 — 결과를 되돌린다.
      built = applyInterferenceRefinement(built, interferenceRefine);
      // 예산 초과로 못 본 쌍은 "판정 불가"다 — 보수 유지된 채 확정처럼 세어지면 안 된다.
      if (built.interferencesUnrefined) {
        verificationUnavailable.push(
          `부품 겹침 2차 정밀검증: ${built.interferencesUnrefined}쌍이 성능 예산 초과로 미검증 — 보수(겹침) 판정을 유지했습니다. 확정된 겹침과 구별해서 보세요.`,
        );
      }
    }
    // T2(260719b): 실시 검도 M1~M6 — GA+부품도 기입 치수 결정론 대조(웹 라우트와 동급)
    let executionGate = null;
    try {
      const eg = await import("./execution-gate.mjs");
      executionGate = eg.checkExecutionReadiness(args.assembly, {
        gaHtml,
        sheetsHtml,
        welds: built.welds ?? [],
        gaFailed: gaHtml.length === 0,
        sheetsFailed,
      });
      // 260728: 종전엔 게이트를 계산만 하고 리포트 파일을 쓰지 않았다 — 웹은 실시검도리포트.html
      // 을 동봉하는데 MCP 산출물에는 M1~M6 항목별 판정이 어디에도 없었다(쉬운요약의 한 줄뿐).
      // 렌더러는 execution-gate.mjs 의 것을 그대로 쓴다(복제 금지 — 두 발생지 동일 소스).
      save(
        "실시검도리포트.html",
        eg.executionReportHtml(executionGate, { title }),
      );
    } catch (e) {
      executionGate = { error: String(e).slice(0, 120) };
    }
    // 체결 자동(260719b): 플랜지 짝 볼트 세트 — BOM 보조(강도등급·개스킷=입력 명시)
    let fasteners = null;
    try {
      const fa = await import("./fastener-auto.mjs");
      fasteners = fa.autoFasteners(args.assembly);
    } catch (e) {
      fasteners = { error: String(e).slice(0, 120) };
    }
    // REV 스탬프 + 산출물 크로스 정합 게이트 — 260727 A-7 잔여의 비대칭 해소.
    // 이걸 웹 라우트만 돌리고 있어서 MCP 산출물은 (실측) DXF 표제란이 리터럴
    // 'NF-REV-PENDING', GA 도면 REV 스팬이 '—' 인 채로 나갔고 문서 간 수치 대조가
    // 한 번도 실행되지 않았다. rev 해시식은 웹과 동일 — 같은 어셈블리면 같은 REV.
    const rev = createHash("sha1")
      .update(
        JSON.stringify({ a: args.assembly, d: args.assembly.domain ?? "mech" }),
      )
      .digest("hex")
      .slice(0, 8);
    const aabbs = built.parts ?? [];
    const env = [0, 1, 2].map((k) =>
      aabbs.length
        ? Math.max(...aabbs.map((p) => p.aabb.max[k])) -
          Math.min(...aabbs.map((p) => p.aabb.min[k]))
        : 0,
    );
    const basis = {
      rev,
      massKg: built.structural?.totalMassKg ?? 0,
      env,
      parts: args.assembly.parts.length,
    };
    let consistency = null;
    try {
      for (const b of blobs) {
        if (b.name.endsWith(".html"))
          b.content = pkg.packageStamp(b.content, basis);
        else if (b.name.endsWith(".dxf"))
          b.content = b.content.replaceAll("NF-REV-PENDING", rev);
        else continue;
        fs.writeFileSync(path.join(args.outDir, b.name), b.content);
        const fe = files.find((f) => f.name === b.name);
        if (fe) fe.bytes = b.content.length;
      }
      const hasFluid = (args.assembly.parts ?? []).some((p) => !!p.fluid);
      consistency = pkg.packageConsistencyCheck(blobs, basis, {
        hasFluid,
        alignment: args.assembly.alignment ?? null,
      });
    } catch (e) {
      consistency = {
        error: String(e).slice(0, 120),
      }; /* 정합 게이트 실패가 패키지를 막지는 않되 null 로 숨기지 않는다 */
    }
    // 일반인용 쉬운 요약(260719) — 전문가 산출물을 쉬운 말 5섹션 1페이지로(검도 결과 반영).
    // **스탬프·정합 게이트 뒤에** 만든다(260728 §6-3): 정합 결과를 요약에 실으려면 그것이
    // 먼저 확정돼야 하고, 정합 검사는 쉬운요약 자신을 읽지 않으므로 순서를 미뤄도 안전하다.
    // 자기 자신은 파일 목록에 넣지 않는다(종전과 동일 — 목록은 save 전에 찍는다).
    try {
      const es = await import("./easy-summary.mjs");
      const html = es.easySummary(args.assembly, {
        title,
        domain: args.assembly.domain ?? "mech",
        // 이미 만든 built 를 넘긴다 — 안 넘기면 요약이 스스로 buildAssembly 를 다시 불러
        // 메시 부울로 해제한 과탐 간섭이 되살아나고, 응답과 문서가 다른 숫자를 말한다.
        built,
        // STEP 누락분 — 방법론 §"dropped>0 이면 호출측이 반드시 고지"의 실제 구현.
        ...(step?.dropped?.length ? { stepDropped: step.dropped } : {}),
        // ⚠ 실패 엔트리(`{name, error}`)는 파일이 실제로 없다. 이름만 넘기면 쉬운요약이
        // "GA_2D_drawing.html — 업체에 제일 먼저 보내는 도면입니다" 라고 **없는 파일을
        // 안내**한다(요약 자신의 원칙 "없는 파일 안내=거짓말"에 정면으로 위배). 걸러낸다.
        fileNames: files.filter((f) => !f.error).map((f) => f.name),
        ...(executionGate && !executionGate.error ? { executionGate } : {}),
        ...(domainSafety ? { domainSafety } : {}),
        ...(codeVerification ? { codeVerification } : {}),
        ...(consistency ? { consistency } : {}),
        ...(verificationUnavailable.length ? { verificationUnavailable } : {}),
        ...(completeness ? { completeness } : {}),
        ...(outputsFailed.length ? { outputsFailed } : {}),
      });
      save("쉬운요약.html", pkg.packageStamp(html, basis)); // 늦게 만든 만큼 개별 스탬프
    } catch {
      // ⚠ 이 문서가 **모든 안전 판정을 소비자에게 나르는** 유일한 표면이다. 실패하면
      // 옹벽 KDS·도메인 안전검토·정합·구비요건이 통째로 소비자에게 도달하지 못한다.
      // 그런데 실패 사실을 적을 자리가 바로 그 문서 안이므로, 응답 JSON 이 유일한 통로다.
      outputsFailed.push(
        "쉬운요약.html (안전 판정 전달 문서 — 이 실패는 판정이 소비자에게 도달하지 못했다는 뜻)",
      );
    }
    // 설계 타당성 판정은 buildAssembly 가 이미 산출해 두고 있다 — 종전엔 응답에 싣지 않아
    // 호출자(대개 AI 에이전트)는 부유 부품·간섭·배관 실패가 있어도 `ok:true` 만 받았다.
    // 사람은 쉬운요약.html 에서 볼 수 있지만 에이전트가 읽는 건 이 JSON 이다(웹은 반환함).
    return {
      ok: true,
      outDir: args.outDir,
      rev,
      files,
      completeness,
      c9,
      consistency,
      structural: built.structural ?? null,
      interferences: built.interferences ?? [],
      // 좁혀진 숫자만 주면 에이전트는 무엇이 왜 줄었는지 알 수 없다 — 근거를 함께 준다.
      ...(built.interferenceBasis
        ? {
            interferencesRaw: built.interferencesRaw,
            interferencesDemoted: built.interferencesDemoted,
            ...(built.interferencesUnrefined
              ? { interferencesUnrefined: built.interferencesUnrefined }
              : {}),
            ...(built.interferenceProfile
              ? { interferenceProfile: built.interferenceProfile }
              : {}),
            interferenceBasis: built.interferenceBasis,
          }
        : {}),
      welds: built.welds ?? [],
      weldTotalMm: built.weldTotalMm ?? 0,
      support: built.support ?? null,
      pipes: built.pipes ?? null,
      designOk: built.designOk ?? null,
      verificationUnavailable,
      outputsFailed,
      // 260729: 도메인 안전 판정(기계·교량·건축 하중경로·인테리어·조경)과 코드 대조 검증이
      // **쉬운요약 opts 로만 넘어가고 응답에는 없었다.** 사람은 HTML 에서 보지만 MCP 호출자는
      // 대개 AI 에이전트이고 에이전트가 읽는 건 이 JSON 이다 — 안전 판정을 못 보고 있었다.
      ...(domainSafety ? { domainSafety } : {}),
      ...(codeVerification ? { codeVerification } : {}),
      step,
      roundtrip,
      interferenceRefine,
      executionGate,
      fasteners,
      note: "비법정 — 제작용 실시도서+검토 계산서. 인허가 도서=유자격 기술사 날인 영역.",
    };
  }
  if (name === "verify_domain") {
    return verifyDomain({
      intent: args.intent,
      domain: args.domain,
      calculatorId: args.calculatorId,
      memberRef: args.memberRef,
      params: args.params ?? {},
      standardId: args.standardId ?? "KDS",
    });
  }
  if (name === "analyze_fea") {
    let scad = typeof args.scad === "string" && args.scad ? args.scad : null;
    if (!scad && args.intent) {
      try {
        scad = emitComposite(args.intent);
      } catch (e) {
        return {
          ok: false,
          error: `intent → scad 변환 실패: ${String(e?.message ?? e)}`,
        };
      }
    }
    if (!scad)
      return {
        ok: false,
        error: "scad 또는 intent(compose_3d 산출)가 필요합니다.",
      };
    const loadKg = Number(args.loadKg);
    if (!Number.isFinite(loadKg) || loadKg <= 0)
      return {
        ok: false,
        error: "상면 등가 하중(loadKg, 0 초과)을 명시하세요 — 하중 날조 금지.",
      };
    return remoteCall(
      "/api/nexyfab/drawing/fea-quick/",
      {
        scad,
        materialKey: args.materialKey ?? "steel",
        loadKg,
        precise: args.precise === true,
      },
      "analyze_fea",
    );
  }
  if (name === "reconstruct_verify") {
    const shaped = await shapeReconstructInput(args);
    if (shaped.error) return { ok: false, error: shaped.error };
    const r = await remoteCall(shaped.route, shaped.body, "reconstruct_verify");
    return finalizeReconstruct(r);
  }
  if (name === "reconstruct_fleet") {
    let stlBase64 =
      typeof args.stlBase64 === "string" && args.stlBase64
        ? args.stlBase64
        : null;
    if (!stlBase64 && args.file) {
      try {
        const fs = await import("node:fs");
        stlBase64 = fs.readFileSync(args.file).toString("base64");
      } catch (e) {
        return {
          ok: false,
          error: `STL 읽기 실패: ${String(e?.message ?? e)}`,
        };
      }
    }
    if (!stlBase64)
      return {
        ok: false,
        error: "STL 파일(file) 또는 stlBase64 가 필요합니다.",
      };
    const r = await remoteCall(
      "/api/nexyfab/reverse-engineer/",
      {
        stlBase64,
        mode: "ai-fleet",
        ...(Number.isFinite(args.attempts) ? { attempts: args.attempts } : {}),
      },
      "reconstruct_fleet",
    );
    if (!r || r.ok === false) return r;
    return {
      ok: true,
      aiFleet: r.aiFleet ?? { note: "응답에 aiFleet 없음(모드 미적용?)" },
      ...(r.observedStats ? { observedStats: r.observedStats } : {}),
      ...(r.usage ? { usage: r.usage } : {}),
    };
  }
  if (name === "code_check") {
    return runCodeCheckTool({
      features: args.features,
      list: args.list === true,
    });
  }
  if (name === "interior_check") {
    return interiorCheck(args.assembly, args.params ?? {});
  }
  if (name === "landscape_check") {
    return landscapeCheck(args.assembly, args.params ?? {});
  }
  if (name === "bridge_check") {
    // 라우트와 동일 자동 디스패치: 어셈블리 meta → 아치·트러스·사장·현수·계단, 없으면 거더 폴백.
    const asm = args.assembly ?? {};
    const disp = BRIDGE_DISPATCH.find(
      (d) => asm[d.meta] && typeof bridgeMod[d.fn] === "function",
    );
    const fn = disp ? bridgeMod[disp.fn] : bridgeMod.bridgeCheck;
    return fn(args.assembly, args.params ?? {});
  }
  if (name === "load_path") {
    if (args.list === true)
      return {
        ok: true,
        usages: loadPathUsages(),
        ref: "KDS 41 12 00:2022 표 3.2-1",
      };
    return loadPathCheck(args.assembly, args.params ?? {});
  }
  if (name === "check_connection") {
    const { analyzeConnections: ac, checkConnection: cc } =
      await import("./connections.mjs");
    const opts = { targetSafetyFactor: args.targetSafetyFactor };
    if (Array.isArray(args.connections)) {
      const r = ac({ connections: args.connections }, opts);
      return r
        ? { ok: true, ...r }
        : {
            ok: false,
            error:
              "connections[] 가 비었다 — 검토할 것이 없다(「이상 없음」이 아니다)",
          };
    }
    if (!args.connection)
      return { ok: false, error: "connection 또는 connections[] 가 필요하다" };
    return { ok: true, ...cc(args.connection, opts) };
  }
  if (name === "buckling_precheck") {
    const { bucklingPrecheck: bp, evaluateBuckling: eb } =
      await import("./buckling.mjs");
    const { sectionOfPart: sop } = await import("./section-properties.mjs");
    const opts = { targetSafetyFactor: args.targetSafetyFactor };
    if (args.assembly) {
      const r = bp(args.assembly, opts);
      return r
        ? { ok: true, ...r }
        : {
            ok: false,
            error:
              "압축(axialN 음수 또는 compressionN)을 선언한 부재가 없다 — 「좌굴 없음」이 아니라 **안 잰 것**이다",
          };
    }
    if (!args.part)
      return { ok: false, error: "assembly 또는 part 가 필요하다" };
    const p = args.part;
    const section = p.section ?? (p.type ? sop(p.type, p.params ?? {}) : null);
    return { ok: true, ...eb({ ...p, section, ...opts }) };
  }
  if (name === "solve_mobility") {
    const { solveMobility: sm } = await import("./kinematics.mjs");
    const r = sm(args.assembly, {
      ...(args.ground ? { ground: args.ground } : {}),
    });
    return r
      ? { ok: true, ...r }
      : {
          ok: false,
          error: "joints[] 선언이 없다 — 자유도를 계산하지 않았다(0 이 아니다)",
        };
  }
  throw new Error(`unknown tool: ${name}`);
}

// ---- JSON-RPC over stdio ---- (직접 실행 시에만 — cli.mjs 가 import 해 도구면 재사용)
import { pathToFileURL as _p2f } from "node:url";
const IS_MAIN =
  process.argv[1] && import.meta.url === _p2f(process.argv[1]).href;
const rl = IS_MAIN ? createInterface({ input: process.stdin }) : null;
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

rl?.on("line", async (line) => {
  line = line.trim();
  if (!line) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = req;
  const reply = (result) =>
    id !== undefined && send({ jsonrpc: "2.0", id, result });
  const fail = (code, message) =>
    id !== undefined && send({ jsonrpc: "2.0", id, error: { code, message } });
  try {
    if (method === "initialize") {
      reply({
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "nexyfab-drawing-to-3d", version: "0.1.0" },
      });
    } else if (
      method === "notifications/initialized" ||
      method === "initialized"
    ) {
      // notification
    } else if (method === "ping") {
      reply({});
    } else if (method === "tools/list") {
      reply({ tools });
    } else if (method === "tools/call") {
      try {
        const result = await callTool(params.name, params.arguments ?? {});
        reply({
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      } catch (e) {
        reply({
          content: [{ type: "text", text: `ERROR: ${e.message}` }],
          isError: true,
        });
      }
    } else if (id !== undefined) {
      fail(-32601, `method not found: ${method}`);
    }
  } catch (e) {
    fail(-32603, e.message);
  }
});
