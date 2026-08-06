import type { Mate, MateRef } from "@/lib/assembly/mate";
import type { Dimension, GdtCallout } from "@/lib/drawing/dimension";
import type { TopologyRemapResult } from "./topologyRemap";

export type PmiTopologyRecord = { id: string; topoHashes: string[] };
export type InterfaceTopologyRecord = {
  id: string;
  occurrenceA: string;
  occurrenceB: string;
  datumA: string;
  datumB: string;
};
export type ReferenceReviewItem = {
  consumer: "mate" | "interface" | "dimension" | "gdt" | "pmi";
  id: string;
  ref: string;
  quality: "ambiguous" | "broken";
  reason: string;
};

export type TopologyPropagationResult<
  TPmi extends PmiTopologyRecord,
  TInterface extends InterfaceTopologyRecord = InterfaceTopologyRecord,
> = {
  mates: Mate[];
  activeInterfaces: TInterface[];
  reviewInterfaces: TInterface[];
  activeDimensions: Dimension[];
  reviewDimensions: Dimension[];
  activeGdt: GdtCallout[];
  reviewGdt: GdtCallout[];
  activePmi: TPmi[];
  reviewPmi: TPmi[];
  review: ReferenceReviewItem[];
  renameMap: Map<string, string>;
  assemblySolveReady: boolean;
  blockingMateIds: string[];
  blockingInterfaceIds: string[];
  confirmationRequiredIds: string[];
};

/** Atomically propagates one regeneration's topology remap to every consumer. */
export function propagateTopologyReferences<
  TPmi extends PmiTopologyRecord,
  TInterface extends InterfaceTopologyRecord = InterfaceTopologyRecord,
>(input: {
  remaps: readonly TopologyRemapResult[];
  mates?: readonly Mate[];
  dimensions?: readonly Dimension[];
  gdt?: readonly GdtCallout[];
  pmi?: readonly TPmi[];
  interfaces?: readonly TInterface[];
}): TopologyPropagationResult<TPmi, TInterface> {
  const remaps = new Map(
    input.remaps.map((result) => [result.previousRef, result]),
  );
  const renameMap = new Map<string, string>();
  for (const result of input.remaps)
    if (result.mappedRef) renameMap.set(result.previousRef, result.mappedRef);
  const review: ReferenceReviewItem[] = [];
  const confirmationRequiredIds = new Set<string>();

  const resolve = (
    ref: string,
    consumer: ReferenceReviewItem["consumer"],
    id: string,
    scoped?: string,
  ) => {
    const result = (scoped ? remaps.get(scoped) : undefined) ?? remaps.get(ref);
    if (!result) return { ref, safe: true };
    if (result.quality === "persistent" || result.quality === "derived") {
      if (result.quality === "derived")
        confirmationRequiredIds.add(`${consumer}:${id}`);
      return { ref: result.mappedRef ?? ref, safe: true };
    }
    review.push({
      consumer,
      id,
      ref,
      quality: result.quality,
      reason: result.reason,
    });
    return { ref, safe: false };
  };

  const mates = (input.mates ?? []).map((mate) => {
    const a = resolveMateRef(mate.a, mate.id, resolve);
    const b = resolveMateRef(mate.b, mate.id, resolve);
    return {
      ...mate,
      a: a.ref,
      b: b.ref,
      suppressed: mate.suppressed || !a.safe || !b.safe,
    } as Mate;
  });
  const blockingMateIds = [
    ...new Set(
      review.filter((item) => item.consumer === "mate").map((item) => item.id),
    ),
  ].sort();

  const activeInterfaces: TInterface[] = [];
  const reviewInterfaces: TInterface[] = [];
  for (const item of input.interfaces ?? []) {
    const a = resolve(
      item.datumA,
      "interface",
      item.id,
      `${item.occurrenceA}:${item.datumA}`,
    );
    const b = resolve(
      item.datumB,
      "interface",
      item.id,
      `${item.occurrenceB}:${item.datumB}`,
    );
    const next = { ...item, datumA: a.ref, datumB: b.ref } as TInterface;
    (a.safe && b.safe ? activeInterfaces : reviewInterfaces).push(next);
  }
  const blockingInterfaceIds = reviewInterfaces.map((item) => item.id).sort();

  const activeDimensions: Dimension[] = [];
  const reviewDimensions: Dimension[] = [];
  for (const dimension of input.dimensions ?? []) {
    let safe = true;
    const refs = dimension.refs.map((ref) => {
      const result = resolve(ref, "dimension", dimension.id);
      safe &&= result.safe;
      return result.ref;
    });
    (safe ? activeDimensions : reviewDimensions).push({ ...dimension, refs });
  }

  const activeGdt: GdtCallout[] = [];
  const reviewGdt: GdtCallout[] = [];
  for (const callout of input.gdt ?? []) {
    const result = resolve(callout.targetRef, "gdt", callout.id);
    (result.safe ? activeGdt : reviewGdt).push({
      ...callout,
      targetRef: result.ref,
    });
  }

  const activePmi: TPmi[] = [];
  const reviewPmi: TPmi[] = [];
  for (const annotation of input.pmi ?? []) {
    let safe = true;
    const topoHashes = annotation.topoHashes.map((ref) => {
      const result = resolve(ref, "pmi", annotation.id);
      safe &&= result.safe;
      return result.ref;
    });
    const next = { ...annotation, topoHashes };
    (safe ? activePmi : reviewPmi).push(next);
  }
  return {
    mates,
    activeInterfaces,
    reviewInterfaces,
    activeDimensions,
    reviewDimensions,
    activeGdt,
    reviewGdt,
    activePmi,
    reviewPmi,
    review,
    renameMap,
    assemblySolveReady:
      blockingMateIds.length === 0 && blockingInterfaceIds.length === 0,
    blockingMateIds,
    blockingInterfaceIds,
    confirmationRequiredIds: [...confirmationRequiredIds].sort(),
  };
}

export function assertTopologySafeForAssemblySolve(
  result: Pick<
    TopologyPropagationResult<PmiTopologyRecord>,
    "assemblySolveReady" | "blockingMateIds" | "blockingInterfaceIds"
  >,
): void {
  if (result.assemblySolveReady) return;
  throw new Error(
    `assembly solve blocked by topology review: mates=[${result.blockingMateIds.join(",")}], interfaces=[${result.blockingInterfaceIds.join(",")}]`,
  );
}

/** Mandatory boundary for callers that solve immediately after regeneration. */
export function runTopologySafeAssemblySolve<TResult>(
  result: Pick<
    TopologyPropagationResult<PmiTopologyRecord>,
    "assemblySolveReady" | "blockingMateIds" | "blockingInterfaceIds"
  >,
  solve: () => TResult,
): TResult {
  assertTopologySafeForAssemblySolve(result);
  return solve();
}

function resolveMateRef(
  ref: MateRef,
  mateId: string,
  resolve: (
    ref: string,
    consumer: ReferenceReviewItem["consumer"],
    id: string,
    scoped?: string,
  ) => { ref: string; safe: boolean },
) {
  const result = resolve(
    ref.refId,
    "mate",
    mateId,
    `${ref.partId}:${ref.refId}`,
  );
  return { ref: { ...ref, refId: result.ref }, safe: result.safe };
}
