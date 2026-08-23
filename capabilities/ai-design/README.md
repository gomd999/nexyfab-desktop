# AI Design capability

This directory is the target boundary for generative and assisted design
behavior. Current production implementations remain in their legacy paths while
they are migrated in small, compatibility-safe slices.

- AI implementation root: `src/lib/ai`
- Project API root: `src/app/api/nexyfab/projects/[id]/architecture-interior-ai-design`
- Cross-Scope types: versioned contracts in `packages/`

New isolated AI Design modules should start here. Existing modules move here
only with compatibility exports and the registered accuracy checks; the folder
does not imply that production migration is already complete.
