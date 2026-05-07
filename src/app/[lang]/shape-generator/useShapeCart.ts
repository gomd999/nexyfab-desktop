'use client';

import { useState, useCallback, useEffect } from 'react';

export interface CartItem {
  id: string;
  shapeId: string;
  shapeName: string;       // i18n shape name at time of adding
  params: Record<string, number>;
  featureCount: number;
  thumbnail: string | null; // data:image/png base64
  volume_cm3: number;
  surface_area_cm2: number;
  bbox: { w: number; h: number; d: number };
  addedAt: number;
}

const STORAGE_KEY = 'nexyfab_shape_cart';

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCart(items: CartItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function useShapeCart() {
  const [items, setItems] = useState<CartItem[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    setItems(loadCart());
  }, []);

  const addItem = useCallback((item: Omit<CartItem, 'id' | 'addedAt'>) => {
    setItems(prev => {
      const next = [...prev, { ...item, id: crypto.randomUUID(), addedAt: Date.now() }];
      saveCart(next);
      return next;
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems(prev => {
      const next = prev.filter(i => i.id !== id);
      saveCart(next);
      return next;
    });
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { items, addItem, removeItem, clearCart };
}
