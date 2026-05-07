'use client';

import { useState, useCallback } from 'react';
import type { ShapeResult } from '../shapes';
import { simplifyGeometry } from '../lod/meshSimplify';
import * as THREE from 'three';

export interface IPShareOptions {
  name: string;
  material?: string;
  expiresInHours?: number;
  watermark?: string;
  lang?: string;
  /** Merged into the returned view URL query string (e.g. `workspace=simulation`). */
  urlQuery?: Record<string, string>;
}

function appendQueryParams(url: string, params: Record<string, string>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return url;
  try {
    const u = new URL(url, 'https://nexyfab.com');
    for (const [k, v] of entries) u.searchParams.set(k, v);
    if (url.startsWith('http://') || url.startsWith('https://')) return u.toString();
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    const sp = new URLSearchParams(Object.fromEntries(entries));
    const q = sp.toString();
    if (!q) return url;
    return url + (url.includes('?') ? '&' : '?') + q;
  }
}

export function useIPShare() {
  const [isCreating, setIsCreating] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createShareLink = useCallback(async (
    result: ShapeResult,
    options: IPShareOptions,
  ): Promise<string | null> => {
    setIsCreating(true);
    setError(null);

    try {
      // Step 1: Simplify to low-res (0.15 = keep 15% of triangles)
      const lowResGeo = simplifyGeometry(result.geometry, 0.15);

      // Step 2: Extract position / normal arrays
      lowResGeo.computeVertexNormals();
      const posAttr = lowResGeo.attributes.position as THREE.BufferAttribute;
      const normAttr = lowResGeo.attributes.normal as THREE.BufferAttribute | undefined;

      const positions = Array.from(posAttr.array);
      const normals = normAttr ? Array.from(normAttr.array) : undefined;
      const index = lowResGeo.index ? Array.from(lowResGeo.index.array) : undefined;

      // Step 3: Encode as base64 JSON
      const meshJson = JSON.stringify({ positions, normals, indices: index });
      const meshDataBase64 = btoa(meshJson);

      // Step 4: Create share via API
      const res = await fetch('/api/nexyfab/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meshDataBase64,
          metadata: {
            name: options.name,
            material: options.material,
            bbox: result.bbox,
            volume_cm3: result.volume_cm3,
            surface_area_cm2: result.surface_area_cm2,
            watermark: options.watermark ?? 'NexyFab · No Download',
          },
          expiresInHours: options.expiresInHours ?? 72,
          lang: options.lang,
        }),
      });

      if (!res.ok) throw new Error('Failed to create share link');
      const { viewUrl, expiresAt: exp } = await res.json() as { viewUrl: string; expiresAt: number };
      const finalUrl = options.urlQuery ? appendQueryParams(viewUrl, options.urlQuery) : viewUrl;
      setShareUrl(finalUrl);
      setExpiresAt(exp);
      return finalUrl;
    } catch (e: unknown) {
      setError((e as Error).message);
      return null;
    } finally {
      setIsCreating(false);
    }
  }, []);

  const copyToClipboard = useCallback(async () => {
    if (!shareUrl) return false;
    try {
      await navigator.clipboard.writeText(shareUrl);
      return true;
    } catch {
      return false;
    }
  }, [shareUrl]);

  const reset = useCallback(() => {
    setShareUrl(null);
    setExpiresAt(null);
    setError(null);
  }, []);

  return { createShareLink, copyToClipboard, reset, isCreating, shareUrl, expiresAt, error };
}
