import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { OAuth2Client } from 'google-auth-library';
import helmet from 'helmet';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { database, findUserById, toPublicUser, UserRow, logActivity, createNotification } from './db.js';
import { z } from 'zod';

const sessionCookie = 'northstar_session';
const googleClientId = process.env.GOOGLE_CLIENT_ID ?? '';
const googleClient = new OAuth2Client(googleClientId || undefined);
const allowedOrigins = (process.env.WEB_ORIGIN ?? 'http://localhost:4200').split(',').map((origin) => origin.trim());
const isProduction = process.env.NODE_ENV === 'production';
const isLocalDevelopmentOrigin = (origin: string): boolean =>
  !isProduction && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
const resetEmailMode = process.env.RESET_EMAIL_MODE ?? 'mock';
const allowedEmailDomain = (process.env.ALLOWED_EMAIL_DOMAIN ?? 'northstarai.com').toLowerCase();

const emailSchema = z.string().trim().email().max(254).transform((email) => email.toLowerCase())
  .refine((email) => email.endsWith(`@${allowedEmailDomain}`), {
    message: `Only corporate emails ending with @${allowedEmailDomain} are allowed to register or sign in.`,
  });
const passwordSchema = z.string().min(8).max(128);
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128), rememberMe: z.boolean().optional() });
const signupSchema = z.object({ name: z.string().trim().min(1).max(100), email: emailSchema, password: passwordSchema });
const googleSchema = z.object({ credential: z.string().min(20).max(10000) });
const forgotSchema = z.object({ email: emailSchema });
const resetSchema = z.object({ token: z.string().min(20).max(256), password: passwordSchema });

function issueSession(res: Response, user: UserRow, rememberMe = false): void {
  const maxAgeSeconds = rememberMe ? 60 * 60 * 24 * 30 : 60 * 60 * 12;
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(hashResetToken(token), user.id, now + maxAgeSeconds * 1000, now);
  res.cookie(sessionCookie, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  });
}

function requireUser(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[sessionCookie] as string | undefined;
  if (!token) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' } });
    return;
  }

  const session = database.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .get(hashResetToken(token), Date.now()) as { user_id: string } | undefined;
  const user = session ? findUserById(session.user_id) : undefined;
  if (!user) {
    database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashResetToken(token));
    res.clearCookie(sessionCookie, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' });
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Your session has expired. Please sign in again.' } });
    return;
  }
  res.locals.user = user;
  next();
}

function parse<T>(schema: z.ZodType<T>, body: unknown, res: Response): T | undefined {
  const result = schema.safeParse(body);
  if (!result.success) {
    res.status(400).json({ error: { code: 'INVALID_INPUT', message: result.error.issues[0]?.message ?? 'Invalid information.' } });
    return undefined;
  }
  return result.data;
}

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin) || isLocalDevelopmentOrigin(origin)) callback(null, true);
      else callback(new Error('Origin is not allowed.'));
    },
    credentials: true,
  }));
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());

  app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/config', (_req, res) => res.json({ googleClientId }));

  app.post('/api/auth/signup', async (req, res, next) => {
    try {
      const input = parse(signupSchema, req.body, res);
      if (!input) return;
      const existing = database.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(input.email);
      if (existing) {
        res.status(409).json({ error: { code: 'EMAIL_REGISTERED', message: 'An account with this email already exists.' } });
        return;
      }

      const now = new Date().toISOString();
      const userId = randomUUID();
      const passwordHash = await bcrypt.hash(input.password, 12);
      database.prepare(`INSERT INTO users (id, name, email, password_hash, auth_provider, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'local', ?, ?)`).run(userId, input.name, input.email, passwordHash, now, now);
      const user = findUserById(userId)!;
      issueSession(res, user);
      res.status(201).json({ user: toPublicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/login', async (req, res, next) => {
    try {
      const input = parse(loginSchema, req.body, res);
      if (!input) return;
      const user = database.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(input.email) as UserRow | undefined;
      const passwordMatches = user?.password_hash ? await bcrypt.compare(input.password, user.password_hash) : false;
      if (!user || !passwordMatches) {
        res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'The email or password you entered is incorrect.' } });
        return;
      }
      issueSession(res, user, input.rememberMe);
      res.json({ user: toPublicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/google', async (req, res, next) => {
    try {
      const input = parse(googleSchema, req.body, res);
      if (!input) return;
      if (!googleClientId) {
        res.status(503).json({ error: { code: 'GOOGLE_NOT_CONFIGURED', message: 'Google sign-in is not configured yet.' } });
        return;
      }

      const ticket = await googleClient.verifyIdToken({ idToken: input.credential, audience: googleClientId });
      const profile = ticket.getPayload();
      if (!profile?.sub || !profile.email || profile.email_verified !== true) {
        res.status(401).json({ error: { code: 'GOOGLE_VERIFICATION_FAILED', message: 'Google could not verify this account.' } });
        return;
      }

      const email = profile.email.toLowerCase();
      if (!email.endsWith(`@${allowedEmailDomain}`)) {
        res.status(403).json({ error: { code: 'INVALID_EMAIL_DOMAIN', message: `Only accounts with @${allowedEmailDomain} email addresses can sign in.` } });
        return;
      }
      let user = database.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email) as UserRow | undefined;
      const now = new Date().toISOString();
      if (!user) {
        const id = randomUUID();
        database.prepare(`INSERT INTO users (id, name, email, auth_provider, google_id, profile_image, created_at, updated_at)
          VALUES (?, ?, ?, 'google', ?, ?, ?, ?)`).run(id, profile.name ?? email, email, profile.sub, profile.picture ?? null, now, now);
        user = findUserById(id)!;
      } else if (!user.google_id) {
        database.prepare('UPDATE users SET google_id = ?, updated_at = ? WHERE id = ?').run(profile.sub, now, user.id);
        user = findUserById(user.id)!;
      } else if (user.google_id !== profile.sub) {
        res.status(409).json({ error: { code: 'GOOGLE_ACCOUNT_CONFLICT', message: 'This email is linked to a different Google account.' } });
        return;
      }

      issueSession(res, user);
      res.json({ user: toPublicUser(user) });
    } catch (error) {
      if (error instanceof Error && error.name === 'Error') {
        res.status(401).json({ error: { code: 'GOOGLE_VERIFICATION_FAILED', message: 'Google sign-in could not be verified. Please try again.' } });
        return;
      }
      next(error);
    }
  });

  app.post('/api/auth/forgot-password', (req, res) => {
    const input = parse(forgotSchema, req.body, res);
    if (!input) return;
    const user = database.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(input.email) as { id: string } | undefined;

    if (resetEmailMode !== 'mock') {
      res.status(503).json({ error: { code: 'EMAIL_DELIVERY_NOT_CONFIGURED', message: 'Password reset email delivery is not available.' } });
      return;
    }

    if (user) {
      const token = randomBytes(32).toString('base64url');
      const tokenHash = hashResetToken(token);
      const expiresAt = Date.now() + 60 * 60 * 1000;
      database.prepare('INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, user.id, expiresAt);
      const resetUrl = `${process.env.WEB_ORIGIN?.split(',')[0] ?? 'http://localhost:4200'}/reset-password/${token}`;
      res.json({ message: 'Demo reset link created. No email was sent.', delivery: 'mock', resetUrl });
      return;
    }

    res.json({ message: 'If that address has an account, a reset link will be sent.' });
  });

  app.post('/api/auth/reset-password', async (req, res, next) => {
    try {
      const input = parse(resetSchema, req.body, res);
      if (!input) return;
      const tokenHash = hashResetToken(input.token);
      const tokenRow = database.prepare(`SELECT token_hash, user_id, expires_at, used_at
        FROM password_reset_tokens WHERE token_hash = ?`).get(tokenHash) as { token_hash: string; user_id: string; expires_at: number; used_at: number | null } | undefined;
      const digest = Buffer.from(tokenHash, 'hex');
      const storedDigest = Buffer.from(tokenRow?.token_hash ?? '0'.repeat(64), 'hex');
      const matches = digest.length === storedDigest.length && timingSafeEqual(digest, storedDigest);
      if (!tokenRow || !matches || tokenRow.used_at || tokenRow.expires_at < Date.now()) {
        res.status(400).json({ error: { code: 'RESET_TOKEN_INVALID', message: 'This reset link is invalid or has expired. Request a new one.' } });
        return;
      }

      const passwordHash = await bcrypt.hash(input.password, 12);
      const now = new Date().toISOString();
      const update = database.transaction(() => {
        const consumed = database.prepare(`UPDATE password_reset_tokens SET used_at = ?
          WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`).run(Date.now(), tokenHash, Date.now());
        if (consumed.changes !== 1) return false;
        database.prepare('UPDATE users SET password_hash = ?, auth_provider = ?, updated_at = ? WHERE id = ?').run(passwordHash, 'local', now, tokenRow.user_id);
        database.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? AND token_hash != ?').run(tokenRow.user_id, tokenHash);
        database.prepare('DELETE FROM sessions WHERE user_id = ?').run(tokenRow.user_id);
        return true;
      });
      if (!update()) {
        res.status(400).json({ error: { code: 'RESET_TOKEN_INVALID', message: 'This reset link is invalid or has expired. Request a new one.' } });
        return;
      }
      res.json({ message: 'Your password has been updated. Please sign in.' });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/auth/me', requireUser, (req, res) => {
    res.json({ user: toPublicUser(res.locals.user as UserRow) });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = req.cookies?.[sessionCookie] as string | undefined;
    if (token) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashResetToken(token));
    res.clearCookie(sessionCookie, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' });
    res.status(204).end();
  });

  // --- WORKPLACE REST API ---

  // Dashboard API
  app.get('/api/dashboard', requireUser, (_req, res, next) => {
    try {
      const currentUser = res.locals.user as UserRow;

      const activeProjectsCount = (database.prepare("SELECT COUNT(*) as count FROM projects WHERE status = 'ACTIVE'").get() as { count: number }).count;
      const pendingTasksCount = (database.prepare("SELECT COUNT(*) as count FROM tasks WHERE status IN ('TODO', 'IN_PROGRESS')").get() as { count: number }).count;
      const completedTasksCount = (database.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'COMPLETED'").get() as { count: number }).count;
      const teamMembersCount = (database.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
      const upcomingMeetingsCount = (database.prepare("SELECT COUNT(*) as count FROM calendar_events WHERE event_type = 'MEETING'").get() as { count: number }).count;

      const metrics = {
        activeProjects: activeProjectsCount,
        pendingTasks: pendingTasksCount,
        completedTasks: completedTasksCount,
        teamMembers: teamMembersCount,
        upcomingMeetings: upcomingMeetingsCount,
      };

      // Top tasks for user or team
      const tasks = database.prepare(`
        SELECT t.*, p.name as project, u.name as assigned_user_name
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        LEFT JOIN users u ON t.assigned_to = u.id
        ORDER BY CASE t.priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, t.due_date ASC
        LIMIT 6
      `).all().map((row: any) => ({
        id: row.id,
        title: row.title,
        project: row.project,
        priority: row.priority === 'HIGH' ? 'High' : row.priority === 'MEDIUM' ? 'Medium' : 'Low',
        dueDate: row.due_date,
        status: row.status === 'IN_PROGRESS' ? 'In Progress' : row.status === 'COMPLETED' ? 'Completed' : 'To Do',
        assignedTo: row.assigned_user_name ?? 'Unassigned',
      }));

      // Active projects with progress
      const projects = database.prepare(`
        SELECT p.*,
          (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) as total_tasks,
          (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status = 'COMPLETED') as completed_tasks
        FROM projects p
        WHERE p.status = 'ACTIVE'
        ORDER BY p.updated_at DESC
        LIMIT 4
      `).all().map((p: any, idx: number) => {
        const total = p.total_tasks || 1;
        const comp = p.completed_tasks || 0;
        const progress = Math.round((comp / total) * 100);
        const tones = ['green', 'teal', 'orange', 'blue'];
        const memberInitials = database.prepare(`
          SELECT u.name FROM project_members pm JOIN users u ON pm.user_id = u.id WHERE pm.project_id = ? LIMIT 4
        `).all(p.id).map((u: any) => u.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase());

        return {
          id: p.id,
          name: p.name,
          description: p.description,
          progress,
          deadline: p.due_date,
          status: p.status === 'ACTIVE' ? 'On track' : p.status,
          initials: memberInitials.length ? memberInitials : ['NS'],
          tone: tones[idx % tones.length],
        };
      });

      // Schedule
      const schedule = database.prepare(`
        SELECT e.*, p.name as project_name
        FROM calendar_events e
        LEFT JOIN projects p ON e.project_id = p.id
        ORDER BY e.start_time ASC
        LIMIT 5
      `).all().map((e: any) => ({
        id: e.id,
        time: new Date(e.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        title: e.title,
        detail: e.project_name ? `${e.project_name} · ${e.description}` : e.description,
        kind: e.event_type.toLowerCase(),
      }));

      // Activity
      const activity = database.prepare(`
        SELECT a.*, u.name as person_name, u.profile_image
        FROM activities a
        JOIN users u ON a.user_id = u.id
        ORDER BY a.created_at DESC
        LIMIT 6
      `).all().map((a: any, idx: number) => {
        const tones = ['orange', 'teal', 'blue', 'green'];
        const initials = a.person_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
        return {
          id: a.id,
          initials,
          person: a.person_name,
          action: a.action,
          subject: a.subject,
          time: new Date(a.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          tone: tones[idx % tones.length],
        };
      });

      // Notifications
      const notifications = database.prepare(`
        SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
      `).all(currentUser.id);

      res.json({
        user: toPublicUser(currentUser),
        metrics,
        tasks,
        projects,
        schedule,
        activity,
        notifications,
      });
    } catch (error) {
      next(error);
    }
  });

  // Projects API
  app.get('/api/projects', requireUser, (req, res, next) => {
    try {
      const search = (req.query.search as string ?? '').trim().toLowerCase();
      const statusFilter = (req.query.status as string ?? '').trim();

      let query = `
        SELECT p.*, u.name as creator_name,
          (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) as total_tasks,
          (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status = 'COMPLETED') as completed_tasks
        FROM projects p
        JOIN users u ON p.created_by = u.id
        WHERE 1=1
      `;
      const params: any[] = [];

      if (search) {
        query += ` AND (LOWER(p.name) LIKE ? OR LOWER(p.description) LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`);
      }
      if (statusFilter) {
        query += ` AND p.status = ?`;
        params.push(statusFilter.toUpperCase());
      }
      query += ` ORDER BY p.created_at DESC`;

      const projects = database.prepare(query).all(...params).map((p: any) => {
        const total = p.total_tasks || 0;
        const comp = p.completed_tasks || 0;
        const progress = total > 0 ? Math.round((comp / total) * 100) : 0;
        const members = database.prepare(`
          SELECT u.id, u.name, u.email, pm.role
          FROM project_members pm
          JOIN users u ON pm.user_id = u.id
          WHERE pm.project_id = ?
        `).all(p.id);

        return {
          id: p.id,
          name: p.name,
          description: p.description,
          status: p.status,
          startDate: p.start_date,
          dueDate: p.due_date,
          createdBy: p.creator_name,
          progress,
          totalTasks: total,
          completedTasks: comp,
          members,
        };
      });

      res.json({ projects });
    } catch (error) {
      next(error);
    }
  });

  const createProjectSchema = z.object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).optional().default(''),
    status: z.enum(['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED']).default('ACTIVE'),
    start_date: z.string().min(8),
    due_date: z.string().min(8),
  });

  app.post('/api/projects', requireUser, (req, res, next) => {
    try {
      const input = parse(createProjectSchema, req.body, res);
      if (!input) return;
      const currentUser = res.locals.user as UserRow;
      const id = 'proj_' + randomUUID().slice(0, 8);
      const now = new Date().toISOString();

      database.prepare(`
        INSERT INTO projects (id, name, description, status, start_date, due_date, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.name, input.description, input.status, input.start_date, input.due_date, currentUser.id, now, now);

      database.prepare(`INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'Owner')`).run(id, currentUser.id);

      logActivity(currentUser.id, 'created a new project', 'project', id, input.name);
      createNotification(currentUser.id, 'Project Created', `Project "${input.name}" has been created successfully.`, 'project');

      res.status(201).json({ id, message: 'Project created successfully.' });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/projects/:id', requireUser, (req, res, next) => {
    try {
      const p: any = database.prepare(`
        SELECT p.*, u.name as creator_name
        FROM projects p
        JOIN users u ON p.created_by = u.id
        WHERE p.id = ?
      `).get(req.params.id);

      if (!p) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found.' } });
        return;
      }

      const tasks = database.prepare(`
        SELECT t.*, u.name as assigned_user_name FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id WHERE t.project_id = ?
      `).all(p.id);
      const members = database.prepare(`
        SELECT u.id, u.name, u.email, u.profile_image, pm.role FROM project_members pm JOIN users u ON pm.user_id = u.id WHERE pm.project_id = ?
      `).all(p.id);

      const totalTasks = tasks.length;
      const completedTasks = tasks.filter((t: any) => t.status === 'COMPLETED').length;
      const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      res.json({
        project: {
          ...p,
          progress,
          totalTasks,
          completedTasks,
          members,
          tasks,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/projects/:id', requireUser, (req, res, next) => {
    try {
      const input = parse(createProjectSchema.partial(), req.body, res);
      if (!input) return;
      const currentUser = res.locals.user as UserRow;
      const now = new Date().toISOString();

      const existing = database.prepare('SELECT id, name FROM projects WHERE id = ?').get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found.' } });
        return;
      }

      database.prepare(`
        UPDATE projects SET
          name = COALESCE(?, name),
          description = COALESCE(?, description),
          status = COALESCE(?, status),
          start_date = COALESCE(?, start_date),
          due_date = COALESCE(?, due_date),
          updated_at = ?
        WHERE id = ?
      `).run(input.name ?? null, input.description ?? null, input.status ?? null, input.start_date ?? null, input.due_date ?? null, now, req.params.id);

      logActivity(currentUser.id, 'updated project', 'project', req.params.id as string, input.name ?? existing.name);
      res.json({ message: 'Project updated.' });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/projects/:id', requireUser, (req, res, next) => {
    try {
      const existing = database.prepare('SELECT id, name FROM projects WHERE id = ?').get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found.' } });
        return;
      }
      database.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
      res.json({ message: 'Project deleted.' });
    } catch (error) {
      next(error);
    }
  });

  // Tasks API
  app.get('/api/tasks', requireUser, (req, res, next) => {
    try {
      const currentUser = res.locals.user as UserRow;
      const assignedToFilter = req.query.assigned_to as string | undefined;
      const projectIdFilter = req.query.project_id as string | undefined;
      const statusFilter = req.query.status as string | undefined;
      const priorityFilter = req.query.priority as string | undefined;
      const search = (req.query.search as string ?? '').trim().toLowerCase();

      let query = `
        SELECT t.*, p.name as project_name, u.name as assigned_user_name, creator.name as creator_name
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        LEFT JOIN users u ON t.assigned_to = u.id
        JOIN users creator ON t.created_by = creator.id
        WHERE 1=1
      `;
      const params: any[] = [];

      if (assignedToFilter === 'me') {
        query += ` AND t.assigned_to = ?`;
        params.push(currentUser.id);
      } else if (assignedToFilter) {
        query += ` AND t.assigned_to = ?`;
        params.push(assignedToFilter);
      }

      if (projectIdFilter) {
        query += ` AND t.project_id = ?`;
        params.push(projectIdFilter);
      }

      if (statusFilter) {
        query += ` AND t.status = ?`;
        params.push(statusFilter.toUpperCase());
      }

      if (priorityFilter) {
        query += ` AND t.priority = ?`;
        params.push(priorityFilter.toUpperCase());
      }

      if (search) {
        query += ` AND (LOWER(t.title) LIKE ? OR LOWER(t.description) LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`);
      }

      query += ` ORDER BY t.due_date ASC`;

      const tasks = database.prepare(query).all(...params).map((t: any) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        projectId: t.project_id,
        project: t.project_name,
        assignedToId: t.assigned_to,
        assignedTo: t.assigned_user_name ?? 'Unassigned',
        createdBy: t.creator_name,
        priority: t.priority,
        status: t.status,
        dueDate: t.due_date,
        completedAt: t.completed_at,
        isOverdue: t.status !== 'COMPLETED' && new Date(t.due_date).getTime() < Date.now(),
      }));

      res.json({ tasks });
    } catch (error) {
      next(error);
    }
  });

  const createTaskSchema = z.object({
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(1000).optional().default(''),
    project_id: z.string().min(1),
    assigned_to: z.string().optional().nullable(),
    priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
    status: z.enum(['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).default('TODO'),
    due_date: z.string().min(8),
  });

  app.post('/api/tasks', requireUser, (req, res, next) => {
    try {
      const input = parse(createTaskSchema, req.body, res);
      if (!input) return;
      const currentUser = res.locals.user as UserRow;
      const id = 'task_' + randomUUID().slice(0, 8);
      const now = new Date().toISOString();
      const completedAt = input.status === 'COMPLETED' ? now : null;

      const project = database.prepare('SELECT name FROM projects WHERE id = ?').get(input.project_id) as any;

      database.prepare(`
        INSERT INTO tasks (id, title, description, project_id, assigned_to, created_by, priority, status, due_date, created_at, updated_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.title, input.description, input.project_id, input.assigned_to ?? null, currentUser.id, input.priority, input.status, input.due_date, now, now, completedAt);

      logActivity(currentUser.id, 'created task', 'task', id, `${input.title} (${project?.name ?? 'Project'})`);

      if (input.assigned_to && input.assigned_to !== currentUser.id) {
        createNotification(input.assigned_to, 'New Task Assigned', `${currentUser.name} assigned you "${input.title}"`, 'task');
      }

      res.status(201).json({ id, message: 'Task created successfully.' });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/tasks/:id', requireUser, (req, res, next) => {
    try {
      const input = parse(createTaskSchema.partial(), req.body, res);
      if (!input) return;
      const currentUser = res.locals.user as UserRow;
      const now = new Date().toISOString();

      const existing: any = database.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
      if (!existing) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found.' } });
        return;
      }

      const nextStatus = input.status ?? existing.status;
      const completedAt = nextStatus === 'COMPLETED' ? (existing.completed_at ?? now) : null;

      database.prepare(`
        UPDATE tasks SET
          title = COALESCE(?, title),
          description = COALESCE(?, description),
          project_id = COALESCE(?, project_id),
          assigned_to = COALESCE(?, assigned_to),
          priority = COALESCE(?, priority),
          status = COALESCE(?, status),
          due_date = COALESCE(?, due_date),
          updated_at = ?,
          completed_at = ?
        WHERE id = ?
      `).run(input.title ?? null, input.description ?? null, input.project_id ?? null, input.assigned_to ?? null, input.priority ?? null, input.status ?? null, input.due_date ?? null, now, completedAt, req.params.id);

      if (input.status === 'COMPLETED' && existing.status !== 'COMPLETED') {
        logActivity(currentUser.id, 'completed a task in', 'task', req.params.id as string, input.title ?? existing.title);
      } else {
        logActivity(currentUser.id, 'updated task', 'task', req.params.id as string, input.title ?? existing.title);
      }

      res.json({ message: 'Task updated.' });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/tasks/:id', requireUser, (req, res, next) => {
    try {
      const existing = database.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.id);
      if (!existing) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found.' } });
        return;
      }
      database.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
      res.json({ message: 'Task deleted.' });
    } catch (error) {
      next(error);
    }
  });

  // Team API
  app.get('/api/team', requireUser, (req, res, next) => {
    try {
      const search = (req.query.search as string ?? '').trim().toLowerCase();
      const departmentFilter = (req.query.department as string ?? '').trim();

      let query = `SELECT * FROM users WHERE 1=1`;
      const params: any[] = [];

      if (search) {
        query += ` AND (LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(role) LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      if (departmentFilter) {
        query += ` AND LOWER(department) = ?`;
        params.push(departmentFilter.toLowerCase());
      }
      query += ` ORDER BY name ASC`;

      const users = database.prepare(query).all(...params).map((u: any) => {
        const assignedTasksCount = (database.prepare('SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ?').get(u.id) as any).count;
        const completedTasksCount = (database.prepare("SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ? AND status = 'COMPLETED'").get(u.id) as any).count;

        return {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role ?? 'Member',
          department: u.department ?? 'Engineering',
          status: u.status ?? 'Active',
          profileImage: u.profile_image,
          assignedTasksCount,
          completedTasksCount,
        };
      });

      res.json({ users });
    } catch (error) {
      next(error);
    }
  });

  const createTeamSchema = z.object({
    name: z.string().trim().min(2).max(100),
    email: emailSchema,
    role: z.string().trim().min(2).max(100),
    department: z.string().trim().min(2).max(100),
  });

  app.post('/api/team', requireUser, async (req, res, next) => {
    try {
      const input = parse(createTeamSchema, req.body, res);
      if (!input) return;
      const existing = database.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(input.email);
      if (existing) {
        res.status(409).json({ error: { code: 'EMAIL_REGISTERED', message: 'Team member email already exists.' } });
        return;
      }

      const id = 'usr_' + randomUUID().slice(0, 8);
      const now = new Date().toISOString();
      const defaultPasswordHash = await bcrypt.hash('Northstar123!', 10);

      database.prepare(`
        INSERT INTO users (id, name, email, password_hash, auth_provider, role, department, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'local', ?, ?, 'Active', ?, ?)
      `).run(id, input.name, input.email, defaultPasswordHash, input.role, input.department, now, now);

      res.status(201).json({ id, message: 'Team member added.' });
    } catch (error) {
      next(error);
    }
  });

  // Calendar API
  app.get('/api/calendar', requireUser, (_req, res, next) => {
    try {
      const events = database.prepare(`
        SELECT e.*, p.name as project_name, u.name as creator_name
        FROM calendar_events e
        LEFT JOIN projects p ON e.project_id = p.id
        JOIN users u ON e.created_by = u.id
        ORDER BY e.start_time ASC
      `).all().map((e: any) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        startTime: e.start_time,
        endTime: e.end_time,
        eventType: e.event_type,
        projectId: e.project_id,
        project: e.project_name ?? 'General',
        createdBy: e.creator_name,
      }));

      res.json({ events });
    } catch (error) {
      next(error);
    }
  });

  const createEventSchema = z.object({
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(1000).optional().default(''),
    start_time: z.string().min(8),
    end_time: z.string().min(8),
    event_type: z.enum(['MEETING', 'EVENT', 'DEADLINE', 'REMINDER']).default('MEETING'),
    project_id: z.string().optional().nullable(),
  });

  app.post('/api/calendar', requireUser, (req, res, next) => {
    try {
      const input = parse(createEventSchema, req.body, res);
      if (!input) return;
      const currentUser = res.locals.user as UserRow;
      const id = 'evt_' + randomUUID().slice(0, 8);
      const now = new Date().toISOString();

      database.prepare(`
        INSERT INTO calendar_events (id, title, description, start_time, end_time, event_type, created_by, project_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.title, input.description, input.start_time, input.end_time, input.event_type, currentUser.id, input.project_id ?? null, now);

      logActivity(currentUser.id, 'scheduled a meeting for', 'event', id, input.title);
      res.status(201).json({ id, message: 'Event created.' });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/calendar/:id', requireUser, (req, res, next) => {
    try {
      database.prepare('DELETE FROM calendar_events WHERE id = ?').run(req.params.id);
      res.json({ message: 'Event deleted.' });
    } catch (error) {
      next(error);
    }
  });

  // Documents API
  app.get('/api/documents', requireUser, (req, res, next) => {
    try {
      const search = (req.query.search as string ?? '').trim().toLowerCase();

      let query = `
        SELECT d.*, p.name as project_name, u.name as uploader_name
        FROM documents d
        LEFT JOIN projects p ON d.project_id = p.id
        JOIN users u ON d.uploaded_by = u.id
        WHERE 1=1
      `;
      const params: any[] = [];
      if (search) {
        query += ` AND (LOWER(d.name) LIKE ? OR LOWER(d.file_name) LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`);
      }
      query += ` ORDER BY d.created_at DESC`;

      const documents = database.prepare(query).all(...params).map((d: any) => ({
        id: d.id,
        name: d.name,
        fileName: d.file_name,
        fileType: d.file_type,
        fileSize: d.file_size,
        folder: d.folder,
        project: d.project_name ?? 'General',
        uploadedBy: d.uploader_name,
        createdAt: d.created_at,
      }));

      res.json({ documents });
    } catch (error) {
      next(error);
    }
  });

  const createDocumentSchema = z.object({
    name: z.string().trim().min(2).max(200),
    file_name: z.string().trim().min(1).max(255),
    file_type: z.string().trim().default('application/pdf'),
    file_size: z.number().int().positive().default(1024),
    folder: z.string().trim().default('General'),
    project_id: z.string().optional().nullable(),
  });

  app.post('/api/documents', requireUser, (req, res, next) => {
    try {
      const input = parse(createDocumentSchema, req.body, res);
      if (!input) return;
      const currentUser = res.locals.user as UserRow;
      const id = 'doc_' + randomUUID().slice(0, 8);
      const now = new Date().toISOString();

      database.prepare(`
        INSERT INTO documents (id, name, file_name, file_path, file_type, file_size, uploaded_by, project_id, folder, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.name, input.file_name, `/uploads/${input.file_name}`, input.file_type, input.file_size, currentUser.id, input.project_id ?? null, input.folder, now, now);

      logActivity(currentUser.id, 'uploaded a document to', 'document', id, input.name);
      res.status(201).json({ id, message: 'Document added.' });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/documents/:id', requireUser, (req, res, next) => {
    try {
      database.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);
      res.json({ message: 'Document deleted.' });
    } catch (error) {
      next(error);
    }
  });

  // Reports API
  app.get('/api/reports', requireUser, (_req, res, next) => {
    try {
      const taskStats = {
        total: (database.prepare('SELECT COUNT(*) as c FROM tasks').get() as any).c,
        completed: (database.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'COMPLETED'").get() as any).c,
        inProgress: (database.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'IN_PROGRESS'").get() as any).c,
        todo: (database.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'TODO'").get() as any).c,
        highPriority: (database.prepare("SELECT COUNT(*) as c FROM tasks WHERE priority = 'HIGH'").get() as any).c,
      };

      const projectStats = {
        total: (database.prepare('SELECT COUNT(*) as c FROM projects').get() as any).c,
        active: (database.prepare("SELECT COUNT(*) as c FROM projects WHERE status = 'ACTIVE'").get() as any).c,
        completed: (database.prepare("SELECT COUNT(*) as c FROM projects WHERE status = 'COMPLETED'").get() as any).c,
        planned: (database.prepare("SELECT COUNT(*) as c FROM projects WHERE status = 'PLANNED'").get() as any).c,
      };

      const teamWorkload = database.prepare(`
        SELECT u.id, u.name, u.role, u.department,
          (SELECT COUNT(*) FROM tasks WHERE assigned_to = u.id) as assigned_tasks,
          (SELECT COUNT(*) FROM tasks WHERE assigned_to = u.id AND status = 'COMPLETED') as completed_tasks
        FROM users u
        ORDER BY assigned_tasks DESC
      `).all();

      res.json({
        taskStats,
        projectStats,
        teamWorkload,
      });
    } catch (error) {
      next(error);
    }
  });

  // Notifications API
  app.get('/api/notifications', requireUser, (_req, res, next) => {
    try {
      const currentUser = res.locals.user as UserRow;
      const notifications = database.prepare(`
        SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
      `).all(currentUser.id);
      const unreadCount = (database.prepare(`
        SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0
      `).get(currentUser.id) as any).c;

      res.json({ notifications, unreadCount });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/notifications/read-all', requireUser, (_req, res, next) => {
    try {
      const currentUser = res.locals.user as UserRow;
      database.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(currentUser.id);
      res.json({ message: 'All notifications marked as read.' });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/notifications/:id/read', requireUser, (req, res, next) => {
    try {
      database.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(req.params.id);
      res.json({ message: 'Notification marked as read.' });
    } catch (error) {
      next(error);
    }
  });

  // Settings API
  app.get('/api/settings', requireUser, (_req, res, next) => {
    try {
      const currentUser = res.locals.user as UserRow;
      let settings = database.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(currentUser.id) as any;
      if (!settings) {
        const now = new Date().toISOString();
        database.prepare(`
          INSERT INTO user_settings (user_id, theme, notify_task_assignments, notify_project_updates, notify_upcoming_meetings, notify_deadline_reminders, updated_at)
          VALUES (?, 'light', 1, 1, 1, 1, ?)
        `).run(currentUser.id, now);
        settings = database.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(currentUser.id);
      }

      res.json({
        profile: toPublicUser(currentUser),
        settings,
      });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/settings', requireUser, (req, res, next) => {
    try {
      const currentUser = res.locals.user as UserRow;
      const { name, department, role, profile_image, theme, notify_task_assignments, notify_project_updates, notify_upcoming_meetings, notify_deadline_reminders } = req.body;
      const now = new Date().toISOString();

      database.prepare(`
        UPDATE users SET
          name = COALESCE(?, name),
          department = COALESCE(?, department),
          role = COALESCE(?, role),
          profile_image = COALESCE(?, profile_image),
          updated_at = ?
        WHERE id = ?
      `).run(name ?? null, department ?? null, role ?? null, profile_image ?? null, now, currentUser.id);

      database.prepare(`
        INSERT INTO user_settings (user_id, theme, notify_task_assignments, notify_project_updates, notify_upcoming_meetings, notify_deadline_reminders, updated_at)
        VALUES (?, COALESCE(?, 'light'), COALESCE(?, 1), COALESCE(?, 1), COALESCE(?, 1), COALESCE(?, 1), ?)
        ON CONFLICT(user_id) DO UPDATE SET
          theme = COALESCE(excluded.theme, theme),
          notify_task_assignments = COALESCE(excluded.notify_task_assignments, notify_task_assignments),
          notify_project_updates = COALESCE(excluded.notify_project_updates, notify_project_updates),
          notify_upcoming_meetings = COALESCE(excluded.notify_upcoming_meetings, notify_upcoming_meetings),
          notify_deadline_reminders = COALESCE(excluded.notify_deadline_reminders, notify_deadline_reminders),
          updated_at = excluded.updated_at
      `).run(currentUser.id, theme ?? 'light', notify_task_assignments ?? 1, notify_project_updates ?? 1, notify_upcoming_meetings ?? 1, notify_deadline_reminders ?? 1, now);

      res.json({ message: 'Settings updated.' });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {

    console.error(error);
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: isProduction ? 'Something went wrong. Please try again.' : message } });
  });

  return app;
}