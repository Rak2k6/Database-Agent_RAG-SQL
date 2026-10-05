import { database } from '../db.js';
import { validateReadOnlySql } from './sqlGuard.js';

export function executeReadOnlySql(sql: string): unknown[] {
  const start = Date.now();

  validateReadOnlySql(sql);

  const statement = database.prepare(sql);

  if (!statement.readonly) {
    throw new Error('Only read-only SQL statements are allowed.');
  }

  const rows = statement.all();

  console.log(`[DB] SQLite execution: ${Date.now() - start} ms`);

  return rows;
}