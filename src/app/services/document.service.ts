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

  uploadDocument(data: { name: string; file_name: string; file_type?: string; file_size?: number; folder?: string; project_id?: string | null }): Observable<{ id: string; message: string }> {
    return this.api.post<{ id: string; message: string }>('/api/documents', data);
  }

  deleteDocument(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`/api/documents/${id}`);
  }
}
