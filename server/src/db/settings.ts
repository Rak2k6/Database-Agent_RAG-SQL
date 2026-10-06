/**
 * db/settings.ts — User profile & settings operations
 * All operations use parameterized SQL Server queries.
 */
import sql from 'mssql';
import { getPool } from './pool.js';
import type { UserSettingsRow } from './types.js';

export async function getUserSettings(
  userId: string,
): Promise<UserSettingsRow | undefined> {
  const pool = await getPool();

  const r = await pool
    .request()
    .input('userId', sql.NVarChar(255), userId)
    .query<UserSettingsRow>(`
      SELECT
        user_id,
        theme,
        notify_task_assignments,
        notify_project_updates,
        notify_upcoming_meetings,
        notify_deadline_reminders,
        updated_at
      FROM dbo.user_settings
      WHERE user_id = @userId
    `);

  return r.recordset[0];
}

export async function upsertUserSettings(
  userId: string,
  theme: string,
  notifyTaskAssignments: boolean,
  notifyProjectUpdates: boolean,
  notifyUpcomingMeetings: boolean,
  notifyDeadlineReminders: boolean,
): Promise<void> {
  const pool = await getPool();

  await pool
    .request()
    .input('userId', sql.NVarChar(255), userId)
    .input('theme', sql.NVarChar(100), theme)
    .input(
      'notifyTaskAssignments',
      sql.Bit,
      notifyTaskAssignments,
    )
    .input(
      'notifyProjectUpdates',
      sql.Bit,
      notifyProjectUpdates,
    )
    .input(
      'notifyUpcomingMeetings',
      sql.Bit,
      notifyUpcomingMeetings,
    )
    .input(
      'notifyDeadlineReminders',
      sql.Bit,
      notifyDeadlineReminders,
    )
    .query(`
      UPDATE dbo.user_settings
      SET
        theme = @theme,
        notify_task_assignments = @notifyTaskAssignments,
        notify_project_updates = @notifyProjectUpdates,
        notify_upcoming_meetings = @notifyUpcomingMeetings,
        notify_deadline_reminders = @notifyDeadlineReminders,
        updated_at = SYSUTCDATETIME()
      WHERE user_id = @userId;

      IF @@ROWCOUNT = 0
      BEGIN
        INSERT INTO dbo.user_settings
        (
          user_id,
          theme,
          notify_task_assignments,
          notify_project_updates,
          notify_upcoming_meetings,
          notify_deadline_reminders,
          updated_at
        )
        VALUES
        (
          @userId,
          @theme,
          @notifyTaskAssignments,
          @notifyProjectUpdates,
          @notifyUpcomingMeetings,
          @notifyDeadlineReminders,
          SYSUTCDATETIME()
        );
      END;
    `);
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
  const pool = await getPool();

  await pool
    .request()
    .input('name', sql.NVarChar(255), fields.name ?? null)
    .input(
      'department',
      sql.NVarChar(255),
      fields.department ?? null,
    )
    .input('role', sql.NVarChar(255), fields.role ?? null)
    .input(
      'profile_image',
      sql.NVarChar(500),
      fields.profile_image ?? null,
    )
    .input('userId', sql.NVarChar(255), userId)
    .query(`
      UPDATE dbo.users
      SET
        name = COALESCE(@name, name),
        department = COALESCE(@department, department),
        role = COALESCE(@role, role),
        profile_image = COALESCE(@profile_image, profile_image),
        updated_at = SYSUTCDATETIME()
      WHERE id = @userId
    `);
}