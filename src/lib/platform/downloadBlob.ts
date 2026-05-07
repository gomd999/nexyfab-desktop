import { hasDesktopPower } from '@/lib/tauri';

function dialogFiltersForFilename(filename: string): { name: string; extensions: string[] }[] {
  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
  if (!ext) return [{ name: 'All files', extensions: ['*'] }];
  return [{ name: ext.toUpperCase(), extensions: [ext] }];
}

/**
 * Save a Blob: in the browser, trigger a download; in Tauri, show the native
 * save dialog and write bytes with plugin-fs.
 */
export async function downloadBlob(filename: string, blob: Blob): Promise<void> {
  if (typeof window === 'undefined') return;

  if (hasDesktopPower('directDiskExport')) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({
      defaultPath: filename,
      filters: dialogFiltersForFilename(filename),
    });
    if (!path) return;
    const data = new Uint8Array(await blob.arrayBuffer());
    await writeFile(path, data);
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
