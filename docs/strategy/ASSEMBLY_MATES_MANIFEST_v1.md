# Assembly Mates Manifest — schema v1

**파일:** `<asmName>.mates.json` (Assembly export zip 안)
**Schema id:** `nexyfab.assemblyMates.v1`
**Status:** stable v1 (2026-05-29)
**Source of truth:** `src/app/[lang]/shape-generator/assembly/AssemblyMates.ts`
**Producer:** `AssemblyExportBridge.resolveAssemblyMatesJson` (`?assembly-export=v1` flag)

NexyFab의 Assembly export zip 패키지에 동봉되는 manifest의 schema 정의. real AP242 KINEMATIC_PAIR 대신 vendor CAM이 parsing하기 쉬운 JSON 형식. 같은 zip의 `<asmName>.step` (3D NAUO geometry) + `<asmName>.svg` (multi-view drawing) 와 함께 본다.

---

## 1. 왜 JSON manifest인가 (vs real STEP KINEMATIC_PAIR)

| 항목 | AP242 KINEMATIC_PAIR | nexyfab JSON manifest |
|---|---|---|
| Spec 복잡도 | KINEMATIC PROPAGATION schema 전체 (수십 entity 타입) | 한 schema, < 100 lines |
| Onshape import | 부분 (single revolute만) | 직접 read 가능 |
| Fusion 360 import | 미지원 (대부분 무시) | 직접 read 가능 |
| SolidWorks import | 부분 (basic mate만) | 직접 read 가능 |
| Mastercam parsing | 미지원 | JSON 파서로 trivial |
| 휴먼 readable | 거의 불가 | yes |

→ Phase 6a는 "어디서나 import할 수 있는 JSON 매니페스트" 우선. v2에서 KINEMATIC_PAIR 평행 export를 검토 (수요 있을 때).

---

## 2. Schema (필드별 정의)

### 2.1 Top-level

```json
{
  "schema": "nexyfab.assemblyMates.v1",
  "partName": "bracket-assembly",
  "generatedAt": "2026-05-29T14:32:00.000Z",
  "mates": [ … ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `schema` | `"nexyfab.assemblyMates.v1"` | Yes | Stable schema id. v2 ships as `nexyfab.assemblyMates.v2`. Consumers should match against this string before parsing `mates[]`. |
| `partName` | string | Yes | Authoring tool's assembly name. Same as the zip's filename root (without extension). Useful when multiple manifests get extracted to the same folder. |
| `generatedAt` | ISO 8601 string | Yes | Export wall-clock time. Helps vendors trace which authoring session a constraint set came from. |
| `mates` | `AssemblyMate[]` | Yes (may be `[]`) | Constraint entries — see §2.2. |

### 2.2 `AssemblyMate` (each entry in `mates[]`)

```json
{
  "id": "m_abc123",
  "type": "concentric",
  "partA": "p_bracket",
  "partB": "p_bolt",
  "faceA": 3,
  "faceB": 0,
  "value": null,
  "locked": false
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Stable mate id (unique within this assembly). |
| `type` | one of `coincident`, `concentric`, `distance`, `angle`, `parallel`, `perpendicular`, `tangent`, `hinge`, `slider`, `gear` | Yes | Constraint kind. See §3 for per-type semantics. |
| `partA` | string | Yes | First constrained part id. Matches the `id` field of an entry under the corresponding NAUO in `<asmName>.step` (and the `id` of a placed-part in the authoring tool). |
| `partB` | string | Yes | Second constrained part id. |
| `faceA` | number (integer) | Optional | Triangle / face index on partA. Refers to the part's MESH (the geometry exported in the per-part STEP body). Vendors needing a B-Rep face index should re-import the part STEP and pick the corresponding face by spatial proximity. |
| `faceB` | number (integer) | Optional | Same, on partB. |
| `value` | number \| null | Optional | Numeric parameter for the mate (distance in mm, angle in degrees). Null when the mate type doesn't carry a value (e.g. `coincident`, `parallel`). |
| `locked` | boolean | Yes | True iff the user pinned the mate as immovable (won't be re-solved by the solver). |

---

## 3. Mate types — semantics

| `type` | Carries `value`? | Geometric meaning |
|---|---|---|
| `coincident` | No | The two referenced faces share a plane. The faces' centroids coincide and their normals align (or anti-align — solver picks). |
| `concentric` | No | The two referenced faces share an axis. Used for shaft-in-hole, pin-in-bore. The face normals define the axis direction; the centroid distances must be zero on the perpendicular plane. |
| `distance` | Yes (mm) | Offset between two faces along the average face normal. Sign convention: positive `value` separates A from B along A's normal. |
| `angle` | Yes (degrees) | Angle between the two faces' normals. Sign convention: right-hand rule around the cross product. |
| `parallel` | No | Faces' normals are parallel (or anti-parallel). |
| `perpendicular` | No | Faces' normals are at 90°. |
| `tangent` | No | One face (typically curved) touches the other (typically planar) at exactly one line/point. |
| `hinge` | No | Single rotational degree of freedom along the referenced axis (combines `concentric` + `coincident`). |
| `slider` | No | Single translational degree of freedom along the referenced axis (combines `coincident` + `parallel`). |
| `gear` | Yes (ratio) | Coupled rotation of two `hinge` axes. `value` is the gear ratio (positive = same direction, negative = opposite). |

NexyFab's solver supports the first four types fully; the rest are accepted at authoring time but the mate JSON exports them verbatim — downstream consumers re-solve them in their own kinematic stack.

---

## 4. Sample manifest (3 placedParts + 2 mates)

A bracket holding a bolt that pierces a plate:

```json
{
  "schema": "nexyfab.assemblyMates.v1",
  "partName": "bracket_assembly",
  "generatedAt": "2026-05-29T14:32:00.000Z",
  "mates": [
    {
      "id": "m_pin_in_hole",
      "type": "concentric",
      "partA": "p_bracket",
      "partB": "p_bolt",
      "faceA": 12,
      "faceB": 0,
      "value": null,
      "locked": false
    },
    {
      "id": "m_plate_on_bracket",
      "type": "distance",
      "partA": "p_bracket",
      "partB": "p_plate",
      "faceA": 4,
      "faceB": 2,
      "value": 5,
      "locked": true
    }
  ]
}
```

Reading: bolt is concentric to a hole in the bracket (so it can rotate but not slide off-axis), plate is held 5 mm above the bracket's top face and locked (won't be re-solved).

---

## 5. Vendor parsing recipes

### 5.1 Fusion 360 (Python add-in)

```python
import json, adsk.core, adsk.fusion
def import_mates(path: str, occurrences_by_part_id: dict[str, adsk.fusion.Occurrence]):
    with open(path) as f:
        manifest = json.load(f)
    assert manifest['schema'] == 'nexyfab.assemblyMates.v1'
    for m in manifest['mates']:
        occA = occurrences_by_part_id.get(m['partA'])
        occB = occurrences_by_part_id.get(m['partB'])
        if not (occA and occB): continue
        # Map type → Fusion JointType, then add via the joints API
        if m['type'] == 'concentric':
            # Fusion's Revolute joint with axis collinear is the closest equivalent
            ...
```

### 5.2 SolidWorks (VBA)

```vb
Dim mates As String : mates = ReadFile(asmName & ".mates.json")
Dim manifest As Object : Set manifest = JsonConverter.ParseJson(mates)
If manifest("schema") = "nexyfab.assemblyMates.v1" Then
    For Each m In manifest("mates")
        ' Map m("type") → SwConst.swMateTypes (Coincident / Concentric / Distance / ...)
        ' Use partA / partB to locate the components in swAssembly
    Next
End If
```

### 5.3 Onshape (FeatureScript)

Onshape's mate API is closer 1:1 to this schema. `MateConnector`s on the two parts can be derived from `faceA` / `faceB` triangle indices by re-finding the face from the imported STEP and reading the connector at the centroid.

### 5.4 Generic CAM (postprocessor)

CAMs typically don't need mates beyond knowing which parts are fixed (`locked: true`) for fixture setup. Filter to locked mates and surface the count + part pairs in the operator-facing summary.

---

## 6. v1 한계 + roadmap

| 한계 | Workaround | v2 plan |
|---|---|---|
| `faceA` / `faceB` are triangle indices, not B-Rep face ids | Re-import per-part STEP, find face by centroid proximity | Add `brepFaceA` / `brepFaceB` once per-part STEP carries stable face ids (Phase 4 OCCT path) |
| No solver state snapshot — vendor must re-solve | Use `locked` mates as fixed-frame seeds | Optional `solvedTransforms` field with the host's last solver output |
| Single assembly per zip | Multiple assemblies → multiple zips | Multi-asm bundle in `nexyfab.assemblyBundle.v2` (folder per asm) |
| No gear / cam mate solver | Authoring-only — consumer must implement | NexyFab solver adds these in Phase 6c |

---

## 7. Cross-references

- `src/app/[lang]/shape-generator/assembly/AssemblyMates.ts` — `AssemblyMate` source type
- `src/app/[lang]/shape-generator/io/AssemblyExportBridge.tsx` `resolveAssemblyMatesJson` prop
- `src/app/[lang]/shape-generator/ShapeGeneratorInner.tsx` (`?assembly-export=v1`) host wire that serializes `assemblyMates` state to this format
- `docs/strategy/M1_STEP_CUSTOMER_LIMITS.md` — STEP export overall caveats
- `docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md` §Phase D후속 — vendor handoff deliverable scope
