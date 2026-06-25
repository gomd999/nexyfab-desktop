/// <reference types="./openscad.d.ts" />
// NexyFab: patched to load the emscripten glue via a blob: URL instead of a
// data: URL. Production CSP allows `script-src blob:` (added) but not data:,
// so the original `import("data:...")` was blocked. locateFile (set on the
// outer module, which has a real import.meta.url) still resolves openscad.wasm.
let wasmJsText;
async function OpenSCAD(options) {
    if (!wasmJsText) {
        const url = new URL(`./openscad.wasm.js`, import.meta.url).href;
        wasmJsText = await (await fetch(url)).text();
    }
    const module = {
        noInitialRun: true,
        locateFile: (path) => new URL(`./${path}`, import.meta.url).href,
        ...options,
    };
    globalThis.OpenSCAD = module;
    // A fresh blob URL per call → unique module specifier → re-executes the
    // glue against the new globalThis.OpenSCAD (emscripten runs main() once per
    // instance, so every render needs its own instance).
    const blobUrl = URL.createObjectURL(new Blob([wasmJsText], { type: 'text/javascript' }));
    try {
        await import(blobUrl);
    } finally {
        URL.revokeObjectURL(blobUrl);
    }
    delete globalThis.OpenSCAD;
    await new Promise((resolve) => {
        module.onRuntimeInitialized = () => resolve(null);
    });
    return module;
}

export { OpenSCAD as default };
