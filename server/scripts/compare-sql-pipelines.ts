/**
 * Phase 5 comparison harness for the temporary LLM-first SQL pipeline experiment.
 *
 * Runs the 19 pipeline-checklist questions through BOTH pipelines (legacy and
 * llm_first) against the same database data and the same Groq model
 * configuration, and records per question:
 *   - selected pipeline
 *   - generated SQL
 *   - whether the SQL passed the read-only/approved-table safety validation
 *   - execution success/failure (or guard rejection reason)
 *   - result column names and row count
 *   - the final answer text (for manual filters/sorting/aggregation/answer
 *     correctness review — syntactically valid SQL is NOT treated as correct)
 *
 * Usage: npm run ai:compare
 * Output: .llm-first-comparison.json + a stdout summary.
 *
 * This is a dev-only script; it never writes to the database (both pipelines
 * are read-only by construction).
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { answerDatabaseQuestion, isDatabaseQuestion } from '../src/ai/databaseQuery.js';
import { validateReadOnlySql } from '../src/ai/sqlGuard.js';
import { closeSqlPool, verifySqlConnection } from '../src/db/pool.js';

const QUESTIONS: string[] = [
  'show all tasks',
  'show all users',
  'list all users',
  'list all the details of the users',
  'list the tasks assigned to Jordan Lee',
  'tasks assigned to Jordan',
  'select the top 5 priority tasks',
  'highest priority tasks',
  'team members in Brand Evolution',
  'team members for Customer Intelligence',
  'latest project updates',
  'recent activities',
  'how many active projects',
  'count completed tasks',
  'show documents',
  'list documents for Customer Intelligence Platform',
  'what tables can you access',
  'what is the schema of users',
  'show details from password_reset table',
];

type Pipeline = 'legacy' | 'llm_first';

interface QuestionRun {
  question: string;
  pipeline: Pipeline;
  routedInProduction: boolean;
  sql: string | null;
  passedSafetyValidation: boolean | null; // null = no SQL produced
  executionSuccess: boolean;
  rejectionReason?: string;
  resultColumns: string[];
  rowCount: number;
  tableColumns?: string[];
  answer: string;
  durationMs: number;
}

const GUARD_ERROR_PATTERN =
  /not allowed|Only SELECT queries|Multiple SQL statements|Subqueries in FROM\/JOIN|Only the dbo schema|SQL query is empty|unterminated|Only explicitly allowed database tables/;

async function runOne(question: string, pipeline: Pipeline): Promise<QuestionRun> {
  process.env.SQL_PIPELINE = pipeline;
  const started = Date.now();
  const run: QuestionRun = {
    question,
    pipeline,
    routedInProduction: isDatabaseQuestion(question),
    sql: null,
    passedSafetyValidation: null,
    executionSuccess: false,
    resultColumns: [],
    rowCount: 0,
    answer: '',
    durationMs: 0,
  };
  // Retry once on transient Groq rate limits so the comparison is complete.
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await answerDatabaseQuestion(question);
      run.sql = result.sql || null;
      run.answer = result.answer;
      run.rowCount = result.rows.length;
      run.resultColumns = result.rows[0] && typeof result.rows[0] === 'object'
        ? Object.keys(result.rows[0] as Record<string, unknown>)
        : [];
      if (result.table) run.tableColumns = result.table.columns;
      if (result.sql) {
        try {
          validateReadOnlySql(result.sql);
          run.passedSafetyValidation = true;
        } catch (error) {
          run.passedSafetyValidation = false;
          run.rejectionReason = error instanceof Error ? error.message : String(error);
        }
      }
      run.executionSuccess = true;
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/rate limit/i.test(message)) break;
      console.log(`  [retry] Groq rate limit; waiting 45s before one retry…`);
      await new Promise((resolve) => setTimeout(resolve, 45_000));
    }
  }
  if (lastError) {
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    run.executionSuccess = false;
    if (GUARD_ERROR_PATTERN.test(message)) {
      run.passedSafetyValidation = false;
      run.rejectionReason = message;
    } else {
      // The guard passed inside executeReadOnlySql; the database rejected the
      // statement (or another runtime failure occurred).
      run.passedSafetyValidation = true;
      run.rejectionReason = message;
    }
  }
  run.durationMs = Date.now() - started;
  return run;
}

function excerpt(value: string, length = 140): string {
  const flat = value.replace(/\s+/g, ' ');
  return flat.length > length ? flat.slice(0, length) + '…' : flat;
}

async function main(): Promise<void> {
  // Optional substring filter: npm run ai:compare -- "tasks assigned to Jordan"
  const filters = process.argv.slice(2).map((value) => value.toLowerCase());
  const questions = filters.length
    ? QUESTIONS.filter((question) => filters.some((filter) => question.toLowerCase().includes(filter)))
    : QUESTIONS;
  if (!questions.length) {
    console.error('No checklist questions match the provided filters.');
    process.exitCode = 1;
    return;
  }

  try {
    const connection = await verifySqlConnection();
    console.log(`Connected to SQL Server: ${connection.server} / ${connection.databaseName}\n`);
  } catch (error) {
    console.error('SQL Server is not reachable; cannot run the comparison.');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
    return;
  }

  const originalPipeline = process.env.SQL_PIPELINE;
  const runs: QuestionRun[] = [];
  try {
    for (const question of questions) {
      console.log(`\n=== ${question} ===`);
      for (const pipeline of ['legacy', 'llm_first'] as const) {
        const run = await runOne(question, pipeline);
        runs.push(run);
        console.log(`[${pipeline}] safety=${run.passedSafetyValidation} exec=${run.executionSuccess} rows=${run.rowCount}`);
        console.log(`  sql: ${excerpt(run.sql ?? '(none)', 200)}`);
        if (run.rejectionReason) console.log(`  reason: ${excerpt(run.rejectionReason, 200)}`);
        console.log(`  columns: ${run.resultColumns.join(', ') || '(none)'}`);
        console.log(`  answer: ${excerpt(run.answer)}`);
      }
    }
  } finally {
    if (originalPipeline === undefined) delete process.env.SQL_PIPELINE;
    else process.env.SQL_PIPELINE = originalPipeline;
  }

  const reportPath = path.resolve(
    process.cwd(),
    filters.length ? '.llm-first-comparison-retry.json' : '.llm-first-comparison.json',
  );
  writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), runs }, null, 2));
  console.log(`\nFull report written to ${reportPath}`);

  console.log('\nSummary:');
  for (const run of runs) {
    console.log(
      `- [${run.pipeline}] ${JSON.stringify(run.question)}: safety=${run.passedSafetyValidation} exec=${run.executionSuccess} rows=${run.rowCount} cols=${run.resultColumns.join('|') || '-'}`,
    );
  }

  await closeSqlPool();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
