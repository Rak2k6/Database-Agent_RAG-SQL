import { chatWithGroq } from './groq.js';

const DATABASE_SCHEMA = `
SQL Server dbo schema. Only query these application tables:

dbo.projects:
- id: NVARCHAR
- name: NVARCHAR
- description: NVARCHAR
- status: NVARCHAR
  Allowed values: PLANNED, ACTIVE, ON_HOLD, COMPLETED, ARCHIVED
- start_date: DATETIME2
- due_date: DATETIME2
- created_by: NVARCHAR
- created_at: DATETIME2
- updated_at: DATETIME2

dbo.project_members:
- project_id: NVARCHAR
- user_id: NVARCHAR
- role: NVARCHAR

dbo.tasks:
- id: NVARCHAR
- title: NVARCHAR
- description: NVARCHAR
- project_id: NVARCHAR
- assigned_to: NVARCHAR
- created_by: NVARCHAR
- priority: NVARCHAR
  Allowed values: HIGH, MEDIUM, LOW
- status: NVARCHAR
  Allowed values: TODO, IN_PROGRESS, COMPLETED, CANCELLED
- due_date: DATETIME2
- created_at: DATETIME2
- updated_at: DATETIME2
- completed_at: DATETIME2 or NULL

dbo.users:
- id: NVARCHAR
- name: NVARCHAR
- email: NVARCHAR
- role: NVARCHAR
- department: NVARCHAR
- status: NVARCHAR
  Allowed values: Active, Inactive
- created_at: DATETIME2
- updated_at: DATETIME2

dbo.documents:
- id: NVARCHAR
- name: NVARCHAR
- file_name: NVARCHAR
- file_path: NVARCHAR
- file_type: NVARCHAR
- file_size: BIGINT
- uploaded_by: NVARCHAR
- project_id: NVARCHAR
- folder: NVARCHAR
- created_at: DATETIME2
- updated_at: DATETIME2

dbo.calendar_events:
- id: NVARCHAR
- title: NVARCHAR
- description: NVARCHAR
- start_time: DATETIME2
- end_time: DATETIME2
- event_type: NVARCHAR
  Allowed values: MEETING, EVENT, DEADLINE, REMINDER
- created_by: NVARCHAR
- project_id: NVARCHAR
- created_at: DATETIME2

dbo.activities:
- id: NVARCHAR
- user_id: NVARCHAR
- action: NVARCHAR
- entity_type: NVARCHAR
- entity_id: NVARCHAR
- subject: NVARCHAR
- created_at: DATETIME2

dbo.notifications:
- id: NVARCHAR
- user_id: NVARCHAR
- title: NVARCHAR
- message: NVARCHAR
- type: NVARCHAR
- is_read: BIT
- created_at: DATETIME2
`;

export async function generateSql(question: string): Promise<string> {
  const prompt = `
You are a SQL query generator for the Northstar AI Workplace application.

Convert the user's question into exactly ONE SQL Server SELECT query.

Rules:
- Return ONLY the SQL query.
- Do not use markdown or code fences.
- Only use the tables and columns listed in the schema.
- Generate SELECT queries only.
- Select only the columns needed to answer the question; never use SELECT *.
- Use SQL Server T-SQL syntax.
- Always reference application tables using the dbo schema, for example dbo.projects.
- Use SQL Server date/time expressions such as GETDATE(), GETUTCDATE(), SYSUTCDATETIME(), DATEADD(), DATEDIFF(), and CAST() or CONVERT() when appropriate.
- Use SQL Server boolean representation: BIT values are 1 and 0, not TRUE and FALSE.
- Use TOP when a query requires a row limit.
- Do not use PostgreSQL-specific syntax such as :: casts, ILIKE, TRUE/FALSE boolean literals, NOW(), INTERVAL, LIMIT, OFFSET without ORDER BY, RETURNING, or PostgreSQL-specific functions.
- For pagination, use SQL Server OFFSET ... FETCH NEXT ... ROWS ONLY only when necessary.
- Never generate INSERT, UPDATE, DELETE, MERGE, DROP, ALTER, CREATE, TRUNCATE, EXEC, EXECUTE, or other write/administrative operations.
- Do not generate multiple statements.
- Do not include SQL comments, explanations, or markdown fences.
- Use the exact enum values specified in the schema.
- Treat enum values as case-sensitive.
- Do not invent table names, columns, statuses, or values.
- Do not use stored procedures, functions, views, system tables, INFORMATION_SCHEMA, or undocumented objects.
- Do not use subqueries as table sources in FROM or JOIN.
- Only query the explicitly listed dbo application tables.

${DATABASE_SCHEMA}

User question:
${question}
`;

  const start = Date.now();

  const response = await chatWithGroq(prompt);

  console.log(`[AI] SQL generation: ${Date.now() - start} ms`);

  return response.trim();
}