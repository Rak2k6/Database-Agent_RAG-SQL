import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Server } from 'node:http';
import { after, before, test } from 'node:test';
import DatabaseConnection from 'better-sqlite3';
import type Database from 'better-sqlite3';

process.env.DB_PATH = 'server/data/api-tests.sqlite';
process.env.RESET_EMAIL_MODE = 'mock';
process.env.WEB_ORIGIN = 'http://localhost:4200';

let server: Server;
let database: Database.Database;
let databasePath: string;
let baseUrl: string;

before(async () => {
  const [{ createApp }, dbModule] = await Promise.all([
    import('./server.js'),
    import('./db.js'),
  ]);
  database = dbModule.database;
  databasePath = dbModule.databasePath;
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  database.close();
});

test('local account lifecycle hashes secrets and revokes sessions and reset links', async () => {
  const email = `integration-${randomUUID()}@northstarai.com`;
  const signupResponse = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Integration User', email, password: 'InitialPass123' }),
  });
  assert.equal(signupResponse.status, 201);
  const signupBody = await signupResponse.json() as { user: Record<string, unknown> };
  assert.equal(signupBody.user.email, email);
  assert.equal('password_hash' in signupBody.user, false);
  assert.equal('passwordHash' in signupBody.user, false);

  const signupCookie = signupResponse.headers.get('set-cookie')?.split(';')[0];
  assert(signupCookie);
  assert(signupCookie.startsWith('northstar_session='));
  assert.match(signupResponse.headers.get('set-cookie') ?? '', /HttpOnly/i);
  const storedUser = database.prepare('SELECT password_hash FROM users WHERE email = ?').get(email) as { password_hash: string };
  assert.notEqual(storedUser.password_hash, 'InitialPass123');
  assert.match(storedUser.password_hash, /^\$2[aby]\$/);

  const duplicateResponse = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Duplicate User', email, password: 'InitialPass123' }),
  });
  assert.equal(duplicateResponse.status, 409);

  const signupSessionResponse = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: signupCookie } });
  assert.equal(signupSessionResponse.status, 200);

  const forgotResponse = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const forgotBody = await forgotResponse.json() as { delivery: string; resetUrl: string; message: string };
  assert.equal(forgotBody.delivery, 'mock');
  assert.match(forgotBody.message, /No email was sent/);
  const token = new URL(forgotBody.resetUrl).pathname.split('/').at(-1)!;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const resetRow = database.prepare('SELECT token_hash FROM password_reset_tokens WHERE token_hash = ?').get(tokenHash) as { token_hash: string } | undefined;
  assert.equal(resetRow?.token_hash, tokenHash);
  assert.notEqual(resetRow?.token_hash, token);

  const resetResponse = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, password: 'UpdatedPass123' }),
  });
  assert.equal(resetResponse.status, 200);
  const revokedSessionResponse = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: signupCookie } });
  assert.equal(revokedSessionResponse.status, 401);

  const reusedTokenResponse = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, password: 'AnotherPass123' }),
  });
  assert.equal(reusedTokenResponse.status, 400);

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'UpdatedPass123', rememberMe: true }),
  });
  assert.equal(loginResponse.status, 200);
  const loginCookie = loginResponse.headers.get('set-cookie')?.split(';')[0];
  assert(loginCookie);

  const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: loginCookie },
    body: '{}',
  });
  assert.equal(logoutResponse.status, 204);
  const loggedOutResponse = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: loginCookie } });
  assert.equal(loggedOutResponse.status, 401);
});

test('workplace REST endpoints for dashboard, projects, tasks, calendar, documents and settings', async () => {
  const corsRes = await fetch(`${baseUrl}/api/health`, { headers: { origin: 'http://localhost:4300' } });
  assert.equal(corsRes.status, 200);
  assert.equal(corsRes.headers.get('access-control-allow-origin'), 'http://localhost:4300');

  const email = `workplace-${randomUUID()}@northstarai.com`;
  const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Workplace Tester', email, password: 'PassWord123!' }),
  });
  assert.equal(signupRes.status, 201);
  const { user } = await signupRes.json() as { user: { id: string } };
  const cookie = signupRes.headers.get('set-cookie')?.split(';')[0]!;

  // GET /api/dashboard
  const dashRes = await fetch(`${baseUrl}/api/dashboard`, { headers: { cookie } });
  assert.equal(dashRes.status, 200);
  const dashData = await dashRes.json() as any;
  assert.ok(dashData.metrics);
  assert.equal(typeof dashData.metrics.activeProjects, 'number');

  // POST /api/team and GET /api/team
  const teamEmail = `team-${randomUUID()}@northstarai.com`;
  const addMemberRes = await fetch(`${baseUrl}/api/team`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'New Team Member', email: teamEmail, role: 'Engineer', department: 'Engineering' }),
  });
  assert.equal(addMemberRes.status, 201);
  const teamRes = await fetch(`${baseUrl}/api/team?search=${encodeURIComponent(teamEmail)}`, { headers: { cookie } });
  assert.equal(teamRes.status, 200);
  assert.equal((await teamRes.json() as any).users[0].email, teamEmail);

  // POST /api/projects
  const projRes = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      name: 'Test Project Alpha',
      description: 'Testing project creation',
      status: 'ACTIVE',
      start_date: '2026-10-01',
      due_date: '2026-10-31',
    }),
  });
  assert.equal(projRes.status, 201);
  const { id: projectId } = await projRes.json() as any;
  const projectsRes = await fetch(`${baseUrl}/api/projects`, { headers: { cookie } });
  assert.equal((await projectsRes.json() as any).projects.some((project: any) => project.id === projectId), true);

  const updateProjectRes = await fetch(`${baseUrl}/api/projects/${projectId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ description: 'Updated project description' }),
  });
  assert.equal(updateProjectRes.status, 200);

  // POST /api/tasks
  const taskRes = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      title: 'Build test harness',
      description: 'Unit testing task endpoint',
      project_id: projectId,
      priority: 'HIGH',
      status: 'TODO',
      due_date: '2026-10-15',
    }),
  });
  assert.equal(taskRes.status, 201);
  const { id: taskId } = await taskRes.json() as any;

  // PUT /api/tasks/:id (Complete task)
  const completeTaskRes = await fetch(`${baseUrl}/api/tasks/${taskId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ status: 'COMPLETED' }),
  });
  assert.equal(completeTaskRes.status, 200);

  const tasksRes = await fetch(`${baseUrl}/api/tasks?project_id=${projectId}`, { headers: { cookie } });
  assert.equal((await tasksRes.json() as any).tasks[0].status, 'COMPLETED');

  // GET /api/projects/:id
  const getProjRes = await fetch(`${baseUrl}/api/projects/${projectId}`, { headers: { cookie } });
  assert.equal(getProjRes.status, 200);
  const projDetail = await getProjRes.json() as any;
  assert.equal(projDetail.project.completedTasks, 1);
  assert.equal(projDetail.project.progress, 100);

  // POST /api/calendar
  const eventRes = await fetch(`${baseUrl}/api/calendar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      title: 'Sprint Demo',
      description: 'Demoing current sprint features',
      start_time: '2026-10-10T10:00:00Z',
      end_time: '2026-10-10T11:00:00Z',
      event_type: 'MEETING',
      project_id: projectId,
    }),
  });
  assert.equal(eventRes.status, 201);
  const { id: eventId } = await eventRes.json() as any;
  const eventsRes = await fetch(`${baseUrl}/api/calendar`, { headers: { cookie } });
  assert.equal((await eventsRes.json() as any).events.some((event: any) => event.id === eventId), true);

  const deleteEventRes = await fetch(`${baseUrl}/api/calendar/${eventId}`, { method: 'DELETE', headers: { cookie } });
  assert.equal(deleteEventRes.status, 200);
  assert.equal(database.prepare('SELECT id FROM calendar_events WHERE id = ?').get(eventId), undefined);

  // POST /api/documents, GET /api/documents, DELETE /api/documents/:id
  const documentRes = await fetch(`${baseUrl}/api/documents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'Test Document', file_name: 'test-document.pdf', file_type: 'application/pdf', file_size: 1024, folder: 'QA' }),
  });
  assert.equal(documentRes.status, 201);
  const { id: documentId } = await documentRes.json() as any;
  const documentsRes = await fetch(`${baseUrl}/api/documents`, { headers: { cookie } });
  assert.equal((await documentsRes.json() as any).documents.some((document: any) => document.id === documentId), true);
  const deleteDocumentRes = await fetch(`${baseUrl}/api/documents/${documentId}`, { method: 'DELETE', headers: { cookie } });
  assert.equal(deleteDocumentRes.status, 200);
  assert.equal(database.prepare('SELECT id FROM documents WHERE id = ?').get(documentId), undefined);

  // GET /api/reports
  const reportRes = await fetch(`${baseUrl}/api/reports`, { headers: { cookie } });
  assert.equal(reportRes.status, 200);

  // PUT /api/settings
  const settingsRes = await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ theme: 'dark', department: 'Engineering' }),
  });
  assert.equal(settingsRes.status, 200);
  const getSettingsRes = await fetch(`${baseUrl}/api/settings`, { headers: { cookie } });
  assert.equal((await getSettingsRes.json() as any).settings.theme, 'dark');

  // PATCH /api/notifications/:id/read writes through to SQLite.
  const notificationId = `notif_${randomUUID()}`;
  database.prepare(`INSERT INTO notifications (id, user_id, title, message, type, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(notificationId, user.id, 'Test notification', 'Test message', 'test', 0, new Date().toISOString());
  const markReadRes = await fetch(`${baseUrl}/api/notifications/${notificationId}/read`, { method: 'PATCH', headers: { cookie } });
  assert.equal(markReadRes.status, 200);
  assert.equal((database.prepare('SELECT is_read FROM notifications WHERE id = ?').get(notificationId) as { is_read: number }).is_read, 1);

  const deleteTaskRes = await fetch(`${baseUrl}/api/tasks/${taskId}`, { method: 'DELETE', headers: { cookie } });
  assert.equal(deleteTaskRes.status, 200);
  assert.equal(database.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId), undefined);

  const deleteProjectRes = await fetch(`${baseUrl}/api/projects/${projectId}`, { method: 'DELETE', headers: { cookie } });
  assert.equal(deleteProjectRes.status, 200);
  assert.equal(database.prepare('SELECT id FROM projects WHERE id = ?').get(projectId), undefined);

  const diskDatabase = new DatabaseConnection(databasePath, { readonly: true });
  assert.equal((diskDatabase.prepare('SELECT id FROM users WHERE id = ?').get(user.id) as { id: string }).id, user.id);
  assert.equal((diskDatabase.prepare('SELECT theme FROM user_settings WHERE user_id = ?').get(user.id) as { theme: string }).theme, 'dark');
  diskDatabase.close();
});
