import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { WorkspaceData } from '../models/workspace.model';

@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  private readonly api = inject(ApiService);

  getDashboard(): Observable<WorkspaceData> {
    return this.api.get<WorkspaceData>('/api/dashboard');
  }
}