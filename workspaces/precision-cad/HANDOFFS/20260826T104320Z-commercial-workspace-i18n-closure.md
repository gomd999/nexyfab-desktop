# Precision CAD handoff: commercial workspace i18n closure

- Created: `2026-08-26T10:43:20Z`
- Branch: `scope/precision-cad`
- Head: `feacf8de210a264e19ad5e3b7dc85a6e534f3e68`
- Integration target: `integration/nexyfab`

## Summary

The active Precision CAD workspace now presents its commercial shell,
accessibility labels, viewport and authoring commands, drawing handoff, CAM,
assembly, collaboration, loading, and fallback states through locale-aware
copy in all six supported product languages. The production entry point also
fails closed against the `?dev-shell=v2` mock workspace. Technical CAD names
remain literal only where translation would change the underlying engineering
identifier. This handoff covers UI and interaction readiness; it does not
claim the still-pending external precision or manufacturing evidence.

## Changed paths

- `src/app/[lang]/shape-generator/CommandToolbar.tsx`
- `src/app/[lang]/shape-generator/GalleryView.tsx`
- `src/app/[lang]/shape-generator/ShapeChat.tsx`
- `src/app/[lang]/shape-generator/ShapeGeneratorApp.test.ts`
- `src/app/[lang]/shape-generator/ShapeGeneratorApp.tsx`
- `src/app/[lang]/shape-generator/ShapeGeneratorInner.tsx`
- `src/app/[lang]/shape-generator/ShapeGeneratorToolbar.tsx`
- `src/app/[lang]/shape-generator/ShapePreview.tsx`
- `src/app/[lang]/shape-generator/StatusBar.tsx`
- `src/app/[lang]/shape-generator/TimelineBar.tsx`
- `src/app/[lang]/shape-generator/ViewCube.tsx`
- `src/app/[lang]/shape-generator/WorkspaceLoading.i18n.test.tsx`
- `src/app/[lang]/shape-generator/WorkspaceLoading.tsx`
- `src/app/[lang]/shape-generator/_shell/BottomDrawer.a11y.test.tsx`
- `src/app/[lang]/shape-generator/_shell/BottomDrawer.tsx`
- `src/app/[lang]/shape-generator/_shell/DomainWorkspaceBar.tsx`
- `src/app/[lang]/shape-generator/_shell/DrawingFrame.tsx`
- `src/app/[lang]/shape-generator/_shell/GuestExpiryBanner.tsx`
- `src/app/[lang]/shape-generator/_shell/ModeRibbons.tsx`
- `src/app/[lang]/shape-generator/_shell/ModelerShell.tsx`
- `src/app/[lang]/shape-generator/_shell/OnboardingTutorial.tsx`
- `src/app/[lang]/shape-generator/_shell/RenderFrame.tsx`
- `src/app/[lang]/shape-generator/_shell/ShareProjectModal.tsx`
- `src/app/[lang]/shape-generator/_shell/Shell.tsx`
- `src/app/[lang]/shape-generator/_shell/TitleBar.tsx`
- `src/app/[lang]/shape-generator/_shell/WorkspaceTruthStrip.test.tsx`
- `src/app/[lang]/shape-generator/_shell/WorkspaceTruthStrip.tsx`
- `src/app/[lang]/shape-generator/_shell/shellChromeI18n.test.tsx`
- `src/app/[lang]/shape-generator/_shell/shellChromeI18n.ts`
- `src/app/[lang]/shape-generator/_shell/sidebars/ModelerRightPane.tsx`
- `src/app/[lang]/shape-generator/_shell/sidebars/PropSection.tsx`
- `src/app/[lang]/shape-generator/_shell/sidebars/SketchLeftPane.tsx`
- `src/app/[lang]/shape-generator/_shell/spatial/ArchitectureInteriorLiveInspector.tsx`
- `src/app/[lang]/shape-generator/_shell/spatial/BuildingCadWorkspace.tsx`
- `src/app/[lang]/shape-generator/_shell/spatial/CivilCadWorkspaceTyped.tsx`
- `src/app/[lang]/shape-generator/_shell/spatial/CoordinationCadWorkspace.tsx`
- `src/app/[lang]/shape-generator/_shell/spatial/LandscapeCadWorkspace.tsx`
- `src/app/[lang]/shape-generator/_shell/spatial/SpatialCadWorkspace.tsx`
- `src/app/[lang]/shape-generator/_shell/spatial/SpatialPaneResizers.tsx`
- `src/app/[lang]/shape-generator/analysis/AIAssistantSidebar.tsx`
- `src/app/[lang]/shape-generator/analysis/AutoDrawingPanel.tsx`
- `src/app/[lang]/shape-generator/assembly/AssemblyAnimationTimeline.test.tsx`
- `src/app/[lang]/shape-generator/assembly/AssemblyAnimationTimeline.tsx`
- `src/app/[lang]/shape-generator/assembly/AssemblyBrowserModal.tsx`
- `src/app/[lang]/shape-generator/assembly/AssemblyMatesPanel.tsx`
- `src/app/[lang]/shape-generator/assembly/ComplexVerifiedSystemsPanel.tsx`
- `src/app/[lang]/shape-generator/assembly/EmbeddedAssemblyWorkspace.tsx`
- `src/app/[lang]/shape-generator/cam/CAMWorkspacePanel.i18n.test.tsx`
- `src/app/[lang]/shape-generator/cam/CAMWorkspacePanel.tsx`
- `src/app/[lang]/shape-generator/collab/AwarenessCursors.tsx`
- `src/app/[lang]/shape-generator/collab/AwarenessPresencePanel.i18n.test.tsx`
- `src/app/[lang]/shape-generator/collab/AwarenessPresencePanel.tsx`
- `src/app/[lang]/shape-generator/collab/CollabPresence.tsx`
- `src/app/[lang]/shape-generator/collaboration/MultiplayerCursors.tsx`
- `src/app/[lang]/shape-generator/configurations/ui/ConfigurationTableV2.tsx`
- `src/app/[lang]/shape-generator/configurations/ui/FamilyExportButton.tsx`
- `src/app/[lang]/shape-generator/configurations/ui/dict.ts`
- `src/app/[lang]/shape-generator/drawing/GdtPicker.tsx`
- `src/app/[lang]/shape-generator/drawing/_content.tsx`
- `src/app/[lang]/shape-generator/drawing/assemblyHandoff.test.tsx`
- `src/app/[lang]/shape-generator/editing/CSGPanel.tsx`
- `src/app/[lang]/shape-generator/editing/EdgeContextPanel.tsx`
- `src/app/[lang]/shape-generator/editing/FaceContextPanel.tsx`
- `src/app/[lang]/shape-generator/featureCatalog/CommandPaletteShell.i18n.test.tsx`
- `src/app/[lang]/shape-generator/featureCatalog/CommandPaletteShell.tsx`
- `src/app/[lang]/shape-generator/features/HoleWizardModal.tsx`
- `src/app/[lang]/shape-generator/features/HoleWizardModalV2.tsx`
- `src/app/[lang]/shape-generator/io/RfqPanel.tsx`
- `src/app/[lang]/shape-generator/loading.tsx`
- `src/app/[lang]/shape-generator/onboarding/WelcomeBanner.tsx`
- `src/app/[lang]/shape-generator/openscad/OpenScadPanel.tsx`
- `src/app/[lang]/shape-generator/panels/ConfigTablePanel.tsx`
- `src/app/[lang]/shape-generator/panels/LeftPanel.tsx`
- `src/app/[lang]/shape-generator/panels/ScadAgentRichResult.tsx`
- `src/app/[lang]/shape-generator/sketch/SketchPanel.tsx`
- `src/app/[lang]/shape-generator/sketch/SolverSketchEditor.tsx`
- `src/app/[lang]/shape-generator/sketch/SolverSketchEditorWithExtrude.tsx`
- `src/app/[lang]/shape-generator/split/SplitNotesPanel.tsx`
- `src/app/[lang]/shape-generator/split/SplitSpecPanel.tsx`
- `workspaces/precision-cad/CURRENT.md`
- `workspaces/precision-cad/HANDOFFS/20260826T104320Z-commercial-workspace-i18n-closure.md`

## Verification

- [x] `npm run typecheck` — pass.
- [x] `npm run platform:architecture:check` — pass.
- [x] `npm run workspace:check -- precision-cad` — pass with zero shared,
  foreign, or unclassified ownership violations.
- [x] Focused Vitest suites for workspace entry, shell chrome, drawing
  handoff, viewport and authoring controls, CAM, awareness, assembly,
  collaboration, loading, and fallback states — pass.

## Remaining work and risks

- External native-CAD execution and independent STEP/XCAF/GD&T qualification
  remain pending and continue to block commercial precision certification.
- The 20 blind challenges, 30 direct-design packages, expert review, and three
  manufactured pilot receipts remain pending; Private Beta/GA stay false.
- Staging and production deployment were not performed by this handoff.
- Platform-owned DFM PDF localization must be completed after integration so
  the PDF and browser locale are revision-consistent.
