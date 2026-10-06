import { generateSql } from './textToSql.js';
import { executeReadOnlySql } from './sqlExecutor.js';
import { formatDatabaseAnswer } from './resultFormatter.js';

export interface DatabaseQueryResult {
  sql: string;
  rows: unknown[];
  answer: string;
}

export async function answerDatabaseQuestion(
  question: string,
): Promise<DatabaseQueryResult> {
  const sql = await generateSql(question);
  const rows = await executeReadOnlySql(sql);
  const answer = formatDatabaseAnswer(question, sql, rows);

  return {
    sql,
    rows,
    answer,
  };
}
const DATABASE_INTENT =
  /\b(?:what|which|who|when|where|how|how many|how much|list|show|find|count|are there|is there|tell me|give me|latest|last|recent|assigned|completed|overdue)\b/i;

const WORKPLACE_ENTITY =
  /\b(?:project|projects|task|tasks|team|member|members|user|users|employee|employees|document|documents|calendar|event|events|meeting|meetings|activity|activities|notification|notifications|workload|workloads|assignment|assignments|deadline|deadlines)\b/i;

export function isDatabaseQuestion(question: string): boolean {
  const normalized = question.trim();

  if (!normalized) {
    return false;
  }

  return (
    DATABASE_INTENT.test(normalized) &&
    WORKPLACE_ENTITY.test(normalized)
  );
}