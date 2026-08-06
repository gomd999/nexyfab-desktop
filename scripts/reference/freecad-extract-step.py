import json
import os
import sys

import FreeCAD as App
import Import

source = os.environ.get("NEXYFAB_FREECAD_SOURCE")
output = os.environ.get("NEXYFAB_FREECAD_OUTPUT")
case_id = os.environ.get("NEXYFAB_FREECAD_CASE_ID")
source_hash = os.environ.get("NEXYFAB_FREECAD_SOURCE_HASH")
if not all([source, output, case_id, source_hash]):
    raise RuntimeError("freecad_extraction_environment_missing")

document = App.newDocument("NexyfabExtraction")
try:
    Import.insert(source, document.Name)
    document.recompute()
    candidates = [obj for obj in document.Objects if hasattr(obj, "Placement") and (hasattr(obj, "Shape") or hasattr(obj, "Group"))]
    relevant_names = {obj.Name for obj in candidates if hasattr(obj, "Shape") and not obj.Shape.isNull() and len(obj.Shape.Solids) > 0}
    changed = True
    while changed:
        changed = False
        for obj in candidates:
            if obj.Name not in relevant_names and any(child.Name in relevant_names for child in list(getattr(obj, "Group", []))):
                relevant_names.add(obj.Name)
                changed = True
    objects = [obj for obj in candidates if obj.Name in relevant_names]
    included = {obj.Name: obj for obj in objects}
    definitions = [{"id": "freecad-root-definition", "name": os.path.basename(source), "kind": "assembly"}]
    occurrences = [{"id": "freecad-root", "definitionId": "freecad-root-definition", "parentOccurrenceId": None, "localToParent": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], "suppressed": False}]

    def matrix_values(placement):
        matrix = placement.toMatrix()
        return [float(getattr(matrix, "A%d%d" % (row, col))) for row in range(1, 5) for col in range(1, 5)]

    for obj in objects:
        group = list(getattr(obj, "Group", []))
        has_shape = hasattr(obj, "Shape") and not obj.Shape.isNull()
        solid_count = len(obj.Shape.Solids) if has_shape else 0
        if not group and solid_count < 1:
            continue
        definition_id = "freecad-definition:" + obj.Name
        occurrence_id = "freecad-occurrence:" + obj.Name
        definition = {"id": definition_id, "name": str(obj.Label or obj.Name), "kind": "assembly" if group else "part"}
        if not group:
            definition["bodyCount"] = solid_count
            definition["bodyCountSource"] = "native_shape_solids"
        definitions.append(definition)
        parents = [parent for parent in getattr(obj, "InList", []) if parent.Name in included and hasattr(parent, "Group") and obj in list(getattr(parent, "Group", []))]
        parent_id = "freecad-occurrence:" + parents[0].Name if parents else "freecad-root"
        occurrences.append({"id": occurrence_id, "definitionId": definition_id, "parentOccurrenceId": parent_id, "localToParent": matrix_values(obj.Placement), "suppressed": False})

    result = {"schema": "nexyfab.freecad-native-document-extraction-raw.v1", "caseId": case_id, "sourceHash": source_hash, "freecadVersion": App.Version()[0] + "." + App.Version()[1] + "." + App.Version()[2], "units": {"length": "mm", "angle": "deg"}, "definitions": definitions, "occurrences": occurrences, "joints": [], "jointSemanticsComplete": False}
    with open(output, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(result, handle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        handle.write("\n")
finally:
    App.closeDocument(document.Name)
