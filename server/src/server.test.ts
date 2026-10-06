import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { Server } from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import pg from 'pg';
import type { Client, Pool } from 'pg';

import 'dotenv/config';

const { Client: PostgreSQLClient } = pg;

process.env.NODE_ENV = 'test';
process.env.RESET_EMAIL_MODE = 'mock';
process.env.WEB_ORIGIN = 'http://localhost:4200';

let server: Server;
let pool: Pool;
let setupClient: Client;
let testSchema: string;
let baseUrl: string;

before(async () => {
  const connectionString = process.env.PG_URI;
  if (!connectionString) {
    throw new Error('PG_URI must point to a PostgreSQL instance for API tests.');
  }

  setupClient = new PostgreSQLClient({ connectionString });
  await setupClient.connect();
  testSchema = `api_test_${randomUUID().replaceAll('-', '')}`;
  await setupClient.query(`CREATE SCHEMA "${testSchema}"`);

  try {
    await setupClient.query(`SET search_path TO "${testSchema}", public`);
    const schemaSql = await readFile(
      path.resolve(process.cwd(), 'server', 'db', 'postgres', 'schema.sql'),
      'utf8',
    );
    await setupClient.query(schemaSql);

    const routineFiles = [
      'functions/fn_log_activity.sql',
      'functions/fn_create_notification.sql',
      'views/v_task_stats.sql',
      'views/v_project_stats.sql',
      'views/v_project_summary.sql',
      'views/v_recent_activities.sql',
      'functions/get_project_detail.sql',
      'functions/get_project_members.sql',
      'functions/list_projects.sql',
      'functions/list_tasks.sql',
      'functions/list_calendar_events.sql',
      'functions/list_documents.sql',
      'functions/list_team_members.sql',
      'functions/get_team_workload.sql',
      'functions/get_dashboard_data.sql',
      'procedures/proc_reset_user_password.sql',
      'procedures/proc_create_project.sql',
      'procedures/proc_update_project.sql',
      'procedures/proc_create_task.sql',
      'procedures/proc_update_task.sql',
    ];
    for (const routineFile of routineFiles) {
      const routineSql = await readFile(
        path.resolve(process.cwd(), 'server', 'database', routineFile),
        'utf8',
      );
      await setupClient.query(routineSql);
    }

    const testConnection = new URL(connectionString);
    const existingOptions = testConnection.searchParams.get('options');
    testConnection.searchParams.set(
      'options',
      [existingOptions, `-csearch_path=${testSchema},public`].filter(Boolean).join(' '),
    );
    process.env.PG_URI = testConnection.toString();

    const [{ createApp }, poolModule] = await Promise.all([
      import('./server.js'),
      import('./db/pool.js'),
    ]);
    pool = poolModule.pool;
    server = createApp().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    baseUrl = `http://127.0.0.1:${address.port}`;
  } catch (error) {
    await setupClient.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
    await setupClient.end();
    throw error;
  }
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (pool) await pool.end();
  if (testSchema) await setupClient.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
  if (setupClient) await setupClient.end();
});

test('PostgreSQL seed preserves the demo dataset and remains idempotent', async () => {
  const { seedDatabase } = await import('./seed.js');
  await seedDatabase();

  const firstCounts = await pool.query<{ users: string; projects: string; tasks: string }>(`
    SELECT
      (SELECT COUNT(*) FROM users)::text AS users,
      (SELECT COUNT(*) FROM projects)::text AS projects,
      (SELECT COUNT(*) FROM tasks)::text AS tasks
  `);
  assert.deepEqual(firstCounts.rows[0], { users: '8', projects: '6', tasks: '10' });

  await seedDatabase();
  const secondCounts = await pool.query<{ users: string; projects: string; tasks: string }>(`
    SELECT
      (SELECT COUNT(*) FROM users)::text AS users,
      (SELECT COUNT(*) FROM projects)::text AS projects,
      (SELECT COUNT(*) FROM tasks)::text AS tasks
  `);
  assert.deepEqual(secondCounts.rows[0], firstCounts.rows[0]);
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
  const storedUser = (await pool.query<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE email = $1',
    [email],
  )).rows[0];
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
  const resetRow = (await pool.query<{ token_hash: string }>(
    'SELECT token_hash FROM password_reset_tokens WHERE token_hash = $1',
    [tokenHash],
  )).rows[0];
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
  assert.equal(Number(projDetail.project.completed_tasks), 1);
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
  assert.equal((await pool.query('SELECT id FROM calendar_events WHERE id = $1', [eventId])).rowCount, 0);

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
  assert.equal((await pool.query('SELECT id FROM documents WHERE id = $1', [documentId])).rowCount, 0);

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

  // PATCH /api/notifications/:id/read updates a PostgreSQL-backed record.
  const notificationId = `notif_${randomUUID()}`;
  await pool.query(`INSERT INTO notifications (id, user_id, title, message, type, is_read, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
    notificationId, user.id, 'Test notification', 'Test message', 'test', false, new Date().toISOString(),
  ]);
  const markReadRes = await fetch(`${baseUrl}/api/notifications/${notificationId}/read`, { method: 'PATCH', headers: { cookie } });
  assert.equal(markReadRes.status, 200);
  assert.equal((await pool.query<{ is_read: boolean }>(
    'SELECT is_read FROM notifications WHERE id = $1',
    [notificationId],
  )).rows[0].is_read, true);

  const deleteTaskRes = await fetch(`${baseUrl}/api/tasks/${taskId}`, { method: 'DELETE', headers: { cookie } });
  assert.equal(deleteTaskRes.status, 200);
  assert.equal((await pool.query('SELECT id FROM tasks WHERE id = $1', [taskId])).rowCount, 0);

  const deleteProjectRes = await fetch(`${baseUrl}/api/projects/${projectId}`, { method: 'DELETE', headers: { cookie } });
  assert.equal(deleteProjectRes.status, 200);
  assert.equal((await pool.query('SELECT id FROM projects WHERE id = $1', [projectId])).rowCount, 0);

  assert.equal((await pool.query('SELECT id FROM users WHERE id = $1', [user.id])).rowCount, 1);
  assert.equal((await pool.query<{ theme: string }>(
    'SELECT theme FROM user_settings WHERE user_id = $1',
    [user.id],
  )).rows[0].theme, 'dark');
});

test('read-only SQL guard permits approved SELECTs and rejects writes and private tables', async () => {
  const { validateReadOnlySql } = await import('./ai/sqlGuard.js');
  const { executeReadOnlySql } = await import('./ai/sqlExecutor.js');

  const projectSelect = 'SELECT name FROM projects';
  const memberJoin = `SELECT p.name, u.name
    FROM projects p
    JOIN project_members pm ON pm.project_id = p.id
    JOIN users u ON u.id = pm.user_id`;

  assert.doesNotThrow(() => validateReadOnlySql(projectSelect));
  assert.doesNotThrow(() => validateReadOnlySql(memberJoin));
  assert.ok(Array.isArray(await executeReadOnlySql(projectSelect)));
  assert.ok(Array.isArray(await executeReadOnlySql(memberJoin)));
  const readOnlySetting = await executeReadOnlySql(
    "SELECT current_setting('transaction_read_only') AS read_only FROM projects LIMIT 1",
  );
  assert.equal((readOnlySetting[0] as { read_only: string }).read_only, 'on');

  for (const sql of [
    'DELETE FROM projects',
    "UPDATE projects SET status = 'COMPLETED'",
    'DROP TABLE projects',
    'SELECT name INTO copied_projects FROM projects',
    'SELECT name FROM projects; SELECT name FROM projects',
    'SELECT token_hash FROM sessions',
    'SELECT token_hash FROM password_reset_tokens',
    'SELECT p.name FROM projects p, sessions s',
  ]) {
    assert.throws(() => validateReadOnlySql(sql), (error: unknown) => error instanceof Error, sql);
    await assert.rejects(executeReadOnlySql(sql), (error: unknown) => error instanceof Error);
  }
});

test('AI Text-to-SQL executes PostgreSQL project, task, and recent activity queries', async () => {
  const originalFetch = globalThis.fetch;
  const generatedQueries = [
    {
      question: 'What are the active projects?',
      sql: `SELECT name FROM projects WHERE status = 'ACTIVE' ORDER BY due_date ASC`,
      verify: (rows: unknown[]) => {
        assert.ok(rows.some((row) => (row as { name: string }).name === 'Platform Refresh'));
      },
    },
    {
      question: 'Which tasks are still to do?',
      sql: `SELECT title, status FROM tasks WHERE status = 'TODO' ORDER BY due_date ASC LIMIT 3`,
      verify: (rows: unknown[]) => {
        assert.ok(rows.length > 0);
        assert.ok(rows.every((row) => (row as { status: string }).status === 'TODO'));
      },
    },
    {
      question: 'Show the latest activity',
      sql: `SELECT action, subject, created_at FROM activities ORDER BY created_at DESC LIMIT 5`,
      verify: (rows: unknown[]) => {
        assert.ok(rows.length > 0);
        assert.ok(rows[0] && typeof (rows[0] as { created_at: unknown }).created_at === 'object');
      },
    },
  ];
  const prompts: string[] = [];

  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    const prompt = request.messages[0].content;
    prompts.push(prompt);
    const generated = generatedQueries.find(({ question }) => prompt.includes(question));
    assert(generated, 'Expected the SQL prompt to include the requested question.');
    return new Response(JSON.stringify({ message: { role: 'assistant', content: generated.sql } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const { answerDatabaseQuestion } = await import('./ai/databaseQuery.js');
    for (const generated of generatedQueries) {
      const result = await answerDatabaseQuestion(generated.question);
      assert.equal(result.sql, generated.sql);
      assert.ok(result.rows.length > 0);
      generated.verify(result.rows);
      assert.ok(result.answer.length > 0);
    }
    assert.equal(prompts.length, generatedQueries.length);
    assert.ok(prompts.every((prompt) => prompt.includes('PostgreSQL SELECT query')));
    assert.ok(prompts.every((prompt) => !prompt.includes('SQLite')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('database result formatter handles empty results, project lists, and counts', async () => {
  const { formatDatabaseAnswer } = await import('./ai/resultFormatter.js');

  assert.equal(
    formatDatabaseAnswer('What are the active projects?', 'SELECT name FROM projects', []),
    'No matching records were found.',
  );
  assert.equal(
    formatDatabaseAnswer('What are the active projects?', 'SELECT name FROM projects', [
      { name: 'Platform Refresh' },
      { name: 'Customer Intelligence' },
    ]),
    'There are 2 active projects: Platform Refresh, Customer Intelligence.',
  );
  assert.equal(
    formatDatabaseAnswer('How many active projects are there?', 'SELECT COUNT(*) AS total FROM projects', [{ total: 10 }]),
    'There are 10 active projects.',
  );
  assert.equal(
    formatDatabaseAnswer('How many active projects are there?', 'SELECT COUNT(*) AS total FROM projects', [{ total: '3' }]),
    'There are 3 active projects.',
  );
  assert.equal(
    formatDatabaseAnswer('What is the average project size?', 'SELECT AVG(task_count) AS average FROM projects', [{ average: 4.5 }]),
    'Average: 4.5.',
  );
  assert.equal(
    formatDatabaseAnswer('What is the latest project due date?', 'SELECT MAX(due_date) AS latest FROM projects', [{ latest: '2026-12-01' }]),
    'Maximum: 2026-12-01.',
  );
});

test('database row formatter produces a compact readable table', async () => {
  const { formatDatabaseAnswer } = await import('./ai/resultFormatter.js');

  assert.equal(
    formatDatabaseAnswer('Which projects have the most incomplete tasks?', 'SELECT p.name AS project, COUNT(t.id) AS incomplete_tasks FROM projects p JOIN tasks t ON t.project_id = p.id GROUP BY p.name', [
      { project: 'Platform Refresh', incomplete_tasks: 8 },
      { project: 'Customer Intelligence', incomplete_tasks: 5 },
    ]),
    'Project | Incomplete Tasks\nPlatform Refresh | 8\nCustomer Intelligence | 5',
  );
});

test('AI chat routes database questions through one SQL inference and preserves general chat', async () => {
  const originalFetch = globalThis.fetch;
  const email = `ai-chat-${randomUUID()}@northstarai.com`;
  const signupResponse = await originalFetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'AI Chat Tester', email, password: 'PassWord123!' }),
  });
  assert.equal(signupResponse.status, 201);
  const { user } = await signupResponse.json() as { user: { id: string } };
  const cookie = signupResponse.headers.get('set-cookie')?.split(';')[0];
  assert(cookie);

  const projectId = randomUUID();
  const timestamp = new Date().toISOString();
  await pool.query(`INSERT INTO projects (id, name, description, status, start_date, due_date, created_by, created_at, updated_at)
    VALUES ($1, $2, '', 'ACTIVE', '2026-10-01', '2026-10-31', $3, $4, $5)`, [
    projectId, 'AI Chat Test Project', user.id, timestamp, timestamp,
  ]);

  let inferenceCount = 0;
  let generatedSql = `SELECT name FROM projects WHERE id = '${projectId}' AND status = 'ACTIVE'`;
  const groqPrompts: string[] = [];
  const originalGroqApiKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'test-groq-api-key';
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/chat/completions')) {
      inferenceCount += 1;
      const request = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const prompt = request.messages[0].content;
      groqPrompts.push(prompt);
      const content = prompt.includes('Convert the user\'s question into exactly ONE SQL Server SELECT query.')
        ? generatedSql
        : 'Hello from local chat.';
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content } }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return originalFetch(input, init);
  };

  try {
    const databaseResponse = await originalFetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ message: 'What are the active projects?' }),
    });
    assert.equal(databaseResponse.status, 200);
    assert.deepEqual(await databaseResponse.json(), {
      answer: 'There is 1 active project: AI Chat Test Project.',
      source: 'database',
    });
    assert.equal(inferenceCount, 1);

    inferenceCount = 0;
    const generalMessage = 'Give me a short greeting.';
    const generalResponse = await originalFetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ message: generalMessage }),
    });
    assert.equal(generalResponse.status, 200);
    assert.deepEqual(await generalResponse.json(), { answer: 'Hello from local chat.' });
    assert.equal(inferenceCount, 1);
    assert.equal(groqPrompts.at(-1), generalMessage);

    inferenceCount = 0;
    generatedSql = 'DELETE FROM projects';
    const rejectedResponse = await originalFetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ message: 'What projects are there?' }),
    });
    assert.equal(rejectedResponse.status, 500);
    assert.deepEqual(await rejectedResponse.json(), {
      error: {
        code: 'AI_CHAT_FAILED',
        message: 'I could not complete that request. Please try again.',
      },
    });
    assert.equal(inferenceCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalGroqApiKey === undefined) {
      delete process.env.GROQ_API_KEY;
    } else {
      process.env.GROQ_API_KEY = originalGroqApiKey;
    }
    await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
  }
});
