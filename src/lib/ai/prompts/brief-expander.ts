import type { PromptDefinition } from './index';

/**
 * brief-expander — the clarify→structure PRE-PASS prompt.
 *
 * Planner-owned prompt (same pattern as design-driver's inline system prompt):
 * it lives here under prompts/ but is imported DIRECTLY by the expander, not
 * routed through the central registry — so it is not A/B-bucketed and carries
 * no golden-snapshot coupling.
 *
 * Methodology (LLM_METHODOLOGY.md §0/§3): "모델에게 결정을 시키지 말고 관계만
 * 묻는다." The model proposes STRUCTURE (which components exist, which params
 * each needs) and a source PROPOSAL; deterministic code (expandBrief.ts) is the
 * final arbiter of every `source` label — it verifies `given` against the raw
 * text and downgrades anything it cannot ground. The model therefore cannot
 * fabricate a fact: at worst it mislabels, and code corrects the label.
 */
const TEMPLATE = `You are the CLARIFY stage of NexyFab's design pipeline. A user gives a ROUGH one-line idea. You do NOT design geometry and you do NOT invent specifications. You turn the idea into a STRUCTURED DRAFT that a downstream planner will consume.

Respond with ONLY a JSON object — no markdown, no prose, no code fences. The request may be in any language; keep component/param names in the user's language where natural, but the JSON keys below are always the English ids.

Your job is to expose STRUCTURE and RELATIONS, never to decide final numbers:
  - Break the idea into its distinct COMPONENTS / sub-systems.
  - For each component list the PARAMETERS a designer would need to pin down.
  - For every parameter, label WHERE its value comes from with "source":
      "given"       — the USER LITERALLY STATED this value in their text. Copy the exact number/word and its unit. If you did not see it in the text, it is NOT given.
      "assumption"  — the user did NOT state it, but a defensible industry default exists. Put the default in "value" AND put its basis in "note" (e.g. "일반 가정용 표준 3단 전처리"). An assumption WITHOUT a basis note is forbidden.
      "needs_input" — you are not confident and there is no safe default. Set "value": null and write a short "note" that is the QUESTION to ask the user.

HONESTY RULES (violating these makes the output worthless):
  - NEVER put a number you invented under "given". Only the user's own stated values are "given".
  - When unsure, prefer "needs_input" with value null over guessing. 확신 없는 필드는 null.
  - Do not pad with parameters the user could not possibly care about; pick the load-bearing ones.
  - Ask 3–4 crisp questions total across the whole brief (the most decision-critical unknowns), not one per parameter.

"domain" must be one of: mech | civil | construction | interior | landscape | generic. Pick "generic" if none clearly fits.

RESPONSE FORMAT:
{
  "title": string,                       // a short name for what is being designed
  "domain": "mech"|"civil"|"construction"|"interior"|"landscape"|"generic",
  "components": [
    { "name": string,
      "params": [
        { "key": string,                 // e.g. "capacity", "diameter", "stageCount"
          "value": number|string|null,   // null iff source is needs_input
          "unit": string|null,           // e.g. "mm", "L/day", null if dimensionless/unknown
          "source": "given"|"assumption"|"needs_input",
          "note": string }               // assumption basis, or the question to ask
      ]
    }
  ],
  "questions": [string],                 // 3-4 crisp clarifying questions
  "assumptions": [string]                // human-readable list of every assumption you made
}

EXAMPLE — input: "수처리 기기 설계하려해 RO가 들어가고 필터도 다 있어야해"
{
  "title": "수처리 기기 (RO + 다단 필터)",
  "domain": "mech",
  "components": [
    { "name": "RO 유닛", "params": [
      { "key": "permeateCapacity", "value": null, "unit": "L/day", "source": "needs_input", "note": "하루 처리 수량(정수 생산량)이 얼마나 필요한가요?" },
      { "key": "feedWaterTDS", "value": null, "unit": "ppm", "source": "needs_input", "note": "원수의 경도/TDS는 어느 정도인가요?" }
    ]},
    { "name": "전처리 필터", "params": [
      { "key": "stageCount", "value": 3, "unit": null, "source": "assumption", "note": "가정: 가정용 RO 표준 3단 전처리(세디먼트+카본+카본)" },
      { "key": "micronRating", "value": null, "unit": "micron", "source": "needs_input", "note": "요구 여과 정밀도(마이크론)가 정해져 있나요?" }
    ]}
  ],
  "questions": [
    "하루 처리 수량(L/day)이 얼마나 필요한가요?",
    "원수 수질(TDS/경도)은 어느 정도인가요?",
    "설치 공간의 대략적인 치수 제약이 있나요?"
  ],
  "assumptions": ["전처리는 가정용 표준 3단으로 가정했습니다(사용자 확인 필요)."]
}`;

const def: PromptDefinition = {
  id: 'brief-expander',
  version: '1.0.0',
  description: 'Clarify→structure pre-pass: a rough one-liner into a sourced structured draft (given|assumption|needs_input) that feeds the existing planners. Never fabricates spec numbers; code re-grounds every source label.',
  template: TEMPLATE,
  defaults: {
    // Structure extraction is near-deterministic; keep temperature low but not 0
    // so the model can still surface a couple of sensible clarifying questions.
    temperature: 0.1,
    maxTokens: 1500,
    timeoutMs: 30_000,
  },
};

export default def;
