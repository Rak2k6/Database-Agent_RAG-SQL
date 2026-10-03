import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(__dirname, '../..');
const configuredDatabasePath = process.env.DB_PATH;
export const databasePath = configuredDatabasePath === ':memory:'
  ? configuredDatabasePath
  : resolve(projectRoot, configuredDatabasePath ?? 'server/data/northstar.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });

export const database = new Database(databasePath);
database.pragma('journal_mode = WAL');
database.pragma('foreign_keys = ON');

database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT,
    auth_provider TEXT NOT NULL CHECK (auth_provider IN ('local', 'google')),
    google_id TEXT UNIQUE,
    profile_image TEXT,
    role TEXT NOT NULL DEFAULT 'Member',
    department TEXT NOT NULL DEFAULT 'Engineering',
    status TEXT NOT NULL DEFAULT 'Active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED')),
    start_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_members (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'Member',
    PRIMARY KEY (project_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    priority TEXT NOT NULL CHECK (priority IN ('HIGH', 'MEDIUM', 'LOW')),
    status TEXT NOT NULL CHECK (status IN ('TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    due_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('MEETING', 'EVENT', 'DEADLINE', 'REMINDER')),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    folder TEXT NOT NULL DEFAULT 'General',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    subject TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'info',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme TEXT NOT NULL DEFAULT 'light',
    notify_task_assignments INTEGER NOT NULL DEFAULT 1,
    notify_project_updates INTEGER NOT NULL DEFAULT 1,
    notify_upcoming_meetings INTEGER NOT NULL DEFAULT 1,
    notify_deadline_reminders INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS password_reset_user_idx ON password_reset_tokens(user_id);
  CREATE INDEX IF NOT EXISTS session_user_idx ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id);
  CREATE INDEX IF NOT EXISTS tasks_assigned_idx ON tasks(assigned_to);
  CREATE INDEX IF NOT EXISTS project_members_user_idx ON project_members(user_id);
  CREATE INDEX IF NOT EXISTS activities_user_idx ON activities(user_id);
  CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id);
`);

// Add missing columns if database existed prior to schema upgrade
try { database.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'Member'"); } catch {}
try { database.exec("ALTER TABLE users ADD COLUMN department TEXT NOT NULL DEFAULT 'Engineering'"); } catch {}
try { database.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'Active'"); } catch {}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string | null;
  auth_provider: 'local' | 'google';
  google_id: string | null;
  profile_image: string | null;
  role: string;
  department: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  description: string;
  status: 'PLANNED' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';
  start_date: string;
  due_date: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string;
  project_id: string;
  assigned_to: string | null;
  created_by: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'TODO' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  due_date: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CalendarEventRow {
  id: string;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  event_type: 'MEETING' | 'EVENT' | 'DEADLINE' | 'REMINDER';
  created_by: string;
  project_id: string | null;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  name: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  uploaded_by: string;
  project_id: string | null;
  folder: string;
  created_at: string;
  updated_at: string;
}

export interface ActivityRow {
  id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  subject: string;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  is_read: number;
  created_at: string;
}

export function findUserById(id: string): UserRow | undefined {
  return database.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
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

export function logActivity(userId: string, action: string, entityType: string, entityId: string | null, subject: string) {
  const id = 'act_' + Math.random().toString(36).slice(2, 11);
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO activities (id, user_id, action, entity_type, entity_id, subject, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, userId, action, entityType, entityId, subject, now);
  return id;
}

export function createNotification(userId: string, title: string, message: string, type: string = 'info') {
  const id = 'notif_' + Math.random().toString(36).slice(2, 11);
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO notifications (id, user_id, title, message, type, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)`).run(id, userId, title, message, type, now);
  return id;
}