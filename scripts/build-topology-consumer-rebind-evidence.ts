import fs from "node:fs";
import path from "node:path";
import type { Mate } from "../src/lib/assembly/mate";
import {
  propagateTopologyReferences,
  runTopologySafeAssemblySolve,
} from "../src/lib/cad/topologyReferencePropagation";

const output =
  process.argv[2] ?? "docs/evidence/topology-consumer-rebind-260806/run-1.json";
const fixtures = Array.from({ length: 20 }, (_, index) => {
  const mate: Mate = {
    id: `mate-${index}`,
    kind: "concentric",
    a: { partId: "shaft-1", refId: "axis-old", refKind: "axis" },
    b: { partId: "bearing-1", refId: "axis-fixed", refKind: "axis" },
  };
  const iface = {
    id: `interface-${index}`,
    occurrenceA: "shaft-1",
    occurrenceB: "bearing-1",
    datumA: "axis-old",
    datumB: "axis-fixed",
    type: "revolute" as const,
  };
  const safe = propagateTopologyReferences({
    remaps: [
      {
        previousRef: "shaft-1:axis-old",
        mappedRef: `axis-new-${index}`,
        quality: "persistent" as const,
        score: 1,
        reason: "native history",
      },
    ],
    mates: [mate],
    interfaces: [iface],
  });
  let safeSolveCalls = 0;
  runTopologySafeAssemblySolve(safe, () => {
    safeSolveCalls += 1;
  });

  const broken = propagateTopologyReferences({
    remaps: [
      {
        previousRef: "shaft-1:axis-old",
        quality: index % 2 ? ("ambiguous" as const) : ("broken" as const),
        score: 0,
        reason: "negative control",
      },
    ],
    mates: [mate],
    interfaces: [iface],
  });
  let blockedSolveCalls = 0;
  try {
    runTopologySafeAssemblySolve(broken, () => {
      blockedSolveCalls += 1;
    });
  } catch {
    /* expected fail-closed */
  }
  const passed =
    safe.assemblySolveReady &&
    safe.mates[0]?.a.refId === `axis-new-${index}` &&
    safe.activeInterfaces[0]?.datumA === `axis-new-${index}` &&
    safeSolveCalls === 1 &&
    !broken.assemblySolveReady &&
    broken.blockingMateIds.length === 1 &&
    broken.blockingInterfaceIds.length === 1 &&
    blockedSolveCalls === 0;
  return {
    id: `assembly-rebind-${String(index + 1).padStart(2, "0")}`,
    status: passed ? ("passed" as const) : ("failed" as const),
    safe: {
      assemblySolveReady: safe.assemblySolveReady,
      mateDatum: safe.mates[0]?.a.refId,
      interfaceDatum: safe.activeInterfaces[0]?.datumA,
      solveCalls: safeSolveCalls,
    },
    negative: {
      quality: index % 2 ? "ambiguous" : "broken",
      assemblySolveReady: broken.assemblySolveReady,
      blockingMateIds: broken.blockingMateIds,
      blockingInterfaceIds: broken.blockingInterfaceIds,
      solveCalls: blockedSolveCalls,
    },
  };
});
const pass = fixtures.filter((item) => item.status === "passed").length;
const artifact = {
  schema: "nexyfab.topology-consumer-rebind-evidence.v1",
  generatedAt: new Date().toISOString(),
  scope:
    "20 calibrated mate+product-interface datum remaps with broken/ambiguous solver-block negative controls.",
  status: pass === fixtures.length ? "passed" : "failed",
  summary: {
    fixtures: fixtures.length,
    pass,
    fail: fixtures.length - pass,
    safeSolveCalls: fixtures.reduce(
      (sum, item) => sum + item.safe.solveCalls,
      0,
    ),
    blockedSolveCalls: fixtures.reduce(
      (sum, item) => sum + item.negative.solveCalls,
      0,
    ),
  },
  fixtures,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify({ output, status: artifact.status, ...artifact.summary }),
);
