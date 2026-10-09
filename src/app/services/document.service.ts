import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { DocumentItem } from '../models/workspace.model';

@Injectable({ providedIn: 'root' })
export class DocumentService {
  private readonly api = inject(ApiService);

  getDocuments(search = ''): Observable<{ documents: DocumentItem[] }> {
    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    return this.api.get<{ documents: DocumentItem[] }>(`/api/documents${query}`);
  }

  uploadDocument(
    file: File,
    data: { name: string; folder: string; project_id: string },
  ): Observable<{ id: string; message: string }> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    formData.append('name', data.name);
    formData.append('folder', data.folder);
    formData.append('project_id', data.project_id);
    return this.api.post<{ id: string; message: string }>('/api/documents', formData);
  }

  deleteDocument(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`/api/documents/${id}`);
  }
}
