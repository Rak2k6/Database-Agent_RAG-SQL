/**
 * EXPERIMENTAL LLM-first SQL pipeline (Phase 2 of the temporary experiment).
 *
 * This module is selected only when SQL_PIPELINE=llm_first (disabled by
 * default). It lets the LLM interpret the natural-language question directly
 * (entity, fields, filters, aggregation, relationships, sorting, limits)
 * without the hand-written intent rules of responsePlanner.ts rewriting the
 * interpretation. The legacy pipeline in databaseQuery.ts is untouched.
 *
 * Safety is NOT bypassed: every generated statement still passes
 * sqlGuard.validateReadOnlySql and executes only through
 * sqlExecutor.executeReadOnlySql (same allowlist, same transaction, same
 * restrictions as the legacy path), and results still flow through the
 * existing contract-validation and formatting pipeline.
 */
import { chatWithGroq } from './groq.js';
import { executeReadOnlySql } from './sqlExecutor.js';
import { validateReadOnlySql } from './sqlGuard.js';
import { DATABASE_SCHEMA } from './textToSql.js';
import {
  formatDatabaseAnswer,
  buildResultTable,
  validateContractCoverage,
  resolvePresentation,
} from './resultFormatter.js';
import { clarifyOrNotFound, resolveName, sqlString, type NameResolution } from './entityResolution.js';
import type { ResponsePlan, DataField, FieldType, PresentationMode } from './responsePlanner.js';
import type { DatabaseQueryResult } from './databaseQuery.js';

// ── Pipeline feature flag ────────────────────────────────────────────────────

export type SqlPipeline = 'legacy' | 'llm_first';

/** Reads SQL_PIPELINE per call. Anything other than 'llm_first' is legacy. */
export function resolveSqlPipeline(): SqlPipeline {
  return process.env.SQL_PIPELINE === 'llm_first' ? 'llm_first' : 'legacy';
}

// ── LLM interpretation contract ──────────────────────────────────────────────

const SUPPORTED_ENTITIES = new Set([
  'tasks',
  'projects',
  'team members',
  'project members',
  'documents',
  'activities',
  'calendar events',
  'notifications',
]);

const SUPPORTED_INTENTS = new Set([
  'lookup',
  'list',
  'aggregation',
  'ranking',
  'comparison',
  'person_workload',
  'project_overview',
  'relationship_lookup',
  'recent_activity',
  'filtered_collection',
  'count',
  'person_lookup',
  'no_tasks_lookup',
]);

const FIELD_TYPES = new Set<FieldType>(['text', 'number', 'date', 'status']);
const PRESENTATION_MODES = new Set<PresentationMode>(['summary', 'list', 'table']);

export interface LlmFirstInterpretation {
  supported: boolean;
  limitation?: string;
  entity: string;
  intent: string;
  fields: DataField[];
  filters: string[];
  sort?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
  personReference?: string;
  projectReference?: string;
  presentation: { mode: PresentationMode; reason: string; explicit: boolean };
  sql: string;
}

const UNSUPPORTED_ANSWER =
  'That information is not available from the approved workspace tables, so I will not guess at it.';
const MALFORMED_ANSWER =
  'I could not interpret that request as a safe workspace query, so I will not guess at it.';

function log(event: string, detail?: unknown): void {
  if (detail === undefined) console.log('[SQL BOT][llm_first] ' + event);
  else console.log('[SQL BOT][llm_first] ' + event, detail);
}

function humanizeKey(key: string): string {
  return key
    .replaceAll('_', ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function sanitizeFields(value: unknown): DataField[] {
  if (!Array.isArray(value)) return [];
  const fields: DataField[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const key = typeof record['key'] === 'string' ? record['key'].trim() : '';
    if (!/^[a-z][a-z0-9_]*$/.test(key)) continue;
    const type = typeof record['type'] === 'string' && FIELD_TYPES.has(record['type'] as FieldType)
      ? (record['type'] as FieldType)
      : 'text';
    const label = typeof record['label'] === 'string' && record['label'].trim()
      ? record['label'].trim()
      : humanizeKey(key);
    fields.push({ key, label, type });
  }
  return fields;
}

function sanitizeSort(value: unknown): { field: string; direction: 'asc' | 'desc' } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const field = record['field'];
  const direction = record['direction'];
  if (typeof field !== 'string') return undefined;
  if (direction !== 'asc' && direction !== 'desc') return undefined;
  return { field, direction: direction as 'asc' | 'desc' };
}

function sanitizePresentation(value: unknown): LlmFirstInterpretation['presentation'] {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const mode = typeof record['mode'] === 'string' && PRESENTATION_MODES.has(record['mode'] as PresentationMode)
    ? (record['mode'] as PresentationMode)
    : 'list';
  return {
    mode,
    reason: typeof record['reason'] === 'string' && record['reason'] ? record['reason'] : 'llm_first',
    explicit: record['explicit'] === true,
  };
}

/**
 * Parses the raw LLM response into an interpretation. Throws on malformed
 * output; callers turn that into a logged rejection instead of executing
 * anything.
 */
export function parseLlmFirstInterpretation(raw: string): LlmFirstInterpretation {
  const fenced = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const text = (fenced ? fenced[1] : raw).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('LLM-first response contained no JSON object.');
  const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  if (typeof parsed['supported'] !== 'boolean') throw new Error('LLM-first response is missing "supported".');

  const limitation = typeof parsed['limitation'] === 'string' && parsed['limitation'].trim()
    ? parsed['limitation'].trim()
    : undefined;
  const sql = typeof parsed['sql'] === 'string' ? parsed['sql'].trim() : '';
  const entity = typeof parsed['entity'] === 'string' ? parsed['entity'].trim().toLowerCase() : '';
  const intent = typeof parsed['intent'] === 'string' && SUPPORTED_INTENTS.has(parsed['intent'])
    ? parsed['intent']
    : 'list';
  const sort = sanitizeSort(parsed['sort']);
  const limit = typeof parsed['limit'] === 'number' && Number.isFinite(parsed['limit']) && parsed['limit'] > 0
    ? Math.floor(parsed['limit'])
    : undefined;

  if (!parsed['supported']) {
    return {
      supported: false,
      ...(limitation ? { limitation } : {}),
      entity,
      intent,
      fields: [],
      filters: [],
      presentation: { mode: 'summary', reason: 'unsupported', explicit: false },
      sql: '',
    };
  }

  if (!SUPPORTED_ENTITIES.has(entity)) {
    throw new Error('LLM-first response referenced unsupported entity "' + entity + '".');
  }
  if (!sql) throw new Error('LLM-first response contained no SQL.');

  return {
    supported: true,
    entity,
    intent,
    fields: sanitizeFields(parsed['fields']),
    filters: asStringArray(parsed['filters']),
    ...(sort ? { sort } : {}),
    ...(limit ? { limit } : {}),
    ...(typeof parsed['person_reference'] === 'string' && parsed['person_reference'].trim()
      ? { personReference: parsed['person_reference'].trim() }
      : {}),
    ...(typeof parsed['project_reference'] === 'string' && parsed['project_reference'].trim()
      ? { projectReference: parsed['project_reference'].trim() }
      : {}),
    presentation: sanitizePresentation(parsed['presentation']),
    sql,
  };
}

// ── Prompt ───────────────────────────────────────────────────────────────────

export function buildLlmFirstPrompt(question: string): string {
  return `
You are the SQL interpreter for the Northstar AI Workplace application (SQL Server).

Interpret the user's question yourself. Do not assume any precomputed plan exists.
Return EXACTLY ONE JSON object and nothing else (no markdown, no code fences):

{
  "supported": boolean,
  "limitation": string,               // required (may be "") when supported is true; the reason when false
  "entity": string,                   // one of: tasks, projects, team members, project members, documents, activities, calendar events, notifications
  "intent": string,                   // one of: lookup, list, aggregation, ranking, comparison, person_workload, project_overview, relationship_lookup, recent_activity, filtered_collection, count, person_lookup, no_tasks_lookup
  "fields": [{ "key": string, "label": string, "type": "text" | "number" | "date" | "status" }],
  "filters": [string],                // plain-language description of each filter you applied
  "sort": { "field": string, "direction": "asc" | "desc" } | null,
  "limit": number | null,
  "person_reference": string | null,  // person name mentioned in the question, if any
  "project_reference": string | null, // project name mentioned in the question, if any
  "presentation": { "mode": "summary" | "list" | "table", "reason": string, "explicit": boolean },
  "sql": string                       // exactly one SQL Server SELECT query
}

Rules for "sql":
- Return exactly ONE SELECT statement. Never INSERT, UPDATE, DELETE, MERGE, DROP, ALTER, CREATE, TRUNCATE, EXEC, EXECUTE, SELECT ... INTO, or any write/administrative operation.
- Only use the tables and columns in the schema below, always dbo-schema qualified (for example dbo.projects). Never invent tables or columns. There is NO workspace metadata/catalog table.
- Use SQL Server T-SQL only: TOP for row limits, GETDATE()/DATEADD()/DATEDIFF()/CAST()/CONVERT() for dates, BIT as 1/0. Never PostgreSQL syntax (::, ILIKE, TRUE/FALSE, NOW(), INTERVAL, LIMIT, RETURNING).
- No SQL comments, no markdown, no code fences, no multiple statements.
- Use the exact enum values from the schema; treat them as case-sensitive.
- Do not use subqueries as table sources in FROM or JOIN, stored procedures, functions, views, system tables, INFORMATION_SCHEMA, or undocumented objects.
- Canonical result aliases: alias EVERY selected result column with AS and its exact field key from "fields" (lower snake_case), for example: SELECT t.title AS title, t.status AS status, p.name AS project_name. The "fields" array must list exactly those result columns. This keeps results compatible with the response contract.
- Person/project references: users.id, tasks.assigned_to, tasks.created_by, activities.user_id, documents.uploaded_by, calendar_events.created_by, project_members.user_id/project_id, tasks.project_id, projects.created_by store IDS, never names. When filtering by a person or project named in the question, write the placeholder {{person_id:<name>}} or {{project_id:<name>}} exactly where the id literal belongs (for example WHERE assigned_to = {{person_id:Jordan Lee}}). The application resolves the name against the database and substitutes a safe literal; ambiguous names are clarified with the user. Never compare an id column to a person's name directly, and never hardcode an id.
- Aggregations: alias the aggregate, for example COUNT(*) AS count, COUNT(*) AS task_count, SUM(...) AS completed_count, with GROUP BY when grouping per project.
- "presentation": use "summary" for scalar counts/single-value answers, "table" for structured multi-column or aggregated results or when the user explicitly asks for a table/comparison, otherwise "list".
- If the question asks for workspace metadata (tables, schema, columns, database/catalog info, capabilities/help), or anything else that cannot be answered from the approved tables below, return "supported": false with a short "limitation" explaining what is unavailable and set "sql" to "". Never substitute an unrelated table such as dbo.projects to answer a metadata question.

${DATABASE_SCHEMA}

User question:
${question}
`.trim();
}

// ── Plan built FROM the LLM interpretation (never the hand-written planner) ──

function planFromInterpretation(
  interpretation: LlmFirstInterpretation,
  resolvedPersonName?: string,
): ResponsePlan {
  const presentation = interpretation.presentation;
  const subject = resolvedPersonName ?? interpretation.personReference;
  return {
    intent: interpretation.intent,
    entity: interpretation.entity,
    ...(subject ? { subject } : {}),
    ...(interpretation.personReference ? { personReference: interpretation.personReference } : {}),
    ...(interpretation.projectReference ? { projectReference: interpretation.projectReference } : {}),
    filters: interpretation.filters,
    dataContract: { fields: interpretation.fields },
    requestedFields: interpretation.fields.map((field) => field.key),
    presentation: presentation.mode === 'summary' ? 'paragraph' : presentation.mode,
    presentationContract: {
      mode: presentation.mode,
      reason: presentation.reason,
      explicit: presentation.explicit,
    },
    useTable: presentation.mode === 'table',
    ...(interpretation.limit ? { limit: interpretation.limit } : {}),
    ...(interpretation.sort ? { sort: interpretation.sort } : {}),
  };
}

function unsupportedPlan(): ResponsePlan {
  return {
    intent: 'lookup',
    entity: 'workspace records',
    filters: [],
    dataContract: { fields: [] },
    requestedFields: [],
    presentation: 'paragraph',
    presentationContract: { mode: 'summary', reason: 'unsupported', explicit: false },
    useTable: false,
  };
}

// ── Placeholder resolution ───────────────────────────────────────────────────

const PLACEHOLDER_PATTERN = /\{\{(person_id|project_id):([^{}]*)\}\}/g;
// Non-global copy for state-free .test() checks (global regexes are stateful).
const PLACEHOLDER_TEST_PATTERN = /\{\{(?:person_id|project_id):[^{}]*\}\}/;

type PlaceholderRef = { kind: 'person_id' | 'project_id'; reference: string };

function extractPlaceholders(sql: string): PlaceholderRef[] {
  const refs: PlaceholderRef[] = [];
  for (const match of sql.matchAll(PLACEHOLDER_PATTERN)) {
    const reference = match[2].trim();
    if (reference) refs.push({ kind: match[1] as 'person_id' | 'project_id', reference });
  }
  return refs;
}

// ── Dependency seams (tests inject fakes; production uses the real ones) ─────

export interface LlmFirstDeps {
  chat?: (prompt: string) => Promise<string>;
  execute?: (sql: string) => Promise<unknown[]>;
  resolveReference?: (table: 'users' | 'projects', reference: string) => Promise<NameResolution>;
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function answerDatabaseQuestionLlmFirst(
  question: string,
  deps: LlmFirstDeps = {},
): Promise<DatabaseQueryResult> {
  const chat = deps.chat ?? chatWithGroq;
  const execute = deps.execute ?? executeReadOnlySql;
  const resolveReference = deps.resolveReference ?? resolveName;

  log('pipeline=llm_first question=' + JSON.stringify(question));

  const start = Date.now();
  const raw = await chat(buildLlmFirstPrompt(question));
  log('llm_ms=' + (Date.now() - start));

  let interpretation: LlmFirstInterpretation;
  try {
    interpretation = parseLlmFirstInterpretation(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log('rejection reason=' + JSON.stringify(reason));
    return { sql: '', plan: unsupportedPlan(), rows: [], answer: MALFORMED_ANSWER };
  }

  if (!interpretation.supported) {
    const reason = interpretation.limitation ?? UNSUPPORTED_ANSWER;
    log('rejection reason=' + JSON.stringify('unsupported: ' + reason));
    return { sql: '', plan: unsupportedPlan(), rows: [], answer: reason };
  }

  // Database-backed resolution of person/project references named by the LLM.
  // Ambiguous or unknown names are clarified instead of guessed.
  const placeholders = extractPlaceholders(interpretation.sql);
  const resolvedIds = new Map<string, string>();
  let resolvedPersonName: string | undefined;
  for (const placeholder of placeholders) {
    const key = placeholder.kind + ':' + placeholder.reference;
    if (resolvedIds.has(key)) continue;
    const table = placeholder.kind === 'person_id' ? 'users' : 'projects';
    const resolution = await resolveReference(table, placeholder.reference);
    if (!resolution.match) {
      const kind = placeholder.kind === 'person_id' ? 'person' : 'project';
      const answer = clarifyOrNotFound(kind, placeholder.reference, resolution.candidates);
      log('rejection reason=' + JSON.stringify('unresolved ' + kind + ': ' + placeholder.reference));
      return { sql: '', plan: planFromInterpretation(interpretation), rows: [], answer };
    }
    resolvedIds.set(key, resolution.match.id);
    if (placeholder.kind === 'person_id' && !resolvedPersonName) resolvedPersonName = resolution.match.name;
  }
  if (interpretation.personReference && !placeholders.some((ref) => ref.kind === 'person_id')) {
    log('warning person_reference not referenced by generated SQL: ' + interpretation.personReference);
  }
  if (interpretation.projectReference && !placeholders.some((ref) => ref.kind === 'project_id')) {
    log('warning project_reference not referenced by generated SQL: ' + interpretation.projectReference);
  }

  const sql = interpretation.sql.replace(PLACEHOLDER_PATTERN, (match, kind: string, reference: string) => {
    const id = resolvedIds.get(kind + ':' + reference.trim());
    return id === undefined ? match : sqlString(id);
  });
  if (PLACEHOLDER_TEST_PATTERN.test(sql)) {
    const reason = 'unresolved placeholder remained in generated SQL';
    log('rejection reason=' + JSON.stringify(reason));
    throw new Error('LLM-first SQL still contains an unresolved placeholder.');
  }

  // Mandatory safety gate — same guard as the legacy path. The LLM never
  // executes SQL directly; any rejection here is logged and propagated.
  try {
    validateReadOnlySql(sql);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log('rejection reason=' + JSON.stringify(reason));
    log('rejected sql=' + JSON.stringify(sql));
    throw error;
  }

  let rows: unknown[];
  try {
    rows = await execute(sql);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log('outcome=execution_failed reason=' + JSON.stringify(reason));
    log('sql=' + JSON.stringify(sql));
    throw error;
  }

  const columns = rows[0] && typeof rows[0] === 'object' && !Array.isArray(rows[0])
    ? Object.keys(rows[0] as Record<string, unknown>)
    : [];
  log('outcome=executed columns=' + JSON.stringify(columns) + ' rows=' + rows.length);
  log('sql=' + sql);

  const plan = planFromInterpretation(interpretation, resolvedPersonName);
  const missing = validateContractCoverage(rows, plan);
  if (missing.length) {
    log('rejection reason=' + JSON.stringify('missing contract fields: ' + missing.join(', ')));
    return {
      sql,
      plan,
      rows,
      answer: 'The requested information (' + missing.join(', ') + ') is unavailable, so I will not guess at it.',
    };
  }
  const mode = resolvePresentation(rows, plan);
  const table = mode === 'table' ? buildResultTable(rows, plan) : undefined;
  const answer = table ? 'Here are the results.' : formatDatabaseAnswer(question, sql, rows, plan);

  return { sql, plan, rows, answer, ...(table ? { table } : {}) };
}




