import 'dotenv/config';
import { closeSqlPool, getPool } from '../src/db/pool.js';

async function main(): Promise<void> {
  const pool = await getPool();

  console.log('── tables ─────────────────────────────────');
  const tables = await pool.request().query(`
    SELECT TABLE_SCHEMA, TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_SCHEMA, TABLE_NAME
  `);
  console.log(tables.recordset.map((r) => `${r.TABLE_SCHEMA}.${r.TABLE_NAME}`).join('\n'));

  console.log('\n── project_members columns ────────────────');
  const cols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'project_members'
    ORDER BY ORDINAL_POSITION
  `);
  console.table(cols.recordset);

  console.log('\n── documents columns ──────────────────────');
  const docCols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'documents'
    ORDER BY ORDINAL_POSITION
  `);
  console.table(docCols.recordset);

  console.log('\n── get_project_members definition ─────────');
  const def = await pool.request().query(`
    SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.get_project_members')) AS definition
  `);
  console.log(def.recordset[0]?.definition ?? '(not found or null)');

  console.log('\n── project_members rows ───────────────────');
  const members = await pool.request().query('SELECT * FROM project_members ORDER BY project_id, user_id');
  console.table(members.recordset);

  console.log('\n── proc_create_project definition ─────────');
  const procDef = await pool.request().query(`
    SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.proc_create_project')) AS definition
  `);
  console.log(procDef.recordset[0]?.definition ?? '(not found or null)');

  console.log('\n── documents rows ─────────────────────────');
  const docs = await pool.request().query('SELECT id, name, uploaded_by, project_id FROM documents');
  console.table(docs.recordset);

  console.log('\n── users ──────────────────────────────────');
  const users = await pool.request().query('SELECT id, name, email, role, status FROM users');
  console.table(users.recordset);

  console.log('\n── projects ───────────────────────────────');
  const projects = await pool.request().query('SELECT id, name, status, created_by FROM projects');
  console.table(projects.recordset);
}

main()
  .catch((error) => {
    console.error('INSPECTION FAILED:', error);
    process.exitCode = 1;
  })
  .finally(() => closeSqlPool());