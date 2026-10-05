/**
 * db/tasks.ts — Task operations
 * Reads  → list_tasks PostgreSQL function
 * Writes → proc_create_task, proc_update_task, simple DELETE
 */
import { pool } from './pool.js';

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

export async function listTasks(filters: {
  assignedTo?: string;
  projectId?: string;
  status?: string;
  priority?: string;
  search?: string;
}): Promise<TaskListRow[]> {
  const r = await pool.query<TaskListRow>(
    'SELECT * FROM list_tasks($1,$2,$3,$4,$5)',
    [
      filters.assignedTo ?? null,
      filters.projectId  ?? null,
      filters.status     ?? null,
      filters.priority   ?? null,
      filters.search     ?? null,
    ],
  );
  return r.rows;
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
): Promise<void> {
  await pool.query('CALL proc_create_task($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
    id, title, projectId, creatorId, priority, status, dueDate, description, assignedTo,
  ]);
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
  await pool.query('CALL proc_update_task($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
    taskId,
    userId,
    fields.title       ?? null,
    fields.description ?? null,
    fields.project_id  ?? null,
    fields.assigned_to ?? null,
    fields.priority    ?? null,
    fields.status      ?? null,
    fields.due_date    ?? null,
  ]);
}

export async function deleteTask(taskId: string): Promise<boolean> {
  const r = await pool.query('DELETE FROM tasks WHERE id = $1', [taskId]);
  return (r.rowCount ?? 0) > 0;
}
