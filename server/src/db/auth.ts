/**
 * db/auth.ts — Auth & session operations (all parameterized SQL, app-only)
 */
import { pool } from './pool.js';
import type { UserRow } from './types.js';

// ─── User lookups ────────────────────────────────────────────────────────────

export async function findUserById(id: string): Promise<UserRow | undefined> {
  const r = await pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return r.rows[0];
}

export async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const r = await pool.query<UserRow>(
    'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
    [email],
  );
  return r.rows[0];
}

export async function checkEmailExists(email: string): Promise<boolean> {
  const r = await pool.query<{ id: string }>(
    'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
    [email],
  );
  return r.rows.length > 0;
}

// ─── User creation ───────────────────────────────────────────────────────────

export async function createLocalUser(
  id: string,
  name: string,
  email: string,
  passwordHash: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, auth_provider, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'local', NOW(), NOW())`,
    [id, name, email, passwordHash],
  );
}

export async function createGoogleUser(
  id: string,
  name: string,
  email: string,
  googleId: string,
  profileImage: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, name, email, auth_provider, google_id, profile_image, created_at, updated_at)
     VALUES ($1, $2, $3, 'google', $4, $5, NOW(), NOW())`,
    [id, name, email, googleId, profileImage],
  );
}

export async function linkGoogleId(userId: string, googleId: string): Promise<void> {
  await pool.query(
    'UPDATE users SET google_id = $1, updated_at = NOW() WHERE id = $2',
    [googleId, userId],
  );
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export async function createSession(
  tokenHash: string,
  userId: string,
  expiresAt: number,
): Promise<void> {
  await pool.query(
    'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)',
    [tokenHash, userId, expiresAt, Date.now()],
  );
}

export async function validateSession(
  tokenHash: string,
  nowMs: number,
): Promise<{ user_id: string } | undefined> {
  const r = await pool.query<{ user_id: string }>(
    'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > $2',
    [tokenHash, nowMs],
  );
  return r.rows[0];
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

// ─── Password reset tokens ───────────────────────────────────────────────────

export async function insertResetToken(
  tokenHash: string,
  userId: string,
  expiresAt: number,
): Promise<void> {
  await pool.query(
    'INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [tokenHash, userId, expiresAt],
  );
}

export async function lookupResetToken(tokenHash: string): Promise<{
  token_hash: string;
  user_id: string;
  expires_at: number;
  used_at: number | null;
} | undefined> {
  const r = await pool.query<{
    token_hash: string;
    user_id: string;
    expires_at: number;
    used_at: number | null;
  }>(
    `SELECT token_hash, user_id, expires_at, used_at
     FROM password_reset_tokens WHERE token_hash = $1`,
    [tokenHash],
  );
  return r.rows[0];
}

/**
 * Atomically validates and consumes the reset token, updates the password,
 * deletes other reset tokens, and invalidates all sessions.
 * Raises 'RESET_TOKEN_INVALID' exception if the token is already used/expired.
 */
export async function resetUserPassword(
  tokenHash: string,
  newPasswordHash: string,
  nowMs: number,
): Promise<void> {
  await pool.query('CALL proc_reset_user_password($1, $2, $3)', [
    tokenHash,
    newPasswordHash,
    nowMs,
  ]);
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
