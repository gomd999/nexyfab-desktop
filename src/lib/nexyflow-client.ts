/**
 * NexyFlow API Client
 * Calls NexyFlow groupware API on behalf of the connected user.
 * Token is the user's NexyFlow JWT stored in nf_nexyflow_integrations.
 */

export interface NexyFlowTask {
  id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in-progress' | 'done';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assigneeId?: string;
  assigneeName?: string;
  dueDate?: string; // YYYY-MM-DD
  tags?: string[];
}

export interface NexyFlowCalendarEvent {
  id: string;
  title: string;
  description?: string;
  date: string;       // YYYY-MM-DD
  startTime?: string; // HH:mm
  endTime?: string;
  type?: string;
  color?: string;
}

export interface NexyFlowNotification {
  userId: string;
  type: string;
  title: string;
  message: string;
  link?: string;
}

export interface NexyFlowApprovalDocument {
  templateId?: string;
  templateName: string;
  title: string;
  content: Record<string, unknown>;
}

export class NexyFlowClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    // Normalize base URL (strip trailing slash)
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ ok: boolean; data?: T; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
      }

      const data = await res.json().catch(() => ({})) as T;
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Verify connection — calls GET /api/health */
  async testConnection(): Promise<{ ok: boolean; orgName?: string; error?: string }> {
    const res = await this.request<{ status: string }>('GET', '/api/health');
    if (!res.ok) return { ok: false, error: res.error };

    // Also fetch org info
    const orgRes = await this.request<{ organization?: { name: string } }>('GET', '/api/org/detail');
    return {
      ok: true,
      orgName: orgRes.data?.organization?.name,
    };
  }

  /** Create a task in NexyFlow */
  async createTask(task: Omit<NexyFlowTask, 'id'>): Promise<{ ok: boolean; taskId?: string; error?: string }> {
    const res = await this.request<{ task?: { id: string } }>('POST', '/api/tasks', task);
    return { ok: res.ok, taskId: res.data?.task?.id, error: res.error };
  }

  /** Update a task */
  async updateTask(taskId: string, updates: Partial<NexyFlowTask>): Promise<{ ok: boolean; error?: string }> {
    const res = await this.request('PATCH', `/api/tasks/${taskId}`, updates);
    return { ok: res.ok, error: res.error };
  }

  /** Create a calendar event */
  async createCalendarEvent(event: Omit<NexyFlowCalendarEvent, 'id'>): Promise<{ ok: boolean; eventId?: string; error?: string }> {
    const res = await this.request<{ event?: { id: string } }>('POST', '/api/calendar/add', event);
    return { ok: res.ok, eventId: res.data?.event?.id, error: res.error };
  }

  /** Update a calendar event */
  async updateCalendarEvent(eventId: string, updates: Partial<NexyFlowCalendarEvent>): Promise<{ ok: boolean; error?: string }> {
    const res = await this.request('PATCH', `/api/calendar/${eventId}`, updates);
    return { ok: res.ok, error: res.error };
  }

  /** Delete a calendar event */
  async deleteCalendarEvent(eventId: string): Promise<{ ok: boolean; error?: string }> {
    const res = await this.request('DELETE', `/api/calendar/${eventId}`);
    return { ok: res.ok, error: res.error };
  }

  /** Create an approval document */
  async createApprovalDocument(doc: NexyFlowApprovalDocument): Promise<{ ok: boolean; docId?: string; error?: string }> {
    const res = await this.request<{ document?: { id: string } }>('POST', '/api/approval/documents', doc);
    return { ok: res.ok, docId: res.data?.document?.id, error: res.error };
  }

  /** Send a notification to a specific user */
  async sendNotification(notification: NexyFlowNotification): Promise<{ ok: boolean; error?: string }> {
    // NexyFlow doesn't have a direct "send notification to user" endpoint,
    // so we post a board bulletin or use the messenger DM as notification
    // Instead we create a task mention which generates a notification
    const res = await this.request('POST', '/api/tasks', {
      title: `[NexyFab] ${notification.title}`,
      description: notification.message,
      status: 'todo',
      priority: 'medium',
      tags: ['nexyfab-notification'],
    });
    return { ok: res.ok, error: res.error };
  }

  /** Get list of people (for assignee lookup) */
  async getPeople(): Promise<{ ok: boolean; people?: Array<{ id: string; name: string; email: string }>; error?: string }> {
    const res = await this.request<{ people?: Array<{ id: string; name: string; email: string }> }>('GET', '/api/people');
    return { ok: res.ok, people: res.data?.people, error: res.error };
  }
}

/** Build a NexyFlowClient from DB integration record */
export function buildNexyFlowClient(integration: { nexyflow_url: string; access_token: string }): NexyFlowClient {
  return new NexyFlowClient(integration.nexyflow_url, integration.access_token);
}
