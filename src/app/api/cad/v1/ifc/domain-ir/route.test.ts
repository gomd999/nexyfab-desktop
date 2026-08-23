import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST } from "./route";
const request = (body: unknown) =>
  new NextRequest("http://localhost/api/cad/v1/ifc/domain-ir", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
describe("IFC specialized domain IR route", () => {
  it("returns alignment IR without source echo", async () => {
    const source = `#1=IFCALIGNMENT('0DAlDmbNb6ZhcaPbmdsMGX',$,$,$,$,$,$,$);#9=IFCCARTESIANPOINT((0.,0.));#2=IFCALIGNMENTHORIZONTALSEGMENT($,$,#9,0.,0.,0.,100.,$,.LINE.);`;
    const response = await POST(request({ ifc: source, domain: "alignment" }));
    const json = await response.json();
    expect(json).toMatchObject({
      ok: true,
      verificationPassed: true,
      releaseReady: false,
      ir: {
        kind: "alignment",
        horizontal: [{ endPoint: [100, 0], evaluation: "analytic" }],
      },
      sourceReturned: false,
    });
    expect(JSON.stringify(json)).not.toContain("#1=");
  });
  it("fails closed for missing structural members", async () => {
    const response = await POST(
      request({
        ifc: "#1=IFCSTRUCTURALANALYSISMODEL('0DAlDmbNb6ZhcaPbmdsMGX',$,$,$,$,$,$,$,$,$);",
        domain: "structural-analysis",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      releaseReady: false,
      ir: { valid: false },
    });
  });
  it("rejects paths and undeclared fields", async () => {
    expect(
      (
        await POST(
          request({ ifc: "x", domain: "alignment", path: "C:\\x.ifc" }),
        )
      ).status,
    ).toBe(400);
  });
  it("validates and applies provenance-bearing Viennese inputs", async () => {
    const source =
      "#1=IFCALIGNMENT('g',$,$,$,$,$,$,$);#2=IFCCARTESIANPOINT((0.,0.));#3=IFCALIGNMENTHORIZONTALSEGMENT($,$,#2,0.,0.,500.,100.,$,.VIENNESEBEND.);#4=IFCALIGNMENTCANT('c',$,$,$,$,$,$,1.5);#5=IFCALIGNMENTCANTSEGMENT($,$,0.,100.,0.,0.,0.15,0.,.VIENNESEBEND.);";
    expect(
      (
        await POST(
          request({
            ifc: source,
            domain: "alignment",
            vienneseBendInputs: {
              3: { gravityCenterHeight: -1, provenance: "x" },
            },
          }),
        )
      ).status,
    ).toBe(400);
    const json = await (
      await POST(
        request({
          ifc: source,
          domain: "alignment",
          vienneseBendInputs: {
            3: { gravityCenterHeight: 1.2, provenance: "drawing A-7" },
          },
        }),
      )
    ).json();
    expect(json).toMatchObject({
      ok: true,
      verificationPassed: true,
      releaseReady: false,
      ir: {
        horizontal: [
          {
            evaluation: "curvature_rk4",
            vienneseBend: { gravityCenterHeightProvenance: "drawing A-7" },
          },
        ],
      },
    });
  });
});
