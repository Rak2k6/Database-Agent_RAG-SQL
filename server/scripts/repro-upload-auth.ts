import 'dotenv/config';
import sql from 'mssql';
import { closeSqlPool, getPool } from '../src/db/pool.js';
import * as Projects from '../src/db/projects.js';

async function main(): Promise<void> {
  const pool = await getPool();

  const users = await pool.request().query('SELECT id, name, email FROM users ORDER BY id');
  console.log('── users ──');
  console.table(users.recordset);

  const sessions = await pool.request().query(`
    SELECT s.token_hash, s.user_id, s.expires_at, u.name, u.email
    FROM dbo.sessions s
    LEFT JOIN dbo.users u ON u.id = s.user_id
    ORDER BY s.created_at DESC
  `);
  console.log('── active sessions ──');
  console.table(sessions.recordset);

  // Simulate the upload authorization check for every user × project.
  const projects = (await pool.request().query('SELECT id, name FROM projects')).recordset as { id: string; name: string }[];
  const membersCache = new Map<string, Awaited<ReturnType<typeof Projects.getProjectMembers>>>();
  for (const project of projects) {
    const raw = await pool
      .request()
      .input('p_project_id', sql.NVarChar(sql.MAX), project.id)
      .query<{ result: string | null }>('SELECT dbo.get_project_members(@p_project_id) AS result');
    const fnValue = raw.recordset[0]?.result;
    const parsed = await Projects.getProjectMembers(project.id);
    membersCache.set(project.id, parsed);
    console.log(
      `project=${project.id.padEnd(20)} fnRawType=${typeof fnValue} fnRaw=${JSON.stringify(fnValue).slice(0, 120)} parsedCount=${parsed.length}`,
    );
  }

  console.log('\n── membership matrix (user can upload? true/false) ──');
  for (const user of users.recordset as { id: string; name: string }[]) {
    const row: Record<string, boolean> = {};
    for (const project of projects) {
      row[project.id] = (membersCache.get(project.id) ?? []).some((m) => m.user_id === user.id);
    }
    console.log(`${user.id.padEnd(40)}`, row);
  }
}

main()
  .catch((error) => {
    console.error('INSPECTION FAILED:', error);
    process.exitCode = 1;
  })
  .finally(() => closeSqlPool());
