import { create } from 'zustand';
import { useAuthStore } from './useAuth';
import type { NexyfabProject } from '@/app/api/nexyfab/projects/projects-types';

export type { NexyfabProject };

interface ProjectsState {
  projects: NexyfabProject[];
  isLoading: boolean;
  error: string | null;
  /** Set from API JSON `code` on failed PATCH/POST (e.g. PROJECT_VERSION_CONFLICT). */
  lastErrorCode: string | null;
}

export type NexyfabProjectPatchPayload = Partial<NexyfabProject> & {
  /** When set, PATCH returns 409 if server `updatedAt` differs (optimistic concurrency). */
  ifMatchUpdatedAt?: number;
};

interface ProjectsActions {
  fetchProjects: () => Promise<void>;
  saveProject: (data: Partial<NexyfabProject>) => Promise<NexyfabProject | null>;
  updateProject: (id: string, data: NexyfabProjectPatchPayload) => Promise<NexyfabProject | null>;
  duplicateProject: (id: string) => Promise<NexyfabProject | null>;
  deleteProject: (id: string) => Promise<void>;
  clearError: () => void;
}

type ProjectsStore = ProjectsState & ProjectsActions;

function getAuthHeader(): Record<string, string> {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const useProjectsStore = create<ProjectsStore>()((set, get) => ({
  projects: [],
  isLoading: false,
  error: null,
  lastErrorCode: null,

  fetchProjects: async () => {
    set({ isLoading: true, error: null, lastErrorCode: null });
    try {
      const res = await fetch('/api/nexyfab/projects', { headers: getAuthHeader() });
      if (!res.ok) throw new Error('Failed to fetch projects');
      const { projects } = await res.json();
      set({ projects, isLoading: false });
    } catch (e: unknown) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Unknown error' });
    }
  },

  saveProject: async (data) => {
    try {
      const res = await fetch('/api/nexyfab/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string; code?: string };
        set({ error: json.error || 'Failed to save project', lastErrorCode: json.code ?? null });
        return null;
      }
      const { project } = await res.json() as { project: NexyfabProject };
      set(s => ({ projects: [project, ...s.projects], lastErrorCode: null }));
      return project;
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : 'Failed to save project', lastErrorCode: null });
      return null;
    }
  },

  updateProject: async (id, data) => {
    try {
      const res = await fetch(`/api/nexyfab/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string; code?: string };
        set({ error: json.error || 'Failed to update project', lastErrorCode: json.code ?? null });
        return null;
      }
      const { project } = await res.json() as { project: NexyfabProject };
      set(s => ({ projects: s.projects.map(p => p.id === id ? project : p), error: null, lastErrorCode: null }));
      return project;
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : 'Failed to update project', lastErrorCode: null });
      return null;
    }
  },

  duplicateProject: async (id) => {
    try {
      const source = get().projects.find((p: NexyfabProject) => p.id === id);
      if (!source) return null;
      const res = await fetch('/api/nexyfab/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          name: `${source.name} (copy)`,
          shapeId: source.shapeId,
          materialId: source.materialId,
          sceneData: source.sceneData,
          tags: source.tags,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        set({ error: json.error || 'Failed to duplicate project' });
        return null;
      }
      const { project } = await res.json() as { project: NexyfabProject };
      set(s => ({ projects: [project, ...s.projects] }));
      return project;
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : 'Failed to duplicate project' });
      return null;
    }
  },

  deleteProject: async (id) => {
    try {
      const res = await fetch(`/api/nexyfab/projects/${id}`, {
        method: 'DELETE',
        headers: getAuthHeader(),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        set({ error: json.error || 'Failed to delete project' });
        return;
      }
      set(s => ({ projects: s.projects.filter(p => p.id !== id) }));
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : 'Failed to delete project' });
    }
  },

  clearError: () => set({ error: null, lastErrorCode: null }),
}));

export const useProjects = () => useProjectsStore();
