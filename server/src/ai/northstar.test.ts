import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NORTHSTAR_IDENTITY_ANSWER,
  answerIdentityQuestion,
  buildNorthstarSystemPrompt,
  containsForbiddenIdentityClaim,
  isCapabilitiesQuestion,
  isIdentityQuestion,
  validateNorthstarResponse,
} from './northstar.js';
import { isDatabaseQuestion } from './databaseQuery.js';
import { isDocumentContentQuestion } from './document-retrieval.js';
import { planDatabaseResponse } from './responsePlanner.js';
import { formatDatabaseAnswer, buildResultTable, resolvePresentation, columnMetadata, validateContractCoverage } from './resultFormatter.js';

test('identity: "Who are you?" returns Northstar AI identity', () => {
  assert.equal(isIdentityQuestion('Who are you?'), true);
  const answer = answerIdentityQuestion('Who are you?');
  assert.match(answer, /Northstar AI/);
  assert.doesNotMatch(answer, /chatgpt|openai|qwen|groq|ollama/i);
});

test('identity: "What\'s your name?" returns Northstar AI identity', () => {
  assert.equal(isIdentityQuestion("What's your name?"), true);
  const answer = answerIdentityQuestion("What's your name?");
  assert.match(answer, /Northstar AI/);
});

test('identity: "Are you ChatGPT?" is denied with Northstar identity', () => {
  assert.equal(isIdentityQuestion('Are you ChatGPT?'), true);
  const answer = answerIdentityQuestion('Are you ChatGPT?');
  assert.match(answer, /^No/i);
  assert.match(answer, /Northstar AI/);
  assert.doesNotMatch(answer, /I am ChatGPT|I am GPT|openai model/i);
});

test('identity: "What model are you?" hides provider', () => {
  assert.equal(isIdentityQuestion('What model are you?'), true);
  const answer = answerIdentityQuestion('What model are you?');
  assert.match(answer, /Northstar AI/);
  assert.doesNotMatch(answer, /qwen|groq|ollama|gpt-oss/i);
});

test('identity: "Who made you?" stays in Northstar role', () => {
  assert.equal(isIdentityQuestion('Who made you?'), true);
  const answer = answerIdentityQuestion('Who made you?');
  assert.match(answer, /Northstar AI/);
  assert.doesNotMatch(answer, /openai|qwen|groq|ollama|chatgpt/i);
});

test('scope: "What can you do?" lists workspace capabilities', () => {
  assert.equal(isCapabilitiesQuestion('What can you do?'), true);
  assert.match(NORTHSTAR_IDENTITY_ANSWER, /Northstar AI/);
});

test('guardrail: db query still routed to database', () => {
  assert.equal(isDatabaseQuestion('List the active projects.'), true);
  assert.equal(isIdentityQuestion('List the active projects.'), false);
});

test('guardrail: system prompt constrains every response', () => {
  const system = buildNorthstarSystemPrompt();
  assert.match(system, /Northstar AI/);
  assert.match(system, /Never identify/i);
  assert.match(system, /primarily designed for the Northstar workspace/i);
});

test('validation: forbidden claims replaced, legit content untouched', () => {
  assert.equal(containsForbiddenIdentityClaim('I am ChatGPT'), true);
  assert.equal(containsForbiddenIdentityClaim('I am an OpenAI model'), true);
  assert.equal(containsForbiddenIdentityClaim('I use Ollama'), true);
  assert.equal(validateNorthstarResponse('I am ChatGPT'), NORTHSTAR_IDENTITY_ANSWER);
  const legit = 'ChatGPT Integration is ON_HOLD with due date 2026-11-01.';
  assert.equal(containsForbiddenIdentityClaim(legit), false);
  assert.equal(validateNorthstarResponse(legit), legit);
});


test('response planning chooses requested intent and presentation', () => {
  const cases = [
    ['list active projects', 'list', 'projects'],
    ['show the tasks assigned to Jordan Lee', 'list', 'tasks'],
    ['give me the top 5 projects by task count', 'table', 'projects'],
    ['list completed tasks with their project names', 'table', 'tasks'],
    ['show overdue tasks', 'list', 'tasks'],
    ['how many active projects are there?', 'paragraph', 'projects'],
    ['who completed the most tasks?', 'table', 'tasks'],
    ['show everything related to Security Compliance Upgrade', 'list', 'workspace records'],
  ] as const;
  for (const [question, presentation, entity] of cases) {
    const plan = planDatabaseResponse(question);
    assert.equal(plan.presentation, presentation, question);
    assert.equal(plan.entity, entity, question);
  }
  assert.deepEqual(planDatabaseResponse('show the tasks assigned to Jordan Lee').filters, ['assigned_to = Jordan Lee']);
});

test('answer formatting removes internal columns and uses requested list style', () => {
  const question = 'show the tasks assigned to Jordan Lee';
  const plan = planDatabaseResponse(question);
  const rows = [
    { id: 't1', title: 'API Authentication', status: 'COMPLETED', project_id: 'p1', project_name: 'Security', assigned_user_id: 'u1', created_at: 'secret' },
    { id: 't2', title: 'Dashboard UI', status: 'IN_PROGRESS', project_id: 'p2', project_name: 'Portal', assigned_user_id: 'u1', created_at: 'secret' },
  ];
  const answer = formatDatabaseAnswer(question, 'SELECT title, status, project_name FROM dbo.tasks', rows, plan);
  assert.match(answer, /\| Task \| Status \|/);
  assert.match(answer, /API Authentication \| COMPLETED/);
  assert.doesNotMatch(answer, /project_id|secret/i);
});

test('empty results receive a contextual natural language response', () => {
  const question = 'show the tasks assigned to Jordan Lee';
  assert.equal(formatDatabaseAnswer(question, 'SELECT title FROM dbo.tasks', [], planDatabaseResponse(question)), 'No tasks are currently assigned to Jordan Lee.');
});

test('routing: workspace queries use the database path', () => {
  const dbQueries = [
    'active projects?',
    'projects?',
    'list active projects',
    'completed projects',
    'show the tasks assigned to Jordan Lee',
    'show me what Jordan is working on',
    "Jordan's tasks",
    'what is Jordan working on',
    'who has no tasks',
    'people with no tasks',
    'latest activities',
    'recent project updates',
    'tasks due this week',
    'overdue tasks',
    'projects with no tasks',
    'list completed projects',
    'show the list of tasks assigned to session test',
    'give me the top 5 projects by task count',
    'show the number of completed and pending tasks for each project',
    'list completed tasks with their project names',
  ];
  for (const q of dbQueries) {
    assert.equal(isDatabaseQuestion(q), true, q);
  }
  assert.equal(isDatabaseQuestion('Give me a short greeting.'), false);
  assert.equal(isDatabaseQuestion('who are you'), false);
});

test('planner: workload query infers person_workload intent', () => {
  const plan = planDatabaseResponse('show me what Jordan is working on');
  assert.equal(plan.intent, 'person_workload');
  assert.equal(plan.entity, 'tasks');
  assert.ok(plan.filters.some((f) => f.includes('Jordan')), plan.filters.join(','));
});

test('planner: aggregation query requires grouping and counts', () => {
  const plan = planDatabaseResponse('show the number of completed and pending tasks for each project');
  assert.equal(plan.intent, 'aggregation');
  assert.equal(plan.presentationContract.mode, 'table');
  assert.equal(plan.useTable, true);
  assert.ok(plan.dataContract.fields.some((f) => f.key === 'completed_count'));
  const tc = planDatabaseResponse('show task count for each project');
  assert.deepEqual(tc.dataContract.fields.map((f) => f.key), ['project_name', 'task_count']);
});

test('formatting: completed-task project name appears once', () => {
  const question = 'list completed tasks with their project names';
  const plan = planDatabaseResponse(question);
  const rows = [
    { title: 'Define project requirements', project_name: 'Customer Intelligence Platform' },
    { title: 'Finalize technical architecture', project_name: 'Customer Intelligence Platform' },
  ];
  const answer = formatDatabaseAnswer(question, 'SELECT title, project_name FROM dbo.tasks', rows, plan);
  assert.match(answer, /\| Task \| Project \|/);
  assert.match(answer, /\| Define project requirements \| Customer Intelligence Platform \|/);
});

test('formatting: ranking uses a single table representation', () => {
  const question = 'give me the top 5 projects by task count';
  const plan = planDatabaseResponse(question);
  assert.equal(plan.useTable, true);
  const rows = [{ name: 'Data Warehouse Modernization', task_count: 8 }, { name: 'Cloud Migration', task_count: 7 }];
  assert.match(formatDatabaseAnswer(question, 'SELECT name, COUNT(*) AS task_count', rows, plan), /\| Data Warehouse Modernization \| 8 \|/);
  const table = buildResultTable(rows, plan);
  assert.ok(table);
  assert.deepEqual(table!.columns, ['Project', 'Task Count']);
  const answer = formatDatabaseAnswer(question, 'SELECT name, COUNT(*) AS task_count', rows, plan);
  assert.equal(answer.split('Data Warehouse Modernization').length - 1, 1, 'result must render exactly once');
});

test('anti-hallucination: fabricated projects are refused', async () => {
  const mod = await import('./northstar.js');
  assert.equal(mod.containsWorkspaceFabrication('Jordan is working on Project Phoenix and Project Orion.'), true);
  assert.equal(validateNorthstarResponse('Jordan is working on Project Phoenix.'), mod.WORKSPACE_UNAVAILABLE_ANSWER);
});

test('contracts: data contract fields carry key/label/type', () => {
  const plan = planDatabaseResponse('show each project and its task count');
  assert.ok(plan.dataContract.fields.length >= 1);
  for (const f of plan.dataContract.fields) {
    assert.ok(f.key && f.label && f.type);
  }
});

test('policy: single-column lists stay lists', () => {
  const plan = planDatabaseResponse('list active projects');
  const rows = [{ name: 'Platform Refresh' }, { name: 'Brand Evolution' }];
  assert.equal(resolvePresentation(rows, plan), 'list');
  const answer = formatDatabaseAnswer('list active projects', 'SELECT name FROM dbo.projects', rows, plan);
  assert.match(answer, /- Platform Refresh/);
  assert.doesNotMatch(answer, /\|/);
  assert.deepEqual(columnMetadata(rows, plan), [{ key: 'name', label: 'Project', type: 'text' }]);
});

test('policy: multi-field results become tables', () => {
  for (const q of ['show projects with owner and status', 'show tasks with project and assignee', 'show latest activities with user and date', 'show task count for each project']) {
    const plan = planDatabaseResponse(q);
    assert.equal(plan.presentationContract.mode, 'table', q);
  }
  const plan = planDatabaseResponse('show tasks with project and assignee');
  const rows = [{ title: 'T1', project_name: 'P1', assignee: 'Jordan Lee' }, { title: 'T2', project_name: 'P2', assignee: 'Sam Kim' }];
  const answer = formatDatabaseAnswer('show tasks with project and assignee', 'SELECT title, project_name, assignee', rows, plan);
  assert.match(answer, /^\| Task \| Project \| Assignee \|/m);
  assert.equal(buildResultTable(rows, plan)!.rows.length, 2);
});

test('policy: summaries stay concise', () => {
  for (const q of ['how many active projects', 'how many completed tasks']) {
    const plan = planDatabaseResponse(q);
    assert.equal(plan.presentationContract.mode, 'summary', q);
  }
  const plan = planDatabaseResponse('how many completed tasks');
  assert.match(formatDatabaseAnswer('how many completed tasks', 'SELECT COUNT(*) AS count', [{ count: 14 }], plan), /14/);
});

test('policy: explicit format requests win', () => {
  assert.equal(planDatabaseResponse('show projects as a table').presentationContract.mode, 'table');
  assert.equal(planDatabaseResponse('list projects names only').presentationContract.mode, 'list');
});

test('nlu: workload variations share one intent', () => {
  for (const q of ["Jordan's workload", 'what is Jordan working on', "show Jordan's assignments", "Jordan's tasks"]) {
    const plan = planDatabaseResponse(q);
    assert.equal(plan.intent, 'person_workload', q);
    assert.ok((plan.subject ?? plan.filters.join(' ')).includes('Jordan'), q);
  }
  assert.equal(planDatabaseResponse("what's pending").entity, 'workspace records');
  assert.deepEqual(planDatabaseResponse('who completed the most tasks?').dataContract.fields, []);
});

test('validation: missing contract fields are never fabricated', () => {
  const plan = planDatabaseResponse('show each project and its task count');
  assert.deepEqual(validateContractCoverage([{ project_name: 'P' }], plan), ['task_count']);
  assert.deepEqual(validateContractCoverage([{ project_name: 'P', task_count: 3 }], plan), []);
});

test('formatter leaves project ambiguity to database-backed resolution', () => {
  const plan = planDatabaseResponse('show the security project');
  const rows = [{ name: 'Security Compliance Audit' }, { name: 'Security Compliance Upgrade' }];
  const answer = formatDatabaseAnswer('show the security project', 'SELECT name FROM dbo.projects', rows, plan);
  assert.doesNotMatch(answer, /multiple matching projects/i);
  assert.match(answer, /Security Compliance Audit/);
});

test('canonical table: one header, deduped rows, no internals', () => {
  const plan = planDatabaseResponse('top 5 projects by task count');
  const rows = [
    { id: 'p1', name: 'A', task_count: 8, created_at: 'x' },
    { id: 'p1', name: 'A', task_count: 8, created_at: 'x' },
    { id: 'p2', name: 'B', task_count: 7, created_at: 'y' },
  ];
  const table = buildResultTable(rows, plan)!;
  assert.equal(table.rows.length, 2);
  assert.ok(!table.columns.join(' ').match(/id|created_at/i));
  const answer = formatDatabaseAnswer('top 5 projects by task count', 'SELECT name, COUNT(*) AS task_count', rows, plan);
  assert.equal(answer.split('\n').filter((l) => l.startsWith('|')).length, 4);
});

test('empty: nonexistent person is truthful', () => {
  const plan = planDatabaseResponse('tasks assigned to Nobody Null');
  assert.match(formatDatabaseAnswer('tasks assigned to Nobody Null', 'SELECT title FROM dbo.tasks', [], plan), /No tasks are currently assigned to Nobody Null/);
});


test('semantic aliases preserve requested activity fields and dates', () => {
  const plan = planDatabaseResponse('show latest activities with user and date');
  const rows = [{ action: 'updated a project', user_name: 'Rak', created_at: '2026-10-01T10:00:00Z' }];
  assert.deepEqual(validateContractCoverage(rows, plan), []);
  assert.deepEqual(columnMetadata(rows, plan).map((column) => column.label), ['Activity', 'User', 'Date']);
});

test('equivalent project aliases collapse to one semantic column', () => {
  const plan = planDatabaseResponse('top 5 projects by task count');
  const rows = [{ name: 'Northstar', project_name: 'Northstar', task_count: 3 }];
  assert.deepEqual(validateContractCoverage(rows, plan), []);
  assert.deepEqual(columnMetadata(rows, plan).map((column) => column.label), ['Project', 'Task Count']);
  assert.deepEqual(buildResultTable(rows, plan)?.rows, [['Northstar', 3]]);
});


test('planner maps recent updates and absence queries to their result entities', () => {
  const latestProjectUpdates = planDatabaseResponse('latest project updates');
  assert.equal(latestProjectUpdates.entity, 'activities');
  assert.equal(planDatabaseResponse('show me what Jordan Lee is working on').subject, 'Jordan Lee');
  const rakActivity = planDatabaseResponse("Rak's activity");
  assert.ok(rakActivity.filters.includes('user_name = Rak'));
  assert.ok(rakActivity.dataContract.fields.some((field) => field.key === 'user_name'));
  const noTasks = planDatabaseResponse('who has no tasks');
  assert.equal(noTasks.intent, 'no_tasks_lookup');
  assert.equal(noTasks.entity, 'tasks');
  assert.deepEqual(noTasks.dataContract.fields, []);
  assert.equal(isDatabaseQuestion('latest updates'), true);
});


test('resolution intent and project references are generalized', () => {
  for (const query of ['What is Rak working on?', "Show Rak's activity", 'What is Jordan Lee working on?', 'Who has the most tasks?', 'Who has no tasks?', 'Top 5 projects by task count', 'Show me what is going on with the Security project', 'Show the latest project updates', 'What happened recently in the workspace?', 'Show me the tasks in Project Phoenix']) {
    assert.equal(isDatabaseQuestion(query), true, query);
  }
  const whoRanking = planDatabaseResponse('Who has the most tasks?');
  assert.equal(whoRanking.entity, 'tasks');
  assert.deepEqual(whoRanking.dataContract.fields, []);
  assert.equal(planDatabaseResponse('Top 5 projects by task count').dataContract.fields.some((field) => field.key === 'task_count'), true);
  assert.equal(planDatabaseResponse('Show me what is going on with the Security project').projectReference, 'Security');
  assert.equal(planDatabaseResponse('Show me the tasks in Project Phoenix').projectReference, 'Phoenix');
  assert.equal(planDatabaseResponse('Show the latest project updates').projectReference, undefined);
  assert.equal(isDatabaseQuestion('Give me the details of John Smith'), false);
});


test('routing and planning regressions stay in domain context', () => {
  const workspaceQueries = [
    'show all tasks', 'show all users', 'list all users', 'list all the details of the users',
    'list the tasks assigned to Jordan Lee', 'tasks assigned to Jordan',
    'select the top 5 priority tasks', 'highest priority tasks',
    'team members in Brand Evolution', 'team members for Customer Intelligence',
    'latest project updates', 'recent activities', 'how many active projects',
    'count completed tasks', 'show documents',
    'list documents for Customer Intelligence Platform',
  ];
  for (const question of workspaceQueries) assert.equal(isDatabaseQuestion(question), true, question);
  for (const question of ['what tables can you access', 'what is the schema of users', 'show details from password_reset table']) {
    assert.equal(isDatabaseQuestion(question), false, question);
  }
  assert.equal(planDatabaseResponse('list all the details of the users').personReference, undefined);
  assert.equal(planDatabaseResponse('list the tasks assigned to Jordan Lee').personReference, 'Jordan Lee');
  const priority = planDatabaseResponse('select the top 5 priority tasks');
  assert.deepEqual(priority.sort, { field: 'priority', direction: 'desc' });
  assert.equal(priority.limit, 5);
  assert.equal(priority.dataContract.fields.some((field) => field.key === 'task_count'), false);
  assert.equal(planDatabaseResponse('team members in Brand Evolution').entity, 'project members');
  assert.equal(planDatabaseResponse('team members for Customer Intelligence').projectReference, 'Customer Intelligence');
  const documents = planDatabaseResponse('list documents for Customer Intelligence Platform');
  assert.equal(documents.projectReference, 'Customer Intelligence Platform');
  assert.ok(documents.filters.includes('project reference = Customer Intelligence Platform'));
  assert.equal(planDatabaseResponse('how many active projects').dataContract.fields[0]?.key, 'count');
  assert.equal(planDatabaseResponse('count completed tasks').dataContract.fields[0]?.key, 'count');
});

test('P2 routing: document content never routes to SQL, inventory does', () => {
  for (const question of [
    'What risks are mentioned in the uploaded document?',
    'What are the objectives in the uploaded report?',
    'Summarize the project report.',
    'Which document explains configuration drift?',
  ]) {
    assert.equal(isDatabaseQuestion(question), false, question);
  }
  for (const question of [
    'What documents are available?',
    'How many documents are stored in the database?',
    'List documents for Customer Intelligence Platform',
  ]) {
    assert.equal(isDatabaseQuestion(question), true, question);
  }
});

test('P3b routing: schema veto narrows to schema-subject questions (questions.txt IDs)', () => {
  // SQL §4 #9: entity words precede the incidental "in the schema" mention
  // → must route to DATABASE (was a GENERAL false negative before P3b).
  assert.equal(
    isDatabaseQuestion(
      "Show all overdue tasks along with the project manager's name, if that relationship exists in the schema.",
    ),
    true,
    'SQL §4 #9',
  );
  // Boundary: mixed entity/schema phrase where the entity word precedes the
  // schema/columns mention → not vetoed, routes to SQL.
  assert.equal(isDatabaseQuestion('list tasks and their columns'), true, 'boundary: entity before columns');
  assert.equal(
    isDatabaseQuestion('show overdue tasks referencing the status column'),
    true,
    'boundary: entity before column',
  );
  // Boundary: schema/columns remains the subject → still vetoed.
  assert.equal(isDatabaseQuestion('show the columns of the tasks table'), false, 'boundary: columns before entity');
  assert.equal(isDatabaseQuestion('what is the schema of users'), false, 'schema subject stays non-SQL');
  // Security negatives pinned by existing tests must remain false.
  for (const question of ['what tables can you access', 'show details from password_reset table']) {
    assert.equal(isDatabaseQuestion(question), false, question);
  }
  // Negative: document-content questions are never redirected to SQL.
  assert.equal(isDocumentContentQuestion('Compare the requirements in the original design document with the testing document.'), true, 'RAG §4 #9 content detector');
  assert.equal(
    isDatabaseQuestion('Compare the requirements in the original design document with the testing document.'),
    false,
    'RAG §4 #9 never routes to SQL',
  );
  // Negative: document-inventory queries remain on SQL.
  assert.equal(isDatabaseQuestion('How many documents are stored in the database?'), true, 'SQL §1 #9 inventory stays SQL');
});

test('fix1: contract accepts declared label aliases for task-title columns', () => {
  const plan = planDatabaseResponse('Show all tasks');
  assert.equal(plan.dataContract.fields[0]?.key, 'title');
  assert.equal(plan.dataContract.fields[0]?.label, 'Task');
  // All three alias shapes satisfy the 'title' contract field.
  assert.deepEqual(validateContractCoverage([{ Task: 'Fix login bug' }], plan), []);
  assert.deepEqual(validateContractCoverage([{ title: 'Fix login bug' }], plan), []);
  assert.deepEqual(validateContractCoverage([{ task_title: 'Fix login bug' }], plan), []);
  // The missing-field check is not weakened: a row without any title-shaped
  // column still reports the missing contract field.
  assert.deepEqual(validateContractCoverage([{ Status: 'TODO' }], plan), ['title']);
  // Count-plan single-column behavior is unchanged.
  const countPlan = planDatabaseResponse('How many tasks are completed?');
  assert.equal(countPlan.intent, 'count');
  assert.deepEqual(validateContractCoverage([{ count: 19 }], countPlan), []);
});

test('fix2: "in total" count question is not a project reference', () => {
  const plan = planDatabaseResponse('How many tasks are there in total?');
  assert.equal(plan.intent, 'count');
  assert.equal(plan.projectReference, undefined);
  assert.equal(plan.resolvedProjectId, undefined);
  // Genuine project references named Total / containing aggregate words still resolve
  // when phrased with the word "project".
  assert.equal(planDatabaseResponse('Show tasks in the project Total').projectReference, 'Total');
  assert.equal(planDatabaseResponse('Show tasks in the General Services project').projectReference, 'General Services');
  assert.equal(planDatabaseResponse('Show tasks in the Aggregate Insights project').projectReference, 'Aggregate Insights');
  // Existing project-reference extraction is unchanged.
  assert.equal(planDatabaseResponse('Show me the tasks in Project Phoenix').projectReference, 'Phoenix');
});
