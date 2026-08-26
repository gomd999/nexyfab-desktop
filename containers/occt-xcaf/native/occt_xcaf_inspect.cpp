#include <BRepBndLib.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <Interface_Static.hxx>
#include <Quantity_Color.hxx>
#include <Standard_Version.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <TDataStd_Name.hxx>
#include <TDF_ChildIterator.hxx>
#include <TDF_Label.hxx>
#include <TDF_LabelSequence.hxx>
#include <TDF_Tool.hxx>
#include <TDocStd_Document.hxx>
#include <TCollection_AsciiString.hxx>
#include <TCollection_ExtendedString.hxx>
#include <TopLoc_Location.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_ColorTool.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <openssl/evp.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_set>
#include <vector>

namespace {

constexpr std::uintmax_t kMaxInputBytes = 64U * 1024U * 1024U;
// Reserve one byte for main's trailing newline so the worker's four MiB cap
// and the native cap describe the same complete stdout boundary.
constexpr std::size_t kMaxNativeOutputBytes = (4U * 1024U * 1024U) - 1U;
// Aligned with the current canonical consumer's nested-value budget. Larger
// assemblies remain HOLD until the canonical document can be streamed/chunked.
constexpr std::size_t kMaxOccurrences = 128U;
constexpr std::size_t kMaxTopologyItems = 2000000U;
constexpr std::size_t kMaxTextBytes = 4096U;
constexpr std::size_t kMaxOccurrencePathBytes = 8192U;

#ifndef NEXYFAB_NATIVE_BUILD_ID
#define NEXYFAB_NATIVE_BUILD_ID "occt-xcaf-inspect/2-unspecified-build"
#endif

#ifndef NEXYFAB_OCCT_BUILD_ID
#define NEXYFAB_OCCT_BUILD_ID "OpenCASCADE-unspecified-build"
#endif

std::string jsonEscape(const std::string& value) {
  std::ostringstream out;
  for (const unsigned char c : value) {
    switch (c) {
      case '"': out << "\\\""; break;
      case '\\': out << "\\\\"; break;
      case '\n': out << "\\n"; break;
      case '\r': out << "\\r"; break;
      case '\t': out << "\\t"; break;
      default:
        if (c < 0x20U) out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<int>(c) << std::dec;
        else out << c;
    }
  }
  return out.str();
}

std::string checkedText(const std::string& value, const std::size_t maximum,
                        const char* errorCode) {
  if (value.size() > maximum) throw std::runtime_error(errorCode);
  return value;
}

std::string extendedToUtf8(const TCollection_ExtendedString& value) {
  std::vector<char> buffer(static_cast<std::size_t>(value.LengthOfCString()) + 1U, '\0');
  Standard_PCharacter utf8 = buffer.data();
  const Standard_Integer length = value.ToUTF8CString(utf8);
  return length <= 0 ? std::string() : std::string(buffer.data(), static_cast<std::size_t>(length));
}

std::string labelEntry(const TDF_Label& label) {
  TCollection_AsciiString entry;
  TDF_Tool::Entry(label, entry);
  return entry.ToCString();
}

std::string labelName(const TDF_Label& label) {
  Handle(TDataStd_Name) attribute;
  if (!label.FindAttribute(TDataStd_Name::GetID(), attribute) || attribute.IsNull()) return {};
  return extendedToUtf8(attribute->Get());
}

std::string sha256File(const std::filesystem::path& file) {
  std::ifstream stream(file, std::ios::binary);
  if (!stream) throw std::runtime_error("input_open_failed");
  using DigestContext = std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)>;
  DigestContext context(EVP_MD_CTX_new(), &EVP_MD_CTX_free);
  if (!context || EVP_DigestInit_ex(context.get(), EVP_sha256(), nullptr) != 1) {
    throw std::runtime_error("sha256_initialization_failed");
  }
  std::array<char, 1024 * 1024> buffer{};
  while (stream.good()) {
    stream.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
    const std::streamsize count = stream.gcount();
    if (count > 0 && EVP_DigestUpdate(context.get(), buffer.data(), static_cast<std::size_t>(count)) != 1) {
      throw std::runtime_error("sha256_update_failed");
    }
  }
  if (stream.bad()) throw std::runtime_error("input_read_failed");
  std::array<unsigned char, EVP_MAX_MD_SIZE> digest{};
  unsigned int digestLength = 0;
  if (EVP_DigestFinal_ex(context.get(), digest.data(), &digestLength) != 1 || digestLength != 32U) {
    throw std::runtime_error("sha256_finalization_failed");
  }
  std::ostringstream out;
  for (unsigned int index = 0; index < digestLength; ++index) {
    out << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(digest[index]);
  }
  return out.str();
}

struct ShapeSummary {
  std::size_t solids = 0;
  std::size_t shells = 0;
  std::size_t faces = 0;
  std::size_t edges = 0;
  std::size_t nonManifoldEdges = 0;
  double volume = 0.0;
  double surfaceArea = 0.0;
  double maxTolerance = 0.0;
  double bounds[6] = {0, 0, 0, 0, 0, 0};
  double centroid[3] = {0, 0, 0};
  double inertia[9] = {0, 0, 0, 0, 0, 0, 0, 0, 0};
  bool hasBounds = false;
  bool hasMassProperties = false;
  bool brepValid = false;
  std::string massPropertiesBasis;
};

void incrementTopologyCount(std::size_t& count) {
  if (++count > kMaxTopologyItems) throw std::runtime_error("topology_item_limit_exceeded");
}

void acceptTolerance(double& maximum, const double value) {
  if (!std::isfinite(value) || value < 0.0) throw std::runtime_error("shape_tolerance_invalid");
  maximum = std::max(maximum, value);
}

void acceptMassProperties(ShapeSummary& result, const GProp_GProps& properties,
                          const std::string& basis) {
  const gp_Pnt center = properties.CentreOfMass();
  const gp_Mat inertia = properties.MatrixOfInertia();
  result.centroid[0] = center.X();
  result.centroid[1] = center.Y();
  result.centroid[2] = center.Z();
  for (int row = 1; row <= 3; ++row) {
    for (int column = 1; column <= 3; ++column) {
      result.inertia[(row - 1) * 3 + (column - 1)] = inertia.Value(row, column);
    }
  }
  result.hasMassProperties = true;
  result.massPropertiesBasis = basis;
}

ShapeSummary summarize(const TopoDS_Shape& shape) {
  ShapeSummary result;
  if (shape.IsNull()) return result;
  result.brepValid = BRepCheck_Analyzer(shape, Standard_True).IsValid();
  for (TopExp_Explorer it(shape, TopAbs_SOLID); it.More(); it.Next()) incrementTopologyCount(result.solids);
  for (TopExp_Explorer it(shape, TopAbs_SHELL); it.More(); it.Next()) incrementTopologyCount(result.shells);
  for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next()) {
    incrementTopologyCount(result.faces);
    acceptTolerance(result.maxTolerance, BRep_Tool::Tolerance(TopoDS::Face(it.Current())));
  }
  for (TopExp_Explorer it(shape, TopAbs_EDGE); it.More(); it.Next()) {
    incrementTopologyCount(result.edges);
    acceptTolerance(result.maxTolerance, BRep_Tool::Tolerance(TopoDS::Edge(it.Current())));
  }
  std::size_t vertexCount = 0;
  for (TopExp_Explorer it(shape, TopAbs_VERTEX); it.More(); it.Next()) {
    incrementTopologyCount(vertexCount);
    acceptTolerance(result.maxTolerance, BRep_Tool::Tolerance(TopoDS::Vertex(it.Current())));
  }

  TopTools_IndexedDataMapOfShapeListOfShape edgeFaces;
  TopExp::MapShapesAndUniqueAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
  if (static_cast<std::size_t>(edgeFaces.Extent()) > kMaxTopologyItems) {
    throw std::runtime_error("topology_item_limit_exceeded");
  }
  for (Standard_Integer index = 1; index <= edgeFaces.Extent(); ++index) {
    if (edgeFaces.FindFromIndex(index).Extent() > 2) ++result.nonManifoldEdges;
  }

  GProp_GProps volumeProperties;
  BRepGProp::VolumeProperties(shape, volumeProperties);
  result.volume = volumeProperties.Mass();
  GProp_GProps surfaceProperties;
  BRepGProp::SurfaceProperties(shape, surfaceProperties);
  result.surfaceArea = surfaceProperties.Mass();
  if (std::abs(result.volume) > 1.0e-18) {
    acceptMassProperties(result, volumeProperties, "volume");
  } else if (std::abs(result.surfaceArea) > 1.0e-18) {
    acceptMassProperties(result, surfaceProperties, "surface");
  }
  Bnd_Box box;
  BRepBndLib::Add(shape, box);
  if (!box.IsVoid()) {
    box.Get(result.bounds[0], result.bounds[1], result.bounds[2], result.bounds[3], result.bounds[4], result.bounds[5]);
    result.hasBounds = true;
  }
  return result;
}

void writeNumber(std::ostream& out, const double value) {
  if (!std::isfinite(value)) throw std::runtime_error("native_numeric_nonfinite");
  out << std::setprecision(17) << value;
}

void writeShape(std::ostream& out, const ShapeSummary& shape) {
  out << "{\"solidCount\":" << shape.solids
      << ",\"shellCount\":" << shape.shells
      << ",\"faceCount\":" << shape.faces
      << ",\"edgeCount\":" << shape.edges
      << ",\"nonManifoldEdgeCount\":" << shape.nonManifoldEdges
      << ",\"brepValid\":" << (shape.brepValid ? "true" : "false")
      << ",\"volumeMm3\":";
  writeNumber(out, shape.volume);
  out << ",\"surfaceAreaMm2\":";
  writeNumber(out, shape.surfaceArea);
  out << ",\"maxToleranceMm\":";
  writeNumber(out, shape.maxTolerance);
  out << ",\"bboxMm\":";
  if (!shape.hasBounds) out << "null";
  else {
    out << '[';
    for (int i = 0; i < 6; ++i) { if (i != 0) out << ','; writeNumber(out, shape.bounds[i]); }
    out << ']';
  }
  out << ",\"centroidMm\":";
  if (!shape.hasMassProperties) out << "null";
  else {
    out << '[';
    for (int index = 0; index < 3; ++index) { if (index != 0) out << ','; writeNumber(out, shape.centroid[index]); }
    out << ']';
  }
  out << ",\"massPropertiesBasis\":"
      << (shape.hasMassProperties ? "\"" + jsonEscape(shape.massPropertiesBasis) + "\"" : "null")
      << ",\"inertiaTensor\":";
  if (!shape.hasMassProperties) out << "null";
  else {
    out << '[';
    for (int index = 0; index < 9; ++index) { if (index != 0) out << ','; writeNumber(out, shape.inertia[index]); }
    out << ']';
  }
  out << ",\"inertiaUnit\":";
  if (!shape.hasMassProperties) out << "null";
  else out << (shape.massPropertiesBasis == "volume" ? "\"mm5\"" : "\"mm4\"");
  out << '}';
}

void writeTransform(std::ostream& out, const TopLoc_Location& location) {
  const gp_Trsf transform = location.Transformation();
  out << "{\"matrix3x3\":[";
  for (int row = 1; row <= 3; ++row) {
    if (row != 1) out << ',';
    for (int column = 1; column <= 3; ++column) {
      if (column != 1) out << ',';
      writeNumber(out, transform.Value(row, column));
    }
  }
  out << "],\"translationMm\":[";
  writeNumber(out, transform.TranslationPart().X()); out << ',';
  writeNumber(out, transform.TranslationPart().Y()); out << ',';
  writeNumber(out, transform.TranslationPart().Z()); out << "]}";
}

void writeColor(std::ostream& out, const Handle(XCAFDoc_ColorTool)& colors, const TDF_Label& label) {
  Quantity_Color color;
  if (!colors->GetColor(label, XCAFDoc_ColorType::XCAFDoc_ColorSurf, color)
      && !colors->GetColor(label, XCAFDoc_ColorType::XCAFDoc_ColorGen, color)) {
    out << "null";
    return;
  }
  out << '[';
  writeNumber(out, color.Red()); out << ',';
  writeNumber(out, color.Green()); out << ',';
  writeNumber(out, color.Blue()); out << ']';
}

void writeOccurrence(std::ostream& out, const Handle(XCAFDoc_ShapeTool)& shapes,
                     const Handle(XCAFDoc_ColorTool)& colors, const TDF_Label& label,
                     const std::string& role, const std::string& occurrencePath,
                     bool& first, std::size_t& occurrenceCount, const int depth,
                     std::unordered_set<std::string>& recursionStack,
                     std::unordered_set<std::string>& visitedLabels) {
  if (depth >= 64) throw std::runtime_error("xcaf_assembly_depth_exceeded");
  if (++occurrenceCount > kMaxOccurrences) throw std::runtime_error("xcaf_occurrence_limit_exceeded");
  const std::string entry = checkedText(labelEntry(label), kMaxTextBytes, "xcaf_label_entry_too_long");
  visitedLabels.insert(entry);
  if (visitedLabels.size() > kMaxOccurrences) throw std::runtime_error("xcaf_visited_label_limit_exceeded");
  const std::string boundedPath = checkedText(occurrencePath, kMaxOccurrencePathBytes,
                                               "xcaf_occurrence_path_too_long");
  TopoDS_Shape shape = shapes->GetShape(label);
  TDF_Label referred;
  const bool hasReferred = shapes->GetReferredShape(label, referred);
  const std::string referredEntry = hasReferred
    ? checkedText(labelEntry(referred), kMaxTextBytes, "xcaf_label_entry_too_long") : std::string();
  const std::string ownName = checkedText(labelName(label), kMaxTextBytes, "xcaf_name_too_long");
  const std::string referredName = hasReferred
    ? checkedText(labelName(referred), kMaxTextBytes, "xcaf_name_too_long") : std::string();
  const std::string name = ownName.empty() ? referredName : ownName;
  if (!first) out << ',';
  first = false;
  out << "{\"entry\":\"" << jsonEscape(entry) << "\",\"role\":\"" << role
      << "\",\"occurrencePath\":\"" << jsonEscape(boundedPath)
      << "\",\"referredEntry\":" << (hasReferred ? "\"" + jsonEscape(referredEntry) + "\"" : "null")
      << ",\"name\":" << (name.empty() ? "null" : "\"" + jsonEscape(name) + "\"")
      // XCAF's generated binding has no portable separate part-number
      // attribute. Never copy a name into this field and call it a number.
      << ",\"partNumber\":null,\"partNumberStatus\":\"NOT_EXPOSED_BY_BINDING\""
      << ",\"label\":\"" << jsonEscape(entry)
      << "\",\"transformScope\":\"local_to_parent\",\"transform\":";
  writeTransform(out, shapes->GetLocation(label));
  out << ",\"color\":";
  writeColor(out, colors, label);
  out << ",\"shape\":";
  writeShape(out, summarize(shape));
  out << '}';
  const std::streampos position = out.tellp();
  if (position < 0 || static_cast<std::size_t>(position) > kMaxNativeOutputBytes) {
    throw std::runtime_error("native_output_limit_exceeded");
  }

  const TDF_Label assembly = hasReferred ? referred : label;
  const std::string assemblyEntry = checkedText(labelEntry(assembly), kMaxTextBytes,
                                                 "xcaf_label_entry_too_long");
  TDF_LabelSequence children;
  shapes->GetComponents(assembly, children);
  if (children.Length() == 0) return;
  if (!recursionStack.insert(assemblyEntry).second) throw std::runtime_error("xcaf_assembly_cycle_detected");
  std::vector<TDF_Label> orderedChildren;
  orderedChildren.reserve(static_cast<std::size_t>(children.Length()));
  for (Standard_Integer index = 1; index <= children.Length(); ++index) orderedChildren.push_back(children.Value(index));
  std::sort(orderedChildren.begin(), orderedChildren.end(), [](const TDF_Label& left, const TDF_Label& right) {
    return labelEntry(left) < labelEntry(right);
  });
  for (const TDF_Label& child : orderedChildren) {
    TDF_Label childReferred;
    const bool childHasReferred = shapes->GetReferredShape(child, childReferred);
    const std::string childRole = childHasReferred && shapes->IsAssembly(childReferred)
      ? "assembly_occurrence" : "occurrence";
    writeOccurrence(out, shapes, colors, child, childRole,
                    boundedPath + "/" + labelEntry(child), first, occurrenceCount, depth + 1,
                    recursionStack, visitedLabels);
  }
  recursionStack.erase(assemblyEntry);
}

std::string inspect(const std::filesystem::path& input, const std::string& expectedSha) {
  const auto size = std::filesystem::file_size(input);
  if (size == 0 || size > kMaxInputBytes) throw std::runtime_error("input_size_invalid");
  const std::string actualSha = sha256File(input);
  if (!expectedSha.empty() && actualSha != expectedSha) throw std::runtime_error("input_sha256_mismatch");

  Handle(TDocStd_Document) document;
  Handle(XCAFApp_Application) application = XCAFApp_Application::GetApplication();
  application->NewDocument(TCollection_ExtendedString("XmlOcaf"), document);
  STEPCAFControl_Reader reader;
  if (!Interface_Static::SetCVal("xstep.cascade.unit", "MM")) {
    throw std::runtime_error("step_target_unit_unavailable");
  }
  reader.SetNameMode(true);
  reader.SetColorMode(true);
  reader.SetLayerMode(true);
  if (reader.ReadFile(input.string().c_str()) != IFSelect_RetDone) throw std::runtime_error("stepcaf_read_failed");
  if (!reader.Transfer(document)) throw std::runtime_error("stepcaf_transfer_failed");

  const Handle(XCAFDoc_ShapeTool) shapes = XCAFDoc_DocumentTool::ShapeTool(document->Main());
  const Handle(XCAFDoc_ColorTool) colors = XCAFDoc_DocumentTool::ColorTool(document->Main());
  TDF_LabelSequence roots;
  shapes->GetFreeShapes(roots);
  if (roots.IsEmpty()) throw std::runtime_error("xcaf_free_shapes_empty");

  std::vector<TDF_Label> ordered;
  for (Standard_Integer index = 1; index <= roots.Length(); ++index) ordered.push_back(roots.Value(index));
  std::sort(ordered.begin(), ordered.end(), [](const TDF_Label& left, const TDF_Label& right) { return labelEntry(left) < labelEntry(right); });

  const char* configuredUnit = Interface_Static::CVal("xstep.cascade.unit");
  const std::string unit = configuredUnit == nullptr ? std::string() : std::string(configuredUnit);
  std::ostringstream out;
  out << "{\"schema\":\"nexyfab.occt-xcaf.inspect.v1\",\"status\":\"PASS_NATIVE\",\"inputSha256\":\""
      << actualSha << "\",\"unit\":" << (unit.empty() ? "null" : "\"" + jsonEscape(unit) + "\"")
      << ",\"programIdentity\":{\"name\":\"occt-xcaf-inspect\",\"version\":\"2\",\"buildIdentity\":\""
      << jsonEscape(NEXYFAB_NATIVE_BUILD_ID) << "\"}"
      << ",\"kernelIdentity\":{\"name\":\"OpenCASCADE\",\"version\":\"" << jsonEscape(OCC_VERSION_COMPLETE)
      << "\",\"buildIdentity\":\"" << jsonEscape(NEXYFAB_OCCT_BUILD_ID) << "\"}"
      << ",\"productIdentitySource\":\"STEPCAFControl_Reader+XCAFDoc_ShapeTool\",\"products\":[";
  bool first = true;
  std::size_t occurrenceCount = 0;
  std::unordered_set<std::string> recursionStack;
  std::unordered_set<std::string> visitedLabels;
  for (const TDF_Label& root : ordered) {
    writeOccurrence(out, shapes, colors, root, shapes->IsAssembly(root) ? "assembly" : "product",
                    labelEntry(root), first, occurrenceCount, 0, recursionStack, visitedLabels);
  }
  out << "]}";
  const std::string result = out.str();
  if (result.size() > kMaxNativeOutputBytes) throw std::runtime_error("native_output_limit_exceeded");
  return result;
}

} // namespace

int main(int argc, char** argv) {
  try {
    std::filesystem::path input;
    std::string expectedSha;
    for (int index = 1; index < argc; ++index) {
      const std::string argument(argv[index]);
      if (argument == "--input" && index + 1 < argc) input = argv[++index];
      else if (argument == "--expected-sha256" && index + 1 < argc) expectedSha = argv[++index];
      else if (argument == "--version") { std::cout << "occt-xcaf-inspect/2\n"; return 0; }
      else throw std::runtime_error("arguments_invalid");
    }
    if (input.empty()) throw std::runtime_error("input_required");
    std::error_code error;
    if (!std::filesystem::is_regular_file(input, error) || error) throw std::runtime_error("input_not_regular_file");
    std::cout << inspect(input, expectedSha) << '\n';
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "occt-xcaf-inspect:" << error.what() << '\n';
    return 2;
  }
}
