cmake_minimum_required(VERSION 3.20)
project(occt_xcaf_inspect LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Debian's OCCT package exposes XCAF STEP exchange through TKXDESTEP/TKXCAF;
# the package config supplies the complete, version-specific transitive list.
find_package(OpenCASCADE REQUIRED)
find_package(OpenSSL REQUIRED COMPONENTS Crypto)

if(NOT DEFINED OpenCASCADE_VERSION OR OpenCASCADE_VERSION STREQUAL "")
  set(OpenCASCADE_VERSION "unknown")
endif()
set(NEXYFAB_NATIVE_BUILD_ID "occt-xcaf-inspect/2-${CMAKE_CXX_COMPILER_ID}-${CMAKE_CXX_COMPILER_VERSION}")
set(NEXYFAB_OCCT_BUILD_ID "OpenCASCADE-${OpenCASCADE_VERSION}")

add_executable(occt-xcaf-inspect native/occt_xcaf_inspect.cpp)
target_include_directories(occt-xcaf-inspect PRIVATE ${OpenCASCADE_INCLUDE_DIR})
# Debian's OCCT config exports optional visualization/DRAW targets whose
# development-only TBB linker aliases are not present in the runtime-oriented
# package set used by this image. Link only the public OCCT toolkits exercised
# by this inspector; their shared-object dependencies remain kernel-owned.
set(NEXYFAB_OCCT_TOOLKITS
  TKXDESTEP TKXCAF TKCAF TKLCAF
  TKSTEP TKSTEPBase TKSTEPAttr TKSTEP209 TKXSBase
  TKShHealing TKTopAlgo TKGeomAlgo TKBRep TKGeomBase TKG3d TKG2d TKMath TKernel
)
set(NEXYFAB_OCCT_LINK_LIBRARIES "")
foreach(NEXYFAB_OCCT_TOOLKIT IN LISTS NEXYFAB_OCCT_TOOLKITS)
  find_library(NEXYFAB_OCCT_${NEXYFAB_OCCT_TOOLKIT}_LIBRARY
    NAMES ${NEXYFAB_OCCT_TOOLKIT}
    REQUIRED
  )
  list(APPEND NEXYFAB_OCCT_LINK_LIBRARIES
    ${NEXYFAB_OCCT_${NEXYFAB_OCCT_TOOLKIT}_LIBRARY}
  )
endforeach()
target_link_libraries(occt-xcaf-inspect PRIVATE ${NEXYFAB_OCCT_LINK_LIBRARIES} OpenSSL::Crypto)
target_compile_definitions(occt-xcaf-inspect PRIVATE
  NEXYFAB_NATIVE_BUILD_ID="${NEXYFAB_NATIVE_BUILD_ID}"
  NEXYFAB_OCCT_BUILD_ID="${NEXYFAB_OCCT_BUILD_ID}"
)
target_compile_options(occt-xcaf-inspect PRIVATE -Wall -Wextra -Wpedantic -Werror=return-type)

install(TARGETS occt-xcaf-inspect RUNTIME DESTINATION bin)
