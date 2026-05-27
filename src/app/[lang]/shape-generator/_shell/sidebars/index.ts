// Sidebar v3 barrel — public surface for shell-v2 sidebars matching the
// Nexyfab 3d design/ mockup. All components are theme-token driven, so
// light/dark switching is free as long as callers stick to --nx-* colors.

export { SidePanel, type SidePanelProps, type SidePanelTab } from './SidePanel';
export { Tree, type TreeProps, type TreeNode } from './Tree';
export {
  PropSection,
  PropRow,
  PropNumber,
  PropSelect,
  PropCheck,
  PropItemRow,
} from './PropSection';
