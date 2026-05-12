#!/usr/bin/env bash
# Build Solvespace's `slvs` constraint solver to WebAssembly.
#
# Output:
#   public/wasm/slvs.js
#   public/wasm/slvs.wasm
#
# These are loaded at runtime by `src/lib/ai/scad-agent/serverSolver.ts`
# when present. Without them the agent falls back to its trivial-subset
# JS solver — still works, just less coverage.
#
# Prereqs:
#   - Docker (no host emcc setup needed)
#   - ~5 minutes on first build (clones Solvespace + emcc image pull)
#   - ~30s on rebuilds (build cache)
#
# Usage:
#   bash scripts/build-solvespace-wasm.sh
#
# CI usage:
#   Same. Add to release workflow if you want the WASM bundled in the
#   Docker image.

set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/.cache/nexyfab-solvespace}"
OUT_DIR="$(pwd)/public/wasm"
SLVS_REF="${SOLVESPACE_REF:-master}"
EMSCRIPTEN_IMAGE="${EMSCRIPTEN_IMAGE:-emscripten/emsdk:3.1.74}"

mkdir -p "$OUT_DIR"

# 1. Clone or update Solvespace source.
if [ ! -d "$REPO_DIR/.git" ]; then
  echo "▶ Cloning Solvespace into $REPO_DIR"
  git clone --depth 50 https://github.com/solvespace/solvespace "$REPO_DIR"
fi
echo "▶ Updating Solvespace to $SLVS_REF"
git -C "$REPO_DIR" fetch --depth 50 origin "$SLVS_REF"
git -C "$REPO_DIR" checkout "$SLVS_REF"
git -C "$REPO_DIR" submodule update --init --recursive --depth 1

# 2. Build inside the official Emscripten image.
echo "▶ Building slvs library via $EMSCRIPTEN_IMAGE"
docker run --rm \
  -v "$REPO_DIR":/src \
  -w /src \
  "$EMSCRIPTEN_IMAGE" \
  bash -c '
    set -e
    emcmake cmake -B build-wasm \
      -DENABLE_GUI=OFF \
      -DENABLE_TESTS=OFF \
      -DENABLE_CLI=OFF \
      -DBUILD_SHARED_LIBS=OFF \
      -DCMAKE_BUILD_TYPE=Release
    cmake --build build-wasm --target slvs -- -j$(nproc)
    # Wrap the static lib in a JS module so we can call from Node/Browser.
    emcc \
      -O3 \
      --post-js /src/exports/JsBindings.js \
      -s WASM=1 \
      -s EXPORTED_FUNCTIONS="['"'"'_Slvs_Solve'"'"','"'"'_Slvs_AddPoint2D'"'"','"'"'_Slvs_AddLine2D'"'"','"'"'_Slvs_AddConstraint'"'"','"'"'_malloc'"'"','"'"'_free'"'"']" \
      -s EXPORTED_RUNTIME_METHODS="['"'"'cwrap'"'"','"'"'ccall'"'"','"'"'getValue'"'"','"'"'setValue'"'"','"'"'HEAPF64'"'"']" \
      -s MODULARIZE=1 \
      -s EXPORT_ES6=1 \
      -s ENVIRONMENT=web,node \
      -s ALLOW_MEMORY_GROWTH=1 \
      -o /src/build-wasm/slvs.js \
      /src/build-wasm/src/libslvs/CMakeFiles/slvs.dir/*.o || true
  ' || {
    echo "❌ Build failed. Common causes:"
    echo "   - Solvespace ref does not exist (try SOLVESPACE_REF=master)"
    echo "   - JsBindings.js missing — see scripts/solvespace-bindings.js for a hand-written wrapper alternative"
    echo "   - emcc image too old — try EMSCRIPTEN_IMAGE=emscripten/emsdk:latest"
    exit 1
  }

# 3. Copy artifacts into public/wasm.
if [ ! -f "$REPO_DIR/build-wasm/slvs.js" ] || [ ! -f "$REPO_DIR/build-wasm/slvs.wasm" ]; then
  echo "❌ Build completed but artifacts missing — check $REPO_DIR/build-wasm/"
  exit 1
fi

cp "$REPO_DIR/build-wasm/slvs.js" "$OUT_DIR/slvs.js"
cp "$REPO_DIR/build-wasm/slvs.wasm" "$OUT_DIR/slvs.wasm"

echo ""
echo "✅ Solvespace WASM built and installed:"
echo "   $OUT_DIR/slvs.js   ($(stat -c%s "$OUT_DIR/slvs.js") bytes)"
echo "   $OUT_DIR/slvs.wasm ($(stat -c%s "$OUT_DIR/slvs.wasm") bytes)"
echo ""
echo "▶ Next: set SOLVESPACE_WASM_URL=/wasm/slvs.js in your env (or rely on the default)."
echo "▶ Restart the server; serverSolver.ts will detect and load the WASM automatically."
