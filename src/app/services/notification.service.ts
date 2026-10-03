import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { NotificationItem } from '../models/workspace.model';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly api = inject(ApiService);

  getNotifications(): Observable<{ notifications: NotificationItem[]; unreadCount: number }> {
    return this.api.get<{ notifications: NotificationItem[]; unreadCount: number }>('/api/notifications');
  }

  markRead(id: string): Observable<{ message: string }> {
    return this.api.patch<{ message: string }>(`/api/notifications/${id}/read`);
  }

  markAllRead(): Observable<{ message: string }> {
    return this.api.patch<{ message: string }>('/api/notifications/read-all');
  }
}
