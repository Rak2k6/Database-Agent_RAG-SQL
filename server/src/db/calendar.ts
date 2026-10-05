/**
 * db/calendar.ts — Calendar event operations
 * Read  → list_calendar_events PostgreSQL function
 * Write → simple INSERT + standalone fn_log_activity call, simple DELETE
 */
import { pool } from './pool.js';

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

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listCalendarEvents(): Promise<CalendarEventRow[]> {
  const r = await pool.query<CalendarEventRow>(
    'SELECT * FROM list_calendar_events()',
  );
  return r.rows;
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
  await pool.query(
    `INSERT INTO calendar_events (id, title, description, start_time, end_time, event_type, created_by, project_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
    [id, title, description, startTime, endTime, eventType, createdBy, projectId],
  );
  // Log activity standalone (auto-commits in its own implicit transaction)
  await pool.query(
    `SELECT fn_log_activity($1, 'scheduled a meeting for', 'event', $2, $3)`,
    [createdBy, id, title],
  );
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  await pool.query('DELETE FROM calendar_events WHERE id = $1', [eventId]);
}
