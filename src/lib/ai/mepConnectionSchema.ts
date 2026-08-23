import { z } from 'zod';

const id = z.string().trim().min(1).max(128);
const finite = z.number().finite();
const v3 = z.tuple([finite, finite, finite]);
export const mepSystemSchema = z.enum(['electrical', 'data', 'cold_water', 'hot_water', 'drain', 'supply_air', 'return_air']);

export const equipmentPortSchema = z.object({
  id, ownerObjectId: id, system: mepSystemSchema, connector: id, positionMm: v3, required: z.boolean(),
  direction: z.enum(['inlet', 'outlet', 'bidirectional']).optional(),
  nominalDiameterMm: finite.positive().optional(), axis: v3.optional(), insertionDepthMm: finite.nonnegative().optional(),
}).strict();

export const mepNodeSchema = z.object({
  id, system: mepSystemSchema, connector: id, positionMm: v3, nominalDiameterMm: finite.positive().optional(),
}).strict();

export const mepConnectionSchema = z.object({ id, portId: id, nodeId: id }).strict();

export const mepRunSchema = z.object({
  id, system: mepSystemSchema, fromNodeId: id, toNodeId: id, lengthMm: finite.positive(),
  elevationDropMm: finite.optional(), diameterMm: finite.positive().optional(),
  pathMm: z.array(v3).min(2).max(20_000).optional(),
  representation: z.enum(['physical_solid', 'analysis_only_internal_flow']).optional(),
  internalFlowPathId: id.optional(), collisionEligible: z.boolean().optional(),
}).strict();

export const mepConnectionRulesSchema = z.object({
  maximumConnectionDistanceMm: finite.nonnegative(), minimumDrainSlopePercent: finite.nonnegative(), requireMatchingConnector: z.boolean(),
  requirePhysicalRouteGeometry: z.boolean().optional(), endpointToleranceMm: finite.nonnegative().optional(), lengthToleranceMm: finite.nonnegative().optional(),
  minimumAxisAlignmentCos: finite.min(0).max(1).optional(), requireDiameterMatch: z.boolean().optional(), requireRunFromConnectedPort: z.boolean().optional(),
}).strict();

export const physicalNetworkModelSchema = z.object({
  id,
  ports: z.array(equipmentPortSchema).max(2_000),
  nodes: z.array(mepNodeSchema).max(10_000),
  connections: z.array(mepConnectionSchema).max(20_000),
  runs: z.array(mepRunSchema).max(10_000),
  rules: mepConnectionRulesSchema,
}).strict();

export const strictPhysicalNetworkModelSchema = physicalNetworkModelSchema.extend({
  runs: z.array(mepRunSchema.extend({ pathMm: z.array(v3).min(2).max(20_000) }).strict()).max(10_000),
  rules: mepConnectionRulesSchema.extend({
    requirePhysicalRouteGeometry: z.literal(true),
    requireDiameterMatch: z.literal(true),
    requireRunFromConnectedPort: z.literal(true),
  }).strict(),
}).strict();
