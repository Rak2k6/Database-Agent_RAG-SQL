import type { Pool, PoolClient } from 'pg';
import { UserRow } from './types.js';

export type DbClient = Pool | PoolClient;

export async function findUserById(client: DbClient, id: string): Promise<UserRow | undefined> {
  const result = await client.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0];
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

export async function logActivity(client: DbClient, userId: string, action: string, entityType: string, entityId: string | null, subject: string) {
  const id = 'act_' + Math.random().toString(36).slice(2, 11);
  const now = new Date().toISOString();
  await client.query(
    `INSERT INTO activities (id, user_id, action, entity_type, entity_id, subject, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, userId, action, entityType, entityId, subject, now]
  );
  return id;
}

export async function createNotification(client: DbClient, userId: string, title: string, message: string, type: string = 'info') {
  const id = 'notif_' + Math.random().toString(36).slice(2, 11);
  const now = new Date().toISOString();
  await client.query(
    `INSERT INTO notifications (id, user_id, title, message, type, is_read, created_at)
     VALUES ($1, $2, $3, $4, $5, false, $6)`,
    [id, userId, title, message, type, now]
  );
  return id;
}
