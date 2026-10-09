import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from './api.service';
import { DocumentService } from './document.service';

describe('DocumentService', () => {
  const api = {
    post: vi.fn((_path: string, _body: unknown) => of({ id: 'doc-1', message: 'Document added.' })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        DocumentService,
        { provide: ApiService, useValue: api },
      ],
    });
  });

  it('posts the file and metadata as multipart FormData to the existing documents endpoint', () => {
    const service = TestBed.inject(DocumentService);
    const metadata = {
      name: 'Project requirements',
      folder: 'Planning',
      project_id: 'project-1',
    };
    const file = new File(['# Requirements'], 'requirements.md', { type: 'text/markdown' });

    service.uploadDocument(file, metadata).subscribe();

    expect(api.post).toHaveBeenCalledWith('/api/documents', expect.any(FormData));
    const formData = api.post.mock.calls[0]?.[1];
    if (!(formData instanceof FormData)) throw new Error('Expected the document upload request to be multipart FormData.');
    expect(formData.get('file')).toMatchObject({ name: file.name, size: file.size, type: file.type });
    expect(formData.get('name')).toBe(metadata.name);
    expect(formData.get('folder')).toBe(metadata.folder);
    expect(formData.get('project_id')).toBe(metadata.project_id);
  });
});
