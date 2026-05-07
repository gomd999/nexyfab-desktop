'use client';

import { create } from 'zustand';
import type { NexyfabProject } from '@/app/api/nexyfab/projects/projects-types';

type ProjectRole = NexyfabProject['role'];

interface CloudProjectAccessState {
  hydrated: boolean;
  projectId: string | null;
  canEdit: boolean;
  role: ProjectRole;
}

interface CloudProjectAccessActions {
  setFromApiProject: (
    projectId: string,
    partial: Pick<NexyfabProject, 'role' | 'canEdit'>,
  ) => void;
  reset: () => void;
}

const initial: CloudProjectAccessState = {
  hydrated: false,
  projectId: null,
  canEdit: true,
  role: undefined,
};

export const useCloudProjectAccessStore = create<CloudProjectAccessState & CloudProjectAccessActions>()(
  set => ({
    ...initial,
    setFromApiProject: (projectId, partial) =>
      set({
        hydrated: true,
        projectId,
        canEdit: partial.canEdit !== false,
        role: partial.role,
      }),
    reset: () => set(initial),
  }),
);
