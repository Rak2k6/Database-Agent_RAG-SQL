import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentService } from '../../services/document.service';
import { ProjectService } from '../../services/project.service';
import { AuthService } from '../../services/auth.service';
import { DocumentsComponent } from './documents.component';

describe('DocumentsComponent', () => {
  const documentService = {
    getDocuments: vi.fn(() => of({ documents: [] })),
    uploadDocument: vi.fn(() => of({ id: 'doc-1', message: 'Document added.' })),
    deleteDocument: vi.fn(() => of({ message: 'Document deleted.' })),
  };
  const projectService = {
    getProjects: vi.fn(() => of({ projects: [
      { id: 'project-1', name: 'Northstar', description: '', progress: 0, status: 'ACTIVE', members: [{ id: 'user-1', name: 'Member', email: '', role: 'Member' }] },
      { id: 'project-2', name: 'Other project', description: '', progress: 0, status: 'ACTIVE', members: [{ id: 'user-2', name: 'Other', email: '', role: 'Member' }] },
    ] })),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [DocumentsComponent],
      providers: [
        { provide: DocumentService, useValue: documentService },
        { provide: ProjectService, useValue: projectService },
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'user-1' }) } },
      ],
    }).compileComponents();
  });

  it('only offers projects where the signed-in user is a member', () => {
    const fixture = TestBed.createComponent(DocumentsComponent);
    fixture.detectChanges();
    const addButton = [...fixture.nativeElement.querySelectorAll('button')]
      .find((button: HTMLButtonElement) => button.textContent.includes('Add Document')) as HTMLButtonElement;
    addButton.click();
    fixture.detectChanges();
    const projectOptions = [...fixture.nativeElement.querySelectorAll('select[name="project_id"] option')]
      .map((option: HTMLOptionElement) => option.value)
      .filter(Boolean);
    expect(projectOptions).toEqual(['project-1']);
  });

  it('supports Browse Files and posts the selected file metadata with required fields', () => {
    const fixture = TestBed.createComponent(DocumentsComponent);
    fixture.detectChanges();

    const addButton = [...fixture.nativeElement.querySelectorAll('button')]
      .find((button: HTMLButtonElement) => button.textContent.includes('Add Document')) as HTMLButtonElement;
    addButton.click();
    fixture.detectChanges();

    const fileInput = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click');
    const browseButton = [...fixture.nativeElement.querySelectorAll('button')]
      .find((button: HTMLButtonElement) => button.textContent.includes('Browse Files')) as HTMLButtonElement;
    browseButton.click();
    expect(clickSpy).toHaveBeenCalled();

    const file = new File(['# Requirements'], 'requirements.md', { type: 'text/markdown' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('requirements.md');
    expect(fixture.nativeElement.textContent).toContain('text/markdown');

    const nameInput = fixture.nativeElement.querySelector('input[name="name"]') as HTMLInputElement;
    expect(nameInput.required).toBe(true);
    expect(fixture.nativeElement.querySelector('select[name="project_id"]').required).toBe(true);
    expect(fixture.nativeElement.querySelector('input[name="folder"]').required).toBe(true);

    fixture.componentInstance['newDocument'] = {
      name: 'Project requirements',
      project_id: 'project-1',
      folder: 'Planning',
    };
    fixture.componentInstance['addDocument']();

    expect(documentService.uploadDocument).toHaveBeenCalledWith(file, {
      name: 'Project requirements',
      folder: 'Planning',
      project_id: 'project-1',
    });
  });

  it('accepts dropped files and rejects unsupported file types', () => {
    const fixture = TestBed.createComponent(DocumentsComponent);
    fixture.detectChanges();
    const addButton = [...fixture.nativeElement.querySelectorAll('button')]
      .find((button: HTMLButtonElement) => button.textContent.includes('Add Document')) as HTMLButtonElement;
    addButton.click();
    fixture.detectChanges();

    const dropZone = fixture.nativeElement.querySelector('.document-drop-zone') as HTMLElement;
    const file = new File(['document'], 'brief.docx', { type: 'application/octet-stream' });
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } });
    dropZone.dispatchEvent(drop);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('brief.docx');

    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['image'], 'unsupported.png', { type: 'image/png' })],
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Choose a PDF, DOCX, or Markdown file.');
    expect(fixture.nativeElement.textContent).not.toContain('brief.docx');
  });
});
