/**
 * Local file I/O for .nfab project files.
 * - Tauri desktop: native save/open dialogs via @tauri-apps/plugin-dialog + fs
 * - Web: browser File API (Blob download + hidden <input>)
 */

'use client';

import {
  serializeProject,
  parseProject,
  toJsonString,
  NFAB_EXTENSION,
  NFAB_MIME,
  type SerializeInput,
  type NfabProjectV1,
} from './nfabFormat';
import { downloadBlob } from '@/lib/platform';
import { hasDesktopPower } from '@/lib/tauri';
import { nfabProjectExportJsonLooksValid } from '@/lib/nfAssemblySnapshotGuards';

// ─── Save ─────────────────────────────────────────────────────────────────────

/**
 * Save project file.
 * - Tauri: shows native Save dialog; if `savePath` is provided, writes directly (no dialog).
 * - Web: triggers browser download.
 * Returns the path written (Tauri only), or null.
 */
export async function downloadProjectFile(
  input: SerializeInput,
  savePath?: string | null,
): Promise<string | null> {
  const project = serializeProject(input);
  const json = toJsonString(project);
  if (!nfabProjectExportJsonLooksValid(json)) {
    throw new Error('Project export failed validation — please try again or report a bug.');
  }

  if (hasDesktopPower('nativeFilesystem')) {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const { invoke } = await import('@tauri-apps/api/core');

    let path = savePath ?? null;
    if (!path) {
      const { save } = await import('@tauri-apps/plugin-dialog');
      path = await save({
        defaultPath: sanitizeFileName(input.name) + NFAB_EXTENSION,
        filters: [{ name: 'NexyFab Project', extensions: ['nfab'] }],
      });
    }
    if (!path) return null; // user cancelled

    await writeTextFile(path, json);
    await invoke('add_recent_file', { path });
    return path;
  }

  // Web fallback
  const blob = new Blob([json], { type: NFAB_MIME });
  await downloadBlob(sanitizeFileName(input.name) + NFAB_EXTENSION, blob);
  return null;
}

// ─── Open ─────────────────────────────────────────────────────────────────────

/** Open a project file. Returns parsed project + resolved path (Tauri) or just project (web). */
export async function pickProjectFile(): Promise<NfabProjectV1 & { __path?: string }> {
  if (hasDesktopPower('nativeFilesystem')) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const { invoke } = await import('@tauri-apps/api/core');

    const selected = await open({
      multiple: false,
      filters: [{ name: 'NexyFab Project', extensions: ['nfab', 'json'] }],
    });
    if (!selected || Array.isArray(selected)) throw new Error('No file selected');

    const content = await readTextFile(selected as string);
    await invoke('add_recent_file', { path: selected });
    const project = parseProject(content);
    return { ...project, __path: selected as string };
  }

  // Web fallback
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = NFAB_EXTENSION + ',application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) { reject(new Error('No file selected')); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve(parseProject(String(reader.result ?? ''))); }
        catch (err) { reject(err); }
      };
      reader.onerror = () => reject(reader.error ?? new Error('Read failed'));
      reader.readAsText(file);
    });
    input.click();
  });
}

/** Open a specific file path directly (Tauri only, used for Recent Files). */
export async function openProjectByPath(filePath: string): Promise<NfabProjectV1 & { __path: string }> {
  if (!hasDesktopPower('nativeFilesystem')) throw new Error('openProjectByPath requires desktop file access');
  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  const { invoke } = await import('@tauri-apps/api/core');
  const content = await readTextFile(filePath);
  await invoke('add_recent_file', { path: filePath });
  const project = parseProject(content);
  return { ...project, __path: filePath };
}

function sanitizeFileName(name: string): string {
  return (name || 'untitled').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
}
