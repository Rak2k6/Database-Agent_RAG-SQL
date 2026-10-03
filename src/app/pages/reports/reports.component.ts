import { Component, inject, signal } from '@angular/core';
import { ReportAnalytics } from '../../models/workspace.model';
import { ReportService } from '../../services/report.service';

@Component({
  selector: 'app-reports',
  templateUrl: './reports.component.html',
})
export class ReportsComponent {
  private readonly reportService = inject(ReportService);

  protected readonly report = signal<ReportAnalytics | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  constructor() {
    this.reportService.getReports().subscribe({
      next: (data) => {
        this.report.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Reports could not be loaded.');
        this.loading.set(false);
      },
    });
  }

  protected percent(value: number, total: number): number {
    return total ? Math.round((value / total) * 100) : 0;
  }
}