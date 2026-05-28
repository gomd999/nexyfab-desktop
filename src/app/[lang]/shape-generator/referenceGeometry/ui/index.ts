/**
 * referenceGeometry/ui/index.ts — barrel for the W2 UI surface.
 *
 * Importers should pull from this barrel so internal renames (e.g. when
 * the live preview lands in W3) don't ripple to call-sites.
 */

export { default as ReferenceGeometryDropdown } from './ReferenceGeometryDropdown';
export type {
  ReferenceGeometryDropdownProps,
  AnyMethod,
} from './ReferenceGeometryDropdown';
export { REF_GEOM_METHOD_CATALOGUE } from './ReferenceGeometryDropdown';

export { default as PlaneMethodPickerDialog } from './PlaneMethodPickerDialog';
export type { PlaneMethodPickerDialogProps } from './PlaneMethodPickerDialog';

export { default as AxisMethodPickerDialog } from './AxisMethodPickerDialog';
export type { AxisMethodPickerDialogProps } from './AxisMethodPickerDialog';

export { default as PointMethodPickerDialog } from './PointMethodPickerDialog';
export type { PointMethodPickerDialogProps } from './PointMethodPickerDialog';

export { default as CsysMethodPickerDialog } from './CsysMethodPickerDialog';
export type { CsysMethodPickerDialogProps } from './CsysMethodPickerDialog';

export { default as ReferenceGeometryTreeSection } from './ReferenceGeometryTreeSection';
export type { ReferenceGeometryTreeSectionProps } from './ReferenceGeometryTreeSection';
