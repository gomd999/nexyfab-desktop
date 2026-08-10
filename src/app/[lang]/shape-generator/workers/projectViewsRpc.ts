export type DrawingViewName = 'front' | 'top' | 'right' | 'left' | 'back' | 'bottom';

export interface ProjectViewsRequest {
  requestId: number;
  handle: string;
  views: DrawingViewName[];
}

export interface ProjectedViewData {
  visible: unknown[];
  hidden: unknown[];
  viewBox: string | null;
}

export interface ProjectViewsResponse {
  type: 'PROJECT_RESULT';
  requestId: number;
  projectedViews: Record<string, ProjectedViewData> | null;
}

export type ProjectionResolver<T> = (value: T | null) => void;

/** Settle every outstanding projection before a worker is discarded. */
export function settlePendingProjections<T>(
  pending: Map<number, ProjectionResolver<T>>,
): void {
  for (const resolve of pending.values()) resolve(null);
  pending.clear();
}

type Projector = (
  handle: string,
  views: DrawingViewName[],
) => Record<string, ProjectedViewData> | null;

/**
 * Execute PROJECT_VIEWS in the registry-owning context.
 *
 * The response always preserves requestId and fails closed with null. It never
 * exports the registry handle or a kernel object across the worker boundary.
 */
export async function handleProjectViewsRequest(
  request: ProjectViewsRequest,
  projector?: Projector,
): Promise<ProjectViewsResponse> {
  const { requestId, handle, views } = request;
  if (!Number.isSafeInteger(requestId) || requestId < 0 || !handle || views.length === 0) {
    return { type: 'PROJECT_RESULT', requestId, projectedViews: null };
  }

  try {
    const project = projector ?? (await import('../features/occtEngine')).occtProjectViews;
    const projectedViews = project(handle, views);
    return { type: 'PROJECT_RESULT', requestId, projectedViews: projectedViews ?? null };
  } catch {
    return { type: 'PROJECT_RESULT', requestId, projectedViews: null };
  }
}
