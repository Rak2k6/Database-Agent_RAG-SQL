/**
 * db/settings.ts — User profile & settings operations (all parameterized SQL)
 */
import { pool } from './pool.js';
import type { UserSettingsRow } from './types.js';

export async function getUserSettings(
  userId: string,
): Promise<UserSettingsRow | undefined> {
  const r = await pool.query<UserSettingsRow>(
    'SELECT * FROM user_settings WHERE user_id = $1',
    [userId],
  );
  return r.rows[0];
}

export async function upsertUserSettings(
  userId: string,
  theme: string,
  notifyTaskAssignments: boolean,
  notifyProjectUpdates: boolean,
  notifyUpcomingMeetings: boolean,
  notifyDeadlineReminders: boolean,
): Promise<void> {
  await pool.query(
    `INSERT INTO user_settings
       (user_id, theme, notify_task_assignments, notify_project_updates,
        notify_upcoming_meetings, notify_deadline_reminders, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       theme                    = EXCLUDED.theme,
       notify_task_assignments  = EXCLUDED.notify_task_assignments,
       notify_project_updates   = EXCLUDED.notify_project_updates,
       notify_upcoming_meetings = EXCLUDED.notify_upcoming_meetings,
       notify_deadline_reminders = EXCLUDED.notify_deadline_reminders,
       updated_at               = EXCLUDED.updated_at`,
    [userId, theme, notifyTaskAssignments, notifyProjectUpdates, notifyUpcomingMeetings, notifyDeadlineReminders],
  );
}

export async function updateUserProfile(
  userId: string,
  fields: {
    name?: string;
    department?: string;
    role?: string;
    profile_image?: string;
  },
): Promise<void> {
  await pool.query(
    `UPDATE users SET
       name          = COALESCE($1, name),
       department    = COALESCE($2, department),
       role          = COALESCE($3, role),
       profile_image = COALESCE($4, profile_image),
       updated_at    = NOW()
     WHERE id = $5`,
    [
      fields.name          ?? null,
      fields.department    ?? null,
      fields.role          ?? null,
      fields.profile_image ?? null,
      userId,
    ],
  );
}
