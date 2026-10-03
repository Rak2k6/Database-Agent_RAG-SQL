import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService } from '../../services/task.service';
import { ProjectService } from '../../services/project.service';
import { TeamService } from '../../services/team.service';
import { WorkspaceTask, WorkspaceProject, TeamMember } from '../../models/workspace.model';

@Component({
  selector: 'app-my-tasks',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './my-tasks.component.html',
})
export class MyTasksComponent {
  private readonly taskService = inject(TaskService);
  private readonly projectService = inject(ProjectService);
  private readonly teamService = inject(TeamService);

  protected readonly tasks = signal<WorkspaceTask[]>([]);
  protected readonly projects = signal<WorkspaceProject[]>([]);
  protected readonly teamMembers = signal<TeamMember[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly activeTab = signal<'ALL' | 'MINE' | 'TODO' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE'>('ALL');
  protected readonly search = signal('');
  protected readonly selectedPriority = signal('');
  protected readonly selectedProject = signal('');

  // Create Task Modal State
  protected readonly showModal = signal(false);
  protected readonly editingTaskId = signal<string | null>(null);
  protected newTask = {
    title: '',
    description: '',
    project_id: '',
    assigned_to: '',
    priority: 'MEDIUM',
    status: 'TODO',
    due_date: new Date().toISOString().split('T')[0],
  };

  constructor() {
    this.loadTasks();
    this.loadDependencies();
  }

  protected loadDependencies(): void {
    this.projectService.getProjects().subscribe({
      next: (res) => this.projects.set(res.projects),
    });
    this.teamService.getTeam().subscribe({
      next: (res) => this.teamMembers.set(res.users),
    });
  }

  protected loadTasks(): void {
    this.loading.set(true);
    this.error.set(null);
    const filters: any = { search: this.search() };

    if (this.activeTab() === 'MINE') filters.assigned_to = 'me';
    if (this.activeTab() === 'TODO') filters.status = 'TODO';
    if (this.activeTab() === 'IN_PROGRESS') filters.status = 'IN_PROGRESS';
    if (this.activeTab() === 'COMPLETED') filters.status = 'COMPLETED';

    if (this.selectedPriority()) filters.priority = this.selectedPriority();
    if (this.selectedProject()) filters.project_id = this.selectedProject();

    this.taskService.getTasks(filters).subscribe({
      next: (res) => {
        let list = res.tasks ?? [];
        if (this.activeTab() === 'OVERDUE') {
          list = list.filter((t) => t.isOverdue);
        }
        this.tasks.set(list);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.error?.message ?? 'Failed to load tasks.');
        this.loading.set(false);
      },
    });
  }

  protected setTab(tab: 'ALL' | 'MINE' | 'TODO' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE'): void {
    this.activeTab.set(tab);
    this.loadTasks();
  }

  protected openCreateModal(): void {
    this.error.set(null);
    this.editingTaskId.set(null);
    this.resetTaskForm();
    if (this.projects().length > 0) {
      this.newTask.project_id = this.projects()[0].id;
    }
    this.showModal.set(true);
  }

  protected openEditModal(task: WorkspaceTask): void {
    this.error.set(null);
    this.editingTaskId.set(task.id ?? null);
    this.newTask = {
      title: task.title,
      description: task.description ?? '',
      project_id: task.projectId ?? '',
      assigned_to: task.assignedToId ?? '',
      priority: task.priority.toUpperCase(),
      status: task.status.toUpperCase().replace(' ', '_'),
      due_date: task.dueDate,
    };
    this.showModal.set(true);
  }

  protected closeCreateModal(): void {
    this.showModal.set(false);
  }

  protected submitTask(): void {
    if (!this.newTask.title || !this.newTask.project_id) return;
    this.submitting.set(true);
    this.error.set(null);
    const payload = { ...this.newTask, assigned_to: this.newTask.assigned_to || null };
    const saved = () => {
      this.submitting.set(false);
      this.editingTaskId.set(null);
      this.resetTaskForm();
      this.closeCreateModal();
      this.loadTasks();
    };
    const failed = (err: any) => {
      this.submitting.set(false);
      this.error.set(err?.error?.error?.message ?? 'Failed to save task.');
    };

    if (this.editingTaskId()) {
      this.taskService.updateTask(this.editingTaskId()!, payload).subscribe({ next: saved, error: failed });
    } else {
      this.taskService.createTask(payload).subscribe({ next: saved, error: failed });
    }
  }

  private resetTaskForm(): void {
    this.newTask = {
      title: '',
      description: '',
      project_id: '',
      assigned_to: '',
      priority: 'MEDIUM',
      status: 'TODO',
      due_date: new Date().toISOString().split('T')[0],
    };
  }

  protected updateStatus(task: WorkspaceTask, newStatus: string): void {
    if (!task.id) return;
    this.taskService.updateTask(task.id, { status: newStatus }).subscribe({
      next: () => this.loadTasks(),
      error: (err) => this.error.set(err?.error?.error?.message ?? 'Failed to update task status.'),
    });
  }

  protected deleteTask(id?: string): void {
    if (!id) return;
    if (confirm('Are you sure you want to delete this task?')) {
      this.taskService.deleteTask(id).subscribe({
        next: () => this.loadTasks(),
        error: (err) => this.error.set(err?.error?.error?.message ?? 'Failed to delete task.'),
      });
    }
  }
}
