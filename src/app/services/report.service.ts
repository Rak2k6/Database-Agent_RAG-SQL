import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { ReportAnalytics } from '../models/workspace.model';

@Injectable({ providedIn: 'root' })
export class ReportService {
  private readonly api = inject(ApiService);

  getReports(): Observable<ReportAnalytics> {
    return this.api.get<ReportAnalytics>('/api/reports');
  }
}
