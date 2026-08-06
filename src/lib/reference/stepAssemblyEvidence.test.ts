import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CAD_CORPUS_MANIFEST_V2 } from "./cadCorpusManifestV2";
import { resolveCadCorpusFixtureV2 } from "./cadCorpusManifestV2Resolver";
import {
  analyzeStepAssemblyPlacements,
  analyzeStepAssemblyStructure,
  classifyStepOccurrencePattern,
  validateStepOccurrenceMatrix,
} from "./stepAssemblyEvidence";

describe("STEP assembly structural evidence", () => {
  it("measures nesting, repeated definitions, transforms, and named roles", () => {
    const source = `ISO-10303-21;DATA;
#1=PRODUCT('root','','',()); #2=PRODUCT('shaft','','',()); #3=PRODUCT('bearing','','',());
#10=NEXT_ASSEMBLY_USAGE_OCCURRENCE('','','',#100,#101,$);
#11=NEXT_ASSEMBLY_USAGE_OCCURRENCE('','','',#101,#102,$);
#12=NEXT_ASSEMBLY_USAGE_OCCURRENCE('','','',#101,#102,$);
#20=ITEM_DEFINED_TRANSFORMATION('','',#30,#31);
ENDSEC;END-ISO-10303-21;`;
    expect(analyzeStepAssemblyStructure(source)).toEqual({
      occurrences: 3,
      maxDepth: 2,
      repeatedDefinitions: 1,
      transformedOccurrences: 1,
      shaftNamedDefinitions: 1,
      bearingNamedDefinitions: 1,
    });
  });
});

describe("STEP assembly occurrence placement evidence", () => {
  it("classifies regular linear and circular occurrence pitches and rejects irregular spacing", () => {
    expect(
      classifyStepOccurrencePattern([
        [0, 0, 0],
        [10, 0, 0],
        [20, 0, 0],
        [30, 0, 0],
      ]),
    ).toMatchObject({ status: "pass", kind: "linear", pitch: 10 });
    expect(
      classifyStepOccurrencePattern([
        [10, 0, 0],
        [0, 10, 0],
        [-10, 0, 0],
        [0, -10, 0],
      ]),
    ).toMatchObject({ status: "pass", kind: "circular", pitch: Math.PI / 2 });
    expect(
      classifyStepOccurrencePattern([
        [0, 0, 0],
        [10, 0, 0],
        [25, 0, 0],
      ]),
    ).toMatchObject({ status: "fail", kind: "linear" });
    expect(
      classifyStepOccurrencePattern([
        [0, 0, 0],
        [1, 1, 0],
        [2, 0, 0],
      ]),
    ).toMatchObject({ status: "not_run", kind: "unknown" });
  });
  it("composes deterministic local-to-parent-to-world chains", () => {
    const source = `ISO-10303-21;DATA;
#10=NEXT_ASSEMBLY_USAGE_OCCURRENCE('','','',#100,#101,$);
#11=NEXT_ASSEMBLY_USAGE_OCCURRENCE('','','',#101,#102,$);
#20=ITEM_DEFINED_TRANSFORMATION('','',#30,#31);
#21=ITEM_DEFINED_TRANSFORMATION('','',#32,#31);
#30=AXIS2_PLACEMENT_3D('',#40,#50,#51); #31=AXIS2_PLACEMENT_3D('',#41,#50,#51); #32=AXIS2_PLACEMENT_3D('',#42,#50,#51);
#40=CARTESIAN_POINT('',(10.,0.,0.)); #41=CARTESIAN_POINT('',(0.,0.,0.)); #42=CARTESIAN_POINT('',(0.,5.,0.));
#50=DIRECTION('',(0.,0.,1.)); #51=DIRECTION('',(1.,0.,0.));
#60=PRODUCT_DEFINITION_SHAPE('','',#10); #61=PRODUCT_DEFINITION_SHAPE('','',#11);
#70=REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION('','',#90,#91,#20); #71=REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION('','',#90,#91,#21);
#80=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#70,#60); #81=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#71,#61);
ENDSEC;END-ISO-10303-21;`;
    const evidence = analyzeStepAssemblyPlacements(source);
    expect(evidence).toMatchObject({
      sourceOccurrenceCount: 2,
      cycleFree: true,
      availableTransformCount: 2,
      worldPlacementCount: 2,
    });
    expect(evidence.occurrences[0]?.worldPlacement).toMatchObject({
      status: "available",
      matrix: expect.arrayContaining([10]),
    });
    const second = evidence.occurrences[1]?.worldPlacement;
    expect(second?.status).toBe("available");
    if (second?.status === "available")
      expect([second.matrix[3], second.matrix[7], second.matrix[11]]).toEqual([
        10, 5, 0,
      ]);
    expect(evidence.occurrences[1]?.parentOccurrenceId).toBe("#10");
  });

  it("does not invent identity for missing transforms and detects cycles", () => {
    const missing = analyzeStepAssemblyPlacements(
      `ISO-10303-21;DATA;#10=NEXT_ASSEMBLY_USAGE_OCCURRENCE('','','',#1,#2,$);ENDSEC;END-ISO-10303-21;`,
    );
    expect(missing).toMatchObject({
      missingTransformCount: 1,
      worldPlacementCount: 0,
      cycleFree: true,
    });
    expect(missing.occurrences[0]?.worldPlacement.status).toBe("not_run");
    const cyclic = analyzeStepAssemblyPlacements(
      `ISO-10303-21;DATA;#10=NEXT_ASSEMBLY_USAGE_OCCURRENCE('','','',#1,#2,$);#11=NEXT_ASSEMBLY_USAGE_OCCURRENCE('','','',#2,#1,$);ENDSEC;END-ISO-10303-21;`,
    );
    expect(cyclic.cycleFree).toBe(false);
    expect(
      cyclic.occurrences.every(
        (item) => item.worldPlacement.status === "not_run",
      ),
    ).toBe(true);
  });

  it("classifies singular, reflected, and non-uniform matrices", () => {
    const reflected = validateStepOccurrenceMatrix([
      -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
    expect(reflected).toMatchObject({
      valid: true,
      reflection: true,
      nonUniformScale: false,
    });
    const scaled = validateStepOccurrenceMatrix([
      2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
    expect(scaled).toMatchObject({
      valid: true,
      reflection: false,
      nonUniformScale: true,
    });
    const singular = validateStepOccurrenceMatrix([
      0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
    expect(singular.valid).toBe(false);
  });
});

const corpusRoot = process.env.NEXYFAB_CAD_CORPUS_ROOT;
describe.runIf(Boolean(corpusRoot))(
  "real B05/B07 occurrence placement audit",
  () => {
    for (const fixtureId of ["B05", "B07"] as const) {
      it(`reads ${fixtureId} without modifying the corpus or substituting body counts`, async () => {
        const fixture = CAD_CORPUS_MANIFEST_V2.fixtures.find(
          (item) => item.fixtureId === fixtureId,
        )!;
        const resolved = await resolveCadCorpusFixtureV2(corpusRoot!, fixture);
        const source = await readFile(
          path.join(corpusRoot!, resolved.relativePath),
          "utf8",
        );
        const first = analyzeStepAssemblyPlacements(source);
        const second = analyzeStepAssemblyPlacements(source);
        expect(second).toEqual(first);
        expect(first.sourceOccurrenceCount).toBe(first.occurrences.length);
        expect(
          first.availableTransformCount +
            first.missingTransformCount +
            first.invalidTransformCount,
        ).toBe(first.sourceOccurrenceCount);
        expect(first.worldPlacementCount).toBeLessThanOrEqual(
          first.sourceOccurrenceCount,
        );
      });
    }
  },
);
