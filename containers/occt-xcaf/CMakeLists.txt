cmake_minimum_required(VERSION 3.20)
project(occt_xcaf_inspect LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Debian's OCCT package exposes XCAF STEP exchange through TKXDESTEP/TKXCAF;
# the package config supplies the complete, version-specific transitive list.
find_package(OpenCASCADE REQUIRED)
find_package(OpenSSL REQUIRED COMPONENTS Crypto)

add_executable(occt-xcaf-inspect native/occt_xcaf_inspect.cpp)
target_include_directories(occt-xcaf-inspect PRIVATE ${OpenCASCADE_INCLUDE_DIR})
target_link_libraries(occt-xcaf-inspect PRIVATE ${OpenCASCADE_LIBRARIES} OpenSSL::Crypto)
target_compile_options(occt-xcaf-inspect PRIVATE -Wall -Wextra -Wpedantic -Werror=return-type)

install(TARGETS occt-xcaf-inspect RUNTIME DESTINATION bin)
