/**
 * db/team.ts — Team member operations
 * Read  → list_team_members PostgreSQL function
 * Write → simple INSERT (new team member)
 */
import { pool } from './pool.js';

export interface TeamMemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  status: string;
  profile_image: string | null;
  assigned_tasks_count: string;   // BIGINT → string
  completed_tasks_count: string;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listTeamMembers(
  search?: string,
  department?: string,
): Promise<TeamMemberRow[]> {
  const r = await pool.query<TeamMemberRow>(
    'SELECT * FROM list_team_members($1, $2)',
    [search ?? null, department ?? null],
  );
  return r.rows;
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
  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, auth_provider, role, department, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'local',$5,$6,'Active',NOW(),NOW())`,
    [id, name, email, passwordHash, role, department],
  );
}

export async function teamEmailExists(email: string): Promise<boolean> {
  const r = await pool.query<{ id: string }>(
    'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
    [email],
  );
  return r.rows.length > 0;
}
