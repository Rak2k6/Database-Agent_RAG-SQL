import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { WorkspaceProject } from '../models/workspace.model';

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly api = inject(ApiService);

  getProjects(search = '', status = ''): Observable<{ projects: WorkspaceProject[] }> {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (status) params.append('status', status);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.api.get<{ projects: WorkspaceProject[] }>(`/api/projects${query}`);
  }

  getProject(id: string): Observable<{ project: WorkspaceProject }> {
    return this.api.get<{ project: WorkspaceProject }>(`/api/projects/${id}`);
  }

  createProject(data: { name: string; description?: string; status?: string; start_date: string; due_date: string }): Observable<{ id: string; message: string }> {
    return this.api.post<{ id: string; message: string }>('/api/projects', data);
  }

  updateProject(id: string, data: Partial<{ name: string; description: string; status: string; start_date: string; due_date: string }>): Observable<{ message: string }> {
    return this.api.put<{ message: string }>(`/api/projects/${id}`, data);
  }

  deleteProject(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`/api/projects/${id}`);
  }
}
