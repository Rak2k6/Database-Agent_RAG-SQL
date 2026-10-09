import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import rateLimit from 'express-rate-limit';
import { OAuth2Client } from 'google-auth-library';
import helmet from 'helmet';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  DocumentIndexingError,
  indexProcessedDocument,
  withDocumentContentLock,
} from './ai/document-indexing.js';
import {
  buildDocumentGroundedPrompt,
  buildDocumentGroundedSystemPrompt,
  DocumentRetrievalError,
  isDocumentContentQuestion,
  retrieveDocumentChunks,
} from './ai/document-retrieval.js';
import { answerDatabaseQuestion, isDatabaseQuestion } from './ai/databaseQuery.js';
import { chatWithGroq } from './ai/groq.js';
import {
  NORTHSTAR_CAPABILITIES_ANSWER,
  WORKSPACE_UNAVAILABLE_ANSWER,
  answerIdentityQuestion,
  buildNorthstarSystemPrompt,
  isCapabilitiesQuestion,
  isIdentityQuestion,
  validateNorthstarResponse,
} from './ai/northstar.js';

// ── Domain DB modules ─────────────────────────────────────────────────────────
import * as Auth from './db/auth.js';
import * as Projects from './db/projects.js';
import * as Tasks from './db/tasks.js';
import * as Calendar from './db/calendar.js';
import * as Documents from './db/documents.js';
import { documentChunkMappings } from './db/document-chunks.js';
import * as Team from './db/team.js';
import * as Notifications from './db/notifications.js';
import * as Dashboard from './db/dashboard.js';
import * as Settings from './db/settings.js';
import {
  DOCUMENT_UPLOAD_DIRECTORY,
  DocumentStorageError,
  DocumentUploadCleanupError,
  DocumentUploadValidationError,
  MAX_DOCUMENT_FILE_SIZE,
  persistUploadedDocument,
  validateUploadedDocument,
} from './document-upload.js';
import { processStoredDocument } from './document-processing.js';
import { canUploadDocumentToProject } from './document-authorization.js';
import { QdrantService, QdrantServiceError } from './ai/qdrant.js';

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
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_FILE_SIZE, files: 1, fields: 3, fieldNameSize: 100, fieldSize: 1000, parts: 4 },
});

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

function looksLikeWorkspaceRecords(message: string, answer: string): boolean {
  if (!/\b(?:project|task|assign|working on|workload|activit|due|overdue)\b/i.test(message)) return false;
  const lines = answer.split('\n').filter((l) => l.trim());
  const bullets = lines.filter((l) => /^\s*[-*•\d.]/.test(l)).length;
  const pseudoRows = lines.filter((l) => (l.match(/\|/g) ?? []).length >= 2).length;
  return (bullets >= 2 && /\b(project|task|due|status|assign)\b/i.test(answer)) || pseudoRows >= 2;
}

  app.post('/api/ai/chat', requireUser, async (req, res, next) => {
    try {
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      if (!message || message.length > 4000) {
        res.status(400).json({ error: { code: 'INVALID_MESSAGE', message: 'Message must be between 1 and 4000 characters.' } });
        return;
      }
      const documentContentQuestion = isDocumentContentQuestion(message);
      if (!documentContentQuestion && isDatabaseQuestion(message)) {
        const result = await answerDatabaseQuestion(message);
        res.json({ answer: result.answer, source: 'database', ...(result.table ? { table: result.table } : {}) });
        return;
      }
      // Deterministic identity/capabilities answers — never hit the model,
      // so the provider identity can never leak for these questions.
      if (isIdentityQuestion(message)) {
        res.json({ answer: answerIdentityQuestion(message), source: 'identity' });
        return;
      }
      if (isCapabilitiesQuestion(message)) {
        res.json({ answer: NORTHSTAR_CAPABILITIES_ANSWER, source: 'identity' });
        return;
      }
      const requestedProjectId = req.body?.projectId;
      if (
        requestedProjectId !== undefined &&
        (typeof requestedProjectId !== 'string' || !requestedProjectId.trim() || requestedProjectId.length > 255)
      ) {
        res.status(400).json({ error: { code: 'INVALID_PROJECT_ID', message: 'The project ID is invalid.' } });
        return;
      }
      const shouldSearchDocuments = documentContentQuestion || requestedProjectId !== undefined;
      const currentUser = res.locals.user as import('./db/types.js').UserRow;
      const documentChunks = shouldSearchDocuments
        ? await retrieveDocumentChunks(currentUser.id, message, requestedProjectId)
        : [];
      if (documentChunks.length > 0) {
        const system = [
          buildNorthstarSystemPrompt(),
          buildDocumentGroundedSystemPrompt(),
        ].join('\n');
        const rawAnswer = await chatWithGroq(buildDocumentGroundedPrompt(message, documentChunks), { system });
        const answer = validateNorthstarResponse(rawAnswer);
        res.json({
          answer,
          source: 'documents',
          citations: documentChunks.map((chunk) => ({
            documentId: chunk.documentId,
            documentName: chunk.documentName,
            fileName: chunk.originalFilename,
            chunkIndex: chunk.chunkIndex,
            ...(chunk.pageNumber === undefined ? {} : { pageNumber: chunk.pageNumber }),
            ...(chunk.section === undefined ? {} : { section: chunk.section }),
          })),
        });
        return;
      }
      if (shouldSearchDocuments) {
        res.json({
          answer: 'I could not find relevant content in the documents you can access.',
          source: 'documents',
          citations: [],
        });
        return;
      }
      // Instruction-level guardrails: every conversational answer is
      // generated under the Northstar system prompt, then validated.
      const rawAnswer = await chatWithGroq(message, { system: buildNorthstarSystemPrompt() });
      const answer = validateNorthstarResponse(rawAnswer);
      // Last-resort hallucination guard: a conversational answer that
      // looks like workspace records must never be served as fact.
      if (answer === rawAnswer && looksLikeWorkspaceRecords(message, rawAnswer)) {
        res.json({ answer: WORKSPACE_UNAVAILABLE_ANSWER });
        return;
      }
      res.json({ answer });
    } catch (error) {
      if (error instanceof DocumentRetrievalError) {
        console.error('[DOCUMENT_RETRIEVAL] chat request failed', { code: error.code });
        res.status(error.status).json({
          error: { code: error.code, message: error.message },
        });
        return;
      }
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
        assignedTasksCount:  u.assigned_tasks_count,
        completedTasksCount: u.completed_tasks_count,
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
    name: z.string().trim().min(2).max(200),
    folder: z.string().trim().min(1).max(100),
    project_id: z.string().trim().min(1).max(100),
  });

  app.post('/api/documents', requireUser, (req, res, next) => {
    documentUpload.single('file')(req, res, (error: unknown) => {
      if (!error) {
        next();
        return;
      }
      if (error instanceof MulterError) {
        const tooLarge = error.code === 'LIMIT_FILE_SIZE';
        res.status(tooLarge ? 413 : 400).json({
          error: {
            code: tooLarge ? 'FILE_TOO_LARGE' : 'INVALID_UPLOAD',
            message: tooLarge
              ? `Choose a file no larger than ${MAX_DOCUMENT_FILE_SIZE / (1024 * 1024)} MB.`
              : 'The multipart upload is invalid or contains too many fields.',
          },
        });
        return;
      }
      next(error);
    });
  }, async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: { code: 'FILE_REQUIRED', message: 'Choose a document file to upload.' } });
        return;
      }

      const input = parse(createDocumentSchema, req.body, res);
      if (!input) return;

      const currentUser = res.locals.user as import('./db/types.js').UserRow;
      if (!await canUploadDocumentToProject(
        input.project_id,
        currentUser.id,
        Projects.getProjectMembers,
      )) {
        res.status(403).json({
          error: { code: 'PROJECT_ACCESS_DENIED', message: 'You do not have access to upload documents to this project.' },
        });
        return;
      }

      validateUploadedDocument(req.file);
      const documentVersion = createHash('sha256').update(req.file.buffer).digest('hex');
      const result = await withDocumentContentLock(
        input.project_id,
        currentUser.id,
        documentVersion,
        async () => {
          const existing = await Documents.findDocumentWithContentVersion(
            input.project_id,
            currentUser.id,
            documentVersion,
          );
          if (existing?.file_name && existing.file_path) {
            const processing = await processStoredDocument(
              {
                documentId: existing.id,
                projectId: existing.project_id,
                originalFilename: existing.file_name,
                filePath: existing.file_path,
              },
              { uploadDirectory: DOCUMENT_UPLOAD_DIRECTORY },
            );
            if (processing.sourceHash === documentVersion) {
              if (processing.processingStatus === 'failed') {
                throw new DocumentUploadValidationError(
                  processing.extractionError?.message ?? 'The document could not be processed.',
                  processing.extractionError?.code ?? 'DOCUMENT_PROCESSING_FAILED',
                  400,
                );
              }
              try {
                const indexing = await indexProcessedDocument({
                  documentId: existing.id,
                  projectId: existing.project_id,
                  docVer: documentVersion,
                  chunks: processing.chunks,
                });
                return {
                  document: existing,
                  indexing: { success: true as const, result: indexing },
                  reusedDocument: true,
                };
              } catch (error) {
                const code = error instanceof DocumentIndexingError ? error.code : 'DOCUMENT_INDEXING_FAILED';
                console.error('[DOCUMENT_INDEXING] failed', { documentId: existing.id, code });
                return {
                  document: existing,
                  indexing: {
                    success: false as const,
                    code,
                    chunkCount: processing.chunks.length,
                  },
                  reusedDocument: true,
                };
              }
            }
          }

          const id = 'doc_' + randomUUID();
          const storedResult = await persistUploadedDocument(
            req.file!,
            DOCUMENT_UPLOAD_DIRECTORY,
            async (file) => {
              const processing = await processStoredDocument(
                {
                  documentId: id,
                  projectId: input.project_id,
                  originalFilename: file.fileName,
                  filePath: file.filePath,
                },
                { uploadDirectory: DOCUMENT_UPLOAD_DIRECTORY },
              );
              if (processing.processingStatus === 'failed') {
                throw new DocumentUploadValidationError(
                  processing.extractionError?.message ?? 'The document could not be processed.',
                  processing.extractionError?.code ?? 'DOCUMENT_PROCESSING_FAILED',
                  400,
                );
              }
              if (processing.sourceHash !== documentVersion) {
                throw new DocumentUploadValidationError(
                  'The stored document content did not match the uploaded file.',
                  'DOCUMENT_CONTENT_MISMATCH',
                  400,
                );
              }

              const document = await Documents.createDocument(
                id, input.name, file.fileName, file.filePath, file.fileType, file.fileSize,
                currentUser.id, input.project_id, input.folder,
              );
              try {
                const indexing = await indexProcessedDocument({
                  documentId: id,
                  projectId: input.project_id,
                  docVer: documentVersion,
                  chunks: processing.chunks,
                });
                return { document, indexing: { success: true as const, result: indexing } };
              } catch (error) {
                const code = error instanceof DocumentIndexingError ? error.code : 'DOCUMENT_INDEXING_FAILED';
                console.error('[DOCUMENT_INDEXING] failed', { documentId: id, code });
                return {
                  document,
                  indexing: {
                    success: false as const,
                    code,
                    chunkCount: processing.chunks.length,
                  },
                };
              }
            },
          );
          return { ...storedResult, reusedDocument: false };
        },
      );
      if (!result.indexing.success) {
        res.status(503).json({
          error: {
            code: result.indexing.code,
            message: 'The document was stored, but indexing did not complete. It is retained for retry.',
          },
          documentId: result.document.id,
          processingStatus: 'failed',
          chunkCount: result.indexing.chunkCount,
        });
        return;
      }
      res.status(result.reusedDocument ? 200 : 201).json({
        id: result.document.id,
        message: result.reusedDocument ? 'Existing document reused.' : 'Document uploaded.',
        processingStatus: result.indexing.result.processingStatus,
        chunkCount: result.indexing.result.chunkCount,
        reusedDocument: result.reusedDocument,
        reusedExistingIndex: result.indexing.result.reusedExistingIndex,
        cleanupPending: result.indexing.result.cleanupPending,
      });
    } catch (error) {
      if (error instanceof DocumentUploadValidationError) {
        res.status(error.status).json({ error: { code: error.code, message: error.message } });
        return;
      }

      if (error instanceof DocumentStorageError) {
        console.error('Document upload storage failure:', error.cause);
        res.status(500).json({
          error: { code: 'FILE_STORAGE_FAILED', message: 'Could not store the uploaded file. Please try again.' },
        });
        return;
      }

      if (error instanceof DocumentUploadCleanupError) {
        console.error('Could not remove an uploaded file after document creation failed:', error.cleanupError);
        res.status(500).json({
          error: { code: 'DOCUMENT_ROLLBACK_FAILED', message: 'Could not complete the upload and clean up its stored file.' },
        });
        return;
      }

      const procError = error as { number?: unknown; originalError?: { info?: { number?: unknown } } };
      const number = procError.number ?? procError.originalError?.info?.number;
      if (number === 50001) {
        res.status(409).json({ error: { code: 'DOCUMENT_EXISTS', message: 'Document already exists.' } });
        return;
      }
      if (number === 50002) {
        res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
        return;
      }
      if (number === 50003) {
        res.status(401).json({ error: { code: 'UPLOADER_NOT_FOUND', message: 'Your session is no longer valid. Please sign in again.' } });
        return;
      }
      next(error);
    }
  });

  app.post('/api/documents/:id/index', requireUser, async (req, res, next) => {
    try {
      const documentId = param(req.params['id']);
      const document = await Documents.getDocumentForProcessing(documentId);
      if (!document) {
        res.status(404).json({ error: { code: 'DOCUMENT_NOT_FOUND', message: 'Document not found.' } });
        return;
      }

      const currentUser = res.locals.user as import('./db/types.js').UserRow;
      if (document.project_id === null) {
        if (document.uploaded_by !== currentUser.id) {
          res.status(403).json({ error: { code: 'DOCUMENT_ACCESS_DENIED', message: 'You do not have access to retry this document.' } });
          return;
        }
      } else {
        const members = await Projects.getProjectMembers(document.project_id);
        if (!members.some((member) => member.user_id === currentUser.id)) {
          res.status(403).json({ error: { code: 'DOCUMENT_ACCESS_DENIED', message: 'You do not have access to retry this document.' } });
          return;
        }
      }

      if (!document.file_name || !document.file_path) {
        res.status(409).json({
          error: { code: 'DOCUMENT_FILE_UNAVAILABLE', message: 'This document does not have a valid stored file to process.' },
        });
        return;
      }

      const processing = await processStoredDocument(
        {
          documentId,
          projectId: document.project_id,
          originalFilename: document.file_name,
          filePath: document.file_path,
        },
        { uploadDirectory: DOCUMENT_UPLOAD_DIRECTORY },
      );
      if (processing.processingStatus === 'failed' || !processing.sourceHash) {
        const currentVersionRows = await documentChunkMappings.list(documentId, processing.sourceHash);
        const incompleteVersions = new Set(currentVersionRows
          .filter((row) => row.status !== 'indexed')
          .map((row) => row.doc_ver));
        for (const docVer of incompleteVersions) {
          await documentChunkMappings.updateStatus(
            documentId,
            docVer,
            'failed',
            processing.extractionError?.message ?? 'Document extraction failed.',
          );
        }
        res.status(422).json({
          error: {
            code: processing.extractionError?.code ?? 'DOCUMENT_PROCESSING_FAILED',
            message: processing.extractionError?.message ?? 'The document could not be processed.',
          },
          documentId,
          processingStatus: 'failed',
        });
        return;
      }

      try {
        const indexing = await indexProcessedDocument({
          documentId,
          projectId: document.project_id,
          docVer: processing.sourceHash,
          chunks: processing.chunks,
        });
        res.json({
          documentId,
          processingStatus: indexing.processingStatus,
          chunkCount: indexing.chunkCount,
          reusedExistingIndex: indexing.reusedExistingIndex,
          cleanupPending: indexing.cleanupPending,
          ...(indexing.cleanupError === undefined ? {} : { cleanupError: indexing.cleanupError }),
        });
      } catch (error) {
        const code = error instanceof DocumentIndexingError ? error.code : 'DOCUMENT_INDEXING_FAILED';
        console.error('[DOCUMENT_INDEXING] retry failed', { documentId, code });
        res.status(503).json({
          error: { code, message: 'The document could not be indexed. Its current mappings are retained for retry.' },
          documentId,
          processingStatus: 'failed',
        });
      }
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/documents/:id', requireUser, async (req, res, next) => {
    try {
      const documentId = param(req.params['id']);
      const mappings = await documentChunkMappings.list(documentId);
      const vectorIds = mappings.map((mapping) => mapping.vector_id);
      if (vectorIds.length > 0) {
        await new QdrantService().deletePoints(vectorIds);
        for (const docVer of new Set(mappings.map((mapping) => mapping.doc_ver))) {
          await documentChunkMappings.deleteVersion(documentId, docVer);
        }
      }
      await Documents.deleteDocument(documentId);
      res.json({ message: 'Document deleted.' });
    } catch (error) {
      if (error instanceof QdrantServiceError) {
        res.status(503).json({
          error: { code: 'VECTOR_STORE_UNAVAILABLE', message: 'Could not safely remove the document vectors. Please try again.' },
        });
        return;
      }
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
