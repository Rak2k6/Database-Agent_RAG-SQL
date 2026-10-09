import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DocumentItem, WorkspaceProject } from '../../models/workspace.model';
import { DocumentService } from '../../services/document.service';
import { ProjectService } from '../../services/project.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-documents',
  imports: [DatePipe, FormsModule],
  templateUrl: './documents.component.html',
  styleUrl: './documents.component.scss',
})
export class DocumentsComponent {
  private readonly documentService = inject(DocumentService);
  private readonly projectService = inject(ProjectService);
  private readonly authService = inject(AuthService);

  protected readonly documents = signal<DocumentItem[]>([]);
  protected readonly projects = signal<WorkspaceProject[]>([]);
  protected readonly loading = signal(true);
  protected readonly projectLoading = signal(true);
  protected readonly submitting = signal(false);
  protected readonly dragging = signal(false);
  protected readonly search = signal('');
  protected readonly showForm = signal(false);
  protected readonly error = signal('');
  protected readonly projectError = signal('');
  protected readonly success = signal('');
  protected readonly selectedFile = signal<File | null>(null);
  protected newDocument = { name: '', project_id: '', folder: '' };

  constructor() {
    this.loadDocuments();
    this.loadProjects();
  }

  protected loadDocuments(): void {
    this.loading.set(true);
    this.error.set('');
    this.documentService.getDocuments(this.search()).subscribe({
      next: ({ documents }) => {
        this.documents.set(documents);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.error?.message ?? 'Could not load documents. Please try again.');
        this.loading.set(false);
      },
    });
  }

  protected loadProjects(): void {
    this.projectLoading.set(true);
    this.projectError.set('');
    this.projectService.getProjects().subscribe({
      next: ({ projects }) => {
        const userId = this.authService.currentUser()?.id;
        this.projects.set(userId ? projects.filter((project) => project.members?.some((member) => member.id === userId)) : []);
        this.projectLoading.set(false);
      },
      error: (err) => {
        this.projectError.set(err?.error?.error?.message ?? 'Could not load projects. Please try again.');
        this.projectLoading.set(false);
      },
    });
  }

  protected openForm(): void {
    this.error.set('');
    this.success.set('');
    this.newDocument = { name: '', project_id: '', folder: '' };
    this.selectedFile.set(null);
    this.showForm.set(true);
  }

  protected closeForm(): void {
    if (this.submitting()) return;
    this.showForm.set(false);
    this.selectedFile.set(null);
  }

  protected onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectFile(input.files?.[0] ?? null);
    input.value = '';
  }

  protected onFileDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.selectFile(event.dataTransfer?.files[0] ?? null);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    if (!event.currentTarget || !(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
      this.dragging.set(false);
    }
  }

  protected removeFile(): void {
    this.selectedFile.set(null);
    this.error.set('');
  }

  protected addDocument(): void {
    this.error.set('');
    const file = this.selectedFile();
    if (!file || !this.newDocument.name.trim() || !this.newDocument.project_id || !this.newDocument.folder.trim()) {
      this.error.set('Choose a supported file and complete all required fields.');
      return;
    }

    this.submitting.set(true);
    this.documentService.uploadDocument(file, {
      name: this.newDocument.name.trim(),
      folder: this.newDocument.folder.trim(),
      project_id: this.newDocument.project_id,
    }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.showForm.set(false);
        this.selectedFile.set(null);
        this.success.set('Document added successfully.');
        this.loadDocuments();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.error?.message ?? 'Could not add this document. Please try again.');
      },
    });
  }

  protected deleteDocument(document: DocumentItem): void {
    if (!confirm(`Delete "${document.name}"?`)) return;
    this.error.set('');
    this.success.set('');
    this.documentService.deleteDocument(document.id).subscribe({
      next: () => {
        this.success.set('Document deleted successfully.');
        this.loadDocuments();
      },
      error: (err) => this.error.set(err?.error?.error?.message ?? 'Could not delete this document. Please try again.'),
    });
  }

  protected formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
  }

  protected fileType(file: File): string {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension === 'pdf') return 'application/pdf';
    if (extension === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return 'text/markdown';
  }

  private selectFile(file: File | null): void {
    this.error.set('');
    if (!file) return;
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['pdf', 'docx', 'md'].includes(extension ?? '')) {
      this.selectedFile.set(null);
      this.error.set('Choose a PDF, DOCX, or Markdown file.');
      return;
    }
    if (file.name.length > 246) {
      this.selectedFile.set(null);
      this.error.set('The file name must be 246 characters or fewer.');
      return;
    }
    if (file.size === 0) {
      this.selectedFile.set(null);
      this.error.set('The selected file is empty. Choose a non-empty file.');
      return;
    }
    this.selectedFile.set(file);
  }
}
