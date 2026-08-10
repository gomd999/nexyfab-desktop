import { tryServerStepObjectImport, type ServerStepImportOk } from './serverStepImport';

async function jsonRequest(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
  return data;
}

/** Browser → signed private PUT → metadata commit → URL-backed BREP worker. */
export async function importLargeStepDirect(file: File): Promise<ServerStepImportOk> {
  const endpoint = '/api/nexyfab/files/direct-step-upload';
  const intent = await jsonRequest(endpoint, { action: 'intent', filename: file.name, sizeBytes: file.size });
  const uploadUrl = typeof intent.uploadUrl === 'string' ? intent.uploadUrl : '';
  const key = typeof intent.key === 'string' ? intent.key : '';
  const contentType = typeof intent.contentType === 'string' ? intent.contentType : 'application/step';
  if (!uploadUrl || !key) throw new Error('Direct upload intent is incomplete.');
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
  if (!put.ok) throw new Error(`Private object upload failed (HTTP ${put.status}).`);
  await jsonRequest(endpoint, { action: 'complete', filename: file.name, sizeBytes: file.size, key });
  const imported = await tryServerStepObjectImport(file.name, key);
  if (!imported) throw new Error('Large STEP worker did not return preview geometry.');
  return imported;
}
