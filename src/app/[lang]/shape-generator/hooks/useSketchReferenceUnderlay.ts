'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { importFile } from '../io/importers';
import { formatCadImportError } from '../io/formatCadImportError';
import { bufferGeometryToReferenceDataUrl } from '../sketch/meshToReferenceImage';

export type SketchRefImageState = {
  href: string;
  opacity: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  locked: boolean;
} | null;

type ToastKind = 'error' | 'warning';

export function useSketchReferenceUnderlay(options: {
  sketchPlane: 'xy' | 'xz' | 'yz';
  addToast: (kind: ToastKind | 'success' | 'info', message: string) => void;
  sketchRefBadFileType: string;
  /** Cap WebGL snapshot size (default 768). */
  maxReferencePixels?: number;
}) {
  const { sketchPlane, addToast, sketchRefBadFileType, maxReferencePixels = 768 } = options;

  const [sketchRefImage, setSketchRefImage] = useState<SketchRefImageState>(null);
  const [sketchRefImporting, setSketchRefImporting] = useState(false);
  const sketchRefInputRef = useRef<HTMLInputElement>(null);

  const clearSketchRef = useCallback(() => {
    setSketchRefImage(prev => {
      if (prev?.href?.startsWith('blob:')) URL.revokeObjectURL(prev.href);
      return null;
    });
  }, []);

  const handleSketchRefFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;

      const lower = f.name.toLowerCase();
      const meshExt = /\.(stl|stp|step|dxf)$/i.test(lower);

      if (f.type.startsWith('image/')) {
        const href = URL.createObjectURL(f);
        setSketchRefImage(prev => {
          if (prev?.href?.startsWith('blob:')) URL.revokeObjectURL(prev.href);
          return {
            href,
            opacity: prev?.opacity ?? 0.35,
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            locked: false,
          };
        });
        return;
      }

      if (meshExt) {
        setSketchRefImporting(true);
        try {
          const { geometry } = await importFile(f);
          try {
            const dataUrl = bufferGeometryToReferenceDataUrl(
              geometry,
              sketchPlane,
              maxReferencePixels,
            );
            setSketchRefImage(prev => {
              if (prev?.href?.startsWith('blob:')) URL.revokeObjectURL(prev.href);
              return {
                href: dataUrl,
                opacity: prev?.opacity ?? 0.35,
                scale: 1,
                offsetX: 0,
                offsetY: 0,
                locked: false,
              };
            });
          } finally {
            geometry.dispose();
          }
        } catch (err) {
          addToast('error', formatCadImportError(err, { filename: f.name }));
        } finally {
          setSketchRefImporting(false);
        }
        return;
      }

      addToast('warning', sketchRefBadFileType);
    },
    [sketchPlane, addToast, sketchRefBadFileType, maxReferencePixels],
  );

  useEffect(() => {
    return () => {
      const href = sketchRefImage?.href;
      if (href?.startsWith('blob:')) URL.revokeObjectURL(href);
    };
  }, [sketchRefImage?.href]);

  return {
    sketchRefImage,
    setSketchRefImage,
    sketchRefInputRef,
    sketchRefImporting,
    handleSketchRefFileChange,
    clearSketchRef,
  };
}
