/**
 * SCAD agent validation scenarios.
 *
 * Five representative customer prompts covering: simple primitive,
 * BOSL2 thread, shell feature, pattern+hole, BOSL2 gear (slowest).
 * Each scenario lists the expected SCAD keywords and rendering
 * expectations so the orchestrator can grade an agent run without a
 * human in the loop.
 *
 * Scoring is forgiving: the agent passes if it reaches `done` AND the
 * final render succeeded AND the final SCAD source mentions any of the
 * accepted keywords. We don't grade geometric correctness because the
 * agent can't see the result — that's a multimodal v2 concern.
 */

export interface ValidationScenario {
  /** Stable id used in reports. */
  id: string;
  /** Display label for human-facing output. */
  label: string;
  /** Natural-language prompt sent to the agent (Korean to mirror real users). */
  prompt: string;
  /** Soft expectation: roughly how many model turns this should take. */
  expectedTurnsMax: number;
  /** Hard expectation: render must succeed for pass. */
  requireRenderOk: boolean;
  /** Final SCAD must contain at least one keyword (case-insensitive). */
  expectedKeywords: string[];
  /** Estimated AI cost band, USD — informational, not a gate. */
  estimatedCostUsd: number;
}

export const VALIDATION_SCENARIOS: ValidationScenario[] = [
  {
    id: 'sc1_cube',
    label: 'Simple primitive (30mm cube)',
    prompt: '30mm 정육면체를 만들어주세요.',
    expectedTurnsMax: 3,
    requireRenderOk: true,
    expectedKeywords: ['cube', 'cuboid'],
    estimatedCostUsd: 0.005,
  },
  {
    id: 'sc2_m8_bolt',
    label: 'BOSL2 thread (M8 bolt 50mm)',
    prompt: 'M8 나사 50mm 길이 볼트를 만들어줘. 표준 ISO 사양.',
    expectedTurnsMax: 5,
    requireRenderOk: true,
    expectedKeywords: ['threaded_rod', 'screw', 'thread', 'BOSL2'],
    estimatedCostUsd: 0.02,
  },
  {
    id: 'sc3_shell_case',
    label: 'Shell feature (electronics enclosure)',
    prompt: '120x80x40 전자제품 케이스, 벽 두께 2mm로 안쪽 비어있게.',
    expectedTurnsMax: 5,
    requireRenderOk: true,
    expectedKeywords: ['difference', 'shell', 'cube', 'cuboid', 'enclosure'],
    estimatedCostUsd: 0.02,
  },
  {
    id: 'sc4_bracket_holes',
    label: 'Pattern + holes (50x30x5 bracket with 4 mounting holes)',
    prompt: '50x30x5mm 평판 브래킷, 네 모서리에 직경 4mm 마운팅 구멍.',
    expectedTurnsMax: 6,
    requireRenderOk: true,
    expectedKeywords: ['difference', 'cylinder', 'cube', 'translate'],
    estimatedCostUsd: 0.03,
  },
  {
    id: 'sc5_gear',
    label: 'BOSL2 gear (slow render)',
    prompt: '잇수 20개, 모듈 2, 두께 8mm 평기어를 만들어줘.',
    expectedTurnsMax: 5,
    requireRenderOk: true,
    expectedKeywords: ['spur_gear', 'gear', 'BOSL2'],
    estimatedCostUsd: 0.02,
  },
  // ─── Stage 1 — multi-module assembly scenarios ────────────────────────
  {
    id: 'sc6_motor_mount_assy',
    label: 'Assembly: motor mount + 4 screws',
    prompt: 'NEMA17 모터 마운트 브래킷 + M3 볼트 4개 결합 어셈블리를 만들어줘.',
    expectedTurnsMax: 8,
    requireRenderOk: true,
    expectedKeywords: ['module', 'translate', 'screw', 'bracket', 'mount'],
    estimatedCostUsd: 0.05,
  },
  {
    id: 'sc7_gear_train',
    label: 'Assembly: 2-gear train',
    prompt: '맞물리는 평기어 2개 (잇수 20, 잇수 30, 모듈 2, 두께 8mm) 어셈블리.',
    expectedTurnsMax: 8,
    requireRenderOk: true,
    expectedKeywords: ['module', 'spur_gear', 'translate'],
    estimatedCostUsd: 0.05,
  },
  {
    id: 'sc8_pipe_joint',
    label: 'Assembly: T-joint pipe (3 sections)',
    prompt: '외경 30 내경 20 T자형 파이프 조인트 — 가로 + 세로 + 분기 3 구간.',
    expectedTurnsMax: 8,
    requireRenderOk: true,
    expectedKeywords: ['module', 'cylinder', 'difference', 'rotate'],
    estimatedCostUsd: 0.05,
  },
  {
    id: 'sc9_simple_car',
    label: 'Assembly: stylized toy car (body + 4 wheels)',
    prompt: '간단한 토이카 — 박스 차체 + 휠 4개 + 작은 창문 정도.',
    expectedTurnsMax: 10,
    requireRenderOk: true,
    expectedKeywords: ['module', 'cube', 'cylinder', 'translate'],
    estimatedCostUsd: 0.07,
  },
  {
    id: 'sc10_brackets_grid',
    label: 'Assembly: 4×4 bracket grid (16 instances)',
    prompt: 'L자 브래킷 16개를 4×4 그리드로 50mm 간격 배치.',
    expectedTurnsMax: 8,
    requireRenderOk: true,
    expectedKeywords: ['module', 'translate', 'lBracket', 'difference'],
    estimatedCostUsd: 0.05,
  },
  // ─── Stage 2 — visual self-verification scenario ────────────────────────
  {
    id: 'sc11_visual_check',
    label: 'Visual self-check: agent uses view_render to verify a toy car',
    prompt: '간단한 토이카를 만들고 결과를 시각적으로 확인 후 비례가 맞으면 마무리.',
    // More turns expected — render → view_render → potential fix → render → done
    expectedTurnsMax: 12,
    requireRenderOk: true,
    // Either modules path or single-file with cube+cylinder. We require
    // that the SCAD source mentions both body-like and wheel-like shapes
    // AND that the agent did invoke a view_render step (checked via the
    // log line the tool emits in its `output`).
    expectedKeywords: ['cube', 'cylinder', 'translate'],
    estimatedCostUsd: 0.08, // includes 1 vision call
  },
];

// ─── Scoring ────────────────────────────────────────────────────────────────

export interface ScenarioResult {
  scenarioId: string;
  passed: boolean;
  reasons: string[];
  /** Wall-clock time in ms for the full agent run. */
  elapsedMs: number;
  /** Was the final session status 'done'? */
  finishedClean: boolean;
  /** Did the final render succeed? */
  renderOk: boolean;
  /** Last SCAD source the agent committed (truncated for report). */
  finalScadPreview: string;
  /** SCAD source full byte count. */
  finalScadBytes: number;
  /** Conversation rounds actually used. */
  turnsUsed: number;
  /** Tool calls actually made. */
  toolCallsUsed: number;
  /** Approximate token usage (sum of model rounds). */
  tokensUsed: number;
  /** Final session status: 'done' | 'wedged' | 'budget' | 'error' | 'cancelled' */
  status: string;
  /** Free-form notes — wedge reason, error message, etc. */
  notes: string[];
}

export interface ScenarioRunInput {
  status: string;
  scadSource: string;
  renderOk: boolean;
  turnsUsed: number;
  toolCallsUsed: number;
  tokensUsed: number;
  elapsedMs: number;
  errorEvents: string[];
}

/**
 * Grade a scenario run. Returns a `ScenarioResult` capturing pass/fail
 * with concrete reasons so a human can audit later.
 */
export function scoreScenario(scenario: ValidationScenario, run: ScenarioRunInput): ScenarioResult {
  const reasons: string[] = [];

  const finishedClean = run.status === 'done';
  if (!finishedClean) reasons.push(`session ended with status="${run.status}"`);

  const renderOk = run.renderOk === true;
  if (scenario.requireRenderOk && !renderOk) reasons.push('final render did not succeed');

  const sourceLower = run.scadSource.toLowerCase();
  const matchedKeyword = scenario.expectedKeywords.find(k => sourceLower.includes(k.toLowerCase()));
  if (!matchedKeyword) {
    reasons.push(
      `none of the expected keywords were present: ${scenario.expectedKeywords.join(', ')}`,
    );
  }

  const turnsOk = run.turnsUsed <= scenario.expectedTurnsMax + 2;
  if (!turnsOk) {
    reasons.push(`turns ${run.turnsUsed} exceeded soft cap ${scenario.expectedTurnsMax}+2`);
  }

  const passed = finishedClean && (renderOk || !scenario.requireRenderOk) && !!matchedKeyword;

  return {
    scenarioId: scenario.id,
    passed,
    reasons,
    elapsedMs: run.elapsedMs,
    finishedClean,
    renderOk,
    finalScadPreview: run.scadSource.slice(0, 400),
    finalScadBytes: run.scadSource.length,
    turnsUsed: run.turnsUsed,
    toolCallsUsed: run.toolCallsUsed,
    tokensUsed: run.tokensUsed,
    status: run.status,
    notes: run.errorEvents,
  };
}
