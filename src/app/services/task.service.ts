import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { WorkspaceTask } from '../models/workspace.model';

@Injectable({ providedIn: 'root' })
export class TaskService {
  private readonly api = inject(ApiService);

  getTasks(filters?: { assigned_to?: string; project_id?: string; status?: string; priority?: string; search?: string }): Observable<{ tasks: WorkspaceTask[] }> {
    const params = new URLSearchParams();
    if (filters?.assigned_to) params.append('assigned_to', filters.assigned_to);
    if (filters?.project_id) params.append('project_id', filters.project_id);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.priority) params.append('priority', filters.priority);
    if (filters?.search) params.append('search', filters.search);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.api.get<{ tasks: WorkspaceTask[] }>(`/api/tasks${query}`);
  }

  createTask(data: { title: string; description?: string; project_id: string; assigned_to?: string | null; priority?: string; status?: string; due_date: string }): Observable<{ id: string; message: string }> {
    return this.api.post<{ id: string; message: string }>('/api/tasks', data);
  }

  updateTask(id: string, data: Partial<{ title: string; description: string; project_id: string; assigned_to: string | null; priority: string; status: string; due_date: string }>): Observable<{ message: string }> {
    return this.api.put<{ message: string }>(`/api/tasks/${id}`, data);
  }

  deleteTask(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`/api/tasks/${id}`);
  }
}
