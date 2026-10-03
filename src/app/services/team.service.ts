import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { TeamMember } from '../models/workspace.model';

@Injectable({ providedIn: 'root' })
export class TeamService {
  private readonly api = inject(ApiService);

  getTeam(search = '', department = ''): Observable<{ users: TeamMember[] }> {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (department) params.append('department', department);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.api.get<{ users: TeamMember[] }>(`/api/team${query}`);
  }

  addMember(data: { name: string; email: string; role: string; department: string }): Observable<{ id: string; message: string }> {
    return this.api.post<{ id: string; message: string }>('/api/team', data);
  }
}
