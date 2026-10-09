/**
 * scripts/generate-demo-documents.ts — RAG Stage 1 demo document generator.
 *
 * Reads 5 real projects from SQL Server (dbo.projects) and generates
 * 3 Markdown documents per project (requirements, technical-design,
 * project-status) under server/data/documents/<project-slug>/.
 *
 * - Deterministic: same database state → same output.
 * - Never overwrites existing files unless --force is passed.
 * - READ-ONLY against the database (SELECTs only, no writes).
 * - Does NOT touch the dbo.documents table.
 *
 * Usage:
 *   node ./node_modules/tsx/dist/cli.mjs scripts/generate-demo-documents.ts [--force]
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FORCE = process.argv.includes('--force');

export interface ProjectInfo {
  id: string;
  name: string;
  status: string;
  description: string;
  start_date: string;
  due_date: string;
  creator_name: string | null;
  total_tasks: number;
  completed_tasks: number;
}

export interface TaskInfo {
  title: string;
  status: string;
  priority: string;
}

export interface MemberInfo {
  user_name: string;
  member_role: string;
}

// ── The 5 projects selected from dbo.projects (verified live data) ──────────
export const PROJECT_IDS = [
  'seed_proj_09', // Data Warehouse Modernization (COMPLETED)
  'seed_proj_07', // Customer Support Automation (ON_HOLD)
  'seed_proj_03', // Cloud Infrastructure Migration (ACTIVE)
  'seed_proj_06', // Document Processing Pipeline (ACTIVE)
  'seed_proj_01', // Customer Intelligence Platform (ACTIVE)
];

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function fmtDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString().slice(0, 10);
}

export function progress(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((100 * done) / total);
}


export function requirementsDoc(p: ProjectInfo, members: MemberInfo[]): string {
  const stakeholderLines = members.length > 0
    ? members.map((m) => `- **${m.user_name}** — ${m.member_role}`).join('\n')
    : '- _No members recorded in the project roster yet._';
  return `# ${p.name} — Business Requirements

> Project ID: \`${p.id}\` · Status: **${p.status}** · Timeline: ${fmtDate(p.start_date)} → ${fmtDate(p.due_date)}
> Source: Northstar AI Workplace demo dataset (dbo.projects). Generated for RAG retrieval testing.

## 1. Project Objective

${p.description}. The ${p.name} initiative exists to deliver measurable business value before the ${fmtDate(p.due_date)} target date. Success means shipping a working capability that stakeholders can use in production, backed by documentation, tests, and an operational handover.

## 2. Business Requirements

- **BR-1 — Time to value:** The first usable increment must be available well before the due date so stakeholders can give feedback early.
- **BR-2 — Adoption:** The delivered capability must be usable by its target audience without dedicated training beyond a short onboarding session.
- **BR-3 — Reliability:** The solution must meet the team's standard service-level expectations for availability and data correctness.
- **BR-4 — Auditability:** All significant decisions, changes, and approvals must be traceable in the Northstar workspace (activities, documents, and status reports).
- **BR-5 — Cost control:** Delivery must stay within the approved staffing plan; scope changes go through the project owner.

## 3. Functional Requirements

export function technicalDesignDoc(p: ProjectInfo, tasks: TaskInfo[]): string {
  const focusAreas = tasks.slice(0, 6).map((t) => `- ${t.title} [${t.status}/${t.priority}]`).join('\n') || '- _No tasks recorded yet._';
  return `# ${p.name} — Technical Design

> Project ID: \`${p.id}\` · Status: **${p.status}**
> Source: Northstar AI Workplace demo dataset. Generated for RAG retrieval testing.

## 1. System Overview

The ${p.name} system is built on the Northstar AI Workplace stack: an Angular 19+ single-page frontend, a Node.js/Express TypeScript API, and Microsoft SQL Server 2025 as the system of record. The project description — "${p.description}" — drives every design decision below: components are kept small, stateless where possible, and observable through the existing activity and notification pipelines.

## 2. Architecture

The architecture follows a layered modular monolith:

1. **Presentation layer (Angular 19+, SCSS, RxJS/signals):** standalone components per workspace area (projects, tasks, documents, calendar, reports, settings). The AI chat panel is a reusable component backed by a typed service layer.
2. **API layer (Node.js + Express, TypeScript, Zod validation):** route modules grouped by domain; every request is validated, authenticated via HttpOnly session cookies, and authorized against the project roster.
3. **Data-access layer (server/src/db):** one module per domain (auth, projects, tasks, calendar, documents, team, notifications, settings, dashboard). All SQL is parameterized; business transactions live in stored procedures.
4. **Database (SQL Server 2025, dbo schema):** 11 tables, 4 views, 9 scalar/JSON functions, 7 stored procedures, 15 trusted foreign keys.
5. **AI/RAG layer (planned):** Markdown documents chunked and embedded for semantic retrieval; the existing read-only SQL pipeline stays as the structured-data path.

## 3. Technologies

| Layer | Technology |
|---|---|
| Frontend | Angular 19+, TypeScript, SCSS, RxJS/signals |
| Backend | Node.js, Express 5, TypeScript, Zod, bcryptjs |
| Database | Microsoft SQL Server 2025 Developer |
| Driver | mssql 12.x + msnodesqlv8 + ODBC Driver 18 (Named Pipes, Windows auth) |
| AI runtime | Ollama-compatible chat endpoint; embeddings phase (planned) |
| Docs | Markdown under server/data/documents, one folder per project slug |

## 4. Major Components

- **Project service:** CRUD plus roster management backed by dbo.projects, dbo.project_members, and the creation/update procedures.
- **Task service:** prioritized task lists with overdue computation from dbo.list_tasks; writes through the task procedures.
- **Document service:** metadata in dbo.documents today; Markdown content on disk (this folder) as the RAG corpus tomorrow.
- **Notification service:** assignment and milestone notifications via dbo.notifications.
- **Dashboard service:** single-call JSON assembly via dbo.get_dashboard_data plus the v_* reporting views.

Current tracked work items informing this design:

${focusAreas}

## 5. APIs and Integrations

- REST JSON API under /api (projects, tasks, team, calendar, documents, notifications, settings, dashboard, reports, ai/chat).
- Google Identity Services for optional OAuth sign-in; session cookies are HttpOnly + SameSite=Lax.
- Outbound integrations are limited to the AI chat inference endpoint; no external SaaS dependency is required for core delivery.

export function projectStatusDoc(p: ProjectInfo, tasks: TaskInfo[]): string {
  const byStatus = (s: string) => tasks.filter((t) => t.status === s).map((t) => t.title);
  const done = byStatus('COMPLETED');
  const active = tasks.filter((t) => t.status === 'IN_PROGRESS' || t.status === 'TODO');
  const pct = progress(p.completed_tasks, p.total_tasks);
  const riskNote = p.status === 'ON_HOLD'
    ? 'The project is currently ON HOLD: the due date has passed with work remaining. The primary risk is stale context — tasks, owners, and priorities should be re-confirmed before resuming.'
    : p.status === 'COMPLETED'
      ? 'The project is marked COMPLETED with residual TODO/IN_PROGRESS rows remaining in the tracker. The main risk is reporting confusion; the leftover items should be closed or moved before sign-off.'
      : 'Delivery risk is schedule pressure toward the due date. Mitigation: keep high-priority tasks owned, unblock dependencies early, and re-plan scope if progress stalls for two consecutive check-ins.';
  return `# ${p.name} — Project Status Report

> Project ID: \`${p.id}\` · Status: **${p.status}** · Timeline: ${fmtDate(p.start_date)} → ${fmtDate(p.due_date)}
> Source: Northstar AI Workplace demo dataset (dbo.projects + dbo.tasks). Generated for RAG retrieval testing.

## 1. Current Status

The project is **${p.status}** with ${p.completed_tasks} of ${p.total_tasks} tracked tasks completed (**${pct}%**). Reporting window covers the full project timeline from ${fmtDate(p.start_date)} to the ${fmtDate(p.due_date)} target.

## 2. Progress Summary

- Total tracked tasks: ${p.total_tasks}
- Completed: ${p.completed_tasks}
- In progress: ${tasks.filter((t) => t.status === 'IN_PROGRESS').length}
- To do: ${tasks.filter((t) => t.status === 'TODO').length}
- Overall completion: ${pct}%

## 3. Completed Work

${done.length > 0 ? done.map((t) => `- ~~${t}~~`).join('\n') : '- _No completed tasks recorded yet._'}

## 4. Current Tasks

${active.length > 0 ? active.map((t) => `- ${t}`).join('\n') : '- _No active tasks recorded._'}

## 5. Upcoming Milestones

- **M1 — Feature freeze:** all TODO tasks either started or explicitly deferred.
- **M2 — Verification pass:** every COMPLETED task reviewed against its acceptance criteria.
- **M3 — Documentation sign-off:** requirements, technical design, and this status report reviewed by the project owner.
- **M4 — Release / handover:** delivery by ${fmtDate(p.due_date)} with operational notes archived in the project folder.

## 6. Risks and Blockers

${riskNote}

## 7. Next Steps

1. Triage the current TODO queue and assign an owner and priority to each item.
2. Drive IN_PROGRESS tasks to COMPLETED with evidence (tests, screenshots, or review notes).
3. Refresh this status report at the next milestone and archive the previous version.
4. Confirm the ${fmtDate(p.due_date)} date is still achievable; escalate early if it is not.
`;
}

async function main(): Promise<void> {
  const { getPool, closeSqlPool } = await import('../server/src/db/pool.js');
  const pool = await getPool();

  const req = pool.request();
  PROJECT_IDS.forEach((id, i) => req.input(`id${i}`, id));
  const rows = (await req.query(`
    SELECT p.id, p.name, p.status, p.description,
           CONVERT(NVARCHAR(30), p.start_date, 126) AS start_date,
           CONVERT(NVARCHAR(30), p.due_date, 126) AS due_date,
           u.name AS creator_name,
           (SELECT COUNT(*) FROM dbo.tasks t WHERE t.project_id = p.id) AS total_tasks,
           (SELECT COUNT(*) FROM dbo.tasks t WHERE t.project_id = p.id AND t.status = 'COMPLETED') AS completed_tasks
    FROM dbo.projects p
    LEFT JOIN dbo.users u ON u.id = p.created_by
    WHERE p.id IN (${PROJECT_IDS.map((_, i) => `@id${i}`).join(', ')})
    ORDER BY p.created_at
  `)).recordset as ProjectInfo[];

  if (rows.length !== 5) {
    throw new Error(`Expected 5 projects, found ${rows.length}. Database state changed — aborting.`);
  }

  const baseDir = resolve(process.cwd(), 'server', 'data', 'documents');
  const generated: string[] = [];
  const skipped: string[] = [];

  for (const p of rows) {
    const slug = slugify(p.name);
    const dir = join(baseDir, slug);
    mkdirSync(dir, { recursive: true });

    const tasksReq = pool.request();
    tasksReq.input('pid', p.id);
    const tasks = (await tasksReq.query(`
      SELECT title, status, priority FROM dbo.tasks WHERE project_id = @pid ORDER BY created_at
    `)).recordset as TaskInfo[];

    const membersReq = pool.request();
    membersReq.input('pid', p.id);
    const members = (await membersReq.query(`
      SELECT u.name AS user_name, pm.role AS member_role
      FROM dbo.project_members pm INNER JOIN dbo.users u ON u.id = pm.user_id
      WHERE pm.project_id = @pid ORDER BY u.name
    `)).recordset as MemberInfo[];

    const docs: Array<[string, string]> = [
      ['requirements.md', requirementsDoc(p, members)],
      ['technical-design.md', technicalDesignDoc(p, tasks)],
      ['project-status.md', projectStatusDoc(p, tasks)],
    ];

    for (const [file, content] of docs) {
      const full = join(dir, file);
      if (existsSync(full) && !FORCE) {
        skipped.push(`${slug}/${file}`);
        continue;
      }
      writeFileSync(full, content, 'utf8');
      generated.push(`${slug}/${file}`);
    }
  }

  await closeSqlPool();

  console.log('── Demo document generation summary ──');
  console.log(`Projects: ${rows.map((p) => `${p.id} (${slugify(p.name)})`).join(', ')}`);
  console.log(`Generated: ${generated.length}`);
  generated.forEach((f) => console.log(`  + server/data/documents/${f}`));
  if (skipped.length > 0) {
    console.log(`Skipped (exists, use --force to overwrite): ${skipped.length}`);
    skipped.forEach((f) => console.log(`  = server/data/documents/${f}`));
  }
}

main().catch((err) => {
  console.error('Document generation failed:', err);
  process.exit(1);
});


## 6. Database and Data Considerations

- Keys are application-generated prefixed strings (proj_*, task_*, usr_*, doc_*, evt_*, act_*, notif_*); the project_members composite key is NONCLUSTERED because of key-size limits.
- Timestamps for user content use DATETIME2 (SYSUTCDATETIME at write time); session/reset-token instants use BIGINT milliseconds.
- Read models are JSON-producing scalar functions (FOR JSON PATH) so the API performs one round trip per screen; empty sets surface as NULL and are normalized to empty arrays in Node.
- Foreign keys use NO ACTION in several places to avoid multiple-cascade-path errors; deletes are ordered in application/procedure logic instead.

## 7. Deployment Considerations

- Development runs on LAPTOP-AKH44TSK against the Northstar database over Named Pipes; TCP is disabled on this instance.
- The Angular dev server proxies /api to the Express API on port 3000.
- Promotion is a file-plus-database deploy: static bundle, Node service, and versioned routine scripts. No schema change is expected for this project's delivery.

## 8. Security Considerations

- Parameterized queries everywhere; a read-only SQL guard constrains AI-generated statements to SELECT over allowlisted tables.
- Password hashing with bcrypt; reset tokens are SHA-256 hashed, single-use, and time-boxed; sessions are hashed opaque tokens revoked on logout and password reset.
- Secrets live in environment variables, never in source; the documents corpus contains demo data only.
`;
}


- **FR-1 — Project workspace:** All work is tracked in Northstar with tasks in one of TODO, IN_PROGRESS, COMPLETED, or CANCELLED states.
- **FR-2 — Task assignment:** Every active task has a named owner; unassigned work is triaged weekly.
- **FR-3 — Progress visibility:** A project status document is refreshed each milestone so anyone can see percent complete, completed work, and remaining tasks.
- **FR-4 — Document management:** Requirements, designs, and status reports are stored as versioned Markdown documents under the project folder.
- **FR-5 — Notifications:** Team members are notified when tasks are assigned to them or when project milestones change.

## 4. Scope

**In scope:** planning, design, implementation, testing, documentation, deployment, and handover of the ${p.name} capability described above.
**Out of scope:** unrelated platform rewrites, hardware procurement, and third-party contract negotiation. Change requests that expand scope require owner approval and a revised timeline.

## 5. Key Stakeholders

${stakeholderLines}

## 6. Expected Outcomes

- A production-ready ${p.name} capability delivered by ${fmtDate(p.due_date)}.
- ${p.total_tasks} tracked tasks driven to completion (currently ${p.completed_tasks} completed, ${progress(p.completed_tasks, p.total_tasks)}% done).
- A complete document set (requirements, technical design, status) enabling future maintenance.
- A retrospective capturing lessons learned for the next Northstar project.
`;
}
