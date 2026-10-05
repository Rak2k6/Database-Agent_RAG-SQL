/**
 * db/projects.ts — Project operations
 * Reads  → PostgreSQL functions (list_projects, get_project_detail, get_project_members)
 * Writes → proc_create_project, proc_update_project, simple DELETE
 */
import { pool } from './pool.js';

// ── Types returned by PG functions ───────────────────────────────────────────

export interface ProjectListRow {
  id: string;
  name: string;
  description: string;
  status: string;
  start_date: Date | null;
  due_date: Date | null;
  creator_name: string;
  total_tasks: string;     // BIGINT → string from pg driver
  completed_tasks: string;
  progress: number;
}

export interface ProjectDetailRow extends ProjectListRow {
  created_at: Date;
  updated_at: Date;
}

export interface ProjectMemberRow {
  user_id: string;
  user_name: string;
  profile_image: string | null;
  member_role: string;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listProjects(
  search?: string,
  status?: string,
): Promise<ProjectListRow[]> {
  const r = await pool.query<ProjectListRow>(
    'SELECT * FROM list_projects($1, $2)',
    [search ?? null, status ?? null],
  );
  return r.rows;
}

export async function getProjectDetail(
  projectId: string,
): Promise<ProjectDetailRow | undefined> {
  const r = await pool.query<ProjectDetailRow>(
    'SELECT * FROM get_project_detail($1)',
    [projectId],
  );
  return r.rows[0];
}

export async function getProjectMembers(
  projectId: string,
): Promise<ProjectMemberRow[]> {
  const r = await pool.query<ProjectMemberRow>(
    'SELECT * FROM get_project_members($1)',
    [projectId],
  );
  return r.rows;
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function createProject(
  id: string,
  name: string,
  creatorId: string,
  status: string,
  startDate: string,
  dueDate: string,
  description: string,
): Promise<void> {
  await pool.query('CALL proc_create_project($1,$2,$3,$4,$5,$6,$7)', [
    id, name, creatorId, status, startDate, dueDate, description,
  ]);
}

export async function updateProject(
  projectId: string,
  userId: string,
  fields: {
    name?: string;
    description?: string;
    status?: string;
    start_date?: string;
    due_date?: string;
  },
): Promise<void> {
  await pool.query('CALL proc_update_project($1,$2,$3,$4,$5,$6,$7)', [
    projectId,
    userId,
    fields.name       ?? null,
    fields.description ?? null,
    fields.status     ?? null,
    fields.start_date ?? null,
    fields.due_date   ?? null,
  ]);
}

export async function deleteProject(projectId: string): Promise<boolean> {
  const r = await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
  return (r.rowCount ?? 0) > 0;
}

export async function addProjectMember(
  projectId: string,
  userId: string,
  role: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO project_members (project_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [projectId, userId, role],
  );
}

export async function removeProjectMember(
  projectId: string,
  userId: string,
): Promise<void> {
  await pool.query(
    'DELETE FROM project_members WHERE project_id = $1 AND user_id = $2',
    [projectId, userId],
  );
}
