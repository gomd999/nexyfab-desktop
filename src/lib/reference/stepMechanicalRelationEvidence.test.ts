import { describe, expect, it } from "vitest";
import { analyzeStepMechanicalRelations } from "./stepMechanicalRelationEvidence";

const header =
    "ISO-10303-21;HEADER;FILE_DESCRIPTION(('x'),'2;1');FILE_NAME('x','',(''),(''),'','','');FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));ENDSEC;DATA;",
  footer = "ENDSEC;END-ISO-10303-21;";
const part = (base: number, name: string, x: number) =>
  `#${base}=PRODUCT('${name}','${name}',$,(#${base + 1}));#${base + 1}=PRODUCT_CONTEXT('',#900,'mechanical');#${base + 2}=PRODUCT_DEFINITION_FORMATION('','',#${base});#${base + 3}=PRODUCT_DEFINITION('','',#${base + 2},#901);#${base + 4}=PRODUCT_DEFINITION_SHAPE('','',#${base + 3});#${base + 5}=SHAPE_DEFINITION_REPRESENTATION(#${base + 4},#${base + 6});#${base + 6}=SHAPE_REPRESENTATION('',(#${base + 7}),#902);#${base + 7}=MANIFOLD_SOLID_BREP('',#${base + 8});#${base + 8}=CLOSED_SHELL('',(#${base + 9}));#${base + 9}=ADVANCED_FACE('',(),#${base + 10},.T.);#${base + 10}=CYLINDRICAL_SURFACE('',#${base + 11},5.);#${base + 11}=AXIS2_PLACEMENT_3D('',#${base + 12},#${base + 13},#${base + 14});#${base + 12}=CARTESIAN_POINT('',(${x},0.,0.));#${base + 13}=DIRECTION('',(0.,0.,1.));#${base + 14}=DIRECTION('',(1.,0.,0.));`;
describe("STEP mechanical relation evidence", () => {
  it("proves axes only across distinct coaxial parts", () => {
    const source =
      header +
      "#900=APPLICATION_CONTEXT('');#901=PRODUCT_DEFINITION_CONTEXT('part',#900,'design');#902=GEOMETRIC_REPRESENTATION_CONTEXT(3);" +
      part(10, "shaft", 0) +
      part(40, "bearing", 0) +
      footer;
    const result = analyzeStepMechanicalRelations(source);
    expect(result.axes).toHaveLength(2);
    expect(result.coaxialPairs).toHaveLength(1);
    expect(result.shaftBearingPairs).toHaveLength(1);
    expect(result.coaxialPairs[0]).toMatchObject({
      axisDistance: 0,
      angularErrorRad: 0,
    });
  });
  it("does not invent concentricity for offset axes", () => {
    const source =
      header +
      "#900=APPLICATION_CONTEXT('');#901=PRODUCT_DEFINITION_CONTEXT('part',#900,'design');#902=GEOMETRIC_REPRESENTATION_CONTEXT(3);" +
      part(10, "shaft", 0) +
      part(40, "bearing", 2) +
      footer;
    expect(analyzeStepMechanicalRelations(source).coaxialPairs).toEqual([]);
  });
});
