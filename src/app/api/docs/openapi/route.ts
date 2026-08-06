// OpenAPI 3.1 spec for the public NexyFab API. Served as JSON so the
// /api/docs viewer (Scalar / Swagger / etc.) can render it. Kept small —
// only the public-facing endpoints under /api/public/v1 are listed.

import { NextResponse } from "next/server";

const SPEC = {
  openapi: "3.1.0",
  info: {
    title: "NexyFab Public API",
    version: "1.0.0",
    description:
      "Programmatic access to NexyFab projects, drawings, and AI-generated parts. " +
      "Authenticate with a Personal Access Token from Settings → API keys.",
    contact: { name: "NexyFab Support", email: "nexyfab@nexysys.com" },
    license: { name: "Proprietary" },
  },
  servers: [{ url: "https://nexyfab.com", description: "Production" }],
  security: [{ bearerAuth: [] }],
  paths: {
    "/api/public/v1/projects": {
      get: {
        summary: "List projects",
        description:
          "Returns up to 100 most-recently-updated projects for the authenticated user.",
        tags: ["Projects"],
        responses: {
          "200": {
            description: "Project list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    projects: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Project" },
                    },
                  },
                },
              },
            },
          },
          "401": { description: "Unauthorized" },
        },
      },
      post: {
        summary: "Create a project",
        tags: ["Projects"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 200 },
                  shapeId: { type: "string", maxLength: 100 },
                  materialId: { type: "string", maxLength: 100 },
                  sceneData: { type: "string", maxLength: 5_000_000 },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    createdAt: { type: "integer" },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid input" },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/api/cad/v1/product-decomposition": {
      post: {
        summary: "Generate a validated multi-part CAD product",
        description:
          "Returns independent FeatureTrees, reusable part definitions, instances, subassemblies and mates. This endpoint has no quote or RFQ side effects.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["text"],
                properties: {
                  text: { type: "string", minLength: 1, maxLength: 8000 },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Validated product decomposition and compiled assembly program",
          },
          "400": { description: "Missing text" },
          "422": { description: "Generated decomposition needs review" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/api/cad/v1/capabilities": {
      get: {
        summary: "List shared CAD v1 capabilities and CLI/MCP mappings",
        tags: ["CAD"],
        security: [],
        responses: {
          "200": { description: "Capability and legacy compatibility matrix" },
        },
      },
    },
    "/api/cad/v1/feature-program": {
      post: {
        summary: "Create or selection-edit an exact CAD feature program",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["prompt"],
                properties: {
                  prompt: { type: "string" },
                  previousProgram: { type: "object" },
                  selectionContext: { type: "object" },
                  modelId: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Validated complete feature program" },
          "422": {
            description: "Clarification or grounded dimensions required",
          },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/api/cad/v1/feature-tree-mesh": {
      post: {
        summary: "Replay FeatureTree to STL",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["tree"],
                properties: { tree: { type: "object" } },
              },
            },
          },
        },
        responses: {
          "200": { description: "Base64 STL and node count" },
          "422": { description: "Invalid or empty FeatureTree" },
          "503": { description: "OpenSCAD unavailable" },
        },
      },
    },
    "/api/cad/v1/part-step": {
      post: {
        summary: "Export analytic B-rep STEP with manufacturing evidence",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["features"],
                properties: {
                  part: { type: "string" },
                  features: { type: "array", items: { type: "object" } },
                  verificationContext: { type: "object" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Base64 STEP, artifact id, and manufacturing gate metadata",
          },
          "422": { description: "Invalid program or degenerate solid" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/api/cad/v1/assembly/verify": {
      post: {
        summary: "Verify assembly mates, DoF, interference and motion",
        description:
          "Runs the real assembly solver when FeatureTrees are supplied. Spatial AABB interference is checked at rest and at every motion frame. With preciseInterference enabled, terminal FeatureTree bodies use direct tessellation or the server OCCT B-rep path for boolean/fillet/chamfer and drilled/counterbore/countersink holes, then triangle SAT and closed-mesh containment. Unsupported geometry retains the conservative failing verdict.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["state"],
                properties: {
                  state: { type: "object" },
                  featureTrees: { type: "object" },
                  solver: {
                    enum: ["auto", "gauss_seidel", "lagrangian", "adaptive"],
                  },
                  localBoxes: { type: "object" },
                  interferenceWhitelist: {
                    type: "array",
                    items: { type: "string" },
                  },
                  intendedContacts: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["partA", "partB", "justification"],
                    },
                  },
                  allowedDoF: { type: "integer", minimum: 0 },
                  motion: { type: "object" },
                  preciseInterference: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Solved placements, residuals, DoF, interference, assemblyCertificate, designOk and fail-closed releaseReady",
          },
          "422": { description: "Invalid assembly or motion request" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/api/cad/v1/generation/finalize": {
      post: {
        summary: "Finalize an AI CAD run with server-derived evidence",
        description:
          "Verifies animation frames, per-part G0-G7 manufacturing gates, optional reference STEP domain evidence, STEP round-trip measurements, and exact-artifact G9. referenceStep accepts raw STEP source plus required checks (flat_pattern, bend_table, member_identity, miter_lengths, cut_list); caller pass claims are ignored. Failures identify only affected parts and do not create quotes or RFQs.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["state", "program", "motion", "parts"],
                properties: {
                  state: { type: "object" },
                  program: { type: "object" },
                  motion: { type: "object" },
                  parts: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        partId: { type: "string" },
                        referenceStep: {
                          type: "object",
                          required: ["source", "requirements"],
                          properties: {
                            source: { type: "string" },
                            requirements: {
                              type: "array",
                              uniqueItems: true,
                              items: {
                                enum: [
                                  "flat_pattern",
                                  "bend_table",
                                  "member_identity",
                                  "miter_lengths",
                                  "cut_list",
                                ],
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Release verdict, server-derived STEP manufacturing reports, affected parts, and stage-local recovery guidance",
          },
          "400": { description: "Invalid finalization evidence" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/api/cad/v1/assembly/animation/evaluate": {
      post: {
        summary: "Evaluate a deterministic multi-part animation pose",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["state", "animation", "frame"],
                properties: {
                  state: { type: "object" },
                  animation: { type: "object" },
                  frame: { type: "number" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Assembly placement at the requested frame" },
          "422": { description: "Invalid animation IR" },
        },
      },
    },
    "/api/cad/v1/assembly/animation/command": {
      post: {
        summary: "Apply a deterministic assembly timeline command",
        description:
          "Fail-closed command adapter for one identified part, a frame range, X/Y/Z translation and millimetres. Unsupported intent is rejected rather than guessed.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["state", "animation", "command"],
                properties: {
                  state: { type: "object" },
                  animation: { type: "object" },
                  command: {
                    type: "string",
                    example: "0~120프레임 arm X축 100mm 이동",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated animation IR" },
          "422": { description: "Invalid animation or unsupported command" },
        },
      },
    },
    "/api/cad/v1/assembly/selection-edit": {
      post: {
        summary: "Preview an atomic topology- or mate-scoped assembly CAD edit",
        description:
          "Deterministic fail-closed edit planning for selected part topology or one selected mate. Set verifyBrep=true to replay before/after trees in OCCT and return exact volume, bounds, topology counts and BRepCheck validity. Returns no quote/RFQ side effects.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["state", "featureTrees", "selection", "command"],
                properties: {
                  state: { type: "object" },
                  featureTrees: { type: "object" },
                  selection: { type: "array", items: { type: "object" } },
                  selectedMateIds: { type: "array", items: { type: "string" } },
                  command: {
                    type: "string",
                    example: "위쪽 면을 열고 쉘 두께 2mm",
                  },
                  verifyBrep: { type: "boolean", default: false },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Atomic edit preview and rollback transaction",
          },
          "422": { description: "Unsupported, ambiguous or invalid edit" },
        },
      },
    },
    "/api/cad/v1/brep/push-pull": {
      post: {
        summary: "Push or pull one planar face on an imported STEP B-rep",
        description:
          "Assigns deterministic f.import.i face references, executes bidirectional-normal OCCT fuse/cut candidates, requires a volume change and valid B-rep, and returns a base64 STEP artifact. No quote/RFQ side effects.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["step", "faceRef", "distanceMm"],
                properties: {
                  step: { type: "string" },
                  encoding: {
                    type: "string",
                    enum: ["base64", "utf8"],
                    default: "base64",
                  },
                  faceRef: { type: "string", example: "f.import.5" },
                  distanceMm: { type: "number", example: 2 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Verified edited STEP and exact evidence" },
          "422": {
            description:
              "Import, selection, curved-face, kernel or validity failure",
          },
        },
      },
    },
    "/api/cad/v1/reference/analyze": {
      post: {
        summary: "Measure an inline STEP reference with exact OCCT evidence",
        description:
          "Accepts only an inline base64 or UTF-8 STEP body; server paths, URLs and fixture locators are forbidden. Returns Evidence IR v2 and the scale-aware tolerance policy without creating a quote or RFQ.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["step", "scenarioId", "lengthUnit"],
                properties: {
                  step: {
                    type: "string",
                    description: "Inline STEP content, base64 by default.",
                  },
                  encoding: {
                    type: "string",
                    enum: ["base64", "utf8"],
                    default: "base64",
                  },
                  format: {
                    type: "string",
                    enum: ["step", "stp"],
                    default: "step",
                  },
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
                        additionalProperties: false,
                        required: ["kind"],
                        properties: { kind: { const: "mm" } },
                      },
                      {
                        type: "object",
                        additionalProperties: false,
                        required: ["kind", "scaleToMm"],
                        properties: {
                          kind: { const: "scale-to-mm" },
                          scaleToMm: { type: "number", exclusiveMinimum: 0 },
                          label: { type: "string" },
                        },
                      },
                    ],
                  },
                  declaredSourceTolerance: {
                    type: "object",
                    additionalProperties: false,
                    required: ["value"],
                    properties: {
                      value: { type: "number", exclusiveMinimum: 0 },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Evidence IR v2 and tolerance policy" },
          "400": {
            description:
              "Invalid body, encoding, unit or forbidden path/URL field",
          },
          "413": { description: "Inline STEP exceeds 20 MiB" },
          "422": { description: "STEP analysis failed" },
          "429": { description: "Rate limited" },
          "503": { description: "OCCT unavailable" },
        },
      },
    },
    "/api/cad/v1/ifc/semantic-roundtrip": {
      post: {
        summary: "Verify IFC semantic roundtrip preservation",
        description:
          "Compares two inline IFC SPF documents for GlobalId, spatial parents, property/quantity/material definitions and ProjectedCRS/MapConversion. Source documents are not returned and no quote or RFQ is created.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["beforeIfc", "afterIfc"],
                properties: {
                  beforeIfc: { type: "string" },
                  afterIfc: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Fail-closed semantic preservation evidence" },
          "400": { description: "Invalid body or forbidden field" },
          "413": { description: "Either IFC exceeds 20 MiB" },
          "422": { description: "IFC parsing failed" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/api/cad/v1/step/mechanical-relations": {
      post: {
        summary: "Analyze STEP mechanical relations",
        description:
          "Measures occurrence-transformed analytic cylinder axes, repeated placements, constant-thickness panels, and elongated structural members without synthesizing missing manufacturing semantics.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["step"],
                properties: {
                  step: { type: "string" },
                  angularToleranceRad: { type: "number", exclusiveMinimum: 0 },
                  linearTolerance: { type: "number", exclusiveMinimum: 0 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Measured mechanical relation evidence" },
          "400": { description: "Invalid body" },
          "413": { description: "STEP exceeds 20 MiB" },
          "422": { description: "STEP relation analysis failed" },
        },
      },
    },
    "/api/cad/v1/ifc/domain-ir": {
      post: {
        summary: "Build specialized IFC domain IR",
        description:
          "Builds governed alignment horizontal/vertical/cant IR or structural node/member/connectivity IR. CUBIC is evaluated only for a line-to-arc transition; VIENNESEBEND additionally requires matched cant, RailHeadDistance, and provenance-bearing gravity-center input.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["ifc", "domain"],
                properties: {
                  ifc: { type: "string" },
                  domain: {
                    type: "string",
                    enum: ["alignment", "structural-analysis"],
                  },
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
          },
        },
        responses: {
          "200": { description: "Domain IR and fail-closed release verdict" },
          "400": {
            description:
              "Invalid domain, authoritative input, or forbidden field",
          },
          "413": { description: "IFC exceeds 20 MiB" },
          "422": { description: "IFC domain parsing failed" },
        },
      },
    },
    "/api/cad/v1/ifc/recovery-plan": {
      post: {
        summary: "Plan occurrence-scoped IFC geometry recovery",
        description:
          "Returns missing axes, governed recovery action and required authoritative inputs without inventing dimensions.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["ifc"],
                properties: { ifc: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": { description: "Recovery requests and release verdict" },
          "400": { description: "Invalid or forbidden input" },
          "413": { description: "IFC exceeds 20 MiB" },
          "422": { description: "Recovery analysis failed" },
        },
      },
    },
    "/api/cad/v1/ifc/recover-geometry": {
      post: {
        summary: "Apply authoritative occurrence geometry inputs",
        description:
          "Validates operator-provided physical widths against exact GlobalId recovery requests, applies only one missing axis, and returns before/after evidence without quote or RFQ side effects.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["ifc", "authoritativeInputs"],
                properties: {
                  ifc: { type: "string" },
                  authoritativeInputs: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["globalId", "physicalWidthMm", "provenance"],
                      properties: {
                        globalId: { type: "string" },
                        physicalWidthMm: { type: "number" },
                        provenance: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Fail-closed recovery result and application evidence",
          },
          "400": { description: "Invalid or forbidden input" },
          "413": { description: "IFC exceeds 20 MiB" },
          "422": { description: "Recovery execution failed" },
        },
      },
    },
    "/api/cad/v1/assembly/animation/verify": {
      post: {
        summary:
          "Verify continuous assembly animation interference and first contact",
        description:
          "Uses swept/adaptive AABB coverage followed by FeatureTree mesh or OCCT tessellation distance proofs. For confirmed collisions it searches left-to-right and returns a conservative first-possible to confirmed-collision frame bracket. Missing geometry or exhausted CCD/TOI budgets block release.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["state", "animation", "localBoxes"],
                properties: {
                  state: { type: "object" },
                  animation: { type: "object" },
                  localBoxes: { type: "object" },
                  featureTrees: { type: "object" },
                  frameStep: { type: "integer", minimum: 1 },
                  rotationalMaxDepth: {
                    type: "integer",
                    minimum: 0,
                    maximum: 16,
                  },
                  toiMaxDepth: { type: "integer", minimum: 0, maximum: 24 },
                  toiFrameTolerance: { type: "number", exclusiveMinimum: 0 },
                  toiMaxEvaluations: { type: "integer", minimum: 1 },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Broad, precise continuous, TOI bracket and fail-closed release evidence",
          },
        },
      },
    },
    "/api/cad/v1/generation/verify": {
      post: {
        summary: "Verify the complete staged AI CAD generation process",
        description:
          "Fail-closed read-only gate across intent, independent part generation, manufacturing evidence, mate residuals, declared DoF, precise interference, motion and STEP roundtrip. No quote or RFQ is created.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["intent", "decomposition", "parts"],
                properties: {
                  intent: { type: "object" },
                  decomposition: { type: "object" },
                  parts: { type: "array", items: { type: "object" } },
                  assembly: { type: "object" },
                  interference: { type: "object" },
                  motion: { type: "object" },
                  stepRoundtrip: { type: "object" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Current blocking stage, structured errors/warnings and releaseReady",
          },
          "400": { description: "Invalid evidence object" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/api/cad/v1/robot/generate": {
      post: {
        summary: "Generate and engineering-check a parametric 6-axis robot",
        description:
          "Creates independent editable structural FeatureTrees and evaluates FK workspace, velocity-Jacobian singularities, sampled self-collision, static gravity torque and cable bend/twist. Unselected catalog components remain explicit release blockers.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["spec"],
                properties: {
                  name: { type: "string" },
                  spec: { type: "object", required: ["joints", "payloadKg"] },
                  catalog: { type: "array", items: { type: "object" } },
                  targets: { type: "array", items: { type: "object" } },
                  path: {
                    type: "array",
                    maxItems: 2000,
                    items: { type: "object" },
                  },
                  cableRoutes: { type: "array", items: { type: "object" } },
                  cableKeepOut: { type: "array", items: { type: "object" } },
                  serviceEnvelopes: {
                    type: "array",
                    items: { type: "object" },
                  },
                  serviceObstacles: {
                    type: "array",
                    items: { type: "object" },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Editable robot program, engineering report and release blockers",
          },
          "400": { description: "Missing robot specification" },
          "422": { description: "Invalid robot specification" },
        },
      },
    },
    "/api/cad/v1/manufacturing/verify": {
      post: {
        summary: "Evaluate fail-closed manufacturing evidence G0-G9",
        description:
          "Read-only evidence evaluation. Missing gates are not_run and block designOk. No quote, RFQ, or artifact release is created.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: {
          "200": {
            description:
              "G0-G9 report, designOk, and explicit no-side-effect status",
          },
          "400": { description: "Invalid evidence object" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/api/cad/v1/sheet-metal/verify": {
      post: {
        summary: "Unfold and verify sheet metal",
        description:
          "Returns measured developed length, bend table, warnings, and flat DXF without quote/RFQ side effects.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["spec"],
                properties: {
                  partId: { type: "string" },
                  spec: { type: "object" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Flat-pattern artifact and verification gate" },
          "422": { description: "Invalid or unbuildable sheet metal" },
        },
      },
    },
    "/api/cad/v1/weldment/verify": {
      post: {
        summary: "Measure and verify weldment cut list",
        description:
          "Returns real mitered member lengths, stock total, mass, and cut-list evidence without quote/RFQ side effects.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["spec"],
                properties: {
                  partId: { type: "string" },
                  spec: { type: "object" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Weldment artifact and verification gate" },
          "422": { description: "Invalid or unbuildable weldment" },
        },
      },
    },
    "/api/cad/v1/tolerance/analyze": {
      post: {
        summary: "Analyze tolerance stack",
        description:
          "Returns deterministic worst-case and RSS bounds. Worst-case is used for designOk release.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["dimensions"],
                properties: {
                  dimensions: { type: "array", items: { type: "object" } },
                  lowerSpec: { type: "number" },
                  upperSpec: { type: "number" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Worst-case/RSS analysis and specification verdict",
          },
        },
      },
    },
    "/api/cad/v1/pmi/verify": {
      post: {
        summary: "Verify GD&T and topology references",
        description:
          "Validates GD&T and moves unresolved stable topology targets to an explicit review queue.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["callouts", "validTopologyRefs"],
              },
            },
          },
        },
        responses: {
          "200": { description: "Verified callouts and review queue" },
        },
      },
    },
    "/api/cad/v1/topology/reconcile": {
      post: {
        summary: "Reconcile regenerated topology references",
        description:
          "Conservatively remaps topology and propagates safe references to mates, dimensions, GD&T and PMI. Ambiguous or broken consumers are returned in review lists.",
        tags: ["CAD"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TopologyReconcileRequest" },
            },
          },
        },
        responses: {
          "200": { description: "Remaps, active consumers, and review queues" },
          "400": { description: "Missing topology arrays" },
          "413": { description: "Topology entity limit exceeded" },
          "422": { description: "Invalid topology payload" },
          "429": { description: "Rate limited" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "Personal Access Token issued from Settings → API keys. Pass as " +
          "`Authorization: Bearer <token>`.",
      },
    },
    schemas: {
      Project: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          shapeId: { type: ["string", "null"] },
          materialId: { type: ["string", "null"] },
          createdAt: { type: "integer" },
          updatedAt: { type: "integer" },
        },
      },
      TopologyEntity: {
        type: "object",
        required: ["kind", "persistentRef", "centroid", "measure"],
        properties: {
          kind: { enum: ["face", "edge", "vertex"] },
          persistentRef: { type: "string" },
          featureId: { type: "string" },
          semanticRole: { type: "string" },
          centroid: {
            type: "array",
            prefixItems: [
              { type: "number" },
              { type: "number" },
              { type: "number" },
            ],
            minItems: 3,
            maxItems: 3,
          },
          direction: {
            type: "array",
            prefixItems: [
              { type: "number" },
              { type: "number" },
              { type: "number" },
            ],
            minItems: 3,
            maxItems: 3,
          },
          measure: { type: "number", minimum: 0 },
          adjacency: { type: "array", items: { type: "string" } },
        },
      },
      TopologyReconcileRequest: {
        type: "object",
        required: ["previous", "current"],
        properties: {
          previous: {
            type: "array",
            maxItems: 10000,
            items: { $ref: "#/components/schemas/TopologyEntity" },
          },
          current: {
            type: "array",
            maxItems: 10000,
            items: { $ref: "#/components/schemas/TopologyEntity" },
          },
          mates: { type: "array", items: { type: "object" } },
          dimensions: { type: "array", items: { type: "object" } },
          gdt: { type: "array", items: { type: "object" } },
          pmi: { type: "array", items: { type: "object" } },
        },
      },
    },
  },
  tags: [
    { name: "Projects", description: "CAD project CRUD" },
    {
      name: "CAD",
      description:
        "AI product generation and deterministic topology/reference services",
    },
  ],
};

export async function GET() {
  return NextResponse.json(SPEC, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
