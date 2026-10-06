/**
 * db/auth.ts — Auth & session operations (all parameterized SQL, app-only)
 *
 * SQL Server implementation.
 */

import sql from 'mssql';
import { getPool } from './pool.js';
import type { UserRow } from './types.js';

// ─── User lookups ────────────────────────────────────────────────────────────

export async function findUserById(id: string): Promise<UserRow | undefined> {
  const pool = await getPool();

  const r = await pool
    .request()
    .input('id', sql.NVarChar(255), id)
    .query<UserRow>(
      'SELECT * FROM dbo.users WHERE id = @id',
    );

  return r.recordset[0];
}

export async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const pool = await getPool();

  const r = await pool
    .request()
    .input('email', sql.NVarChar(255), email)
    .query<UserRow>(
      'SELECT * FROM dbo.users WHERE LOWER(email) = LOWER(@email)',
    );

  return r.recordset[0];
}

export async function checkEmailExists(email: string): Promise<boolean> {
  const pool = await getPool();

  const r = await pool
    .request()
    .input('email', sql.NVarChar(255), email)
    .query<{ id: string }>(
      'SELECT id FROM dbo.users WHERE LOWER(email) = LOWER(@email)',
    );

  return r.recordset.length > 0;
}

// ─── User creation ───────────────────────────────────────────────────────────

export async function createLocalUser(
  id: string,
  name: string,
  email: string,
  passwordHash: string,
): Promise<void> {
  const pool = await getPool();

  await pool
    .request()
    .input('id', sql.NVarChar(255), id)
    .input('name', sql.NVarChar(255), name)
    .input('email', sql.NVarChar(255), email)
    .input('passwordHash', sql.NVarChar(sql.MAX), passwordHash)
    .query(`
      INSERT INTO dbo.users
        (id, name, email, password_hash, auth_provider, created_at, updated_at)
      VALUES
        (@id, @name, @email, @passwordHash, 'local',
         SYSUTCDATETIME(), SYSUTCDATETIME())
    `);
}

export async function createGoogleUser(
  id: string,
  name: string,
  email: string,
  googleId: string,
  profileImage: string | null,
): Promise<void> {
  const pool = await getPool();

  await pool
    .request()
    .input('id', sql.NVarChar(255), id)
    .input('name', sql.NVarChar(255), name)
    .input('email', sql.NVarChar(255), email)
    .input('googleId', sql.NVarChar(255), googleId)
    .input('profileImage', sql.NVarChar(sql.MAX), profileImage)
    .query(`
      INSERT INTO dbo.users
        (id, name, email, auth_provider, google_id, profile_image,
         created_at, updated_at)
      VALUES
        (@id, @name, @email, 'google', @googleId, @profileImage,
         SYSUTCDATETIME(), SYSUTCDATETIME())
    `);
}

export async function linkGoogleId(
  userId: string,
  googleId: string,
): Promise<void> {
  const pool = await getPool();

  await pool
    .request()
    .input('googleId', sql.NVarChar(255), googleId)
    .input('userId', sql.NVarChar(255), userId)
    .query(`
      UPDATE dbo.users
      SET google_id = @googleId,
          updated_at = SYSUTCDATETIME()
      WHERE id = @userId
    `);
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export async function createSession(
  tokenHash: string,
  userId: string,
  expiresAt: number,
): Promise<void> {
  const pool = await getPool();

  await pool
    .request()
    .input('tokenHash', sql.NVarChar(255), tokenHash)
    .input('userId', sql.NVarChar(255), userId)
    .input('expiresAt', sql.BigInt, expiresAt)
    .input('createdAt', sql.BigInt, Date.now())
    .query(`
      INSERT INTO dbo.sessions
        (token_hash, user_id, expires_at, created_at)
      VALUES
        (@tokenHash, @userId, @expiresAt, @createdAt)
    `);
}

export async function validateSession(
  tokenHash: string,
  nowMs: number,
): Promise<{ user_id: string } | undefined> {
  const pool = await getPool();

  const r = await pool
    .request()
    .input('tokenHash', sql.NVarChar(255), tokenHash)
    .input('nowMs', sql.BigInt, nowMs)
    .query<{ user_id: string }>(`
      SELECT user_id
      FROM dbo.sessions
      WHERE token_hash = @tokenHash
        AND expires_at > @nowMs
    `);

  return r.recordset[0];
}

export async function deleteSession(tokenHash: string): Promise<void> {
  const pool = await getPool();

  await pool
    .request()
    .input('tokenHash', sql.NVarChar(255), tokenHash)
    .query(`
      DELETE FROM dbo.sessions
      WHERE token_hash = @tokenHash
    `);
}

// ─── Password reset tokens ───────────────────────────────────────────────────

export async function insertResetToken(
  tokenHash: string,
  userId: string,
  expiresAt: number,
): Promise<void> {
  const pool = await getPool();

  await pool
    .request()
    .input('tokenHash', sql.NVarChar(255), tokenHash)
    .input('userId', sql.NVarChar(255), userId)
    .input('expiresAt', sql.BigInt, expiresAt)
    .query(`
      INSERT INTO dbo.password_reset_tokens
        (token_hash, user_id, expires_at)
      VALUES
        (@tokenHash, @userId, @expiresAt)
    `);
}

export async function lookupResetToken(
  tokenHash: string,
): Promise<{
  token_hash: string;
  user_id: string;
  expires_at: number;
  used_at: number | null;
} | undefined> {
  const pool = await getPool();

  const r = await pool
    .request()
    .input('tokenHash', sql.NVarChar(255), tokenHash)
    .query<{
      token_hash: string;
      user_id: string;
      expires_at: number;
      used_at: number | null;
    }>(`
      SELECT token_hash, user_id, expires_at, used_at
      FROM dbo.password_reset_tokens
      WHERE token_hash = @tokenHash
    `);

  return r.recordset[0];
}

/**
 * Atomically validates and consumes the reset token, updates the password,
 * deletes other reset tokens, and invalidates all sessions.
 *
 * The SQL Server procedure raises 'RESET_TOKEN_INVALID' when the token
 * is already used or expired.
 */
export async function resetUserPassword(
  tokenHash: string,
  newPasswordHash: string,
  nowMs: number,
): Promise<void> {
  const pool = await getPool();

  await pool
    .request()
    .input('p_token_hash', sql.NVarChar(sql.MAX), tokenHash)
    .input('p_new_password_hash', sql.NVarChar(sql.MAX), newPasswordHash)
    .input('p_now_ms', sql.BigInt, nowMs)
    .execute('dbo.proc_reset_user_password');
}

// ─── Profile helpers ─────────────────────────────────────────────────────────

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