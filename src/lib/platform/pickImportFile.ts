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
    // The native file dialog blurs the window when it opens. We only treat a
    // later window 'focus' as a possible cancel AFTER that blur — otherwise an
    // UNRELATED focus event at click time (e.g. a File-menu dropdown closing)
    // fires the cancel path, nulls the result ~300 ms later while the user is
    // still browsing, and the real selection is then dropped as "already
    // settled" → silent failure (no import, no toast). This is exactly why the
    // menu-triggered import did nothing while a direct trigger worked.
    let dialogOpened = false;

    const onBlur = () => { dialogOpened = true; };
    const onFocus = () => {
      if (!dialogOpened) return; // pre-dialog focus (dropdown close) — ignore
      window.setTimeout(() => {
        if (settled) return;
        if (input.files && input.files.length > 0) return;
        finish(null);
      }, 400);
    };

    const finish = (value: PickedImportMesh | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      input.remove();
      resolve(value);
    };

    input.addEventListener('change', () => {
      void (async () => {
        const file = input.files?.[0];
        if (!file) {
          finish(null);
          return;
        }
        try {
          const buffer = await file.arrayBuffer();
          finish({ filename: file.name, buffer, byteSize: file.size });
        } catch {
          finish(null);
        }
      })();
    });

    window.addEventListener('blur', onBlur, { once: true });
    window.addEventListener('focus', onFocus);

    input.click();
  });
}
