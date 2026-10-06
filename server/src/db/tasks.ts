/**
 * db/tasks.ts — Task operations
 * Reads  → SQL Server function (list_tasks)
 * Writes → proc_create_task, proc_update_task, simple DELETE
 */
import sql from 'mssql';
import { getPool } from './pool.js';

export interface TaskListRow {
  id: string;
  title: string;
  description: string;
  project_id: string;
  project_name: string;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  creator_name: string;
  priority: string;
  status: string;
  due_date: Date | null;
  completed_at: Date | null;
  is_overdue: boolean;
}

// ── Reads ────────────────────────────────────────────────────────────────────

function parseJsonResult<T>(value: string | null | undefined): T | undefined {
  if (value == null) {
    return undefined;
  }

  return JSON.parse(value) as T;
}

export async function listTasks(filters: {
  assignedTo?: string;
  projectId?: string;
  status?: string;
  priority?: string;
  search?: string;
}): Promise<TaskListRow[]> {
  const pool = await getPool();

  const r = await pool
    .request()
    .input('p_assigned_to', sql.NVarChar(sql.MAX), filters.assignedTo ?? null)
    .input('p_project_id', sql.NVarChar(sql.MAX), filters.projectId ?? null)
    .input('p_status', sql.NVarChar(sql.MAX), filters.status ?? null)
    .input('p_priority', sql.NVarChar(sql.MAX), filters.priority ?? null)
    .input('p_search', sql.NVarChar(sql.MAX), filters.search ?? null)
    .input('p_limit', sql.Int, 100)
    .input('p_offset', sql.Int, 0)
    .query<{ result: string | null }>(`
      SELECT dbo.list_tasks(
        @p_assigned_to,
        @p_project_id,
        @p_status,
        @p_priority,
        @p_search,
        @p_limit,
        @p_offset
      ) AS result
    `);

  const parsed = parseJsonResult<TaskListRow[]>(r.recordset[0]?.result);

  return parsed ?? [];
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function createTask(
  id: string,
  title: string,
  projectId: string,
  creatorId: string,
  priority: string,
  status: string,
  dueDate: string,
  description: string,
  assignedTo: string | null,
): Promise<string> {
  const pool = await getPool();

  const request = pool
    .request()
    .input('p_title', sql.NVarChar(255), title)
    .input('p_description', sql.NVarChar(sql.MAX), description)
    .input('p_status', sql.NVarChar(100), status)
    .input('p_priority', sql.NVarChar(100), priority)
    .input('p_due_date', sql.DateTime2, new Date(dueDate))
    .input('p_project_id', sql.NVarChar(255), projectId)
    .input('p_assigned_to', sql.NVarChar(255), assignedTo)
    .input('p_created_by', sql.NVarChar(255), creatorId)
    .output('p_id', sql.NVarChar(255));

  const result = await request.execute('dbo.proc_create_task');

  const generatedId = result.output.p_id;

  if (!generatedId) {
    throw new Error('TASK_ID_NOT_RETURNED');
  }

  return String(generatedId);
}

export async function updateTask(
  taskId: string,
  userId: string,
  fields: {
    title?: string;
    description?: string;
    project_id?: string;
    assigned_to?: string | null;
    priority?: string;
    status?: string;
    due_date?: string;
  },
): Promise<void> {
  const pool = await getPool();

  await pool
    .request()
    .input('p_task_id', sql.NVarChar(sql.MAX), taskId)
    .input('p_user_id', sql.NVarChar(sql.MAX), userId)
    .input('p_title', sql.NVarChar(sql.MAX), fields.title ?? null)
    .input('p_description', sql.NVarChar(sql.MAX), fields.description ?? null)
    .input('p_project_id', sql.NVarChar(sql.MAX), fields.project_id ?? null)
    .input('p_assigned_to', sql.NVarChar(sql.MAX), fields.assigned_to ?? null)
    .input('p_priority', sql.NVarChar(sql.MAX), fields.priority ?? null)
    .input('p_status', sql.NVarChar(sql.MAX), fields.status ?? null)
    .input(
      'p_due_date',
      sql.DateTime2,
      fields.due_date ? new Date(fields.due_date) : null,
    )
    .execute('dbo.proc_update_task');
}

export async function deleteTask(taskId: string): Promise<boolean> {
  const pool = await getPool();

  const r = await pool
    .request()
    .input('taskId', sql.NVarChar(255), taskId)
    .query(`
      DELETE FROM dbo.tasks
      WHERE id = @taskId
    `);

  return (r.rowsAffected[0] ?? 0) > 0;
}