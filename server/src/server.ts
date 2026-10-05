import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { OAuth2Client } from 'google-auth-library';
import helmet from 'helmet';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { answerDatabaseQuestion, isDatabaseQuestion } from './ai/databaseQuery.js';

// ── Domain DB modules ─────────────────────────────────────────────────────────
import * as Auth from './db/auth.js';
import * as Projects from './db/projects.js';
import * as Tasks from './db/tasks.js';
import * as Calendar from './db/calendar.js';
import * as Documents from './db/documents.js';
import * as Team from './db/team.js';
import * as Notifications from './db/notifications.js';
import * as Dashboard from './db/dashboard.js';
import * as Settings from './db/settings.js';

// ─────────────────────────────────────────────────────────────────────────────

const sessionCookie = 'northstar_session';
const googleClientId = process.env.GOOGLE_CLIENT_ID ?? '';
const googleClient = new OAuth2Client(googleClientId || undefined);
const allowedOrigins = (process.env.WEB_ORIGIN ?? 'http://localhost:4200').split(',').map((o) => o.trim());
const isProduction = process.env.NODE_ENV === 'production';
const isLocalDevelopmentOrigin = (origin: string): boolean =>
  !isProduction && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
const resetEmailMode = process.env.RESET_EMAIL_MODE ?? 'mock';
const allowedEmailDomain = (process.env.ALLOWED_EMAIL_DOMAIN ?? 'northstarai.com').toLowerCase();

// ── Zod schemas ───────────────────────────────────────────────────────────────

const emailSchema = z
  .string().trim().email().max(254)
  .transform((e) => e.toLowerCase())
  .refine((e) => e.endsWith(`@${allowedEmailDomain}`), {
    message: `Only corporate emails ending with @${allowedEmailDomain} are allowed to register or sign in.`,
  });
const passwordSchema = z.string().min(8).max(128);
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128), rememberMe: z.boolean().optional() });
const signupSchema = z.object({ name: z.string().trim().min(1).max(100), email: emailSchema, password: passwordSchema });
const googleSchema = z.object({ credential: z.string().min(20).max(10000) });
const forgotSchema = z.object({ email: emailSchema });
const resetSchema = z.object({ token: z.string().min(20).max(256), password: passwordSchema });

// ── Utilities ─────────────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function parse<T>(schema: z.ZodType<T>, body: unknown, res: Response): T | undefined {
  const result = schema.safeParse(body);
  if (!result.success) {
    res.status(400).json({ error: { code: 'INVALID_INPUT', message: result.error.issues[0]?.message ?? 'Invalid information.' } });
    return undefined;
  }
  return result.data;
}

/** Safely extract a single string from an Express route/query param. */
function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0]! : (value ?? '');
}

async function issueSession(res: Response, userId: string, rememberMe = false): Promise<void> {
  const maxAgeSeconds = rememberMe ? 60 * 60 * 24 * 30 : 60 * 60 * 12;
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  await Auth.createSession(hashToken(token), userId, now + maxAgeSeconds * 1000);
  res.cookie(sessionCookie, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  });
}

// ── Auth middleware ───────────────────────────────────────────────────────────

async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[sessionCookie] as string | undefined;
    if (!token) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' } });
      return;
    }

    const session = await Auth.validateSession(hashToken(token), Date.now());
    const user = session ? await Auth.findUserById(session.user_id) : undefined;
    if (!user) {
      await Auth.deleteSession(hashToken(token));
      res.clearCookie(sessionCookie, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' });
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Your session has expired. Please sign in again.' } });
      return;
    }
    res.locals.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

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

  // ── Health / config ──────────────────────────────────────────────────────

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/config', (_req, res) => res.json({ googleClientId }));

  // ── AI API ───────────────────────────────────────────────────────────────

  app.post('/api/ai/chat', requireUser, async (req, res, next) => {
    try {
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      if (!message || message.length > 4000) {
        res.status(400).json({ error: { code: 'INVALID_MESSAGE', message: 'Message must be between 1 and 4000 characters.' } });
        return;
      }
      if (isDatabaseQuestion(message)) {
        const result = await answerDatabaseQuestion(message);
        res.json({ answer: result.answer, source: 'database' });
        return;
      }
      const { chatWithOllama } = await import('./ai/ollama.js');
      const answer = await chatWithOllama(message);
      res.json({ answer });
    } catch (error) {
      console.error('AI chat request failed:', error);
      res.status(500).json({ error: { code: 'AI_CHAT_FAILED', message: 'I could not complete that request. Please try again.' } });
    }
  });

  // ── Auth routes ──────────────────────────────────────────────────────────

  app.post('/api/auth/signup', async (req, res, next) => {
    try {
      const input = parse(signupSchema, req.body, res);
      if (!input) return;

      if (await Auth.checkEmailExists(input.email)) {
        res.status(409).json({ error: { code: 'EMAIL_REGISTERED', message: 'An account with this email already exists.' } });
        return;
      }

      const userId = randomUUID();
      const passwordHash = await bcrypt.hash(input.password, 12);
      await Auth.createLocalUser(userId, input.name, input.email, passwordHash);
      const user = await Auth.findUserById(userId);
      await issueSession(res, userId);
      res.status(201).json({ user: Auth.toPublicUser(user!) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/login', async (req, res, next) => {
    try {
      const input = parse(loginSchema, req.body, res);
      if (!input) return;

      const user = await Auth.findUserByEmail(input.email);
      const passwordMatches = user?.password_hash ? await bcrypt.compare(input.password, user.password_hash) : false;
      if (!user || !passwordMatches) {
        res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'The email or password you entered is incorrect.' } });
        return;
      }
      await issueSession(res, user.id, input.rememberMe);
      res.json({ user: Auth.toPublicUser(user) });
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

      let user = await Auth.findUserByEmail(email);
      if (!user) {
        const id = randomUUID();
        await Auth.createGoogleUser(id, profile.name ?? email, email, profile.sub, profile.picture ?? null);
        user = await Auth.findUserById(id);
      } else if (!user.google_id) {
        await Auth.linkGoogleId(user.id, profile.sub);
        user = await Auth.findUserById(user.id);
      } else if (user.google_id !== profile.sub) {
        res.status(409).json({ error: { code: 'GOOGLE_ACCOUNT_CONFLICT', message: 'This email is linked to a different Google account.' } });
        return;
      }

      await issueSession(res, user!.id);
      res.json({ user: Auth.toPublicUser(user!) });
    } catch (error) {
      if (error instanceof Error && error.name === 'Error') {
        res.status(401).json({ error: { code: 'GOOGLE_VERIFICATION_FAILED', message: 'Google sign-in could not be verified. Please try again.' } });
        return;
      }
      next(error);
    }
  });

  app.post('/api/auth/forgot-password', async (req, res, next) => {
    try {
      const input = parse(forgotSchema, req.body, res);
      if (!input) return;

      if (resetEmailMode !== 'mock') {
        res.status(503).json({ error: { code: 'EMAIL_DELIVERY_NOT_CONFIGURED', message: 'Password reset email delivery is not available.' } });
        return;
      }

      const user = await Auth.findUserByEmail(input.email);
      if (user) {
        const token = randomBytes(32).toString('base64url');
        const tokenHash = hashToken(token);
        const expiresAt = Date.now() + 60 * 60 * 1000;
        await Auth.insertResetToken(tokenHash, user.id, expiresAt);
        const resetUrl = `${process.env.WEB_ORIGIN?.split(',')[0] ?? 'http://localhost:4200'}/reset-password/${token}`;
        res.json({ message: 'Demo reset link created. No email was sent.', delivery: 'mock', resetUrl });
        return;
      }

      res.json({ message: 'If that address has an account, a reset link will be sent.' });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/reset-password', async (req, res, next) => {
    try {
      const input = parse(resetSchema, req.body, res);
      if (!input) return;

      const tokenHash = hashToken(input.token);
      const tokenRow = await Auth.lookupResetToken(tokenHash);

      // Timing-safe comparison (Node.js side, before calling the procedure)
      const digest = Buffer.from(tokenHash, 'hex');
      const storedDigest = Buffer.from(tokenRow?.token_hash ?? '0'.repeat(64), 'hex');
      const matches = digest.length === storedDigest.length && timingSafeEqual(digest, storedDigest);

      if (!tokenRow || !matches || tokenRow.used_at || tokenRow.expires_at < Date.now()) {
        res.status(400).json({ error: { code: 'RESET_TOKEN_INVALID', message: 'This reset link is invalid or has expired. Request a new one.' } });
        return;
      }

      const passwordHash = await bcrypt.hash(input.password, 12);
      try {
        // Atomically: consume token, update password, delete other tokens, invalidate sessions
        await Auth.resetUserPassword(tokenHash, passwordHash, Date.now());
      } catch (procErr) {
        const msg = procErr instanceof Error ? procErr.message : '';
        if (msg.includes('RESET_TOKEN_INVALID')) {
          res.status(400).json({ error: { code: 'RESET_TOKEN_INVALID', message: 'This reset link is invalid or has expired. Request a new one.' } });
          return;
        }
        throw procErr;
      }

      res.json({ message: 'Your password has been updated. Please sign in.' });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/auth/me', requireUser, (req, res) => {
    res.json({ user: Auth.toPublicUser(res.locals.user) });
  });

  app.post('/api/auth/logout', async (req, res, next) => {
    try {
      const token = req.cookies?.[sessionCookie] as string | undefined;
      if (token) await Auth.deleteSession(hashToken(token));
      res.clearCookie(sessionCookie, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  // ── Dashboard ────────────────────────────────────────────────────────────

  app.get('/api/dashboard', requireUser, async (_req, res, next) => {
    try {
      const currentUser = res.locals.user as import('./db/types.js').UserRow;
      const data = await Dashboard.getDashboardData(currentUser.id);

      // Shape the response to match the existing Angular contract
      const metrics = data.metrics as Record<string, number>;

      res.json({
        user: Auth.toPublicUser(currentUser),
        metrics: {
          activeProjects:   metrics['activeProjects']   ?? metrics['active_projects']   ?? 0,
          pendingTasks:     (metrics['inProgressTasks'] ?? 0) + (metrics['todo'] ?? 0) + (metrics['totalTasks'] ? 0 : 0),
          completedTasks:   metrics['completedTasks']   ?? metrics['completed_tasks']   ?? 0,
          teamMembers:      metrics['teamMembers']       ?? metrics['team_members']       ?? 0,
          upcomingMeetings: metrics['upcomingEvents']    ?? metrics['upcoming_events']    ?? 0,
        },
        tasks: data.topTasks,
        projects: data.activeProjects,
        schedule: data.schedule,
        activity: data.activity,
        notifications: data.notifications,
      });
    } catch (error) {
      next(error);
    }
  });

  // ── Projects ─────────────────────────────────────────────────────────────

  app.get('/api/projects', requireUser, async (req, res, next) => {
    try {
      const search = (req.query.search as string ?? '').trim() || undefined;
      const statusFilter = (req.query.status as string ?? '').trim().toUpperCase() || undefined;

      const rows = await Projects.listProjects(search, statusFilter);

      const projects = await Promise.all(rows.map(async (p) => {
        const members = await Projects.getProjectMembers(p.id);
        const total = parseInt(p.total_tasks as unknown as string, 10) || 0;
        const comp  = parseInt(p.completed_tasks as unknown as string, 10) || 0;
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          status: p.status,
          startDate: p.start_date,
          dueDate: p.due_date,
          createdBy: p.creator_name,
          progress: p.progress,
          totalTasks: total,
          completedTasks: comp,
          members: members.map((m) => ({
            id: m.user_id,
            name: m.user_name,
            email: null,
            profile_image: m.profile_image,
            role: m.member_role,
          })),
        };
      }));

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

  app.post('/api/projects', requireUser, async (req, res, next) => {
    try {
      const input = parse(createProjectSchema, req.body, res);
      if (!input) return;
      const currentUser = res.locals.user as import('./db/types.js').UserRow;
      const id = 'proj_' + randomUUID().slice(0, 8);

      // Atomically creates project + member + activity + notification
      await Projects.createProject(id, input.name, currentUser.id, input.status, input.start_date, input.due_date, input.description);

      res.status(201).json({ id, message: 'Project created successfully.' });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/projects/:id', requireUser, async (req, res, next) => {
    try {
      const projectId = param(req.params['id']);
      const detail = await Projects.getProjectDetail(projectId);
      if (!detail) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found.' } });
        return;
      }
      const members = await Projects.getProjectMembers(projectId);
      const tasks = await Tasks.listTasks({ projectId });

      res.json({
        project: {
          ...detail,
          members: members.map((m) => ({
            id: m.user_id,
            name: m.user_name,
            email: null,
            profile_image: m.profile_image,
            role: m.member_role,
          })),
          tasks: tasks.map((t) => ({
            id: t.id,
            title: t.title,
            description: t.description,
            status: t.status,
            priority: t.priority,
            dueDate: t.due_date,
            assignedTo: t.assigned_to_name ?? 'Unassigned',
            assignedToId: t.assigned_to_id,
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/projects/:id', requireUser, async (req, res, next) => {
    try {
      const input = parse(createProjectSchema.partial(), req.body, res);
      if (!input) return;
      const currentUser = res.locals.user as import('./db/types.js').UserRow;

      try {
        await Projects.updateProject(param(req.params['id']), currentUser.id, input);
      } catch (procErr) {
        const msg = procErr instanceof Error ? procErr.message : '';
        if (msg.includes('NOT_FOUND')) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found.' } });
          return;
        }
        throw procErr;
      }

      res.json({ message: 'Project updated.' });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/projects/:id', requireUser, async (req, res, next) => {
    try {
      const deleted = await Projects.deleteProject(param(req.params['id']));
      if (!deleted) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found.' } });
        return;
      }
      res.json({ message: 'Project deleted.' });
    } catch (error) {
      next(error);
    }
  });

  // ── Tasks ────────────────────────────────────────────────────────────────

  app.get('/api/tasks', requireUser, async (req, res, next) => {
    try {
      const currentUser = res.locals.user as import('./db/types.js').UserRow;
      const assignedToRaw = req.query.assigned_to as string | undefined;
      const assignedTo = assignedToRaw === 'me' ? currentUser.id : assignedToRaw;

      const rows = await Tasks.listTasks({
        assignedTo,
        projectId: req.query.project_id as string | undefined,
        status:    (req.query.status    as string | undefined)?.toUpperCase(),
        priority:  (req.query.priority  as string | undefined)?.toUpperCase(),
        search:    (req.query.search    as string | undefined)?.trim(),
      });

      const tasks = rows.map((t) => ({
        id:          t.id,
        title:       t.title,
        description: t.description,
        projectId:   t.project_id,
        project:     t.project_name,
        assignedToId: t.assigned_to_id,
        assignedTo:  t.assigned_to_name ?? 'Unassigned',
        createdBy:   t.creator_name,
        priority:    t.priority,
        status:      t.status,
        dueDate:     t.due_date,
        completedAt: t.completed_at,
        isOverdue:   t.is_overdue,
      }));

      res.json({ tasks });
    } catch (error) {
      next(error);
    }
  });

  const createTaskSchema = z.object({
    title:       z.string().trim().min(2).max(200),
    description: z.string().trim().max(1000).optional().default(''),
    project_id:  z.string().min(1),
    assigned_to: z.string().optional().nullable(),
    priority:    z.enum(['HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
    status:      z.enum(['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).default('TODO'),
    due_date:    z.string().min(8),
  });

  app.post('/api/tasks', requireUser, async (req, res, next) => {
    try {
      const input = parse(createTaskSchema, req.body, res);
      if (!input) return;
      const currentUser = res.locals.user as import('./db/types.js').UserRow;
      const id = 'task_' + randomUUID().slice(0, 8);

      // Atomically creates task + activity + conditional notification
      await Tasks.createTask(
        id, input.title, input.project_id, currentUser.id,
        input.priority, input.status, input.due_date,
        input.description, input.assigned_to ?? null,
      );

      res.status(201).json({ id, message: 'Task created successfully.' });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/tasks/:id', requireUser, async (req, res, next) => {
    try {
      const input = parse(createTaskSchema.partial(), req.body, res);
      if (!input) return;
      const currentUser = res.locals.user as import('./db/types.js').UserRow;

      try {
        await Tasks.updateTask(param(req.params['id']), currentUser.id, input);
      } catch (procErr) {
        const msg = procErr instanceof Error ? procErr.message : '';
        if (msg.includes('NOT_FOUND')) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found.' } });
          return;
        }
        throw procErr;
      }

      res.json({ message: 'Task updated.' });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/tasks/:id', requireUser, async (req, res, next) => {
    try {
      const deleted = await Tasks.deleteTask(param(req.params['id']));
      if (!deleted) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found.' } });
        return;
      }
      res.json({ message: 'Task deleted.' });
    } catch (error) {
      next(error);
    }
  });

  // ── Team ─────────────────────────────────────────────────────────────────

  app.get('/api/team', requireUser, async (req, res, next) => {
    try {
      const search     = (req.query.search     as string ?? '').trim() || undefined;
      const department = (req.query.department as string ?? '').trim() || undefined;

      const rows = await Team.listTeamMembers(search, department);

      const users = rows.map((u) => ({
        id:                  u.id,
        name:                u.name,
        email:               u.email,
        role:                u.role ?? 'Member',
        department:          u.department ?? 'Engineering',
        status:              u.status ?? 'Active',
        profileImage:        u.profile_image,
        assignedTasksCount:  parseInt(u.assigned_tasks_count, 10),
        completedTasksCount: parseInt(u.completed_tasks_count, 10),
      }));

      res.json({ users });
    } catch (error) {
      next(error);
    }
  });

  const createTeamSchema = z.object({
    name:       z.string().trim().min(2).max(100),
    email:      emailSchema,
    role:       z.string().trim().min(2).max(100),
    department: z.string().trim().min(2).max(100),
  });

  app.post('/api/team', requireUser, async (req, res, next) => {
    try {
      const input = parse(createTeamSchema, req.body, res);
      if (!input) return;

      if (await Team.teamEmailExists(input.email)) {
        res.status(409).json({ error: { code: 'EMAIL_REGISTERED', message: 'Team member email already exists.' } });
        return;
      }

      const id = 'usr_' + randomUUID().slice(0, 8);
      const defaultPasswordHash = await bcrypt.hash('Northstar123!', 10);
      await Team.addTeamMember(id, input.name, input.email, defaultPasswordHash, input.role, input.department);

      res.status(201).json({ id, message: 'Team member added.' });
    } catch (error) {
      next(error);
    }
  });

  // ── Calendar ─────────────────────────────────────────────────────────────

  app.get('/api/calendar', requireUser, async (_req, res, next) => {
    try {
      const rows = await Calendar.listCalendarEvents();
      const events = rows.map((e) => ({
        id:          e.id,
        title:       e.title,
        description: e.description,
        startTime:   e.start_time,
        endTime:     e.end_time,
        eventType:   e.event_type,
        projectId:   e.project_id,
        project:     e.project_name ?? 'General',
        createdBy:   e.creator_name,
      }));
      res.json({ events });
    } catch (error) {
      next(error);
    }
  });

  const createEventSchema = z.object({
    title:       z.string().trim().min(2).max(200),
    description: z.string().trim().max(1000).optional().default(''),
    start_time:  z.string().min(8),
    end_time:    z.string().min(8),
    event_type:  z.enum(['MEETING', 'EVENT', 'DEADLINE', 'REMINDER']).default('MEETING'),
    project_id:  z.string().optional().nullable(),
  });

  app.post('/api/calendar', requireUser, async (req, res, next) => {
    try {
      const input = parse(createEventSchema, req.body, res);
      if (!input) return;
      const currentUser = res.locals.user as import('./db/types.js').UserRow;
      const id = 'evt_' + randomUUID().slice(0, 8);

      await Calendar.createCalendarEvent(
        id, input.title, input.description,
        input.start_time, input.end_time, input.event_type,
        currentUser.id, input.project_id ?? null,
      );

      res.status(201).json({ id, message: 'Event created.' });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/calendar/:id', requireUser, async (req, res, next) => {
    try {
      await Calendar.deleteCalendarEvent(param(req.params['id']));
      res.json({ message: 'Event deleted.' });
    } catch (error) {
      next(error);
    }
  });

  // ── Documents ────────────────────────────────────────────────────────────

  app.get('/api/documents', requireUser, async (req, res, next) => {
    try {
      const search = (req.query.search as string ?? '').trim() || undefined;
      const rows = await Documents.listDocuments(search);
      const documents = rows.map((d) => ({
        id:         d.id,
        name:       d.name,
        fileName:   d.file_name,
        fileType:   d.file_type,
        fileSize:   parseInt(d.file_size as unknown as string, 10),
        folder:     d.folder,
        project:    d.project_name ?? 'General',
        uploadedBy: d.uploader_name,
        createdAt:  d.created_at,
      }));
      res.json({ documents });
    } catch (error) {
      next(error);
    }
  });

  const createDocumentSchema = z.object({
    name:       z.string().trim().min(2).max(200),
    file_name:  z.string().trim().min(1).max(255),
    file_type:  z.string().trim().default('application/pdf'),
    file_size:  z.number().int().positive().default(1024),
    folder:     z.string().trim().default('General'),
    project_id: z.string().optional().nullable(),
  });

  app.post('/api/documents', requireUser, async (req, res, next) => {
    try {
      const input = parse(createDocumentSchema, req.body, res);
      if (!input) return;
      const currentUser = res.locals.user as import('./db/types.js').UserRow;
      const id = 'doc_' + randomUUID().slice(0, 8);

      await Documents.createDocument(
        id, input.name, input.file_name, input.file_type, input.file_size,
        currentUser.id, input.project_id ?? null, input.folder,
      );

      res.status(201).json({ id, message: 'Document added.' });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/documents/:id', requireUser, async (req, res, next) => {
    try {
      await Documents.deleteDocument(param(req.params['id']));
      res.json({ message: 'Document deleted.' });
    } catch (error) {
      next(error);
    }
  });

  // ── Reports ──────────────────────────────────────────────────────────────

  app.get('/api/reports', requireUser, async (_req, res, next) => {
    try {
      const data = await Dashboard.getReportData();
      res.json({
        taskStats:    data.taskStats,
        projectStats: data.projectStats,
        teamWorkload: data.teamWorkload,
      });
    } catch (error) {
      next(error);
    }
  });

  // ── Notifications ────────────────────────────────────────────────────────

  app.get('/api/notifications', requireUser, async (_req, res, next) => {
    try {
      const currentUser = res.locals.user as import('./db/types.js').UserRow;
      const [notifications, unreadCount] = await Promise.all([
        Notifications.getUserNotifications(currentUser.id),
        Notifications.getUnreadCount(currentUser.id),
      ]);
      res.json({ notifications, unreadCount });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/notifications/read-all', requireUser, async (_req, res, next) => {
    try {
      const currentUser = res.locals.user as import('./db/types.js').UserRow;
      await Notifications.markAllNotificationsRead(currentUser.id);
      res.json({ message: 'All notifications marked as read.' });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/notifications/:id/read', requireUser, async (req, res, next) => {
    try {
      await Notifications.markNotificationRead(param(req.params['id']));
      res.json({ message: 'Notification marked as read.' });
    } catch (error) {
      next(error);
    }
  });

  // ── Settings ─────────────────────────────────────────────────────────────

  app.get('/api/settings', requireUser, async (_req, res, next) => {
    try {
      const currentUser = res.locals.user as import('./db/types.js').UserRow;
      let settings = await Settings.getUserSettings(currentUser.id);

      if (!settings) {
        // Initialise defaults
        await Settings.upsertUserSettings(currentUser.id, 'light', true, true, true, true);
        settings = await Settings.getUserSettings(currentUser.id);
      }

      res.json({ profile: Auth.toPublicUser(currentUser), settings });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/settings', requireUser, async (req, res, next) => {
    try {
      const currentUser = res.locals.user as import('./db/types.js').UserRow;
      const {
        name, department, role, profile_image,
        theme, notify_task_assignments, notify_project_updates,
        notify_upcoming_meetings, notify_deadline_reminders,
      } = req.body;

      await Promise.all([
        Settings.updateUserProfile(currentUser.id, { name, department, role, profile_image }),
        Settings.upsertUserSettings(
          currentUser.id,
          theme ?? 'light',
          notify_task_assignments ?? true,
          notify_project_updates  ?? true,
          notify_upcoming_meetings ?? true,
          notify_deadline_reminders ?? true,
        ),
      ]);

      res.json({ message: 'Settings updated.' });
    } catch (error) {
      next(error);
    }
  });

  // ── Global error handler ─────────────────────────────────────────────────

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error);
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: isProduction ? 'Something went wrong. Please try again.' : message,
      },
    });
  });

  return app;
}