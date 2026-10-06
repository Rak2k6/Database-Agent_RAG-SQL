/**
 * db/team.ts — Team member operations
 * Read  → SQL Server list_team_members function
 * Write → simple INSERT
 */
import sql from 'mssql';
import { getPool } from './pool.js';

export interface TeamMemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  status: string;
  profile_image: string | null;
  assigned_tasks_count: number;
  completed_tasks_count: number;
}

// ── Reads ────────────────────────────────────────────────────────────────────

function parseJsonResult<T>(value: string | null | undefined): T | undefined {
  if (value == null) {
    return undefined;
  }

  return JSON.parse(value) as T;
}

export async function listTeamMembers(
  search?: string,
  department?: string,
): Promise<TeamMemberRow[]> {
  const pool = await getPool();

  const r = await pool
    .request()
    .input('p_search', sql.NVarChar(sql.MAX), search ?? null)
    .input('p_department', sql.NVarChar(sql.MAX), department ?? null)
    .input('p_limit', sql.Int, 100)
    .input('p_offset', sql.Int, 0)
    .query<{ result: string | null }>(`
      SELECT dbo.list_team_members(
        @p_search,
        @p_department,
        @p_limit,
        @p_offset
      ) AS result
    `);

  const parsed = parseJsonResult<TeamMemberRow[]>(
    r.recordset[0]?.result,
  );

  return (parsed ?? []).map((member) => ({
    ...member,
    assigned_tasks_count: Number(member.assigned_tasks_count ?? 0),
    completed_tasks_count: Number(member.completed_tasks_count ?? 0),
  }));
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function addTeamMember(
  id: string,
  name: string,
  email: string,
  passwordHash: string,
  role: string,
  department: string,
): Promise<void> {
  const pool = await getPool();

  await pool
    .request()
    .input('id', sql.NVarChar(255), id)
    .input('name', sql.NVarChar(255), name)
    .input('email', sql.NVarChar(255), email)
    .input('password_hash', sql.NVarChar(255), passwordHash)
    .input('auth_provider', sql.NVarChar(100), 'local')
    .input('role', sql.NVarChar(255), role)
    .input('department', sql.NVarChar(255), department)
    .input('status', sql.NVarChar(100), 'Active')
    .query(`
      INSERT INTO dbo.users
      (
        id,
        name,
        email,
        password_hash,
        auth_provider,
        role,
        department,
        status,
        created_at,
        updated_at
      )
      VALUES
      (
        @id,
        @name,
        @email,
        @password_hash,
        @auth_provider,
        @role,
        @department,
        @status,
        SYSUTCDATETIME(),
        SYSUTCDATETIME()
      )
    `);
}

export async function teamEmailExists(
  email: string,
): Promise<boolean> {
  const pool = await getPool();

  const r = await pool
    .request()
    .input('email', sql.NVarChar(255), email)
    .query<{ id: string }>(`
      SELECT TOP 1 id
      FROM dbo.users
      WHERE LOWER(email) = LOWER(@email)
    `);

  return r.recordset.length > 0;
}