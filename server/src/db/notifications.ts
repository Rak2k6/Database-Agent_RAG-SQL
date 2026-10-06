/**
 * db/notifications.ts — Notification operations
 * All operations use parameterized SQL Server queries.
 */
import sql from 'mssql';
import { getPool } from './pool.js';
import type { NotificationRow } from './types.js';

export async function getUserNotifications(
  userId: string,
  limit = 20,
): Promise<NotificationRow[]> {
  const pool = await getPool();

  const r = await pool
    .request()
    .input('userId', sql.NVarChar(255), userId)
    .input('limit', sql.Int, limit)
    .query<NotificationRow>(`
      SELECT TOP (@limit)
        id,
        user_id,
        title,
        message,
        type,
        is_read,
        created_at
      FROM dbo.notifications
      WHERE user_id = @userId
      ORDER BY created_at DESC
    `);

  return r.recordset;
}

export async function getUnreadCount(userId: string): Promise<number> {
  const pool = await getPool();

  const r = await pool
    .request()
    .input('userId', sql.NVarChar(255), userId)
    .query<{ c: number | string }>(`
      SELECT COUNT(*) AS c
      FROM dbo.notifications
      WHERE user_id = @userId
        AND is_read = 0
    `);

  return Number(r.recordset[0]?.c ?? 0);
}

export async function markNotificationRead(
  notificationId: string,
): Promise<void> {
  const pool = await getPool();

  await pool
    .request()
    .input('notificationId', sql.NVarChar(255), notificationId)
    .query(`
      UPDATE dbo.notifications
      SET is_read = 1
      WHERE id = @notificationId
    `);
}

export async function markAllNotificationsRead(
  userId: string,
): Promise<void> {
  const pool = await getPool();

  await pool
    .request()
    .input('userId', sql.NVarChar(255), userId)
    .query(`
      UPDATE dbo.notifications
      SET is_read = 1
      WHERE user_id = @userId
    `);
}