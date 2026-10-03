import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ProjectService } from '../../services/project.service';
import { TaskService } from '../../services/task.service';
import { WorkspaceProject, WorkspaceTask } from '../../models/workspace.model';

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './project-detail.component.html',
  styleUrl: './project-detail.component.scss',
})
export class ProjectDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly projectService = inject(ProjectService);
  private readonly taskService = inject(TaskService);

  protected readonly project = signal<WorkspaceProject | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.route.params.subscribe((params) => {
      const id = params['id'];
      if (id) this.loadProject(id);
    });
  }

  protected loadProject(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.projectService.getProject(id).subscribe({
      next: (res) => {
        this.project.set(res.project);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Project not found or failed to load.');
        this.loading.set(false);
      },
    });
  }

  protected toggleTask(task: WorkspaceTask): void {
    if (!task.id) return;
    const nextStatus = this.isTaskCompleted(task) ? 'TODO' : 'COMPLETED';
    this.taskService.updateTask(task.id, { status: nextStatus }).subscribe({
      next: () => {
        if (this.project()) this.loadProject(this.project()!.id);
      },
    });
  }

  protected isTaskCompleted(task: WorkspaceTask): boolean {
    return task.status.toUpperCase() === 'COMPLETED';
  }

  protected formatStatus(status: string): string {
    return status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  protected taskStatusClass(status: string): string {
    return status.toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
  }

  protected deleteProject(): void {
    if (!this.project()) return;
    if (confirm(`Are you sure you want to delete project "${this.project()!.name}"?`)) {
      this.projectService.deleteProject(this.project()!.id).subscribe({
        next: () => this.router.navigate(['/projects']),
      });
    }
  }
}
