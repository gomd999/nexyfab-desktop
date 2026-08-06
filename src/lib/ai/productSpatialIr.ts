export type ProductSpatialNodeKind =
  | 'project' | 'site' | 'building' | 'storey' | 'space' | 'zone'
  | 'system' | 'assembly' | 'part' | 'element';

export type ProductSpatialMatrix = readonly [
  number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number,
];

export interface ProductSpatialNode {
  id: string;
  kind: ProductSpatialNodeKind;
  name: string;
  parentId?: string;
  definitionId?: string;
  source?: { format: 'step' | 'ifc' | 'native'; entityId?: number; globalId?: string };
  localToParent?: ProductSpatialMatrix;
  worldTransform?: ProductSpatialMatrix;
  properties?: Readonly<Record<string, string | number | boolean>>;
}

export interface ProductSpatialDefinition {
  id: string;
  name: string;
  kind: 'part' | 'element-type';
  geometryRef?: string;
  materialRef?: string;
}

export interface ProductSpatialIr {
  schema: 'nexyfab.product-spatial-ir.v1';
  units: 'mm';
  nodes: ProductSpatialNode[];
  definitions: ProductSpatialDefinition[];
}

export interface ProductSpatialIssue { code: string; path: string; message: string }

const SPATIAL = new Set<ProductSpatialNodeKind>(['project', 'site', 'building', 'storey', 'space', 'zone']);

function validMatrix(value: ProductSpatialMatrix | undefined): boolean {
  return value === undefined || (value.length === 16 && value.every(Number.isFinite)
    && Math.abs(value[12]) <= 1e-9 && Math.abs(value[13]) <= 1e-9
    && Math.abs(value[14]) <= 1e-9 && Math.abs(value[15] - 1) <= 1e-9);
}

export function validateProductSpatialIr(ir: ProductSpatialIr): ProductSpatialIssue[] {
  const issues: ProductSpatialIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  if (ir.schema !== 'nexyfab.product-spatial-ir.v1') add('INVALID_SCHEMA', 'schema', 'Unsupported Product/Spatial IR schema.');
  if (ir.units !== 'mm') add('AMBIGUOUS_UNIT', 'units', 'Product/Spatial IR must use explicit millimetres.');
  const nodeIds = new Set<string>(); const definitionIds = new Set<string>();
  ir.definitions.forEach((definition, index) => {
    if (!definition.id.trim() || definitionIds.has(definition.id)) add('DUPLICATE_DEFINITION', `definitions[${index}].id`, 'Definition ids must be non-empty and unique.');
    definitionIds.add(definition.id);
  });
  ir.nodes.forEach((node, index) => {
    if (!node.id.trim() || nodeIds.has(node.id)) add('DUPLICATE_NODE', `nodes[${index}].id`, 'Node ids must be non-empty and unique.');
    nodeIds.add(node.id);
    if (!node.name.trim()) add('MISSING_NAME', `nodes[${index}].name`, 'Node name is required.');
    if (!validMatrix(node.localToParent)) add('INVALID_TRANSFORM', `nodes[${index}].localToParent`, 'Expected a finite affine 4x4 matrix.');
    if (!validMatrix(node.worldTransform)) add('INVALID_TRANSFORM', `nodes[${index}].worldTransform`, 'Expected a finite affine 4x4 matrix.');
  });
  const byId = new Map(ir.nodes.map(node => [node.id, node]));
  ir.nodes.forEach((node, index) => {
    if (node.parentId && !byId.has(node.parentId)) add('UNKNOWN_PARENT', `nodes[${index}].parentId`, `Unknown parent ${node.parentId}.`);
    if (node.definitionId && !definitionIds.has(node.definitionId)) add('UNKNOWN_DEFINITION', `nodes[${index}].definitionId`, `Unknown definition ${node.definitionId}.`);
    if (node.definitionId && SPATIAL.has(node.kind)) add('SPATIAL_AS_PRODUCT', `nodes[${index}].definitionId`, 'Spatial containers cannot be counted as physical product definitions.');
    const seen = new Set<string>(); let current: ProductSpatialNode | undefined = node;
    while (current?.parentId) {
      if (seen.has(current.id)) { add('CYCLIC_HIERARCHY', `nodes[${index}].parentId`, 'Hierarchy contains a cycle.'); break; }
      seen.add(current.id); current = byId.get(current.parentId);
    }
  });
  return issues;
}

export function productSpatialReleaseReady(ir: ProductSpatialIr): boolean {
  if (validateProductSpatialIr(ir).length) return false;
  return ir.nodes.every(node => node.worldTransform !== undefined && (!node.parentId || node.localToParent !== undefined));
}
