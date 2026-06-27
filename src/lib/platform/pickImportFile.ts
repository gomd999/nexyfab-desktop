import { hasDesktopPower } from '@/lib/tauri';

/** Accept list aligned with `io/importers` and Shape Generator hidden input. */
export const IMPORT_MESH_ACCEPT = '.stl,.obj,.ply,.step,.stp,.iges,.igs,.brep,.dxf';

export interface PickedImportMesh {
  filename: string;
  buffer: ArrayBuffer;
  byteSize: number;
}

const TAURI_EXTENSIONS = ['stl', 'obj', 'ply', 'step', 'stp', 'iges', 'igs', 'brep', 'dxf'];

/**
 * Open the native / browser file picker and return one mesh/CAD file as bytes.
 * Web: resolves `null` if the user cancels (focus heuristic).
 */
export async function pickImportMeshFile(): Promise<PickedImportMesh | null> {
  if (typeof window === 'undefined') return null;

  if (hasDesktopPower('nativeFilesystem')) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const selected = await open({
      multiple: false,
      filters: [{ name: 'CAD / mesh', extensions: TAURI_EXTENSIONS }],
    });
    if (selected === null || Array.isArray(selected)) return null;
    const path = selected as string;
    const u8 = await readFile(path);
    const filename = path.replace(/^.*[/\\]/, '') || 'import';
    const buffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    return { filename, buffer, byteSize: u8.byteLength };
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = IMPORT_MESH_ACCEPT;
    input.style.display = 'none';
    document.body.appendChild(input);

    let settled = false;

    const finish = (value: PickedImportMesh | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(safetyTimer);
      input.remove();
      resolve(value);
    };

    // SELECTION — the only path that matters. Resolves with the file the moment
    // the user picks one. No focus/blur heuristics, so nothing can race this and
    // drop a valid selection (the previous focus-based cancel detection nulled
    // the result when triggered from the File menu, whose dropdown emitted a
    // focus event — the import then silently no-op'd).
    input.addEventListener('change', () => {
      void (async () => {
        const file = input.files?.[0];
        if (!file) { finish(null); return; }
        try {
          const buffer = await file.arrayBuffer();
          finish({ filename: file.name, buffer, byteSize: file.size });
        } catch {
          finish(null);
        }
      })();
    });

    // CANCEL — the standard `cancel` event fires when the dialog is dismissed
    // without a selection (Chromium 113+/FF 91+/Safari 16.4+). Proper, race-free.
    input.addEventListener('cancel', () => finish(null));

    // Ultimate safety net so the Promise can't leak forever on browsers without
    // the `cancel` event (a real selection always resolves via `change` first).
    const safetyTimer = window.setTimeout(() => finish(null), 5 * 60 * 1000);

    input.click();
  });
}
