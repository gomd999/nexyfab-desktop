import fs from "node:fs";
import path from "node:path";
import { importStepAssembly } from "../src/lib/brep-bridge/stepAssemblyImport";
import {
  deriveStepBodyMembershipEvidence,
  verifyStepBodyMembership,
} from "../src/lib/ai/stepBodyMembershipCertificate";
import type { ComplexProductArchitecture } from "../src/lib/ai/complexProductArchitecture";
import { writeAssemblyAsStep } from "../src/lib/brep-bridge/stepWrite";

type BridgeArtifact = {
  assemblies: Array<{
    scenarioId: string;
    bridge: { status: string; architecture?: ComplexProductArchitecture };
  }>;
};
type StepArtifact = {
  results: Array<{
    scenarioId: string;
    status: string;
    stepFile: string;
  }>;
};
type CampaignResult = {
  scenarioId: string;
  status: "pass" | "fail" | "not_run";
  codes: string[];
  affectedDefinitionIds?: string[];
  expected?: { partDefinitions: number; occurrences: number };
  imported?: {
    productDefinitions: number;
    partDefinitions: number;
    bodies: number;
    occurrences: number;
    relationships: number;
    finiteLocalTransforms: number;
    finiteWorldTransforms: number;
    pathDepth?: number;
    worldTranslation?: number[] | null;
    worldRotationDiagonal?: number[] | null;
    reusedDefinitionCount?: number;
    worldTranslations?: number[][];
  };
  evidence?: unknown;
};

const [bridgeArg, stepArg, outputArg] = process.argv.slice(2);
if (!bridgeArg || !stepArg || !outputArg)
  throw new Error(
    "usage: tsx scripts/build-step-body-membership-evidence.ts <bridge.json> <native-step.json> <output.json>",
  );
const read = <T>(file: string): T =>
  JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) as T;
const bridge = read<BridgeArtifact>(bridgeArg);
const step = read<StepArtifact>(stepArg);
const architectureByScenario = new Map(
  bridge.assemblies.flatMap((item) =>
    item.bridge.status === "pass" && item.bridge.architecture
      ? [[item.scenarioId, item.bridge.architecture] as const]
      : [],
  ),
);
const stepRoot = path.dirname(path.resolve(stepArg));

function addThreeLevelHierarchy(source: string): string {
  const match = source.match(
    /#(\d+)=NEXT_ASSEMBLY_USAGE_OCCURRENCE\(([^;]*),#(\d+),#(\d+),\$\);/,
  );
  const productContext = source.match(/#(\d+)=PRODUCT_CONTEXT\(/)?.[1];
  const definitionContext = source.match(
    /#(\d+)=PRODUCT_DEFINITION_CONTEXT\(/,
  )?.[1];
  if (!match || !productContext || !definitionContext)
    throw new Error("hierarchy fixture source lacks required product entities");
  const leafNauo = Number(match[1]);
  const rootDefinition = Number(match[3]);
  const leafDefinition = Number(match[4]);
  let next =
    Math.max(
      ...[...source.matchAll(/^#(\d+)=/gm)].map((item) => Number(item[1])),
    ) + 1;
  const lines: string[] = [];
  const add = (value: string) => {
    const id = next++;
    lines.push(`#${id}=${value};`);
    return id;
  };
  const product = add(
    `PRODUCT('subassembly','Subassembly','',(#${productContext}))`,
  );
  const formation = add(
    `PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE(' ',' ',#${product},.NOT_KNOWN.)`,
  );
  const subDefinition = add(
    `PRODUCT_DEFINITION(' ','',#${formation},#${definitionContext})`,
  );
  const rootNauo = add(
    `NEXT_ASSEMBLY_USAGE_OCCURRENCE('root_to_sub','root_to_sub','',#${rootDefinition},#${subDefinition},$)`,
  );
  const origin = add(`CARTESIAN_POINT('',(0.,0.,0.))`);
  const z = add(`DIRECTION('',(0.,0.,1.))`);
  const x = add(`DIRECTION('',(1.,0.,0.))`);
  const identity = add(`AXIS2_PLACEMENT_3D('',#${origin},#${z},#${x})`);
  const wire = (nauo: number, tx: number, ty: number) => {
    const moved = add(`CARTESIAN_POINT('',(${tx}.,${ty}.,0.))`);
    const movedZ = add(`DIRECTION('',(0.,0.,1.))`);
    const rotatedX = add(`DIRECTION('',(0.,1.,0.))`);
    const axis = add(
      `AXIS2_PLACEMENT_3D('',#${moved},#${movedZ},#${rotatedX})`,
    );
    const transform = add(
      `ITEM_DEFINED_TRANSFORMATION('fixture-transform','',#${axis},#${identity})`,
    );
    const relationship = add(
      `( REPRESENTATION_RELATIONSHIP('','',#${identity},#${identity}) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#${transform}) SHAPE_REPRESENTATION_RELATIONSHIP() )`,
    );
    const shape = add(`PRODUCT_DEFINITION_SHAPE('','',#${nauo})`);
    add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#${relationship},#${shape})`);
  };
  wire(rootNauo, 100, 0);
  wire(leafNauo, 0, 20);
  const rewritten = source.replace(
    match[0],
    match[0].replace(
      `#${rootDefinition},#${leafDefinition}`,
      `#${subDefinition},#${leafDefinition}`,
    ),
  );
  return rewritten.replace(
    "ENDSEC;\nEND-ISO-10303-21;",
    `${lines.join("\n")}\nENDSEC;\nEND-ISO-10303-21;`,
  );
}

function addBranchingFourLevelHierarchy(source: string): string {
  const match = source.match(
    /#(\d+)=NEXT_ASSEMBLY_USAGE_OCCURRENCE\(([^;]*),#(\d+),#(\d+),\$\);/,
  );
  const productContext = source.match(/#(\d+)=PRODUCT_CONTEXT\(/)?.[1];
  const definitionContext = source.match(
    /#(\d+)=PRODUCT_DEFINITION_CONTEXT\(/,
  )?.[1];
  if (!match || !productContext || !definitionContext)
    throw new Error("branching fixture source lacks required product entities");
  const rootDefinition = Number(match[3]);
  const leafDefinition = Number(match[4]);
  let next =
    Math.max(
      ...[...source.matchAll(/^#(\d+)=/gm)].map((item) => Number(item[1])),
    ) + 1;
  const lines: string[] = [];
  const add = (value: string) => {
    const id = next++;
    lines.push(`#${id}=${value};`);
    return id;
  };
  const container = (id: string, name: string) => {
    const product = add(`PRODUCT('${id}','${name}','',(#${productContext}))`);
    const formation = add(
      `PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE(' ',' ',#${product},.NOT_KNOWN.)`,
    );
    return add(
      `PRODUCT_DEFINITION(' ','',#${formation},#${definitionContext})`,
    );
  };
  const level1 = container("level1", "Level1");
  const branchA = container("branch_a", "BranchA");
  const branchB = container("branch_b", "BranchB");
  const relation = (id: string, parent: number, child: number) =>
    add(
      `NEXT_ASSEMBLY_USAGE_OCCURRENCE('${id}','${id}','',#${parent},#${child},$)`,
    );
  const rootToLevel1 = relation("root_to_level1", rootDefinition, level1);
  const level1ToA = relation("level1_to_a", level1, branchA);
  const level1ToB = relation("level1_to_b", level1, branchB);
  const aToLeaf = relation("a_to_leaf", branchA, leafDefinition);
  const bToLeaf = relation("b_to_leaf", branchB, leafDefinition);
  const identityOrigin = add(`CARTESIAN_POINT('',(0.,0.,0.))`);
  const identityZ = add(`DIRECTION('',(0.,0.,1.))`);
  const identityX = add(`DIRECTION('',(1.,0.,0.))`);
  const identity = add(
    `AXIS2_PLACEMENT_3D('',#${identityOrigin},#${identityZ},#${identityX})`,
  );
  const wire = (
    nauo: number,
    tx: number,
    ty: number,
    xDirection: [number, number],
  ) => {
    const origin = add(`CARTESIAN_POINT('',(${tx}.,${ty}.,0.))`);
    const z = add(`DIRECTION('',(0.,0.,1.))`);
    const x = add(`DIRECTION('',(${xDirection[0]}.,${xDirection[1]}.,0.))`);
    const axis = add(`AXIS2_PLACEMENT_3D('',#${origin},#${z},#${x})`);
    const transform = add(
      `ITEM_DEFINED_TRANSFORMATION('branch-transform','',#${axis},#${identity})`,
    );
    const relationship = add(
      `( REPRESENTATION_RELATIONSHIP('','',#${identity},#${identity}) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#${transform}) SHAPE_REPRESENTATION_RELATIONSHIP() )`,
    );
    const shape = add(`PRODUCT_DEFINITION_SHAPE('','',#${nauo})`);
    add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#${relationship},#${shape})`);
  };
  wire(rootToLevel1, 10, 0, [0, 1]);
  wire(level1ToA, 20, 0, [1, 0]);
  wire(level1ToB, -20, 0, [0, -1]);
  wire(aToLeaf, 5, 0, [1, 0]);
  wire(bToLeaf, 5, 0, [1, 0]);
  const withoutOriginal = source.replace(match[0], "");
  return withoutOriginal.replace(
    "ENDSEC;\nEND-ISO-10303-21;",
    `${lines.join("\n")}\nENDSEC;\nEND-ISO-10303-21;`,
  );
}

const results: CampaignResult[] = step.results.map((item): CampaignResult => {
  const architecture = architectureByScenario.get(item.scenarioId);
  if (!architecture)
    return {
      scenarioId: item.scenarioId,
      status: "not_run" as const,
      codes: ["STEP_BODY_ARCHITECTURE_MISSING"],
    };
  if (item.status !== "pass")
    return {
      scenarioId: item.scenarioId,
      status: "not_run" as const,
      codes: ["STEP_BODY_SOURCE_EXPORT_NOT_PASSED"],
    };
  const stepPath = path.resolve(stepRoot, item.stepFile);
  if (!fs.existsSync(stepPath))
    return {
      scenarioId: item.scenarioId,
      status: "not_run" as const,
      codes: ["STEP_BODY_SOURCE_FILE_MISSING"],
    };
  const imported = importStepAssembly(fs.readFileSync(stepPath, "utf8"), {
    maxClassifyParts: 0,
  });
  if (!imported.productStructure)
    return {
      scenarioId: item.scenarioId,
      status: "not_run" as const,
      codes: ["STEP_BODY_PRODUCT_STRUCTURE_NOT_EXTRACTED"],
    };
  const evidence = deriveStepBodyMembershipEvidence(
    architecture,
    imported.productStructure,
  );
  const report = verifyStepBodyMembership(architecture, evidence);
  const expectedOccurrences = architecture.occurrences.filter((occurrence) =>
    architecture.definitions.some(
      (definition) =>
        definition.id === occurrence.definitionId && definition.kind === "part",
    ),
  ).length;
  const finiteLocalTransforms = imported.productStructure.relationships.filter(
    (relationship) =>
      relationship.localToParent.length === 16 &&
      relationship.localToParent.every(Number.isFinite),
  ).length;
  const finiteWorldTransforms = imported.productStructure.occurrences.filter(
    (occurrence) =>
      occurrence.worldMatrix.length === 16 &&
      occurrence.worldMatrix.every(Number.isFinite),
  ).length;
  const structureCodes = [
    ...(imported.productStructure.relationships.length !== expectedOccurrences
      ? ["STEP_HIERARCHY_RELATIONSHIP_COUNT_MISMATCH"]
      : []),
    ...(finiteLocalTransforms !== imported.productStructure.relationships.length
      ? ["STEP_HIERARCHY_LOCAL_TRANSFORM_INVALID"]
      : []),
    ...(finiteWorldTransforms !== imported.productStructure.occurrences.length
      ? ["STEP_HIERARCHY_WORLD_TRANSFORM_INVALID"]
      : []),
  ];
  const codes = [...report.codes, ...structureCodes].sort();
  return {
    scenarioId: item.scenarioId,
    status: codes.length ? ("fail" as const) : report.status,
    codes,
    affectedDefinitionIds: report.affectedDefinitionIds,
    expected: {
      partDefinitions: architecture.definitions.filter(
        (definition) => definition.kind === "part",
      ).length,
      occurrences: expectedOccurrences,
    },
    imported: {
      productDefinitions: imported.productStructure.definitions.length,
      partDefinitions: imported.productStructure.definitions.filter(
        (definition) => !definition.container,
      ).length,
      bodies: imported.productStructure.definitions.reduce(
        (sum, definition) => sum + definition.bodyCount,
        0,
      ),
      occurrences: imported.productStructure.occurrences.length,
      relationships: imported.productStructure.relationships.length,
      finiteLocalTransforms,
      finiteWorldTransforms,
    },
    evidence,
  };
});

const multiBodyArchitecture: ComplexProductArchitecture = {
  schema: "nexyfab.complex-product-architecture.v1",
  requirements: [],
  definitions: [
    {
      id: "multibody_weldment",
      name: "multibody_weldment",
      kind: "product",
      sourcing: "make",
      independentlyReplaceable: false,
      bodyIntent: { policy: "multi_body", expectedBodies: null },
      requirementIds: [],
    },
    {
      id: "frame",
      name: "Frame",
      kind: "part",
      sourcing: "make",
      independentlyReplaceable: true,
      bodyIntent: { policy: "multi_body", expectedBodies: 3 },
      requirementIds: [],
    },
  ],
  occurrences: [
    {
      id: "root",
      definitionId: "multibody_weldment",
      parentOccurrenceId: null,
      quantityIndex: 1,
    },
    {
      id: "frame-1",
      definitionId: "frame",
      parentOccurrenceId: "root",
      quantityIndex: 1,
    },
  ],
  interfaces: [],
  interfaceExpectation: "none",
};
const multiBodyStep = writeAssemblyAsStep({
  assemblyName: "multibody_weldment",
  parts: [
    {
      kind: "multi_body",
      id: "frame",
      name: "Frame",
      bodies: [
        { x0: 0, y0: 0, z0: 0, x1: 20, y1: 2, z1: 2 },
        { x0: 0, y0: 10, z0: 0, x1: 20, y1: 12, z1: 2 },
        { x0: 0, y0: 2, z0: 0, x1: 2, y1: 10, z1: 2 },
      ],
    },
  ],
});
const multiBodyImported = importStepAssembly(multiBodyStep, {
  maxClassifyParts: 0,
});
if (!multiBodyImported.productStructure)
  throw new Error(
    "multi-body positive fixture did not yield product structure",
  );
const multiBodyEvidence = deriveStepBodyMembershipEvidence(
  multiBodyArchitecture,
  multiBodyImported.productStructure,
);
const multiBodyReport = verifyStepBodyMembership(
  multiBodyArchitecture,
  multiBodyEvidence,
);
results.push({
  scenarioId: "native_multibody_weldment",
  status: multiBodyReport.status,
  codes: multiBodyReport.codes,
  affectedDefinitionIds: multiBodyReport.affectedDefinitionIds,
  expected: { partDefinitions: 1, occurrences: 1 },
  imported: {
    productDefinitions: multiBodyImported.productStructure.definitions.length,
    partDefinitions: multiBodyImported.productStructure.definitions.filter(
      (item) => !item.container,
    ).length,
    bodies: multiBodyImported.productStructure.definitions.reduce(
      (sum, item) => sum + item.bodyCount,
      0,
    ),
    occurrences: multiBodyImported.productStructure.occurrences.length,
    relationships: multiBodyImported.productStructure.relationships.length,
    finiteLocalTransforms:
      multiBodyImported.productStructure.relationships.filter(
        (item) =>
          item.localToParent.length === 16 &&
          item.localToParent.every(Number.isFinite),
      ).length,
    finiteWorldTransforms:
      multiBodyImported.productStructure.occurrences.filter(
        (item) =>
          item.worldMatrix.length === 16 &&
          item.worldMatrix.every(Number.isFinite),
      ).length,
  },
  evidence: multiBodyEvidence,
});

const hierarchicalStep = addThreeLevelHierarchy(
  writeAssemblyAsStep({
    assemblyName: "hierarchy_root",
    parts: [
      {
        id: "leaf",
        name: "Leaf",
        x0: 0,
        y0: 0,
        z0: 0,
        x1: 5,
        y1: 6,
        z1: 7,
      },
    ],
  }),
);
const hierarchyImported = importStepAssembly(hierarchicalStep, {
  maxClassifyParts: 0,
});
const hierarchyStructure = hierarchyImported.productStructure;
const hierarchyOccurrence = hierarchyStructure?.occurrences[0];
const hierarchyCodes = [
  ...(!hierarchyStructure ? ["STEP_HIERARCHY_STRUCTURE_MISSING"] : []),
  ...(hierarchyStructure?.relationships.length !== 2
    ? ["STEP_HIERARCHY_RELATIONSHIP_COUNT_MISMATCH"]
    : []),
  ...(hierarchyOccurrence?.definitionPath.length !== 3
    ? ["STEP_HIERARCHY_PATH_DEPTH_MISMATCH"]
    : []),
  ...(!hierarchyOccurrence ||
  Math.abs(hierarchyOccurrence.worldMatrix[3]! - 80) > 1e-8 ||
  Math.abs(hierarchyOccurrence.worldMatrix[7]!) > 1e-8
    ? ["STEP_HIERARCHY_WORLD_TRANSLATION_MISMATCH"]
    : []),
  ...(!hierarchyOccurrence ||
  Math.abs(hierarchyOccurrence.worldMatrix[0]! + 1) > 1e-8 ||
  Math.abs(hierarchyOccurrence.worldMatrix[5]! + 1) > 1e-8
    ? ["STEP_HIERARCHY_WORLD_ROTATION_MISMATCH"]
    : []),
];
results.push({
  scenarioId: "native_three_level_hierarchy",
  status: hierarchyCodes.length ? "fail" : "pass",
  codes: hierarchyCodes,
  affectedDefinitionIds: [],
  expected: { partDefinitions: 1, occurrences: 1 },
  imported: {
    productDefinitions: hierarchyStructure?.definitions.length ?? 0,
    partDefinitions:
      hierarchyStructure?.definitions.filter((item) => !item.container)
        .length ?? 0,
    bodies:
      hierarchyStructure?.definitions.reduce(
        (sum, item) => sum + item.bodyCount,
        0,
      ) ?? 0,
    occurrences: hierarchyStructure?.occurrences.length ?? 0,
    relationships: hierarchyStructure?.relationships.length ?? 0,
    finiteLocalTransforms:
      hierarchyStructure?.relationships.filter(
        (item) =>
          item.localToParent.length === 16 &&
          item.localToParent.every(Number.isFinite),
      ).length ?? 0,
    finiteWorldTransforms:
      hierarchyStructure?.occurrences.filter(
        (item) =>
          item.worldMatrix.length === 16 &&
          item.worldMatrix.every(Number.isFinite),
      ).length ?? 0,
    pathDepth: hierarchyOccurrence?.definitionPath.length ?? 0,
    worldTranslation: hierarchyOccurrence
      ? [
          hierarchyOccurrence.worldMatrix[3]!,
          hierarchyOccurrence.worldMatrix[7]!,
          hierarchyOccurrence.worldMatrix[11]!,
        ]
      : null,
    worldRotationDiagonal: hierarchyOccurrence
      ? [
          hierarchyOccurrence.worldMatrix[0]!,
          hierarchyOccurrence.worldMatrix[5]!,
          hierarchyOccurrence.worldMatrix[10]!,
        ]
      : null,
  },
  evidence: {
    authoritative: true,
    definitions: [{ definitionId: "leaf", bodyCount: 1 }],
    occurrenceCounts: [{ definitionId: "leaf", count: 1 }],
  },
});

const branchingStep = addBranchingFourLevelHierarchy(
  writeAssemblyAsStep({
    assemblyName: "branching_root",
    parts: [
      {
        id: "shared_leaf",
        name: "SharedLeaf",
        x0: 0,
        y0: 0,
        z0: 0,
        x1: 4,
        y1: 5,
        z1: 6,
      },
    ],
  }),
);
const branchingImported = importStepAssembly(branchingStep, {
  maxClassifyParts: 0,
});
const branchingStructure = branchingImported.productStructure;
const branchingOccurrences = branchingStructure?.occurrences ?? [];
const translations = branchingOccurrences.map((item) => [
  item.worldMatrix[3]!,
  item.worldMatrix[7]!,
  item.worldMatrix[11]!,
]);
const branchingCodes = [
  ...(branchingStructure?.relationships.length !== 5
    ? ["STEP_BRANCH_RELATIONSHIP_COUNT_MISMATCH"]
    : []),
  ...(branchingOccurrences.length !== 2
    ? ["STEP_BRANCH_OCCURRENCE_COUNT_MISMATCH"]
    : []),
  ...(branchingOccurrences.some((item) => item.definitionPath.length !== 4)
    ? ["STEP_BRANCH_PATH_DEPTH_MISMATCH"]
    : []),
  ...(new Set(branchingOccurrences.map((item) => item.definitionId)).size !== 1
    ? ["STEP_BRANCH_DEFINITION_REUSE_LOST"]
    : []),
  ...(!translations[0] ||
  Math.abs(translations[0][0]! - 10) > 1e-8 ||
  Math.abs(translations[0][1]! - 25) > 1e-8
    ? ["STEP_BRANCH_A_WORLD_TRANSFORM_MISMATCH"]
    : []),
  ...(!translations[1] ||
  Math.abs(translations[1][0]! - 15) > 1e-8 ||
  Math.abs(translations[1][1]! + 20) > 1e-8
    ? ["STEP_BRANCH_B_WORLD_TRANSFORM_MISMATCH"]
    : []),
];
results.push({
  scenarioId: "native_four_level_branching_reuse",
  status: branchingCodes.length ? "fail" : "pass",
  codes: branchingCodes,
  affectedDefinitionIds: [],
  expected: { partDefinitions: 1, occurrences: 2 },
  imported: {
    productDefinitions: branchingStructure?.definitions.length ?? 0,
    partDefinitions:
      branchingStructure?.definitions.filter((item) => !item.container)
        .length ?? 0,
    bodies:
      branchingStructure?.definitions.reduce(
        (sum, item) => sum + item.bodyCount,
        0,
      ) ?? 0,
    occurrences: branchingOccurrences.length,
    relationships: branchingStructure?.relationships.length ?? 0,
    finiteLocalTransforms:
      branchingStructure?.relationships.filter(
        (item) =>
          item.localToParent.length === 16 &&
          item.localToParent.every(Number.isFinite),
      ).length ?? 0,
    finiteWorldTransforms: branchingOccurrences.filter(
      (item) =>
        item.worldMatrix.length === 16 &&
        item.worldMatrix.every(Number.isFinite),
    ).length,
    pathDepth: Math.min(
      ...branchingOccurrences.map((item) => item.definitionPath.length),
    ),
    reusedDefinitionCount: new Set(
      branchingOccurrences.map((item) => item.definitionId),
    ).size,
    worldTranslations: translations,
  },
  evidence: {
    authoritative: true,
    definitions: [{ definitionId: "shared_leaf", bodyCount: 1 }],
    occurrenceCounts: [{ definitionId: "shared_leaf", count: 2 }],
  },
});

const artifact = {
  schema: "nexyfab.step-body-membership-campaign.v1",
  generatedAt: new Date().toISOString(),
  scope:
    "Four calibrated SCAD assemblies plus native multi-body and three-level hierarchy fixtures; not a general complex-product accuracy claim.",
  inputs: {
    bridge: path
      .relative(process.cwd(), path.resolve(bridgeArg))
      .replaceAll("\\", "/"),
    nativeStep: path
      .relative(process.cwd(), path.resolve(stepArg))
      .replaceAll("\\", "/"),
  },
  summary: {
    scenarios: results.length,
    pass: results.filter((item) => item.status === "pass").length,
    fail: results.filter((item) => item.status === "fail").length,
    notRun: results.filter((item) => item.status === "not_run").length,
  },
  results,
};
const output = path.resolve(outputArg);
fs.mkdirSync(path.dirname(output), { recursive: true });
const fixtureDir = path.join(path.dirname(output), "fixtures");
fs.mkdirSync(fixtureDir, { recursive: true });
fs.writeFileSync(
  path.join(fixtureDir, "native-multibody-weldment.step"),
  multiBodyStep,
  "utf8",
);
fs.writeFileSync(
  path.join(fixtureDir, "native-three-level-hierarchy.step"),
  hierarchicalStep,
  "utf8",
);
fs.writeFileSync(
  path.join(fixtureDir, "native-four-level-branching-reuse.step"),
  branchingStep,
  "utf8",
);
fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: outputArg, ...artifact.summary }));
if (artifact.summary.fail || artifact.summary.notRun) process.exitCode = 1;
