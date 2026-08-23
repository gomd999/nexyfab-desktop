#include <BRepBndLib.hxx>
#include <BRepGProp.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <Interface_Static.hxx>
#include <Quantity_Color.hxx>
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
#include <TopExp_Explorer.hxx>
#include <TopoDS_Shape.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_ColorTool.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <openssl/sha.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

constexpr std::uintmax_t kMaxInputBytes = 64U * 1024U * 1024U;

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
  SHA256_CTX context;
  SHA256_Init(&context);
  std::array<char, 1024 * 1024> buffer{};
  while (stream.good()) {
    stream.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
    const std::streamsize count = stream.gcount();
    if (count > 0) SHA256_Update(&context, buffer.data(), static_cast<std::size_t>(count));
  }
  std::array<unsigned char, SHA256_DIGEST_LENGTH> digest{};
  SHA256_Final(digest.data(), &context);
  std::ostringstream out;
  for (const unsigned char byte : digest) out << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(byte);
  return out.str();
}

struct ShapeSummary {
  int solids = 0;
  int shells = 0;
  int faces = 0;
  int edges = 0;
  double volume = 0.0;
  double bounds[6] = {0, 0, 0, 0, 0, 0};
  bool hasBounds = false;
};

ShapeSummary summarize(const TopoDS_Shape& shape) {
  ShapeSummary result;
  if (shape.IsNull()) return result;
  for (TopExp_Explorer it(shape, TopAbs_SOLID); it.More(); it.Next()) ++result.solids;
  for (TopExp_Explorer it(shape, TopAbs_SHELL); it.More(); it.Next()) ++result.shells;
  for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next()) ++result.faces;
  for (TopExp_Explorer it(shape, TopAbs_EDGE); it.More(); it.Next()) ++result.edges;
  GProp_GProps props;
  BRepGProp::VolumeProperties(shape, props);
  result.volume = props.Mass();
  Bnd_Box box;
  BRepBndLib::Add(shape, box);
  if (!box.IsVoid()) {
    box.Get(result.bounds[0], result.bounds[1], result.bounds[2], result.bounds[3], result.bounds[4], result.bounds[5]);
    result.hasBounds = true;
  }
  return result;
}

void writeNumber(std::ostream& out, const double value) {
  if (!std::isfinite(value)) out << "null";
  else out << std::setprecision(17) << value;
}

void writeShape(std::ostream& out, const ShapeSummary& shape) {
  out << "{\"solidCount\":" << shape.solids
      << ",\"shellCount\":" << shape.shells
      << ",\"faceCount\":" << shape.faces
      << ",\"edgeCount\":" << shape.edges
      << ",\"volumeMm3\":";
  writeNumber(out, shape.volume);
  out << ",\"bboxMm\":";
  if (!shape.hasBounds) out << "null";
  else {
    out << '[';
    for (int i = 0; i < 6; ++i) { if (i != 0) out << ','; writeNumber(out, shape.bounds[i]); }
    out << ']';
  }
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
  if (!colors->GetColor(label, color, XCAFDoc_ColorType::XCAFDoc_ColorSurf)
      && !colors->GetColor(label, color, XCAFDoc_ColorType::XCAFDoc_ColorGen)) {
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
                     bool& first, std::size_t& occurrenceCount, const int depth) {
  if (depth > 64) throw std::runtime_error("xcaf_assembly_depth_exceeded");
  if (++occurrenceCount > 20000U) throw std::runtime_error("xcaf_occurrence_limit_exceeded");
  TopoDS_Shape shape = shapes->GetShape(label);
  TDF_Label referred;
  const bool hasReferred = shapes->GetReferredShape(label, referred);
  const std::string ownName = labelName(label);
  const std::string referredName = hasReferred ? labelName(referred) : std::string();
  const std::string name = ownName.empty() ? referredName : ownName;
  if (!first) out << ',';
  first = false;
  out << "{\"entry\":\"" << jsonEscape(labelEntry(label)) << "\",\"role\":\"" << role
      << "\",\"occurrencePath\":\"" << jsonEscape(occurrencePath)
      << "\",\"referredEntry\":" << (hasReferred ? "\"" + jsonEscape(labelEntry(referred)) + "\"" : "null")
      << ",\"name\":" << (name.empty() ? "null" : "\"" + jsonEscape(name) + "\"")
      // XCAF's generated binding has no portable separate part-number
      // attribute. Never copy a name into this field and call it a number.
      << ",\"partNumber\":null,\"partNumberStatus\":\"NOT_EXPOSED_BY_BINDING\"
      << ",\"label\":\"" << jsonEscape(labelEntry(label))
      << "\",\"transformScope\":\"local_to_parent\",\"transform\":";
  writeTransform(out, shapes->GetLocation(label));
  out << ",\"color\":";
  writeColor(out, colors, label);
  out << ",\"shape\":";
  writeShape(out, summarize(shape));
  out << '}';

  const TDF_Label assembly = hasReferred ? referred : label;
  TDF_LabelSequence children;
  shapes->GetComponents(assembly, children);
  for (Standard_Integer index = 1; index <= children.Length(); ++index) {
    const TDF_Label child = children.Value(index);
    TDF_Label childReferred;
    const bool childHasReferred = shapes->GetReferredShape(child, childReferred);
    const std::string childRole = childHasReferred && shapes->IsAssembly(childReferred)
      ? "assembly_occurrence" : "occurrence";
    writeOccurrence(out, shapes, colors, child, childRole,
                    occurrencePath + "/" + labelEntry(child), first, occurrenceCount, depth + 1);
  }
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
      << ",\"productIdentitySource\":\"STEPCAFControl_Reader+XCAFDoc_ShapeTool\",\"products\":[";
  bool first = true;
  std::size_t occurrenceCount = 0;
  for (const TDF_Label& root : ordered) {
    writeOccurrence(out, shapes, colors, root, shapes->IsAssembly(root) ? "assembly" : "product",
                    labelEntry(root), first, occurrenceCount, 0);
  }
  out << "]}";
  return out.str();
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
      else if (argument == "--version") { std::cout << "occt-xcaf-inspect/1\n"; return 0; }
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
