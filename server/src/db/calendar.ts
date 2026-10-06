/**
 * db/calendar.ts — Calendar event operations
 * Read  → SQL Server list_calendar_events function
 * Write → INSERT + proc_log_activity + DELETE
 */
import sql from 'mssql';
import { getPool } from './pool.js';

export interface CalendarEventRow {
  id: string;
  title: string;
  description: string;
  start_time: Date;
  end_time: Date;
  event_type: string;
  project_id: string | null;
  project_name: string | null;
  creator_name: string;
}

function parseJsonResult<T>(value: string | null | undefined): T | undefined {
  if (value == null) {
    return undefined;
  }

  return JSON.parse(value) as T;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listCalendarEvents(): Promise<CalendarEventRow[]> {
  const pool = await getPool();

  const r = await pool
    .request()
    .input('p_limit', sql.Int, 100)
    .input('p_offset', sql.Int, 0)
    .query<{ result: string | null }>(`
      SELECT dbo.list_calendar_events(
        @p_limit,
        @p_offset
      ) AS result
    `);

  const parsed = parseJsonResult<CalendarEventRow[]>(r.recordset[0]?.result);

  return parsed ?? [];
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function createCalendarEvent(
  id: string,
  title: string,
  description: string,
  startTime: string,
  endTime: string,
  eventType: string,
  createdBy: string,
  projectId: string | null,
): Promise<void> {
  const pool = await getPool();

  await pool
    .request()
    .input('id', sql.NVarChar(255), id)
    .input('title', sql.NVarChar(255), title)
    .input('description', sql.NVarChar(sql.MAX), description)
    .input('start_time', sql.DateTime2, new Date(startTime))
    .input('end_time', sql.DateTime2, new Date(endTime))
    .input('event_type', sql.NVarChar(100), eventType)
    .input('created_by', sql.NVarChar(255), createdBy)
    .input('project_id', sql.NVarChar(255), projectId)
    .query(`
      INSERT INTO dbo.calendar_events
        (id, title, description, start_time, end_time,
         event_type, created_by, project_id, created_at)
      VALUES
        (@id, @title, @description, @start_time, @end_time,
         @event_type, @created_by, @project_id, SYSUTCDATETIME())
    `);

  // Log activity using the SQL Server stored procedure.
  await pool
    .request()
    .input('p_user_id', sql.NVarChar(255), createdBy)
    .input('p_action', sql.NVarChar(255), 'scheduled a meeting for')
    .input('p_entity_type', sql.NVarChar(100), 'event')
    .input('p_entity_id', sql.NVarChar(255), id)
    .input('p_subject', sql.NVarChar(255), title)
    .execute('dbo.proc_log_activity');
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const pool = await getPool();

  await pool
    .request()
    .input('eventId', sql.NVarChar(255), eventId)
    .query(`
      DELETE FROM dbo.calendar_events
      WHERE id = @eventId
    `);
}