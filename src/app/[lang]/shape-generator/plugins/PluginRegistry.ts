// ─── Plugin Registry — Singleton that manages loaded plugins ─────────────────

import type {
  PluginManifest,
  PluginInitFn,
  PluginContext,
  RegisteredPlugin,
  ToolbarButton,
  PanelDefinition,
  CustomShapeDefinition,
} from './PluginAPI';

type Listener = () => void;

class PluginRegistryImpl {
  private plugins: Map<string, RegisteredPlugin> = new Map();
  private listeners: Set<Listener> = new Set();
  private cachedSnapshot: RegisteredPlugin[] = [];

  /* ── Subscription (React integration) ── */

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify() {
    this.cachedSnapshot = Array.from(this.plugins.values());
    this.listeners.forEach(fn => fn());
  }

  /* ── Registration ── */

  registerPlugin(
    manifest: PluginManifest,
    initFn: PluginInitFn,
    contextFactory: () => PluginContext,
  ): boolean {
    if (this.plugins.has(manifest.id)) {
      console.warn(`[PluginRegistry] Plugin "${manifest.id}" is already registered.`);
      return false;
    }

    const entry: RegisteredPlugin = {
      manifest,
      enabled: true,
      toolbarButtons: [],
      panels: [],
      shapes: [],
    };

    // Build a scoped context that captures registrations into this entry
    const baseCtx = contextFactory();
    const scopedCtx: PluginContext = {
      ...baseCtx,
      registerToolbarButton: (btn: ToolbarButton) => {
        entry.toolbarButtons.push({ ...btn, id: `${manifest.id}::${btn.id}` });
        this.notify();
      },
      registerPanel: (panel: PanelDefinition) => {
        entry.panels.push({ ...panel, id: `${manifest.id}::${panel.id}` });
        this.notify();
      },
      registerShape: (shape: CustomShapeDefinition) => {
        entry.shapes.push({ ...shape, id: `${manifest.id}::${shape.id}` });
        this.notify();
      },
    };

    try {
      const cleanup = initFn(scopedCtx);
      if (typeof cleanup === 'function') {
        entry.cleanup = cleanup;
      }
    } catch (err) {
      console.error(`[PluginRegistry] Failed to init plugin "${manifest.id}":`, err);
      return false;
    }

    this.plugins.set(manifest.id, entry);
    this.notify();
    return true;
  }

  unregisterPlugin(id: string): boolean {
    const entry = this.plugins.get(id);
    if (!entry) return false;
    if (entry.cleanup) {
      try { entry.cleanup(); } catch { /* ignore */ }
    }
    this.plugins.delete(id);
    this.notify();
    return true;
  }

  /* ── Toggle ── */

  setEnabled(id: string, enabled: boolean): void {
    const entry = this.plugins.get(id);
    if (entry) {
      entry.enabled = enabled;
      this.notify();
    }
  }

  /* ── Queries ── */

  getPlugins(): RegisteredPlugin[] {
    return Array.from(this.plugins.values());
  }

  getPlugin(id: string): RegisteredPlugin | undefined {
    return this.plugins.get(id);
  }

  getToolbarButtons(): ToolbarButton[] {
    const buttons: ToolbarButton[] = [];
    for (const entry of this.plugins.values()) {
      if (entry.enabled) buttons.push(...entry.toolbarButtons);
    }
    return buttons;
  }

  getPanels(): PanelDefinition[] {
    const panels: PanelDefinition[] = [];
    for (const entry of this.plugins.values()) {
      if (entry.enabled) panels.push(...entry.panels);
    }
    return panels;
  }

  getCustomShapes(): CustomShapeDefinition[] {
    const shapes: CustomShapeDefinition[] = [];
    for (const entry of this.plugins.values()) {
      if (entry.enabled) shapes.push(...entry.shapes);
    }
    return shapes;
  }

  /* ── Snapshot (for useSyncExternalStore) ── */

  getSnapshot(): RegisteredPlugin[] {
    return this.cachedSnapshot;
  }

  /* ── Reset (mainly for testing) ── */

  clear(): void {
    for (const entry of this.plugins.values()) {
      if (entry.cleanup) try { entry.cleanup(); } catch { /* ignore */ }
    }
    this.plugins.clear();
    this.notify();
  }
}

// Singleton instance
export const pluginRegistry = new PluginRegistryImpl();
