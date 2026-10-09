import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canUploadDocumentToProject } from './document-authorization.js';

test('allows an authenticated project member to upload', async () => {
  const allowed = await canUploadDocumentToProject('project-1', 'user-1', async () => [
    { user_id: 'user-1' },
    { user_id: 'user-2' },
  ]);
  assert.equal(allowed, true);
});

test('denies an authenticated user who is not a project member', async () => {
  const allowed = await canUploadDocumentToProject('project-1', 'user-3', async () => [
    { user_id: 'user-1' },
  ]);
  assert.equal(allowed, false);
});

test('denies an invalid or inaccessible project with no membership rows', async () => {
  let lookedUpProject = '';
  const allowed = await canUploadDocumentToProject('missing-project', 'user-1', async (projectId) => {
    lookedUpProject = projectId;
    return [];
  });
  assert.equal(lookedUpProject, 'missing-project');
  assert.equal(allowed, false);
});
