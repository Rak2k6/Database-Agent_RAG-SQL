import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { AuthUser } from '../models/user.model';
import { ApiService } from './api.service';

export interface UserSettings {
  theme: string;
  notify_task_assignments: number;
  notify_project_updates: number;
  notify_upcoming_meetings: number;
  notify_deadline_reminders: number;
}

export interface SettingsResponse {
  profile: AuthUser & { role?: string; department?: string };
  settings: UserSettings;
}

export type SettingsUpdate = Partial<{
  name: string;
  department: string;
  role: string;
  profile_image: string;
  theme: string;
  notify_task_assignments: number;
  notify_project_updates: number;
  notify_upcoming_meetings: number;
  notify_deadline_reminders: number;
}>;

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly api = inject(ApiService);

  getSettings(): Observable<SettingsResponse> {
    return this.api.get<SettingsResponse>('/api/settings');
  }

  updateSettings(data: SettingsUpdate): Observable<{ message: string }> {
    return this.api.put<{ message: string }>('/api/settings', data);
  }
}