/**
 * Commitlint — NexyFab commit message policy enforcement.
 *
 * Format (enforced):
 *   [P0|P1|P2] type(scope?): subject
 *
 * Examples:
 *   [P0] feat(cad): B-rep boolean for non-convex polygons
 *   [P1] refactor(ui): split ShapeGeneratorInner into 3 route chunks
 *   [P2] docs(process): risk-policy quick reference
 *
 * Policy doc: docs/process/commit-policy.md
 * Risk tiers: docs/process/risk-policy.md
 *
 * Bypass: `git commit --no-verify` (use sparingly; log the reason in the
 * next commit body so the bypass is auditable).
 */

const TIER_PATTERN = /^\[P[0-2]\] /;
const TYPE_PATTERN = /^\[P[0-2]\] (feat|fix|chore|docs|refactor|test|style|perf|build|ci|revert)(\([\w.-]+\))?: /;

module.exports = {
  extends: ['@commitlint/config-conventional'],
  // We override the parser so config-conventional's type rules don't fire on
  // our `[P0] feat(...)` prefix (which it would otherwise treat as a type).
  parserPreset: {
    parserOpts: {
      headerPattern: /^\[(P[0-2])\] (\w+)(?:\(([^)]+)\))?: (.+)$/,
      headerCorrespondence: ['tier', 'type', 'scope', 'subject'],
    },
  },
  rules: {
    // Disable config-conventional rules that don't apply to our format
    'type-enum': [0],
    'type-empty': [0],
    'subject-case': [0],

    // Header length — keep subject line scannable in git log oneline
    'header-max-length': [2, 'always', 100],

    // Body line wrap — readable in terminal
    'body-max-line-length': [1, 'always', 100],

    // Custom rule: enforce [P0|P1|P2] prefix
    'risk-tier-prefix': [2, 'always'],

    // Custom rule: enforce type after tier
    'tier-type-format': [2, 'always'],
  },
  plugins: [
    {
      rules: {
        'risk-tier-prefix': ({ header }) => {
          if (!header) return [false, 'commit header is empty'];
          if (!TIER_PATTERN.test(header)) {
            return [
              false,
              `header must start with [P0], [P1], or [P2] risk tier — see docs/process/risk-policy.md (got: "${header.slice(0, 40)}")`,
            ];
          }
          return [true];
        },
        'tier-type-format': ({ header }) => {
          if (!header) return [false, 'commit header is empty'];
          if (!TIER_PATTERN.test(header)) return [true]; // risk-tier-prefix already failed
          if (!TYPE_PATTERN.test(header)) {
            return [
              false,
              'after risk tier, use conventional type: feat|fix|chore|docs|refactor|test|style|perf|build|ci|revert',
            ];
          }
          return [true];
        },
      },
    },
  ],
};
