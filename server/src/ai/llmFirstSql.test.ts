/**
 * Regression tests for the temporary LLM-first SQL pipeline experiment.
 *
 * Covers all 19 questions from the pipeline checklist
 * (.northstar-routing-baseline.md) plus safety regressions. The LLM and the
 * database are mocked through the LlmFirstDeps seams; the real sqlGuard is
 * always exercised against every generated statement.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  answerDatabaseQuestionLlmFirst,
  buildLlmFirstPrompt,
  parseLlmFirstInterpretation,
  resolveSqlPipeline,
  type LlmFirstDeps,
} from './llmFirstSql.js';
import { isDatabaseQuestion } from './databaseQuery.js';
import { validateReadOnlySql } from './sqlGuard.js';
import type { NameResolution } from './entityResolution.js';
import type { DatabaseQueryResult } from './databaseQuery.js';

const DEFAULT_RESOLUTIONS: Record<string, NameResolution> = {
  'Jordan Lee': { match: { id: 'usr_jordan', name: 'Jordan Lee' }, candidates: ['Jordan Lee'] },
  'Jordan': { match: { id: 'usr_jordan', name: 'Jordan Lee' }, candidates: ['Jordan Lee'] },
  'Brand Evolution': { match: { id: 'proj_brand', name: 'Brand Evolution' }, candidates: ['Brand Evolution'] },
  'Customer Intelligence': { match: { id: 'proj_ci', name: 'Customer Intelligence' }, candidates: ['Customer Intelligence'] },
  'Customer Intelligence Platform': {
    match: { id: 'proj_ci', name: 'Customer Intelligence Platform' },
    candidates: ['Customer Intelligence Platform'],
  },
};

interface Harness {
  deps: LlmFirstDeps;
  executed: string[];
  prompts: string[];
}

/** Builds injected fakes: canned LLM interpretation + recording DB stubs. */
function harness(
  interpretation: unknown,
  rows: unknown[] = [],
  overrides: Record<string, NameResolution> = {},
): Harness {
  const executed: string[] = [];
  const prompts: string[] = [];
  const resolutions: Record<string, NameResolution> = { ...DEFAULT_RESOLUTIONS, ...overrides };
  return {
    executed,
    prompts,
    deps: {
      chat: async (prompt: string) => {
        prompts.push(prompt);
        return JSON.stringify(interpretation);
      },
      execute: async (sql: string) => {
        executed.push(sql);
        return rows;
      },
      resolveReference: async (_table: 'users' | 'projects', reference: string) =>
        resolutions[reference] ?? { candidates: [] },
    },
  };
}

// ── Feature flag ─────────────────────────────────────────────────────────────

test('flag: SQL_PIPELINE selects the pipeline and defaults to legacy', () => {
  const original = process.env.SQL_PIPELINE;
  try {
    delete process.env.SQL_PIPELINE;
    assert.equal(resolveSqlPipeline(), 'legacy');
    process.env.SQL_PIPELINE = 'legacy';
    assert.equal(resolveSqlPipeline(), 'legacy');
    process.env.SQL_PIPELINE = 'bogus';
    assert.equal(resolveSqlPipeline(), 'legacy');
    process.env.SQL_PIPELINE = 'llm_first';
    assert.equal(resolveSqlPipeline(), 'llm_first');
  } finally {
    if (original === undefined) delete process.env.SQL_PIPELINE;
    else process.env.SQL_PIPELINE = original;
  }
});

// ── Prompt ───────────────────────────────────────────────────────────────────

test('prompt: carries verified schema, no precomputed plan, and the raw question', () => {
  const prompt = buildLlmFirstPrompt('show all tasks');
  assert.match(prompt, /dbo\.projects/);
  assert.match(prompt, /dbo\.tasks/);
  assert.match(prompt, /SQL Server/);
  assert.match(prompt, /show all tasks/);
  assert.match(prompt, /\{\{person_id:<name>\}\}/);
  // The LLM-first path must not receive a hand-written plan.
  assert.doesNotMatch(prompt, /Response plan guidance/);
  assert.doesNotMatch(prompt, /dataContract/);
  // No workspace metadata table may be advertised.
  assert.doesNotMatch(prompt, /workspace_metadata|db_metadata|sys\.tables/i);
});

// ── Interpretation parsing ───────────────────────────────────────────────────

test('parse: fenced JSON is accepted, garbage and unknown entities are rejected', () => {
  const fenced = '```json\n{"supported": false, "limitation": "Schema metadata is unavailable."}\n```';
  const parsed = parseLlmFirstInterpretation(fenced);
  assert.equal(parsed.supported, false);
  assert.equal(parsed.limitation, 'Schema metadata is unavailable.');

  assert.throws(() => parseLlmFirstInterpretation('I think you should look at the users table.'), /no JSON object/);
  assert.throws(() => parseLlmFirstInterpretation('{"supported": true, "entity": "tasks"}'), /no SQL/);
  assert.throws(
    () => parseLlmFirstInterpretation('{"supported": true, "entity": "password_reset", "sql": "SELECT 1"}'),
    /unsupported entity/,
  );
});

// ── The 19 pipeline-checklist questions (.northstar-routing-baseline.md) ─────

interface ChecklistCase {
  id: number;
  name: string;
  question: string;
  interpretation: Record<string, unknown>;
  rows?: unknown[];
  resolutions?: Record<string, NameResolution>;
  expect: (result: DatabaseQueryResult, ctx: { executed: string[]; prompts: string[] }) => void;
}

const CHECKLIST_CASES: ChecklistCase[] = [];

CHECKLIST_CASES.push(
  {
    id: 1,
    name: 'show all tasks',
    question: 'show all tasks',
    interpretation: {
      supported: true,
      entity: 'tasks',
      intent: 'list',
      fields: [{ key: 'title', label: 'Task', type: 'text' }],
      filters: [],
      sort: null,
      limit: null,
      person_reference: null,
      project_reference: null,
      presentation: { mode: 'list', reason: 'simple list', explicit: false },
      sql: 'SELECT title FROM dbo.tasks',
    },
    rows: [
      { title: 'Review Q3 product roadmap' },
      { title: 'Build dark theme color palette' },
    ],
    expect: (result, ctx) => {
      assert.match(ctx.executed[0], /FROM dbo\.tasks/);
      assert.equal(result.plan.entity, 'tasks');
      assert.deepEqual(result.plan.requestedFields, ['title']);
      assert.match(result.answer, /- Review Q3 product roadmap/);
      assert.match(result.answer, /- Build dark theme color palette/);
    },
  },
  {
    id: 2,
    name: 'show all users',
    question: 'show all users',
    interpretation: {
      supported: true,
      entity: 'team members',
      intent: 'list',
      fields: [{ key: 'name', label: 'Name', type: 'text' }],
      filters: [],
      sort: null,
      limit: null,
      person_reference: null,
      project_reference: null,
      presentation: { mode: 'list', reason: 'entity list', explicit: false },
      sql: 'SELECT name FROM dbo.users',
    },
    rows: [{ name: 'Rakesh' }, { name: 'Jordan Lee' }],
    expect: (result, ctx) => {
      assert.match(ctx.executed[0], /FROM dbo\.users/);
      assert.equal(result.plan.entity, 'team members');
      assert.match(result.answer, /- Rakesh/);
      assert.match(result.answer, /- Jordan Lee/);
    },
  },
  {
    id: 3,
    name: 'list all users',
    question: 'list all users',
    interpretation: {
      supported: true,
      entity: 'team members',
      intent: 'list',
      fields: [{ key: 'name', label: 'Name', type: 'text' }],
      filters: [],
      sort: null,
      limit: null,
      person_reference: null,
      project_reference: null,
      presentation: { mode: 'list', reason: 'entity list', explicit: false },
      sql: 'SELECT name FROM dbo.users',
    },
    rows: [{ name: 'Rakesh' }, { name: 'Jordan Lee' }],
    expect: (result) => {
      assert.equal(result.plan.entity, 'team members');
      assert.match(result.answer, /- Rakesh/);
    },
  },
);

CHECKLIST_CASES.push(
  {
    id: 4,
    name: 'list all the details of the users',
    question: 'list all the details of the users',
    interpretation: {
      supported: true,
      entity: 'team members',
      intent: 'list',
      fields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'role', label: 'Role', type: 'text' },
        { key: 'department', label: 'Department', type: 'text' },
        { key: 'status', label: 'Status', type: 'status' },
      ],
      filters: [],
      sort: null,
      limit: null,
      person_reference: null,
      project_reference: null,
      presentation: { mode: 'table', reason: 'explicit details request', explicit: true },
      sql: 'SELECT u.name AS name, u.role AS role, u.department AS department, u.status AS status FROM dbo.users u',
    },
    rows: [
      { name: 'Rakesh', role: 'Product Lead', department: 'Product', status: 'Active' },
      { name: 'Jordan Lee', role: 'Design Lead', department: 'Design', status: 'Active' },
    ],
    expect: (result, ctx) => {
      // Canonical result aliases compatible with the existing pipeline.
      assert.match(ctx.executed[0], /AS department/);
      assert.match(ctx.executed[0], /AS status/);
      // "users" must NOT be mis-extracted as a person reference.
      assert.equal(result.plan.personReference, undefined);
      assert.deepEqual(result.plan.requestedFields, ['name', 'role', 'department', 'status']);
      assert.deepEqual(result.table?.columns, ['Name', 'Role', 'Department', 'Status']);
      assert.equal(result.answer, 'Here are the results.');
    },
  },
  {
    id: 5,
    name: 'list the tasks assigned to Jordan Lee',
    question: 'list the tasks assigned to Jordan Lee',
    interpretation: {
      supported: true,
      entity: 'tasks',
      intent: 'person_workload',
      fields: [
        { key: 'title', label: 'Task', type: 'text' },
        { key: 'status', label: 'Status', type: 'status' },
      ],
      filters: ['assigned to Jordan Lee'],
      sort: null,
      limit: null,
      person_reference: 'Jordan Lee',
      project_reference: null,
      presentation: { mode: 'list', reason: 'person workload', explicit: false },
      sql: 'SELECT title, status FROM dbo.tasks WHERE assigned_to = {{person_id:Jordan Lee}}',
    },
    rows: [
      { title: 'API Authentication', status: 'COMPLETED' },
      { title: 'Dashboard UI', status: 'IN_PROGRESS' },
    ],
    expect: (result, ctx) => {
      // Database-backed resolution substitutes a safe id literal, never the name.
      assert.match(ctx.executed[0], /assigned_to = N'usr_jordan'/);
      assert.doesNotMatch(ctx.executed[0], /Jordan/);
      assert.equal(result.plan.personReference, 'Jordan Lee');
      assert.equal(result.plan.subject, 'Jordan Lee');
      assert.deepEqual(result.plan.requestedFields, ['title', 'status']);
      assert.deepEqual(result.table?.columns, ['Task', 'Status']);
    },
  },
  {
    id: 6,
    name: 'tasks assigned to Jordan',
    question: 'tasks assigned to Jordan',
    interpretation: {
      supported: true,
      entity: 'tasks',
      intent: 'person_workload',
      fields: [
        { key: 'title', label: 'Task', type: 'text' },
        { key: 'status', label: 'Status', type: 'status' },
      ],
      filters: ['assigned to Jordan'],
      sort: null,
      limit: null,
      person_reference: 'Jordan',
      project_reference: null,
      presentation: { mode: 'list', reason: 'person workload', explicit: false },
      sql: 'SELECT title, status FROM dbo.tasks WHERE assigned_to = {{person_id:Jordan}}',
    },
    rows: [{ title: 'Refactor database indexing strategy', status: 'COMPLETED' }],
    expect: (result, ctx) => {
      assert.match(ctx.executed[0], /assigned_to = N'usr_jordan'/);
      assert.equal(result.plan.personReference, 'Jordan');
      assert.deepEqual(result.plan.requestedFields, ['title', 'status']);
    },
  },
);

CHECKLIST_CASES.push(
  {
    id: 7,
    name: 'select the top 5 priority tasks',
    question: 'select the top 5 priority tasks',
    interpretation: {
      supported: true,
      entity: 'tasks',
      intent: 'ranking',
      fields: [
        { key: 'title', label: 'Task', type: 'text' },
        { key: 'priority', label: 'Priority', type: 'text' },
      ],
      filters: [],
      sort: { field: 'priority', direction: 'desc' },
      limit: 5,
      person_reference: null,
      project_reference: null,
      presentation: { mode: 'table', reason: 'ranking', explicit: false },
      sql: "SELECT TOP 5 title, priority FROM dbo.tasks ORDER BY CASE priority WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END DESC",
    },
    rows: [
      { title: 'Fix SSO handshake', priority: 'HIGH' },
      { title: 'Audit SQL guard', priority: 'HIGH' },
    ],
    expect: (result, ctx) => {
      assert.match(ctx.executed[0], /TOP 5/);
      assert.match(ctx.executed[0], /ORDER BY/);
      assert.equal(result.plan.limit, 5);
      assert.deepEqual(result.plan.sort, { field: 'priority', direction: 'desc' });
      assert.deepEqual(result.table?.columns, ['Task', 'Priority']);
    },
  },
  {
    id: 8,
    name: 'highest priority tasks',
    question: 'highest priority tasks',
    interpretation: {
      supported: true,
      entity: 'tasks',
      intent: 'ranking',
      fields: [
        { key: 'title', label: 'Task', type: 'text' },
        { key: 'priority', label: 'Priority', type: 'text' },
      ],
      filters: [],
      sort: { field: 'priority', direction: 'desc' },
      limit: null,
      person_reference: null,
      project_reference: null,
      presentation: { mode: 'table', reason: 'ranking', explicit: false },
      sql: "SELECT title, priority FROM dbo.tasks ORDER BY CASE priority WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END DESC",
    },
    rows: [
      { title: 'Fix SSO handshake', priority: 'HIGH' },
      { title: 'Write onboarding guide', priority: 'MEDIUM' },
    ],
    expect: (result, ctx) => {
      assert.match(ctx.executed[0], /ORDER BY/);
      assert.doesNotMatch(ctx.executed[0], /TOP/);
      assert.equal(result.plan.limit, undefined);
      assert.deepEqual(result.plan.sort, { field: 'priority', direction: 'desc' });
      // No fabricated task_count field (legacy baseline issue).
      assert.equal(result.plan.requestedFields.includes('task_count'), false);
    },
  },
  {
    id: 9,
    name: 'team members in Brand Evolution',
    question: 'team members in Brand Evolution',
    interpretation: {
      supported: true,
      entity: 'project members',
      intent: 'relationship_lookup',
      fields: [{ key: 'name', label: 'Member', type: 'text' }],
      filters: ['project = Brand Evolution'],
      sort: null,
      limit: null,
      person_reference: null,
      project_reference: 'Brand Evolution',
      presentation: { mode: 'list', reason: 'relationship lookup', explicit: false },
      sql: 'SELECT u.name AS name FROM dbo.project_members pm JOIN dbo.users u ON u.id = pm.user_id WHERE pm.project_id = {{project_id:Brand Evolution}}',
    },
    rows: [{ name: 'Jordan Lee' }, { name: 'Taylor Swift' }],
    expect: (result, ctx) => {
      assert.match(ctx.executed[0], /pm\.project_id = N'proj_brand'/);
      assert.doesNotMatch(ctx.executed[0], /\{\{/);
      assert.equal(result.plan.projectReference, 'Brand Evolution');
      assert.equal(result.plan.entity, 'project members');
      assert.match(result.answer, /- Jordan Lee/);
    },
  },
);

CHECKLIST_CASES.push(
  {
    id: 10,
    name: 'team members for Customer Intelligence',
    question: 'team members for Customer Intelligence',
    interpretation: {
      supported: true,
      entity: 'project members',
      intent: 'relationship_lookup',
      fields: [{ key: 'name', label: 'Member', type: 'text' }],
      filters: ['project = Customer Intelligence'],
      sort: null,
      limit: null,
      person_reference: null,
      project_reference: 'Customer Intelligence',
      presentation: { mode: 'list', reason: 'relationship lookup', explicit: false },
      sql: 'SELECT u.name AS name FROM dbo.project_members pm JOIN dbo.users u ON u.id = pm.user_id WHERE pm.project_id = {{project_id:Customer Intelligence}}',
    },
    rows: [{ name: 'Morgan Reed' }],
    expect: (result, ctx) => {
      assert.match(ctx.executed[0], /N'proj_ci'/);
      assert.equal(result.plan.projectReference, 'Customer Intelligence');
      // Single-row single-column results render as a summary line
      // (labels come from the formatter's canonical labelling).
      assert.match(result.answer, /Name: Morgan Reed\./);
    },
  },
  {
    id: 11,
    name: 'latest project updates',
    question: 'latest project updates',
    interpretation: {
      supported: true,
      entity: 'activities',
      intent: 'recent_activity',
      fields: [
        { key: 'action', label: 'Activity', type: 'text' },
        { key: 'user_name', label: 'User', type: 'text' },
        { key: 'entity_type', label: 'Entity', type: 'text' },
        { key: 'subject', label: 'Subject', type: 'text' },
        { key: 'created_at', label: 'Date', type: 'date' },
        { key: 'project_name', label: 'Project', type: 'text' },
      ],
      filters: ['ordered by created_at descending'],
      sort: { field: 'created_at', direction: 'desc' },
      limit: 10,
      person_reference: null,
      project_reference: null,
      presentation: { mode: 'table', reason: 'recent activity', explicit: false },
      sql: 'SELECT TOP 10 a.action, u.name AS user_name, a.entity_type, a.subject, a.created_at, p.name AS project_name FROM dbo.activities a JOIN dbo.users u ON u.id = a.user_id LEFT JOIN dbo.projects p ON p.id = a.entity_id AND a.entity_type = \'project\' ORDER BY a.created_at DESC',
    },
    rows: [
      {
        action: 'updated task',
        user_name: 'Rakesh',
        entity_type: 'task',
        subject: 'Review Q3 product roadmap',
        created_at: '2026-10-01T16:49:31.000Z',
        project_name: 'Platform Refresh',
      },
      {
        action: 'completed a task in',
        user_name: 'Morgan Reed',
        entity_type: 'task',
        subject: 'Finalize launch checklist',
        created_at: '2026-10-01T16:49:26.000Z',
        project_name: 'Platform Refresh',
      },
    ],
    expect: (result, ctx) => {
      assert.match(ctx.executed[0], /ORDER BY a\.created_at DESC/);
      assert.match(ctx.executed[0], /AS user_name/);
      assert.match(ctx.executed[0], /AS project_name/);
      assert.deepEqual(result.plan.sort, { field: 'created_at', direction: 'desc' });
      assert.equal(result.plan.entity, 'activities');
      assert.deepEqual(result.table?.columns, ['Activity', 'User', 'Entity', 'Subject', 'Date', 'Project']);
    },
  },
  {
    id: 12,
    name: 'recent activities',
    question: 'recent activities',
    interpretation: {
      supported: true,
      entity: 'activities',
      intent: 'recent_activity',
      fields: [
        { key: 'action', label: 'Activity', type: 'text' },
        { key: 'user_name', label: 'User', type: 'text' },
        { key: 'created_at', label: 'Date', type: 'date' },
      ],
      filters: ['ordered by created_at descending'],
      sort: { field: 'created_at', direction: 'desc' },
      limit: 10,
      person_reference: null,
      project_reference: null,
      presentation: { mode: 'table', reason: 'recent activity', explicit: false },
      sql: 'SELECT TOP 10 a.action, u.name AS user_name, a.created_at FROM dbo.activities a JOIN dbo.users u ON u.id = a.user_id ORDER BY a.created_at DESC',
    },
    rows: [
      { action: 'updated task', user_name: 'Rakesh', created_at: '2026-10-01T16:49:31.000Z' },
      { action: 'created project', user_name: 'Morgan Reed', created_at: '2026-10-01T15:32:55.000Z' },
    ],
    expect: (result, ctx) => {
      assert.match(ctx.executed[0], /ORDER BY a\.created_at DESC/);
      assert.equal(result.plan.entity, 'activities');
      assert.deepEqual(result.table?.columns, ['Activity', 'User', 'Date']);
    },
  },
);

CHECKLIST_CASES.push(
  {
    id: 13,
    name: 'how many active projects',
    question: 'how many active projects',
    interpretation: {
      supported: true,
      entity: 'projects',
      intent: 'count',
      fields: [{ key: 'count', label: 'Count', type: 'number' }],
      filters: ['status = ACTIVE'],
      sort: null,
      limit: null,
      person_reference: null,
      project_reference: null,
      presentation: { mode: 'summary', reason: 'scalar count', explicit: false },
      sql: "SELECT COUNT(*) AS count FROM dbo.projects WHERE status = 'ACTIVE'",
    },
    rows: [{ count: 4 }],
    expect: (result, ctx) => {
      assert.match(ctx.executed[0], /status = 'ACTIVE'/);
      assert.match(ctx.executed[0], /AS count/);
      assert.equal(result.plan.entity, 'projects');
      assert.deepEqual(result.plan.requestedFields, ['count']);
      assert.equal(result.answer, 'There are 4 projects.');
      assert.equal(result.table, undefined);
    },
  },
  {
    id: 14,
    name: 'count completed tasks',
    question: 'count completed tasks',
    interpretation: {
      supported: true,
      entity: 'tasks',
      intent: 'count',
      fields: [{ key: 'count', label: 'Count', type: 'number' }],
      filters: ['status = COMPLETED'],
      sort: null,
      limit: null,
      person_reference: null,
      project_reference: null,
      presentation: { mode: 'summary', reason: 'scalar count', explicit: false },
      sql: "SELECT COUNT(*) AS count FROM dbo.tasks WHERE status = 'COMPLETED'",
    },
    rows: [{ count: 5 }],
    expect: (result, ctx) => {
      assert.match(ctx.executed[0], /status = 'COMPLETED'/);
      assert.match(ctx.executed[0], /AS count/);
      // Completed-status filtering comes from the LLM interpretation, not the planner.
      assert.deepEqual(result.plan.filters, ['status = COMPLETED']);
      assert.equal(result.answer, 'There are 5 tasks.');
    },
  },
  {
    id: 15,
    name: 'show documents',
    question: 'show documents',
    interpretation: {
      supported: true,
      entity: 'documents',
      intent: 'list',
      fields: [{ key: 'name', label: 'Document', type: 'text' }],
      filters: [],
      sort: null,
      limit: null,
      person_reference: null,
      project_reference: null,
      presentation: { mode: 'list', reason: 'entity list', explicit: false },
      sql: 'SELECT name FROM dbo.documents',
    },
    rows: [
      { name: 'Northstar API Specification.md' },
      { name: 'Customer Interviews.md' },
    ],
    expect: (result, ctx) => {
      assert.match(ctx.executed[0], /FROM dbo\.documents/);
      assert.equal(result.plan.entity, 'documents');
      assert.match(result.answer, /- Northstar API Specification\.md/);
      assert.match(result.answer, /- Customer Interviews\.md/);
    },
  },
);

CHECKLIST_CASES.push(
  {
    id: 16,
    name: 'list documents for Customer Intelligence Platform',
    question: 'list documents for Customer Intelligence Platform',
    interpretation: {
      supported: true,
      entity: 'documents',
      intent: 'relationship_lookup',
      fields: [{ key: 'name', label: 'Document', type: 'text' }],
      filters: ['project = Customer Intelligence Platform'],
      sort: null,
      limit: null,
      person_reference: null,
      project_reference: 'Customer Intelligence Platform',
      presentation: { mode: 'list', reason: 'project-scoped list', explicit: false },
      sql: 'SELECT name FROM dbo.documents WHERE project_id = {{project_id:Customer Intelligence Platform}}',
    },
    rows: [{ name: 'Customer Interviews.md' }, { name: 'Research Digest.md' }],
    expect: (result, ctx) => {
      // Project-scoped document query: database-backed resolution, no guessing.
      assert.match(ctx.executed[0], /project_id = N'proj_ci'/);
      assert.doesNotMatch(ctx.executed[0], /\{\{/);
      assert.equal(result.plan.projectReference, 'Customer Intelligence Platform');
      assert.deepEqual(result.plan.requestedFields, ['name']);
      assert.match(result.answer, /- Customer Interviews\.md/);
    },
  },
  {
    id: 17,
    name: 'what tables can you access (workspace info, no SQL)',
    question: 'what tables can you access',
    interpretation: {
      supported: false,
      limitation:
        'I can only answer questions from the approved workspace tables; table and schema metadata is not exposed.',
    },
    expect: (result, ctx) => {
      // No SQL at all — and certainly no silent dbo.projects substitution.
      assert.equal(ctx.executed.length, 0);
      assert.equal(result.sql, '');
      assert.equal(
        result.answer,
        'I can only answer questions from the approved workspace tables; table and schema metadata is not exposed.',
      );
      assert.doesNotMatch(result.answer, /projects? table/i);
    },
  },
  {
    id: 18,
    name: 'what is the schema of users (workspace info, no SQL)',
    question: 'what is the schema of users',
    interpretation: {
      supported: false,
      limitation: 'Schema information is unavailable, so I will not guess at it.',
    },
    expect: (result, ctx) => {
      assert.equal(ctx.executed.length, 0);
      assert.equal(result.sql, '');
      assert.equal(result.answer, 'Schema information is unavailable, so I will not guess at it.');
    },
  },
);

// ── Runner for the 18 returning checklist cases (#19 is a guard rejection) ───

test('checklist routing matches the baseline (16 routed, 3 not)', () => {
  const routed = new Map<string, boolean>([
    ['show all tasks', true],
    ['show all users', true],
    ['list all users', true],
    ['list all the details of the users', true],
    ['list the tasks assigned to Jordan Lee', true],
    ['tasks assigned to Jordan', true],
    ['select the top 5 priority tasks', true],
    ['highest priority tasks', true],
    ['team members in Brand Evolution', true],
    ['team members for Customer Intelligence', true],
    ['latest project updates', true],
    ['recent activities', true],
    ['how many active projects', true],
    ['count completed tasks', true],
    ['show documents', true],
    ['list documents for Customer Intelligence Platform', true],
    ['what tables can you access', false],
    ['what is the schema of users', false],
    ['show details from password_reset table', false],
  ]);
  assert.equal(routed.size, 19);
  for (const [question, expected] of routed) {
    assert.equal(isDatabaseQuestion(question), expected, question);
  }
});

for (const checklistCase of CHECKLIST_CASES) {
  test(`checklist #${checklistCase.id}: ${checklistCase.name}`, async () => {
    const ctx = harness(checklistCase.interpretation, checklistCase.rows ?? [], checklistCase.resolutions ?? {});
    const result = await answerDatabaseQuestionLlmFirst(checklistCase.question, ctx.deps);
    assert.ok(ctx.prompts.length >= 1, 'the raw question must reach the LLM');
    assert.ok(
      ctx.prompts.every((prompt) => prompt.includes(checklistCase.question)),
      'prompt must contain the original question',
    );
    // Every statement that was allowed to execute must pass the real guard.
    for (const sql of ctx.executed) assert.doesNotThrow(() => validateReadOnlySql(sql), sql);
    // No unresolved placeholder may ever reach execution.
    assert.doesNotMatch(result.sql, /\{\{/);
    checklistCase.expect(result, { executed: ctx.executed, prompts: ctx.prompts });
  });
}

// ── Safety regressions ───────────────────────────────────────────────────────

test('checklist #19: show details from password_reset table is rejected by the guard', async () => {
  const ctx = harness({
    supported: true,
    entity: 'team members',
    intent: 'lookup',
    fields: [{ key: 'name', label: 'Name', type: 'text' }],
    filters: [],
    sort: null,
    limit: null,
    person_reference: null,
    project_reference: null,
    presentation: { mode: 'list', reason: 'lookup', explicit: false },
    sql: 'SELECT name FROM dbo.password_reset_tokens',
  });
  await assert.rejects(
    () => answerDatabaseQuestionLlmFirst('show details from password_reset table', ctx.deps),
    /not allowed/,
  );
  // The unapproved table was never executed.
  assert.equal(ctx.executed.length, 0);
});

test('safety: direct write operations are rejected before execution', async () => {
  const ctx = harness({
    supported: true,
    entity: 'tasks',
    intent: 'list',
    fields: [{ key: 'title', label: 'Task', type: 'text' }],
    filters: [],
    sort: null,
    limit: null,
    person_reference: null,
    project_reference: null,
    presentation: { mode: 'list', reason: 'list', explicit: false },
    sql: 'DELETE FROM dbo.tasks',
  });
  await assert.rejects(
    () => answerDatabaseQuestionLlmFirst('remove all tasks', ctx.deps),
    /Only SELECT queries are allowed/,
  );
  assert.equal(ctx.executed.length, 0);
});

test('safety: ambiguous person names are clarified, never guessed', async () => {
  const ctx = harness(
    {
      supported: true,
      entity: 'tasks',
      intent: 'person_workload',
      fields: [{ key: 'title', label: 'Task', type: 'text' }],
      filters: [],
      sort: null,
      limit: null,
      person_reference: 'Jordan',
      project_reference: null,
      presentation: { mode: 'list', reason: 'person workload', explicit: false },
      sql: 'SELECT title FROM dbo.tasks WHERE assigned_to = {{person_id:Jordan}}',
    },
    [],
    { Jordan: { candidates: ['Jordan Lee', 'Jordan Smith'] } },
  );
  const result = await answerDatabaseQuestionLlmFirst('tasks assigned to Jordan', ctx.deps);
  assert.equal(ctx.executed.length, 0);
  assert.equal(result.sql, '');
  assert.match(result.answer, /more than one person matching "Jordan"/);
  assert.match(result.answer, /Jordan Lee/);
  assert.match(result.answer, /Jordan Smith/);
});

test('safety: unknown person names produce a truthful not-found answer', async () => {
  const ctx = harness({
    supported: true,
    entity: 'tasks',
    intent: 'person_workload',
    fields: [{ key: 'title', label: 'Task', type: 'text' }],
    filters: [],
    sort: null,
    limit: null,
    person_reference: 'Nobody Null',
    project_reference: null,
    presentation: { mode: 'list', reason: 'person workload', explicit: false },
    sql: 'SELECT title FROM dbo.tasks WHERE assigned_to = {{person_id:Nobody Null}}',
  });
  const result = await answerDatabaseQuestionLlmFirst('tasks assigned to Nobody Null', ctx.deps);
  assert.equal(ctx.executed.length, 0);
  assert.match(result.answer, /could not find a workspace team member named "Nobody Null"/);
});

test('safety: combined person and project filters resolve both names', async () => {
  const ctx = harness({
    supported: true,
    entity: 'tasks',
    intent: 'person_workload',
    fields: [
      { key: 'title', label: 'Task', type: 'text' },
      { key: 'status', label: 'Status', type: 'status' },
    ],
    filters: ['assigned to Jordan Lee', 'project = Brand Evolution'],
    sort: null,
    limit: null,
    person_reference: 'Jordan Lee',
    project_reference: 'Brand Evolution',
    presentation: { mode: 'list', reason: 'combined filter', explicit: false },
    sql: 'SELECT title, status FROM dbo.tasks WHERE assigned_to = {{person_id:Jordan Lee}} AND project_id = {{project_id:Brand Evolution}}',
  });
  const result = await answerDatabaseQuestionLlmFirst(
    'tasks assigned to Jordan Lee in Brand Evolution',
    ctx.deps,
  );
  assert.equal(ctx.executed.length, 1);
  assert.match(ctx.executed[0], /assigned_to = N'usr_jordan'/);
  assert.match(ctx.executed[0], /project_id = N'proj_brand'/);
  assert.equal(result.plan.personReference, 'Jordan Lee');
  assert.equal(result.plan.projectReference, 'Brand Evolution');
});

test('safety: ambiguous project reference in a combined question clarifies the project', async () => {
  const ctx = harness(
    {
      supported: true,
      entity: 'tasks',
      intent: 'person_workload',
      fields: [{ key: 'title', label: 'Task', type: 'text' }],
      filters: [],
      sort: null,
      limit: null,
      person_reference: 'Jordan Lee',
      project_reference: 'Brand',
      presentation: { mode: 'list', reason: 'combined filter', explicit: false },
      sql: 'SELECT title FROM dbo.tasks WHERE assigned_to = {{person_id:Jordan Lee}} AND project_id = {{project_id:Brand}}',
    },
    [],
    { Brand: { candidates: ['Brand Evolution', 'Brand Refresh'] } },
  );
  const result = await answerDatabaseQuestionLlmFirst('tasks assigned to Jordan Lee in Brand', ctx.deps);
  assert.equal(ctx.executed.length, 0);
  assert.equal(result.sql, '');
  assert.match(result.answer, /more than one project matching "Brand"/);
});

test('safety: missing contract fields are never fabricated', async () => {
  const missingStatus = harness(
    {
      supported: true,
      entity: 'tasks',
      intent: 'person_workload',
      fields: [
        { key: 'title', label: 'Task', type: 'text' },
        { key: 'status', label: 'Status', type: 'status' },
      ],
      filters: [],
      sort: null,
      limit: null,
      person_reference: 'Jordan Lee',
      project_reference: null,
      presentation: { mode: 'list', reason: 'person workload', explicit: false },
      sql: 'SELECT title, status FROM dbo.tasks WHERE assigned_to = {{person_id:Jordan Lee}}',
    },
    [{ title: 'API Authentication' }], // status missing from the row
  );
  const result = await answerDatabaseQuestionLlmFirst(
    'list the tasks assigned to Jordan Lee',
    missingStatus.deps,
  );
  assert.match(result.answer, /The requested information \(status\) is unavailable/);
});

test('safety: empty results for an assigned person are truthful', async () => {
  const ctx = harness({
    supported: true,
    entity: 'tasks',
    intent: 'person_workload',
    fields: [
      { key: 'title', label: 'Task', type: 'text' },
      { key: 'status', label: 'Status', type: 'status' },
    ],
    filters: [],
    sort: null,
    limit: null,
    person_reference: 'Jordan Lee',
    project_reference: null,
    presentation: { mode: 'list', reason: 'person workload', explicit: false },
    sql: 'SELECT title, status FROM dbo.tasks WHERE assigned_to = {{person_id:Jordan Lee}}',
  });
  const result = await answerDatabaseQuestionLlmFirst('list the tasks assigned to Jordan Lee', ctx.deps);
  assert.equal(result.rows.length, 0);
  assert.equal(result.answer, 'No tasks are currently assigned to Jordan Lee.');
});

test('workspace info: routed questions get a limitation, never a project table', async () => {
  // 'workspace' routes to the database path (see isDatabaseQuestion).
  assert.equal(isDatabaseQuestion('show workspace info'), true);
  const ctx = harness({
    supported: false,
    limitation: 'Workspace summary metadata is unavailable from the approved tables.',
  });
  const result = await answerDatabaseQuestionLlmFirst('show workspace info', ctx.deps);
  assert.equal(ctx.executed.length, 0);
  assert.equal(result.sql, '');
  assert.equal(result.answer, 'Workspace summary metadata is unavailable from the approved tables.');
  assert.doesNotMatch(result.answer, /Platform Refresh|dbo\.projects/);
});

test('malformed LLM output never reaches execution', async () => {
  const ctx = harness({ nonsense: true });
  // JSON parses but lacks "supported" → logged rejection, no SQL executed.
  const result = await answerDatabaseQuestionLlmFirst('show all tasks', ctx.deps);
  assert.equal(ctx.executed.length, 0);
  assert.equal(result.sql, '');
  assert.match(result.answer, /could not interpret/i);
});

test('development logging records pipeline, sql, outcome, columns, rejections', async () => {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  };
  try {
    const ok = harness(
      {
        supported: true,
        entity: 'tasks',
        intent: 'list',
        fields: [{ key: 'title', label: 'Task', type: 'text' }],
        filters: [],
        sort: null,
        limit: null,
        person_reference: null,
        project_reference: null,
        presentation: { mode: 'list', reason: 'list', explicit: false },
        sql: 'SELECT title FROM dbo.tasks',
      },
      [{ title: 'Audit SQL guard' }],
    );
    await answerDatabaseQuestionLlmFirst('show all tasks', ok.deps);

    const rejected = harness({ supported: false, limitation: 'Metadata unavailable.' });
    await answerDatabaseQuestionLlmFirst('what tables can you access', rejected.deps);
  } finally {
    console.log = originalLog;
  }
  const joined = lines.join('\n');
  assert.match(joined, /\[SQL BOT\]\[llm_first\] pipeline=llm_first/);
  assert.match(joined, /outcome=executed columns=\["title"\] rows=1/);
  assert.match(joined, /sql=SELECT title FROM dbo\.tasks/);
  assert.match(joined, /rejection reason=.*Metadata unavailable/);
});











