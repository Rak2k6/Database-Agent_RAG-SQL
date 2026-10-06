/**
 * db/projects.ts — Project operations
 * Reads  → SQL Server functions (list_projects, get_project_detail, get_project_members)
 * Writes → proc_create_project, proc_update_project, simple DELETE
 */
import sql from 'mssql';
import { getPool } from './pool.js';

// ── Types returned by SQL Server functions ───────────────────────────────────

export interface ProjectListRow {
  id: string;
  name: string;
  description: string;
  status: string;
  start_date: Date | null;
  due_date: Date | null;
  creator_name: string;
  total_tasks: number;
  completed_tasks: number;
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

function parseJsonResult<T>(value: string | null | undefined): T | undefined {
  if (value == null) {
    return undefined;
  }

  return JSON.parse(value) as T;
}

export async function listProjects(
  search?: string,
  status?: string,
): Promise<ProjectListRow[]> {
  const pool = await getPool();

  const r = await pool
    .request()
    .input('p_search', sql.NVarChar(sql.MAX), search ?? null)
    .input('p_status', sql.NVarChar(sql.MAX), status ?? null)
    .input('p_limit', sql.Int, 100)
    .input('p_offset', sql.Int, 0)
    .query<{ result: string | null }>(`
      SELECT dbo.list_projects(
        @p_search,
        @p_status,
        @p_limit,
        @p_offset
      ) AS result
    `);

  const parsed = parseJsonResult<ProjectListRow[]>(r.recordset[0]?.result);

  return (parsed ?? []).map((project) => ({
    ...project,
    total_tasks: Number(project.total_tasks ?? 0),
    completed_tasks: Number(project.completed_tasks ?? 0),
    progress: Number(project.progress ?? 0),
  }));
}

export async function getProjectDetail(
  projectId: string,
): Promise<ProjectDetailRow | undefined> {
  const pool = await getPool();

  const r = await pool
    .request()
    .input('p_project_id', sql.NVarChar(sql.MAX), projectId)
    .query<{ result: string | null }>(`
      SELECT dbo.get_project_detail(@p_project_id) AS result
    `);

  const parsed = parseJsonResult<ProjectDetailRow>(r.recordset[0]?.result);

  if (!parsed) {
    return undefined;
  }

  return {
    ...parsed,
    total_tasks: Number(parsed.total_tasks ?? 0),
    completed_tasks: Number(parsed.completed_tasks ?? 0),
    progress: Number(parsed.progress ?? 0),
  };
}

export async function getProjectMembers(
  projectId: string,
): Promise<ProjectMemberRow[]> {
  const pool = await getPool();

  const r = await pool
    .request()
    .input('p_project_id', sql.NVarChar(sql.MAX), projectId)
    .query<{ result: string | null }>(`
      SELECT dbo.get_project_members(@p_project_id) AS result
    `);

  const parsed = parseJsonResult<ProjectMemberRow[]>(r.recordset[0]?.result);

  return parsed ?? [];
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
  const pool = await getPool();

  await pool
    .request()
    .input('p_id', sql.NVarChar(sql.MAX), id)
    .input('p_name', sql.NVarChar(sql.MAX), name)
    .input('p_creator_id', sql.NVarChar(sql.MAX), creatorId)
    .input('p_status', sql.NVarChar(sql.MAX), status)
    .input('p_start_date', sql.DateTime2, new Date(startDate))
    .input('p_due_date', sql.DateTime2, new Date(dueDate))
    .input('p_description', sql.NVarChar(sql.MAX), description)
    .execute('dbo.proc_create_project');
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
  const pool = await getPool();

  await pool
    .request()
    .input('p_project_id', sql.NVarChar(sql.MAX), projectId)
    .input('p_user_id', sql.NVarChar(sql.MAX), userId)
    .input('p_name', sql.NVarChar(sql.MAX), fields.name ?? null)
    .input('p_description', sql.NVarChar(sql.MAX), fields.description ?? null)
    .input('p_status', sql.NVarChar(sql.MAX), fields.status ?? null)
    .input(
      'p_start_date',
      sql.DateTime2,
      fields.start_date ? new Date(fields.start_date) : null,
    )
    .input(
      'p_due_date',
      sql.DateTime2,
      fields.due_date ? new Date(fields.due_date) : null,
    )
    .execute('dbo.proc_update_project');
}

export async function deleteProject(projectId: string): Promise<boolean> {
  const pool = await getPool();

  const r = await pool
    .request()
    .input('projectId', sql.NVarChar(sql.MAX), projectId)
    .query(`
      DELETE FROM dbo.projects
      WHERE id = @projectId
    `);

  return (r.rowsAffected[0] ?? 0) > 0;
}

export async function addProjectMember(
  projectId: string,
  userId: string,
  role: string,
): Promise<void> {
  const pool = await getPool();

  await pool
    .request()
    .input('projectId', sql.NVarChar(sql.MAX), projectId)
    .input('userId', sql.NVarChar(sql.MAX), userId)
    .input('role', sql.NVarChar(sql.MAX), role)
    .query(`
      MERGE dbo.project_members AS target
      USING (
        SELECT
          @projectId AS project_id,
          @userId AS user_id,
          @role AS role
      ) AS source
      ON target.project_id = source.project_id
         AND target.user_id = source.user_id
      WHEN MATCHED THEN
        UPDATE SET role = source.role
      WHEN NOT MATCHED THEN
        INSERT (project_id, user_id, role)
        VALUES (source.project_id, source.user_id, source.role);
    `);
}

export async function removeProjectMember(
  projectId: string,
  userId: string,
): Promise<void> {
  const pool = await getPool();

  await pool
    .request()
    .input('projectId', sql.NVarChar(sql.MAX), projectId)
    .input('userId', sql.NVarChar(sql.MAX), userId)
    .query(`
      DELETE FROM dbo.project_members
      WHERE project_id = @projectId
        AND user_id = @userId
    `);
}