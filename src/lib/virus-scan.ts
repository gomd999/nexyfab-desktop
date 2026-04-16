/**
 * Virus scan via VirusTotal API v3 (optional — graceful skip if no API key)
 * Free tier: 4 requests/min, 500/day
 */

export interface ScanResult {
  clean: boolean;
  skipped: boolean;
  positives?: number;
  total?: number;
  permalink?: string;
}

export async function scanBuffer(buffer: Buffer, filename: string): Promise<ScanResult> {
  const apiKey = process.env.VIRUSTOTAL_API_KEY;
  if (!apiKey) return { clean: true, skipped: true };

  try {
    // 1. Upload file to VirusTotal
    const form = new FormData();
    const uint8 = new Uint8Array(buffer);
    form.append('file', new Blob([uint8]), filename);

    const uploadRes = await fetch('https://www.virustotal.com/api/v3/files', {
      method: 'POST',
      headers: { 'x-apikey': apiKey },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });

    if (!uploadRes.ok) {
      console.warn('[virus-scan] VirusTotal upload failed:', uploadRes.status);
      return { clean: true, skipped: true };
    }

    const uploadData = await uploadRes.json();
    const analysisId = uploadData?.data?.id;
    if (!analysisId) return { clean: true, skipped: true };

    // 2. Poll for result (max 30s, 3 retries)
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 10_000));
      const analysisRes = await fetch(`https://www.virustotal.com/api/v3/analyses/${analysisId}`, {
        headers: { 'x-apikey': apiKey },
        signal: AbortSignal.timeout(10_000),
      });
      if (!analysisRes.ok) continue;
      const analysisData = await analysisRes.json();
      const stats = analysisData?.data?.attributes?.stats;
      if (analysisData?.data?.attributes?.status !== 'completed') continue;

      const positives = stats?.malicious ?? 0;
      const total = (stats?.harmless ?? 0) + (stats?.undetected ?? 0) + positives + (stats?.suspicious ?? 0);
      return {
        clean: positives === 0,
        skipped: false,
        positives,
        total,
        permalink: `https://www.virustotal.com/gui/file-analysis/${analysisId}`,
      };
    }

    // Timed out waiting for result — allow upload but log
    console.warn('[virus-scan] VirusTotal scan timed out for:', filename);
    return { clean: true, skipped: true };
  } catch (err) {
    console.warn('[virus-scan] Scan error (non-blocking):', err);
    return { clean: true, skipped: true };
  }
}
