import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ProjectService } from '../../services/project.service';
import { WorkspaceProject } from '../../models/workspace.model';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './projects.component.html',
})
export class ProjectsComponent {
  private readonly projectService = inject(ProjectService);

  protected readonly projects = signal<WorkspaceProject[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly search = signal('');
  protected readonly selectedStatus = signal('');
  protected readonly showModal = signal(false);
  protected readonly editingProjectId = signal<string | null>(null);

  protected newProject = {
    name: '',
    description: '',
    status: 'ACTIVE',
    start_date: new Date().toISOString().split('T')[0],
    due_date: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0],
  };

  constructor() {
    this.loadProjects();
  }

  protected loadProjects(): void {
    this.loading.set(true);
    this.error.set(null);
    this.projectService.getProjects(this.search(), this.selectedStatus()).subscribe({
      next: (res) => {
        this.projects.set(res.projects ?? []);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.error?.message ?? 'Failed to load projects.');
        this.loading.set(false);
      },
    });
  }

  protected openCreateModal(): void {
    this.error.set(null);
    this.editingProjectId.set(null);
    this.resetProjectForm();
    this.showModal.set(true);
  }

  protected openEditModal(project: WorkspaceProject): void {
    this.error.set(null);
    this.editingProjectId.set(project.id);
    this.newProject = {
      name: project.name,
      description: project.description ?? '',
      status: project.status,
      start_date: project.startDate ?? '',
      due_date: project.dueDate ?? project.deadline ?? '',
    };
    this.showModal.set(true);
  }

  protected closeCreateModal(): void {
    this.showModal.set(false);
  }

  protected submitProject(): void {
    if (!this.newProject.name) return;
    this.submitting.set(true);
    this.error.set(null);
    const saved = () => {
      this.submitting.set(false);
      this.editingProjectId.set(null);
      this.resetProjectForm();
      this.closeCreateModal();
      this.loadProjects();
    };
    const failed = (err: any) => {
      this.submitting.set(false);
      this.error.set(err?.error?.error?.message ?? 'Failed to save project.');
    };

    if (this.editingProjectId()) {
      this.projectService.updateProject(this.editingProjectId()!, this.newProject).subscribe({ next: saved, error: failed });
    } else {
      this.projectService.createProject(this.newProject).subscribe({ next: saved, error: failed });
    }
  }

  protected deleteProject(project: WorkspaceProject): void {
    if (confirm(`Are you sure you want to delete project "${project.name}"?`)) {
      this.projectService.deleteProject(project.id).subscribe({
        next: () => this.loadProjects(),
        error: (err) => this.error.set(err?.error?.error?.message ?? 'Failed to delete project.'),
      });
    }
  }

  protected formatStatus(status: string): string {
    return status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  private resetProjectForm(): void {
    this.newProject = {
      name: '',
      description: '',
      status: 'ACTIVE',
      start_date: new Date().toISOString().split('T')[0],
      due_date: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0],
    };
  }
}
