import type { AiAssemblyProgram } from "./aiAssemblyProgram";
import type { GenerationRunState } from "./generationRunState";
import { serverEvidenceSha256 } from "./serverEvidence";
import { propagateTopologyReferences, type InterfaceTopologyRecord } from "@/lib/cad/topologyReferencePropagation";
import { type TopologyRemapResult } from "@/lib/cad/topologyRemap";

export const GENERATION_TOPOLOGY_EVIDENCE_SCHEMA = "nexyfab.generation-topology-rebind.v1" as const;
export const GENERATION_TOPOLOGY_HISTORY_SCHEMA = "nexyfab.generation-topology-history.v1" as const;
export const GENERATION_TOPOLOGY_CONSUMERS = ["mate", "interface", "dimension", "gdt", "pmi"] as const;
export type GenerationTopologyConsumer = typeof GENERATION_TOPOLOGY_CONSUMERS[number];
export type GenerationTopologyEvidenceSource = "server-reconcile" | "no-regeneration";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_TOPOLOGY_REF = /^[^\u0000-\u001f\u007f]{1,256}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_IDS = 512;

export type TopologyConsumerCoverage = {
  count: number;
  inventorySha256: string;
  referencesSha256: string;
  resultSha256: string;
  remapCount: number;
  unresolvedCount: number;
};

export type GenerationTopologyLineageEvidence = {
  schema: typeof GENERATION_TOPOLOGY_EVIDENCE_SCHEMA;
  runId: string;
  revision: number;
  programSha256: string;
  programCheckpointHash: string;
  kernelCheckpointHash: string;
  topologyCheckpointHash: string;
  source: GenerationTopologyEvidenceSource;
  /** Hash of the server OCCT baseline/reconcile input. Required for remap lineage. */
  historySha256: string;
  /** Hash of the server OCCT history produced by this regeneration. */
  currentHistorySha256: string;
  noRegeneration?: true;
  consumerCoverage: Record<GenerationTopologyConsumer, TopologyConsumerCoverage>;
  remaps: TopologyRemapResult[];
  evidenceSha256: string;
};

export type GenerationTopologyHistoryPart = {
  partId: string;
  topologyRefs: string[];
  topologyRefsSha256: string;
  stepSha256: string;
};

export type GenerationTopologyHistory = {
  schema: typeof GENERATION_TOPOLOGY_HISTORY_SCHEMA;
  runId: string;
  revision: number;
  programSha256: string;
  programCheckpointHash: string;
  kernelCheckpointHash: string;
  topologyCheckpointHash: string;
  /** Hash of the preceding server topology history, when this is a rebind. */
  previousHistorySha256?: string;
  parts: GenerationTopologyHistoryPart[];
  historySha256: string;
};

type ConsumerInventoryItem = { id: string; refs: string[] };
type ConsumerInventory = Record<GenerationTopologyConsumer, ConsumerInventoryItem[]>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stableId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function stableTopologyRef(value: unknown): value is string {
  return typeof value === "string" && SAFE_TOPOLOGY_REF.test(value);
}

function hash(value: unknown): string {
  return serverEvidenceSha256(value);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function refsForConsumer(items: readonly ConsumerInventoryItem[]): string[] {
  return sortedUnique(items.flatMap((item) => item.refs));
}

function normalizeItems(items: readonly ConsumerInventoryItem[]): ConsumerInventoryItem[] {
  return [...items]
    .map((item) => ({ id: item.id, refs: sortedUnique(item.refs) }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function topologyInterfacesForProgram(program: AiAssemblyProgram): InterfaceTopologyRecord[] {
  const value = record(program.assembly)?.interfaces;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_IDS) throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
  const ids = new Set<string>();
  return value.map((item): InterfaceTopologyRecord => {
    const current = record(item);
    if (!current || !stableId(current.id) || !stableId(current.occurrenceA) || !stableId(current.occurrenceB) ||
        !stableId(current.datumA) || !stableId(current.datumB) || ids.has(current.id)) {
      throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
    }
    ids.add(current.id);
    return {
      id: current.id,
      occurrenceA: current.occurrenceA,
      occurrenceB: current.occurrenceB,
      datumA: current.datumA,
      datumB: current.datumB,
    };
  });
}

function parseOptionalItems(program: AiAssemblyProgram, key: "dimensions" | "gdt" | "pmi"): ConsumerInventoryItem[] {
  const root = record(program.assembly);
  const value = root?.[key];
  if (value === undefined) return [];
  // The current generation contract has no authoritative dimension/GD&T/PMI
  // inventory. A non-empty caller-added field therefore cannot be promoted
  // by writing an empty coverage record; it must wait for a governed producer.
  if (!Array.isArray(value) || value.length > MAX_IDS || value.length > 0) throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
  const ids = new Set<string>();
  return value.map((item): ConsumerInventoryItem => {
    const current = record(item);
    if (!current || !stableId(current.id) || ids.has(current.id)) throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
    const refs = key === "dimensions"
      ? current.refs
      : key === "gdt"
        ? current.targetRef === undefined ? [] : [current.targetRef]
        : current.topoHashes;
    if (!Array.isArray(refs) || refs.some((ref) => !stableId(ref))) throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
    ids.add(current.id);
    return { id: current.id, refs: refs as string[] };
  });
}

/** Build the inventory from the accepted server-side program, never from a request gate. */
export function topologyConsumerInventory(program: AiAssemblyProgram): ConsumerInventory {
  if (program.assembly.mates.length > MAX_IDS) throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
  const mateIds = new Set<string>();
  const mates: ConsumerInventoryItem[] = program.assembly.mates.map((mate) => {
    if (!stableId(mate.id) || mateIds.has(mate.id)) throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
    mateIds.add(mate.id);
    return {
      id: mate.id,
      refs: sortedUnique([`${mate.a.partId}:${mate.a.refId}`, `${mate.b.partId}:${mate.b.refId}`]),
    };
  });
  const interfaces = topologyInterfacesForProgram(program).map((item) => ({
    id: item.id,
    refs: sortedUnique([`${item.occurrenceA}:${item.datumA}`, `${item.occurrenceB}:${item.datumB}`]),
  }));
  return {
    mate: mates,
    interface: interfaces,
    dimension: parseOptionalItems(program, "dimensions"),
    gdt: parseOptionalItems(program, "gdt"),
    pmi: parseOptionalItems(program, "pmi"),
  };
}

function inventoryHash(items: readonly ConsumerInventoryItem[]): string {
  return hash(normalizeItems(items));
}

function referencesHash(items: readonly ConsumerInventoryItem[]): string {
  return hash(refsForConsumer(items));
}

function remapCount(items: readonly ConsumerInventoryItem[], remaps: readonly TopologyRemapResult[]): number {
  const refs = new Set(refsForConsumer(items));
  return remaps.filter((remap) => refs.has(remap.previousRef)).length;
}

function coverageFor(
  program: AiAssemblyProgram,
  remaps: readonly TopologyRemapResult[],
): Record<GenerationTopologyConsumer, TopologyConsumerCoverage> {
  const inventory = topologyConsumerInventory(program);
  const interfaces = topologyInterfacesForProgram(program);
  const propagated = propagateTopologyReferences({ remaps, mates: program.assembly.mates, interfaces });
  const propagatedItems: Record<GenerationTopologyConsumer, ConsumerInventoryItem[]> = {
    mate: propagated.mates.map((mate) => ({
      id: mate.id,
      refs: sortedUnique([`${mate.a.partId}:${mate.a.refId}`, `${mate.b.partId}:${mate.b.refId}`]),
    })),
    interface: [...propagated.activeInterfaces, ...propagated.reviewInterfaces].map((item) => ({
      id: item.id,
      refs: sortedUnique([`${item.occurrenceA}:${item.datumA}`, `${item.occurrenceB}:${item.datumB}`]),
    })),
    dimension: [],
    gdt: [],
    pmi: [],
  };
  const unresolved: Record<GenerationTopologyConsumer, number> = {
    mate: propagated.blockingMateIds.length,
    interface: propagated.blockingInterfaceIds.length,
    dimension: 0,
    gdt: 0,
    pmi: 0,
  };
  return Object.fromEntries(GENERATION_TOPOLOGY_CONSUMERS.map((consumer) => {
    const items = inventory[consumer];
    const result = consumer === "mate" || consumer === "interface"
      ? propagatedItems[consumer]
      : items;
    return [consumer, {
      count: items.length,
      inventorySha256: inventoryHash(items),
      referencesSha256: referencesHash(items),
      resultSha256: hash(normalizeItems(result)),
      remapCount: remapCount(items, remaps),
      unresolvedCount: unresolved[consumer],
    } satisfies TopologyConsumerCoverage];
  })) as Record<GenerationTopologyConsumer, TopologyConsumerCoverage>;
}

function normalizedRemaps(value: unknown): TopologyRemapResult[] {
  if (!Array.isArray(value) || value.length > MAX_IDS) throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
  const previousRefs = new Set<string>();
  return value.map((item) => {
    const current = record(item);
    if (!current || !stableTopologyRef(current.previousRef) || previousRefs.has(current.previousRef) ||
        (current.mappedRef !== undefined && !stableTopologyRef(current.mappedRef)) ||
        !["persistent", "derived", "ambiguous", "broken"].includes(current.quality as string) ||
        typeof current.score !== "number" || !Number.isFinite(current.score) ||
        (current.runnerUpScore !== undefined && (typeof current.runnerUpScore !== "number" || !Number.isFinite(current.runnerUpScore)))) {
      throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
    }
    previousRefs.add(current.previousRef);
    return {
      previousRef: current.previousRef,
      ...(current.mappedRef === undefined ? {} : { mappedRef: current.mappedRef }),
      quality: current.quality as TopologyRemapResult["quality"],
      score: current.score,
      ...(typeof current.runnerUpScore === "number" ? { runnerUpScore: current.runnerUpScore } : {}),
      reason: typeof current.reason === "string" ? current.reason : "server topology remap",
    };
  });
}

function checkpointHash(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function unsignedEvidence(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "evidenceSha256"));
}

export function buildGenerationTopologyLineageEvidence(input: {
  state: GenerationRunState;
  program: AiAssemblyProgram;
  programSha256: string;
  remaps: readonly TopologyRemapResult[];
  source: GenerationTopologyEvidenceSource;
  historySha256: string;
  currentHistorySha256: string;
  revision?: number;
}): GenerationTopologyLineageEvidence {
  const programCheckpointHash = input.state.stages.part_programs.checkpointHash;
  const kernelCheckpointHash = input.state.stages.kernel.checkpointHash;
  const topologyCheckpointHash = input.state.stages.topology.checkpointHash;
  const revision = input.revision ?? input.state.revision;
  if (!SHA256.test(input.programSha256) || !checkpointHash(programCheckpointHash) || !checkpointHash(kernelCheckpointHash) ||
      !checkpointHash(topologyCheckpointHash) || !Number.isSafeInteger(revision) || revision < 0 ||
      input.state.runId.length === 0 || input.state.stages.kernel.status !== "passed" || input.state.stages.topology.status !== "passed") {
    throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
  }
  if (!SHA256.test(input.historySha256) || !SHA256.test(input.currentHistorySha256)) throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
  const remaps = normalizedRemaps(input.remaps);
  const inventory = topologyConsumerInventory(input.program);
  const allReferences = refsForConsumer(GENERATION_TOPOLOGY_CONSUMERS.flatMap((consumer) => inventory[consumer]));
  const remapReferences = new Set(remaps.map((remap) => remap.previousRef));
  if (input.source === "no-regeneration" && (remaps.length !== 0 || allReferences.length !== 0)) throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
  if (input.source === "server-reconcile" && allReferences.some((ref) => !remapReferences.has(ref))) throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
  const consumerCoverage = coverageFor(input.program, remaps);
  const unsigned: Omit<GenerationTopologyLineageEvidence, "evidenceSha256"> = {
    schema: GENERATION_TOPOLOGY_EVIDENCE_SCHEMA,
    runId: input.state.runId,
    revision,
    programSha256: input.programSha256,
    programCheckpointHash,
    kernelCheckpointHash,
    topologyCheckpointHash,
    source: input.source,
    historySha256: input.historySha256,
    currentHistorySha256: input.currentHistorySha256,
    ...(input.source === "no-regeneration" ? { noRegeneration: true as const } : {}),
    consumerCoverage,
    remaps,
  };
  return { ...unsigned, evidenceSha256: hash(unsigned) };
}

/** Strictly validate server-persisted lineage against the current program and checkpoints. */
export function parseGenerationTopologyLineageEvidence(
  state: GenerationRunState,
  program: AiAssemblyProgram,
  programSha256: string,
  value: unknown,
): { remaps: TopologyRemapResult[]; source: GenerationTopologyEvidenceSource; evidence: GenerationTopologyLineageEvidence } | undefined {
  const current = record(value);
  if (!current) return undefined;
  if (current.schema === undefined && current.remaps === undefined) return undefined;
  if (current.schema !== GENERATION_TOPOLOGY_EVIDENCE_SCHEMA || current.runId !== state.runId || current.revision !== state.revision ||
      current.programSha256 !== programSha256 || current.programCheckpointHash !== state.stages.part_programs.checkpointHash ||
      current.kernelCheckpointHash !== state.stages.kernel.checkpointHash || current.topologyCheckpointHash !== state.stages.topology.checkpointHash ||
      !checkpointHash(state.stages.part_programs.checkpointHash) || !checkpointHash(state.stages.kernel.checkpointHash) ||
      !checkpointHash(state.stages.topology.checkpointHash) || typeof current.evidenceSha256 !== "string" || !SHA256.test(current.evidenceSha256)) {
    throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
  }
  const remaps = normalizedRemaps(current.remaps);
  const source = current.source;
  if (typeof current.historySha256 !== "string" || !SHA256.test(current.historySha256) || typeof current.currentHistorySha256 !== "string" || !SHA256.test(current.currentHistorySha256)) throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
  if (source !== "server-reconcile" && source !== "no-regeneration") throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
  if (source === "no-regeneration" && (current.noRegeneration !== true || remaps.length !== 0)) throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
  const historySha256 = current.historySha256 as string;
  const currentHistorySha256 = current.currentHistorySha256 as string;
  const currentHistory = parseGenerationTopologyHistory(state.serverTopologyHistory);
  if (!currentHistory || currentHistory.historySha256 !== currentHistorySha256 ||
      (source === "server-reconcile" && currentHistory.previousHistorySha256 !== historySha256)) {
    throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
  }
  const expected = buildGenerationTopologyLineageEvidence({ state, program, programSha256, remaps, source, historySha256, currentHistorySha256 });
  const unsigned = unsignedEvidence(current);
  if (hash(unsigned) !== current.evidenceSha256 || JSON.stringify(unsigned) !== JSON.stringify(unsignedEvidence(expected))) {
    throw new Error("GENERATION_TOPOLOGY_EVIDENCE_INVALID");
  }
  return { remaps, source, evidence: current as unknown as GenerationTopologyLineageEvidence };
}

export function buildGenerationTopologyHistory(input: {
  state: GenerationRunState;
  programSha256: string;
  parts: readonly GenerationTopologyHistoryPart[];
  previousHistorySha256?: string;
  revision?: number;
}): GenerationTopologyHistory {
  const programCheckpointHash = input.state.stages.part_programs.checkpointHash;
  const kernelCheckpointHash = input.state.stages.kernel.checkpointHash;
  const topologyCheckpointHash = input.state.stages.topology.checkpointHash;
  const revision = input.revision ?? input.state.revision;
  if (!SHA256.test(input.programSha256) || !checkpointHash(programCheckpointHash) || !checkpointHash(kernelCheckpointHash) ||
      !checkpointHash(topologyCheckpointHash) || !stableId(input.state.runId) || !Number.isSafeInteger(revision) || revision < 0 || input.parts.length > MAX_IDS) {
    throw new Error("GENERATION_TOPOLOGY_HISTORY_INVALID");
  }
  if (input.previousHistorySha256 !== undefined && !SHA256.test(input.previousHistorySha256)) throw new Error("GENERATION_TOPOLOGY_HISTORY_INVALID");
  const partIds = new Set<string>();
  const parts = [...input.parts].map((part) => {
    if (!stableId(part.partId) || !Array.isArray(part.topologyRefs) || part.topologyRefs.length > MAX_IDS ||
        partIds.has(part.partId) || part.topologyRefs.some((ref) => !stableTopologyRef(ref)) || new Set(part.topologyRefs).size !== part.topologyRefs.length || !SHA256.test(part.stepSha256)) throw new Error("GENERATION_TOPOLOGY_HISTORY_INVALID");
    partIds.add(part.partId);
    const topologyRefs = sortedUnique(part.topologyRefs);
    if (hash(topologyRefs) !== part.topologyRefsSha256) throw new Error("GENERATION_TOPOLOGY_HISTORY_INVALID");
    return { partId: part.partId, topologyRefs, topologyRefsSha256: part.topologyRefsSha256, stepSha256: part.stepSha256 };
  }).sort((left, right) => left.partId.localeCompare(right.partId));
  const unsigned = {
    schema: GENERATION_TOPOLOGY_HISTORY_SCHEMA,
    runId: input.state.runId,
    revision,
    programSha256: input.programSha256,
    programCheckpointHash,
    kernelCheckpointHash,
    topologyCheckpointHash,
    ...(input.previousHistorySha256 ? { previousHistorySha256: input.previousHistorySha256 } : {}),
    parts,
  } as const;
  return { ...unsigned, historySha256: hash(unsigned) };
}

export function parseGenerationTopologyHistory(value: unknown): GenerationTopologyHistory | undefined {
  const current = record(value);
  if (!current) return undefined;
  if (current.schema === undefined) return undefined;
  if (current.schema !== GENERATION_TOPOLOGY_HISTORY_SCHEMA || !stableId(current.runId) || !SHA256.test(String(current.programSha256)) ||
      !SHA256.test(String(current.programCheckpointHash)) || !SHA256.test(String(current.kernelCheckpointHash)) ||
      !SHA256.test(String(current.topologyCheckpointHash)) || !Number.isSafeInteger(current.revision) || (current.revision as number) < 0 ||
      typeof current.historySha256 !== "string" || !SHA256.test(current.historySha256)) {
    throw new Error("GENERATION_TOPOLOGY_HISTORY_INVALID");
  }
  if (current.previousHistorySha256 !== undefined && (typeof current.previousHistorySha256 !== "string" || !SHA256.test(current.previousHistorySha256))) throw new Error("GENERATION_TOPOLOGY_HISTORY_INVALID");
  const parts = Array.isArray(current.parts) ? current.parts : undefined;
  if (!parts) throw new Error("GENERATION_TOPOLOGY_HISTORY_INVALID");
  const partIds = new Set<string>();
  const normalized = parts.map((part) => {
    const item = record(part);
    if (!item || !stableId(item.partId) || partIds.has(item.partId) || !Array.isArray(item.topologyRefs) || !SHA256.test(String(item.topologyRefsSha256)) || !SHA256.test(String(item.stepSha256))) throw new Error("GENERATION_TOPOLOGY_HISTORY_INVALID");
    partIds.add(item.partId);
    const rawRefs = item.topologyRefs;
    if (rawRefs.some((ref) => !stableTopologyRef(ref)) || new Set(rawRefs).size !== rawRefs.length) throw new Error("GENERATION_TOPOLOGY_HISTORY_INVALID");
    const refs = sortedUnique(rawRefs as string[]);
    if (refs.length !== rawRefs.length || hash(refs) !== item.topologyRefsSha256) throw new Error("GENERATION_TOPOLOGY_HISTORY_INVALID");
    return { partId: item.partId, topologyRefs: refs, topologyRefsSha256: item.topologyRefsSha256, stepSha256: item.stepSha256 };
  }).sort((left, right) => left.partId.localeCompare(right.partId));
  const unsigned = Object.fromEntries(Object.entries({ ...current, parts: normalized }).filter(([key]) => key !== "historySha256"));
  if (hash(unsigned) !== current.historySha256) throw new Error("GENERATION_TOPOLOGY_HISTORY_INVALID");
  return { ...current, parts: normalized } as unknown as GenerationTopologyHistory;
}

export function lineageRemapsFromHistory(
  history: GenerationTopologyHistory,
  currentParts: readonly GenerationTopologyHistoryPart[],
): TopologyRemapResult[] {
  const currentByPart = new Map(currentParts.map((part) => [part.partId, part]));
  const remaps: TopologyRemapResult[] = [];
  for (const previous of history.parts) {
    const current = currentByPart.get(previous.partId);
    const currentRefs = new Set(current?.topologyRefs ?? []);
    for (const ref of previous.topologyRefs) {
      const previousRef = `${previous.partId}:${ref}`;
      if (currentRefs.has(ref)) remaps.push({ previousRef, mappedRef: ref, quality: "persistent", score: 1, reason: "server OCCT topology history preserved the kernel reference" });
      else remaps.push({ previousRef, quality: "broken", score: 0, reason: "server OCCT topology history no longer contains the prior kernel reference" });
    }
  }
  return remaps;
}

export function topologyHistoryPartsFromKernelOutput(value: unknown): GenerationTopologyHistoryPart[] {
  if (!Array.isArray(value) || value.length > MAX_IDS) throw new Error("GENERATION_TOPOLOGY_HISTORY_INVALID");
  const partIds = new Set<string>();
  return value.map((item) => {
    const current = record(item);
    const exactCad = record(current?.exactCad);
    const refs = exactCad?.topologyRefs;
    const stepSha256 = exactCad?.stepSha256;
    if (!current || !stableId(current.partId) || partIds.has(current.partId) || !Array.isArray(refs) || refs.length > MAX_IDS || refs.some((ref) => !stableTopologyRef(ref)) || new Set(refs).size !== refs.length || typeof stepSha256 !== "string" || !SHA256.test(stepSha256)) throw new Error("GENERATION_TOPOLOGY_HISTORY_INVALID");
    partIds.add(current.partId);
    const topologyRefs = sortedUnique(refs as string[]);
    return { partId: current.partId, topologyRefs, topologyRefsSha256: hash(topologyRefs), stepSha256 };
  });
}
