export {
  // Types
  type SheetMetalParams,
  type FlatPatternResult,

  // Bend calculations
  calculateBendAllowance,
  calculateBendDeduction,

  // Sheet metal operations
  createSheetMetalBox,
  createBend,
  createFlange,
  createHem,
  unfold,
  createSheetFromProfile,
} from './sheetMetal';
