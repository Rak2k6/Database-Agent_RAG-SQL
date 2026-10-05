import { chatWithOllama } from './ollama.js';

const DATABASE_SCHEMA = `
Tables available for querying:

projects:
- id: TEXT
- name: TEXT
- description: TEXT
- status: TEXT
  Allowed values: PLANNED, ACTIVE, ON_HOLD, COMPLETED, ARCHIVED
- start_date: TEXT
- due_date: TEXT
- created_by: TEXT
- created_at: TEXT
- updated_at: TEXT

project_members:
- project_id: TEXT
- user_id: TEXT
- role: TEXT

tasks:
- id: TEXT
- title: TEXT
- description: TEXT
- project_id: TEXT
- assigned_to: TEXT
- created_by: TEXT
- priority: TEXT
  Allowed values: HIGH, MEDIUM, LOW
- status: TEXT
  Allowed values: TODO, IN_PROGRESS, COMPLETED, CANCELLED
- due_date: TEXT
- created_at: TEXT
- updated_at: TEXT
- completed_at: TEXT

users:
- id: TEXT
- name: TEXT
- email: TEXT
- role: TEXT
- department: TEXT
- status: TEXT
  Allowed values: Active, Inactive

documents:
- id: TEXT
- name: TEXT
- file_name: TEXT
- file_path: TEXT
- file_type: TEXT
- file_size: INTEGER
- uploaded_by: TEXT
- project_id: TEXT
- folder: TEXT
- created_at: TEXT
- updated_at: TEXT

calendar_events:
- id: TEXT
- title: TEXT
- description: TEXT
- start_time: TEXT
- end_time: TEXT
- event_type: TEXT
  Allowed values: MEETING, EVENT, DEADLINE, REMINDER
- created_by: TEXT
- project_id: TEXT
- created_at: TEXT

activities:
- id: TEXT
- user_id: TEXT
- action: TEXT
- entity_type: TEXT
- entity_id: TEXT
- subject: TEXT
- created_at: TEXT

notifications:
- id: TEXT
- user_id: TEXT
- title: TEXT
- message: TEXT
- type: TEXT
- is_read: INTEGER
- created_at: TEXT
`;

export async function generateSql(question: string): Promise<string> {
  const prompt = `
You are a SQL query generator for the Northstar AI Workplace application.

Convert the user's question into ONE SQLite SELECT query.

Rules:
- Return ONLY the SQL query.
- Do not use markdown or code fences.
- Only use the tables and columns listed in the schema.
- Generate SELECT queries only.
- Select only the columns needed to answer the question; never use SELECT *.
- Never generate INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, PRAGMA, or other write operations.
- Do not generate multiple statements.
- Do not include SQL comments, explanations, or markdown fences.
- Use the exact enum values specified in the schema.
- Treat enum values as case-sensitive.
- Do not invent table names, columns, statuses, or values.

${DATABASE_SCHEMA}

User question:
${question}
`;

  const start = Date.now();

  const response = await chatWithOllama(prompt);

  console.log(`[AI] SQL generation: ${Date.now() - start} ms`);

  return response.trim();
}