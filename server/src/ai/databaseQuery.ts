import { generateSql } from './textToSql.js';
import { executeReadOnlySql } from './sqlExecutor.js';
import { formatDatabaseAnswer, buildResultTable, validateContractCoverage, resolvePresentation, type DatabaseTable } from './resultFormatter.js';
import { planDatabaseResponse, type ResponsePlan } from './responsePlanner.js';
import { clarifyOrNotFound, resolveName } from './entityResolution.js';
import { answerDatabaseQuestionLlmFirst, resolveSqlPipeline } from './llmFirstSql.js';

export interface DatabaseQueryResult {
  sql: string;
  plan: ResponsePlan;
  rows: unknown[];
  answer: string;
  table?: DatabaseTable;
}

async function resolvePlanEntities(plan: ResponsePlan): Promise<string | undefined> {
  if (plan.personReference) {
    const resolution = await resolveName('users', plan.personReference);
    if (!resolution.match) return clarifyOrNotFound('person', plan.personReference, resolution.candidates);
    plan.resolvedPersonId = resolution.match.id;
    plan.resolvedPersonName = resolution.match.name;
    plan.subject = resolution.match.name;
    plan.filters = plan.filters.filter((filter) => !/^(?:assigned_to|user_name) = /i.test(filter));
    if (plan.entity === 'tasks') plan.filters.push('assigned_to = ' + resolution.match.id);
    else if (plan.entity === 'activities') plan.filters.push('user_id = ' + resolution.match.id);
    else if (plan.entity === 'team members') plan.filters.push('id = ' + resolution.match.id);
    else if (plan.entity === 'projects') plan.filters.push('created_by = ' + resolution.match.id);
  }
  if (plan.projectReference) {
    const resolution = await resolveName('projects', plan.projectReference);
    if (!resolution.match) return clarifyOrNotFound('project', plan.projectReference, resolution.candidates);
    plan.resolvedProjectId = resolution.match.id;
    plan.resolvedProjectName = resolution.match.name;
    plan.nameFilter = undefined;
    plan.filters = plan.filters.filter((filter) => !filter.startsWith('project reference = '));
    if (plan.entity === 'projects') plan.filters.push('id = ' + resolution.match.id);
    else if (plan.entity === 'tasks') plan.filters.push('project_id = ' + resolution.match.id);
    else if (plan.entity === 'activities') plan.filters.push('project activity entity_id = ' + resolution.match.id);
    else if (plan.entity === 'documents' || plan.entity === 'project members') plan.filters.push('project_id = ' + resolution.match.id);
  }
  return undefined;
}

export async function answerDatabaseQuestion(
  question: string,
): Promise<DatabaseQueryResult> {
  // Experimental LLM-first pipeline (SQL_PIPELINE=llm_first). Disabled by
  // default; the legacy routing/planner pipeline below remains unchanged.
  const pipeline = resolveSqlPipeline();
  console.log('[SQL BOT] pipeline:', pipeline);
  if (pipeline === 'llm_first') {
    return answerDatabaseQuestionLlmFirst(question);
  }
  const plan = planDatabaseResponse(question);
  const resolutionAnswer = await resolvePlanEntities(plan);
  if (resolutionAnswer) return { sql: '', plan, rows: [], answer: resolutionAnswer };
  const sql = await generateSql(question, plan);
  const rows = await executeReadOnlySql(sql);
  const missing = validateContractCoverage(rows, plan);

  //Temporary statements
console.log("[SQL BOT] Plan:", plan);
console.log("[SQL BOT] Generated SQL:", sql);
console.log("[SQL BOT] Result columns:", rows[0] ? Object.keys(rows[0]) : []);
console.log("[SQL BOT] First row:", rows[0] ?? null);

  if (missing.length) {
    return { sql, plan, rows, answer: 'The requested information (' + missing.join(', ') + ') is unavailable, so I will not guess at it.' };
  }
  const mode = resolvePresentation(rows, plan);
  const table = mode === 'table' ? buildResultTable(rows, plan) : undefined;
  const answer = table ? 'Here are the results.' : formatDatabaseAnswer(question, sql, rows, plan);

  return { sql, plan, rows, answer, ...(table ? { table } : {}) };
}
const WORKSPACE_ENTITY =
  /\b(?:projects?|tasks?|users?|people|members?|team|employees?|documents?|files?|activities|activity|updates?|events?|meetings?|calendar|notifications?|workspace|workload|assignments?)\b/i;

export function isDatabaseQuestion(question: string): boolean {
  const text = question.trim();
  if (!text || /\b(?:schema|columns?)\b/i.test(text)) return false;
  return WORKSPACE_ENTITY.test(text) || /\bworking\s+on\b/i.test(text);
}