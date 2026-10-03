import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DocumentItem } from '../../models/workspace.model';
import { DocumentService } from '../../services/document.service';

@Component({
  selector: 'app-documents',
  imports: [DatePipe, FormsModule],
  templateUrl: './documents.component.html',
})
export class DocumentsComponent {
  private readonly documentService = inject(DocumentService);

  protected readonly documents = signal<DocumentItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly search = signal('');
  protected readonly showForm = signal(false);
  protected readonly error = signal('');
  protected newDocument = { name: '', file_name: '', file_type: 'application/pdf', file_size: 1024, folder: 'General' };

  constructor() {
    this.loadDocuments();
  }

  protected loadDocuments(): void {
    this.loading.set(true);
    this.documentService.getDocuments(this.search()).subscribe({
      next: ({ documents }) => {
        this.documents.set(documents);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected addDocument(): void {
    this.error.set('');
    this.documentService.uploadDocument(this.newDocument).subscribe({
      next: () => {
        this.newDocument = { name: '', file_name: '', file_type: 'application/pdf', file_size: 1024, folder: 'General' };
        this.showForm.set(false);
        this.loadDocuments();
      },
      error: (err) => this.error.set(err?.error?.error?.message ?? 'Could not add this document record.'),
    });
  }

  protected deleteDocument(document: DocumentItem): void {
    if (!confirm(`Delete "${document.name}"?`)) return;
    this.documentService.deleteDocument(document.id).subscribe({ next: () => this.loadDocuments() });
  }

  protected formatSize(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
}