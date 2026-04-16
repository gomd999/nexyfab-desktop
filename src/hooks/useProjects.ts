import { create } from 'zustand';
import { useAuthStore } from './useAuth';

export interface NexyfabProject {
  id: string;
  userId: string;
  name: string;
  thumbnail?: string;
  shapeId?: string;
  materialId?: string;
  sceneData?: string;
  tags?: string[];
  updatedAt: number;
  createdAt: number;
}

interface ProjectsState {
  projects: NexyfabProject[];
  isLoading: boolean;
  error: string | null;
}

interface ProjectsActions {
  fetchProjects: () => Promise<void>;
  saveProject: (data: Partial<NexyfabProject>) => Promise<NexyfabProject | null>;
  updateProject: (id: string, data: Partial<NexyfabProject>) => Promise<void>;
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

  fetchProjects: async () => {
    set({ isLoading: true, error: null });
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
      if (!res.ok) throw new Error('Failed to save project');
      const { project } = await res.json();
      set(s => ({ projects: [project, ...s.projects] }));
      return project;
    } catch {
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
      if (!res.ok) return;
      const { project } = await res.json();
      set(s => ({ projects: s.projects.map(p => p.id === id ? project : p) }));
    } catch {
      // silently ignore network errors
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
      if (!res.ok) return null;
      const { project } = await res.json();
      set(s => ({ projects: [project, ...s.projects] }));
      return project;
    } catch {
      return null;
    }
  },

  deleteProject: async (id) => {
    try {
      await fetch(`/api/nexyfab/projects/${id}`, {
        method: 'DELETE',
        headers: getAuthHeader(),
      });
      set(s => ({ projects: s.projects.filter(p => p.id !== id) }));
    } catch {
      // silently ignore network errors
    }
  },

  clearError: () => set({ error: null }),
}));

export const useProjects = () => useProjectsStore();
