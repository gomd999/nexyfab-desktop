import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildIfcAlignmentIr,
  buildIfcStructuralIr,
  evaluateIfcAlignmentStation,
} from "./ifcDomainIr";

describe("IFC specialized domain IR", () => {
  it("builds governed alignment design segments and georeference evidence", () => {
    const source = `ISO-10303-21;HEADER;FILE_SCHEMA(('IFC4X3_ADD2'));ENDSEC;DATA;#1=IFCALIGNMENT('0DAlDmbNb6ZhcaPbmdsMGX',$,$,$,$,$,$,$);#9=IFCCARTESIANPOINT((0.,0.));#2=IFCALIGNMENTHORIZONTALSEGMENT($,$,#9,0.,300.,1000.,100.,$,.COSINECURVE.);#3=IFCPROJECTEDCRS('EPSG:5179',$,$,$,$,$,$);#4=IFCMAPCONVERSION(#8,#3,0.,0.,0.,$,$,$);ENDSEC;END-ISO-10303-21;`;
    expect(buildIfcAlignmentIr(source)).toMatchObject({
      valid: true,
      georeferenced: true,
      horizontal: [
        {
          startDistance: 0,
          length: 100,
          predefinedType: "COSINECURVE",
          startPoint: [0, 0],
          evaluation: "curvature_rk4",
          endPoint: expect.any(Array),
        },
      ],
      continuity: { horizontal: true, vertical: true, cant: true },
    });
  });
  it("accounts for inherited StartTag/EndTag fields in vertical and cant segments", () => {
    const source = `#1=IFCALIGNMENT('0DAlDmbNb6ZhcaPbmdsMGX',$,$,$,$,$,$,$);#2=IFCALIGNMENTVERTICALSEGMENT($,$,0.,100.,5.,0.01,0.02,$,.CONSTANTGRADIENT.);#3=IFCALIGNMENTCANTSEGMENT($,$,0.,100.,0.,0.,0.16,0.,.COSINECURVE.);`;
    expect(buildIfcAlignmentIr(source)).toMatchObject({
      valid: true,
      vertical: [
        {
          startDistance: 0,
          horizontalLength: 100,
          startHeight: 5,
          startGradient: 0.01,
          endGradient: 0.02,
        },
      ],
      cant: [{ startDistance: 0, horizontalLength: 100, endCantLeft: 0.16 }],
    });
  });
  it("fails closed on a vertical station gap", () => {
    const source = `#1=IFCALIGNMENT('0DAlDmbNb6ZhcaPbmdsMGX',$,$,$,$,$,$,$);#2=IFCALIGNMENTVERTICALSEGMENT($,$,0.,100.,0.,0.,0.,$,.CONSTANTGRADIENT.);#3=IFCALIGNMENTVERTICALSEGMENT($,$,101.,10.,0.,0.,0.,$,.CONSTANTGRADIENT.);`;
    const result = buildIfcAlignmentIr(source);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("vertical_station_discontinuity");
  });
  it("fails closed for an alignment without design segments", () => {
    expect(
      buildIfcAlignmentIr(
        "#1=IFCALIGNMENT('0DAlDmbNb6ZhcaPbmdsMGX',$,$,$,$,$,$,$);",
      ),
    ).toMatchObject({ valid: false, errors: ["alignment_segments_missing"] });
  });
  it("evaluates exact horizontal line and circular-arc endpoints", () => {
    const line = buildIfcAlignmentIr(
      "#1=IFCALIGNMENT('0DAlDmbNb6ZhcaPbmdsMGX',$,$,$,$,$,$,$);#2=IFCCARTESIANPOINT((10.,20.));#3=IFCALIGNMENTHORIZONTALSEGMENT($,$,#2,0.,0.,0.,5.,$,.LINE.);",
    );
    expect(line.horizontal[0]).toMatchObject({
      endPoint: [15, 20],
      endDirectionRad: 0,
      evaluation: "analytic",
    });
    const arc = buildIfcAlignmentIr(
      "#1=IFCALIGNMENT('0DAlDmbNb6ZhcaPbmdsMGX',$,$,$,$,$,$,$);#2=IFCCARTESIANPOINT((0.,0.));#3=IFCALIGNMENTHORIZONTALSEGMENT($,$,#2,0.,10.,10.,15.707963267948966,$,.CIRCULARARC.);",
    );
    expect(arc.horizontal[0]!.endPoint![0]).toBeCloseTo(10, 8);
    expect(arc.horizontal[0]!.endPoint![1]).toBeCloseTo(10, 8);
    expect(arc.horizontal[0]!.endDirectionRad).toBeCloseTo(Math.PI / 2, 8);
  });
  it("evaluates governed cubic line-to-arc geometry at endpoints and stations", () => {
    const source =
        "#1=IFCALIGNMENT('0DAlDmbNb6ZhcaPbmdsMGX',$,$,$,$,$,$,$);#2=IFCCARTESIANPOINT((0.,0.));#3=IFCALIGNMENTHORIZONTALSEGMENT($,$,#2,0.,0.,500.,100.,$,.CUBIC.);",
      result = buildIfcAlignmentIr(source),
      at50 = evaluateIfcAlignmentStation(result, 50)!;
    expect(result).toMatchObject({
      valid: true,
      horizontal: [
        {
          evaluation: "cubic_arc_length",
          evaluationReason: null,
          requiredInputs: [],
          endPoint: expect.any(Array),
        },
      ],
    });
    expect(Math.hypot(at50.point[0], at50.point[1])).toBeGreaterThan(49);
    expect(at50.horizontalDirectionRad).toBeGreaterThan(0);
    expect(at50.horizontalDirectionRad).toBeLessThan(
      result.horizontal[0]!.endDirectionRad!,
    );
  });
  it("keeps cubic fail-closed when neither endpoint is a line", () => {
    const result = buildIfcAlignmentIr(
      "#1=IFCALIGNMENT('0DAlDmbNb6ZhcaPbmdsMGX',$,$,$,$,$,$,$);#2=IFCCARTESIANPOINT((0.,0.));#3=IFCALIGNMENTHORIZONTALSEGMENT($,$,#2,0.,1000.,500.,100.,$,.CUBIC.);",
    );
    expect(result.horizontal[0]).toMatchObject({
      evaluation: "not_run",
      evaluationReason: "cubic_requires_one_infinite_radius",
      requiredInputs: ["one_zero_curvature_endpoint"],
    });
  });
  it("preserves signed curvature for cubic arc-to-line traversal", () => {
    const source =
      "#1=IFCALIGNMENT('g',$,$,$,$,$,$,$);#2=IFCCARTESIANPOINT((0.,0.));#3=IFCALIGNMENTHORIZONTALSEGMENT($,$,#2,0.,500.,0.,100.,$,.CUBIC.);";
    const result = buildIfcAlignmentIr(source),
      at50 = evaluateIfcAlignmentStation(result, 50)!;
    expect(result.horizontal[0]).toMatchObject({
      evaluation: "cubic_arc_length",
    });
    expect(at50.horizontalDirectionRad).toBeGreaterThan(0);
    expect(at50.horizontalDirectionRad).toBeLessThan(
      result.horizontal[0]!.endDirectionRad!,
    );
  });
  it("requires authoritative Viennese inputs and evaluates the matched cant segment when complete", () => {
    const source =
        "#1=IFCALIGNMENT('0DAlDmbNb6ZhcaPbmdsMGX',$,$,$,$,$,$,$);#2=IFCCARTESIANPOINT((0.,0.));#3=IFCALIGNMENTHORIZONTALSEGMENT($,$,#2,0.,0.,500.,100.,$,.VIENNESEBEND.);#4=IFCALIGNMENTCANT('cant',$,$,$,$,$,$,1.5);#5=IFCALIGNMENTCANTSEGMENT($,$,0.,100.,0.,0.,0.15,0.,.VIENNESEBEND.);",
      missing = buildIfcAlignmentIr(source);
    expect(missing.horizontal[0]).toMatchObject({
      evaluation: "not_run",
      evaluationReason: "viennese_authoritative_input_missing",
      requiredInputs: [
        "matchingCantSegment",
        "railHeadDistance",
        "gravityCenterHeight",
        "gravityCenterHeightProvenance",
      ],
    });
    const result = buildIfcAlignmentIr(source, {
        vienneseBendInputs: {
          3: {
            gravityCenterHeight: 1.2,
            provenance: "rail-design-authority:test",
          },
        },
      }),
      at50 = evaluateIfcAlignmentStation(result, 50)!;
    expect(result.horizontal[0]).toMatchObject({
      evaluation: "curvature_rk4",
      evaluationReason: null,
      vienneseBend: {
        cantSegmentEntityId: 5,
        railHeadDistance: 1.5,
        gravityCenterHeight: 1.2,
        gravityCenterHeightProvenance: "rail-design-authority:test",
      },
    });
    expect(result.valid).toBe(true);
    expect(at50.horizontalDirectionRad).toBeGreaterThan(0);
  });
  it("evaluates elevation and gradient on a vertical circular arc from horizontal station", () => {
    const source =
        "#1=IFCALIGNMENT('0DAlDmbNb6ZhcaPbmdsMGX',$,$,$,$,$,$,$);#2=IFCCARTESIANPOINT((0.,0.));#3=IFCALIGNMENTHORIZONTALSEGMENT($,$,#2,0.,0.,0.,100.,$,.LINE.);#4=IFCALIGNMENTVERTICALSEGMENT($,$,0.,100.,5.,0.,0.0100005000375,10000.,.CIRCULARARC.);",
      ir = buildIfcAlignmentIr(source),
      at50 = evaluateIfcAlignmentStation(ir, 50)!;
    expect(at50.point[2]).toBeCloseTo(0.125000781 + 5, 5);
    expect(at50.gradient).toBeCloseTo(0.0050000625, 7);
  });
  it("extracts structural node/member geometry and connectivity", () => {
    const source = `ISO-10303-21;HEADER;FILE_SCHEMA(('IFC4'));ENDSEC;DATA;#1=IFCSTRUCTURALANALYSISMODEL('0DAlDmbNb6ZhcaPbmdsMGX',$,$,$,$,$,$,$,$,$);
#2=IFCCARTESIANPOINT((0.,0.,0.));#3=IFCVERTEXPOINT(#2);#4=IFCTOPOLOGYREPRESENTATION($,$,$,(#3));#5=IFCPRODUCTDEFINITIONSHAPE($,$,(#4));#6=IFCSTRUCTURALPOINTCONNECTION('1DAlDmbNb6ZhcaPbmdsMGX',$,'A',$,$,$,#5,$,$);
#7=IFCCARTESIANPOINT((0.,0.,10.));#8=IFCVERTEXPOINT(#7);#9=IFCTOPOLOGYREPRESENTATION($,$,$,(#8));#10=IFCPRODUCTDEFINITIONSHAPE($,$,(#9));#11=IFCSTRUCTURALPOINTCONNECTION('2DAlDmbNb6ZhcaPbmdsMGX',$,'B',$,$,$,#10,$,$);
#12=IFCEDGE(#3,#8);#13=IFCTOPOLOGYREPRESENTATION($,$,$,(#12));#14=IFCPRODUCTDEFINITIONSHAPE($,$,(#13));#15=IFCSTRUCTURALCURVEMEMBER('3DAlDmbNb6ZhcaPbmdsMGX',$,'M',$,$,$,#14,$,$);#16=IFCRELCONNECTSSTRUCTURALMEMBER('0EAlDmbNb6ZhcaPbmdsMGX',$,$,$,#15,#6,$,$,$,$);#17=IFCRELCONNECTSSTRUCTURALMEMBER('0FAlDmbNb6ZhcaPbmdsMGX',$,$,$,#15,#11,$,$,$,$);
#20=IFCSIUNIT(*,.FORCEUNIT.,$,.NEWTON.);#21=IFCMEASUREWITHUNIT(IFCFORCEMEASURE(4.44822162),#20);#22=IFCDIMENSIONALEXPONENTS(1,1,-2,0,0,0,0);#23=IFCCONVERSIONBASEDUNIT(#22,.FORCEUNIT.,'pound-force',#21);
#24=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);#25=IFCMEASUREWITHUNIT(IFCLENGTHMEASURE(0.0254),#24);#26=IFCDIMENSIONALEXPONENTS(1,0,0,0,0,0,0);#27=IFCCONVERSIONBASEDUNIT(#26,.LENGTHUNIT.,'inch',#25);#28=IFCUNITASSIGNMENT((#23,#27));
#29=IFCSTRUCTURALLOADSINGLEFORCE('Load',10.,0.,$,$,20.,$);ENDSEC;END-ISO-10303-21;`;
    const result = buildIfcStructuralIr(source);
    expect(result).toMatchObject({
      valid: true,
      nodes: [{ point: [0, 0, 0] }, { point: [0, 0, 10] }],
      members: [{ connectedNodeIds: [6, 11] }],
      normalizedLoads: [
        {
          entityId: 29,
          normalized: true,
          canonicalUnits: ["N", "N", "N", "N·m", "N·m", "N·m"],
        },
      ],
    });
    expect(result.normalizedLoads[0]?.values[0]).toBeCloseTo(44.4822162, 7);
    expect(result.normalizedLoads[0]?.values[4]).toBeCloseTo(2.259696583, 8);
  });
  it("fails closed when a present structural load has no assigned unit", () => {
    const result = buildIfcStructuralIr(
      "#1=IFCSTRUCTURALANALYSISMODEL('0DAlDmbNb6ZhcaPbmdsMGX',$,$,$,$,$,$,$,$,$);#2=IFCSTRUCTURALLOADSINGLEFORCE('L',1.,$,$,$,$,$);",
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("structural_load_unit_unresolved");
    expect(result.normalizedLoads[0]?.normalized).toBe(false);
  });
  it("normalizes every IFC4 static numeric load subtype with explicit dimensional coverage", () => {
    const source = `#1=IFCSTRUCTURALANALYSISMODEL('0DAlDmbNb6ZhcaPbmdsMGX',$,$,$,$,$,$,$,$,$);
#10=IFCSIUNIT(*,.FORCEUNIT.,.KILO.,.NEWTON.);#11=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);#12=IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);#13=IFCSIUNIT(*,.THERMODYNAMICTEMPERATUREUNIT.,$,.KELVIN.);#14=IFCUNITASSIGNMENT((#10,#11,#12,#13));
#20=IFCSTRUCTURALLOADPLANARFORCE('P',2.,$,$);#21=IFCSTRUCTURALLOADSINGLEDISPLACEMENTDISTORTION('D',1.,$,$,$,$,$,0.5);#22=IFCSTRUCTURALLOADSINGLEFORCEWARPING('W',1.,$,$,$,$,$,3.);#23=IFCSTRUCTURALLOADTEMPERATURE('T',5.,$,$);`;
    const result = buildIfcStructuralIr(source);
    expect(result.errors).not.toContain("structural_load_type_unsupported");
    expect(result.loadCoverage).toEqual({
      numericEntities: 4,
      normalized: 4,
      unitUnresolved: 0,
      unsupported: 0,
    });
    expect(
      result.normalizedLoads.find((load) => load.entityId === 20)?.values[0],
    ).toBeCloseTo(2e9);
    expect(
      result.normalizedLoads.find((load) => load.entityId === 21)?.values[6],
    ).toBeCloseTo(500);
    expect(
      result.normalizedLoads.find((load) => load.entityId === 22)?.values[6],
    ).toBeCloseTo(0.003);
    expect(
      result.normalizedLoads.find((load) => load.entityId === 23)?.values[0],
    ).toBe(5);
  });
  it("fails closed and identifies an unknown numeric structural load instead of silently omitting it", () => {
    const result = buildIfcStructuralIr(
      "#1=IFCSTRUCTURALANALYSISMODEL('0DAlDmbNb6ZhcaPbmdsMGX',$,$,$,$,$,$,$,$,$);#2=IFCSTRUCTURALLOADFUTURETYPE('X',1.);",
    );
    expect(result).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["structural_load_type_unsupported"]),
      unsupportedLoadEntities: [
        { entityId: 2, ifcClass: "IFCSTRUCTURALLOADFUTURETYPE" },
      ],
      loadCoverage: { unsupported: 1 },
    });
  });
});
