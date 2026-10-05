/**
 * db/notifications.ts — Notification operations (all parameterized SQL)
 */
import { pool } from './pool.js';
import type { NotificationRow } from './types.js';

export async function getUserNotifications(
  userId: string,
  limit = 20,
): Promise<NotificationRow[]> {
  const r = await pool.query<NotificationRow>(
    'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit],
  );
  return r.rows;
}

export async function getUnreadCount(userId: string): Promise<number> {
  const r = await pool.query<{ c: string }>(
    'SELECT COUNT(*) AS c FROM notifications WHERE user_id = $1 AND is_read = false',
    [userId],
  );
  return parseInt(r.rows[0]?.c ?? '0', 10);
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await pool.query(
    'UPDATE notifications SET is_read = true WHERE id = $1',
    [notificationId],
  );
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await pool.query(
    'UPDATE notifications SET is_read = true WHERE user_id = $1',
    [userId],
  );
}
