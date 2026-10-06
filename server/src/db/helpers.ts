/**
 * db/helpers.ts — Shared database helpers
 * SQL Server implementation.
 */

import sql from 'mssql';
import { getPool } from './pool.js';
import type { UserRow } from './types.js';

export async function findUserById(
  _client: unknown,
  id: string,
): Promise<UserRow | undefined> {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('id', sql.NVarChar(255), id)
    .query<UserRow>(`
      SELECT *
      FROM dbo.users
      WHERE id = @id
    `);

  return result.recordset[0];
}

export function toPublicUser(user: UserRow) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    authProvider: user.auth_provider,
    profileImage: user.profile_image,
    role: user.role ?? 'Member',
    department: user.department ?? 'Engineering',
    status: user.status ?? 'Active',
    createdAt: user.created_at,
  };
}

/**
 * Activity logging is handled by the SQL Server stored procedure.
 */
export async function logActivity(
  _client: unknown,
  userId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  subject: string,
): Promise<string> {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('p_user_id', sql.NVarChar(255), userId)
    .input('p_action', sql.NVarChar(255), action)
    .input('p_entity_type', sql.NVarChar(100), entityType)
    .input('p_entity_id', sql.NVarChar(255), entityId)
    .input('p_subject', sql.NVarChar(255), subject)
    .output('p_id', sql.NVarChar(255))
    .execute('dbo.proc_log_activity');

  const id = result.output.p_id;

  if (!id) {
    throw new Error('ACTIVITY_ID_NOT_RETURNED');
  }

  return String(id);
}

/**
 * Notification creation is handled by the SQL Server stored procedure.
 */
export async function createNotification(
  _client: unknown,
  userId: string,
  title: string,
  message: string,
  type = 'info',
): Promise<string> {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('p_user_id', sql.NVarChar(255), userId)
    .input('p_title', sql.NVarChar(255), title)
    .input('p_message', sql.NVarChar(sql.MAX), message)
    .input('p_type', sql.NVarChar(100), type)
    .output('p_id', sql.NVarChar(255))
    .execute('dbo.proc_create_notification');

  const id = result.output.p_id;

  if (!id) {
    throw new Error('NOTIFICATION_ID_NOT_RETURNED');
  }

  return String(id);
}