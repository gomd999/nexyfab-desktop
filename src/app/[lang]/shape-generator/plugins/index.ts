// ─── Plugin system barrel export ─────────────────────────────────────────────

export type {
  PluginManifest,
  PluginInitFn,
  PluginContext,
  RegisteredPlugin,
  ToolbarButton,
  PanelDefinition,
  CustomShapeDefinition,
  CustomShapeParam,
} from './PluginAPI';

export { pluginRegistry } from './PluginRegistry';

// Example plugins
export { springManifest, springInit } from './examples/springPlugin';
export { massPropertiesManifest, massPropertiesInit } from './examples/massPropertiesPlugin';
export { threadManifest, threadInit } from './examples/threadPlugin';
export { holeWizardManifest, holeWizardInit } from './examples/holeWizardPlugin';
export { weightCostManifest, weightCostInit } from './examples/weightCostPlugin';
