/**
 * eng-domain/interior — public surface for interior building-code gate-material checks.
 * Pure, deterministic compliance checks consumed by the interior DomainModule (Batch 2).
 */
export type {
  InteriorCheckResult,
  UseGroup,
  InteriorCheckId,
} from './checks';
export {
  checkEgressTravelDistance,
  checkEgressWidth,
  checkOccupancyLoad,
  checkCorridorClearWidth,
  checkPlumbingFixtureCount,
  checkCeilingHeight,
  INTERIOR_CHECKS,
  OCCUPANT_LOAD_FACTOR_M2,
  TRAVEL_DISTANCE_LIMIT_M,
  PERSONS_PER_WATER_CLOSET,
} from './checks';
