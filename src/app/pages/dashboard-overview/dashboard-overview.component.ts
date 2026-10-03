import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { WorkspaceService } from '../../services/workspace.service';
import { TaskService } from '../../services/task.service';
import { WorkspaceData } from '../../models/workspace.model';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-dashboard-overview',
  standalone: true,
  imports: [CommonModule, RouterLink],
  styleUrl: './dashboard-overview.component.scss',
  templateUrl: './dashboard-overview.component.html',
})
export class DashboardOverviewComponent {
  private readonly workspaceService = inject(WorkspaceService);
  private readonly taskService = inject(TaskService);

  protected readonly data = signal<WorkspaceData>({
    tasks: [],
    projects: [],
    schedule: [],
    activity: [],
    metrics: { activeProjects: 0, pendingTasks: 0, completedTasks: 0, teamMembers: 0, upcomingMeetings: 0 },
  });
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.loadData();
  }

  protected loadData(): void {
    this.loading.set(true);
    this.error.set(null);
    this.workspaceService.getDashboard().subscribe({
      next: (res) => {
        this.data.set(res);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.error?.message ?? 'Failed to load dashboard statistics.');
        this.loading.set(false);
      },
    });
  }

  protected toggleTask(task: any): void {
    const nextStatus = task.status === 'Completed' ? 'TODO' : 'COMPLETED';
    this.taskService.updateTask(task.id, { status: nextStatus }).subscribe({
      next: () => this.loadData(),
    });
  }
}
