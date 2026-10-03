import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { WorkspaceEvent } from '../models/workspace.model';

@Injectable({ providedIn: 'root' })
export class CalendarService {
  private readonly api = inject(ApiService);

  getEvents(): Observable<{ events: WorkspaceEvent[] }> {
    return this.api.get<{ events: WorkspaceEvent[] }>('/api/calendar');
  }

  createEvent(data: { title: string; description?: string; start_time: string; end_time: string; event_type?: string; project_id?: string | null }): Observable<{ id: string; message: string }> {
    return this.api.post<{ id: string; message: string }>('/api/calendar', data);
  }

  deleteEvent(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`/api/calendar/${id}`);
  }
}
